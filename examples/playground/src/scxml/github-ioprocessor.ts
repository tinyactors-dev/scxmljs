/**
 * GitHub as an SCXML Event I/O Processor.
 *
 * Outbound — in the chart:
 *
 *   <send type="github" targetexpr="issue.repo" event="close">
 *     <param name="number" expr="issue.number"/>
 *     <param name="reason" expr="'not_planned'"/>
 *   </send>
 *
 * `target` is the repository ("owner/name"), `event` the verb
 * (comment | label | close | reopen). Once the backend call settles, the
 * processor answers the sending session with `github.<verb>.done` or
 * `github.<verb>.error`. `_event.origintype` is GITHUB_IOPROCESSOR.
 *
 * Inbound — GitHub webhooks: `receiveWebhook("issues", payload)` turns a
 * delivery into `issues.<action>` with `{ repo, number, title, author, url }`.
 *
 * No Bun/Node APIs here: this file runs in the browser too.
 */
import type { IOProcessor, IOSession, OutboundSend } from "@tinyactors/scxmljs";

export const GITHUB_IOPROCESSOR = "urn:scxmljs:ioprocessor:github";

export interface GitHubBackend {
  comment(repo: string, number: number, body: string): Promise<void>;
  addLabels(repo: string, number: number, labels: string[]): Promise<void>;
  close(repo: string, number: number, reason: "completed" | "not_planned"): Promise<void>;
  reopen(repo: string, number: number): Promise<void>;
}

export interface IssueEventData {
  repo: string;
  number: number;
  title: string;
  author: string;
  url?: string;
}

export interface GitHubIOProcessorOptions {
  /** Where GitHub should deliver webhooks; reported as `_ioprocessors.github.location`. */
  webhookUrl?: string;
  /**
   * Picks the session(s) an inbound issue event goes to. Return a session to
   * target it (e.g. one session per issue); return undefined to broadcast
   * to all attached sessions.
   */
  route?: (event: string, data: IssueEventData) => IOSession | undefined;
}

export class GitHubIOProcessor implements IOProcessor {
  readonly type = GITHUB_IOPROCESSOR;
  readonly aliases = ["github"] as const;
  private sessions = new Set<IOSession>();

  constructor(
    readonly backend: GitHubBackend,
    private opts: GitHubIOProcessorOptions = {},
  ) {}

  location(session: IOSession) {
    return this.opts.webhookUrl ?? `github:webhook#${session.sessionId}`;
  }

  attach(session: IOSession) {
    this.sessions.add(session);
  }

  detach(session: IOSession) {
    this.sessions.delete(session);
  }

  send(message: OutboundSend, session: IOSession) {
    const data = (message.data ?? {}) as { repo?: string; number?: unknown; body?: unknown; labels?: string | string[]; reason?: string };
    const repo = message.target || data.repo;
    const number = Number(data.number);
    if (!repo) throw new Error("github: <send> needs a target repository (owner/name)");
    if (!Number.isInteger(number)) throw new Error("github: <send> needs a numeric `number` param");

    const verb = message.event;
    let call: Promise<void>;
    switch (verb) {
      case "comment":
        call = this.backend.comment(repo, number, String(data.body ?? ""));
        break;
      case "label":
        call = this.backend.addLabels(repo, number, ([] as string[]).concat(data.labels ?? []));
        break;
      case "close":
        call = this.backend.close(repo, number, data.reason === "completed" ? "completed" : "not_planned");
        break;
      case "reopen":
        call = this.backend.reopen(repo, number);
        break;
      default:
        throw new Error(`github: unknown verb "${verb}"`);
    }
    const reply = { repo, number, sendid: message.sendid };
    call.then(
      () => session.deliver(`github.${verb}.done`, reply, repo),
      (e: unknown) => session.deliver(`github.${verb}.error`, { ...reply, message: e instanceof Error ? e.message : String(e) }, repo),
    );
  }

  /**
   * Feed a webhook delivery in. `event` is the X-GitHub-Event header.
   * Returns false for deliveries this processor does not translate.
   */
  receiveWebhook(event: string, payload: unknown): boolean {
    if (!isIssuesPayload(payload)) return false;
    if (event !== "issues") return false;
    const name = `issues.${payload.action}`;
    const data = issueEventData(payload);
    const target = this.opts.route?.(name, data);
    for (const s of target ? [target] : this.sessions) s.deliver(name, data, data.url);
    return true;
  }
}

/** The parts of a GitHub `issues` webhook payload this processor reads. */
export interface IssuesWebhookPayload {
  action: string;
  issue: { number: number; title?: string; user?: { login?: string }; html_url?: string };
  repository?: { full_name?: string };
}

function isIssuesPayload(p: unknown): p is IssuesWebhookPayload {
  const x = p as Partial<IssuesWebhookPayload> | null;
  return typeof x === "object" && x !== null && typeof x.action === "string" && typeof x.issue === "object" && x.issue !== null;
}

export function issueEventData(payload: IssuesWebhookPayload): IssueEventData {
  return {
    repo: payload.repository?.full_name ?? "",
    number: payload.issue.number,
    title: payload.issue.title ?? "",
    author: payload.issue.user?.login ?? "",
    url: payload.issue.html_url,
  };
}

/** Builds a minimal `issues` webhook payload — for demos and tests. */
export function issuesWebhook(action: string, repo: string, number: number, author: string, title = "") {
  return {
    action,
    issue: { number, title, user: { login: author }, html_url: `https://github.com/${repo}/issues/${number}` },
    repository: { full_name: repo },
  };
}

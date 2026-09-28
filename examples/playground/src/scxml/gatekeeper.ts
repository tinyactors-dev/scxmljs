/**
 * The headless system: one statechart session per issue, all sharing a single
 * GitHub I/O processor that routes each webhook to its issue's session.
 */
import { type Clock, compile, loadQuickJS, type Model, parseSCXML, Session, type SessionOptions } from "@tinyactors/scxmljs";
import { type GitHubBackend, GitHubIOProcessor } from "./github-ioprocessor.ts";

export interface GatekeeperOptions {
  chart: string;
  backend: GitHubBackend;
  domParser?: SessionOptions["domParser"];
  /** Overrides for the chart's <data> (e.g. a different allowlist). */
  data?: SessionOptions["data"];
  clock?: Clock;
  webhookUrl?: string;
  log?: (line: string) => void;
}

export class Gatekeeper {
  readonly sessions = new Map<string, Session>();
  readonly github: GitHubIOProcessor;

  /** Compiles the chart once and loads the ECMAScript engine; sessions are then created synchronously. */
  static async create(opts: GatekeeperOptions) {
    await loadQuickJS();
    const model = await compile(parseSCXML(opts.chart, opts.domParser));
    return new Gatekeeper(model, opts);
  }

  private constructor(
    private model: Model,
    private opts: GatekeeperOptions,
  ) {
    this.github = new GitHubIOProcessor(opts.backend, {
      webhookUrl: opts.webhookUrl,
      route: (_event, issue) => {
        const key = `${issue.repo}#${issue.number}`;
        let s = this.sessions.get(key);
        if (!s) {
          s = this.spawn(key);
          this.sessions.set(key, s);
        }
        return s.ioSession(this.github);
      },
    });
  }

  /** Feed a webhook delivery (X-GitHub-Event + JSON body). */
  webhook(event: string, payload: unknown) {
    return this.github.receiveWebhook(event, payload);
  }

  private spawn(key: string) {
    const log = this.opts.log ?? console.log;
    const s = new Session(this.model, {
      data: this.opts.data,
      ioprocessors: [this.github],
      clock: this.opts.clock,
      domParser: this.opts.domParser,
      sessionId: key,
    });
    s.addEventListener("log", (e) => log(`[${key}] ${e.label}: ${e.value ?? ""}`));
    s.addEventListener("error", (e) => log(`[${key}] ${e.kind}: ${e.message}`));
    return s.start();
  }
}

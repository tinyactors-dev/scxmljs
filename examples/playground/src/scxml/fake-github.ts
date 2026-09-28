/**
 * In-memory GitHub backend: a pretend repository with issues, latency and
 * injectable failures. Browser-safe; used by the demos and the tests.
 */
import type { GitHubBackend } from "./github-ioprocessor.ts";

export interface FakeIssue {
  repo: string;
  number: number;
  title: string;
  author: string;
  state: "open" | "closed";
  stateReason?: string;
  labels: string[];
  comments: string[];
}

export type FakeVerb = "comment" | "addLabels" | "close" | "reopen";

export class FakeGitHub extends EventTarget implements GitHubBackend {
  readonly issues = new Map<string, FakeIssue>();
  /** Every call, for assertions and UI. */
  readonly calls: { verb: FakeVerb; repo: string; number: number; ok: boolean }[] = [];
  /** Remaining forced failures per verb. */
  readonly failures = new Map<FakeVerb, number>();
  private next = 1;

  constructor(public latencyMs = 0) {
    super();
  }

  open(repo: string, author: string, title: string): FakeIssue {
    const issue: FakeIssue = { repo, number: this.next++, title, author, state: "open", labels: [], comments: [] };
    this.issues.set(key(repo, issue.number), issue);
    this.changed();
    return issue;
  }

  failNext(verb: FakeVerb, times = 1) {
    this.failures.set(verb, (this.failures.get(verb) ?? 0) + times);
  }

  comment(repo: string, number: number, body: string) {
    return this.call("comment", repo, number, (i) => void i.comments.push(body));
  }

  addLabels(repo: string, number: number, labels: string[]) {
    return this.call("addLabels", repo, number, (i) => {
      for (const l of labels) if (!i.labels.includes(l)) i.labels.push(l);
    });
  }

  close(repo: string, number: number, reason: string) {
    return this.call("close", repo, number, (i) => {
      i.state = "closed";
      i.stateReason = reason;
    });
  }

  reopen(repo: string, number: number) {
    return this.call("reopen", repo, number, (i) => {
      i.state = "open";
      i.stateReason = undefined;
    });
  }

  private async call(verb: FakeVerb, repo: string, number: number, apply: (i: FakeIssue) => void) {
    if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
    else await Promise.resolve(); // always async, like the real thing
    const issue = this.issues.get(key(repo, number));
    const left = this.failures.get(verb) ?? 0;
    const ok = !!issue && left === 0;
    if (left) this.failures.set(verb, left - 1);
    this.calls.push({ verb, repo, number, ok });
    if (!issue) throw new Error(`404: ${repo}#${number} not found`);
    if (!ok) throw new Error(`502: ${verb} failed (injected)`);
    apply(issue);
    this.changed();
  }

  private changed() {
    this.dispatchEvent(new Event("change"));
  }
}

const key = (repo: string, n: number) => `${repo}#${n}`;

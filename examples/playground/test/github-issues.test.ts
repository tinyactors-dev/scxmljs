import { describe, expect, test } from "bun:test";
import { createSession, type Session, VirtualClock } from "@tinyactors/scxmljs";
import { Window } from "happy-dom";
import { FakeGitHub } from "../src/scxml/fake-github.ts";
import { Gatekeeper } from "../src/scxml/gatekeeper.ts";
import { GITHUB_IOPROCESSOR, GitHubIOProcessor, issuesWebhook } from "../src/scxml/github-ioprocessor.ts";

const chart = await Bun.file(new URL("../charts/github-issues.scxml", import.meta.url)).text();
const domParser = new new Window().DOMParser() as unknown as { parseFromString(s: string, t: string): Document };
const REPO = "acme/widgets";

/**
 * Lets everything settle: statechart work runs on the virtual clock (so
 * backoff delays are instant), the fake GitHub replies on promise microtasks.
 */
async function settle(clock: VirtualClock) {
  for (let i = 0; i < 50; i++) {
    clock.run();
    await Promise.resolve();
  }
}

async function setup(data: Record<string, unknown> = {}) {
  const clock = new VirtualClock();
  const gh = new FakeGitHub();
  const github = new GitHubIOProcessor(gh);
  const s = await createSession(chart, { clock, domParser, ioprocessors: [github], data: { backoffMs: 1000, ...data } });
  const origins: string[] = [];
  s.addEventListener("microstep", (e) => {
    if (e.event?.name.startsWith("github.")) origins.push(e.event.origintype!);
  });
  s.start();
  await settle(clock);
  const openIssue = async (author: string, title = "bug") => {
    const issue = gh.open(REPO, author, title);
    github.receiveWebhook("issues", issuesWebhook("opened", REPO, issue.number, author, title));
    await settle(clock);
    return issue;
  };
  const send = async (name: string, data?: unknown) => {
    s.send(name, data);
    await settle(clock);
  };
  return { clock, gh, github, s, openIssue, send, origins };
}

const leaf = (s: Session) => s.configuration.filter((n) => n.children.length === 0).map((n) => n.id);

describe("github issue gatekeeper", () => {
  test("starts idle with the allowlist from the datamodel", async () => {
    const { s } = await setup();
    expect(s.activeStateIds()).toEqual(["gatekeeper", "ready", "idle"]);
    expect(s.snapshot().allowlist).toEqual(["dhamidi", "octocat"]);
    expect(s.datamodel.evaluate("Object.keys(_ioprocessors)")).toContain(GITHUB_IOPROCESSOR);
  });

  test("keeps issues from allowlisted authors open", async () => {
    const { s, gh, openIssue, origins } = await setup();
    const issue = await openIssue("octocat");
    expect(leaf(s)).toEqual(["kept"]);
    expect(issue.state).toBe("open");
    expect(issue.labels).toEqual(["triage"]);
    expect(origins).toEqual([GITHUB_IOPROCESSOR]);
    expect(gh.calls.map((c) => c.verb)).toEqual(["addLabels"]);
  });

  test("comments, labels (in parallel) and closes everybody else", async () => {
    const { s, gh, github, clock } = await setup();
    const issue = gh.open(REPO, "mallory", "spam");
    github.receiveWebhook("issues", issuesWebhook("opened", REPO, issue.number, "mallory"));
    clock.run(); // the statechart reacts; GitHub hasn't answered yet
    expect(s.activeStateIds()).toEqual(["gatekeeper", "rejecting", "commenting", "postingComment", "labelling", "postingLabel"]);
    await settle(clock);
    expect(leaf(s)).toEqual(["closed"]);
    expect(issue).toMatchObject({ state: "closed", stateReason: "not_planned", labels: ["auto-closed"] });
    expect(issue.comments[0]).toContain("closed automatically");
    expect(gh.calls.map((c) => c.verb).sort()).toEqual(["addLabels", "close", "comment"]);
  });

  test("retries closing with backoff, then gives up", async () => {
    const { s, gh, openIssue, clock } = await setup();
    gh.failNext("close", 1);
    const a = await openIssue("mallory");
    expect(leaf(s)).toEqual(["closed"]);
    expect(a.state).toBe("closed");
    expect(s.snapshot().attempts).toBe(2);
    expect(clock.now()).toBe(1000); // one backoff of backoffMs × 1

    gh.failNext("close", 3);
    const b = await openIssue("eve");
    expect(leaf(s)).toEqual(["failed"]);
    expect(b.state).toBe("open");
    expect(s.snapshot().attempts).toBe(3);
  });

  test("allowlist edits via events change the outcome", async () => {
    const { s, openIssue, send } = await setup();
    await send("allowlist.add", { login: "mallory" });
    expect(s.snapshot().allowlist).toContain("mallory");
    await openIssue("mallory");
    expect(leaf(s)).toEqual(["kept"]);
    await send("allowlist.remove", { login: "mallory" });
    await openIssue("mallory");
    expect(leaf(s)).toEqual(["closed"]);
  });

  test("issues that arrive while another is handled are queued and handled in order", async () => {
    const { s, gh, github, clock } = await setup();
    const logs: string[] = [];
    s.addEventListener("log", (e) => logs.push(`${e.label}: ${e.value}`));
    const issues = [gh.open(REPO, "mallory", "one"), gh.open(REPO, "octocat", "two"), gh.open(REPO, "eve", "three")];
    // all three arrive before GitHub has answered anything for the first
    for (const i of issues) github.receiveWebhook("issues", issuesWebhook("opened", REPO, i.number, i.author, i.title));
    clock.run();
    expect(s.snapshot().queue).toHaveLength(2);
    await settle(clock);
    expect(issues.map((i) => i.state)).toEqual(["closed", "open", "closed"]);
    expect(issues[1]!.labels).toEqual(["triage"]);
    expect(s.snapshot().queue).toEqual([]);
    expect(logs.filter((l) => l.startsWith("triage:"))).toEqual(["triage: #1 by @mallory", "triage: #2 by @octocat", "triage: #3 by @eve"]);
    expect(leaf(s)).toEqual(["closed"]);
  });

  test("allowlist can be overridden by the host", async () => {
    const { s, openIssue } = await setup({ allowlist: ["mallory"] });
    await openIssue("octocat");
    expect(leaf(s)).toEqual(["closed"]);
  });
});

describe("gatekeeper system (session per issue)", () => {
  test("routes webhooks to one session per issue", async () => {
    const clock = new VirtualClock();
    const gh = new FakeGitHub();
    const lines: string[] = [];
    const gk = await Gatekeeper.create({ chart, backend: gh, domParser, clock, data: { backoffMs: 1 }, log: (l) => lines.push(l) });
    const one = gh.open(REPO, "dhamidi", "feature");
    const two = gh.open(REPO, "mallory", "spam");
    gk.webhook("issues", issuesWebhook("opened", REPO, one.number, "dhamidi"));
    gk.webhook("issues", issuesWebhook("opened", REPO, two.number, "mallory"));
    await settle(clock);
    expect(gk.sessions.size).toBe(2);
    expect(leaf(gk.sessions.get(`${REPO}#1`)!)).toEqual(["kept"]);
    expect(leaf(gk.sessions.get(`${REPO}#2`)!)).toEqual(["closed"]);

    // a reopened issue by a non-maintainer is closed again, by the same session
    await gh.reopen(REPO, 2);
    gk.webhook("issues", issuesWebhook("reopened", REPO, 2, "mallory"));
    await settle(clock);
    expect(gk.sessions.size).toBe(2);
    expect(two.state).toBe("closed");
    expect(lines.filter((l) => l.includes("closed: #2"))).toHaveLength(2);
    expect(gk.webhook("push", {})).toBe(false);
  });
});

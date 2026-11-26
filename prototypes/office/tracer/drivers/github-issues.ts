/**
 * The playground's webhook gatekeeper as the server runs it: one statechart session per issue
 * (sessions spawn as issues appear and live on), one GitHub I/O processor, a fake GitHub.
 * A realistic stream: maintainers' issues kept, others commented, labelled and closed, a close
 * that fails once (backoff, retry), one that fails three times (gives up), reopened issues closed
 * again, a burst of three at once, an allowlist edit.
 * Run: bun prototypes/office/tracer/drivers/github-issues.ts
 */
import { readFile } from "node:fs/promises";
import { VirtualClock } from "@tinyactors/scxmljs";
import { Window } from "happy-dom";
import { FakeGitHub } from "../../../../examples/playground/src/scxml/fake-github.ts";
import { Gatekeeper } from "../../../../examples/playground/src/scxml/gatekeeper.ts";
import { issuesWebhook } from "../../../../examples/playground/src/scxml/github-ioprocessor.ts";
import { createTracer, leadingComment } from "../tracer.ts";
import { clockDriver, writeTrace } from "./support.ts";

const file = new URL("../../../../examples/playground/charts/github-issues.scxml", import.meta.url);
const chart = await readFile(file, "utf8");
const clock = new VirtualClock();
const purpose = leadingComment(chart);
const tracer = createTracer({
  system: "github-issues",
  scenario: "issue-stream",
  clock,
  identify: (_s, info) => ({
    id: `issue-${info.sessionId.split("#")[1]}`,
    label: `issue #${info.sessionId.split("#")[1]}`,
    identity: info.sessionId,
    role: "one issue's gatekeeper",
    chart: "github-issue-gatekeeper",
    source: "github-issues.scxml",
    ...(purpose ? { purpose } : {}),
  }),
});
tracer.external("webhooks", { label: "GitHub webhooks (issue events)", kind: "network" });
tracer.external("maintainers", { label: "the maintainers (allowlist edits)", kind: "user" });
tracer.captureAll();
const gh = new FakeGitHub();
const gk = await Gatekeeper.create({ chart, backend: gh, domParser: new (new Window().DOMParser)() as never, clock, data: { backoffMs: 800 }, log: () => {} });
const REPO = "acme/widgets";
const { wait } = clockDriver(clock, 20);
const open = (author: string, title: string) => {
  const issue = gh.open(REPO, author, title);
  tracer.as("webhooks", () => gk.webhook("issues", issuesWebhook("opened", REPO, issue.number, author, title)));
  return issue;
};
const reopen = async (n: number, author: string) => {
  await gh.reopen(REPO, n);
  tracer.as("webhooks", () => gk.webhook("issues", issuesWebhook("reopened", REPO, n, author)));
};

tracer.caption("A maintainer opens an issue: it is labelled triage and kept open.");
open("dhamidi", "Crash when the config file is empty");
await wait(1500);
tracer.caption("Somebody else opens one: comment and label in parallel, then close.");
open("mallory", "Buy cheap watches");
await wait(1500);
open("octocat", "Docs: typo in the README");
await wait(1200);
tracer.caption("GitHub fails the next close once: the issue's machine backs off and retries.");
gh.failNext("close", 1);
open("eve", "Please add dark mode");
await wait(3000);
tracer.caption("A burst: three issues arrive at once, each to its own machine.");
open("trent", "Feature request: export to CSV");
open("dhamidi", "Flaky test in CI");
open("walter", "Why is this closed?");
await wait(2500);
tracer.caption("Mallory reopens her issue: the same machine closes it again.");
await reopen(2, "mallory");
await wait(2000);
tracer.caption("GitHub is down for closes: three failures, the machine gives up.");
gh.failNext("close", 3);
const peggy = open("peggy", "Installation fails on Windows");
await wait(6000);
tracer.caption(`A maintainer adds peggy to issue #${peggy.number}'s allowlist, then she reopens it: it stays open.`);
const sp = gk.sessions.get(`${REPO}#${peggy.number}`);
if (sp) tracer.as("maintainers", () => sp.send("allowlist.add", { login: "peggy" }));
await wait(500);
await reopen(peggy.number, "peggy");
await wait(2000);
tracer.caption("A push event arrives: not an issue event, so no machine hears it.");
tracer.as("webhooks", () => gk.webhook("push", {}));
open("victor", "Support for Node 24");
await wait(3000);
console.log([...gk.sessions].map(([k, s]) => `${k}: ${s.activeStateIds().at(-1)}`).join(", "));
const trace = tracer.finish();
await writeTrace("github-issues", trace);
process.exit(0);

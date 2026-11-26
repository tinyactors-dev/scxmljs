/**
 * Pi Durable: tasks of every kind spawn and finish, then the process is killed mid-work and a new
 * process resumes every task from its checkpoint (all task actors die at once, then are reborn
 * with the same identity and incarnation 2), then a second crash during a checkout.
 * Run: bun prototypes/office/tracer/drivers/pi-durable.ts
 */
import { readFile } from "node:fs/promises";
import { createSession, VirtualClock } from "@tinyactors/scxmljs";
import { Window } from "happy-dom";
import { type Charts, DurableSystem } from "../../../../examples/pi-durable/src/system.ts";
import { createTracer } from "../tracer.ts";
import { clockDriver, writeTrace } from "./support.ts";

const names = ["harness", "generation", "tool", "compaction", "checkout", "payment", "reminder", "client"] as const;
const chart = (name: string) => readFile(new URL(`../../../../examples/pi-durable/charts/${name}.scxml`, import.meta.url), "utf8");
const charts = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await chart(n)]))) as unknown as Charts;
const fileOf = new Map<string, string>();
for (const n of names) fileOf.set((/<scxml[^>]*\bname="([^"]*)"/.exec(charts[n])?.[1] ?? n).split(" · ")[0]!, `${n}.scxml`);

const clock = new VirtualClock();
let process_ = 0;
const tracer = createTracer({
  system: "pi-durable",
  scenario: "tasks-crash-resume",
  clock,
  app: { id: "process", label: "the harness process (TypeScript): storage, scheduler, wire server", kind: "app" },
  appCause: "same-tick",
  // the process reacts to commits on its own timers: what it does within 60 ms follows the newest commit
  appCauseWindowMs: 60,
  identify: (_s, info) => {
    const base = info.name.split(" · ")[0]!;
    const source = fileOf.get(base);
    if (base === "harness") return { id: "harness", label: `harness (process ${process_})`, identity: "harness", role: `the harness (process ${process_})`, chart: "harness", ...(source ? { source } : {}) };
    if (base === "client") return { id: String(info.data.clientId), label: String(info.data.name), identity: `client ${info.data.clientId}`, role: "client (another machine)", chart: "client", ...(source ? { source } : {}) };
    const task = info.data.task as { id?: string; kind?: string; label?: string } | undefined;
    if (task?.id)
      return {
        id: `${task.id}-${slugify(task.label ?? task.kind ?? "")}`,
        label: `${task.kind} ${task.id}${task.label ? ` (${task.label})` : ""}`,
        identity: `task ${task.id}`,
        role: `${task.kind} task (process ${process_})`,
        chart: base,
        ...(source ? { source } : {}),
      };
    return undefined;
  },
  resolveOrigin: (alias, origin) => (alias === "wire" && origin === "harness" ? "process" : alias === "wire" && origin === "ui" ? "people" : undefined),
  // the wire's far end is the process's wire server
  externalFor: (alias) => (alias === "wire" ? "process" : undefined),
});
const slugify = (s: string) => s.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
tracer.external("process", { label: "the harness process (TypeScript): storage, scheduler, wire server", kind: "app" });
tracer.external("people", { label: "the people at the keyboards", kind: "user" });
tracer.external("durable", { label: "durable storage (commits)", kind: "storage" });
const engine = tracer.wrapEngine(createSession);

const { DOMParser } = new Window();
const settings = { compaction: { contextWindow: 900, reserveTokens: 150, backgroundTokens: 300, keepRecentTokens: 150 } };
const { until, wait } = clockDriver(clock, 20);
process_ = 1;
tracer.caption("Process 1 opens the storage: the harness reconciles, then resumes scheduling.");
const sys = await DurableSystem.create({ clock, engine: engine as never, charts, domParser: new DOMParser(), settings });
const live = (c = "you") => sys.clients.get(c)?.session.isActive("live") ?? false;
const entries = (conv = "c1") => sys.storage.transcript(conv);
const busy = (conv = "c1") => !!sys.storage.doc({ kind: "pi.live", fork: "initial", initial: () => ({}) as { run?: unknown } }, conv).run;
const lastAnswer = () => entries().findLast((e) => e.data.kind === "pi.assistant" && e.data.stopReason === "stop");
const tasks = () => [...sys.storage.tasks.values()];
const people = <T>(fn: () => T) => tracer.as("people", fn);
const ask = async (who: string, text: string, what: string, o: Record<string, unknown> = {}) => {
  const n = entries().filter((e) => e.data.kind === "pi.assistant" && e.data.stopReason === "stop").length;
  people(() => sys.type(who, text, o));
  await until(() => entries().filter((e) => e.data.kind === "pi.assistant" && e.data.stopReason === "stop").length > n && !busy(), what, 120_000);
};

tracer.caption("Ada's client attaches over the wire.");
await sys.addClient("you", "Ada");
await until(() => live(), "attach");
await wait(300);
tracer.caption("Ada asks for a reminder: a background app.reminder task starts its timer.");
await ask("you", "Remind me to stretch", "the reminder answer");
await wait(400);
tracer.caption("Ada asks what is in the repo: a generation, two tool calls, another generation.");
await ask("you", "What's in the repo?", "the repo answer");
await wait(400);
tracer.caption("Bo's client attaches too.");
await sys.addClient("bo", "Bo");
await until(() => live("bo"), "bo attach");
tracer.caption("Bo asks to check out with three cards; one declines, the checkout fails fast and the others refund.");
sys.bank.latency.set("mc-0009", 500);
await ask("bo", "Checkout with visa-4242, amex-0005 and mc-0009", "the failed checkout");
await wait(500);
tracer.caption("Ada asks why checkout is slow: bash starts running...");
people(() => sys.type("you", "Why is checkout slow?"));
await until(() => tasks().some((t) => t.label === "bash" && t.state.status === "running"), "bash", 60_000);
await wait(400);
tracer.caption("CRASH: process 1 is killed. Every task's actor and the harness die at once; storage survives.");
sys.kill();
await until(() => !live(), "the client to notice", 10_000);
await wait(1200);
process_ = 2;
tracer.caption("Process 2 opens the same storage: every unfinished task resumes from its checkpoint.");
await sys.start();
await until(() => live(), "reattach", 20_000);
await until(() => !!lastAnswer() && !busy(), "the resumed answer", 120_000);
await wait(500);
tracer.caption("More questions fill the context: a background compaction summarises older messages.");
for (const q of ["Tell me about durability", "And about tasks?", "What about storage?"]) await ask("you", q, q);
await until(() => tasks().some((t) => t.kind === "pi.compaction"), "a compaction", 60_000).catch(() => console.log("no compaction"));
await wait(800);
tracer.caption("Bo checks out with two good cards; the process crashes while the charges land.");
sys.bank.declines.clear();
people(() => sys.type("bo", "Checkout with visa-4242 and amex-0005"));
await until(() => tasks().filter((t) => t.kind === "shop.payment" && t.state.status !== "terminal").length === 2, "payments", 60_000);
await until(() => sys.bank.charges.size >= 2, "the charges to land", 60_000).catch(() => {});
tracer.caption("CRASH: process 2 is killed during the checkout.");
sys.kill();
await wait(1000);
process_ = 3;
tracer.caption("Process 3 resumes: the unsafe checkout call is reported interrupted, its payments refund.");
await sys.start();
await until(() => live(), "reattach 2", 20_000);
await until(() => !!lastAnswer() && !busy(), "the answer after the second crash", 120_000);
await until(() => entries().some((e) => e.data.kind === "pi.user" && String(e.data.text).startsWith("Reminder:")), "the reminder fires", 120_000).catch(() =>
  console.log("reminder did not fire"),
);
await wait(1000);
console.log(
  "tasks:",
  tasks()
    .map((t) => `${t.id}:${t.kind}:${t.state.status}`)
    .join(" "),
);
const trace = tracer.finish();
sys.dispose();
await writeTrace("pi-durable", trace);
process.exit(0);

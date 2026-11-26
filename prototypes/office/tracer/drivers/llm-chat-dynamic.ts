/**
 * llm-chat with churn: people and tool providers join and leave throughout the run, a provider
 * leaves while its tool call is pending (the provider-leaves scenario), a person goes offline and
 * back, a provider rejoins. 6–8 clients at peak.
 * Run: bun prototypes/office/tracer/drivers/llm-chat-dynamic.ts
 */
import { readFile } from "node:fs/promises";
import { createSession, VirtualClock } from "@tinyactors/scxmljs";
import { Window } from "happy-dom";
import { ChatSystem } from "../../../../examples/llm-chat/src/system.ts";
import type { PackageLoader } from "../../../../examples/llm-chat/src/tools/packages.ts";
import { createTracer } from "../tracer.ts";
import { clockDriver, writeTrace } from "./support.ts";

const ex = new URL("../../../../examples/llm-chat/", import.meta.url);
const chartFile = (p: string) => readFile(new URL(`charts/${p}`, ex), "utf8");
const charts = {
  host: await chartFile("host.scxml"),
  client: await chartFile("client.scxml"),
  workspace: await chartFile("workspace.scxml"),
  package: await chartFile("package.scxml"),
};
const sources = new Map<string, string>(Object.entries(charts).map(([k, v]) => [v, `${k}.scxml`]));
const clock = new VirtualClock();
const tracer = createTracer({
  system: "llm-chat-dynamic",
  scenario: "churn",
  clock,
  appCause: "same-tick",
  identify: (_s, info) => {
    if (typeof info.data.clientId === "string") return { id: info.data.clientId, label: String(info.data.name), role: `client (${info.data.kind})`, chart: "client", source: "client.scxml", identity: info.data.clientId };
    if (info.name.startsWith("scenario")) return { id: "director", label: `scenario ${info.name.replace(/^scenario-/, "")}`, role: "director", chart: "scenario" };
    if (info.invokeid) return { id: `package:${String(info.data.key ?? info.invokeid)}`, label: `package ${String(info.data.key ?? "")}`, role: "package download", chart: "package", source: "package.scxml" };
    return undefined;
  },
  // the chat log relays the host's log as broadcasts with origin "host"; the panels deliver with origin "ui"
  resolveOrigin: (alias, origin) => (alias === "bus" && origin === "host" ? "log" : alias === "bus" && origin === "ui" ? "people" : undefined),
});
tracer.external("people", { label: "the people at the keyboards", kind: "user" });
tracer.external("log", { label: "chat log", kind: "log" });
tracer.external("stage", { label: "the stage (scenario cues)", kind: "user" });
const engine = tracer.wrapEngine(createSession, (source) => {
  const file = sources.get(String(source));
  return file ? { chart: file.replace(".scxml", ""), source: file, ...(file === "host.scxml" ? { id: "host", label: "host" } : {}), ...(file === "workspace.scxml" ? { id: "workspace", label: "shared workspace" } : {}) } : undefined;
});

const { DOMParser } = new Window();
const parser = new DOMParser();
// package downloads finish on the virtual clock
const loader: PackageLoader = (key, { onProgress, signal }) =>
  new Promise<void>((resolve, reject) => {
    signal?.addEventListener("abort", () => reject(new Error("aborted")));
    let step = 0;
    const tick = () => {
      step++;
      onProgress?.({ id: key, label: key, approxBytes: 2e6, phase: step < 4 ? "downloading" : "ready", cached: false, shared: false, downloadedBytes: step * 5e5, totalBytes: 2e6, percent: step * 25 } as never);
      if (step < 4) clock.setTimeout(tick, 150);
      else resolve();
    };
    clock.setTimeout(tick, 150);
  });

tracer.caption("The chat starts: a host owns the conversation, a shared workspace serves tool packages.");
const system = await ChatSystem.create({ clock, engine: engine as never, charts, domParser: parser, packageLoader: loader });
system.addEventListener("note", (e) => tracer.caption((e as CustomEvent<string>).detail));
const { until, wait } = clockDriver(clock);
const live = (id: string) => system.clients.get(id)?.session.isActive("live") ?? false;
const idle = () => system.host.isActive("idle");
const turn = () => Number(system.host.datamodel.evaluate("turn"));
const people = <T>(fn: () => T) => tracer.as("people", fn);

tracer.caption("Ada opens the chat.");
await system.addClient("ada");
await until(() => live("ada"), "ada");
await wait(500);
tracer.caption("Bo joins as a second person.");
await system.addClient("bo");
await until(() => live("bo"), "bo");
await wait(500);

// the provider-leaves scenario: terminal and python join, Ada asks for both tools, python leaves mid-call
const director = await system.runScenario(await chartFile("scenarios/provider-leaves.scxml"));
await until(() => director.status === "done", "the provider-leaves scenario", 120_000);
await until(idle, "host idle");
await wait(800);

tracer.caption("Postgres and the Statechart Lab join as tool providers; a viewer joins to watch.");
await system.addClient("postgres");
await wait(300);
await system.addClient("lab");
await wait(300);
await system.addClient("viewer");
await until(() => live("postgres") && live("lab") && live("viewer"), "three joins");
await wait(600);
tracer.caption("Bo asks about the orders table: the model calls the sql tool on Postgres.");
people(() => system.type("bo", "How many orders are in the database table?"));
await until(() => !idle(), "turn starts", 5000);
await until(idle, "the sql turn", 60_000);
await wait(800);

tracer.caption("Python rejoins.");
await system.addClient("python");
await until(() => live("python"), "python back");
await wait(400);
tracer.caption("Ada asks for a statechart and a computation: the Lab and Python work in parallel.");
people(() => system.type("ada", "Run a small statechart for an order, and compute 2**32 in python."));
await until(() => !idle(), "turn starts", 5000);
await wait(700);
tracer.caption("Bo's connection drops while the tools run.");
people(() => system.setOnline("bo", false));
await until(idle, "the lab+python turn", 60_000);
await wait(1200);
tracer.caption("Bo comes back online and resyncs what he missed.");
people(() => system.setOnline("bo", true));
await until(() => live("bo"), "bo resynced", 20_000);
await wait(800);

tracer.caption("The viewer and the terminal leave.");
people(() => system.removeClient("viewer"));
await wait(500);
people(() => system.removeClient("terminal"));
await wait(800);
tracer.caption("Ada asks about the workspace files, but nobody provides the shell any more.");
people(() => system.type("ada", "How many files are in the workspace?"));
await until(() => !idle(), "turn starts", 5000);
await until(idle, "a turn without the shell", 60_000);
await wait(600);
tracer.caption("Postgres goes offline while Bo asks about orders: the call waits, then Postgres comes back.");
people(() => system.setOnline("postgres", false));
await wait(200);
people(() => system.type("bo", "What is the total of all orders?"));
await until(() => !idle(), "turn starts", 5000);
await wait(2500);
people(() => system.setOnline("postgres", true));
await until(idle, "the postgres turn", 90_000);
await wait(800);
tracer.caption("The Lab and Python leave; Ada and Bo stay.");
people(() => system.removeClient("lab"));
await wait(400);
people(() => system.removeClient("python"));
await wait(1500);
console.log(`turns: ${turn()}`);

const trace = tracer.finish();
system.dispose();
await writeTrace("llm-chat-dynamic", trace);
process.exit(0);

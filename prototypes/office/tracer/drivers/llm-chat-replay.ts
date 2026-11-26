/**
 * REPRODUCTION CHECK (not a data/ trace): the one-off recorder's run of llm-chat (prototypes/viz3d/data/record.ts:
 * the queue-and-steer scenario, then its epilogue), recorded with the generic tracer and written to
 * tracer/out/llm-chat-generic.json, to compare with data/llm-chat/trace.json (which this never overwrites).
 * Was: llm-chat with churn: people and tool providers join and leave throughout the run, a provider
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
import { clockDriver } from "./support.ts";

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
  system: "llm-chat",
  scenario: "queue-and-steer",
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

tracer.caption("The chat system starts: a host chart owns the conversation, a shared workspace serves tool packages.");
const system = await ChatSystem.create({ clock, engine: engine as never, charts, domParser: parser, packageLoader: loader });
system.addEventListener("note", (e) => tracer.caption((e as CustomEvent<string>).detail));
const { until, wait } = clockDriver(clock);
const live = (id: string) => system.clients.get(id)?.session.isActive("live") ?? false;
const people = <T>(fn: () => T) => tracer.as("people", fn);
await system.addClient("ada");
await until(() => live("ada"), "ada");
const director = await system.runScenario(await chartFile("scenarios/queue-and-steer.scxml"));
await until(() => director.status === "done", "the scenario", 120_000);
await wait(1000);
await system.addClient("python");
await until(() => live("python"), "python");
await wait(300);
people(() => system.type("ada", "How many files are in the workspace? And use python to compute 2**64."));
await until(() => system.host.isActive("idle") && Number(system.host.datamodel.evaluate("turn")) >= 3, "the parallel-tools turn", 60_000);
await wait(1000);
people(() => system.setOnline("bo", false));
await wait(1500);
people(() => system.setOnline("bo", true));
await until(() => live("bo"), "bo back", 20_000);
await wait(800);
people(() => system.removeClient("terminal"));
await wait(2000);
const trace = tracer.finish();
system.dispose();
const { mkdir, writeFile } = await import("node:fs/promises");
const out = new URL("../out/", import.meta.url);
await mkdir(out, { recursive: true });
await writeFile(new URL("llm-chat-generic.json", out), JSON.stringify(trace));
console.log(`wrote out/llm-chat-generic.json: ${trace.events.length} events, ${trace.actors.length} actors, ${trace.duration} ms`);
process.exit(0);

/**
 * Pi Durable's tour chapters (charts/tour/*.scxml), each as its own trace: a fresh world with the
 * chapter's settings, its director chart driving the system through the `stage` processor and
 * captioning each step (the captions become trace captions). Writes data/pi-durable-tour-<id>/.
 * Run: bun prototypes/office/tracer/drivers/pi-durable-tour.ts [chapter-id ...]   (default: crashes tasks multiplayer)
 */
import { readFile } from "node:fs/promises";
import { createSession, VirtualClock } from "@tinyactors/scxmljs";
import { Window } from "happy-dom";
import { type Charts, DurableSystem, type Note } from "../../../../examples/pi-durable/src/system.ts";
import { CHAPTERS } from "../../../../examples/pi-durable/src/tour.ts";
import { createTracer, leadingComment } from "../tracer.ts";
import { clockDriver, writeTrace } from "./support.ts";

const names = ["harness", "generation", "tool", "compaction", "checkout", "payment", "reminder", "client"] as const;
const dir = new URL("../../../../examples/pi-durable/charts/", import.meta.url);
const read = (p: string) => readFile(new URL(p, dir), "utf8");
const charts = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await read(`${n}.scxml`)]))) as unknown as Charts;
const fileOf = new Map<string, string>();
for (const n of names) fileOf.set((/<scxml[^>]*\bname="([^"]*)"/.exec(charts[n])?.[1] ?? n).split(" · ")[0]!, `${n}.scxml`);
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ["crashes", "tasks", "multiplayer"];

for (const chapter of CHAPTERS.filter((c) => wanted.includes(c.id))) {
  const clock = new VirtualClock();
  let proc = 1;
  const tourSrc = await read(`tour/${chapter.file}.scxml`);
  const tracer = createTracer({
    system: `pi-durable-tour-${chapter.id}`,
    scenario: chapter.title,
    clock,
    appCause: "same-tick",
  // the process reacts to commits on its own timers: what it does within 60 ms follows the newest commit
  appCauseWindowMs: 60,
    app: { id: "process", label: "the harness process (TypeScript): storage, scheduler, wire server", kind: "app" },
    identify: (_s, info) => {
      const base = info.name.split(" · ")[0]!;
      const source = fileOf.get(base);
      if (base === "tour") return { id: "director", label: `tour: ${chapter.title}`, role: "director", chart: "tour", source: `tour/${chapter.file}.scxml`, purpose: leadingComment(tourSrc) ?? chapter.blurb };
      if (base === "harness") return { id: "harness", label: `harness (process ${proc})`, identity: "harness", role: `the harness (process ${proc})`, chart: "harness", ...(source ? { source } : {}) };
      if (base === "client") return { id: String(info.data.clientId), label: String(info.data.name), identity: `client ${info.data.clientId}`, role: "client (another machine)", chart: "client", ...(source ? { source } : {}) };
      const task = info.data.task as { id?: string; kind?: string; label?: string } | undefined;
      if (task?.id)
        return {
          id: `${task.id}-${(task.label ?? task.kind ?? "").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 24)}`,
          label: `${task.kind} ${task.id}${task.label ? ` (${task.label})` : ""}`,
          identity: `task ${task.id}`,
          role: `${task.kind} task (process ${proc})`,
          chart: base,
          ...(source ? { source } : {}),
        };
      return undefined;
    },
    resolveOrigin: (alias, origin) => (alias === "wire" && origin === "harness" ? "process" : alias === "wire" && origin === "ui" ? "people" : alias === "stage" ? "stage" : undefined),
    externalFor: (alias) => (alias === "wire" ? "process" : undefined),
  });
  tracer.external("people", { label: "the people at the keyboards", kind: "user" });
  tracer.external("durable", { label: "durable storage (commits)", kind: "storage" });
  tracer.external("stage", { label: "the stage (the tour's cues and actions)", kind: "user" });
  const engine = tracer.wrapEngine(createSession);
  const sys = await DurableSystem.create({
    clock,
    engine: engine as never,
    charts,
    domParser: new (new Window().DOMParser)() as never,
    ...(chapter.settings ? { settings: chapter.settings } : {}),
    ...(chapter.rootAgent ? { rootAgent: chapter.rootAgent } : {}),
  });
  sys.addEventListener("note", (e) => tracer.caption((e as CustomEvent<Note>).detail.text));
  sys.addEventListener("process", () => {
    if (!sys.up) proc++;
  });
  const { until, wait } = clockDriver(clock, 20);
  const director = await sys.runScenario(tourSrc);
  await until(() => director.activeStateIds().length === 0, `${chapter.id} to finish`, 240_000).catch((e) => console.log(String(e)));
  const busy = (conv: string) => !!sys.storage.doc({ kind: "pi.live", fork: "initial", initial: () => ({}) as { run?: unknown } }, conv).run;
  await until(() => [...sys.storage.conversations.keys()].every((c) => !busy(c)), "everything to settle", 60_000).catch(() => {});
  await wait(1000);
  const trace = tracer.finish();
  sys.dispose();
  await writeTrace(`pi-durable-tour-${chapter.id}`, trace);
}
process.exit(0);

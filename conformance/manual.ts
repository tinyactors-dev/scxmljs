/**
 * The W3C tests marked "manual": a person has to read the output to decide.
 * This runs each one in both data models and records everything a reader
 * needs: every log line and error (the root session and invoked children),
 * every event processed, and how the session ended. The verdicts, read once
 * against each test's own instructions, are in MANUAL.md; the ones that can
 * be checked mechanically are asserted in conformance.test.ts.
 *
 *   bun conformance/manual.ts            # all manual tests, both data models
 *   bun conformance/manual.ts 230 --trusted
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Window } from "happy-dom";
import { createSession, type SCXMLSession, VirtualClock } from "../packages/scxmljs/src/index.ts";
import * as trustedEntry from "../packages/scxmljs/src/trusted.ts";
import { manifest } from "./harness.ts";

const here = import.meta.dir;
const window = new Window();
const domParser = new window.DOMParser() as unknown as { parseFromString(s: string, t: string): Document };

export interface ManualTrace {
  /** "rejected" when the document was refused at load time */
  status: "done" | "running" | "rejected";
  /** `<log>` output and errors, in order, prefixed with the session ("root", or the invokeid) */
  lines: string[];
  /** event names processed by the root session, in order */
  events: string[];
  /** `_event.data` of every event the root session processed, in order */
  payloads: { name: string; data: unknown }[];
  /** the root's configuration when the run ended (or the final state it reached) */
  ended: string[];
  error?: string;
}

/** Run one manual test for up to 60 virtual seconds and trace it. */
export async function traceManual(id: string, trusted: boolean): Promise<ManualTrace> {
  const entry = manifest.find((e) => e.id === id && e.manual);
  if (!entry) throw new Error(`no manual test ${id}`);
  const path = join(here, entry.file);
  if (!path.endsWith(".scxml"))
    return { status: "rejected", lines: [], events: [], payloads: [], ended: [], error: "not an SCXML document" };
  const create = trusted ? trustedEntry.createSession : createSession;
  const clock = new VirtualClock();
  const loader = (src: string) => readFileSync(join(dirname(path), src.replace(/^file:/, "")), "utf8");
  const trace: ManualTrace = { status: "running", lines: [], events: [], payloads: [], ended: [] };
  let session: SCXMLSession;
  try {
    session = await create(readFileSync(path, "utf8"), { clock, loader, domParser, scriptTimeoutMs: 1000 });
  } catch (e) {
    return { ...trace, status: "rejected", error: e instanceof Error ? e.message : String(e) };
  }
  const watch = (s: SCXMLSession, who: string) => {
    s.addEventListener("log", (e) => trace.lines.push(`${who} log ${e.label}${JSON.stringify(e.value) ?? "undefined"}`));
    s.addEventListener("error", (e) => trace.lines.push(`${who} ${e.kind}: ${e.message}`));
    s.addEventListener("child", (e) => watch(e.child, e.invokeid));
  };
  watch(session, "root");
  let lastFinal: string[] = [];
  session.addEventListener("microstep", (e) => {
    if (e.event && !trace.events.includes(e.event.name)) trace.events.push(e.event.name);
    const finals = e.entered.filter((s) => s.kind === "final" && s.parent?.kind === "scxml");
    if (finals.length) lastFinal = finals.map((s) => s.id);
  });
  session.addEventListener("macrostep", (e) => {
    if (!e.event) return;
    if (!trace.events.includes(e.event.name)) trace.events.push(e.event.name);
    trace.payloads.push({ name: e.event.name, data: e.event.data });
  });
  session.start();
  for (let i = 0; i < 1000 && !clock.idle && clock.now() < 60_000; i++) {
    clock.run(clock.now() + 60_000);
    await Promise.resolve();
  }
  trace.status = session.status === "done" ? "done" : "running";
  trace.ended = session.status === "done" ? lastFinal : session.activeStateIds();
  session.dispose();
  return trace;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const only = args.filter((a) => !a.startsWith("--"));
  const modes = args.includes("--trusted") ? [true] : args.includes("--sandboxed") ? [false] : [false, true];
  for (const entry of manifest.filter((e) => e.manual && (!only.length || only.includes(e.id)))) {
    for (const trusted of modes) {
      const t = await traceManual(entry.id, trusted);
      console.log(`\n== ${entry.id} [${trusted ? "trusted" : "sandboxed"}] ${t.status}${t.ended.length ? ` in [${t.ended}]` : ""}`);
      console.log(`   ${entry.description.slice(0, 160)}`);
      if (t.error) console.log(`   error: ${t.error.split("\n").join(" / ")}`);
      if (t.events.length) console.log(`   events: ${t.events.join(", ")}`);
      for (const l of t.lines) console.log(`   · ${l}`);
    }
  }
}

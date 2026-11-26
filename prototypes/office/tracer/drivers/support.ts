/** What the drivers share: driving a VirtualClock, writing a trace. */
import { mkdir, rename, writeFile } from "node:fs/promises";
import type { VirtualClock } from "@tinyactors/scxmljs";
import type { Trace } from "../tracer.ts";

const tick = () => new Promise((r) => setImmediate(r));

/** Advance the clock in small steps, letting promises settle between them. */
export function clockDriver(clock: VirtualClock, step = 10) {
  async function until(done: () => boolean, what: string, maxMs = 60_000) {
    const end = clock.now() + maxMs;
    await tick();
    while (!done()) {
      if (clock.now() >= end) throw new Error(`timed out waiting for ${what} at ${clock.now()} ms`);
      clock.advance(step);
      await tick();
      await tick();
    }
  }
  async function wait(ms: number) {
    const end = clock.now() + ms;
    await tick();
    while (clock.now() < end) {
      clock.advance(Math.min(step, end - clock.now()));
      await tick();
      await tick();
    }
  }
  return { until, wait };
}

/** Writes data/<system>/trace.json atomically; prints its size. */
export async function writeTrace(system: string, trace: Trace) {
  const dir = new URL(`../../data/${system}/`, import.meta.url);
  await mkdir(dir, { recursive: true });
  const path = new URL("trace.json", dir).pathname;
  const text = JSON.stringify(trace);
  await writeFile(`${path}.tmp`, text);
  await rename(`${path}.tmp`, path);
  const peak = peakAlive(trace);
  console.log(
    `wrote ${path}: ${(text.length / 1e6).toFixed(2)} MB, ${trace.events.length} events, ${trace.actors.length} actors (peak ${peak}), ${trace.duration} ms`,
  );
}

export function peakAlive(trace: Trace) {
  let alive = 0;
  let peak = 0;
  for (const e of trace.events) {
    if (e.type === "spawn") peak = Math.max(peak, ++alive);
    if (e.type === "end") alive--;
  }
  return peak;
}

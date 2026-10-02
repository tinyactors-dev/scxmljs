import { readFile } from "node:fs/promises";
import { createSession, VirtualClock } from "@tinyactors/scxmljs";
import { Window } from "happy-dom";
import { type Charts, DurableSystem, type SystemOptions } from "../src/system.ts";

const chart = (name: string) => readFile(new URL(`../charts/${name}.scxml`, import.meta.url), "utf8");
export const charts: Charts = {
  harness: await chart("harness"),
  generation: await chart("generation"),
  tool: await chart("tool"),
  compaction: await chart("compaction"),
  checkout: await chart("checkout"),
  payment: await chart("payment"),
  reminder: await chart("reminder"),
  client: await chart("client"),
};
export const tour = (name: string) => readFile(new URL(`../charts/tour/${name}.scxml`, import.meta.url), "utf8");

const { DOMParser } = new Window();
export let clock: VirtualClock;
export let system: DurableSystem;

export async function boot(o: Partial<SystemOptions> = {}): Promise<DurableSystem> {
  clock = new VirtualClock();
  system = await DurableSystem.create({ clock, engine: createSession, charts, domParser: new DOMParser(), ...o });
  return system;
}

const tick = () => new Promise((r) => setImmediate(r));

/** Advance the clock in small steps (letting promises settle) until `done()`. */
export async function until(done: () => boolean, what: string, maxMs = 120_000): Promise<void> {
  const end = clock.now() + maxMs;
  await tick();
  while (!done()) {
    if (clock.now() >= end) throw new Error(`timed out waiting for ${what} at ${clock.now()} ms`);
    clock.advance(20);
    await tick();
    await tick();
  }
}

export async function run(ms: number): Promise<void> {
  const end = clock.now() + ms;
  while (clock.now() < end) {
    clock.advance(20);
    await tick();
    await tick();
  }
}

export const tasks = () => [...system.storage.tasks.values()];
export const entries = (conv = "c1") => system.storage.transcript(conv);
export const kinds = (conv = "c1") => entries(conv).map((e) => e.data.kind);
export const busy = (conv = "c1") =>
  !!system.storage.doc({ kind: "pi.live", fork: "initial", initial: () => ({}) as { run?: unknown } }, conv).run;
export const lastAnswer = (conv = "c1") => entries(conv).findLast((e) => e.data.kind === "pi.assistant" && e.data.stopReason === "stop");
export const live = (client = "you") => system.clients.get(client)?.session.isActive("live") ?? false;

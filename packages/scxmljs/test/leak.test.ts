/**
 * Memory regression tests: creating and disposing sessions must not grow
 * memory. Warm up first (allocators, JITs and compilation caches reach a
 * steady state), then measure the growth per session over many cycles.
 *
 * Before the phase-5 fix, trusted sessions grew the heap by ~1.5 KB each
 * under Bun (~6.6 KB under Node): every session compiled a unique prelude
 * (its session id inlined), which the engine's compilation cache kept.
 * The bench (`mise run bench`) runs the full 1,000-cycle version in both runtimes.
 */
import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { quickJSModule } from "../src/datamodel-quickjs.ts";
import { compile, loadQuickJS, parseSCXML, Session as SandboxedSession, VirtualClock } from "../src/index.ts";
import { Session as TrustedSession } from "../src/trusted.ts";

const parser = new new Window().DOMParser() as unknown as { parseFromString(s: string, t: string): Document };
const NS = `xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript"`;
const model = await compile(
  parseSCXML(
    `<scxml ${NS}><datamodel><data id="n" expr="0"/></datamodel>
      <state id="a"><transition event="go" target="b"><assign location="n" expr="n + 1"/></transition></state>
      <state id="b"/></scxml>`,
    parser,
  ),
);

function growthPerSession(make: () => { start(): unknown; send(n: string): void; dispose(): void }, clock: VirtualClock, extra = () => 0) {
  const cycle = () => {
    const s = make();
    s.start();
    s.send("go");
    clock.run();
    s.dispose();
  };
  for (let i = 0; i < 300; i++) cycle();
  Bun.gc(true);
  const before = process.memoryUsage().heapUsed + extra();
  const n = 1500;
  for (let i = 0; i < n; i++) cycle();
  Bun.gc(true);
  return (process.memoryUsage().heapUsed + extra() - before) / n;
}

test("trusted sessions: create/start/dispose doesn't grow the heap", () => {
  const clock = new VirtualClock();
  const bytes = growthPerSession(() => new TrustedSession(model, { clock }), clock);
  expect(bytes).toBeLessThan(750); // was ~1,500 before the fix; ~50 after
});

test("sandboxed sessions: create/start/dispose doesn't grow the heap or QuickJS memory", async () => {
  await loadQuickJS();
  const clock = new VirtualClock();
  const wasm = () => quickJSModule().getWasmMemory().buffer.byteLength;
  const bytes = growthPerSession(() => new SandboxedSession(model, { clock }), clock, wasm);
  expect(bytes).toBeLessThan(750);
});

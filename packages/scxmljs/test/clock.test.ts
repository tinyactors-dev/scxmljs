import { expect, test } from "bun:test";
import { PlaybackClock, VirtualClock } from "../src/index.ts";

test("runNext runs one task at a time, deferred work first", () => {
  const c = new VirtualClock();
  const log: string[] = [];
  c.setTimeout(() => log.push("t100"), 100);
  c.setTimeout(() => log.push("t50"), 50);
  c.defer(() => log.push("d"));
  expect(c.pending).toBe(3);
  expect(c.nextTimerAt).toBe(50);
  c.runNext();
  expect(log).toEqual(["d"]);
  c.runNext();
  expect([log, c.now()]).toEqual([["d", "t50"], 50]);
  c.runNext();
  expect(c.runNext()).toBe(false);
  expect(log).toEqual(["d", "t50", "t100"]);
});

test("PlaybackClock: paused time stands still; step runs until the condition holds", () => {
  const c = new PlaybackClock({ playing: false });
  const log: number[] = [];
  for (const ms of [10, 20, 30]) c.setTimeout(() => log.push(ms), ms);
  expect(c.playing).toBe(false);
  expect(c.step(() => log.length === 2)).toBe(2);
  expect([log, c.now()]).toEqual([[10, 20], 20]);
  c.dispose();
});

test("PlaybackClock plays at the chosen speed", async () => {
  const c = new PlaybackClock({ speed: 4 });
  const start = performance.now();
  let fired = 0;
  c.setTimeout(() => (fired = performance.now() - start), 200);
  await Bun.sleep(120);
  c.dispose();
  expect(fired).toBeGreaterThan(0);
  expect(fired).toBeLessThan(150); // 200 virtual ms at 4× ≈ 50 real ms
});

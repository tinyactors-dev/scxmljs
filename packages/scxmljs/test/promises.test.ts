import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createSession, type MacrostepEvent, realClock, type SessionOptions, VirtualClock } from "../src/index.ts";

const domParser = new new Window().DOMParser() as unknown as { parseFromString(s: string, t: string): Document };
const doc = (body: string) => `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript">${body}</scxml>`;

async function make(body: string, opts: SessionOptions = {}) {
  const clock = new VirtualClock();
  const s = await createSession(doc(body), { clock, domParser, ...opts });
  return { s, clock };
}

const TWO_STEPS = `
  <state id="a"><transition event="go" target="b"/></state>
  <state id="b"><transition event="go" target="c"/></state>
  <final id="c"><donedata><content expr="'bye'"/></donedata></final>`;

describe("done", () => {
  test("resolves with the top-level final's donedata", async () => {
    const { s, clock } = await make(TWO_STEPS);
    s.start();
    s.send("go");
    s.send("go");
    clock.run();
    expect(await s.done).toBe("bye");
    expect(s.cancelled).toBe(false);
  });

  test("resolves with undefined when cancelled, and when disposed before starting", async () => {
    const a = await make(TWO_STEPS);
    a.s.start();
    a.s.cancel();
    expect(await a.s.done).toBeUndefined();
    expect(a.s.cancelled).toBe(true);

    const b = await make(TWO_STEPS);
    b.s.dispose(); // never started
    expect(await b.s.done).toBeUndefined();
  });
});

describe("settled", () => {
  test("resolves immediately when idle, and only after clock.run() with a VirtualClock", async () => {
    const { s, clock } = await make(TWO_STEPS);
    await s.settled(); // not started: idle
    s.start();
    await s.settled();
    s.send("go");
    let settled = false;
    const p = s.settled().then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false); // nothing runs until the host drives the clock
    clock.run();
    await p;
    expect(s.activeStateIds()).toEqual(["b"]);
  });

  test("does not wait for delayed sends", async () => {
    const { s, clock } = await make(`
      <state id="a"><onentry><send event="later" delay="10s"/></onentry><transition event="later" target="b"/></state>
      <state id="b"/>`);
    s.start();
    await s.settled();
    expect(s.activeStateIds()).toEqual(["a"]);
    clock.run();
    expect(s.activeStateIds()).toEqual(["b"]);
  });

  test("works on the real clock", async () => {
    const s = await createSession(doc(TWO_STEPS), { clock: realClock, domParser });
    s.start();
    s.send("go");
    await s.settled();
    expect(s.activeStateIds()).toEqual(["b"]);
    s.dispose();
  });
});

describe("waitFor", () => {
  test("resolves immediately when the condition already holds", async () => {
    const { s } = await make(TWO_STEPS);
    s.start();
    expect((await s.waitFor("a")).map((n) => n.id)).toEqual(["a"]);
  });

  test("resolves at the first macrostep where state ids / predicates hold", async () => {
    const { s, clock } = await make(`
      <parallel id="p">
        <state id="x"><state id="x1"><transition event="go" target="x2"/></state><state id="x2"/></state>
        <state id="y"/>
      </parallel>`);
    s.start();
    const both = s.waitFor(["x2", "y"]);
    const pred = s.waitFor((session) => session.isActive("x2"));
    s.send("go");
    clock.run();
    expect((await both).map((n) => n.id)).toEqual(["p", "x", "x2", "y"]);
    expect((await pred).map((n) => n.id)).toContain("x2");
  });

  test("sees top-level final states, which are cleared right after", async () => {
    const { s, clock } = await make(TWO_STEPS);
    s.start();
    const final = s.waitFor("c");
    s.send("go");
    s.send("go");
    clock.run();
    expect((await final).map((n) => n.id)).toEqual(["c"]);
    expect(s.activeStateIds()).toEqual([]);
  });

  test("times out on the session's clock", async () => {
    const { s, clock } = await make(TWO_STEPS);
    s.start();
    const p = s.waitFor("c", { timeoutMs: 5000 });
    clock.advance(4999);
    clock.advance(1);
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(DOMException);
    expect(err.name).toBe("TimeoutError");
    expect(clock.idle).toBe(true); // timer cleaned up
  });

  test("rejects on abort and when the session ends first", async () => {
    const { s, clock } = await make(TWO_STEPS);
    s.start();
    const ac = new AbortController();
    const aborted = s.waitFor("c", { signal: ac.signal });
    ac.abort(new Error("stop"));
    expect((await aborted.catch((e) => e)).message).toBe("stop");

    const never = s.waitFor("nope");
    s.send("go");
    s.send("go");
    clock.run();
    expect((await never.catch((e) => e)).message).toContain("terminated before [nope] held");
  });

  test("a throwing predicate rejects", async () => {
    const { s } = await make(TWO_STEPS);
    s.start();
    const err = await s
      .waitFor(() => {
        throw new Error("boom");
      })
      .catch((e) => e);
    expect(err.message).toBe("boom");
  });
});

describe("steps", () => {
  test("iterates macrosteps (buffered) and ends when the session terminates", async () => {
    const { s, clock } = await make(TWO_STEPS);
    const seen: string[][] = [];
    const consumer = (async () => {
      for await (const step of s.steps()) seen.push(step.configuration.map((n) => n.id));
    })();
    s.start();
    s.send("go");
    s.send("go");
    clock.run(); // all steps happen before the consumer gets to run: nothing is lost
    await consumer;
    expect(seen[0]).toEqual(["a"]);
    expect(seen[1]).toEqual(["b"]);
  });

  test("stops on its own signal, and break releases the listener", async () => {
    const { s, clock } = await make(TWO_STEPS);
    s.start();
    const ac = new AbortController();
    const steps: MacrostepEvent[] = [];
    const consumer = (async () => {
      for await (const step of s.steps({ signal: ac.signal })) steps.push(step);
    })();
    s.send("go");
    clock.run();
    await Promise.resolve();
    ac.abort();
    await consumer;
    expect(steps.map((e) => e.event?.name)).toEqual(["go"]);

    const it = s.steps();
    await it.return!(); // what `break` calls: releases the listener
    expect((await it.next()).done).toBe(true);
  });
});

/**
 * How a session ends, as its listeners see it: the last macrostep comes before `done`, with the
 * configuration the session ended in, and nothing follows `done`; a `dispose()` from a macrostep
 * listener ends the session cleanly; a session disposed before it started dispatches `done` too.
 */
import { describe, expect, test } from "bun:test";
import type { SCXMLSession, SessionOptions } from "../src/index.ts";
import * as sandboxed from "../src/index.ts";
import * as trusted from "../src/trusted.ts";

const doc = (body: string) => `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript">${body}</scxml>`;

/** The session's step and end events, in order. */
function record(s: SCXMLSession) {
  const log: string[] = [];
  s.addEventListener("microstep", (e) => log.push(`microstep:${e.event?.name ?? ""}`));
  s.addEventListener("macrostep", () => log.push("macrostep"));
  s.addEventListener("log", (e) => log.push(`log:${e.label}`));
  s.addEventListener("done", () => log.push("done"));
  return log;
}

const ORDER = doc(`
  <state id="paying">
    <transition event="payment.ok" target="paid"><raise event="receipt"/></transition>
  </state>
  <state id="paid"><transition event="receipt" target="shipped"/></state>
  <final id="shipped"><onexit><log label="closed"/></onexit></final>`);

for (const [name, entry] of [
  ["sandboxed", sandboxed],
  ["trusted", trusted],
] as const) {
  const make = (source: string, opts: SessionOptions = {}) => {
    const clock = new sandboxed.VirtualClock();
    return entry.createSession(source, { clock, ...opts }).then((s) => ({ s, clock }));
  };

  describe(`how a session ends (${name})`, () => {
    test("the last macrostep comes before done, with the final configuration; nothing follows done", async () => {
      const { s, clock } = await make(ORDER);
      const log = record(s);
      let final: string[] = [];
      s.addEventListener("macrostep", (e) => {
        final = e.configuration.map((n) => n.id);
      });
      s.start();
      s.send("payment.ok");
      clock.run();
      s.send("refund");
      clock.run();
      expect(log).toEqual(["microstep:", "macrostep", "microstep:payment.ok", "microstep:receipt", "macrostep", "log:closed", "done"]);
      expect(final).toEqual(["shipped"]);

      // a chart that ends in its initial step
      const quick = await make(doc(`<final id="cancelled"/>`));
      const quickLog = record(quick.s);
      quick.s.start();
      expect(quickLog).toEqual(["microstep:", "macrostep", "done"]);
    });

    test("steps() yields the last macrostep, then ends", async () => {
      const { s, clock } = await make(ORDER);
      const seen: string[][] = [];
      const consumer = (async () => {
        for await (const step of s.steps()) seen.push(step.configuration.map((n) => n.id));
      })();
      s.start();
      s.send("payment.ok");
      clock.run();
      await consumer;
      expect(seen).toEqual([["paying"], ["shipped"]]);
    });

    test("disposing a session from its last macrostep ends it as finished, with its donedata, not as cancelled", async () => {
      const { s, clock } = await make(
        doc(
          `<state id="open"><transition event="pay" target="paid"/></state><final id="paid"><donedata><param name="ref" expr="'R-9'"/></donedata></final>`,
        ),
      );
      s.addEventListener("macrostep", () => {
        if (s.isActive("paid")) s.dispose();
      });
      let done: unknown;
      s.addEventListener("done", (e) => {
        done = e.data;
      });
      s.start();
      s.send("pay");
      clock.run();
      expect(s.status).toBe("done");
      expect(s.cancelled).toBe(false);
      expect(done).toEqual({ ref: "R-9" });
      expect(await s.done).toEqual({ ref: "R-9" });
    });

    test("an invoked child that reaches its final state tells its parent, even when disposed from its last macrostep", async () => {
      const { s, clock } = await make(
        doc(`
        <state id="paying">
          <invoke id="payment"><content><scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript">
            <final id="captured"/>
          </scxml></content></invoke>
          <transition event="done.invoke.payment" target="paid"/>
        </state>
        <state id="paid"/>`),
      );
      s.addEventListener("child", (e) => e.child.addEventListener("macrostep", () => e.child.dispose()));
      s.start();
      clock.run();
      expect(s.isActive("paid")).toBe(true);
      s.dispose();
    });

    test("dispose() from a macrostep listener of a running session ends it at once, its exit handlers still running", async () => {
      const { s, clock } = await make(
        doc(
          `<datamodel><data id="order" expr="'SO-1'"/></datamodel>
           <state id="open"><onexit><log label="closing" expr="order"/></onexit><transition event="hold" target="held"/></state>
           <state id="held"><onexit><log label="released" expr="order"/></onexit></state>`,
        ),
      );
      const log = record(s);
      const logs: string[] = [];
      s.addEventListener("log", (e) => logs.push(`${e.label} ${e.value}`));
      const errors: string[] = [];
      s.addEventListener("error", (e) => errors.push(e.message));
      s.addEventListener("macrostep", (e) => {
        if (e.event?.name === "hold") s.dispose();
      });
      s.start();
      s.send("hold");
      clock.run();
      expect(s.cancelled).toBe(true);
      expect(log.slice(-5)).toEqual(["log:closing", "microstep:hold", "macrostep", "log:released", "done"]);
      // the exit handlers ran before the data model was released (they used to fail in QuickJS)
      expect(logs).toEqual(["closing SO-1", "released SO-1"]);
      expect(errors).toEqual([]);
    });

    test("dispose() of a session that never started dispatches done, once", async () => {
      const { s } = await make(doc(`<state id="draft"/>`));
      const log = record(s);
      s.dispose();
      s.dispose();
      expect(log).toEqual(["done"]);
      expect(s.status).toBe("done");
      expect(s.cancelled).toBe(true);
      expect(await s.done).toBeUndefined();
    });
  });
}

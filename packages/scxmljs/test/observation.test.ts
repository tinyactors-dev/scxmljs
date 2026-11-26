/**
 * What a host can observe about a session without touching its internals: whether a step is
 * running, the options it was made with, every event that reaches a queue (with an id that the
 * steps processing it repeat), the processor a `<send>` went to, delayed sends from scheduling to
 * dispatch or cancel, the order of the last events, and the source text of a model.
 */
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type {
  EnqueueEvent,
  IOProcessor,
  IOSession,
  OutboundSend,
  SCXMLSession,
  SendCancelledEvent,
  SendEvent,
  SendScheduledEvent,
  SessionOptions,
} from "../src/index.ts";
import * as sandboxed from "../src/index.ts";
import * as trusted from "../src/trusted.ts";

const happyDOM = new new Window().DOMParser() as unknown as { parseFromString(s: string, t: string): Document };
const doc = (body: string, attrs = "") =>
  `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" ${attrs}>${body}</scxml>`;

/** A payment gateway processor: records what it is asked to send, and can deliver replies. */
function gateway() {
  const sent: OutboundSend[] = [];
  let io: IOSession | undefined;
  const p: IOProcessor = {
    type: "http://example.com/payments",
    aliases: ["payments"],
    location: () => "payments:1",
    attach: (s) => {
      io = s;
    },
    send: (m) => void sent.push(m),
  };
  return { p, sent, reply: (name: string, data?: unknown) => io!.deliver(name, data, "gateway") };
}

/** Every session event, in order, as "type" or "type:detail". */
function record(s: SCXMLSession) {
  const log: string[] = [];
  for (const type of [
    "microstep",
    "macrostep",
    "send",
    "sendscheduled",
    "sendcancelled",
    "enqueue",
    "invoke",
    "child",
    "done",
    "error",
  ] as const)
    s.addEventListener(type, (e: Event) => {
      const detail =
        e instanceof sandboxed.EnqueueEvent
          ? `${e.queue}:${e.event.name}${e.dropped ? ":dropped" : ""}`
          : e instanceof sandboxed.MicrostepEvent
            ? (e.event?.name ?? "")
            : e instanceof sandboxed.SendEvent || e instanceof sandboxed.SendScheduledEvent || e instanceof sandboxed.SendCancelledEvent
              ? e.message.event
              : "";
      log.push(detail ? `${type}:${detail}` : type);
    });
  return log;
}

const ORDER = doc(`
  <datamodel><data id="total" expr="0"/></datamodel>
  <state id="cart">
    <transition event="checkout" target="paying"><assign location="total" expr="_event.data.total"/></transition>
  </state>
  <state id="paying">
    <onentry>
      <send type="payments" event="charge" namelist="total"/>
      <send event="payment.timeout" delay="30s" id="timeout"/>
    </onentry>
    <transition event="payment.ok" target="paid"><cancel sendid="timeout"/><raise event="receipt"/></transition>
    <transition event="payment.timeout" target="cart"/>
  </state>
  <state id="paid"><transition event="receipt" target="shipped"/></state>
  <final id="shipped"/>`);

for (const [name, entry] of [
  ["sandboxed", sandboxed],
  ["trusted", trusted],
] as const) {
  const make = (source: string, opts: SessionOptions = {}) => {
    const clock = new sandboxed.VirtualClock();
    return entry.createSession(source, { clock, ...opts }).then((s) => ({ s, clock }));
  };

  describe(`observation (${name})`, () => {
    test("processing is true while a step runs, false between steps and in macrostep listeners", async () => {
      const g = gateway();
      const { s, clock } = await make(ORDER, { ioprocessors: [g.p] });
      const seen: string[] = [];
      s.addEventListener("microstep", () => seen.push(`micro ${s.processing}`));
      s.addEventListener("send", () => seen.push(`send ${s.processing}`));
      s.addEventListener("macrostep", () => seen.push(`macro ${s.processing}`));
      expect(s.processing).toBe(false);
      s.start();
      expect(s.processing).toBe(false);
      s.send("checkout", { total: 42 });
      clock.run(0);
      expect(seen).toEqual(["micro true", "macro false", "send true", "micro true", "macro false"]);
      s.dispose();
    });

    test("options are the ones the session was made with, read-only; a child's data are its params", async () => {
      const data = { total: 7 };
      const invokers = { audit: () => ({ send() {}, cancel() {} }) };
      const loader = () => doc(`<datamodel><data id="amount"/></datamodel><state id="charging"/>`);
      const { s, clock } = await make(
        doc(
          `<datamodel><data id="total"/></datamodel><state id="a"><invoke type="audit"/><invoke src="payment.scxml"><param name="amount" expr="total"/></invoke></state>`,
        ),
        { data, invokers, loader },
      );
      expect(s.options.data).toBe(data);
      expect(s.options.invokers).toBe(invokers);
      expect(s.options.loader).toBe(loader);
      expect(Object.isFrozen(s.options)).toBe(true);
      expect(() => {
        (s.options as { data?: unknown }).data = {};
      }).toThrow();
      let child: SCXMLSession | undefined;
      s.addEventListener("child", (e) => (child = e.child));
      s.start();
      clock.run(0);
      expect(child!.options.data).toEqual({ amount: 7 });
      expect(child!.options.invokers).toBe(invokers);
      expect(child!.options.sessionId).toBeUndefined();
      s.dispose();
    });

    test("enqueue reports every event that reaches a queue, from every source, with its origin", async () => {
      const g = gateway();
      const { s, clock } = await make(ORDER, { ioprocessors: [g.p] });
      const queued: EnqueueEvent[] = [];
      s.addEventListener("enqueue", (e) => queued.push(e));
      s.send("checkout", { total: 42 }); // before start: it waits, and is reported
      expect(queued.map((e) => [e.queue, e.event.name, e.dropped])).toEqual([["external", "checkout", false]]);
      s.start();
      clock.run(0);
      g.reply("payment.ok", { ref: "P-1" });
      clock.run(0);
      expect(s.status).toBe("done");
      s.send("refund"); // after the end: dropped, still reported
      const rows = queued.map((e) => [e.queue, e.event.name, e.event.origintype ?? null, e.processor ?? null, e.dropped]);
      expect(rows).toEqual([
        ["external", "checkout", null, null, false],
        ["external", "payment.ok", g.p.type, g.p, false],
        ["internal", "receipt", null, null, false],
        ["external", "refund", null, null, true],
      ]);
      expect(queued[1]!.event.origin).toBe("gateway");
      expect(queued[1]!.event.data).toEqual({ ref: "P-1" });
      expect(new Set(queued.map((e) => e.id)).size).toBe(4);
    });

    test("enqueue covers #_parent, #_<invokeid>, #_scxml_ targets, services and done.invoke, and drops a cancelled invocation's events", async () => {
      let service: sandboxed.InvokeContext | undefined;
      const { s, clock } = await make(
        doc(`
        <state id="fulfilling">
          <invoke id="warehouse" type="warehouse"/>
          <invoke id="payment"><content><scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript">
            <state id="charging">
              <onentry><send target="#_parent" event="charged"/></onentry>
              <transition event="settle" target="settled"/>
            </state>
            <final id="settled"/>
          </scxml></content></invoke>
          <transition event="charged"><send targetexpr="'#_scxml_' + _sessionid" event="ship"/></transition>
          <transition event="ship"><send target="#_payment" event="settle"/></transition>
          <transition event="done.invoke.payment"/>
          <transition event="picked" target="closed"/>
        </state>
        <final id="closed"/>`),
        {
          invokers: {
            warehouse: (ctx) => {
              service = ctx;
              return { send() {}, cancel() {} };
            },
          },
        },
      );
      const queued: EnqueueEvent[] = [];
      s.addEventListener("enqueue", (e) => queued.push(e));
      let child: SCXMLSession | undefined;
      const childQueued: EnqueueEvent[] = [];
      s.addEventListener("child", (e) => {
        child = e.child;
        e.child.addEventListener("enqueue", (x) => childQueued.push(x));
      });
      s.start();
      clock.run(0);
      service!.sendToParent("picked", { items: 3 }); // still invoked: delivered … and it ends the invoking state
      clock.run(0);
      service!.sendToParent("late"); // the invocation was cancelled: dropped
      const parentRows = queued.map(
        (e) =>
          `${e.event.name} ${e.event.invokeid ?? "-"} ${e.event.origin ? e.event.origin.replace(/_scxml_.*/, "_scxml_…") : "-"}${e.dropped ? " dropped" : ""}`,
      );
      expect(parentRows).toEqual([
        "charged payment #_scxml_…",
        "ship - #_scxml_…",
        "done.invoke.payment payment -",
        "picked warehouse -",
        "late warehouse - dropped",
      ]);
      expect(s.status).toBe("done");
      expect(childQueued.map((e) => e.event.name)).toEqual(["settle"]);
      expect(child!.status).toBe("done");
    });

    test("a microstep and its macrostep name the event they process by its enqueue id; _event never sees it", async () => {
      const g = gateway();
      const { s, clock } = await make(
        ORDER.replace(
          `<final id="shipped"/>`,
          `<final id="shipped"><onentry><log label="keys" expr="Object.keys(_event).sort().join(',')"/></onentry></final>`,
        ),
        {
          ioprocessors: [g.p],
        },
      );
      const ids = new Map<string, number>();
      s.addEventListener("enqueue", (e) => ids.set(e.event.name, e.id));
      const steps: [string, number | undefined][] = [];
      s.addEventListener("microstep", (e) => steps.push([e.event?.name ?? "", e.eventId]));
      const macro: [string, number | undefined][] = [];
      s.addEventListener("macrostep", (e) => macro.push([e.event?.name ?? "", e.eventId]));
      let keys: unknown;
      s.addEventListener("log", (e) => (keys = e.value));
      s.start();
      s.send("checkout", { total: 5 });
      clock.run(0);
      g.reply("payment.ok");
      clock.run(0);
      expect(steps).toEqual([
        ["", undefined],
        ["checkout", ids.get("checkout")],
        ["payment.ok", ids.get("payment.ok")],
        ["receipt", ids.get("receipt")],
      ]);
      expect(macro).toEqual([
        ["", undefined],
        ["checkout", ids.get("checkout")],
        ["payment.ok", ids.get("payment.ok")],
      ]);
      expect(keys).toBe("data,invokeid,name,origin,origintype,sendid,type");
    });

    test("send names its processor, its delay and the event being processed; a delayed send is seen from scheduling to dispatch", async () => {
      const g = gateway();
      const { s, clock } = await make(
        doc(`
        <state id="paying">
          <transition event="checkout"><send type="payments" event="charge"/><send event="remind" delay="1s"/></transition>
          <transition event="remind" target="reminded"/>
        </state>
        <state id="reminded"/>`),
        { ioprocessors: [g.p] },
      );
      let checkout = -1;
      s.addEventListener("enqueue", (e) => {
        if (e.event.name === "checkout") checkout = e.id;
      });
      const sends: SendEvent[] = [];
      const scheduled: SendScheduledEvent[] = [];
      s.addEventListener("send", (e) => sends.push(e));
      s.addEventListener("sendscheduled", (e) => scheduled.push(e));
      s.start();
      s.send("checkout");
      clock.run(0);
      expect(sends.map((e) => [e.message.event, e.processor ?? null, e.delay, e.triggerId])).toEqual([["charge", g.p, 0, checkout]]);
      expect(sends[0]!.message.type).toBe(g.p.type);
      expect(scheduled.map((e) => [e.message.event, e.delay, e.processor ?? null, e.triggerId])).toEqual([
        ["remind", 1000, null, checkout],
      ]);
      expect(sends).toHaveLength(1); // not dispatched yet
      clock.run();
      expect(sends.map((e) => e.message.event)).toEqual(["charge", "remind"]);
      expect(sends[1]!.message).toBe(scheduled[0]!.message);
      expect(sends[1]!.delay).toBe(1000);
      expect(sends[1]!.triggerId).toBe(checkout);
      expect(s.isActive("reminded")).toBe(true);
      s.dispose();
    });

    test("sendcancelled: by <cancel>, and by the end of the session", async () => {
      const g = gateway();
      const { s, clock } = await make(ORDER, { ioprocessors: [g.p] });
      const cancelled: SendCancelledEvent[] = [];
      const scheduled: SendScheduledEvent[] = [];
      s.addEventListener("sendscheduled", (e) => scheduled.push(e));
      s.addEventListener("sendcancelled", (e) => cancelled.push(e));
      s.start();
      s.send("checkout", { total: 1 });
      clock.run(0);
      g.reply("payment.ok");
      clock.run(0);
      expect(cancelled.map((e) => [e.message.event, e.reason, e.delay])).toEqual([["payment.timeout", "cancel", 30_000]]);
      expect(cancelled[0]!.message).toBe(scheduled[0]!.message);
      expect(cancelled[0]!.message.sendid).toBe("timeout");

      const second = await make(ORDER, { ioprocessors: [gateway().p] });
      const ended: SendCancelledEvent[] = [];
      second.s.addEventListener("sendcancelled", (e) => ended.push(e));
      second.s.start();
      second.s.send("checkout", { total: 1 });
      second.clock.run(0);
      second.s.dispose();
      expect(ended.map((e) => [e.message.event, e.reason])).toEqual([["payment.timeout", "exit"]]);
    });

    test("done says whether dispose() ended the session: not for a final state or a cancel()", async () => {
      const ends: [boolean, boolean][] = [];
      for (const end of ["final", "cancel", "dispose"] as const) {
        const { s, clock } = await make(doc(`<state id="open"><transition event="pay" target="paid"/></state><final id="paid"/>`));
        s.addEventListener("done", (e) => ends.push([e.disposed, s.cancelled]));
        s.start();
        if (end === "final") s.send("pay");
        clock.run(0);
        if (end === "cancel") s.cancel();
        s.dispose();
      }
      expect(ends).toEqual([
        [false, false],
        [false, true],
        [true, true],
      ]);
    });

    test("model.source keeps the text, and the comment before <scxml> that a DOMParser may drop", async () => {
      const text = `<?xml version="1.0"?>\n<!-- An order, from cart to shipment. -->\n${doc(`<state id="cart"/>`)}`;
      const { s } = await make(text, { domParser: happyDOM });
      expect(s.model.source).toBe(text);
      expect(s.model.root.element.previousSibling).toBeNull(); // happy-dom drops it…
      expect(s.model.source).toContain("<!-- An order, from cart to shipment. -->"); // … the text keeps it

      const loaded = doc(`<state id="charging"/>`, `name="payment"`);
      const { s: parent, clock } = await make(doc(`<state id="a"><invoke src="payment.scxml"/></state>`), { loader: () => loaded });
      let child: SCXMLSession | undefined;
      parent.addEventListener("child", (e) => (child = e.child));
      parent.start();
      clock.run(0);
      expect(child!.model.source).toBe(loaded);

      const root = sandboxed.parseSCXML(doc(`<state id="a"/>`));
      expect((await sandboxed.compile(root)).source).toBeUndefined();
      expect((await sandboxed.compile(root, { source: "<scxml/>" })).source).toBe("<scxml/>");
      parent.dispose();
      s.dispose();
    });
  });
}

describe("observation costs nothing unobserved", () => {
  test("without listeners, no enqueue or delayed-send events are made", async () => {
    const made: string[] = [];
    const clock = new sandboxed.VirtualClock();
    const s = await sandboxed.createSession(ORDER, { clock, ioprocessors: [gateway().p] });
    const orig = EventTarget.prototype.dispatchEvent;
    EventTarget.prototype.dispatchEvent = function (e: Event) {
      made.push(e.type);
      return orig.call(this, e);
    };
    try {
      s.start();
      s.send("checkout", { total: 1 });
      clock.run(0);
      s.dispose();
    } finally {
      EventTarget.prototype.dispatchEvent = orig;
    }
    expect(made).not.toContain("enqueue");
    expect(made).not.toContain("sendscheduled");
    expect(made).not.toContain("sendcancelled");
    expect(made).toContain("microstep");
  });
});

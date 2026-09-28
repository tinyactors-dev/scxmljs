/**
 * Robustness: asynchronous loaders, invocations cancelled while loading,
 * long-running sessions, many concurrent sessions, delayed sends across
 * dispose/cancel. Everything runs on a VirtualClock; promise-based loaders
 * are resolved by hand so the interleavings are deterministic.
 */
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import * as sandboxed from "../src/index.ts";
import { type SCXMLErrorEvent, type SCXMLSession, SCXMLValidationError, VirtualClock } from "../src/index.ts";
import * as trusted from "../src/trusted.ts";

const domParser = new new Window().DOMParser() as unknown as { parseFromString(s: string, t: string): Document };
const NS = 'xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript"';
const doc = (body: string) => `<scxml ${NS}>${body}</scxml>`;

/** A promise whose resolution the test controls. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let promise callbacks run, then the clock, a few times. */
async function settle(clock: VirtualClock) {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
    clock.run();
  }
}

function watch(s: SCXMLSession) {
  const errors: string[] = [];
  const logs: unknown[] = [];
  s.addEventListener("error", (e: SCXMLErrorEvent) => errors.push(`${e.kind}: ${e.message}`));
  s.addEventListener("log", (e) => logs.push(e.value));
  return { errors, logs };
}

/** Internal bookkeeping that must be empty whenever a session is at rest. */
function internals(s: SCXMLSession) {
  const x = s as unknown as Record<string, { size?: number; length?: number }>;
  return {
    internalQueue: x.internalQueue!.length,
    externalQueue: x.externalQueue!.length,
    delayed: x.delayed!.size,
    delayedBySendid: x.delayedBySendid!.size,
    invoked: x.invoked!.size,
    invokeIds: x.invokeIds!.size,
  };
}
const EMPTY = { internalQueue: 0, externalQueue: 0, delayed: 0, delayedBySendid: 0, invoked: 0, invokeIds: 0 };

for (const [name, entry] of [
  ["sandboxed", sandboxed],
  ["trusted", trusted],
] as const) {
  describe(`asynchronous loaders (${name})`, () => {
    test("<script src> and <data src> load before the session exists", async () => {
      const clock = new VirtualClock();
      const script = deferred<string>();
      const data = deferred<string>();
      const pending = entry.createSession(
        doc(`<datamodel><data id="d" src="d.json"/></datamodel><script src="s.js"/>
             <state id="a"><onentry><log expr="greet(d.name)"/></onentry></state>`),
        { clock, domParser, loader: (src) => (src === "s.js" ? script.promise : data.promise) },
      );
      data.resolve('{"name":"world"}');
      await Promise.resolve();
      script.resolve("function greet(n) { return 'hello ' + n; }");
      const s = await pending;
      const { logs, errors } = watch(s);
      s.start();
      clock.run();
      expect([logs, errors]).toEqual([["hello world"], []]);
    });

    test("a <script src> that fails to load rejects the document", async () => {
      const err = await entry
        .createSession(doc(`<script src="s.js"/><state id="a"/>`), { domParser, loader: () => Promise.reject(new Error("404")) })
        .catch((e) => e);
      expect(err).toBeInstanceOf(SCXMLValidationError);
      expect(err.message).toContain("404");
    });

    test("a <data src> that fails to load raises error.execution and leaves the variable undefined", async () => {
      const clock = new VirtualClock();
      const s = await entry.createSession(doc(`<datamodel><data id="d" src="d.json"/></datamodel><state id="a"/>`), {
        clock,
        domParser,
        loader: () => Promise.reject(new Error("offline")),
      });
      const { errors } = watch(s);
      s.start();
      clock.run();
      expect(errors).toEqual([expect.stringContaining("offline")]);
      expect(s.snapshot()).toEqual({ d: undefined });
    });

    test("a slow <invoke src>: events sent before it starts are delivered once it does", async () => {
      const clock = new VirtualClock();
      const child = deferred<string>();
      const s = await entry.createSession(
        doc(`<state id="a">
               <invoke id="kid" src="kid.scxml"/>
               <transition event="poke"><send target="#_kid" event="hello"/></transition>
               <transition event="reply" cond="_event.data.got === 'hello'" target="b"/>
             </state><state id="b"/>`),
        { clock, domParser, loader: () => child.promise },
      );
      const { errors } = watch(s);
      s.start();
      await settle(clock);
      // the invocation exists (so #_kid is a valid target) but its source is still loading
      s.send("poke");
      await settle(clock);
      expect(s.activeStateIds()).toEqual(["a"]);
      child.resolve(`<scxml ${NS}><state id="k"><transition event="hello" target="f">
          <send target="#_parent" event="reply"><param name="got" expr="_event.name"/></send></transition></state><final id="f"/></scxml>`);
      await settle(clock);
      expect(s.activeStateIds()).toEqual(["b"]);
      expect(errors).toEqual([]);
    });

    test("an <invoke src> that fails to load raises error.execution in the parent", async () => {
      const clock = new VirtualClock();
      const s = await entry.createSession(
        doc(`<state id="a"><invoke src="kid.scxml"/><transition event="error.execution" target="b"/></state><state id="b"/>`),
        { clock, domParser, loader: () => Promise.reject(new Error("gone")) },
      );
      const { errors } = watch(s);
      s.start();
      await settle(clock);
      expect(s.activeStateIds()).toEqual(["b"]);
      expect(errors).toEqual([expect.stringContaining("gone")]);
    });

    test("an invocation cancelled while its source loads never starts, and nothing leaks", async () => {
      const clock = new VirtualClock();
      const child = deferred<string>();
      let childStarted = false;
      const s = await entry.createSession(
        doc(`<state id="a"><invoke id="kid" src="kid.scxml"/><transition event="leave" target="b"/></state>
             <state id="b"><transition event="child.says" target="c"/></state><state id="c"/>`),
        { clock, domParser, loader: () => child.promise },
      );
      s.addEventListener("child", (e) => e.child.addEventListener("macrostep", () => (childStarted = true)));
      s.start();
      await settle(clock);
      s.send("leave");
      await settle(clock);
      expect(s.activeStateIds()).toEqual(["b"]);
      child.resolve(`<scxml ${NS}><state id="k"><onentry><send target="#_parent" event="child.says"/></onentry></state></scxml>`);
      await settle(clock);
      expect(childStarted).toBe(false);
      expect(s.activeStateIds()).toEqual(["b"]);
      expect(s.invocations).toEqual([]);
      expect(internals(s)).toEqual(EMPTY);
    });
  });

  describe(`long-running and concurrent sessions (${name})`, () => {
    test("100,000 events leave no residue in queues or timers", async () => {
      const clock = new VirtualClock();
      const s = await entry.createSession(
        doc(`<datamodel><data id="n" expr="0"/></datamodel>
             <state id="idle">
               <transition event="tick" target="busy"><assign location="n" expr="n + 1"/></transition>
             </state>
             <state id="busy">
               <onentry>
                 <send id="t" event="timeout" delay="1s"/>
                 <send event="noise" delay="2s"/>
                 <raise event="inner"/>
               </onentry>
               <onexit><cancel sendid="t"/></onexit>
               <transition event="inner" target="idle"/>
             </state>`),
        { clock, domParser },
      );
      const { errors } = watch(s);
      s.start();
      const N = 100_000;
      for (let i = 0; i < N; i++) {
        s.send("tick");
        clock.run(clock.now()); // only what's due now: the 2 s "noise" timers pile up…
      }
      expect(internals(s).delayed).toBe(N); // …one per cycle; the cancelled 1 s timers are gone
      clock.run(); // …and all fire at the end
      expect(s.datamodel.evaluate("n")).toBe(N);
      expect(errors).toEqual([]);
      expect(internals(s)).toEqual(EMPTY);
      expect(clock.pending).toBe(0);
      s.dispose();
    }, 60_000);

    test("1,000 invoke cycles leave no residue in invocations", async () => {
      const clock = new VirtualClock();
      const s = await entry.createSession(
        doc(`<datamodel><data id="n" expr="0"/></datamodel>
             <state id="idle"><transition event="tick" target="busy"><assign location="n" expr="n + 1"/></transition></state>
             <state id="busy">
               <invoke id="helper"><content><scxml ${NS}><state id="w"><transition event="stop" target="f"/></state><final id="f"/></scxml></content></invoke>
               <transition event="tick" target="idle"/>
             </state>`),
        { clock, domParser },
      );
      const { errors } = watch(s);
      const children: SCXMLSession[] = [];
      s.addEventListener("child", (e) => children.push(e.child));
      s.start();
      for (let i = 0; i < 2_000; i++) {
        s.send("tick"); // idle → busy (starts a child) → idle (cancels it)
        clock.run();
      }
      expect(s.datamodel.evaluate("n")).toBe(1_000);
      expect(errors).toEqual([]);
      expect(children).toHaveLength(1_000);
      expect(children.every((c) => c.status === "done" && c.cancelled)).toBe(true);
      expect(internals(s)).toEqual(EMPTY);
      s.dispose();
    }, 60_000);

    test("200 sessions play ping-pong through #_scxml_<id> targets", async () => {
      const clock = new VirtualClock();
      const chart = doc(`<datamodel><data id="peer"/><data id="hits" expr="0"/></datamodel>
        <state id="play">
          <transition event="serve"><send targetexpr="'#_scxml_' + peer" event="ball"/></transition>
          <transition event="ball" cond="hits &lt; 5"><assign location="hits" expr="hits + 1"/><send targetexpr="'#_scxml_' + peer" event="ball"/></transition>
          <transition event="ball" target="won"/>
        </state><final id="won"/>`);
      const sessions: SCXMLSession[] = [];
      for (let i = 0; i < 200; i++)
        sessions.push(await entry.createSession(chart, { clock, domParser, sessionId: `player${i}`, data: { peer: `player${i ^ 1}` } }));
      for (const s of sessions) s.start();
      for (let i = 0; i < 200; i += 2) sessions[i]!.send("serve");
      clock.run();
      // each pair: someone reaches hits = 5 and the next ball ends it for that player
      for (let i = 0; i < 200; i += 2) {
        const pair = [sessions[i]!, sessions[i + 1]!];
        expect(pair.some((s) => s.status === "done")).toBe(true);
      }
      for (const s of sessions) s.dispose();
    });

    test("sending to a disposed session raises error.communication", async () => {
      const clock = new VirtualClock();
      const target = await entry.createSession(doc(`<state id="t"/>`), { clock, domParser, sessionId: "gone" });
      target.start();
      target.dispose();
      const s = await entry.createSession(doc(`<state id="a"><onentry><send target="#_scxml_gone" event="x"/></onentry></state>`), {
        clock,
        domParser,
      });
      const { errors } = watch(s);
      s.start();
      clock.run();
      expect(errors).toEqual([expect.stringMatching(/^error\.communication/)]);
    });
  });

  describe(`delayed sends across dispose and cancel (${name})`, () => {
    for (const how of ["dispose", "cancel"] as const) {
      test(`${how}() clears the session's pending timers`, async () => {
        const clock = new VirtualClock();
        const s = await entry.createSession(
          doc(`<state id="a"><onentry><send event="late" delay="5s"/><send event="later" delay="3600s"/></onentry></state>`),
          {
            clock,
            domParser,
          },
        );
        s.start();
        clock.run(0);
        expect(clock.pending).toBe(2);
        s[how]();
        expect(clock.pending).toBe(0);
        expect(internals(s)).toEqual(EMPTY);
      });
    }

    test("a delayed send to a session disposed in the meantime raises error.communication", async () => {
      const clock = new VirtualClock();
      const target = await entry.createSession(doc(`<state id="t"/>`), { clock, domParser, sessionId: "short-lived" });
      target.start();
      const s = await entry.createSession(
        doc(`<state id="a"><onentry><send target="#_scxml_short-lived" event="x" delay="1s"/></onentry></state>`),
        {
          clock,
          domParser,
        },
      );
      const { errors } = watch(s);
      s.start();
      clock.run(500);
      target.dispose();
      clock.run();
      expect(errors).toEqual([expect.stringMatching(/^error\.communication/)]);
    });

    test("disposing a session from inside its own listener finishes the step safely", async () => {
      const clock = new VirtualClock();
      const s = await entry.createSession(
        doc(`<state id="a"><transition event="go" target="b"/></state>
             <state id="b"><onentry><log expr="'entered b'"/><raise event="more"/></onentry><transition event="more" target="c"/></state><state id="c"/>`),
        { clock, domParser },
      );
      const { errors } = watch(s);
      s.addEventListener("microstep", (e) => {
        if (e.entered.some((n) => n.id === "b")) s.dispose();
      });
      s.start();
      s.send("go");
      expect(() => clock.run()).not.toThrow();
      expect(s.status).toBe("done");
      expect(s.cancelled).toBe(true);
      expect(errors).toEqual([]);
    });
  });
}

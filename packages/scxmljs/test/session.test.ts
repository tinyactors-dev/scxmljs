import { describe, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import {
  createSession,
  type IOProcessor,
  type IOSession,
  MacrostepEvent,
  type MicrostepEvent,
  type OutboundSend,
  SCXMLValidationError,
  type SessionOptions,
  VirtualClock,
} from "../src/index.ts";

const domParser = new new Window().DOMParser() as unknown as { parseFromString(s: string, t: string): Document };
const doc = (body: string, attrs = "") =>
  `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" ${attrs}>${body}</scxml>`;

async function run(body: string, opts: SessionOptions = {}, attrs = "") {
  const clock = new VirtualClock();
  const s = await createSession(doc(body, attrs), { clock, domParser, ...opts });
  const logs: unknown[] = [];
  s.addEventListener("log", (e) => logs.push(e.value));
  s.start();
  clock.run();
  const send = (name: string, data?: unknown) => {
    s.send(name, data);
    clock.run();
  };
  return { s, clock, logs, send };
}

describe("validation", () => {
  test("reports every problem at once", async () => {
    const err = await createSession(doc(`<state id="a"><transition event="x" target="nowhere"/></state><state id="a"/>`), {
      domParser,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SCXMLValidationError);
    expect(err.problems).toEqual(expect.arrayContaining(['duplicate id "a"', expect.stringContaining('unknown target "nowhere"')]));
  });

  test("rejects unknown executable content and illegal initial targets", async () => {
    const err = await createSession(
      doc(`<state id="p" initial="q"><onentry><frobnicate/></onentry><state id="c"/></state><state id="q"/>`),
      { domParser },
    ).catch((e) => e);
    expect(err.problems.join("\n")).toContain("<frobnicate> is not executable content");
    expect(err.problems.join("\n")).toContain('initial target "q" is not a descendant of "p"');
  });

  test("generates ids for anonymous states", async () => {
    const { s } = await run(`<state><state/></state>`);
    expect(s.activeStateIds()).toEqual(["__state1", "__state2"]);
    expect(s.configuration.every((n) => n.generatedId)).toBe(true);
  });
});

describe("ECMAScript sandbox", () => {
  test("scripts run in the global scope: var and function declarations persist", async () => {
    const { logs } = await run(`
      <script>var counter = 1; function bump() { return ++counter; }</script>
      <state id="a"><onentry><log expr="bump()"/><log expr="counter"/></onentry></state>`);
    expect(logs).toEqual([2, 2]);
  });

  test("sessions are isolated from each other and from the host", async () => {
    const a = await run(`<script>var shared = 'a'; globalThis.leak = 1;</script><state id="s"/>`);
    const b = await run(`<state id="s"><onentry><log expr="typeof shared + ' ' + typeof leak + ' ' + typeof process"/></onentry></state>`);
    expect(b.logs).toEqual(["undefined undefined undefined"]);
    expect((globalThis as { leak?: unknown }).leak).toBeUndefined();
    a.s.dispose();
    b.s.dispose();
  });

  test("system variables are read-only", async () => {
    const { s, logs } = await run(
      `
      <state id="a">
        <onentry><assign location="_sessionid" expr="'x'"/></onentry>
        <transition event="error.execution" target="b"/>
      </state>
      <state id="b"><onentry><log expr="_sessionid === 'fixed'"/></onentry></state>`,
      { sessionId: "fixed" },
    );
    expect(s.activeStateIds()).toEqual(["b"]);
    expect(logs).toEqual([true]);
  });

  test("runaway scripts are interrupted", async () => {
    const { s } = await run(
      `<state id="a"><onentry><script>while (true) {}</script></onentry><transition event="error.execution" target="b"/></state><state id="b"/>`,
      { scriptTimeoutMs: 50 },
    );
    expect(s.activeStateIds()).toEqual(["b"]);
  });

  test("snapshot returns plain data", async () => {
    const { s } = await run(`<datamodel><data id="n" expr="{ a: [1, 2], f: function () {} }"/></datamodel><state id="a"/>`);
    expect(s.snapshot()).toEqual({ n: { a: [1, 2] } });
  });
});

describe("events and time", () => {
  test("delayed sends use the injected clock", async () => {
    const { s, clock } = await run(`
      <state id="a"><onentry><send event="tick" delay="5s"/></onentry><transition event="tick" target="b"/></state>
      <state id="b"/>`);
    expect(s.activeStateIds()).toEqual(["b"]);
    expect(clock.now()).toBe(5000);
  });

  test("host events carry data into _event", async () => {
    const { s, logs, send } = await run(`
      <state id="a"><transition event="go" target="b"><log expr="_event.data.n + 1"/></transition></state>
      <state id="b"/>`);
    send("go", { n: 41 });
    expect(logs).toEqual([42]);
    expect(s.activeStateIds()).toEqual(["b"]);
  });

  test("microstep details describe what happened", async () => {
    const clock = new VirtualClock();
    const s = await createSession(doc(`<state id="a"><transition event="go" target="b"/></state><state id="b"/>`), { clock, domParser });
    const steps: MicrostepEvent[] = [];
    s.addEventListener("microstep", (e) => steps.push(e));
    s.start();
    s.send("go");
    clock.run();
    expect(steps.map((d) => [d.event?.name ?? null, d.exited.map((x) => x.id), d.entered.map((x) => x.id)])).toEqual([
      [null, [], ["a"]],
      ["go", ["a"], ["b"]],
    ]);
  });
});

describe("extension points", () => {
  test("custom Event I/O Processors send and receive", async () => {
    const sent: OutboundSend[] = [];
    let io!: IOSession;
    const echo: IOProcessor = {
      type: "urn:test:echo",
      aliases: ["echo"],
      location: () => "echo:",
      attach: (s) => (io = s),
      send: (m, s) => {
        sent.push(m);
        s.deliver(`echo.${m.event}`, m.data, "echo:");
      },
    };
    const { s } = await run(
      `<state id="a">
         <onentry><send type="echo" target="anywhere" event="ping"><param name="x" expr="1"/></send></onentry>
         <transition event="echo.ping" cond="_event.origintype === 'urn:test:echo' &amp;&amp; _event.data.x === 1" target="b"/>
       </state>
       <state id="b"/>`,
      { ioprocessors: [echo] },
    );
    expect(sent).toEqual([{ event: "ping", target: "anywhere", type: "urn:test:echo", data: { x: 1 }, sendid: undefined }]);
    expect(io.sessionId).toBe(s.sessionId);
    expect(s.activeStateIds()).toEqual(["b"]);
  });

  test("custom invokers get params, can reply, and are cancelled on exit", async () => {
    let cancelled = false;
    const { s, send } = await run(
      `<state id="a">
         <invoke type="timer" id="t"><param name="ms" expr="10"/></invoke>
         <transition event="tick" cond="_event.invokeid === 't'" target="b"/>
       </state>
       <state id="b"><transition event="leave" target="c"/></state>
       <state id="c"/>`,
      {
        invokers: {
          timer: (ctx) => {
            ctx.sendToParent("tick", ctx.params);
            return { send() {}, cancel: () => (cancelled = true) };
          },
        },
      },
    );
    expect(s.activeStateIds()).toEqual(["b"]);
    expect(cancelled).toBe(true); // leaving "a" cancelled the invocation
    send("leave");
    expect(s.activeStateIds()).toEqual(["c"]);
  });

  test("invoked SCXML children talk to their parent", async () => {
    const { s } = await run(`
      <state id="a">
        <invoke id="kid"><content>
          <scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript">
            <datamodel><data id="greeting" expr="'hi'"/></datamodel>
            <final id="done"><onentry><send target="#_parent" event="hello"><param name="g" expr="greeting"/></send></onentry>
              <donedata><content expr="42"/></donedata></final>
          </scxml>
        </content></invoke>
        <transition event="hello" cond="_event.data.g === 'hi'" target="b"/>
      </state>
      <state id="b"><transition event="done.invoke.kid" cond="_event.data === 42" target="c"/></state>
      <state id="c"/>`);
    expect(s.activeStateIds()).toEqual(["c"]);
  });
});

describe("session events", () => {
  test("are typed Event subclasses: no casts needed", async () => {
    const clock = new VirtualClock();
    const s = await createSession(doc(`<state id="a"><onentry><log label="hi" expr="1 + 1"/></onentry></state>`), { clock, domParser });
    const entered: string[] = [];
    const logs: [string, unknown][] = [];
    let macro: MacrostepEvent | undefined;
    s.addEventListener("microstep", (e) => entered.push(...e.entered.map((n) => n.id)));
    s.addEventListener("log", (e) => logs.push([e.label, e.value]));
    s.addEventListener("macrostep", (e) => (macro = e));
    s.start();
    expect(entered).toEqual(["a"]);
    expect(logs).toEqual([["hi", 2]]);
    expect(macro).toBeInstanceOf(MacrostepEvent);
    expect(macro).toBeInstanceOf(Event);
    expect(macro!.session).toBe(s);
    expect(macro!.bubbles).toBe(false);
    expect(macro!.cancelable).toBe(false);
  });

  test("a throwing listener is reported and cannot break a step", async () => {
    const errors = spyOn(console, "error").mockImplementation(() => {});
    try {
      const clock = new VirtualClock();
      const s = await createSession(doc(`<state id="a"><transition event="go" target="b"/></state><state id="b"/>`), { clock, domParser });
      const seen: string[] = [];
      s.addEventListener("microstep", () => {
        throw new Error("host bug");
      });
      s.addEventListener("microstep", (e) => seen.push(...e.entered.map((n) => n.id)));
      s.start();
      s.send("go");
      clock.run();
      expect(s.activeStateIds()).toEqual(["b"]);
      expect(seen).toEqual(["a", "b"]);
      expect(errors).toHaveBeenCalledTimes(2);
    } finally {
      errors.mockRestore();
    }
  });

  test("removeEventListener removes the wrapped listener", async () => {
    const clock = new VirtualClock();
    const s = await createSession(doc(`<state id="a"><transition event="go" target="b"/></state><state id="b"/>`), { clock, domParser });
    const seen: string[] = [];
    const listener = (e: MicrostepEvent) => seen.push(...e.entered.map((n) => n.id));
    const object = { handleEvent: (e: Event) => seen.push(`obj:${(e as MicrostepEvent).entered.length}`) };
    s.addEventListener("microstep", listener);
    s.addEventListener("microstep", object);
    s.start();
    s.removeEventListener("microstep", listener);
    s.removeEventListener("microstep", object);
    s.send("go");
    clock.run();
    expect(seen).toEqual(["a", "obj:1"]);
  });
});

test("invoke with an asynchronous loader starts the child (regression)", async () => {
  const clock = new VirtualClock();
  const child = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript"><final id="f"/></scxml>`;
  const s = await createSession(
    doc(`<state id="a"><invoke id="kid" src="child.scxml"/><transition event="done.invoke.kid" target="b"/></state><state id="b"/>`),
    { clock, domParser, loader: async () => child },
  );
  s.start();
  for (let i = 0; i < 10 && !s.isActive("b"); i++) {
    clock.run();
    await Promise.resolve();
  }
  expect(s.activeStateIds()).toEqual(["b"]);
});

test("memoryLimitBytes caps the sandbox's memory: an allocation beyond it raises error.execution", async () => {
  const errors: string[] = [];
  const s = await createSession(
    doc(`<state id="a"><onentry><script>var big = []; for (var i = 0; i &lt; 1e7; i++) big.push({ i: i });</script></onentry>
      <transition event="error.execution" target="b"/></state><state id="b"/>`),
    { domParser, clock: new VirtualClock(), memoryLimitBytes: 4 * 1024 * 1024, scriptTimeoutMs: 10_000 },
  );
  s.addEventListener("error", (e) => errors.push(e.message));
  s.start();
  expect(s.activeStateIds()).toEqual(["b"]);
  expect(errors.join(" ")).toMatch(/memory/i);
  s.dispose();
});

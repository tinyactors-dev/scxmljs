import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { createSession, type LogEvent, type SessionOptions, VirtualClock } from "../src/trusted.ts";

const domParser = new new Window().DOMParser() as unknown as { parseFromString(s: string, t: string): Document };
const doc = (body: string) => `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript">${body}</scxml>`;

async function run(body: string, opts: SessionOptions = {}) {
  const clock = new VirtualClock();
  const s = await createSession(doc(body), { clock, domParser, ...opts });
  const logs: unknown[] = [];
  s.addEventListener("log", (e: LogEvent) => logs.push(e.value));
  s.start();
  clock.run();
  const send = (name: string, data?: unknown) => {
    s.send(name, data);
    clock.run();
  };
  return { s, clock, logs, send };
}

describe("trusted data model", () => {
  test("scripts run as global scripts of the session's own realm", async () => {
    const { logs } = await run(`
      <script>var counter = 1; function bump() { return ++counter; }</script>
      <state id="a"><onentry><log expr="bump()"/><log expr="counter"/></onentry></state>`);
    expect(logs).toEqual([2, 2]);
  });

  test("sessions don't share globals with each other or the host", async () => {
    await run(`<script>var shared = 'a'; globalThis.leak = 1;</script><state id="s"/>`);
    const b = await run(`<state id="s"><onentry><log expr="typeof shared + ' ' + typeof leak"/></onentry></state>`);
    expect(b.logs).toEqual(["undefined undefined"]);
    expect((globalThis as { leak?: unknown }).leak).toBeUndefined();
  });

  test("system variables are read-only", async () => {
    const { s } = await run(`
      <state id="a"><onentry><assign location="_event" expr="1"/></onentry>
        <transition event="error.execution" target="b"/></state>
      <state id="b"/>`);
    expect(s.activeStateIds()).toEqual(["b"]);
  });

  test("event data is copied in: the chart can't mutate host objects", async () => {
    const payload = { list: [1, 2] };
    const { logs, send } = await run(`
      <state id="a"><transition event="go" target="b">
        <script>_event.data.list.push(3)</script>
        <log expr="_event.data.list.length + ' ' + (_event.data.list instanceof Array)"/>
      </transition></state>
      <state id="b"/>`);
    send("go", payload);
    expect(logs).toEqual(["3 true"]); // a realm-native array inside the chart
    expect(payload.list).toEqual([1, 2]);
  });

  test("values come out as plain data", async () => {
    const { s } = await run(
      `<datamodel><data id="v" expr="{ a: [1, { b: 2 }], f: function () {}, d: new Date(0) }"/></datamodel><state id="s"/>`,
    );
    expect(s.snapshot()).toEqual({ v: { a: [1, { b: 2 }], d: "1970-01-01T00:00:00.000Z" } });
  });

  test("invoked children inherit the trusted engine and get their own realm", async () => {
    const { s } = await run(`
      <script>var secret = 1;</script>
      <state id="a">
        <invoke id="kid"><content>
          <scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript">
            <final id="f"><onentry><send target="#_parent" event="report"><param name="seen" expr="typeof secret"/></send></onentry></final>
          </scxml>
        </content></invoke>
        <transition event="report" cond="_event.data.seen === 'undefined'" target="b"/>
      </state>
      <state id="b"/>`);
    expect(s.activeStateIds()).toEqual(["b"]);
  });

  test("XML values are real DOM nodes", async () => {
    const { logs } = await run(`
      <datamodel><data id="books"><books xmlns=""><book title="one"/><book title="two"/></books></data></datamodel>
      <state id="a"><onentry><log expr="books.getElementsByTagName('book')[1].getAttribute('title')"/></onentry></state>`);
    expect(logs).toEqual(["two"]);
  });
});

test("the trusted entry point doesn't bundle QuickJS", async () => {
  const build = async (entry: string) => {
    const out = await Bun.build({ entrypoints: [new URL(entry, import.meta.url).pathname], target: "browser", minify: true });
    expect(out.success).toBe(true);
    return out.outputs[0]!.text();
  };
  const trusted = await build("../src/trusted.ts");
  const sandboxed = await build("../src/index.ts");
  expect(trusted).not.toMatch(/WebAssembly|emscripten|quickjs/i);
  expect(sandboxed.length).toBeGreaterThan(trusted.length * 5);
  console.log(`bundle size — trusted: ${(trusted.length / 1024).toFixed(0)} KB, sandboxed: ${(sandboxed.length / 1024).toFixed(0)} KB`);
});

test("thousands of assignments keep their values (regression: Bun node:vm caching issue at ~583)", async () => {
  const { s, send } = await run(`
    <datamodel><data id="n" expr="0"/><data id="items" expr="[1, 2, 3]"/><data id="sum" expr="0"/></datamodel>
    <state id="a">
      <transition event="tick" type="internal">
        <assign location="n" expr="n + 1"/>
        <foreach array="items" item="x"><assign location="sum" expr="sum + x"/></foreach>
      </transition>
    </state>`);
  for (let i = 0; i < 1500; i++) s.send("tick");
  send("tick");
  expect(s.snapshot()).toMatchObject({ n: 1501, sum: 1501 * 6 });
});

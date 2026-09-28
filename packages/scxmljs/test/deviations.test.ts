/**
 * Every behaviour listed in docs/deviations.md, pinned: each "where we
 * differ from, or go beyond, the letter of the spec" claim has a test here,
 * in both data models where it applies.
 */
import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import * as sandboxed from "../src/index.ts";
import { type SCXMLErrorEvent, type SCXMLSession, type SessionOptions, VirtualClock } from "../src/index.ts";
import * as trusted from "../src/trusted.ts";

const window = new Window();
const domParser = new window.DOMParser() as unknown as { parseFromString(s: string, t: string): Document };
const doc = (body: string, attrs = 'datamodel="ecmascript"') =>
  `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" ${attrs}>${body}</scxml>`;

const engines = [
  ["sandboxed", sandboxed.createSession],
  ["trusted", trusted.createSession],
] as const;

async function start(create: (typeof engines)[number][1], body: string, opts: SessionOptions = {}, attrs?: string) {
  const clock = new VirtualClock();
  const s: SCXMLSession = await create(doc(body, attrs), { clock, domParser, ...opts });
  const logs: unknown[] = [];
  const errors: string[] = [];
  s.addEventListener("log", (e) => logs.push(e.value));
  s.addEventListener("error", (e: SCXMLErrorEvent) => errors.push(e.kind));
  s.start();
  clock.run();
  return { s, clock, logs, errors };
}

for (const [name, create] of engines) {
  describe(`deviations (${name})`, () => {
    test("values leave the data model with JSON rules inside containers", async () => {
      const { s } = await start(create, `<state id="a"/>`);
      const out = (expr: string) => s.datamodel.evaluate(expr);
      expect(out("({ a: 1, b: undefined, f: function () {} })")).toEqual({ a: 1 });
      expect(out("[1, undefined, 3, function () {}]")).toEqual([1, null, 3, null]);
      expect(out("({ n: NaN, i: Infinity, b: 10n })")).toEqual({ n: null, i: null, b: "10" });
      expect(out("({ d: new Date(0) })")).toEqual({ d: "1970-01-01T00:00:00.000Z" });
      expect(out("new Map([[1, 2]])")).toEqual({});
      expect(out("(function () { var o = { a: 1 }; o.self = o; o.list = [o]; return o; })()")).toEqual({ a: 1, list: [null] });
      // top-level primitives pass through; a top-level function doesn't
      expect(Number.isNaN(out("NaN"))).toBe(true);
      expect(Object.is(out("-0"), -0)).toBe(true);
      expect(out("10n")).toBe(10n);
      expect(out("undefined")).toBeUndefined();
      expect(out("(function () {})")).toBeUndefined();
      s.dispose();
    });

    test("values enter as copies: Dates become numbers, functions and cycles are dropped", async () => {
      const { s, clock, logs } = await start(
        create,
        `<state id="a"><transition event="go"><log expr="JSON.stringify([typeof _event.data.when, typeof _event.data.fn, _event.data.self])"/></transition></state>`,
      );
      const data: Record<string, unknown> = { when: new Date(5), fn: () => 1 };
      data.self = data;
      s.send("go", data);
      clock.run();
      expect(logs).toEqual(['["number","undefined",null]']);
      s.dispose();
    });

    test("an expression may end with a semicolon", async () => {
      const { logs, errors } = await start(
        create,
        `<datamodel><data id="x" expr="41;"/></datamodel><state id="a"><onentry><log expr="x + 1;"/></onentry></state>`,
      );
      expect([logs, errors]).toEqual([[42], []]);
    });

    test("<log> with an empty expr logs no value and raises no error", async () => {
      const { logs, errors } = await start(create, `<state id="a"><onentry><log label="note" expr=""/></onentry></state>`);
      expect([logs, errors]).toEqual([[undefined], []]);
    });

    test("repeated <param> names collect their values in an array", async () => {
      const { logs } = await start(
        create,
        `<state id="a"><onentry><send event="e"><param name="k" expr="1"/><param name="k" expr="2"/><param name="j" expr="3"/></send></onentry>
           <transition event="e"><log expr="_event.data"/></transition></state>`,
      );
      expect(logs).toEqual([{ k: [1, 2], j: 3 }]);
    });

    test("send() is processed asynchronously, on the clock", async () => {
      const { s, clock } = await start(create, `<state id="a"><transition event="go" target="b"/></state><state id="b"/>`);
      s.send("go");
      expect(s.activeStateIds()).toEqual(["a"]);
      clock.run();
      expect(s.activeStateIds()).toEqual(["b"]);
    });

    test("maxMicrosteps stops an eventless loop with error.platform", async () => {
      const { s, errors } = await start(
        create,
        `<datamodel><data id="n" expr="0"/></datamodel>
         <state id="a"><transition target="b"><assign location="n" expr="n + 1"/></transition></state>
         <state id="b"><transition target="a"/></state>`,
        { maxMicrosteps: 50 },
      );
      expect(errors).toContain("error.platform");
      expect(s.status).toBe("done");
    });

    test("_ioprocessors also lists the SCXML processor under the short name 'scxml'", async () => {
      const { s } = await start(create, `<state id="a"/>`);
      const io = s.datamodel.evaluate("_ioprocessors") as Record<string, { location: string }>;
      expect(io.scxml).toEqual(io["http://www.w3.org/TR/scxml/#SCXMLEventProcessor"]!);
      expect(io.scxml!.location).toBe(`#_scxml_${s.sessionId}`);
    });

    test("the null data model evaluates In() with the ECMAScript engine and rejects data", async () => {
      const { s } = await start(
        create,
        `<parallel id="p"><state id="x"><transition cond="In('y')" target="done"/></state><state id="y"/></parallel><final id="done"/>`,
        {},
        'datamodel="null"',
      );
      expect(s.status).toBe("done");
      const err = await create(doc(`<datamodel><data id="d"/></datamodel><state id="a"/>`, 'datamodel="null"'), { domParser }).catch(
        (e) => e,
      );
      expect(String(err.message)).toContain("null data model");
    });
  });
}

describe("XML values differ between the engines", () => {
  const body = `<datamodel><data id="books"><books xmlns=""><book title="one"/><book title="two"/></books></data></datamodel><state id="a"/>`;

  test("sandboxed: a small DOM inside the engine, serialised to XML text on the way out", async () => {
    const { s } = await start(sandboxed.createSession, body);
    expect(s.datamodel.evaluate("books.getElementsByTagName('book')[1].getAttribute('title')")).toBe("two");
    // (happy-dom doesn't apply xmlns="" to children, so namespace declarations vary; the shape is what matters)
    const xml = s.datamodel.evaluate("books") as string;
    expect(typeof xml).toBe("string");
    expect(xml).toMatch(/^<books[^>]*><book [^>]*title="one"\/><book [^>]*title="two"\/><\/books>$/);
  });

  test("trusted: real DOM nodes, handed out as nodes", async () => {
    const { s } = await start(trusted.createSession, body);
    expect(s.datamodel.evaluate("books.getElementsByTagName('book')[1].getAttribute('title')")).toBe("two");
    const node = s.datamodel.evaluate("books") as Element;
    expect(node.nodeType).toBe(1);
    expect(node.localName).toBe("books");
  });
});

test("only the sandbox interrupts a runaway script (error.execution)", async () => {
  const { errors } = await start(sandboxed.createSession, `<state id="a"><onentry><script>for (;;) {}</script></onentry></state>`, {
    scriptTimeoutMs: 20,
  });
  expect(errors).toEqual(["error.execution"]);
});

test("an invalid delay raises error.execution", async () => {
  const { errors } = await start(sandboxed.createSession, `<state id="a"><onentry><send event="e" delay="soon"/></onentry></state>`);
  expect(errors).toEqual(["error.execution"]);
});

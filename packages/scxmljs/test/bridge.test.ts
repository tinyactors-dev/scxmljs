import { describe, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import { createSession, VirtualClock } from "../src/index.ts";

const domParser = new new Window().DOMParser() as unknown as { parseFromString(s: string, t: string): Document };

/** Records every event with its data; `go`/`stop` move between states `a` and `b`, `finish` ends the session. */
const CHART = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" initial="a">
  <state id="a">
    <transition event="go" target="b"/>
    <transition event="finish" target="end"/>
  </state>
  <state id="b">
    <transition event="stop" target="a"/>
  </state>
  <final id="end"/>
</scxml>`;

async function setup(html = "") {
  const window = new Window();
  const document = window.document as unknown as Document;
  document.body.innerHTML = html;
  const clock = new VirtualClock();
  const s = await createSession(CHART, { clock, domParser });
  const got: [string, unknown][] = [];
  const origSend = s.send.bind(s);
  s.send = (name, data) => {
    got.push([name, data]);
    origSend(name, data);
  };
  s.start();
  clock.run();
  const $ = (sel: string) => document.querySelector(sel) as HTMLElement;
  return { window, document, clock, s, got, $ };
}

const click = (el: Element) => (el as HTMLElement).click();

describe("connect (imperative)", () => {
  test("maps DOM events to SCXML events with data", async () => {
    const { s, got, $, clock } = await setup(`<button id="b">go</button>`);
    s.connect($("#b"), "click", "go", (e) => ({ type: e.type }));
    click($("#b"));
    clock.run();
    expect(got).toEqual([["go", { type: "click" }]]);
    expect(s.activeStateIds()).toEqual(["b"]);
  });

  test("a mapping function returning null sends nothing", async () => {
    const { s, got, $ } = await setup(`<button id="b">go</button>`);
    let n = 0;
    s.connect($("#b"), "click dblclick", (e) => (e.type === "click" && n++ % 2 === 0 ? "go" : null));
    click($("#b"));
    click($("#b"));
    expect(got.map(([n]) => n)).toEqual(["go"]);
  });

  test("disposer, AbortSignal and session termination all disconnect", async () => {
    const { s, got, $, clock } = await setup(`<button id="x"></button><button id="y"></button><button id="z"></button>`);
    const dispose = s.connect($("#x"), "click", "go");
    const ac = new AbortController();
    s.connect($("#y"), "click", "go", undefined, { signal: ac.signal });
    s.connect($("#z"), "click", "finish");
    dispose();
    ac.abort();
    click($("#x"));
    click($("#y"));
    expect(got).toEqual([]);
    click($("#z")); // ends the session → its signal aborts → listener removed
    clock.run();
    expect(s.status).toBe("done");
    expect(s.signal.aborted).toBe(true);
    click($("#z"));
    expect(got).toEqual([["finish", undefined]]);
  });

  test("connecting to a finished session is a no-op", async () => {
    const { s, got, $, clock } = await setup(`<button id="b"></button>`);
    s.send("finish");
    clock.run();
    got.length = 0;
    s.connect($("#b"), "click", "go");
    click($("#b"));
    expect(got).toEqual([]);
  });
});

describe("bind (declarative)", () => {
  test("click on data-scxml-send, with static JSON data", async () => {
    const { s, got, $, document, clock } = await setup(
      `<div><span id="t" data-scxml-send="go" data-scxml-data='{"n":1}'><i id="inner">go</i></span></div>`,
    );
    s.bind(document);
    click($("#inner")); // delegation: the closest element with data-scxml-send
    clock.run();
    expect(got).toEqual([["go", { n: 1 }]]);
    expect(s.activeStateIds()).toEqual(["b"]);
  });

  test("forms send their fields on submit; submit buttons can name their own event", async () => {
    const { s, got, $, document } = await setup(`
      <form id="f" data-scxml-send="go" data-scxml-data='{"via":"form"}'>
        <input name="login" value="mallory"><input name="tag" value="a"><input name="tag" value="b">
        <button id="ok">OK</button>
        <button id="alt" data-scxml-send="stop">Stop</button>
        <button id="plain" type="button">no-op</button>
      </form>`);
    s.bind(document);
    click($("#plain"));
    click($("#ok"));
    click($("#alt"));
    expect(got).toEqual([
      ["go", { login: "mallory", tag: ["a", "b"], via: "form" }],
      ["stop", { login: "mallory", tag: ["a", "b"], via: "form" }],
    ]);
  });

  test("inputs send on change with name/value (and checked); data-scxml-on overrides", async () => {
    const { s, got, $, document, window } = await setup(`
      <input id="i" name="who" data-scxml-send="go" value="x">
      <input id="c" type="checkbox" name="flag" value="yes" data-scxml-send="stop">
      <div id="d" data-scxml-send="go" data-scxml-on="dblclick"></div>`);
    s.bind(document);
    const fire = (el: Element, type: string) => el.dispatchEvent(new window.Event(type, { bubbles: true }) as unknown as Event);
    fire($("#i"), "input"); // not a trigger
    fire($("#i"), "change");
    ($("#c") as HTMLInputElement).checked = true;
    fire($("#c"), "change");
    click($("#d")); // click is not a trigger any more
    fire($("#d"), "dblclick");
    expect(got).toEqual([
      ["go", { name: "who", value: "x" }],
      ["stop", { name: "flag", value: "yes", checked: true }],
      ["go", undefined],
    ]);
  });

  test("invalid static JSON sends nothing and reports", async () => {
    const { s, got, $, document } = await setup(`<button id="b" data-scxml-send="go" data-scxml-data="{nope">go</button>`);
    const err = spyOn(console, "error").mockImplementation(() => {});
    s.bind(document);
    click($("#b"));
    expect(got).toEqual([]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  test("reflectEnabled marks controls whose event an active state can take", async () => {
    const { s, $, document, clock } = await setup(
      `<button id="go" data-scxml-send="go"></button><button id="stop" data-scxml-send="stop"></button>`,
    );
    const dispose = s.bind(document, { reflectEnabled: true });
    expect($("#go").hasAttribute("data-scxml-enabled")).toBe(true);
    expect($("#stop").hasAttribute("data-scxml-enabled")).toBe(false);
    click($("#go"));
    clock.run();
    expect($("#go").hasAttribute("data-scxml-enabled")).toBe(false);
    expect($("#stop").hasAttribute("data-scxml-enabled")).toBe(true);
    dispose();
    expect($("#stop").hasAttribute("data-scxml-enabled")).toBe(false);
  });

  test("data-scxml-session routes controls to one of several sessions on a page", async () => {
    const { s: one, got: gotOne, $, document, clock } = await setup();
    const two = await createSession(CHART, { clock, domParser, sessionId: "two" });
    const gotTwo: string[] = [];
    const orig = two.send.bind(two);
    two.send = (n, d) => {
      gotTwo.push(n);
      orig(n, d);
    };
    two.start();
    document.body.innerHTML = `
      <button id="both" data-scxml-send="go"></button>
      <section data-scxml-session="two"><button id="only-two" data-scxml-send="go"></button></section>`;
    one.bind(document);
    two.bind(document);
    click($("#only-two"));
    expect(gotOne).toEqual([]);
    expect(gotTwo).toEqual(["go"]);
    click($("#both"));
    expect(gotOne.map(([n]) => n)).toEqual(["go"]);
    expect(gotTwo).toEqual(["go", "go"]);
  });

  test("bindings go away with the session", async () => {
    const { s, got, $, document, clock } = await setup(`<button id="b" data-scxml-send="go"></button>`);
    s.bind(document, { reflectEnabled: true });
    s.dispose();
    clock.run();
    click($("#b"));
    expect(got).toEqual([]);
    expect($("#b").hasAttribute("data-scxml-enabled")).toBe(false);
  });
});

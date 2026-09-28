import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  compile,
  createSession,
  loadQuickJS,
  parseSCXML,
  Session,
  type StateElementEvent,
  type TransitionElementEvent,
  VirtualClock,
} from "../src/index.ts";

const window = new Window();
const domParser = new window.DOMParser() as unknown as { parseFromString(s: string, t: string): Document };

const CHART = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript" initial="a">
  <state id="a">
    <transition id="ta" event="go" target="b"/>
    <state id="a1"/>
  </state>
  <state id="b">
    <transition id="tb" event="finish" target="end"/>
  </state>
  <final id="end"/>
</scxml>`;

const el = (root: Element, id: string) => root.querySelector(`[id="${id}"]`)!;

async function setup(opts: { elementEvents?: boolean; reflect?: boolean | { firedMs?: number } }) {
  const clock = new VirtualClock();
  const root = parseSCXML(CHART, domParser);
  const s = await createSession(root, { clock, domParser, ...opts });
  const log: string[] = [];
  for (const type of ["scxml:exit", "scxml:transition", "scxml:enter", "scxml:done"] as const)
    root.addEventListener(type, (e) => {
      const ev = e as StateElementEvent & TransitionElementEvent;
      const what = ev.state?.id ?? ev.transition?.element?.getAttribute("id") ?? "root";
      log.push(`${type} ${what}${ev.event ? ` (${ev.event.name})` : ""}`);
    });
  return { clock, root, s, log };
}

describe("element events", () => {
  test("exit, transition, enter — in algorithm order, bubbling to the root, after the microstep", async () => {
    const { s, clock, log, root } = await setup({ elementEvents: true });
    // listeners see a consistent configuration: the entered state is already active
    const seen: boolean[] = [];
    root.addEventListener("scxml:enter", (e) => seen.push(s.isActiveNode((e as StateElementEvent).state)));
    s.start();
    expect(log).toEqual(["scxml:enter a", "scxml:enter a1"]);
    s.send("go");
    clock.run();
    s.send("finish");
    clock.run();
    expect(log.slice(2)).toEqual([
      "scxml:exit a1 (go)",
      "scxml:exit a (go)",
      "scxml:transition ta (go)",
      "scxml:enter b (go)",
      "scxml:exit b (finish)",
      "scxml:transition tb (finish)",
      "scxml:enter end (finish)",
      "scxml:done root",
    ]);
    expect(seen).toEqual([true, true, true, true]);
  });

  test("events bubble to the owning document with typed fields", async () => {
    const { s, root } = await setup({ elementEvents: true });
    const states: string[] = [];
    root.ownerDocument.addEventListener("scxml:enter", (e) => {
      states.push(e.state.id); // typed via the DocumentEventMap augmentation
      expect(e.session).toBe(s);
      expect(e.bubbles && e.composed).toBe(true);
    });
    s.start();
    expect(states).toEqual(["a", "a1"]);
  });

  test("a throwing element listener does not break the step", async () => {
    const { s, clock, root } = await setup({ elementEvents: true });
    root.addEventListener("scxml:enter", () => {
      throw new Error("host bug");
    });
    const origError = console.error;
    console.error = () => {};
    try {
      s.start();
      s.send("go");
      clock.run();
    } finally {
      console.error = origError;
    }
    expect(s.activeStateIds()).toEqual(["b"]);
  });
});

describe("reflect", () => {
  test("keeps data-active / data-enabled / data-initial / data-status in sync", async () => {
    const { s, clock, root } = await setup({ reflect: true });
    s.start();
    const active = () => [...root.querySelectorAll("[data-active]")].map((e) => e.getAttribute("id"));
    const enabled = () => [...root.querySelectorAll("[data-enabled]")].map((e) => e.getAttribute("id"));
    expect(root.getAttribute("data-status")).toBe("running");
    expect(el(root, "a").hasAttribute("data-initial")).toBe(true);
    expect(el(root, "a1").hasAttribute("data-initial")).toBe(true);
    expect(active()).toEqual(["a", "a1"]);
    expect(enabled()).toEqual(["ta"]);

    s.send("go");
    clock.run(clock.now()); // process the event without advancing time
    expect(active()).toEqual(["b"]);
    expect(enabled()).toEqual(["tb"]);
    expect(el(root, "ta").hasAttribute("data-fired")).toBe(true);
    clock.advance(899);
    expect(el(root, "ta").hasAttribute("data-fired")).toBe(true);
    clock.advance(1);
    expect(el(root, "ta").hasAttribute("data-fired")).toBe(false);

    s.send("finish");
    clock.run();
    // after termination the final configuration stays visible, nothing is enabled
    expect(root.getAttribute("data-status")).toBe("done");
    expect(active()).toEqual(["end"]);
    expect(enabled()).toEqual([]);
  });

  test("firedMs is configurable", async () => {
    const { s, clock, root } = await setup({ reflect: { firedMs: 50 } });
    s.start();
    s.send("go");
    clock.run(clock.now());
    clock.advance(50);
    expect(el(root, "ta").hasAttribute("data-fired")).toBe(false);
  });

  test("dispose removes every attribute the session set", async () => {
    const { s, clock, root } = await setup({ reflect: true });
    s.start();
    s.send("go");
    clock.run(clock.now());
    s.dispose();
    const all = [root, ...root.querySelectorAll("*")];
    expect(all.filter((e) => [...e.attributes].some((a) => a.name.startsWith("data-")))).toEqual([]);
  });

  test("defaults are off: sessions sharing one model leave the elements alone", async () => {
    await loadQuickJS();
    const root = parseSCXML(CHART, domParser);
    const model = await compile(root);
    const clock = new VirtualClock();
    const heard: string[] = [];
    root.addEventListener("scxml:enter", (e) => heard.push((e as StateElementEvent).state.id));
    const one = new Session(model, { clock, domParser }).start();
    const two = new Session(model, { clock, domParser }).start();
    one.send("go");
    clock.run();
    expect(one.activeStateIds()).toEqual(["b"]);
    expect(two.activeStateIds()).toEqual(["a", "a1"]);
    expect(heard).toEqual([]);
    const all = [root, ...root.querySelectorAll("*")];
    expect(all.filter((e) => [...e.attributes].some((a) => a.name.startsWith("data-")))).toEqual([]);
  });
});

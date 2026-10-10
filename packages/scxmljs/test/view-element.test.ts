/**
 * <scxml-view> in happy-dom: the zero-JS paths (inline source, src), both
 * data model engines, a host-owned session, errors, sending from labels,
 * playback controls, folding and translations. happy-dom has no layout
 * engine, so boxes are sized from the element's estimates; the layout itself
 * is tested in view-layout.test.ts.
 */
import { afterAll, beforeAll, describe, expect, jest, test } from "bun:test";
import { Window } from "happy-dom";
import { PlaybackClock, VirtualClock } from "../src/index.ts";
import { createSession } from "../src/trusted.ts";
import type { ScxmlView, ViewErrorDetail, ViewLoadDetail, ViewSendDetail } from "../src/view.ts";

const window = new Window({ url: "http://localhost/charts/" });
const NS = `xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript"`;

const GLOBALS = [
  "window",
  "document",
  "HTMLElement",
  "customElements",
  "CSSStyleSheet",
  "DOMParser",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "getComputedStyle",
  "CustomEvent",
  "KeyboardEvent",
  "fetch",
] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();
const served = new Map<string, string>();

beforeAll(async () => {
  const w = window as unknown as Record<string, unknown>;
  for (const k of GLOBALS) {
    saved.set(k, Object.getOwnPropertyDescriptor(globalThis, k));
    let v = k === "window" ? window : w[k];
    if (k === "fetch")
      v = async (url: string) => {
        const text = served.get(String(url));
        return text == null ? new Response("not found", { status: 404 }) : new Response(text);
      };
    else if (typeof v === "function" && /^[a-z]/.test(k)) v = (v as (...a: unknown[]) => unknown).bind(window);
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  }
  await import("../src/view.ts");
});

afterAll(async () => {
  for (const [k, d] of saved) {
    if (d) Object.defineProperty(globalThis, k, d);
    else delete (globalThis as Record<string, unknown>)[k];
  }
  await window.happyDOM.abort();
  window.close();
});

const LIGHT = `<scxml ${NS} name="light" initial="red">
  <datamodel><data id="cycles" expr="0"/></datamodel>
  <state id="red"><transition event="go" target="green"/></state>
  <state id="green">
    <transition event="slow" target="yellow"/>
    <transition event="count"><assign location="cycles" expr="cycles + 1"/></transition>
  </state>
  <state id="yellow"><transition event="stop" cond="cycles &gt;= 0" target="red"/></state>
</scxml>`;

const frame = () => new Promise((r) => setTimeout(r, 40));
const once = <T>(el: EventTarget, type: string) =>
  new Promise<CustomEvent<T>>((resolve) => el.addEventListener(type, (e) => resolve(e as CustomEvent<T>), { once: true }));

/** Mount `<scxml-view>` with attributes and optional inline source; resolves on scxml-load / scxml-error. */
async function mount(attrs: Record<string, string> = {}, inline?: string, setup?: (el: ScxmlView) => void) {
  const el = document.createElement("scxml-view") as ScxmlView;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (inline != null) {
    const script = document.createElement("script");
    script.setAttribute("type", "application/scxml+xml");
    script.textContent = inline;
    el.append(script);
  }
  setup?.(el);
  const loaded = Promise.race([once<ViewLoadDetail>(el, "scxml-load"), once<ViewErrorDetail>(el, "scxml-error")]);
  document.body.append(el);
  const event = await loaded;
  await frame();
  return { el, event, root: el.shadowRoot! };
}
const box = (root: ShadowRoot, id: string) => root.querySelector(`[data-state="${id}"]`) as HTMLElement;
const labels = (root: ShadowRoot) => [...root.querySelectorAll<HTMLElement>(".label, .chip")];
const labelFor = (root: ShadowRoot, event: string) => labels(root).find((l) => l.textContent?.startsWith(event))!;

describe("<scxml-view>", () => {
  test("the constructor adds no attributes, so document.createElement works (HTML spec; frameworks rely on it)", () => {
    const Ctor = customElements.get("scxml-view")!;
    const el = new Ctor();
    expect(el.attributes.length).toBe(0);
    expect(el.childNodes.length).toBe(0);
  });

  test("inline source, trusted engine: draws, runs and highlights the configuration", async () => {
    const { el, event, root } = await mount({ trusted: "" }, LIGHT);
    expect(event.type).toBe("scxml-load");
    const { session, model } = (event as CustomEvent<ViewLoadDetail>).detail;
    expect(model.name).toBe("light");
    expect(session.status).toBe("running");
    expect(el.session).toBe(session);
    expect(["red", "green", "yellow"].map((id) => !!box(root, id))).toEqual([true, true, true]);
    expect(box(root, "red").getAttribute("part")).toBe("state atomic active");
    expect(box(root, "red").getAttribute("aria-label")).toBe("red, state, active");
    expect(root.querySelectorAll("path.edge").length).toBe(3);
    expect(root.querySelectorAll(".initial").length).toBe(1);
    // the targetless transition is a chip inside its box, not an edge
    expect(box(root, "green").querySelector(".chip")?.textContent).toBe("count");
    expect(labelFor(root, "stop").querySelector(".cond")?.textContent).toBe("[cycles >= 0]");
    el.remove();
    await frame();
    expect(session.status).not.toBe("running"); // the element owned it and disposed it
  });

  test("src attribute, sandboxed engine (default), relative to the page", async () => {
    served.set("http://localhost/charts/light.scxml", LIGHT);
    const { el, event, root } = await mount({ src: "light.scxml" });
    expect(event.type).toBe("scxml-load");
    const { session } = (event as CustomEvent<ViewLoadDetail>).detail;
    session.send("go");
    session.send("count");
    await frame();
    expect(session.datamodel.evaluate("cycles")).toBe(1);
    expect(box(root, "green").classList.contains("active")).toBe(true);
    el.remove();
  });

  test("clicking a label sends its event; scxml-send can cancel; inactive labels are disabled", async () => {
    const { el, root } = await mount({ trusted: "" }, LIGHT);
    const go = labelFor(root, "go") as HTMLButtonElement;
    const slow = labelFor(root, "slow") as HTMLButtonElement;
    expect(go.tagName).toBe("BUTTON");
    expect(go.disabled).toBe(false);
    expect(slow.disabled).toBe(true);
    expect(go.getAttribute("part")).toBe("transition edge-label live");
    expect(go.getAttribute("aria-label")).toBe("go → green");

    const cancel = (e: Event) => {
      if ((e as CustomEvent<ViewSendDetail>).detail.name === "go") e.preventDefault();
    };
    el.addEventListener("scxml-send", cancel);
    go.click();
    await frame();
    expect(el.session!.isActive("red")).toBe(true);
    el.removeEventListener("scxml-send", cancel);

    go.click();
    await frame();
    expect(el.session!.isActive("green")).toBe(true);
    expect(box(root, "green").classList.contains("active")).toBe(true);
    const fresh = labelFor(root, "go");
    expect(fresh.classList.contains("fired")).toBe(true);
    expect(fresh.getAttribute("part")).toContain("fired");
    expect((labelFor(root, "slow") as HTMLButtonElement).disabled).toBe(false);
    el.remove();
  });

  test("clicked events: data from event-data or scxml-send, and feedback when nothing changes", async () => {
    // the docs' login chart: its guard reads _event.data.user, so a bare click can't sign in
    const LOGIN = await Bun.file(new URL("../../../docs/examples/login.scxml", import.meta.url)).text();
    const status = (root: ShadowRoot) => root.querySelector<HTMLElement>(".send-status")!;

    // no data: the guard throws (counts as false) and the element says why nothing happened
    const a = await mount({ trusted: "" }, LOGIN);
    (labelFor(a.root, "login") as HTMLButtonElement).click();
    await frame();
    expect(a.el.session!.isActive("signed-out")).toBe(true);
    expect(status(a.root).hidden).toBe(false);
    expect(status(a.root).textContent).toContain("login raised an error, so nothing changed");
    expect(status(a.root).getAttribute("part")).toBe("send-status");
    a.el.remove();

    // event-data supplies the data for clicks, per event name
    const b = await mount({ trusted: "", "event-data": JSON.stringify({ login: { user: "ada" } }) }, LOGIN);
    (labelFor(b.root, "login") as HTMLButtonElement).click();
    await frame();
    expect(b.el.session!.isActive("signed-in")).toBe(true);
    expect(b.el.session!.snapshot().user).toBe("ada");
    expect(status(b.root).hidden).toBe(true);
    (labelFor(b.root, "logout") as HTMLButtonElement).click();
    await frame();

    // a guard that is merely false: "changed nothing"
    b.el.setAttribute("event-data", JSON.stringify({ login: { user: "" } }));
    (labelFor(b.root, "login") as HTMLButtonElement).click();
    await frame();
    expect(b.el.session!.isActive("signed-out")).toBe(true);
    expect(status(b.root).textContent).toContain("login changed nothing");

    // scxml-send listeners can set the data themselves
    b.el.addEventListener("scxml-send", (e) => {
      (e as CustomEvent<ViewSendDetail>).detail.data = { user: "grace" };
    });
    (labelFor(b.root, "login") as HTMLButtonElement).click();
    await frame();
    expect(b.el.session!.snapshot().user).toBe("grace");
    expect(status(b.root).hidden).toBe(true);
    b.el.remove();
  });

  test('interactive="false" draws labels as text; autostart="false" doesn\'t run', async () => {
    const { el, root } = await mount({ trusted: "", interactive: "false", autostart: "false" }, LIGHT);
    expect(labels(root).every((l) => l.tagName === "SPAN")).toBe(true);
    expect(el.session!.status).not.toBe("running");
    expect(root.querySelector(".active")).toBeNull();
    el.remove();
  });

  test("append first, then set a host session (the order frameworks use): the session stays", async () => {
    const clock = new VirtualClock();
    const session = await createSession(LIGHT, { clock });
    const el = document.createElement("scxml-view") as ScxmlView;
    document.body.append(el); // queues a load of src / inline source…
    el.session = session; // …which must not replace or dispose the host's session
    await frame();
    await frame();
    expect(el.session).toBe(session);
    expect(session.status).toBe("idle");
    expect(box(el.shadowRoot!, "red")).toBeTruthy();
    el.remove();
    session.dispose();
  });

  test("a host-owned session: shown, never started or disposed by the element", async () => {
    const clock = new VirtualClock();
    const session = await createSession(LIGHT, { clock });
    const el = document.createElement("scxml-view") as ScxmlView;
    let loads = 0;
    el.addEventListener("scxml-load", () => loads++);
    el.session = session;
    document.body.append(el);
    await frame();
    const root = el.shadowRoot!;
    expect(session.status).not.toBe("running");
    expect(box(root, "red")).toBeTruthy();
    session.start();
    session.send("go");
    clock.run();
    await frame();
    expect(box(root, "green").classList.contains("active")).toBe(true);
    el.remove();
    await frame();
    expect(session.status).toBe("running");
    expect(loads).toBe(0);
    session.dispose();
  });

  test("nothing to show (yet) is a quiet hint, not an error: a host may set session later", async () => {
    const el = document.createElement("scxml-view") as ScxmlView;
    const events: string[] = [];
    el.addEventListener("scxml-error", () => events.push("error"));
    document.body.append(el);
    await new Promise((r) => setTimeout(r, 20));
    expect(events).toEqual([]);
    expect(el.shadowRoot!.querySelector("[part=empty]")?.textContent).toContain("No SCXML to show");
    expect((el.shadowRoot!.querySelector("[part=error]") as HTMLElement).hidden).toBe(true);
    el.remove();
  });

  test("a terminated session keeps showing where it ended, marked reached (the spec empties the configuration)", async () => {
    const chart = `<scxml ${NS} initial="on"><state id="on"><transition event="off" target="done"/></state><final id="done"/></scxml>`;
    const { el, root } = await mount({ trusted: "" }, chart);
    el.session!.send("off");
    await el.session!.done;
    await frame();
    expect(el.session!.status).toBe("done");
    expect(box(root, "done").getAttribute("part")).toBe("state final reached");
    expect(box(root, "done").getAttribute("aria-label")).toContain("reached");
    expect(box(root, "on").getAttribute("part")).toBe("state atomic");
    el.remove();
  });

  test("errors: invalid charts, bad data attribute, missing file", async () => {
    const bad = await mount({ trusted: "" }, `<scxml ${NS} initial="nowhere"><state id="a"/></scxml>`);
    const detail = (bad.event as CustomEvent<ViewErrorDetail>).detail;
    expect(bad.event.type).toBe("scxml-error");
    expect(detail.problems?.length ?? 0).toBeGreaterThan(0);
    expect(bad.root.querySelectorAll(".error li").length).toBe(detail.problems!.length);
    expect(bad.root.querySelector("[part=error] h2")?.textContent).toBe("This chart can't be shown");
    bad.el.remove();

    const data = await mount({ trusted: "", data: "{nope" }, LIGHT);
    expect((data.event as CustomEvent<ViewErrorDetail>).detail.message).toContain("not valid JSON");
    data.el.remove();

    const missing = await mount({ src: "missing.scxml" });
    expect((missing.event as CustomEvent<ViewErrorDetail>).detail.message).toContain("HTTP 404");
    missing.el.remove();
  });

  test("the data attribute and the options property configure the session", async () => {
    const { el } = await mount({ trusted: "", data: '{"cycles": 41}' }, LIGHT, (v) => {
      v.options = { data: { extra: true } };
    });
    expect(el.session!.datamodel.evaluate("cycles")).toBe(41);
    el.remove();
  });

  test("a PlaybackClock adds controls; Step runs to the next macrostep", async () => {
    const clock = new PlaybackClock({ playing: false });
    const chart = `<scxml ${NS} initial="a">
      <state id="a"><onentry><send event="t" delay="1s"/></onentry><transition event="t" target="b"/></state>
      <state id="b"/>
    </scxml>`;
    const { el, root } = await mount({ trusted: "" }, chart, (v) => {
      v.clock = clock;
    });
    const controls = root.querySelector<HTMLElement>(".controls")!;
    const play = root.querySelector<HTMLButtonElement>(".play")!;
    const step = root.querySelector<HTMLButtonElement>(".step")!;
    const speed = root.querySelector<HTMLButtonElement>(".speeds")!;
    expect(controls.hidden).toBe(false);
    expect(play.getAttribute("aria-label")).toBe("Play");
    expect(step.hidden).toBe(false);
    expect(speed.textContent).toBe("1×");
    expect(el.session!.isActive("a")).toBe(true);
    step.click();
    await frame();
    expect(el.session!.isActive("b")).toBe(true);
    expect(root.querySelector(".clock")?.textContent).toBe("t = 1.0 s");
    el.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(clock.playing).toBe(true);
    await frame();
    // while playing: pause, and no Step
    expect(play.getAttribute("aria-label")).toBe("Pause");
    expect(step.hidden).toBe(true);
    clock.pause();
    await frame();
    expect(step.hidden).toBe(false);
    // one speed button, cycling
    speed.click();
    expect(clock.speed).toBe(2);
    await frame();
    expect(speed.textContent).toBe("2×");
    expect(speed.getAttribute("aria-label")).toBe("Speed 2×");
    speed.click();
    speed.click();
    expect(clock.speed).toBe(0.25);
    el.remove();
  });

  test("large charts fold beyond max-states; Expand and Expand all unfold", async () => {
    const group = (g: number) =>
      `<state id="g${g}" initial="g${g}s0">${Array.from({ length: 8 }, (_, i) => `<state id="g${g}s${i}"><transition event="n" target="g${g}s${(i + 1) % 8}"/></state>`).join("")}</state>`;
    const chart = `<scxml ${NS} initial="g0">${[0, 1, 2].map(group).join("")}</scxml>`;
    const { el, root } = await mount({ trusted: "", "max-states": "12" }, chart);
    const folded = [...root.querySelectorAll<HTMLElement>(".box.collapsed")];
    expect(folded.length).toBeGreaterThan(0);
    expect(root.querySelectorAll(".box").length).toBeLessThanOrEqual(12);
    expect(folded[0]!.querySelector(".badge-count")?.textContent).toBe("8 states");
    const notice = root.querySelector<HTMLElement>(".notice")!;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toContain("folded into");

    folded[0]!.querySelector<HTMLButtonElement>(".expand")!.click();
    const id = folded[0]!.dataset.state!;
    expect(box(root, id).classList.contains("collapsed")).toBe(false);
    expect(box(root, id).querySelector(".collapse")).toBeTruthy();
    box(root, id).querySelector<HTMLButtonElement>(".collapse")!.click();
    expect(box(root, id).classList.contains("collapsed")).toBe(true);

    notice.querySelector("button")!.click();
    expect(root.querySelectorAll(".box.collapsed").length).toBe(0);
    expect(root.querySelectorAll(".box").length).toBe(27);
    el.remove();
  });

  test("strings translate the UI; source replaces the chart; reload restarts", async () => {
    const { el, root } = await mount({ trusted: "" }, LIGHT, (v) => {
      v.strings = { stateLabel: (name, _kind, active) => `${name}${active ? " (aktiv)" : ""}` };
    });
    expect(box(root, "red").getAttribute("aria-label")).toBe("red (aktiv)");
    expect(el.strings.expand).toBe("Expand");

    let next = once<ViewLoadDetail>(el, "scxml-load");
    el.source = `<scxml ${NS} name="other"><state id="only"/></scxml>`;
    expect((await next).detail.model.name).toBe("other");
    await frame();
    expect(box(root, "only")).toBeTruthy();

    const first = el.session;
    next = once<ViewLoadDetail>(el, "scxml-load");
    el.reload();
    expect((await next).detail.session).not.toBe(first);
    el.remove();
  });

  test("direction: explicit, and the diagram has an accessible name", async () => {
    const right = await mount({ trusted: "", direction: "right" }, LIGHT);
    const down = await mount({ trusted: "", direction: "down" }, LIGHT);
    const pos = (r: ShadowRoot, id: string) => ({
      x: Number.parseFloat(box(r, id).style.left),
      y: Number.parseFloat(box(r, id).style.top),
    });
    expect(pos(right.root, "green").x).toBeGreaterThan(pos(right.root, "red").x);
    expect(pos(down.root, "green").y).toBeGreaterThan(pos(down.root, "red").y);
    expect(right.root.querySelector(".diagram")?.getAttribute("aria-label")).toBe("Statechart light");
    right.el.remove();
    down.el.remove();
  });
  test("layers run top to bottom by default", async () => {
    const { el, root } = await mount({ trusted: "" }, LIGHT);
    expect(el.direction).toBe("down");
    expect(Number.parseFloat(box(root, "green").style.top)).toBeGreaterThan(Number.parseFloat(box(root, "red").style.top));
    el.remove();
  });

  const DOCUMENTED = `<scxml ${NS} name="shop" initial="cart">
    <!-- The customer is still choosing. -->
    <state id="cart"><transition event="checkout" target="pay"/></state>
    <!--
      Taking the money.
        Retries twice.
    -->
    <state id="pay" initial="card">
      <!-- ── accepted everywhere ─────────── -->
      <transition event="cancel" target="cart"/>
      <!-- ── card: the form ───────────────── -->
      <state id="card"><transition event="ok" target="done"/></state>
    </state>
    <parallel id="p"><state id="r1"/><state id="r2"/></parallel>
    <final id="done"/>
  </scxml>`;

  test("every state has a help button explaining it: XML comments, or the descriptions property", async () => {
    const { el, root } = await mount({ trusted: "" }, DOCUMENTED);
    for (const id of ["cart", "pay", "card", "p", "r1", "done"]) expect(box(root, id).querySelector("button.help")).toBeTruthy();
    expect(el.describe(el.model!.states.find((s) => s.id === "cart")!)).toBe("The customer is still choosing.");
    // a comment documents the element after it (here a transition, not "pay"); dividers lose their rules
    expect(el.describe(el.model!.states.find((s) => s.id === "pay")!)).toBe("Taking the money.\n  Retries twice.");
    expect(el.describe(el.model!.states.find((s) => s.id === "card")!)).toBe("card: the form");
    expect(el.describe(el.model!.states.find((s) => s.id === "r1")!)).toBeUndefined();

    const help = box(root, "cart").querySelector<HTMLButtonElement>("button.help")!;
    expect(help.getAttribute("aria-label")).toBe("About cart");
    help.click();
    const pop = root.querySelector<HTMLElement>(".help-popover")!;
    expect(pop.hidden).toBe(false);
    expect(help.getAttribute("aria-expanded")).toBe("true");
    expect(pop.querySelector(".help-text")?.textContent).toBe("The customer is still choosing.");
    expect(pop.querySelector(".help-transitions")?.textContent).toBe("checkout → pay");
    pop.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(pop.hidden).toBe(true);
    expect(root.activeElement).toBe(help);

    box(root, "r1").querySelector<HTMLButtonElement>("button.help")!.click();
    expect(pop.querySelector(".help-none")).toBeTruthy();
    el.descriptions = { r1: "The first region." };
    expect(pop.querySelector(".help-text")?.textContent).toBe("The first region.");
    el.descriptions = (s) => (s.id === "cart" ? "Overridden." : undefined);
    expect(el.describe(el.model!.states.find((s) => s.id === "cart")!)).toBe("Overridden.");
    expect(el.describe(el.model!.states.find((s) => s.id === "card")!)).toBe("card: the form");
    el.remove();
  });

  test("every compound and parallel state folds and unfolds", async () => {
    const { el, root } = await mount({ trusted: "" }, DOCUMENTED);
    expect(box(root, "cart").querySelector(".toggle")).toBeNull();
    for (const id of ["pay", "p"]) {
      const toggle = box(root, id).querySelector<HTMLButtonElement>(".toggle.collapse")!;
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      toggle.click();
      expect(box(root, id).classList.contains("collapsed")).toBe(true);
    }
    expect(box(root, "card")).toBeNull();
    expect(box(root, "pay").querySelector(".badge-count")?.textContent).toBe("1 state");
    box(root, "pay").querySelector<HTMLButtonElement>(".toggle.expand")!.click();
    expect(box(root, "card")).toBeTruthy();
    expect(root.activeElement).toBe(box(root, "pay").querySelector(".toggle"));
    // folding by hand isn't a "large chart": no notice
    expect(root.querySelector<HTMLElement>(".notice")!.hidden).toBe(true);
    el.remove();
  });

  test("far transitions are chips in their source's box that name their target, and mark it on hover", async () => {
    const FAR = `<scxml ${NS} initial="top"><state id="top" initial="idle">
        <transition event="reset" target="idle"/>
        <state id="idle"><transition event="go" target="busy"/></state>
        <state id="busy"/>
      </state></scxml>`;
    const { el, root } = await mount({ trusted: "" }, FAR);
    const chip = box(root, "top").querySelector<HTMLButtonElement>(".chip.portal")!;
    expect(chip.textContent).toBe("reset→ idle");
    expect(chip.getAttribute("part")).toContain("portal");
    expect(
      labels(root)
        .filter((l) => l.classList.contains("label"))
        .map((l) => l.textContent),
    ).toEqual(["go"]);
    chip.dispatchEvent(new window.Event("pointerenter") as unknown as Event);
    expect(box(root, "idle").classList.contains("portal-target")).toBe(true);
    chip.dispatchEvent(new window.Event("pointerleave") as unknown as Event);
    expect(box(root, "idle").classList.contains("portal-target")).toBe(false);
    chip.click();
    expect(el.session!.isActive("idle")).toBe(true);
    el.remove();
  });

  test("zoom: toolbar, keys, and back to automatic", async () => {
    const { el, root } = await mount({ trusted: "" }, LIGHT);
    const diagram = root.querySelector<HTMLElement>(".diagram")!;
    const fit = root.querySelector<HTMLButtonElement>(".zoom-reset")!;
    // "fit" only once the view has left fit-to-width
    expect(fit.hidden).toBe(true);
    expect(el.zoom).toBe(1);
    root.querySelector<HTMLButtonElement>(".zoom-in")!.click();
    expect(el.zoom).toBe(1.25);
    expect(diagram.style.transform).toBe("scale(1.25)");
    expect(root.querySelector(".zoom-level")?.textContent).toBe("125%");
    expect(fit.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>(".viewport")!.hasAttribute("data-zooming")).toBe(true);
    const canvas = root.querySelector<HTMLElement>(".canvas")!;
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "-", bubbles: true }));
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "-", bubbles: true }));
    expect(el.zoom).toBe(0.8);
    el.zoom = 100;
    expect(el.zoom).toBe(4);
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "0", bubbles: true }));
    expect(el.zoom).toBe(1);
    expect(diagram.style.transform).toBe("");
    expect(fit.hidden).toBe(true);
    el.remove();
  });

  test("input: wheel and drag take over the view; touch scrolls, pinches and double-taps", async () => {
    const { el, root } = await mount({ trusted: "" }, LIGHT);
    const w = window as unknown as Record<string, new (type: string, init?: object) => Event>;
    const canvas = root.querySelector<HTMLElement>(".canvas")!;
    const fit = root.querySelector<HTMLButtonElement>(".zoom-reset")!;
    const fire = (type: keyof typeof w, name: string, init: Record<string, unknown>) => {
      const e = new w[type]!(name, { bubbles: true, cancelable: true, composed: true, ...init });
      // happy-dom's WheelEvent drops some init fields (ctrlKey, clientX…): set what it didn't take
      for (const [k, v] of Object.entries(init))
        if ((e as unknown as Record<string, unknown>)[k] !== v) Object.defineProperty(e, k, { value: v });
      return canvas.dispatchEvent(e);
    };
    // a plain wheel scrolls: the view is the user's now ("fit" offers the way back)
    fire("WheelEvent", "wheel", { deltaY: 40 });
    expect(fit.hidden).toBe(false);
    // Ctrl + wheel zooms
    fire("WheelEvent", "wheel", { deltaY: -100, ctrlKey: true, clientX: 5, clientY: 5 });
    expect(el.zoom).toBeGreaterThan(1.1);
    fit.click();
    expect(el.zoom).toBe(1);
    expect(fit.hidden).toBe(true);
    // dragging the background pans
    fire("PointerEvent", "pointerdown", { button: 0, pointerType: "mouse", pointerId: 1, clientX: 10, clientY: 10 });
    fire("PointerEvent", "pointermove", { pointerId: 1, clientX: 60, clientY: 40 });
    expect(canvas.classList.contains("panning")).toBe(true);
    expect(fit.hidden).toBe(false);
    fire("PointerEvent", "pointerup", { pointerId: 1 });
    expect(canvas.classList.contains("panning")).toBe(false);
    fit.click();
    // touch: a double tap zooms in on the spot, another goes back to fit
    const touch = (x: number, y: number, id = 0) => ({ identifier: id, clientX: x, clientY: y, target: canvas });
    const tap = () => {
      fire("TouchEvent", "touchstart", { touches: [touch(20, 20)] });
      fire("TouchEvent", "touchend", { touches: [], changedTouches: [touch(20, 20)] });
    };
    tap();
    tap();
    expect(el.zoom).toBe(2);
    tap();
    tap();
    expect(el.zoom).toBe(1);
    // one finger moving scrolls by hand
    fire("TouchEvent", "touchstart", { touches: [touch(20, 20)] });
    fire("TouchEvent", "touchmove", { touches: [touch(20, 60)] });
    fire("TouchEvent", "touchend", { touches: [], changedTouches: [touch(20, 60)] });
    expect(fit.hidden).toBe(false);
    fit.click();
    // two fingers pinch
    fire("TouchEvent", "touchstart", { touches: [touch(10, 10, 1), touch(50, 10, 2)] });
    fire("TouchEvent", "touchmove", { touches: [touch(0, 10, 1), touch(80, 10, 2)] });
    fire("TouchEvent", "touchend", { touches: [] });
    expect(el.zoom).toBe(2);
    el.remove();
  });

  test("while playing untouched, the playback controls shrink to the play button; movement brings them back", async () => {
    const clock = new PlaybackClock({ playing: true });
    const { el, root } = await mount({ trusted: "" }, LIGHT, (v) => {
      v.clock = clock;
    });
    const controls = root.querySelector<HTMLElement>(".controls")!;
    const viewport = root.querySelector<HTMLElement>(".viewport")!;
    const move = () => viewport.dispatchEvent(new window.Event("pointermove", { bubbles: true }) as unknown as Event);
    jest.useFakeTimers();
    try {
      move();
      expect(controls.classList.contains("idle")).toBe(false);
      jest.advanceTimersByTime(3100);
      expect(controls.classList.contains("idle")).toBe(true);
      move();
      expect(controls.classList.contains("idle")).toBe(false);
      // paused: they stay
      clock.pause();
      move();
      jest.advanceTimersByTime(5000);
      expect(controls.classList.contains("idle")).toBe(false);
    } finally {
      jest.useRealTimers();
    }
    el.remove();
  });

  test("authoring warnings are listed above the diagram, focus their state, and can be hidden", async () => {
    const TRAP = `<scxml ${NS} name="trap"><parallel id="floor">
        <state id="assignment"><state id="none"/><state id="team"/><transition event="assign" target="team"/></state>
        <state id="sla"/></parallel><state id="orphan"/></scxml>`;
    const { el, root } = await mount({ trusted: "" }, TRAP);
    const panel = root.querySelector(".warnings") as HTMLDetailsElement;
    expect(panel.hidden).toBe(false);
    expect(panel.getAttribute("part")).toBe("warnings");
    expect(panel.querySelector("summary")?.textContent).toBe("⚠ 2 warnings about this chart");
    const items = [...panel.querySelectorAll("li")];
    expect(items.map((i) => i.dataset.code)).toEqual(["SCXML_W_EXITS_PARALLEL", "SCXML_W_UNREACHABLE"]);
    items[1]!.querySelector("button")!.click();
    expect(root.activeElement).toBe(box(root, "orphan"));
    el.setAttribute("warnings", "off");
    await frame();
    expect(panel.hidden).toBe(true);
    el.remove();
    // a clean chart shows no panel
    const clean = await mount({ trusted: "" }, LIGHT);
    expect((clean.root.querySelector(".warnings") as HTMLElement).hidden).toBe(true);
    clean.el.remove();
  });
});

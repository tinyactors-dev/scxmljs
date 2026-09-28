/**
 * <scxml-view> in happy-dom: the zero-JS paths (inline source, src), both
 * data model engines, a host-owned session, errors, sending from labels,
 * playback controls, folding and translations. happy-dom has no layout
 * engine, so boxes are sized from the element's estimates; the layout itself
 * is tested in view-layout.test.ts.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
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
    expect(controls.hidden).toBe(false);
    expect(root.querySelector(".play")?.textContent).toBe("▶ Play");
    expect(root.querySelectorAll(".speeds button").length).toBe(5);
    expect(el.session!.isActive("a")).toBe(true);
    root.querySelector<HTMLButtonElement>(".step")!.click();
    await frame();
    expect(el.session!.isActive("b")).toBe(true);
    expect(root.querySelector(".clock")?.textContent).toBe("t = 1.0 s");
    el.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(clock.playing).toBe(true);
    clock.pause();
    root.querySelector<HTMLButtonElement>('.speeds [data-speed="2"]')!.click();
    expect(clock.speed).toBe(2);
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

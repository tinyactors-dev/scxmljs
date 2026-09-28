/**
 * <scxml-explorer> in happy-dom: rendering, navigation, sending, playback,
 * windowing and the element API. Layout-dependent parts (container queries,
 * measured arrows) aren't testable here; their logic is (e.g. tab switching).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { ExplorerFocusDetail, ExplorerSendDetail, ScxmlExplorer } from "../src/explorer/element.ts";
import { type Clock, createSession, PlaybackClock, type Session, VirtualClock } from "../src/index.ts";

const window = new Window({ url: "http://localhost/" });
const domParser = new window.DOMParser() as unknown as { parseFromString(s: string, t: string): Document };
const NS = `xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript"`;

// The element needs a DOM: install happy-dom's globals for this file only, then load it.
const GLOBALS = [
  "window",
  "document",
  "HTMLElement",
  "customElements",
  "CSSStyleSheet",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "getComputedStyle",
  "matchMedia",
  "CSS",
  "CustomEvent",
  "MouseEvent",
  "KeyboardEvent",
] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();

beforeAll(async () => {
  const w = window as unknown as Record<string, unknown>;
  for (const k of GLOBALS) {
    saved.set(k, Object.getOwnPropertyDescriptor(globalThis, k));
    let v = k === "window" ? window : w[k];
    if (typeof v === "function" && /^[a-z]/.test(k)) v = (v as (...a: unknown[]) => unknown).bind(window);
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  }
  await import("../src/explorer/element.ts");
});

afterAll(async () => {
  for (const [k, d] of saved) {
    if (d) Object.defineProperty(globalThis, k, d);
    else delete (globalThis as Record<string, unknown>)[k];
  }
  await window.happyDOM.abort();
  window.close();
});

const frame = () => new Promise((r) => setTimeout(r, 40));

async function mount(source: string, clock: Clock = new VirtualClock()) {
  const session = await createSession(source, { clock, domParser });
  const el = document.createElement("scxml-explorer") as ScxmlExplorer;
  document.body.append(el);
  el.attach({ session, clock });
  session.start();
  // run a plain VirtualClock to settle; a PlaybackClock is left for the test to step
  if (clock instanceof VirtualClock && !(clock instanceof PlaybackClock)) clock.run();
  await frame();
  const root = el.shadowRoot!;
  const $$ = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
  const $ = (sel: string) => root.querySelector<HTMLElement>(sel);
  return { session, el, root, $, $$, clock };
}

const SHOP = `<scxml ${NS} name="shop" initial="work">
  <state id="work" initial="idle">
    <transition event="reset" target="work"/>
    <state id="idle"><transition event="go" target="busy"/></state>
    <state id="busy" initial="b1">
      <state id="b1"><transition event="next" target="b2"/></state>
      <state id="b2"><transition event="back" target="idle"/></state>
    </state>
  </state>
  <final id="done"/>
</scxml>`;

describe("<scxml-explorer>", () => {
  test("the constructor adds no attributes, so document.createElement works (HTML spec; frameworks rely on it)", () => {
    const Ctor = customElements.get("scxml-explorer")!;
    const el = new Ctor();
    expect(el.attributes.length).toBe(0);
    expect(el.childNodes.length).toBe(0);
  });

  test("renders the tree, the focus and part hooks; follows the active state", async () => {
    const { $, $$, el, session } = await mount(SHOP);
    expect($$(".tree-row").map((r) => r.querySelector(".name")?.textContent)).toEqual(["work", "idle", "busy", "done"]);
    expect($("h2.title")?.textContent).toBe("work"); // follow: the parent of the active leaf
    expect($$('[part~="tree-row"][part~="active"]').map((r) => r.querySelector(".name")?.textContent)).toEqual(["idle"]);
    expect($$('[part~="card"]').length + $$('[part~="list-row"]').length).toBeGreaterThan(0);
    expect(el.follow).toBe(true);
    session.dispose();
    el.remove();
  });

  test("navigating fires scxml-focus and stops following", async () => {
    const { $, $$, el, session } = await mount(SHOP);
    const seen: string[] = [];
    document.addEventListener("scxml-focus", (e) => seen.push((e as CustomEvent<ExplorerFocusDetail>).detail.state.id));
    $$(".tree-row")
      .find((r) => r.querySelector(".name")?.textContent === "busy")!
      .click();
    await frame();
    expect($("h2.title")?.textContent).toBe("busy");
    expect(seen.at(-1)).toBe("busy");
    expect([el.follow, el.getAttribute("follow")]).toEqual([false, "false"]);
    session.dispose();
    el.remove();
  });

  test("Send buttons send into the session; scxml-send can cancel", async () => {
    const { $$, el, session, clock } = await mount(SHOP);
    const sent: string[] = [];
    el.addEventListener("scxml-send", (e) => {
      const d = (e as CustomEvent<ExplorerSendDetail>).detail;
      sent.push(d.name);
      if (d.name === "reset") e.preventDefault();
    });
    const sendButton = (name: string) => {
      const row = $$(".ev-row").find((r) => r.querySelector(".ev")?.textContent === name);
      if (!row) throw new Error(`no accepted event ${name}`);
      return row.querySelector("button")!;
    };
    sendButton("reset").click(); // cancelled by the host
    (clock as VirtualClock).run();
    expect(session.activeStateIds()).toEqual(["work", "idle"]);
    sendButton("go").click();
    (clock as VirtualClock).run();
    expect(sent).toEqual(["reset", "go"]);
    expect(session.activeStateIds()).toEqual(["work", "busy", "b1"]);
    session.dispose();
    el.remove();
  });

  test("Step advances exactly one macrostep on a PlaybackClock", async () => {
    const clock = new PlaybackClock({ playing: false });
    const { $, el, session } = await mount(
      `<scxml ${NS}>
        <state id="a"><onentry><send event="t1" delay="1s"/><send event="t2" delay="2s"/></onentry><transition event="t1" target="b"/></state>
        <state id="b"><transition event="t2" target="c"/></state>
        <state id="c"/>
      </scxml>`,
      clock,
    );
    expect($(".playback")?.hidden).toBe(false);
    let steps = 0;
    session.addEventListener("macrostep", () => steps++);
    $(".step")!.click();
    expect([steps, session.activeStateIds()]).toEqual([1, ["b"]]);
    expect(clock.now()).toBe(1000);
    $(".step")!.click();
    expect([steps, session.activeStateIds()]).toEqual([2, ["c"]]);
    await frame();
    expect($(".clock-time")?.textContent).toBe("t = 2.0 s");
    expect($(".last-step")?.textContent).toContain("t2");
    clock.dispose();
    session.dispose();
    el.remove();
  });

  test("the tree is windowed: 1,000 states, a few dozen rows in the DOM", async () => {
    const states = Array.from({ length: 1000 }, (_, i) => `<state id="s${i}"/>`).join("");
    const { $, $$, el, session } = await mount(`<scxml ${NS}>${states}</scxml>`);
    expect($(".pane-head .count")?.textContent).toBe(""); // a count only while filtering
    expect($$(".tree-row").length).toBeGreaterThan(10);
    expect($$(".tree-row").length).toBeLessThan(80);
    session.dispose();
    el.remove();
  });

  test("narrow-layout tabs switch the visible pane", async () => {
    const { $, $$, el, session } = await mount(SHOP);
    const tab = (label: string) => $$(".tabs button").find((b) => b.textContent === label)!;
    expect($$(".tabs button").map((b) => b.textContent)).toEqual(["System", "States", "Focus", "Accepts", "Detail"]);
    tab("States").click();
    expect($(".tree-pane")?.hasAttribute("data-tab-active")).toBe(true);
    tab("Accepts").click();
    expect($(".inspector")?.hasAttribute("data-tab-active")).toBe(true);
    expect($(".tree-pane")?.hasAttribute("data-tab-active")).toBe(false);
    tab("System").click();
    await frame();
    expect($(".system")).not.toBeNull();
    expect($$(".machine").map((m) => m.querySelector(".name")?.textContent)).toEqual(["shop"]);
    session.dispose();
    el.remove();
  });

  test("properties, the follow attribute and detach()", async () => {
    const clock = new VirtualClock();
    const session: Session = await createSession(SHOP, { clock, domParser });
    const el = document.createElement("scxml-explorer") as ScxmlExplorer;
    el.setAttribute("follow", "false");
    document.body.append(el);
    expect(el.follow).toBe(false);
    el.session = session; // setting the property attaches
    session.start();
    clock.run();
    await frame();
    // even without follow, the first configuration expands the active path once
    expect([...el.shadowRoot!.querySelectorAll(".tree-row .name")].map((n) => n.textContent)).toEqual(["work", "idle", "busy", "done"]);
    expect(el.shadowRoot!.querySelector("h2.title")?.textContent).toBe("shop"); // …but the focus stays put
    expect(el.clock).toBeUndefined(); // falls back to session.clock internally
    el.follow = true;
    expect(el.getAttribute("follow")).toBe("true");
    el.detach();
    expect(el.session).toBeUndefined();
    expect(el.shadowRoot!.querySelectorAll(".tree-row").length).toBe(0);
    session.dispose();
    el.remove();
  });
  test("a state's authoring warnings appear in its detail", async () => {
    // SHOP's <final id="done"/> can never be entered: nothing leads to it
    const { session, $, $$ } = await mount(SHOP);
    expect(session.model.warnings.map((w) => [w.code, w.state?.id])).toEqual([["SCXML_W_UNREACHABLE", "done"]]);
    // focus its parent (the machine) through the tree, then select it in the focus pane
    $$(".tree-row")
      .find((r) => r.querySelector(".name")?.textContent === "done")!
      .click();
    await frame();
    $('[data-state="done"]')!.click(); // a leaf row opens in place…
    await frame();
    $('[data-state="done"] [part~="open-detail"]')!.click(); // …and links to the detail
    await frame();
    const items = [...$(".detail")!.querySelectorAll<HTMLElement>("ul.warnings li")];
    expect(items.map((li) => [li.getAttribute("part"), li.dataset.code])).toEqual([["warning", "SCXML_W_UNREACHABLE"]]);
    expect(items[0]!.textContent).toContain('State "done" can never be entered');
    // states without warnings don't get the section (a container row drills in; the detail follows)
    $('[data-state="work"]')!.click();
    await frame();
    expect($(".detail h2")?.textContent).toBe("work");
    expect($(".detail ul.warnings")).toBeNull();
  });
});

test("the explorer entry can be imported without a DOM (server-side rendering)", () => {
  const entry = new URL("../src/explorer.ts", import.meta.url).pathname;
  const run = Bun.spawnSync([
    "bun",
    "-e",
    `const m = await import(${JSON.stringify(entry)}); console.log(typeof m.ScxmlExplorer, typeof m.focusScope)`,
  ]);
  expect(run.stderr.toString()).toBe("");
  expect(run.stdout.toString().trim()).toBe("function function");
});

// ─────────────────────────── views and details ───────────────────────────

const outside = Array.from({ length: 8 }, (_, i) => `<state id="o${i + 1}"/>`).join("");
const spokes = Array.from(
  { length: 8 },
  (_, i) => `<state id="s${i + 1}"><transition event="leave.${i + 1}" target="o${i + 1}"/><transition event="home" target="hub"/></state>`,
).join("");
const RICH = `<scxml ${NS} name="rich" initial="main">
  <datamodel><data id="x" expr="1"/></datamodel>
  <state id="main" initial="hub">
    <datamodel><data id="y" expr="2"/></datamodel>
    <onentry>
      <log label="hello" expr="x"/><assign location="x" expr="x + 1"/><raise event="boot"/>
      <send id="t" event="tick" delay="5s"/><send type="echo" event="ping" target="svc"/>
    </onentry>
    <onexit><cancel sendid="t"/></onexit>
    <state id="hub">
      <onentry>
        <if cond="x &gt; 0"><log expr="'pos'"/></if>
        <foreach array="[1, 2]" item="i"><log expr="i"/></foreach>
        <script>var z = 3;</script>
      </onentry>
      ${Array.from({ length: 8 }, (_, i) => `<transition event="go.${i + 1}" target="s${i + 1}"/>`).join("")}
      <transition event="data.*" cond="x &gt; 100" target="s2"/>
      <transition event="*" cond="false"/>
      <transition event="to.par" target="par"/>
      <transition event="to.kid" target="kidHost"/>
    </state>
    ${spokes}
    <parallel id="par">
      <state id="r1"><state id="r1a"/><state id="r1b"/></state>
      <state id="r2"><state id="r2a"/></state>
    </parallel>
    <state id="kidHost">
      <invoke id="kid"><content>
        <scxml ${NS} name="kid"><state id="k1"><onentry><send target="#_parent" event="hi"/></onentry></state></scxml>
      </content></invoke>
    </state>
  </state>
  ${outside}
  <state id="far"><transition event="warp" target="s3"/></state>
</scxml>`;

/** A fake service with a traffic log, like the playground's. */
function echoService(clock: Clock) {
  const traffic: { at: number; direction: "in" | "out"; event: string; sessionId: string }[] = [];
  return {
    type: "urn:test:echo",
    aliases: ["echo"] as const,
    traffic,
    location: () => "echo:",
    send(m: { event: string }, s: { sessionId: string; deliver(n: string, d?: unknown, o?: string): void }) {
      traffic.push({ at: clock.now(), direction: "out", event: m.event, sessionId: s.sessionId });
      clock.setTimeout(() => {
        traffic.push({ at: clock.now(), direction: "in", event: `echo.${m.event}.done`, sessionId: s.sessionId });
        s.deliver(`echo.${m.event}.done`, undefined, "echo:");
      }, 50);
    },
  };
}

async function mountRich() {
  const clock = new VirtualClock();
  const echo = echoService(clock);
  const session = await createSession(RICH, { clock, domParser, ioprocessors: [echo] });
  const el = document.createElement("scxml-explorer") as ScxmlExplorer;
  document.body.append(el);
  el.processors = [echo];
  el.clock = clock;
  el.session = session;
  session.start();
  clock.run(100);
  await frame();
  const root = el.shadowRoot!;
  const $$ = (sel: string) => [...root.querySelectorAll<HTMLElement>(sel)];
  const $ = (sel: string) => root.querySelector<HTMLElement>(sel);
  const byText = (sel: string, text: string) => $$(sel).find((e) => e.textContent?.trim() === text);
  const send = async (name: string) => {
    session.send(name);
    clock.run(clock.now() + 100);
    await frame();
  };
  return { session, el, root, $, $$, byText, clock, echo, send };
}

describe("<scxml-explorer> views", () => {
  test("focus layouts: list, diagram and lanes; doors with show-more", async () => {
    const { $, $$, byText, el, session, send } = await mountRich();
    expect($("h2.title")?.textContent).toBe("main");
    // happy-dom has no layout (width 0), so "auto" picks the list
    expect($$(".list-row").length).toBe(11); // hub, s1…s8, par, kidHost
    expect($$(".list-group").map((g) => g.textContent)).toEqual(["On the active path", "One step away"]); // no counts
    byText(".mode button", "Diagram")!.click();
    await frame();
    await frame();
    expect($(".diagram")).not.toBeNull();
    expect($$(".diagram .card").length).toBe(11);
    byText(".mode button", "List")!.click();
    await frame();
    // doors: 8 distinct targets outside the focus, 6 shown
    expect($$(".door").length).toBe(6 + 1); // 6 exits + 1 entry (far → s3)
    byText(".more", "+2 more")!.click();
    await frame();
    expect($$('[part~="door"][part~="exit"]').length).toBe(8);
    await send("to.par");
    expect($("h2.title")?.textContent).toBe("par"); // follow: all active leaves are inside the parallel state
    expect($$(".lane").map((l) => l.querySelector(".lane-head .name")?.textContent)).toEqual(["r1", "r2"]);
    $$(".lane-row")[0]!.click();
    await frame();
    expect($(".detail h2")?.textContent).toBe("r1a");
    $(".lane-head .name")!.click();
    await frame();
    expect($("h2.title")?.textContent).toBe("r1");
    session.dispose();
    el.remove();
  });

  test("list rows send from an active leaf; the last step marks the transition taken and the state left", async () => {
    const { $, $$, el, session, clock } = await mount(SHOP);
    const row = (name: string) => $$(".list-row").find((r) => r.querySelector(".name")?.textContent === name)!;
    const go = row("idle").querySelector<HTMLElement>("button.tx")!;
    expect(go.textContent).toBe("go→ busy");
    go.click();
    (clock as VirtualClock).run();
    await frame();
    expect(session.isActive("busy")).toBe(true);
    expect($(".last-step")?.textContent).toBe("shop: go · idle → busy");
    // back to "work" (following moved the focus into busy)
    $$(".tree-row")
      .find((r) => r.querySelector(".name")?.textContent === "work")!
      .click();
    await frame();
    expect(row("idle").getAttribute("part")).toBe("list-row visited");
    expect(row("idle").querySelector(".visited-mark")?.textContent).toBe("last visited");
    expect(row("idle").querySelector(".select")?.getAttribute("aria-label")).toBe("idle, atomic, last visited");
    // idle isn't active any more: its transitions are text, and the one just taken is marked
    const taken = row("idle").querySelector<HTMLElement>(".tx")!;
    expect(taken.localName).toBe("span");
    expect(taken.getAttribute("part")).toBe("row-event fired");
    expect(taken.textContent).toContain("just taken");
    session.dispose();
    el.remove();
  });

  test("state detail: actions, data, transitions and where it's entered from", async () => {
    const { $, $$, byText, el, session } = await mountRich();
    let selected = "";
    el.addEventListener("scxml-select", (e) => {
      selected = (e as CustomEvent<{ state: { id: string } }>).detail.state.id;
    });
    // the focus is "main". A leaf row says what the state does and how it leaves; hub is active,
    // so its events are buttons that send them
    const hub = () => byText(".list-row .name", "hub")!.closest<HTMLElement>(".list-row")!;
    expect(hub().querySelector(".does")?.textContent).toBe("on entry if x > 0 … · foreach i in [1, 2] +1");
    const exits = [...hub().querySelectorAll<HTMLElement>(".exits .tx")];
    expect(exits.map((x) => x.textContent)).toEqual(["go.1→ s1", "go.2→ s2", "go.3→ s3"]);
    expect(exits.map((x) => x.localName)).toEqual(["button", "button", "button"]);
    expect(exits[0]!.getAttribute("aria-label")).toBe("Send go.1 → s1");
    expect(hub().querySelector(".exits .count")?.textContent).toBe("+9 more");
    // clicking opens it in place: every transition with its condition, every action, the way in
    hub().click();
    await frame();
    expect(hub().querySelector(".select")?.getAttribute("aria-expanded")).toBe("true");
    expect(hub().querySelectorAll(".exits .tx").length).toBe(12);
    expect(hub().querySelector('.tx [title="if x > 100"]')?.textContent).toBe("if x > 100");
    expect(hub().querySelector('[part~="row-detail"] .actions')?.textContent).toContain("foreach i in [1, 2]");
    expect(selected).toBe("");
    // …and links to the full detail
    hub().querySelector<HTMLElement>('[part~="open-detail"]')!.click();
    await frame();
    expect(selected).toBe("hub");
    const detail = $(".detail")!;
    expect(detail.querySelector("h2")?.textContent).toBe("hub");
    const actions = [...detail.querySelectorAll(".actions li")].map((li) => li.textContent);
    expect(actions).toEqual(["entryif x > 0 …", "entryforeach i in [1, 2]", "entryscript"]);
    expect(detail.querySelectorAll("table.tx tbody tr").length).toBe(12);
    // main's detail: data, log/assign/raise/send/cancel descriptions, invokes via kidHost
    $$(".tree-row")
      .find((r) => r.querySelector(".name")?.textContent === "main")!
      .click();
    await frame();
    byText(".mode button", "State")?.click();
    for (const b of $$(".inspector .pane-head button")) if (b.textContent === "State") b.click();
    await frame();
    const mainActions = [...$(".detail")!.querySelectorAll(".actions li")].map((li) => li.textContent);
    expect(mainActions).toEqual([
      "entrylog hello",
      "entryx ← x + 1",
      "entryraise boot",
      "entrysend tick ⏱",
      "entrysend echo:ping → svc",
      "exitcancel t",
    ]);
    expect($(".detail dl")?.textContent).toContain("y");
    // entered-from chips navigate
    byText(".list-row .name", "s3")!.closest<HTMLElement>(".list-row")!.click();
    await frame();
    byText(".list-row .name", "s3")!.closest<HTMLElement>(".list-row")!.querySelector<HTMLElement>('[part~="open-detail"]')!.click();
    await frame();
    const chip = [...$(".detail")!.querySelectorAll<HTMLElement>(".talks .chip")].find((c) => c.textContent?.startsWith("far"))!;
    chip.click();
    await frame();
    expect($("h2.title")?.textContent).toBe("rich"); // far is top-level: its parent is the machine
    session.dispose();
    el.remove();
  });

  test("tree: expand, collapse, filter and active-only", async () => {
    const { $, $$, el, session } = await mountRich();
    const names = () => $$(".tree-row .name").map((n) => n.textContent);
    expect(names()).toContain("hub");
    const mainRow = $$(".tree-row").find((r) => r.querySelector(".name")?.textContent === "main")!;
    mainRow.querySelector<HTMLElement>(".twisty")!.click();
    expect(names()).not.toContain("hub");
    $$(".tree-row")
      .find((r) => r.querySelector(".name")?.textContent === "main")!
      .querySelector<HTMLElement>(".twisty")!
      .click();
    expect(names()).toContain("hub");
    const search = $(".tree-pane input[type=search]") as HTMLInputElement;
    search.value = "r1";
    search.dispatchEvent(new window.Event("input") as unknown as Event);
    await frame();
    expect(names()).toEqual(["main", "par", "r1", "r1a", "r1b"]);
    expect($(".pane-head .count")?.textContent).toBe("3 / 26");
    search.value = "zzz";
    search.dispatchEvent(new window.Event("input") as unknown as Event);
    await frame();
    expect($(".tree-viewport .empty")?.textContent).toBe("No state matches.");
    search.value = "";
    search.dispatchEvent(new window.Event("input") as unknown as Event);
    const activeOnly = $(".tree-pane input[type=checkbox]") as HTMLInputElement;
    activeOnly.checked = true;
    activeOnly.dispatchEvent(new window.Event("change") as unknown as Event);
    await frame();
    expect(names()).toContain("hub");
    expect(names()).not.toContain("r1");
    session.dispose();
    el.remove();
  });

  test("accepted events: scopes, filter, groups, the strip and event data", async () => {
    const { $, $$, byText, el, session, clock } = await mountRich();
    const events = () => $$(".ev-row .ev").map((e) => e.textContent);
    expect(events()).toContain("go.1");
    expect(events()).toContain("*");
    const star = $$(".ev-row").find((r) => r.querySelector(".ev")?.textContent === "*")!;
    expect(star.querySelector("button")?.hasAttribute("disabled")).toBe(true);
    const filter = $(".inspector input[type=search]") as HTMLInputElement;
    filter.value = "data";
    filter.dispatchEvent(new window.Event("input") as unknown as Event);
    await frame();
    expect(events()).toEqual(["data.*"]);
    filter.value = "nothing-like-this";
    filter.dispatchEvent(new window.Event("input") as unknown as Event);
    await frame();
    expect($(".inspector .empty")?.textContent).toBe("No accepted event matches.");
    filter.value = "";
    filter.dispatchEvent(new window.Event("input") as unknown as Event);
    byText(".scopes button", `Here ${events().length}`)?.click();
    for (const b of $$(".scopes button")) if (b.textContent?.startsWith("All")) b.click();
    await frame();
    // group toggle is remembered
    const group = $(".ev-group") as HTMLDetailsElement;
    group.open = !group.open;
    group.dispatchEvent(new window.Event("toggle") as unknown as Event);
    // event data: invalid JSON blocks the send, valid JSON goes along
    const data = $(".data-field input") as HTMLInputElement;
    data.value = "{not json";
    const goRow = () => $$(".ev-row").find((r) => r.querySelector(".ev")?.textContent === "go.2")!;
    goRow().querySelector("button")!.click();
    clock.run(clock.now() + 10);
    expect(session.isActive("hub")).toBe(true);
    data.value = '{"n": 1}';
    goRow().querySelector("button")!.click();
    clock.run(clock.now() + 10);
    expect(session.isActive("s2")).toBe(true);
    await frame();
    // the narrow-layout strip sends too
    const home = $$(".events-strip .chip").find((c) => c.textContent === "home")!;
    home.click();
    clock.run(clock.now() + 10);
    expect(session.isActive("hub")).toBe(true);
    await frame();
    $$(".events-strip .more")[0]?.click();
    session.dispose();
    el.remove();
  });

  test("system level: machines, services, traffic and opening a child machine", async () => {
    const { $, $$, byText, el, session, send } = await mountRich();
    await send("to.kid");
    byText(".levels button", "System")!.click();
    await frame();
    expect($(".shell")?.getAttribute("data-level")).toBe("system"); // the CSS hides the state tree
    expect($(".inspector .pane-head")?.textContent).toBe("Service"); // services, not the machine's events
    expect($$(".machine .name").map((n) => n.textContent)).toEqual(["rich", "kid"]);
    expect($$(".service .name").map((n) => n.textContent)).toEqual(["echo"]);
    byText(".service .name", "echo")!.closest<HTMLElement>(".service")!.click();
    await frame();
    expect($(".detail h2")?.textContent).toBe("echo");
    expect($$(".traffic li").length).toBe(2);
    byText(".machine .name", "kid")!.closest<HTMLElement>(".machine")!.click();
    await frame();
    expect($("h2.title")?.textContent).toBe("kid");
    expect($$(".crumbs button").map((b) => b.textContent)).toEqual(["System", "rich", "kid"]);
    $$(".crumbs button")[1]!.click(); // back to the root machine
    await frame();
    expect($("h2.title")?.textContent).toBe("rich");
    session.dispose();
    el.remove();
  });

  test("many machines get a filter and compact cards", async () => {
    const kids = Array.from(
      { length: 10 },
      (_, i) => `<invoke id="k${i}"><content><scxml ${NS} name="worker${i}"><state id="w"/></scxml></content></invoke>`,
    ).join("");
    const { $, $$, el, session } = await mount(`<scxml ${NS} name="boss"><state id="b">${kids}</state></scxml>`);
    for (const b of $$(".levels button")) if (b.textContent === "System") b.click();
    await frame();
    expect($$(".machine.compact").length).toBe(11);
    const filter = $(".system input[type=search]") as HTMLInputElement;
    filter.value = "worker3";
    filter.dispatchEvent(new window.Event("input") as unknown as Event);
    await frame();
    expect($$(".machine .name").map((n) => n.textContent)).toEqual(["worker3"]);
    session.dispose();
    el.remove();
  });

  test("large focus lists: search, paging, drilling in", async () => {
    const children = Array.from({ length: 50 }, (_, i) => `<state id="c${i}"><state id="c${i}x"/></state>`).join("");
    const { $, $$, el, session } = await mount(`<scxml ${NS} name="big"><state id="all">${children}</state></scxml>`);
    expect($("h2.title")?.textContent).toBe("c0"); // follow: parent of the active leaf
    $$(".tree-row")
      .find((r) => r.querySelector(".name")?.textContent === "all")!
      .click();
    await frame();
    expect($$(".list-row").length).toBe(40);
    const showAll = $$(".more").find((b) => b.textContent === "Show all 50")!;
    showAll.click();
    await frame();
    expect($$(".list-row").length).toBe(50);
    const search = $(".center input[type=search]") as HTMLInputElement;
    search.value = "c4";
    search.dispatchEvent(new window.Event("input") as unknown as Event);
    await frame();
    expect($$(".list-row").length).toBe(11); // c4, c40…c49
    $$(".list-row .drill")[0]!.click();
    await frame();
    expect($("h2.title")?.textContent).toBe("c4");
    session.dispose();
    el.remove();
  });

  test("header controls: follow button, breadcrumbs, keyboard and speeds", async () => {
    const clock = new PlaybackClock({ playing: false });
    const deep = `<scxml ${NS} name="deep"><state id="a"><state id="b"><state id="c"><state id="d"><state id="e"><state id="f"/></state></state></state></state><transition event="t" target="a"/></state></scxml>`;
    const { $, $$, el, session } = await mount(deep, clock);
    // mount doesn't run a PlaybackClock: settle the start
    clock.step(() => false);
    await frame();
    expect($("h2.title")?.textContent).toBe("e");
    // wide: first two, "…", last two
    expect($$(".crumbs button").map((b) => b.textContent)).toEqual(["System", "deep", "…", "d", "e"]);
    // narrow (measured on the host; happy-dom has no layout, so give it a width): "…" plus the last two
    el.getBoundingClientRect = () => ({ width: 500, height: 600 }) as DOMRect;
    el.remove();
    document.body.append(el); // connectedCallback measures again
    await frame();
    expect($$(".crumbs button").map((b) => b.textContent)).toEqual(["…", "d", "e"]);
    $$(".crumbs button")
      .find((b) => b.textContent === "…")!
      .click();
    await frame();
    expect($$(".crumbs button").length).toBe(7);
    ($(".follow") as HTMLButtonElement).click();
    expect(el.follow).toBe(false);
    ($(".follow") as HTMLButtonElement).click();
    expect(el.follow).toBe(true);
    // keyboard: space toggles play, "." steps
    el.dispatchEvent(new window.KeyboardEvent("keydown", { key: " ", bubbles: true }) as unknown as Event);
    expect(clock.playing).toBe(true);
    el.dispatchEvent(new window.KeyboardEvent("keydown", { key: " ", bubbles: true }) as unknown as Event);
    expect(clock.playing).toBe(false);
    session.send("t");
    el.dispatchEvent(new window.KeyboardEvent("keydown", { key: ".", bubbles: true }) as unknown as Event);
    await frame();
    expect($(".last-step")?.textContent).toContain("deep: t");
    const speeds = $(".speeds") as HTMLSelectElement;
    expect([...speeds.options].map((o) => o.textContent)).toEqual(["¼×", "½×", "1×", "2×", "4×"]);
    speeds.value = "2";
    speeds.dispatchEvent(new window.Event("change") as unknown as Event);
    expect(clock.speed).toBe(2);
    $(".play")!.click();
    expect(clock.playing).toBe(true);
    clock.dispose();
    session.dispose();
    el.remove();
  });

  test("moving the element re-attaches; removing it detaches", async () => {
    const { $$, el, session, clock } = await mountRich();
    el.remove();
    expect(el.session).toBe(session); // kept, so it can come back
    document.body.append(el);
    await frame();
    expect($$(".tree-row").length).toBeGreaterThan(0);
    session.send("go.1");
    clock.run(clock.now() + 10);
    await frame();
    expect($$('[part~="tree-row"][part~="active"] .name').map((n) => n.textContent)).toEqual(["s1"]);
    session.dispose();
    el.remove();
  });
});

describe("<scxml-explorer> accessibility and i18n", () => {
  const key = (target: Element, k: string) =>
    target.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true, composed: true }) as unknown as Event);
  const names = (root: ShadowRoot) => [...root.querySelectorAll(".tree-row .name")].map((n) => n.textContent);

  test("the tree follows the ARIA tree pattern: roving tabindex, arrows, Home/End, type-ahead, Enter", async () => {
    const { $, $$, root, el, session } = await mount(SHOP);
    const cursor = () => $('.tree-row[tabindex="0"]');
    const cursorName = () => cursor()?.querySelector(".name")?.textContent;
    expect($$('.tree-row[tabindex="0"]').length).toBe(1); // exactly one tab stop
    expect(cursorName()).toBe("work"); // starts on the focused state
    const row = $$(".tree-row").find((r) => r.querySelector(".name")?.textContent === "idle")!;
    expect([row.getAttribute("aria-level"), row.getAttribute("aria-posinset"), row.getAttribute("aria-setsize")]).toEqual(["2", "1", "2"]);
    expect(row.querySelector(".sr-only")?.textContent).toBe(", active"); // status in words
    key(cursor()!, "ArrowDown");
    expect(cursorName()).toBe("idle");
    expect((root.activeElement as HTMLElement | null)?.querySelector(".name")?.textContent).toBe("idle"); // focus moved with it
    key(cursor()!, "ArrowDown");
    expect(cursorName()).toBe("busy");
    key(cursor()!, "ArrowRight"); // expands
    expect(names(root)).toEqual(["work", "idle", "busy", "b1", "b2", "done"]);
    key(cursor()!, "ArrowRight"); // enters the first child
    expect(cursorName()).toBe("b1");
    key(cursor()!, "ArrowLeft"); // a leaf: to its parent
    expect(cursorName()).toBe("busy");
    key(cursor()!, "ArrowLeft"); // collapses
    expect(names(root)).toEqual(["work", "idle", "busy", "done"]);
    key(cursor()!, "End");
    expect(cursorName()).toBe("done");
    key(cursor()!, "Home");
    expect(cursorName()).toBe("work");
    key(cursor()!, "b"); // type-ahead
    expect(cursorName()).toBe("busy");
    key(cursor()!, "Enter");
    await frame();
    expect($("h2.title")?.textContent).toBe("busy");
    session.dispose();
    el.remove();
  });

  test("the live region announces steps (paused: at once) and sent events; announce=off silences it", async () => {
    const clock = new PlaybackClock({ playing: false });
    const { $, $$, el, session } = await mount(SHOP, clock);
    const live = () => $('[aria-live="polite"]')?.textContent ?? "";
    expect($('[aria-live="polite"]')?.getAttribute("role")).toBe("status");
    expect(live()).toBe(""); // starting isn't announced
    session.send("go");
    await frame(); // the clock tells the bar that work is queued: Step is enabled
    expect(($(".step") as HTMLButtonElement).disabled).toBe(false);
    $(".step")!.click();
    await frame();
    expect(live()).toBe("shop: idle → busy");
    const sendRow = $$(".ev-row").find((r) => r.querySelector(".ev")?.textContent === "next")!;
    expect(sendRow.querySelector("button")?.getAttribute("aria-label")).toBe("Send next");
    sendRow.querySelector("button")!.click();
    expect(live()).toBe("Sent next to shop");
    el.announce = "off";
    expect(el.getAttribute("announce")).toBe("off");
    $(".step")!.click();
    await frame();
    expect(live()).toBe("Sent next to shop"); // unchanged
    clock.dispose();
    session.dispose();
    el.remove();
  });

  test("while time runs, step announcements are throttled; the latest one wins", async () => {
    const { $, el, session, clock } = await mount(SHOP);
    el.announceInterval = 300;
    const live = () => $('[aria-live="polite"]')?.textContent ?? "";
    session.send("go");
    (clock as VirtualClock).run();
    await frame();
    expect(live()).toBe("shop: idle → busy");
    session.send("next");
    (clock as VirtualClock).run();
    session.send("back");
    (clock as VirtualClock).run();
    await frame();
    expect(live()).toBe("shop: idle → busy"); // within the interval: held back
    await new Promise((r) => setTimeout(r, 320));
    expect(live()).toBe("shop: b2 → idle"); // then only the latest
    session.dispose();
    el.remove();
  });

  test("strings: a partial override translates the UI; unset keys keep English", async () => {
    const { $, $$, el, session } = await mount(SHOP);
    el.strings = {
      levelSystem: "Système",
      statesPane: "États",
      tabStates: "États",
      focusSummary: (kind, n) => `${kind} · ${n} états`,
      kind: (k) => ({ compound: "composé", atomic: "atomique" })[k as "compound" | "atomic"] ?? k,
      sendEvent: (name) => `Envoyer ${name}`,
    };
    await frame();
    expect($$(".levels button")[0]?.textContent).toBe("Système");
    expect($(".pane-title")?.textContent).toBe("États");
    expect($$(".tabs button").map((b) => b.textContent)).toContain("États");
    expect($(".subtitle span")?.textContent).toBe("composé · 2 états");
    expect($$(".ev-row .send")[0]?.getAttribute("aria-label")).toMatch(/^Envoyer /);
    expect($(".follow")?.textContent).toBe("Follow"); // not overridden
    expect(el.strings.follow).toBe("Follow");
    session.dispose();
    el.remove();
  });

  test("rows are operable from the keyboard; scopes and statuses are words, not only colour", async () => {
    const { $, $$, el, session } = await mount(SHOP);
    const row = (name: string) => $$(".list-row").find((r) => r.querySelector(".name")?.textContent === name)!;
    // a row is a labelled group (it holds its own drill button: controls must not nest);
    // its state name is the primary button
    const select = (name: string) => row(name).querySelector("button.select") as HTMLElement;
    expect(row("idle").getAttribute("role")).toBe("group");
    expect(select("idle").getAttribute("aria-label")).toBe("idle, atomic, active");
    expect(row("busy").querySelector("button.select button")).toBeNull();
    key(select("idle"), " "); // Space (or Enter, or a click) opens a leaf in place…
    await frame();
    expect(select("idle").getAttribute("aria-expanded")).toBe("true");
    row("idle").querySelector<HTMLElement>('[part~="open-detail"]')!.click(); // …which links to the detail
    await frame();
    expect($(".detail h2")?.textContent).toBe("idle");
    key(select("busy"), "Enter"); // Enter drills into a container
    await frame();
    expect($("h2.title")?.textContent).toBe("busy");
    // focus is busy (inactive): "reset" comes from an ancestor, "go" from elsewhere
    $$(".inspector .pane-head button")[0]!.click(); // back to "Accepts" (Space had opened the detail)
    await frame();
    $$(".scopes button")
      .find((b) => b.textContent?.startsWith("All"))!
      .click();
    await frame();
    const tag = (ev: string) =>
      $$(".ev-row")
        .find((r) => r.querySelector(".ev")?.textContent === ev)
        ?.querySelector(".scope-tag")?.textContent;
    expect([tag("reset"), tag("go")]).toEqual(["inherited", "elsewhere"]);
    session.dispose();
    el.remove();
  });

  test("slots: toolbar, per-event and empty states (with their default text)", async () => {
    const { $, $$, root, el, session } = await mount(SHOP);
    expect($('.top slot[name="toolbar"]')).not.toBeNull();
    expect($$(".ev-row slot").map((s) => s.getAttribute("name"))).toContain("event:go");
    const search = root.querySelector<HTMLInputElement>('input[part="tree-search"]')!;
    search.value = "zzz";
    search.dispatchEvent(new window.Event("input") as unknown as Event);
    await frame();
    const empty = $('.tree-pane slot[name="empty-tree"]');
    expect(empty?.textContent).toBe("No state matches.");
    session.dispose();
    el.remove();
  });

  test("navigation uses a view transition, except with prefers-reduced-motion", async () => {
    const { $$, el, session } = await mount(SHOP);
    const doc = document as unknown as { startViewTransition?: (cb: () => void) => void };
    const matchMediaBefore = globalThis.matchMedia;
    let transitions = 0;
    doc.startViewTransition = (cb) => {
      transitions++;
      cb();
    };
    const reduce = (on: boolean) =>
      Object.defineProperty(globalThis, "matchMedia", {
        value: (q: string) => ({ matches: on && q.includes("reduce"), media: q }) as MediaQueryList,
        configurable: true,
        writable: true,
      });
    const click = (name: string) =>
      $$(".tree-row")
        .find((r) => r.querySelector(".name")?.textContent === name)!
        .click();
    reduce(true);
    click("busy");
    expect(transitions).toBe(0);
    reduce(false);
    click("work");
    expect(transitions).toBe(1);
    delete doc.startViewTransition;
    Object.defineProperty(globalThis, "matchMedia", { value: matchMediaBefore, configurable: true, writable: true });
    session.dispose();
    el.remove();
  });
});

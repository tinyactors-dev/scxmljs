/**
 * `<scxml-view>` — a whole statechart at once, drop-in.
 *
 *   <scxml-view src="traffic-light.scxml"></scxml-view>
 *
 *   <scxml-view>
 *     <script type="application/scxml+xml"> <scxml …> … </scxml> </script>
 *   </scxml-view>
 *
 * Without any JavaScript it loads the chart, compiles and validates it, runs
 * it and draws it: nested boxes, orthogonal transitions, the active
 * configuration highlighted, transitions that just fired lit up. Transition
 * labels are buttons that send their event.
 *
 * The data model: SANDBOXED by default (QuickJS, safe for any source), or the
 * host's engine with the `trusted` attribute (no WebAssembly download — only
 * for charts you trust). Both are loaded on demand with `import()`, so a page
 * that hands the element its own `session` downloads neither.
 *
 * Attributes: `src`, `trusted`, `autostart` ("false" = draw without running),
 * `interactive` ("false" = labels aren't buttons), `data` (JSON initial values
 * for `<data>`), `direction` ("auto" | "right" | "down"), `max-states` (fold
 * large charts beyond this many boxes, default 150), `announce`
 * ("all" | "sends" | "off"), `fit` (scale down to the element's width),
 * `warnings` ("off" hides the list of authoring warnings — see `model.warnings`),
 * `event-data` (JSON object from event names to the data a label click sends,
 * e.g. `{"login": {"user": "ada"}}`).
 *
 * Properties: `session` (a host-created session; the element then creates,
 * starts and disposes nothing), `options` (extra SessionOptions for sessions
 * the element creates: I/O processors, invokers, loader…), `clock` (e.g. a
 * PlaybackClock: shows play / pause / step controls), `strings`, `source`
 * (SCXML text instead of `src`), `model`, and `reload()`.
 *
 * Events (bubbling, composed): `scxml-load` { session, model },
 * `scxml-error` { message, problems?, error }, `scxml-send` { session, name }
 * (cancelable; fired before a label sends its event).
 *
 * Styling: the shared `--scxml-*` tokens and these parts — `frame`, `canvas`,
 * `state` (+ `atomic` `compound` `parallel` `parallel-region` `final`
 * `history` `collapsed` `active`), `state-name`, `transition` / `edge-label`
 * (+ `live` `fired`), `event`, `cond`, `internal`, `edge` (+ `live` `fired`),
 * `initial`, `expand`, `collapse`, `notice`, `error`, `controls`, `play`,
 * `step`, `speeds`, `clock`, `warnings`, `warning`.
 */
import { type Clock, PlaybackClock } from "../clock.ts";
import type { DataModelFactory } from "../datamodel-base.ts";
import { compile, isCompound, type Model, type StateNode, type TransitionNode } from "../model.ts";
import { parseSCXML, SCXMLSession, type SessionOptions } from "../session.ts";
import type { MicrostepEvent } from "../session-events.ts";
import { Announcer } from "../ui/announcer.ts";
import { arrowMarker } from "../ui/svg.ts";
import { lazySheet, NARROW_WIDTH, themeSheet } from "../ui/theme.ts";
import { autoCollapse, type ChartLayout, type Direction, layoutChart, type Size } from "./layout.ts";
import { defaultViewStrings, type ViewStateKind, type ViewStrings } from "./strings.ts";
import { VIEW_CSS } from "./styles.ts";

/** `scxml-load`: the chart compiled and its session is ready; the element starts it right after (unless `autostart="false"`). */
export interface ViewLoadDetail {
  /** the session shown (created by the element, or the one you set) */
  session: SCXMLSession;
  /** the compiled chart */
  model: Model;
}
/** `scxml-error`: nothing to show, a fetch failed, or the chart is invalid. The element shows the problems too. */
export interface ViewErrorDetail {
  /** a one-line summary */
  message: string;
  /** Validation problems, one per line of the chart that is wrong. */
  problems?: string[];
  /** the underlying error (an `SCXMLValidationError`, `SCXMLParseError`, `ViewSourceError`, fetch error…) */
  error: unknown;
}
/**
 * `scxml-send`: a transition label is about to send its event. Cancelable
 * (`preventDefault()` stops it). Listeners may set `data`: it's sent as the
 * event's data (it starts as the value from the `event-data` attribute).
 */
export interface ViewSendDetail {
  /** the session the event goes to */
  session: SCXMLSession;
  /** the event name */
  name: string;
  /** the event data to send; writable */
  data?: unknown;
}

/** SessionOptions for sessions the element creates (its own clock comes from the `clock` property). */
export type ViewOptions = Omit<SessionOptions, "clock">;
/** Layout direction: layers left to right, top to bottom, or `auto` (down below the 760px breakpoint). */
export type ViewDirection = Direction | "auto";
/** What the live region announces: every step and sent event, only sent events, or nothing. */
export type ViewAnnounce = "all" | "sends" | "off";

const SCXML_MIME = "application/scxml+xml";
/** Default floor for scaling a too-wide diagram down (without `fit`); see `--scxml-min-scale`. */
const DEFAULT_MIN_SCALE = 0.65;
const FIRED_MS = 900;
const DEFAULT_MAX_STATES = 150;
const MAX_INTERNAL_SHOWN = 3;
const SPEEDS: [number, string][] = [
  [0.25, "¼×"],
  [0.5, "½×"],
  [1, "1×"],
  [2, "2×"],
  [4, "4×"],
];

// importing this module where there is no DOM (server-side rendering, Node) must work
const ElementBase: typeof HTMLElement = typeof HTMLElement === "undefined" ? (class {} as unknown as typeof HTMLElement) : HTMLElement;

const sheet = lazySheet(VIEW_CSS);

/** Load a data model engine on demand (dynamic import: never in the element's own bundle). */
async function engine(trusted: boolean): Promise<DataModelFactory> {
  if (trusted) return (await import("../datamodel-trusted.ts")).trustedDataModel;
  const quickjs = await import("../datamodel-quickjs.ts");
  await quickjs.loadQuickJS();
  return quickjs.sandboxedDataModel;
}

/**
 * `<scxml-view>`: a whole statechart, drawn and running, with no JavaScript
 * of your own. Registered by importing `@tinyactors/scxmljs/view`.
 *
 * @example
 * ```html
 * <script type="module">import "@tinyactors/scxmljs/view";</script>
 * <scxml-view src="traffic-light.scxml"></scxml-view>
 * ```
 */
export class ScxmlView extends ElementBase {
  /** Attributes the element reacts to. */
  static observedAttributes = ["src", "trusted", "autostart", "interactive", "data", "direction", "max-states", "fit", "warnings"];

  #shadow!: ShadowRoot;
  #el!: {
    frame: HTMLElement;
    controls: HTMLElement;
    play: HTMLButtonElement;
    step: HTMLButtonElement;
    speeds: HTMLElement;
    clock: HTMLElement;
    notice: HTMLElement;
    sendStatus: HTMLElement;
    warnings: HTMLDetailsElement;
    error: HTMLElement;
    canvas: HTMLElement;
    diagram: HTMLElement;
    live: HTMLElement;
  };

  // what's shown
  #session?: SCXMLSession;
  #owned = false;
  #model?: Model;
  #source?: string;
  #options: ViewOptions = {};
  #clock?: Clock;
  #strings: ViewStrings = defaultViewStrings;
  #generation = 0;
  #loadQueued = false;
  #loadForced = false;

  // layout state
  #layout?: ChartLayout;
  #direction: Direction = "right";
  #collapsed = new Set<StateNode>();
  #foldsFor?: Model;
  #boxes = new Map<StateNode, HTMLElement>();
  #labels = new Map<TransitionNode, HTMLElement[]>();
  #paths = new Map<TransitionNode, SVGPathElement[]>();
  #chips = new Map<TransitionNode, HTMLElement>();

  // live state
  #fired = new Map<TransitionNode, number>();
  #entered: StateNode[] = [];
  /** The configuration as of the last microstep; still known after the session terminates. */
  #last = new Set<StateNode>();
  #steps = 0;
  #unwire: (() => void)[] = [];
  #announcer?: Announcer;
  #ro?: ResizeObserver;
  #raf = 0;
  #decayRaf = 0;
  #width = 0;

  constructor() {
    super();
    if (typeof document === "undefined") return;
    this.#shadow = this.attachShadow({ mode: "open" });
    this.#shadow.adoptedStyleSheets = [themeSheet(), sheet()];
    this.#buildShell();
  }

  // ─────────────────────────────── attributes ───────────────────────────────

  /** The chart's URL (the `src` attribute). Relative `<script src>` / `<data src>` / `<invoke src>` resolve against it. */
  get src(): string {
    return this.getAttribute("src") ?? "";
  }
  /** Sets the `src` attribute (loads the chart). */
  set src(v: string) {
    this.setAttribute("src", v);
  }
  /** Run the chart in the host's JS engine instead of the QuickJS sandbox (no WebAssembly; trusted charts only). */
  get trusted(): boolean {
    return this.hasAttribute("trusted");
  }
  /** Toggles the `trusted` attribute (reloads). */
  set trusted(v: boolean) {
    this.toggleAttribute("trusted", v);
  }
  /** Start the session the element creates (default true; `autostart="false"` only draws the chart). */
  get autostart(): boolean {
    return this.getAttribute("autostart") !== "false";
  }
  /** Sets the `autostart` attribute. */
  set autostart(v: boolean) {
    this.setAttribute("autostart", String(v));
  }
  /** Transition labels are buttons that send their event (default true). */
  get interactive(): boolean {
    return this.getAttribute("interactive") !== "false";
  }
  /** Sets the `interactive` attribute. */
  set interactive(v: boolean) {
    this.setAttribute("interactive", String(v));
  }
  /** "right" (layers left to right), "down", or "auto" (down when narrower than the shared breakpoint). */
  get direction(): ViewDirection {
    const d = this.getAttribute("direction");
    return d === "right" || d === "down" ? d : "auto";
  }
  /** Sets the `direction` attribute (re-lays out). */
  set direction(v: ViewDirection) {
    this.setAttribute("direction", v);
  }
  /** Fold the largest compound states until at most this many boxes are drawn (default 150). */
  get maxStates(): number {
    const n = Number(this.getAttribute("max-states"));
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_STATES;
  }
  /** Sets the `max-states` attribute (folds again). */
  set maxStates(n: number) {
    this.setAttribute("max-states", String(n));
  }
  /** What the polite live region announces: "all" (steps and sent events, default), "sends" or "off". */
  get announce(): ViewAnnounce {
    const a = this.getAttribute("announce");
    return a === "off" || a === "sends" ? a : "all";
  }
  /** Sets the `announce` attribute. */
  set announce(v: ViewAnnounce) {
    this.setAttribute("announce", v);
  }
  /** "show" (default) lists the chart's authoring warnings (`model.warnings`) above the diagram; "off" hides them. */
  get warnings(): "show" | "off" {
    return this.getAttribute("warnings") === "off" ? "off" : "show";
  }
  /** Sets the `warnings` attribute. */
  set warnings(v: "show" | "off") {
    this.setAttribute("warnings", v);
  }
  /** Scale the diagram down to the element's width. */
  get fit(): boolean {
    return this.hasAttribute("fit");
  }
  /** Toggles the `fit` attribute. */
  set fit(v: boolean) {
    this.toggleAttribute("fit", v);
  }

  // ─────────────────────────────── properties ───────────────────────────────

  /** The session shown. Setting one hands the element a host-owned session (it won't be started or disposed). */
  get session(): SCXMLSession | undefined {
    return this.#session;
  }
  /** Show your own session (the element never starts or disposes it); `undefined` goes back to `src` / inline source. */
  set session(s: SCXMLSession | undefined) {
    this.#generation++;
    this.#teardownSession();
    if (s) this.#attach(s, false);
    else this.#scheduleLoad();
  }

  /** The compiled chart shown. */
  get model(): Model | undefined {
    return this.#model;
  }

  /** Extra options for sessions the element creates (I/O processors, invokers, loader, data model…). Setting them reloads. */
  get options(): ViewOptions {
    return this.#options;
  }
  /** Options for sessions the element creates; reloads unless a host session is shown. */
  set options(o: ViewOptions) {
    this.#options = o ?? {};
    if (this.#owned || !this.#session) this.#scheduleLoad();
  }

  /** The clock for sessions the element creates; a PlaybackClock adds play / pause / step controls. Setting it reloads. */
  get clock(): Clock | undefined {
    return this.#clock;
  }
  /** The clock for sessions the element creates; reloads unless a host session is shown. */
  set clock(c: Clock | undefined) {
    this.#clock = c;
    if (this.#owned || !this.#session) this.#scheduleLoad();
  }

  /** SCXML text to show instead of `src` / inline source. */
  get source(): string | undefined {
    return this.#source;
  }
  /** Show this SCXML text (reloads). */
  set source(text: string | undefined) {
    this.#source = text;
    this.#scheduleLoad();
  }

  /** Translations: a partial override of the English defaults. */
  get strings(): ViewStrings {
    return this.#strings;
  }
  /** Translate: a partial object; unset keys keep their English default. */
  set strings(s: Partial<ViewStrings>) {
    this.#strings = { ...defaultViewStrings, ...s, kinds: { ...defaultViewStrings.kinds, ...s?.kinds } };
    this.#relayout();
  }

  /** Load the chart again (re-reading `src` / inline source) and start a fresh session. */
  reload() {
    this.#scheduleLoad(true);
  }

  // ─────────────────────────────── lifecycle ───────────────────────────────

  /** Custom-element lifecycle (called by the browser): loads the chart when first connected. */
  connectedCallback() {
    if (typeof ResizeObserver !== "undefined" && !this.#ro) {
      this.#ro = new ResizeObserver(() => this.#onResize());
      this.#ro.observe(this);
    }
    if (this.#session && !this.#owned) this.#relayout();
    else if (!this.#session) this.#scheduleLoad();
  }

  /** Custom-element lifecycle (called by the browser): disposes an element-owned session unless the element was only moved. */
  disconnectedCallback() {
    this.#ro?.disconnect();
    this.#ro = undefined;
    // an element moved within the page is re-connected in the same task: keep its session then
    queueMicrotask(() => {
      if (this.isConnected) return;
      this.#generation++;
      this.#teardownSession();
      this.#announcer?.dispose();
    });
  }

  /** Custom-element lifecycle (called by the browser) for the observed attributes. */
  attributeChangedCallback(name: string, old: string | null, value: string | null) {
    if (old === value || !this.isConnected) return;
    switch (name) {
      case "src":
      case "trusted":
      case "data":
      case "autostart":
        if (this.#owned || !this.#session) this.#scheduleLoad();
        break;
      case "max-states":
        this.#foldsFor = undefined;
        this.#relayout();
        break;
      default:
        this.#relayout();
    }
  }

  #scheduleLoad(force = false) {
    if (!this.isConnected || (this.#session && !this.#owned && !force)) return;
    this.#loadForced ||= force;
    if (this.#loadQueued) return;
    this.#loadQueued = true;
    // properties set right after creation (options, clock…) still apply to this load
    queueMicrotask(() => {
      const forced = this.#loadForced;
      this.#loadQueued = false;
      this.#loadForced = false;
      if (!this.isConnected) return;
      // a host session assigned after the load was queued (append, then set `session`) wins
      if (!forced && this.#session && !this.#owned) return;
      void this.#load();
    });
  }

  async #load() {
    const generation = ++this.#generation;
    this.#teardownSession();
    this.#showMessage("loading");
    try {
      const source = await this.#readSource();
      if (generation !== this.#generation) return;
      if (!source) {
        this.#el.diagram.replaceChildren(h("p", { class: "empty", part: "empty" }, this.#strings.noSource));
        return;
      }
      const { text, base } = source;
      const opts = this.#options;
      const root = parseSCXML(text, opts.domParser);
      const loader = opts.loader ?? ((src: string) => fetchText(new URL(src.replace(/^file:/, ""), base).href));
      const model = await compile(root, { loader });
      const datamodel = opts.datamodel ?? (await engine(this.trusted));
      if (generation !== this.#generation) return;
      const data = { ...this.#dataAttribute(), ...opts.data };
      const session = new SCXMLSession(model, { ...opts, loader, datamodel, data, clock: this.#clock });
      this.#attach(session, true);
      this.#emit<ViewLoadDetail>("scxml-load", { session, model });
      if (this.autostart) session.start();
      this.#renderState();
    } catch (error) {
      if (generation === this.#generation) this.#fail(error);
    }
  }

  async #readSource(): Promise<{ text: string; base: string } | null> {
    const base = typeof document !== "undefined" ? document.baseURI : "";
    if (this.#source != null) return { text: this.#source, base };
    const src = this.getAttribute("src");
    if (src) {
      const url = new URL(src, base).href;
      return { text: await fetchText(url), base: url };
    }
    const inline = () => this.querySelector(`script[type="${SCXML_MIME}"]`)?.textContent;
    let text = inline();
    // while the parser is still inside <scxml-view>, its children may not exist yet
    if (text == null && document.readyState === "loading") {
      await new Promise((r) => document.addEventListener("DOMContentLoaded", r, { once: true }));
      text = inline();
    }
    // nothing to show (yet): a host that sets `session` later is the normal framework flow,
    // so this is a quiet hint in the frame, not an error event
    if (text == null || !text.trim()) return null;
    return { text, base };
  }

  #dataAttribute(): Record<string, unknown> {
    const raw = this.getAttribute("data");
    if (!raw) return {};
    try {
      const v = JSON.parse(raw);
      return v && typeof v === "object" ? v : {};
    } catch {
      throw new ViewSourceError(`The data attribute is not valid JSON: ${raw}`);
    }
  }

  #attach(session: SCXMLSession, owned: boolean) {
    this.#session = session;
    this.#owned = owned;
    this.#model = session.model;
    this.#fired.clear();
    this.#steps = 0;
    this.#last = new Set(session.configuration);
    const onMicro = (e: MicrostepEvent) => {
      const now = session.clock.now();
      for (const t of e.transitions) if (t.element) this.#fired.set(t, now);
      this.#entered.push(...e.entered);
      for (const s of e.exited) this.#last.delete(s);
      for (const s of e.entered) this.#last.add(s);
    };
    const onMacro = (e: { event?: { name: string } }) => {
      this.#steps++;
      const entered = this.#entered.filter((s) => !s.children.length).map((s) => (s.generatedId ? s.kind : s.id));
      this.#entered = [];
      if (this.announce === "all" && e.event) this.#say(this.#strings.announceStep(e.event.name, entered));
      this.#renderState();
    };
    const onDone = () => this.#renderState();
    session.addEventListener("microstep", onMicro);
    session.addEventListener("macrostep", onMacro as never);
    session.addEventListener("done", onDone);
    this.#unwire.push(() => {
      session.removeEventListener("microstep", onMicro);
      session.removeEventListener("macrostep", onMacro as never);
      session.removeEventListener("done", onDone);
    });
    const clock = session.clock;
    if (clock instanceof PlaybackClock) this.#unwire.push(clock.subscribe(() => this.#renderState()));
    this.#el.error.hidden = true;
    this.#relayout();
  }

  #teardownSession() {
    for (const f of this.#unwire.splice(0)) f();
    cancelAnimationFrame(this.#decayRaf);
    if (this.#owned) this.#session?.dispose();
    this.#session = undefined;
    this.#owned = false;
    this.#model = undefined;
    this.#layout = undefined;
  }

  #fail(error: unknown) {
    this.#teardownSession();
    const problems = (error as { problems?: string[] })?.problems;
    const message = error instanceof Error ? error.message : String(error);
    const e = this.#el;
    e.diagram.replaceChildren();
    e.controls.hidden = true;
    e.notice.hidden = true;
    e.error.hidden = false;
    e.error.replaceChildren(
      h("h2", {}, this.#strings.errorTitle),
      problems?.length ? h("ul", {}, ...problems.map((p) => h("li", {}, p))) : h("p", {}, message),
    );
    this.#emit<ViewErrorDetail>("scxml-error", { message, problems, error });
  }

  #showMessage(kind: "loading") {
    this.#el.error.hidden = true;
    this.#el.diagram.replaceChildren(h("div", { class: "loading" }, kind === "loading" ? this.#strings.loading : ""));
  }

  #say(text: string, urgent = false) {
    if (this.announce === "off") return;
    this.#announcer ??= new Announcer(this.#el.live, {
      interval: () => 3000,
      paused: () => {
        const c = this.#session?.clock;
        return c instanceof PlaybackClock ? !c.playing : false;
      },
    });
    this.#announcer.say(text, urgent);
  }

  /**
   * Data for events sent by clicking a label: the `event-data` attribute is a
   * JSON object from event names to data, e.g. `event-data='{"login": {"user": "ada"}}'`.
   */
  #eventData(name: string): unknown {
    const raw = this.getAttribute("event-data");
    if (!raw) return undefined;
    try {
      const map = JSON.parse(raw) as Record<string, unknown>;
      return map && typeof map === "object" ? map[name] : undefined;
    } catch {
      console.warn(`scxml-view: the event-data attribute is not valid JSON: ${raw}`);
      return undefined;
    }
  }

  #sendStatusTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * After a label click: if the event takes no transition, or evaluating it
   * raises an error (a condition that throws counts as false, spec §5.9.1),
   * say so — otherwise the click looks like it did nothing at all.
   */
  #watchOutcome(session: SCXMLSession, name: string) {
    const status = this.#el.sendStatus;
    status.hidden = true;
    clearTimeout(this.#sendStatusTimer);
    let took = false;
    let error: string | undefined;
    const onMicro = (e: Event) => {
      const m = e as Event & { event?: { name: string } };
      if (m.event?.name === name) took = true;
    };
    const onError = (e: Event) => {
      error ??= (e as Event & { message?: string }).message;
    };
    const stop = () => {
      session.removeEventListener("microstep", onMicro);
      session.removeEventListener("error", onError);
      session.removeEventListener("macrostep", onMacro);
    };
    const onMacro = (e: Event) => {
      const m = e as Event & { event?: { name: string } };
      if (m.event?.name !== name) return;
      stop();
      if (took && !error) return;
      const t = this.#strings;
      const text = error ? t.sentError(name, error) : t.sentNothing(name);
      status.textContent = text;
      status.hidden = false;
      if (this.announce !== "off") this.#say(text, true);
      // a message, not state: real time is fine for hiding it
      this.#sendStatusTimer = setTimeout(() => (status.hidden = true), 6000);
    };
    session.addEventListener("microstep", onMicro);
    session.addEventListener("error", onError);
    session.addEventListener("macrostep", onMacro);
    session.signal.addEventListener("abort", stop, { once: true });
  }

  #emit<T>(type: string, detail: T, cancelable = false): boolean {
    return this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true, cancelable }));
  }

  // ───────────────────────────────── shell ─────────────────────────────────

  #buildShell() {
    const t = this.#strings;
    const play = h("button", { class: "play", type: "button", part: "play", title: t.playHint }) as HTMLButtonElement;
    const step = h("button", { class: "step", type: "button", part: "step", title: t.stepHint }, t.step) as HTMLButtonElement;
    const speeds = h("div", { class: "speeds", role: "group", part: "speeds", "aria-label": t.speedLabel });
    const clock = h("span", { class: "clock", part: "clock" });
    play.addEventListener("click", () => this.#playback()?.toggle());
    step.addEventListener("click", () => this.#step());
    const controls = h("div", { class: "controls", part: "controls", hidden: "" }, play, step, speeds, clock);
    const notice = h("div", { class: "notice", part: "notice", hidden: "" });
    // what became of an event sent by clicking a label, when it wasn't the obvious (a transition fired)
    const sendStatus = h("div", { class: "notice send-status", part: "send-status", hidden: "" });
    const warnings = h("details", { class: "warnings", part: "warnings", hidden: "" }) as HTMLDetailsElement;
    const error = h("div", { class: "error", part: "error", role: "alert", hidden: "" });
    const diagram = h("div", { class: "diagram", role: "group" });
    // focusable: a scroll container must be keyboard-scrollable, and it takes the playback shortcuts
    const canvas = h("div", { class: "canvas", part: "canvas", tabindex: "0" }, diagram);
    const live = h("div", { class: "sr-only", role: "status", "aria-live": "polite", "aria-atomic": "true" });
    const frame = h("div", { class: "frame", part: "frame" }, controls, notice, sendStatus, warnings, error, canvas, live);
    this.#shadow.append(frame);
    this.#el = { frame, controls, play, step, speeds, clock, notice, sendStatus, warnings, error, canvas, diagram, live };
    this.addEventListener("keydown", (e) => {
      const clockNow = this.#playback();
      const target = e.composedPath()[0] as HTMLElement;
      if (!clockNow || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target?.tagName ?? "")) return;
      if (e.key === " ") {
        e.preventDefault();
        clockNow.toggle();
      } else if (e.key === ".") {
        e.preventDefault();
        this.#step();
      }
    });
  }

  #playback(): PlaybackClock | undefined {
    const c = this.#session?.clock;
    return c instanceof PlaybackClock ? c : undefined;
  }

  #step() {
    const clock = this.#playback();
    if (!clock) return;
    const before = this.#steps;
    clock.step(() => this.#steps > before);
    this.#renderState();
  }

  #onResize() {
    const w = this.getBoundingClientRect().width;
    const was = this.#width;
    this.#width = w;
    if (!this.#layout) return;
    const crossed = was === 0 || was <= NARROW_WIDTH !== w <= NARROW_WIDTH;
    if (this.direction === "auto" && crossed) this.#relayout();
    else this.#applyFit();
  }

  // ──────────────────────────────── rendering ────────────────────────────────

  #relayout() {
    if (!this.#model || this.#raf) return;
    if (typeof requestAnimationFrame === "undefined") return this.#renderAll();
    this.#raf = requestAnimationFrame(() => {
      this.#raf = 0;
      this.#renderAll();
    });
  }

  /** Measure every box and label, lay the chart out, and draw it. */
  #renderAll() {
    if (this.#raf) {
      cancelAnimationFrame(this.#raf);
      this.#raf = 0;
    }
    const model = this.#model;
    if (!model) return;
    const e = this.#el;
    const t = this.#strings;
    this.#direction = this.direction === "auto" ? (this.#width > 0 && this.#width <= NARROW_WIDTH ? "down" : "right") : this.direction;
    if (this.#foldsFor !== model) {
      // fold around the active configuration, so what's running stays visible
      const session = this.#session;
      const active = new Set(session?.status === "running" ? model.states.filter((s) => session.isActiveNode(s)) : []);
      this.#collapsed = autoCollapse(model.root, this.maxStates, active);
      this.#foldsFor = model;
    }
    this.#boxes.clear();
    this.#labels.clear();
    this.#paths.clear();
    this.#chips.clear();
    e.diagram.replaceChildren();
    e.diagram.setAttribute("aria-label", t.diagramLabel(model.name || "statechart"));

    // 1. boxes, drawn parents first; hidden (folded) states get none
    const visible: StateNode[] = [];
    const walk = (s: StateNode) => {
      for (const k of [...s.children, ...s.history]) {
        visible.push(k);
        if (!this.#collapsed.has(k)) walk(k);
      }
    };
    walk(model.root);
    for (const s of visible) {
      const el = this.#box(s);
      this.#boxes.set(s, el);
      e.diagram.append(el);
    }

    // 2. label templates, measured once per transition
    const labelSizes = new Map<TransitionNode, Size>();
    const measureHost = h("div", { style: "position:absolute;left:0;top:0;visibility:hidden" });
    e.diagram.append(measureHost);
    for (const s of visible) {
      for (const tr of s.transitions) {
        if (!tr.targets.length || !labelText(tr)) continue;
        const el = this.#label(tr);
        measureHost.append(el);
        labelSizes.set(tr, measured(el, estimateLabel(tr)));
      }
    }
    measureHost.remove();

    // 3. layout
    const layout = layoutChart(model.root, {
      direction: this.#direction,
      collapsed: this.#collapsed,
      labelSize: (tr) => labelSizes.get(tr) ?? { w: 0, h: 0 },
      measure: (s, collapsed) => this.#measure(s, collapsed),
    });
    this.#layout = layout;

    // 4. position boxes
    for (const b of layout.boxes) {
      const el = this.#boxes.get(b.node);
      if (!el) continue;
      Object.assign(el.style, { left: `${b.rect.x}px`, top: `${b.rect.y}px`, width: `${b.rect.w}px`, height: `${b.rect.h}px` });
    }

    // 5. edges, initial markers and labels
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "edges");
    svg.setAttribute("width", String(layout.width));
    svg.setAttribute("height", String(layout.height));
    svg.setAttribute("aria-hidden", "true");
    svg.append(arrowMarker("arrow", 10, 7, 9.5));
    for (const edge of layout.edges) {
      const path = document.createElementNS(NS, "path");
      path.setAttribute("class", "edge");
      path.setAttribute("part", "edge");
      path.setAttribute("d", pathData(edge.points));
      path.setAttribute("marker-end", "url(#arrow)");
      svg.append(path);
      (this.#paths.get(edge.transition) ?? this.#paths.set(edge.transition, []).get(edge.transition)!).push(path);
      if (edge.label) {
        const label = this.#label(edge.transition);
        Object.assign(label.style, { left: `${edge.label.x}px`, top: `${edge.label.y}px`, width: `${edge.label.w}px` });
        e.diagram.append(label);
        (this.#labels.get(edge.transition) ?? this.#labels.set(edge.transition, []).get(edge.transition)!).push(label);
      }
    }
    for (const m of layout.initials) {
      const dot = document.createElementNS(NS, "circle");
      dot.setAttribute("class", "initial");
      dot.setAttribute("part", "initial");
      dot.setAttribute("cx", String(m.at.x));
      dot.setAttribute("cy", String(m.at.y));
      dot.setAttribute("r", "4.5");
      const line = document.createElementNS(NS, "path");
      line.setAttribute("class", "initial-line");
      line.setAttribute("d", pathData(m.points));
      line.setAttribute("marker-end", "url(#arrow)");
      svg.append(line, dot);
    }
    e.diagram.prepend(svg);
    Object.assign(e.diagram.style, { width: `${layout.width}px`, height: `${layout.height}px` });

    // 6. folded groups, authoring warnings
    this.#renderNotice();
    this.#renderWarnings();
    this.#applyFit();
    this.#renderState();
  }

  #kind(s: StateNode): ViewStateKind {
    return s.kind === "parallel"
      ? "parallel"
      : s.kind === "final"
        ? "final"
        : s.kind === "history"
          ? "history"
          : isCompound(s)
            ? "compound"
            : "atomic";
  }

  #box(s: StateNode): HTMLElement {
    const t = this.#strings;
    const kind = this.#kind(s);
    const collapsed = this.#collapsed.has(s);
    const container = !collapsed && (kind === "compound" || kind === "parallel");
    const region = s.parent?.kind === "parallel";
    const el = h("div", {
      class: [
        "box",
        container ? `container depth-${s.depth % 2 ? "odd" : "even"}` : "leaf",
        kind,
        region && "region",
        collapsed && "collapsed",
      ]
        .filter(Boolean)
        .join(" "),
      part: parts("state", kind, region && "parallel-region", collapsed && "collapsed"),
      role: "group",
      "data-state": s.id,
    });
    const display = s.generatedId ? `(${t.kinds[kind]})` : s.id;
    if (kind === "history") {
      el.textContent = s.historyType === "deep" ? "H*" : "H";
      el.title = display;
      return el;
    }
    const name = h(
      "div",
      { class: "name", part: "state-name", title: display },
      h("span", { class: "dot", "aria-hidden": "true" }),
      display,
    );
    if (kind === "parallel") name.append(h("span", { class: "kind" }, "∥"));
    const internal = this.#internal(s);
    if (container) {
      el.append(h("div", { class: "head" }, name, ...(internal ? [internal] : [])));
      if (this.#expandedFolds.has(s)) {
        const fold = h("button", { class: "collapse", type: "button", part: "collapse" }, t.collapse);
        fold.addEventListener("click", () => {
          this.#collapsed.add(s);
          this.#expandedFolds.delete(s);
          this.#renderAll();
        });
        el.append(fold);
      }
      return el;
    }
    el.append(name);
    if (internal) el.append(internal);
    if (collapsed) {
      const inside = countInside(s);
      const expand = h("button", { class: "expand", type: "button", part: "expand" }, t.expand);
      expand.addEventListener("click", () => {
        this.#collapsed.delete(s);
        this.#expandedFolds.add(s);
        this.#renderAll();
      });
      el.append(h("span", { class: "badge-count" }, t.statesInside(inside)), expand);
    }
    return el;
  }

  #expandedFolds = new Set<StateNode>();

  /** Targetless transitions of a state, as chips inside its box. */
  #internal(s: StateNode): HTMLElement | undefined {
    const list = s.transitions.filter((tr) => !tr.targets.length);
    if (!list.length) return undefined;
    const wrap = h("div", { class: "internal", part: "internal" });
    for (const tr of list.slice(0, MAX_INTERNAL_SHOWN)) {
      const chip = this.#label(tr, true);
      wrap.append(chip);
      this.#chips.set(tr, chip);
    }
    if (list.length > MAX_INTERNAL_SHOWN)
      wrap.append(h("span", { class: "more" }, this.#strings.moreInternal(list.length - MAX_INTERNAL_SHOWN)));
    return wrap;
  }

  /** A transition's label: a button that sends its event (or a plain label). */
  #label(tr: TransitionNode, chip = false): HTMLElement {
    const t = this.#strings;
    const name = tr.events.map(sendableName).find((n): n is string => !!n);
    const interactive = this.interactive && !!name;
    const el = h(interactive ? "button" : "span", {
      class: chip ? "chip" : "label",
      part: parts("transition", "edge-label"),
      ...(interactive ? { type: "button" } : {}),
    });
    const events = tr.events.length ? tr.events : [t.eventless];
    events.forEach((ev, i) => {
      if (i) el.append(" ");
      el.append(h("span", { part: "event" }, ev));
    });
    if (tr.cond) el.append(h("span", { class: "cond", part: "cond" }, `[${truncate(tr.cond, 22)}]`));
    const targets = tr.targets.map((s) => s.id).join(", ");
    el.setAttribute("aria-label", t.transitionLabel(tr.events.join(" ") || t.eventless, targets));
    el.title = [tr.events.join(" ") || t.eventless, tr.cond && `[${tr.cond}]`, targets && `→ ${targets}`].filter(Boolean).join(" ");
    if (interactive)
      el.addEventListener("click", () => {
        const session = this.#session;
        if (!session || !name) return;
        const detail: ViewSendDetail = { session, name, data: this.#eventData(name) };
        if (!this.#emit<ViewSendDetail>("scxml-send", detail, true)) return;
        this.#watchOutcome(session, name);
        session.send(name, detail.data);
        if (this.announce !== "off") this.#say(t.announceSent(name), true);
      });
    return el;
  }

  #measure(s: StateNode, collapsed: boolean): Size {
    const el = this.#boxes.get(s);
    const kind = this.#kind(s);
    if (s.kind === "scxml") return { w: 0, h: 0 };
    if (kind === "history") return { w: 26, h: 26 };
    if (!el) return estimateBox(s, collapsed);
    const container = !collapsed && (kind === "compound" || kind === "parallel");
    if (container) {
      const head = el.querySelector(".head") as HTMLElement | null;
      return head ? measured(head, estimateBox(s, false)) : estimateBox(s, false);
    }
    el.style.width = "max-content";
    const size = measured(el, estimateBox(s, collapsed));
    el.style.width = "";
    // + the active dot, hidden while measuring (7px and a 6px gap), so an active box doesn't truncate its name
    return { w: Math.max(size.w + 13, 64), h: Math.max(size.h, 34) };
  }

  #renderNotice() {
    const e = this.#el;
    const t = this.#strings;
    if (!this.#collapsed.size) {
      e.notice.hidden = true;
      return;
    }
    let hidden = 0;
    for (const c of this.#collapsed) hidden += countInside(c);
    const all = h("button", { type: "button" }, t.expandAll);
    all.addEventListener("click", () => {
      for (const c of this.#collapsed) this.#expandedFolds.add(c);
      this.#collapsed.clear();
      this.#renderAll();
    });
    e.notice.replaceChildren(h("span", {}, t.foldedNotice(hidden, this.#collapsed.size)), all);
    e.notice.hidden = false;
  }

  /** The chart's authoring warnings, collapsed by default; each one focuses the state it's about. */
  #renderWarnings() {
    const box = this.#el.warnings;
    const list = this.#model?.warnings ?? [];
    if (!list.length || this.warnings === "off") {
      box.hidden = true;
      box.replaceChildren();
      return;
    }
    const t = this.#strings;
    const items = list.map((w) => {
      const item = h("li", { part: "warning", "data-code": w.code });
      const target = w.state ? this.#boxes.get(w.state) : undefined;
      if (target) {
        const go = h("button", { type: "button", title: t.showWarningState }, w.message);
        go.addEventListener("click", () => {
          if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1"); // focusable from script only
          target.scrollIntoView?.({ block: "nearest", inline: "nearest" });
          target.focus();
        });
        item.append(go);
      } else item.append(w.message);
      return item;
    });
    box.replaceChildren(h("summary", {}, t.warningsSummary(list.length)), h("ul", {}, ...items));
    box.hidden = false;
  }

  /**
   * A diagram wider than the element is scaled down: with `fit` all the way to the element's
   * width, otherwise no further than `--scxml-min-scale` (default 0.65, so labels stay legible),
   * and the rest scrolls. `--scxml-min-scale: 1` turns the automatic scaling off.
   */
  #applyFit() {
    const d = this.#el.diagram;
    const layout = this.#layout;
    const available = this.#el.canvas.clientWidth - 24;
    let scale = 1;
    if (layout && available > 0 && available < layout.width) {
      const raw = Number.parseFloat(getComputedStyle(this).getPropertyValue("--scxml-min-scale"));
      const floor = this.fit ? 0 : Number.isFinite(raw) ? Math.min(1, Math.max(0.1, raw)) : DEFAULT_MIN_SCALE;
      scale = Math.min(1, Math.max(floor, available / layout.width));
    }
    // transform, not `zoom`: WebKit's zoom shrinks the boxes but not their text. A transform
    // doesn't change the layout box, so negative margins give the scroll area the scaled size.
    d.dataset.scale = String(scale);
    if (!layout || scale >= 1) {
      for (const p of ["transform", "transform-origin", "margin-right", "margin-bottom"]) d.style.removeProperty(p);
      return;
    }
    d.style.setProperty("transform-origin", "0 0");
    d.style.setProperty("transform", `scale(${scale})`);
    d.style.setProperty("margin-right", `${12 - layout.width * (1 - scale)}px`);
    d.style.setProperty("margin-bottom", `${12 - layout.height * (1 - scale)}px`);
  }

  // ───────────────────────────── live state ─────────────────────────────

  /** Classes, parts and accessible names that depend on the configuration and the clock. */
  #renderState() {
    const session = this.#session;
    const t = this.#strings;
    const e = this.#el;
    const clock = this.#playback();
    e.controls.hidden = !clock;
    if (clock) this.#renderControls(clock);
    if (!session || !this.#layout) return;
    const running = session.status === "running";
    const now = session.clock.now();
    for (const [tr, at] of this.#fired) if (now - at >= FIRED_MS || now < at) this.#fired.delete(tr);

    // a terminated session has an empty configuration (the spec exits every state): keep showing
    // where it ended, marked `reached` instead of `active`
    const done = session.status === "done";
    for (const [node, el] of this.#boxes) {
      const kind = this.#kind(node);
      const on = !done && session.isActiveNode(node);
      const reached = done && this.#last.has(node);
      el.classList.toggle("active", on);
      el.classList.toggle("reached", reached);
      el.setAttribute(
        "part",
        parts(
          "state",
          kind,
          node.parent?.kind === "parallel" && "parallel-region",
          this.#collapsed.has(node) && "collapsed",
          on && "active",
          reached && "reached",
        ),
      );
      el.setAttribute("aria-label", t.stateLabel(node.generatedId ? t.kinds[kind] : node.id, t.kinds[kind], on, reached));
    }
    const liveOf = (tr: TransitionNode) => running && session.isActiveNode(tr.source);
    const paint = (tr: TransitionNode, el: Element, base: string[]) => {
      const live = liveOf(tr);
      const fired = this.#fired.has(tr);
      el.classList.toggle("live", live);
      el.classList.toggle("fired", fired);
      el.setAttribute("part", parts(...base, live && "live", fired && "fired"));
      if (el.localName === "button") {
        const button = el as HTMLButtonElement;
        const title = button.title.split("\n")[0]!;
        button.disabled = !live;
        button.title = live || !running ? title : `${title}\n${t.transitionInactive}`;
      }
    };
    for (const [tr, list] of this.#labels) for (const el of list) paint(tr, el, ["transition", "edge-label"]);
    for (const [tr, el] of this.#chips) paint(tr, el, ["transition", "edge-label", "internal"]);
    for (const [tr, list] of this.#paths) for (const p of list) paint(tr, p, ["edge"]);

    // fired highlights fade on the session's clock: a real-time clock needs frames to see time pass
    const c = session.clock;
    if (
      this.#fired.size &&
      !(c instanceof PlaybackClock) &&
      c.constructor.name !== "VirtualClock" &&
      typeof requestAnimationFrame !== "undefined"
    ) {
      cancelAnimationFrame(this.#decayRaf);
      this.#decayRaf = requestAnimationFrame(() => this.#renderState());
    }
    if (session.status === "done" && this.#collapsed.size === 0) {
      e.notice.hidden = false;
      e.notice.replaceChildren(h("span", {}, t.terminated));
    }
  }

  #renderControls(clock: PlaybackClock) {
    const e = this.#el;
    const t = this.#strings;
    e.play.textContent = clock.playing ? t.pause : t.play;
    e.play.setAttribute("aria-pressed", String(!clock.playing));
    e.step.textContent = t.step;
    e.step.disabled = clock.pending === 0;
    if (e.speeds.childElementCount !== SPEEDS.length)
      e.speeds.replaceChildren(
        ...SPEEDS.map(([v, text]) => {
          const b = h("button", { type: "button", "data-speed": String(v) }, text);
          b.addEventListener("click", () => {
            clock.speed = v;
          });
          return b;
        }),
      );
    for (const b of e.speeds.children) b.setAttribute("aria-pressed", String(Number((b as HTMLElement).dataset.speed) === clock.speed));
    e.clock.textContent = t.clockTime(`${(clock.now() / 1000).toFixed(1)} s`);
  }
}

// ───────────────────────────────── helpers ─────────────────────────────────

/** Thrown when the element has nothing to show or its attributes are malformed. */
export class ViewSourceError extends Error {
  /** Always `"SCXML_VIEW_SOURCE"`. */
  readonly code = "SCXML_VIEW_SOURCE";
  constructor(message: string) {
    super(message);
    this.name = "ViewSourceError";
  }
}

type Attrs = Record<string, string | false | null | undefined>;
function h(tag: string, attrs: Attrs = {}, ...children: (Node | string)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    // through the CSSOM, not the style attribute: a strict Content-Security-Policy (no 'unsafe-inline') allows it
    if (k === "style") el.style.cssText = String(v);
    else el.setAttribute(k, v);
  }
  el.append(...children);
  return el;
}

const parts = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");
const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The event name a label sends: "a.b.*" → "a.b", "*" → none. */
function sendableName(descriptor: string): string | undefined {
  if (descriptor === "*") return undefined;
  return descriptor.replace(/\.\*$/, "");
}

function labelText(tr: TransitionNode): string {
  const ev = tr.events.join(" ");
  const cond = tr.cond ? `[${truncate(tr.cond, 22)}]` : "";
  return [ev, cond].filter(Boolean).join(" ");
}

/** Size estimates, for when the element can't measure (no layout engine, e.g. happy-dom). */
function estimateLabel(tr: TransitionNode): Size {
  const text = labelText(tr);
  return text ? { w: Math.ceil(text.length * 6.8 + 18), h: 20 } : { w: 0, h: 0 };
}

function estimateBox(s: StateNode, collapsed: boolean): Size {
  const name = s.generatedId ? s.kind : s.id;
  const internal = s.transitions.filter((t) => !t.targets.length);
  const chipsW = internal.slice(0, MAX_INTERNAL_SHOWN).reduce((w, t) => w + estimateLabel(t).w + 4, 0);
  const w = Math.max(64, name.length * 7.6 + 34 + (s.kind === "parallel" ? 16 : 0), Math.min(chipsW, 260) + 22);
  const chipRows = internal.length ? Math.ceil(Math.max(chipsW, 1) / 260) : 0;
  const isContainer = !collapsed && (s.kind === "parallel" || s.children.length > 0);
  if (isContainer) return { w, h: 26 + chipRows * 24 };
  return { w: collapsed ? Math.max(w, 120) : w, h: 34 + chipRows * 24 + (collapsed ? 50 : 0) };
}

/** Layout size (offsetWidth/Height): unlike getBoundingClientRect it ignores the scale transform. */
function measured(el: HTMLElement, fallback: Size): Size {
  const w = Math.max(el.offsetWidth, el.scrollWidth);
  const h = Math.max(el.offsetHeight, el.scrollHeight);
  return w > 0 && h > 0 ? { w: w + 1, h } : fallback;
}

function countInside(s: StateNode): number {
  let n = 0;
  for (const k of [...s.children, ...s.history]) n += 1 + countInside(k);
  return n;
}

function pathData(points: { x: number; y: number }[]): string {
  return points.map((p, i) => `${i ? "L" : "M"}${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`).join(" ");
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new ViewSourceError(`Could not load ${url}: HTTP ${res.status}`);
  return res.text();
}

if (typeof customElements !== "undefined" && !customElements.get("scxml-view")) customElements.define("scxml-view", ScxmlView);

declare global {
  interface HTMLElementTagNameMap {
    "scxml-view": ScxmlView;
  }
}

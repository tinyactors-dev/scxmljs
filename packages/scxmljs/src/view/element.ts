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
 * for `<data>`), `direction` ("down" (default) | "right" | "auto"), `max-states` (fold
 * large charts beyond this many boxes, default 150), `announce`
 * ("all" | "sends" | "off"), `fit` (scale down to the element's width),
 * `warnings` ("off" hides the list of authoring warnings — see `model.warnings`),
 * `event-data` (JSON object from event names to the data a label click sends,
 * e.g. `{"login": {"user": "ada"}}`), `variables` (list the chart's variables
 * under the diagram), `sends` (JSON array of `{event, data?, label?}`: buttons
 * that send those events). A chart that sends to an I/O processor nobody
 * handles (`<send type="payments">`) gets a stand-in that lists what it received.
 *
 * Properties: `session` (a host-created session; the element then creates,
 * starts and disposes nothing), `options` (extra SessionOptions for sessions
 * the element creates: I/O processors, invokers, loader…), `clock` (e.g. a
 * PlaybackClock: shows play / pause / step controls), `strings`, `source`
 * (SCXML text instead of `src`), `model`, `descriptions` (what each state is
 * about, shown by its help button; XML comments in the source otherwise),
 * `zoom`, and `reload()`.
 *
 * Navigation: the diagram is a canvas. It zooms (the toolbar, Ctrl/⌘ + wheel,
 * a pinch, `+` `-` `0` while the canvas is focused) and pans in every direction,
 * past its edges (a mouse drag, two fingers, the arrow keys); one finger and a
 * plain wheel scroll the page, as on an embedded map. Every compound
 * and parallel state folds and unfolds with its chevron.
 *
 * Events (bubbling, composed): `scxml-load` { session, model },
 * `scxml-error` { message, problems?, error }, `scxml-send` { session, name }
 * (cancelable; fired before a label sends its event).
 *
 * Styling: the shared `--scxml-*` tokens and these parts — `frame`, `canvas`,
 * `state` (+ `atomic` `compound` `parallel` `parallel-region` `final`
 * `history` `collapsed` `active`), `state-name`, `transition` / `edge-label`
 * (+ `live` `fired`), `event`, `cond`, `internal`, `edge` (+ `live` `fired`),
 * `initial`, `expand`, `collapse`, `help`, `help-popover`, `zoom`, `notice`,
 * `error`, `controls`, `play`, `step`, `speeds`, `clock`, `warnings`, `warning`,
 * `run`, `preset-send`, `restart`, `panels`, `panel` (+ `variables` `stand-in`).
 */
import { type Clock, PlaybackClock } from "../clock.ts";
import type { ScxmlData } from "../data/element.ts";
import type { Field } from "../data/xsd.ts";
import type { DataModelFactory } from "../datamodel-base.ts";
import { compile, isCompound, type Model, type StateNode, type TransitionNode } from "../model.ts";
import { parseSCXML, SCXMLSession, type SessionOptions } from "../session.ts";
import type { MicrostepEvent } from "../session-events.ts";
import { Announcer } from "../ui/announcer.ts";
import * as icons from "../ui/icons.ts";
import { eventName, glyph, NOTATION_CSS } from "../ui/notation.ts";
import { arrowMarker, icon } from "../ui/svg.ts";
import { lazySheet, NARROW_WIDTH, themeSheet } from "../ui/theme.ts";
import { anchoredZoom, easeInOut, glide, type Move, smoothPath, type View } from "./camera.ts";
import { reflow, sourceDescription } from "./describe.ts";
import { eventFields } from "./forms.ts";
import { autoCollapse, type ChartLayout, type Direction, layoutChart, portalTransitions, type Size } from "./layout.ts";
import { type StandIns, standIns, unhandledSendTypes, variablesPanel } from "./panels.ts";
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

/**
 * What each state is about, for its help popover: an object from state ids to
 * text, or a function of the state. Wins over the chart's XML comments;
 * return `undefined` to fall back to them.
 */
export type ViewDescriptions = Record<string, string> | ((state: StateNode) => string | null | undefined);

/** SessionOptions for sessions the element creates (its own clock comes from the `clock` property). */
export type ViewOptions = Omit<SessionOptions, "clock">;
/** Layout direction: layers top to bottom (the default), left to right, or `auto` (right above the 760px breakpoint, down below it). */
export type ViewDirection = Direction | "auto";
/** What the live region announces: every step and sent event, only sent events, or nothing. */
export type ViewAnnounce = "all" | "sends" | "off";

const SCXML_MIME = "application/scxml+xml";
/** Default floor for scaling a too-wide diagram down (without `fit`); see `--scxml-min-scale`. */
const DEFAULT_MIN_SCALE = 0.65;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.25;
/** The diagram's margin inside the canvas, px (see `.diagram` in styles.ts). */
const MARGIN = 12;
/** How much of the drawing stays in view however far it is panned (px each way). */
const PAN_KEEP = 48;
/** The arrow keys pan by this much (px), with Shift by PAN_PAGE. */
const PAN_STEP = 40;
const PAN_PAGE = 240;
/** How long a state the view flew to stays marked (ms; the ring's animation in styles.ts). */
const VISITED_MS = 1400;
/** How long a gesture hint stays after the gesture stops (ms). */
const HINT_MS = 1400;
/** Apple's keyboards zoom with ⌘, the others with Ctrl. */
const MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** How long a help popover takes to fade out when the view flies away from it (ms; styles.ts). */
const HELP_FADE_MS = 140;
const FIRED_MS = 900;
/** How long the playback controls stay in full while playing and untouched. */
const IDLE_MS = 3000;
/** How long the zoom level stays up after zooming. */
const ZOOM_LEVEL_MS = 900;
/** Two taps within this long (ms) are a double tap. */
const DOUBLE_TAP_MS = 300;

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

const sheet = lazySheet(VIEW_CSS + NOTATION_CSS);

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
  static observedAttributes = [
    "src",
    "trusted",
    "autostart",
    "interactive",
    "data",
    "direction",
    "max-states",
    "fit",
    "warnings",
    "variables",
    "sends",
  ];

  #shadow!: ShadowRoot;
  #el!: {
    hint: HTMLElement;
    frame: HTMLElement;
    run: HTMLElement;
    restart: HTMLButtonElement;
    panels: HTMLElement;
    controls: HTMLElement;
    play: HTMLButtonElement;
    step: HTMLButtonElement;
    speeds: HTMLButtonElement;
    clock: HTMLElement;
    notice: HTMLElement;
    sendStatus: HTMLElement;
    warnings: HTMLDetailsElement;
    error: HTMLElement;
    canvas: HTMLElement;
    diagram: HTMLElement;
    live: HTMLElement;
    viewport: HTMLElement;
    nav: HTMLElement;
    fit: HTMLButtonElement;
    zoom: HTMLElement;
    zoomLevel: HTMLButtonElement;
    help: HTMLElement;
    form: HTMLFormElement;
  };

  // what's shown
  #session?: SCXMLSession;
  #owned = false;
  #model?: Model;
  #source?: string;
  #options: ViewOptions = {};
  /** Stand-ins for the I/O processors the chart sends to and nobody handles (sessions the element creates). */
  #standIns?: StandIns;
  #variables?: ReturnType<typeof variablesPanel>;
  #clock?: Clock;
  #strings: ViewStrings = defaultViewStrings;
  #descriptions?: ViewDescriptions;
  #generation = 0;
  #loadQueued = false;
  #loadForced = false;

  // layout state
  #layout?: ChartLayout;
  #direction: Direction = "right";
  #collapsed = new Set<StateNode>();
  /** The folds made for `max-states` and not touched since: what the "large chart" notice is about. */
  #autoFolded = new Set<StateNode>();
  #foldsFor?: Model;
  #boxes = new Map<StateNode, HTMLElement>();
  #labels = new Map<TransitionNode, HTMLElement[]>();
  #paths = new Map<TransitionNode, SVGPathElement[]>();
  #chips = new Map<TransitionNode, HTMLElement>();
  /** Transitions listed in their source's box with their target instead of drawn, per box. */
  #portals = new Map<StateNode, TransitionNode[]>();
  #portalChips = new Map<TransitionNode, HTMLElement>();

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
  /** The width the last layout tried to stay within (px; 0: none). */
  #budget = 0;

  // navigation: an explicit zoom (null = automatic, see #applyFit) and the open help popover
  #zoom: number | null = null;
  #scale = 1;
  /** How far the drawing is moved from where the automatic view puts it (px, on screen). */
  #pan = { x: 0, y: 0 };
  #helpFor?: { state: StateNode; button: HTMLElement };
  /** The data each event takes (forms.ts), and the open form: the event and the label it opened from. */
  #fields = new Map<string, Field>();
  #formFor?: { name: string; button: HTMLElement };
  /** `<scxml-data>`'s module once loaded (it is loaded when a chart has an event that takes data). */
  #dataModule?: Promise<typeof import("../data/element.ts")>;
  /** Keep the active states in view (until the user pans or zooms; "fit to width" resumes). */
  #follow = true;
  /** The active states last revealed, so a step that changes nothing doesn't move the drawing. */
  #revealed = "";

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
  /** "down" (layers top to bottom, the default), "right", or "auto" (down when narrower than the shared breakpoint, right otherwise). */
  get direction(): ViewDirection {
    const d = this.getAttribute("direction");
    return d === "right" || d === "auto" ? d : "down";
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

  /** What each state is about (its help popover): an object from state ids to text, or a function of the state. Overrides the chart's XML comments. */
  get descriptions(): ViewDescriptions | undefined {
    return this.#descriptions;
  }
  /** Set what states are about; `undefined` goes back to the chart's XML comments only. */
  set descriptions(d: ViewDescriptions | undefined) {
    this.#descriptions = d;
    if (this.#helpFor) this.#openHelp(this.#helpFor.state, this.#helpFor.button);
  }

  /** What a state's help popover explains: `descriptions` first, then the XML comments documenting it in the source. */
  describe(state: StateNode): string | undefined {
    const d = this.#descriptions;
    const given = typeof d === "function" ? d(state) : d && Object.hasOwn(d, state.id) ? d[state.id] : undefined;
    return given?.trim() ? given : sourceDescription(state);
  }

  /** The diagram's scale (1 = actual size). Reading it gives the scale in use; setting a number zooms, `null` goes back to automatic. */
  get zoom(): number {
    return this.#scale;
  }
  /** Zoom to this scale (clamped to 0.15–4), or `null` for the automatic scale (fitted to the element's width, see `fit`). */
  set zoom(scale: number | null) {
    this.#zoomTo(scale);
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
      case "variables":
      case "sends":
        this.#renderPanels();
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
      // a send to a processor nobody handles would fail in the view: a stand-in keeps it, and the panel shows it
      let session: SCXMLSession | undefined;
      const now = () => session?.clock.now() ?? 0;
      const types = unhandledSendTypes(root, opts.ioprocessors ?? []);
      const stand = types.length ? standIns(types, this.#strings, now, () => this.#renderPanels()) : undefined;
      const ioprocessors = [...(opts.ioprocessors ?? []), ...(stand?.processors ?? [])];
      session = new SCXMLSession(model, { ...opts, ioprocessors, loader, datamodel, data, clock: this.#clock });
      this.#standIns = stand;
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
    if (!owned) this.#standIns = undefined; // a host's session: the host handles its processors
    this.#standIns?.restart();
    this.#renderPanels();
    this.#model = session.model;
    this.#fields = eventFields(session.model);
    if (this.#fields.size) this.#loadData();
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
    if (this.#formFor) this.#closeForm(false);
    this.#variables?.watch(undefined);
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
    const iconButton = (cls: string, part: string, label: string, glyph: Node, onClick: () => void) => {
      const b = h("button", { class: cls, type: "button", part, title: label, "aria-label": label }, glyph) as HTMLButtonElement;
      b.addEventListener("click", onClick);
      return b;
    };
    // controls float over the diagram's bottom edge, both clusters on one line, inset like the diagram:
    //   [play] [step] [speed] t = …  ·········  [−] [level] [+] [fit]
    // playback (a PlaybackClock) on the left: Step only while paused; while playing untouched it
    // shrinks to the play button (#wake). Zoom on the right: fit, in the corner, once the view has
    // left the automatic one; −/level/+ beside it on hover, keyboard focus, or while zooming
    // (−/+ give way to pinch and double tap on touch screens)
    const play = iconButton("play", "play", t.play, icon(icons.play, 16), () => this.#playback()?.toggle());
    const step = iconButton("step", "step", t.stepHint, icon(icons.stepForward, 16), () => this.#step());
    const speeds = h("button", { class: "speeds", type: "button", part: "speeds", title: t.speedLabel }) as HTMLButtonElement;
    speeds.addEventListener("click", () => {
      const clock = this.#playback();
      if (!clock) return;
      const i = SPEEDS.findIndex(([v]) => v === clock.speed);
      clock.speed = SPEEDS[(i + 1) % SPEEDS.length]![0];
    });
    const clock = h("span", { class: "clock", part: "clock" });
    const controls = h(
      "div",
      { class: "controls", part: "controls", role: "group", "aria-label": t.playbackLabel, hidden: "" },
      play,
      step,
      speeds,
      clock,
    );
    const notice = h("div", { class: "notice", part: "notice", hidden: "" });
    // what became of an event sent by clicking a label, when it wasn't the obvious (a transition fired)
    const sendStatus = h("div", { class: "notice send-status", part: "send-status", hidden: "" });
    const warnings = h("details", { class: "warnings", part: "warnings", hidden: "" }) as HTMLDetailsElement;
    const error = h("div", { class: "error", part: "error", role: "alert", hidden: "" });
    const diagram = h("div", { class: "diagram", role: "group" });
    // focusable: it takes the arrow keys (pan), and the playback and zoom shortcuts
    const canvas = h("div", { class: "canvas", part: "canvas", tabindex: "0" }, diagram);
    const fit = iconButton("zoom-reset", "fit", t.zoomReset, icon(icons.scan, 16), () => this.#fitSmooth());
    fit.append(h("span", {}, t.fit));
    const zoomLevel = iconButton("zoom-level", "zoom-level", t.zoomActual, document.createTextNode("100%"), () => this.#zoomSmooth(1));
    const zoom = h(
      "div",
      { class: "zoom", part: "zoom", role: "group", "aria-label": t.zoomToolbar },
      iconButton("zoom-out", "zoom-out", t.zoomOut, icon(icons.minus, 16), () => this.#zoomSmooth(this.#scale / ZOOM_STEP)),
      zoomLevel,
      iconButton("zoom-in", "zoom-in", t.zoomIn, icon(icons.plus, 16), () => this.#zoomSmooth(this.#scale * ZOOM_STEP)),
    );
    const nav = h("div", { class: "nav", hidden: "" }, zoom, fit);
    const help = h("div", { class: "help-popover", part: "help-popover", role: "dialog", tabindex: "-1", id: "help-popover", hidden: "" });
    // the form is in the top layer (a manual popover), placed against the window: it may be taller
    // than the diagram, and nothing of the page clips it
    const form = h("form", {
      popover: "manual",
      class: "form-popover",
      part: "form-popover",
      role: "dialog",
      tabindex: "-1",
      hidden: "",
    }) as HTMLFormElement;
    const hint = h("div", { class: "hint", part: "hint", "aria-hidden": "true", hidden: "" });
    const viewport = h("div", { class: "viewport" }, canvas, hint, controls, nav, help, form);
    const live = h("div", { class: "sr-only", role: "status", "aria-live": "polite", "aria-atomic": "true" });
    // under the diagram, for a chart run as a demo (#renderPanels)
    const restart = iconButton("restart", "restart", t.restart, icon(icons.rotateCcw, 16), () => this.reload());
    const run = h("div", { class: "run", part: "run", role: "group", "aria-label": t.runLabel, hidden: "" });
    const panels = h("div", { class: "panels", part: "panels", hidden: "" });
    const frame = h("div", { class: "frame", part: "frame" }, notice, sendStatus, warnings, error, viewport, run, panels, live);
    this.#shadow.append(frame);
    this.#el = {
      hint,
      frame,
      run,
      restart,
      panels,
      controls,
      play,
      step,
      speeds,
      clock,
      notice,
      sendStatus,
      warnings,
      error,
      canvas,
      diagram,
      live,
      viewport,
      nav,
      fit,
      zoom,
      zoomLevel,
      help,
      form,
    };
    for (const type of ["pointermove", "pointerdown", "keydown", "focusin", "wheel", "touchstart"])
      viewport.addEventListener(type, () => this.#wake(), { passive: true });
    this.#wireNavigation();
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

  // ─────────────────────────────── navigation ───────────────────────────────

  /** Zoom (Ctrl/⌘ + wheel, pinch, + − 0), pan (drag), and closing the help popover. */
  #wireNavigation() {
    const { canvas, help, form } = this.#el;
    canvas.addEventListener(
      "wheel",
      (e) => {
        // a plain wheel scrolls the page (with a hint how to zoom); a trackpad pinch arrives as a wheel event with ctrlKey
        if (!this.#layout) return;
        if (!(e.ctrlKey || e.metaKey)) return this.#hint(this.#strings.hintWheel(MAC ? "⌘" : "Ctrl"));
        e.preventDefault();
        this.#stopMotion();
        this.#takeOver();
        // a wheel notch (~100px) zooms by about a fifth; a pinch sends many small deltas
        const factor = Math.exp(-Math.max(-100, Math.min(100, e.deltaY * (e.deltaMode === 1 ? 20 : 1))) * 0.002);
        this.#zoomTo(this.#scale * factor, { x: e.clientX, y: e.clientY });
      },
      { passive: false },
    );
    canvas.addEventListener("keydown", (e) => {
      if (e.composedPath()[0] !== canvas || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "+" || e.key === "=") this.#zoomSmooth(this.#scale * ZOOM_STEP);
      else if (e.key === "-" || e.key === "_") this.#zoomSmooth(this.#scale / ZOOM_STEP);
      else if (e.key === "0") this.#fitSmooth();
      else {
        const step = e.shiftKey ? PAN_PAGE : PAN_STEP;
        const by = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
        if (!by || !this.#layout) return;
        this.#stopMotion();
        this.#takeOver();
        this.#panTo(this.#pan.x + by[0]!, this.#pan.y + by[1]!);
      }
      e.preventDefault();
    });
    this.#wirePinch();
    // drag to pan (mouse and pen; one finger scrolls the page, two pan: #wirePinch), starting anywhere but a control
    let drag: { id: number; x: number; y: number; left: number; top: number; moved: boolean } | undefined;
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.pointerType === "touch") return;
      const target = e.composedPath()[0] as Element;
      if (target?.closest?.("button, a, input, select, textarea, summary")) return;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, left: this.#pan.x, top: this.#pan.y, moved: false };
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved) {
        if (Math.abs(dx) + Math.abs(dy) < 4) return;
        drag.moved = true;
        this.#stopMotion();
        this.#takeOver();
        canvas.setPointerCapture?.(e.pointerId);
        canvas.classList.add("panning");
      }
      e.preventDefault();
      this.#panTo(drag.left + dx, drag.top + dy);
    });
    const end = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = undefined;
      canvas.classList.remove("panning");
      if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    // a double click zooms in on the spot, or back to fit (as a double tap does)
    canvas.addEventListener("dblclick", (e) => {
      const target = e.composedPath()[0] as Element;
      if (target?.closest?.("button, a, input, select, textarea, summary") || !this.#layout) return;
      e.preventDefault();
      this.#zoomToggle({ x: e.clientX, y: e.clientY });
    });
    help.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      this.#closeHelp(true);
    });
    form.addEventListener("keydown", (e) => {
      // Enter sends from any box but a multi-line one (the boxes are in <scxml-data>'s shadow
      // root, where the browser's implicit submission doesn't reach)
      const target = e.composedPath()[0] as HTMLElement;
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && target.localName !== "textarea" && target.localName !== "button") {
        e.preventDefault();
        this.#submitForm();
        return;
      }
      if (e.key !== "Escape") return;
      e.stopPropagation();
      this.#closeForm(true);
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.#submitForm();
    });
    this.#shadow.addEventListener("pointerdown", (e) => {
      const path = e.composedPath();
      if (this.#formFor && !path.includes(form) && !path.includes(this.#formFor.button)) this.#closeForm(false);
      if (!this.#helpFor) return;
      if (!path.includes(help) && !path.includes(this.#helpFor.button)) this.#closeHelp(false);
    });
  }

  /**
   * Touch: one finger scrolls the page (natively: the canvas doesn't scroll), two move the
   * diagram: they pan it and pinch-zoom it, the point under their midpoint staying under it
   * (`touch-action: pan-x pan-y` on the canvas keeps the browser's own pinch out of it).
   * A double tap zooms in on that spot, or, when already zoomed in, back to fit (like Photos).
   */
  #wirePinch() {
    const canvas = this.#el.canvas;
    let pinch: { dist: number; scale: number; point: { x: number; y: number } } | undefined;
    /** the last single-finger tap (no movement): where and when */
    let tap: { x: number; y: number; at: number } | undefined;
    let start: { x: number; y: number; moved: boolean } | undefined;
    const dist = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    const mid = (t: TouchList) => ({ x: (t[0]!.clientX + t[1]!.clientX) / 2, y: (t[0]!.clientY + t[1]!.clientY) / 2 });
    canvas.addEventListener(
      "touchstart",
      (e) => {
        if (e.touches.length === 2 && this.#layout) {
          this.#stopMotion();
          this.#takeOver();
          pinch = { dist: dist(e.touches), scale: this.#scale, point: this.#pointAt(mid(e.touches)) };
          start = undefined;
          tap = undefined;
        } else if (e.touches.length === 1) start = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY, moved: false };
      },
      { passive: true },
    );
    canvas.addEventListener(
      "touchmove",
      (e) => {
        if (start && e.touches.length === 1) {
          const t = e.touches[0]!;
          if (!start.moved && Math.abs(t.clientX - start.x) + Math.abs(t.clientY - start.y) > 8) {
            start.moved = true;
            // one finger scrolls the page, not the diagram: say how to move it
            this.#hint(this.#strings.hintTouch);
          }
        }
        if (!pinch || e.touches.length !== 2) return;
        e.preventDefault();
        const d = dist(e.touches);
        if (pinch.dist > 0 && d > 0) this.#zoomTo(pinch.scale * (d / pinch.dist), mid(e.touches), pinch.point);
      },
      { passive: false },
    );
    const end = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = undefined;
      if (e.type !== "touchend" || e.touches.length || !start || start.moved) {
        start = undefined;
        return;
      }
      // a tap on a control is that control's
      const target = e.composedPath()[0] as Element;
      const s0 = start;
      start = undefined;
      if (target?.closest?.("button, a, input, select, textarea, summary") || !this.#layout) return;
      const now = e.timeStamp;
      if (tap && now - tap.at < DOUBLE_TAP_MS && Math.hypot(s0.x - tap.x, s0.y - tap.y) < 30) {
        tap = undefined;
        e.preventDefault();
        this.#zoomToggle({ x: s0.x, y: s0.y });
      } else tap = { x: s0.x, y: s0.y, at: now };
    };
    canvas.addEventListener("touchend", end, { passive: false });
    canvas.addEventListener("touchcancel", end);
    // WebKit's own pinch gesture on the page
    canvas.addEventListener("gesturestart", (e) => e.preventDefault());
  }

  /** A double tap or click: zoom in on `anchor`, or, when zoomed in already, back to fit (like Photos). */
  #zoomToggle(anchor: { x: number; y: number }) {
    if (this.#zoom != null && this.#zoom > this.#fitScale() + 0.01) this.#fitSmooth();
    else this.#zoomSmooth(Math.max(1, this.#scale * 2), anchor);
  }

  #hintTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * A short hint over the diagram, for a gesture the canvas leaves to the page (a plain wheel, one
   * finger): how to zoom or move it instead, as an embedded map says. It stays while the gesture
   * goes on and fades HINT_MS after it stops; it takes no pointer, and the live region is not told
   * (a keyboard or screen-reader user has `+` `-` `0` and the arrow keys).
   */
  #hint(text: string) {
    const hint = this.#el.hint;
    if (hint.textContent !== text) hint.textContent = text;
    hint.hidden = false;
    hint.classList.add("shown");
    clearTimeout(this.#hintTimer);
    this.#hintTimer = setTimeout(() => {
      hint.classList.remove("shown");
      this.#hintTimer = setTimeout(() => (hint.hidden = true), 200);
    }, HINT_MS);
  }

  /** The automatic scale (what "fit" goes back to). */
  #fitScale(): number {
    return this.#autoScale();
  }

  /**
   * The automatic scale. A diagram wider than the element is scaled down: with `fit` all the way
   * to the element's width, otherwise no further than `--scxml-min-scale` (default 0.65, so labels
   * stay legible), and you pan to the rest. A smaller one grows up to `--scxml-max-scale` (default
   * 1: actual size), as far as the element's width allows, and its height when it has one
   * (`--scxml-height`), so a small chart fills its frame instead of sitting in a corner.
   */
  #autoScale(): number {
    const layout = this.#layout;
    const canvas = this.#el.canvas;
    const available = canvas.clientWidth - 2 * MARGIN;
    if (!layout || !(available > 0) || !(layout.width > 0)) return 1;
    if (available < layout.width) {
      const floor = this.fit ? 0 : this.#minScale();
      return Math.min(1, Math.max(floor, available / layout.width));
    }
    const raw = Number.parseFloat(getComputedStyle(this).getPropertyValue("--scxml-max-scale"));
    const ceiling = Number.isFinite(raw) ? Math.min(MAX_ZOOM, Math.max(1, raw)) : 1;
    if (ceiling <= 1) return 1;
    let scale = Math.min(ceiling, available / layout.width);
    // a diagram of a set height (--scxml-height): grow no taller than the room it leaves the drawing
    const limit = Number.parseFloat(getComputedStyle(this.#el.viewport).maxHeight);
    if (Number.isFinite(limit) && layout.height > 0) {
      const padding = Number.parseFloat(getComputedStyle(canvas).paddingBottom) || 0;
      const room = limit - padding - 2 * MARGIN;
      if (room > 0) scale = Math.min(scale, room / layout.height);
    }
    return Math.max(1, scale);
  }

  /**
   * Scroll the active states into view when they aren't (the whole chart doesn't fit), unless the
   * user has taken over the view. `smooth`: animate (not with reduced motion).
   */
  #revealActive(smooth: boolean) {
    const session = this.#session;
    const layout = this.#layout;
    const canvas = this.#el.canvas;
    if (!this.#follow || !session || !layout || session.status !== "running") return;
    const active = layout.boxes.filter(
      (b) => b.kind !== "root" && session.isActiveNode(b.node) && !layout.boxes.some((k) => k.node.parent === b.node),
    );
    const key = active.map((b) => b.node.id).join(" ");
    if (!active.length || key === this.#revealed) return;
    this.#revealed = key;
    const s = this.#scale;
    const x0 = Math.min(...active.map((b) => b.rect.x)) * s + MARGIN;
    const y0 = Math.min(...active.map((b) => b.rect.y)) * s + MARGIN;
    const x1 = Math.max(...active.map((b) => b.rect.x + b.rect.w)) * s + MARGIN;
    const y1 = Math.max(...active.map((b) => b.rect.y + b.rect.h)) * s + MARGIN;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!(w > 0 && h > 0)) return;
    const pad = 16;
    const { x: px, y: py } = this.#pan;
    const inView = x0 + px >= pad && x1 + px <= w - pad && y0 + py >= pad && y1 + py <= h - pad;
    if (inView) return;
    // centre them; if they don't fit, show their top-left corner. Following stays within the drawing,
    // as a scrolled box did: it never shows empty canvas past the drawing's edges (only a hand does)
    const within = (v: number, size: number, room: number) => Math.min(Math.max(0, v), Math.max(0, size + 2 * MARGIN - room));
    const left = within(x1 - x0 + 2 * pad > w ? x0 - pad : (x0 + x1) / 2 - w / 2, layout.width * s, w);
    const top = within(y1 - y0 + 2 * pad > h ? y0 - pad : (y0 + y1) / 2 - h / 2, layout.height * s, h);
    const c = this.#el.canvas;
    const s1 = this.#scale;
    const end: View = {
      x: (c.clientWidth / 2 + Math.max(0, left) - MARGIN) / s1,
      y: (c.clientHeight / 2 + Math.max(0, top) - MARGIN) / s1,
      scale: s1,
    };
    if (!smooth) {
      this.#stopMotion();
      this.#panTo(-Math.max(0, left), -Math.max(0, top));
      return;
    }
    // a glide at the same scale; it keeps the automatic zoom (no explicit scale, no frozen height)
    const move = glide(this.#view(), end);
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.#stopMotion();
    if (reduce || typeof requestAnimationFrame === "undefined") return this.#panTo(-Math.max(0, left), -Math.max(0, top));
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / move.duration);
      const v = move.at(easeInOut(t));
      this.#panTo(c.clientWidth / 2 - MARGIN - v.x * this.#scale, c.clientHeight / 2 - MARGIN - v.y * this.#scale);
      this.#motion = t < 1 ? requestAnimationFrame(frame) : 0;
    };
    this.#motion = requestAnimationFrame(frame);
  }

  /** "Fit" shows once the view has left the default: zoomed by hand, or no longer following. */
  #syncFit() {
    this.#el.fit.hidden = this.#zoom == null && this.#follow;
  }

  #zoomLevelTimer: ReturnType<typeof setTimeout> | undefined;

  /** Show the zoom level for a moment after zooming (on touch screens, where nothing hovers). */
  #flashZoomLevel() {
    const v = this.#el.viewport;
    v.dataset.zooming = "";
    clearTimeout(this.#zoomLevelTimer);
    this.#zoomLevelTimer = setTimeout(() => delete v.dataset.zooming, ZOOM_LEVEL_MS);
  }

  /** Stop following the active states: the user has taken over the view. */
  #takeOver() {
    if (!this.#follow) return;
    this.#follow = false;
    this.#syncFit();
  }

  /**
   * Set an explicit scale (`null`: back to automatic), keeping the diagram point under
   * `anchor` (client coordinates; default: the middle of the canvas) where it is, or, given
   * `point` (diagram coordinates, from #pointAt), putting that point under `anchor` (a pinch:
   * the point under the fingers follows them).
   */
  #zoomTo(scale: number | null, anchor?: { x: number; y: number }, point?: { x: number; y: number }) {
    const canvas = this.#el.canvas;
    const before = this.#scale;
    if (scale != null && !Number.isFinite(scale)) return;
    const next = scale == null ? null : Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
    if (next != null && this.#zoom == null) {
      // zooming by hand: the canvas keeps the height it has now, the diagram moves inside it
      const h = canvas.clientHeight;
      if (h > 0) canvas.style.setProperty("height", `${h}px`);
    }
    if (next == null) canvas.style.removeProperty("height");
    const r = canvas.getBoundingClientRect();
    const at = { x: anchor?.x ?? r.left + canvas.clientWidth / 2, y: anchor?.y ?? r.top + canvas.clientHeight / 2 };
    // the diagram point that stays (or comes) under the anchor
    const p = point ?? this.#pointAt(at, before);
    this.#zoom = next;
    this.#follow = next == null;
    this.#revealed = "";
    if (next != null) this.#flashZoomLevel();
    if (next == null) this.#pan = { x: 0, y: 0 };
    this.#applyFit();
    if (next == null) {
      this.#revealActive(true);
      return;
    }
    this.#panTo(at.x - r.left - MARGIN - p.x * this.#scale, at.y - r.top - MARGIN - p.y * this.#scale);
  }

  /** The diagram point (layout coordinates) under `at` (client coordinates), at `scale`. */
  #pointAt(at: { x: number; y: number }, scale = this.#scale): { x: number; y: number } {
    const r = this.#el.canvas.getBoundingClientRect();
    return { x: (at.x - r.left - MARGIN - this.#pan.x) / scale, y: (at.y - r.top - MARGIN - this.#pan.y) / scale };
  }

  /**
   * Move the drawing to `x`, `y` (its offset from the automatic view, px), anywhere as long as
   * some of it stays in view (PAN_KEEP px each way). `smooth` glides there (not with reduced motion).
   */
  #panTo(x: number, y: number) {
    const layout = this.#layout;
    const canvas = this.#el.canvas;
    if (!layout || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const w = layout.width * this.#scale;
    const h = layout.height * this.#scale;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const clamp = (v: number, size: number, room: number) =>
      room > 0 ? Math.min(room - MARGIN - Math.min(PAN_KEEP, size), Math.max(Math.min(PAN_KEEP, size) - MARGIN - size, v)) : v;
    const next = { x: clamp(x, w, cw), y: clamp(y, h, ch) };
    if (next.x === this.#pan.x && next.y === this.#pan.y) return;
    this.#pan = next;
    this.#transform();
    this.#placeHelp();
  }

  // ───────────────────────────── the camera ─────────────────────────────
  // When the view moves by itself (a link in a help popover, fit, the zoom buttons and keys, a
  // double click or tap, following the active states) it moves along ./camera.ts's paths, frame by
  // frame. The hand's own moves (a drag, a pinch, Ctrl + wheel, the arrow keys) stay direct, and
  // stop a move under way.

  #motion = 0;

  /** The view now: the diagram point at the canvas's middle, and the scale. */
  #view(): View {
    const c = this.#el.canvas;
    const s = this.#scale;
    return { x: (c.clientWidth / 2 - MARGIN - this.#pan.x) / s, y: (c.clientHeight / 2 - MARGIN - this.#pan.y) / s, scale: s };
  }

  /** Show `v`: an explicit scale (the canvas keeps its height, as when zooming by hand), the point in the middle. */
  #setView(v: View) {
    const c = this.#el.canvas;
    const scale = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.scale));
    if (scale !== this.#scale || this.#zoom == null) {
      if (this.#zoom == null && c.clientHeight > 0) c.style.setProperty("height", `${c.clientHeight}px`);
      this.#zoom = scale;
      this.#applyFit();
    }
    this.#panTo(c.clientWidth / 2 - MARGIN - v.x * this.#scale, c.clientHeight / 2 - MARGIN - v.y * this.#scale);
  }

  /** Run `move`, eased; then `done`. With reduced motion, or without frames, it jumps to the end. */
  #animate(move: Move, done?: () => void) {
    this.#stopMotion();
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || typeof requestAnimationFrame === "undefined" || move.duration <= 0) {
      this.#setView(move.at(1));
      done?.();
      return;
    }
    const start = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - start) / move.duration);
      this.#setView(move.at(easeInOut(t)));
      if (t < 1) this.#motion = requestAnimationFrame(frame);
      else {
        this.#motion = 0;
        done?.();
      }
    };
    this.#motion = requestAnimationFrame(frame);
  }

  /** Stop a move under way where it is (the hand takes over). */
  #stopMotion() {
    if (!this.#motion) return;
    cancelAnimationFrame(this.#motion);
    this.#motion = 0;
  }

  /** Zoom to `scale` around `anchor` (client coordinates; default: the canvas's middle), smoothly. */
  #zoomSmooth(scale: number, anchor?: { x: number; y: number }) {
    if (!this.#layout || !Number.isFinite(scale)) return;
    const c = this.#el.canvas;
    const r = c.getBoundingClientRect();
    const at = anchor ?? { x: r.left + c.clientWidth / 2, y: r.top + c.clientHeight / 2 };
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
    this.#takeOver();
    this.#flashZoomLevel();
    const offset = { x: at.x - r.left - c.clientWidth / 2, y: at.y - r.top - c.clientHeight / 2 };
    this.#animate(anchoredZoom(this.#view(), next, this.#pointAt(at), offset));
  }

  /** Back to the automatic view (fit), smoothly: the scale "fit" chooses, the drawing at its start. */
  #fitSmooth() {
    if (!this.#layout) return this.#zoomTo(null);
    const c = this.#el.canvas;
    const s = this.#autoScale();
    const end: View = { x: (c.clientWidth / 2 - MARGIN) / s, y: (c.clientHeight / 2 - MARGIN) / s, scale: s };
    this.#animate(smoothPath(this.#view(), end, c.clientWidth), () => this.#zoomTo(null));
  }

  /**
   * Fly the view to `state` (a target in a help popover) along the camera's smooth path, then mark
   * the state for a moment and open its help: a flow is followed from state to state. The popover
   * fades out as the view leaves. A state inside a folded container flies to the folded box. The
   * view is the user's from then on ("fit" goes back). With reduced motion it jumps.
   */
  #helpFade: ReturnType<typeof setTimeout> | undefined;

  #journey(state: StateNode) {
    const layout = this.#layout;
    const canvas = this.#el.canvas;
    let node: StateNode | null = state;
    let target = layout?.boxes.find((b) => b.node === node);
    while (layout && !target && node?.parent) {
      node = node.parent;
      target = layout.boxes.find((b) => b.node === node);
    }
    if (!layout || !target || !node) return;
    const arrive = node;
    this.#closeHelp(false, true);
    this.#takeOver();
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const s0 = this.#scale;
    // the end: the state at the scale it has now, unless it's larger than the canvas, then as large as fits
    const room = Math.min((cw - 2 * MARGIN) / target.rect.w, (ch - 2 * MARGIN) / target.rect.h);
    const s1 = Math.max(MIN_ZOOM, Math.min(s0, room > 0 ? room : s0));
    const end: View = { x: target.rect.x + target.rect.w / 2, y: target.rect.y + target.rect.h / 2, scale: s1 };
    this.#animate(smoothPath(this.#view(), end, cw), () => {
      this.#syncFit();
      const box = this.#boxes.get(arrive);
      if (!box) return;
      box.classList.remove("visited");
      void box.offsetWidth; // restart the animation
      box.classList.add("visited");
      setTimeout(() => box.classList.remove("visited"), VISITED_MS);
      const help = box.querySelector<HTMLElement>("button.help");
      if (help) this.#openHelp(arrive, help);
    });
  }

  /** Open the help popover of `state` next to its button. */
  #openHelp(state: StateNode, button: HTMLElement) {
    const t = this.#strings;
    const pop = this.#el.help;
    if (this.#helpFor && this.#helpFor.button !== button) this.#helpFor.button.setAttribute("aria-expanded", "false");
    this.#helpFor = { state, button };
    button.setAttribute("aria-expanded", "true");
    const kind = this.#kind(state);
    const name = state.generatedId ? `(${t.kinds[kind]})` : state.id;
    const text = this.describe(state);
    const heading = h("div", { class: "help-head" }, h("strong", {}, name), h("span", { class: "help-kind" }, t.kinds[kind]));
    const body = text
      ? h("div", { class: "help-text" }, ...reflow(text).map((para) => h("p", {}, para)))
      : h("p", { class: "help-none" }, t.noDescription);
    // each transition in the diagram's notation: its events, its condition after the diamond, and
    // its targets, each a link that flies the view there (#journey)
    const shown = state.transitions.filter((tr) => tr.element);
    const row = (tr: TransitionNode) => {
      const li = h("li", {});
      const events = h("span", { class: "help-events" });
      if (tr.events.length)
        tr.events.forEach((ev, i) => {
          if (i) events.append(" ");
          events.append(eventName(ev));
        });
      else events.append(h("span", { class: "help-eventless" }, t.eventless));
      li.append(events);
      if (tr.cond)
        li.append(h("span", { class: "help-cond", title: tr.cond }, glyph(icons.diamond, t.condition, true), truncate(tr.cond, 40)));
      if (tr.targets.length) {
        const to = h("span", { class: "help-to" }, h("span", { class: "arrow", "aria-hidden": "true" }, "→"));
        tr.targets.forEach((target, i) => {
          if (i) to.append(", ");
          const go = h(
            "button",
            { type: "button", class: "go", part: "go", title: t.goTo(target.id), "aria-label": t.goTo(target.id) },
            target.id,
          );
          go.addEventListener("click", () => this.#journey(target));
          to.append(go);
        });
        li.append(to);
      }
      return li;
    };
    const list = shown.length
      ? [h("div", { class: "help-sub" }, t.helpTransitions), h("ul", { class: "help-transitions" }, ...shown.map(row))]
      : [];
    clearTimeout(this.#helpFade);
    pop.classList.remove("leaving");
    pop.replaceChildren(heading, body, ...list);
    pop.setAttribute("aria-label", t.helpLabel(name));
    pop.hidden = false;
    this.#placeHelp();
    pop.focus({ preventScroll: true });
  }

  #closeHelp(refocus: boolean, fade = false) {
    const open = this.#helpFor;
    this.#helpFor = undefined;
    const pop = this.#el.help;
    clearTimeout(this.#helpFade);
    pop.classList.remove("leaving");
    if (fade && !pop.hidden) {
      // it fades out where it is (it no longer follows the view)
      pop.classList.add("leaving");
      this.#helpFade = setTimeout(() => {
        pop.classList.remove("leaving");
        if (!this.#helpFor) pop.hidden = true;
      }, HELP_FADE_MS);
    } else pop.hidden = true;
    if (!open) return;
    open.button.setAttribute("aria-expanded", "false");
    if (refocus && open.button.isConnected) open.button.focus();
  }

  /**
   * Keep the open popover next to its button (it follows panning and zooming), inside the
   * viewport: below the button, or above it when it fits only there, or else on the side with
   * more room, as tall as that room (it scrolls inside), so the frame never cuts it off.
   */
  #placeHelp() {
    const form = this.#formFor;
    if (form && !this.#el.form.hidden) {
      if (!form.button.isConnected) this.#closeForm(false);
      else this.#place(this.#el.form, form.button);
    }
    const open = this.#helpFor;
    const pop = this.#el.help;
    if (!open || pop.hidden) return;
    if (!open.button.isConnected) return this.#closeHelp(false);
    this.#place(pop, open.button);
  }

  /** Place a popover next to its button: below it, or above when it fits only there, else on the side with more room. */
  #place(pop: HTMLElement, button: HTMLElement) {
    const fixed = pop === this.#el.form;
    const vp = fixed
      ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
      : (pop.parentElement as HTMLElement).getBoundingClientRect();
    const b = button.getBoundingClientRect();
    const w = pop.offsetWidth;
    const maxLeft = Math.max(4, vp.width - w - 4);
    pop.style.setProperty("left", `${Math.min(maxLeft, Math.max(4, b.left - vp.left + b.width / 2 - 20))}px`);
    pop.style.removeProperty("max-height");
    const ph = pop.offsetHeight;
    const top = Math.max(4, b.bottom - vp.top + 6); // where it starts below the button
    const bottom = Math.min(vp.height - 4, b.top - vp.top - 6); // where it ends above it
    const roomBelow = vp.height - 4 - top;
    const roomAbove = bottom - 4;
    const fitsBelow = ph <= roomBelow;
    const upwards = !fitsBelow && (ph <= roomAbove || roomAbove > roomBelow);
    const room = upwards ? roomAbove : roomBelow;
    if (ph > room) pop.style.setProperty("max-height", `${Math.max(48, room)}px`);
    pop.style.setProperty("top", `${upwards ? Math.max(4, bottom - Math.min(ph, room)) : top}px`);
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
    // the layout wraps parallel regions to the width: lay out again when it changed noticeably
    const budget = (this.#el.canvas.clientWidth - 2 * MARGIN) / this.#minScale();
    const moved = !this.#budget || Math.abs(budget - this.#budget) / this.#budget > 0.15;
    if ((this.direction === "auto" && crossed) || moved) this.#relayout();
    else this.#applyFit();
  }

  /** The automatic scale's floor: `--scxml-min-scale` (default 0.65); `fit` scales further, but wraps the same. */
  #minScale(): number {
    const raw = Number.parseFloat(getComputedStyle(this).getPropertyValue("--scxml-min-scale"));
    return Number.isFinite(raw) ? Math.min(1, Math.max(0.1, raw)) : DEFAULT_MIN_SCALE;
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
      this.#autoFolded = new Set(this.#collapsed);
      this.#foldsFor = model;
    }
    this.#closeHelp(false);
    this.#boxes.clear();
    this.#labels.clear();
    this.#paths.clear();
    this.#chips.clear();
    this.#portalChips.clear();
    // long-distance transitions: chips in their (drawn) source's box, not edges
    const portals = portalTransitions(model.root, this.#collapsed);
    this.#portals.clear();
    for (const tr of portals) {
      let box = tr.source;
      for (let n = box.parent; n; n = n.parent) if (this.#collapsed.has(n)) box = n;
      (this.#portals.get(box) ?? this.#portals.set(box, []).get(box)!).push(tr);
    }
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
        if (!tr.targets.length || !labelText(tr) || portals.has(tr)) continue;
        const el = this.#label(tr);
        measureHost.append(el);
        labelSizes.set(tr, measured(el, estimateLabel(tr)));
      }
    }
    measureHost.remove();

    // 3. layout
    // the width that fits at the smallest automatic scale: parallel regions wrap to stay within it
    const available = e.canvas.clientWidth - 2 * MARGIN;
    this.#budget = available > 0 ? available / this.#minScale() : 0;
    const layout = layoutChart(model.root, {
      direction: this.#direction,
      maxWidth: this.#budget || undefined,
      collapsed: this.#collapsed,
      portals,
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
    // the width the element has NOW: when its width follows its content (inline-block, a flex
    // item…), drawing just changed it, and that resize mustn't count as a reason to lay out again
    const after = e.canvas.clientWidth - 2 * MARGIN;
    if (this.#budget && after > 0) this.#budget = after / this.#minScale();
    this.#revealed = "";
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
    // the title row: [fold toggle] name [help]
    const row = h("div", { class: "title" });
    if (container || collapsed) {
      const fold = h(
        "button",
        {
          class: `toggle ${collapsed ? "expand" : "collapse"}`,
          type: "button",
          part: collapsed ? "expand" : "collapse",
          "aria-expanded": String(!collapsed),
          "aria-label": `${collapsed ? t.expand : t.collapse} ${display}`,
          title: collapsed ? t.expand : t.collapse,
        },
        icon(collapsed ? icons.chevronRight : icons.chevronDown),
      );
      fold.addEventListener("click", () => this.#toggleFold(s));
      row.append(fold);
    }
    row.append(name);
    const help = h(
      "button",
      {
        class: "help",
        type: "button",
        part: "help",
        "aria-label": t.helpLabel(display),
        "aria-expanded": "false",
        "aria-controls": "help-popover",
        title: t.helpLabel(display),
      },
      icon(icons.circleHelp),
    );
    help.addEventListener("click", () => {
      if (this.#helpFor?.button === help) this.#closeHelp(false);
      else this.#openHelp(s, help);
    });
    row.append(help);
    const internal = this.#internal(s);
    if (container) {
      el.append(h("div", { class: "head" }, row, ...(internal ? [internal] : [])));
      return el;
    }
    el.append(row);
    if (internal) el.append(internal);
    if (collapsed) el.append(h("span", { class: "badge-count" }, t.statesInside(countInside(s))));
    return el;
  }

  /** Fold or unfold a container, keeping keyboard focus on its toggle. */
  #toggleFold(s: StateNode) {
    this.#autoFolded.delete(s);
    if (this.#collapsed.has(s)) this.#collapsed.delete(s);
    else this.#collapsed.add(s);
    this.#renderAll();
    const box = this.#boxes.get(s);
    (box?.querySelector(".toggle") as HTMLElement | null)?.focus({ preventScroll: true });
  }

  /**
   * Chips inside a state's box: its long-distance transitions ("event → target", all of them;
   * hovering one marks its target), then its targetless ones (the first few).
   */
  #internal(s: StateNode): HTMLElement | undefined {
    const list = s.transitions.filter((tr) => !tr.targets.length);
    const far = this.#portals.get(s) ?? [];
    if (!list.length && !far.length) return undefined;
    const wrap = h("div", { class: "internal", part: "internal" });
    for (const tr of far) {
      const chip = this.#label(tr, true, true);
      const mark = (on: boolean) => {
        for (const target of tr.targets) {
          let box = target;
          for (let n = box.parent; n; n = n.parent) if (this.#collapsed.has(n)) box = n;
          this.#boxes.get(box)?.classList.toggle("portal-target", on);
        }
      };
      chip.addEventListener("pointerenter", () => mark(true));
      chip.addEventListener("pointerleave", () => mark(false));
      chip.addEventListener("focus", () => mark(true));
      chip.addEventListener("blur", () => mark(false));
      wrap.append(chip);
      this.#portalChips.set(tr, chip);
    }
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
  #label(tr: TransitionNode, chip = false, withTarget = false): HTMLElement {
    const t = this.#strings;
    const name = tr.events.map(sendableName).find((n): n is string => !!n);
    const interactive = this.interactive && !!name;
    const el = h(interactive ? "button" : "span", {
      class: `${chip ? "chip" : "label"} ev-chip`,
      part: parts("transition", "edge-label"),
      ...(interactive ? { type: "button" } : {}),
    });
    const events = tr.events.length ? tr.events : [t.eventless];
    events.forEach((ev, i) => {
      if (i) el.append(" ");
      // the event's name as written: the namespace quieter, its kind in the state colours
      el.append(h("span", { part: "event" }, tr.events.length ? eventName(ev) : ev));
    });
    if (interactive && name && this.#fields.has(name))
      el.append(h("span", { class: "takes", part: "takes-data", title: t.takesData, "aria-hidden": "true" }, "…"));
    if (tr.cond) el.append(h("span", { class: "cond", part: "cond" }, `[${truncate(tr.cond, 22)}]`));
    const targets = tr.targets.map((s) => s.id).join(", ");
    if (withTarget) {
      el.classList.add("portal");
      el.append(h("span", { class: "to", part: "target" }, `→ ${targets}`));
    }
    el.setAttribute("aria-label", t.transitionLabel(tr.events.join(" ") || t.eventless, targets));
    el.title = [tr.events.join(" ") || t.eventless, tr.cond && `[${tr.cond}]`, targets && `→ ${targets}`].filter(Boolean).join(" ");
    if (interactive) el.addEventListener("click", () => name && this.#activate(name, el));
    return el;
  }

  /**
   * A label was clicked: send its event, or first ask for its data when it takes some (a schema
   * or what the chart reads, forms.ts) and the page gave none (`event-forms`: `auto`, `always`, `off`).
   */
  #activate(name: string, button: HTMLElement) {
    const mode = this.getAttribute("event-forms") ?? "auto";
    const field = this.#fields.get(name);
    const given = this.#eventData(name);
    if (!field || mode === "off" || (mode !== "always" && given !== undefined)) return this.#sendEvent(name);
    if (this.#formFor?.button === button) return this.#closeForm(false);
    void this.#openForm(name, field, button, given);
  }

  /** The form for `name`'s data, next to the label it opened from: `<scxml-data>` (loaded on demand), Send and Cancel. */
  async #openForm(name: string, field: Field, button: HTMLElement, given: unknown) {
    const t = this.#strings;
    this.#closeHelp(false);
    if (this.#formFor) this.#formFor.button.setAttribute("aria-expanded", "false");
    this.#formFor = { name, button };
    button.setAttribute("aria-expanded", "true");
    await this.#loadData();
    if (this.#formFor?.button !== button) return; // closed, or another opened, while it loaded
    const data = document.createElement("scxml-data") as ScxmlData;
    data.setAttribute("part", "form-data");
    data.field = { ...field, name };
    if (given !== undefined) data.value = given;
    const send = h("button", { type: "submit", class: "primary", part: "form-send" }, t.formSend);
    const cancel = h("button", { type: "button", class: "secondary", part: "form-cancel" }, t.formCancel);
    cancel.addEventListener("click", () => this.#closeForm(true));
    const head = h("div", { class: "help-head" }, h("strong", {}, eventName(name)));
    const doc = field.doc ? [h("p", { class: "form-doc" }, field.doc)] : [];
    const pop = this.#el.form;
    pop.replaceChildren(head, ...doc, data, h("div", { class: "form-actions" }, cancel, send));
    pop.setAttribute("aria-label", t.formLabel(name));
    this.#formShown(true);
    this.#place(pop, button);
    // what needs typing first: the form's first box, else Send
    requestAnimationFrame(() => {
      const first = data.shadowRoot?.querySelector<HTMLElement>("input:not([type=checkbox]), select, textarea");
      (first ?? send).focus({ preventScroll: true });
      this.#placeHelp();
    });
    data.addEventListener("input", () => this.#placeHelp());
  }

  /** Load `<scxml-data>` (once) and make sure it is defined. */
  #loadData() {
    this.#dataModule ??= import("../data/element.ts").then((m) => {
      if (!customElements.get("scxml-data")) customElements.define("scxml-data", m.ScxmlData);
      return m;
    });
    return this.#dataModule;
  }

  /** Show or hide the form: its `hidden` and its popover state together, whatever they were. */
  #formShown(on: boolean) {
    const pop = this.#el.form;
    pop.hidden = !on;
    try {
      const open = pop.matches(":popover-open");
      if (on && !open) pop.showPopover?.();
      if (!on && open) pop.hidePopover?.();
    } catch {
      // a DOM without popovers: `hidden` alone shows and hides it
    }
    this.#formWatch(on);
  }

  /** While a form is open: it follows the page's scrolling and resizing, and a press outside it closes it. */
  #formWatch(on: boolean) {
    const op = on ? "addEventListener" : "removeEventListener";
    window[op]("scroll", this.#formFollow, { capture: true, passive: true } as AddEventListenerOptions);
    window[op]("resize", this.#formFollow);
    document[op]("pointerdown", this.#formOutside, true);
  }
  #formFollow = () => this.#placeHelp();
  #formOutside = (e: Event) => {
    const open = this.#formFor;
    const path = e.composedPath();
    if (open && !path.includes(this.#el.form) && !path.includes(open.button)) this.#closeForm(false);
  };

  #submitForm() {
    const open = this.#formFor;
    const data = this.#el.form.querySelector("scxml-data") as ScxmlData | null;
    if (!open || !data) return;
    if (!data.reportValidity()) return;
    const value = data.value;
    this.#closeForm(true);
    this.#sendEvent(open.name, value);
  }

  #closeForm(refocus: boolean) {
    const open = this.#formFor;
    this.#formFor = undefined;
    this.#formShown(false);
    this.#el.form.replaceChildren();
    if (!open) return;
    open.button.setAttribute("aria-expanded", "false");
    if (refocus && open.button.isConnected) open.button.focus();
  }

  /**
   * Send `name` as the reader did (a label, a preset send): `scxml-send` first (cancelable, its
   * `detail.data` writable; it starts as `data`, else the `event-data` attribute's), then what came
   * of it, and the live region says so.
   */
  #sendEvent(name: string, data: unknown = this.#eventData(name)) {
    const session = this.#session;
    if (!session) return;
    const detail: ViewSendDetail = { session, name, data };
    if (!this.#emit<ViewSendDetail>("scxml-send", detail, true)) return;
    this.#watchOutcome(session, name);
    session.send(name, detail.data);
    if (this.announce !== "off") this.#say(this.#strings.announceSent(name), true);
  }

  /** The preset sends of the `sends` attribute: a JSON array of `{event, data?, label?}`. */
  #presetSends(): { event: string; data?: unknown; label?: string }[] {
    const raw = this.getAttribute("sends");
    if (!raw) return [];
    try {
      const list = JSON.parse(raw) as unknown;
      if (!Array.isArray(list)) throw new Error("not an array");
      return list.filter((s): s is { event: string; data?: unknown; label?: string } => typeof s?.event === "string" && !!s.event);
    } catch {
      console.warn(`scxml-view: the sends attribute is not a JSON array of {event, data, label}: ${raw}`);
      return [];
    }
  }

  /**
   * Under the diagram, when the page asks for them or the chart needs them: the run bar (preset
   * sends, then restart at its outer edge) and the panels (the variables, then a stand-in for each
   * processor nobody handles).
   */
  #renderPanels() {
    const e = this.#el;
    if (!e) return;
    const t = this.#strings;
    const session = this.#session;
    const showVariables = this.hasAttribute("variables") && this.getAttribute("variables") !== "false";
    if (showVariables) this.#variables ??= variablesPanel(t);
    this.#variables?.watch(showVariables ? session : undefined);
    const panels = [
      ...(showVariables && this.#variables ? [this.#variables.panel] : []),
      ...(this.#standIns ? [this.#standIns.panel] : []),
    ];
    e.panels.replaceChildren(...panels);
    // the stand-ins' panel shows from the chart's first message
    e.panels.hidden = !panels.some((p) => !p.hidden);
    const sends = this.#presetSends().map(({ event, data, label }) => {
      const b = h(
        "button",
        { type: "button", class: "chip ev-chip live preset", part: "preset-send", title: event },
        label ? label : eventName(event),
      );
      b.addEventListener("click", () => this.#sendEvent(event, data === undefined ? this.#eventData(event) : data));
      return b;
    });
    const restart = this.#owned && session && (sends.length || showVariables || this.#standIns);
    e.run.replaceChildren(...sends, ...(restart ? [e.restart] : []));
    e.run.hidden = !sends.length && !restart;
  }

  #measure(s: StateNode, collapsed: boolean): Size {
    const el = this.#boxes.get(s);
    const kind = this.#kind(s);
    if (s.kind === "scxml") return { w: 0, h: 0 };
    if (kind === "history") return { w: 26, h: 26 };
    if (!el) return estimateBox(s, collapsed, this.#portals.get(s));
    const container = !collapsed && (kind === "compound" || kind === "parallel");
    if (container) {
      const head = el.querySelector(".head") as HTMLElement | null;
      if (!head) return estimateBox(s, false, this.#portals.get(s));
      // the box has no width yet: measure the header at its own width (its chips wrap at their max-width)
      head.style.width = "max-content";
      const size = measured(head, estimateBox(s, false, this.#portals.get(s)));
      head.style.width = "";
      return size;
    }
    el.style.width = "max-content";
    const size = measured(el, estimateBox(s, collapsed, this.#portals.get(s)));
    el.style.width = "";
    // + the active dot, hidden while measuring (7px and a 6px gap), so an active box doesn't truncate its name
    return { w: Math.max(size.w + 13, 64), h: Math.max(size.h, 34) };
  }

  #renderNotice() {
    const e = this.#el;
    const t = this.#strings;
    const auto = [...this.#autoFolded].filter((c) => this.#collapsed.has(c));
    if (!auto.length) {
      e.notice.hidden = true;
      return;
    }
    let hidden = 0;
    for (const c of auto) hidden += countInside(c);
    const all = h("button", { type: "button" }, t.expandAll);
    all.addEventListener("click", () => {
      this.#collapsed.clear();
      this.#autoFolded.clear();
      this.#renderAll();
    });
    e.notice.replaceChildren(h("span", {}, t.foldedNotice(hidden, auto.length)), all);
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

  /** Scale the drawing: the explicit zoom, or the automatic scale (#autoScale). */
  #applyFit() {
    const d = this.#el.diagram;
    const layout = this.#layout;
    const scale = this.#zoom ?? this.#autoScale();
    this.#scale = scale;
    this.#el.canvas.classList.toggle("zoomed", this.#zoom != null);
    const level = this.#strings.zoomLevel(Math.round(scale * 100));
    this.#el.zoomLevel.textContent = level;
    this.#el.zoomLevel.setAttribute("aria-label", `${level}: ${this.#strings.zoomActual}`);
    this.#syncFit();
    this.#el.nav.hidden = !layout;
    // narrow: Fit is its icon, so both clusters share the bottom edge
    this.#el.viewport.toggleAttribute("data-narrow", this.#el.canvas.clientWidth > 0 && this.#el.canvas.clientWidth < 420);
    // transform, not `zoom`: WebKit's zoom shrinks the boxes but not their text. A transform
    // doesn't change the layout box, so margins give the canvas the scaled size.
    d.dataset.scale = String(scale);
    if (!layout || scale === 1) {
      for (const p of ["margin-right", "margin-bottom"]) d.style.removeProperty(p);
    } else {
      d.style.setProperty("margin-right", `${MARGIN - layout.width * (1 - scale)}px`);
      d.style.setProperty("margin-bottom", `${MARGIN - layout.height * (1 - scale)}px`);
    }
    if (layout) this.#panTo(this.#pan.x, this.#pan.y); // the scale or the canvas changed: keep some in view
    this.#transform();
    this.#placeHelp();
  }

  /** The drawing's transform: moved by the pan, then scaled from its top-left corner. */
  #transform() {
    const d = this.#el.diagram;
    const { x, y } = this.#pan;
    d.dataset.pan = `${Math.round(x)} ${Math.round(y)}`;
    if (!this.#layout || (this.#scale === 1 && x === 0 && y === 0)) {
      for (const p of ["transform", "transform-origin"]) d.style.removeProperty(p);
      return;
    }
    d.style.setProperty("transform-origin", "0 0");
    d.style.setProperty("transform", `translate(${x}px, ${y}px) scale(${this.#scale})`);
  }

  // ───────────────────────────── live state ─────────────────────────────

  /** Classes, parts and accessible names that depend on the configuration and the clock. */
  #renderState() {
    const session = this.#session;
    const t = this.#strings;
    const e = this.#el;
    const clock = this.#playback();
    e.controls.hidden = !clock;
    e.viewport.classList.toggle("has-controls", !!clock);
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
    for (const [tr, el] of this.#portalChips) paint(tr, el, ["transition", "edge-label", "portal"]);
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
    if (session.status === "done" && e.notice.hidden) {
      e.notice.hidden = false;
      e.notice.replaceChildren(h("span", {}, t.terminated));
    }
    // the first reveal after a layout jumps, later ones (steps) glide
    this.#revealActive(this.#revealed !== "");
  }

  #renderControls(clock: PlaybackClock) {
    const e = this.#el;
    const t = this.#strings;
    const playing = clock.playing;
    if (e.play.dataset.playing !== String(playing)) {
      e.play.dataset.playing = String(playing);
      e.play.replaceChildren(icon(playing ? icons.pause : icons.play, 16));
      const label = playing ? t.pause : t.play;
      e.play.setAttribute("aria-label", label);
      e.play.title = `${label} (${t.playKey})`;
      this.#wake();
    }
    e.play.setAttribute("aria-pressed", String(!playing));
    // stepping only means something while paused
    e.step.hidden = playing;
    e.step.disabled = clock.pending === 0;
    const speed = SPEEDS.find(([v]) => v === clock.speed)?.[1] ?? `${clock.speed}×`;
    e.speeds.textContent = speed;
    e.speeds.setAttribute("aria-label", t.speedButton(speed));
    e.clock.textContent = t.clockTime(`${(clock.now() / 1000).toFixed(1)} s`);
  }

  #idleTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Show the playback controls in full; while the clock plays, shrink them to the play button
   * again after a few seconds untouched. Never while the pointer is on them or keyboard focus is
   * in them (a mouse click leaves focus behind; that doesn't count). Real time: this is about the
   * person, not the chart.
   */
  #wake() {
    const controls = this.#el.controls;
    controls.classList.remove("idle");
    clearTimeout(this.#idleTimer);
    if (!this.#playback()?.playing) return;
    const settle = () => {
      if (!this.#playback()?.playing) return;
      if (controls.matches(":hover") || controls.querySelector(":focus-visible")) this.#idleTimer = setTimeout(settle, IDLE_MS);
      else controls.classList.add("idle");
    };
    this.#idleTimer = setTimeout(settle, IDLE_MS);
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

/** `portals`: the state's long-distance transitions, listed as chips with their target. */
function estimateBox(s: StateNode, collapsed: boolean, portals: TransitionNode[] = []): Size {
  const name = s.generatedId ? s.kind : s.id;
  const internal = [...portals, ...s.transitions.filter((t) => !t.targets.length).slice(0, MAX_INTERNAL_SHOWN)];
  const targetW = (t: TransitionNode) => (portals.includes(t) ? t.targets.map((x) => x.id).join(", ").length * 6.8 + 16 : 0);
  const chipsW = internal.reduce((w, t) => w + estimateLabel(t).w + targetW(t) + 4, 0);
  const isContainer = !collapsed && (s.kind === "parallel" || s.children.length > 0);
  // the help button, and the fold toggle of containers
  const icons = 22 + (isContainer || collapsed ? 18 : 0);
  const w = Math.max(64, name.length * 7.6 + 34 + icons + (s.kind === "parallel" ? 16 : 0), Math.min(chipsW, 260) + 22);
  const chipRows = internal.length ? Math.ceil(Math.max(chipsW, 1) / 260) : 0;
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

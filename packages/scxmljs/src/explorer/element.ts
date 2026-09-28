/**
 * <scxml-explorer> — explore a running SCXML system at C4-style levels:
 *
 *   System   machines (root + invoked children) and external services, and who talks to whom
 *   Machine  one machine: a tree of its states, a FOCUS on one compound state
 *            (its children and the transitions between them — never the whole
 *            chart), doors in/out of the focus, and the events accepted right now
 *   State    detail for one state: actions, transitions, invokes, data
 *
 * No canvas, no pan/zoom: navigation is tree + breadcrumbs + drill-in, and the
 * layout collapses to one pane with bottom tabs in narrow containers.
 * Big charts: the tree is windowed, lists are grouped/filterable and cut off
 * with "+N more", the focus switches from diagram to list when it gets crowded.
 *
 * Custom UI goes in through named slots (works with any framework):
 *   state:<id>          in that state's card
 *   detail:<id>         in that state's detail pane
 *   event:<descriptor>  in the row of that accepted event (e.g. a form for its data)
 *   service:<alias>     in that service's card at the System level
 *   toolbar             in the header, before the Follow toggle
 *   empty-tree, empty-events, empty-detail   replace the empty-state messages
 *
 *   const x = document.querySelector("scxml-explorer");
 *   x.attach({ session, processors, clock });   // then session.start()
 *
 * Properties: `session`, `processors`, `clock` (setting one re-attaches),
 * `follow`, `strings` (translations), `announce`, `announceInterval`.
 * Attributes: `follow="false"` starts without following; `announce="off|sends|all"`.
 *
 * Keyboard: the tree follows the ARIA tree pattern (↑ ↓ ← → Home End, Enter,
 * type-ahead); cards, rows, lanes and doors are focusable (Enter drills into a
 * container or selects a state, Space selects); Space / "." play-pause and step
 * when a PlaybackClock is attached. A polite live region announces steps and
 * sent events.
 * Events (bubbling, composed): `scxml-focus`, `scxml-select`, `scxml-send`
 * (cancelable: `preventDefault()` stops the event from being sent).
 * Styling: `--scxml-*` custom properties and `::part()` — see the README.
 */
import { type Clock, PlaybackClock } from "../clock.ts";
import { isAtomic, type StateNode, type TransitionNode } from "../model.ts";
// types only: the explorer must never pull in a data model (and with it QuickJS)
import type { IOProcessor, SCXMLSession as Session } from "../session.ts";
import { Announcer } from "../ui/announcer.ts";
import { arrowMarker } from "../ui/svg.ts";
import { lazySheet, themeSheet } from "../ui/theme.ts";
import { type LabelRequest, placeLabels } from "./layout.ts";
import { defaultStrings, type ExplorerStrings, type StateKindName } from "./strings.ts";
import { EXPLORER_CSS, NARROW_WIDTH } from "./styles.ts";
import {
  type AcceptedEvent,
  acceptedEvents,
  activeExpansion,
  type ChildSummary,
  descendantCount,
  type FocusEdge,
  focusScope,
  followTarget,
  groupEvents,
  isContainer,
  label,
  type MachineInfo,
  pathTo,
  SystemTracker,
  sendableName,
  type TreeRow,
  total,
  treeRows,
} from "./viewmodel.ts";

type Level = "system" | "machine";
type Tab = "system" | "tree" | "focus" | "events" | "detail";
type Inspector = "events" | "detail";
type EventScopeFilter = "here" | "inherited" | "all";

const DEFAULT_ROW = 30; // tree row height (px) unless --scxml-row-height says otherwise
const DIAGRAM_MAX_CHILDREN = 9;
const LIST_PAGE = 40;
const DOORS_SHOWN = 6;

/** Only the kinds that behave differently get a mark; plain states and containers go without. */
const KIND_MARK: Record<string, string> = { parallel: "∥", final: "◎", history: "H" };
const kindOf = (s: StateNode): StateKindName => (s.kind === "state" ? (s.children.length ? "compound" : "atomic") : s.kind);

/** What the live region announces: every step and sent event, only sent events, or nothing. */
export type AnnounceMode = "all" | "sends" | "off";

/** What `attach()` (or the `session` / `processors` / `clock` properties) takes. */
export interface ExplorerAttachOptions {
  /** The root session to show. Invoked child sessions are discovered automatically. */
  session: Session;
  /** The I/O processors the session was created with (shown at the System level). */
  processors?: IOProcessor[];
  /** The session's clock. A `PlaybackClock` adds play / pause / step / speed controls. Defaults to `session.clock`. */
  clock?: Clock;
}

/** `scxml-focus`: the focused state changed (user navigation or follow). */
export interface ExplorerFocusDetail {
  /** the session of the machine being shown (the root or an invoked child) */
  session: Session;
  /** the focused container state (`<scxml>`, compound or parallel) */
  state: StateNode;
}

/** `scxml-select`: a state was selected for the detail pane. */
export interface ExplorerSelectDetail {
  /** the session of the machine the state belongs to */
  session: Session;
  /** the selected state */
  state: StateNode;
}

/** `scxml-send`: the UI is about to send an event. Cancelable. */
export interface ExplorerSendDetail {
  /** the session the event goes to */
  session: Session;
  /** the event name */
  name: string;
  /** the event data (from the data field, parsed as JSON), or `undefined` */
  data: unknown;
}

const SPEEDS: [number, string][] = [
  [0.25, "¼×"],
  [0.5, "½×"],
  [1, "1×"],
  [2, "2×"],
  [4, "4×"],
];

/**
 * Server-side rendering and tests import this module where there is no DOM:
 * extend a stand-in then, and only register the element where it can exist.
 */
const ElementBase: typeof HTMLElement = typeof HTMLElement === "undefined" ? (class {} as unknown as typeof HTMLElement) : HTMLElement;

/**
 * `<scxml-explorer>`: explore a running system at the System level (machines,
 * services, messages), the Machine level (a tree, a focus on one compound
 * state, the accepted events) and per state. Registered by importing
 * `@tinyactors/scxmljs/explorer`.
 *
 * @example
 * ```ts
 * import { createSession } from "@tinyactors/scxmljs/trusted";
 * import "@tinyactors/scxmljs/explorer";
 *
 * const session = await createSession(source);
 * document.querySelector("scxml-explorer")!.attach({ session });
 * session.start();
 * ```
 */
export class ScxmlExplorer extends ElementBase {
  /** Attributes the element reacts to: `follow` and `announce`. */
  static observedAttributes = ["follow", "announce"];

  #shadow: ShadowRoot;
  #tracker?: SystemTracker;
  /** the clock when it can be controlled (play / pause / step) */
  #clock?: PlaybackClock;
  #session?: Session;
  #processors: IOProcessor[] = [];
  #clockOption?: Clock;
  #lastFocus?: StateNode;

  // navigation state
  #level: Level = "machine";
  #machineKey = "";
  #focus?: StateNode;
  #selected?: StateNode;
  #selectedService?: string;
  #follow = true;
  #tab: Tab = "focus";
  #inspector: Inspector = "events";
  #crumbsExpanded = false;

  // view state
  #expanded = new Map<string, Set<StateNode>>();
  #treeFilter = "";
  #activeOnly = false;
  #focusMode: "auto" | "diagram" | "list" = "auto";
  #focusFilter = "";
  #focusShowAll = false;
  #doorsShowAll = { exits: false, entries: false };
  #eventFilter = "";
  #eventScope: EventScopeFilter = "inherited";
  #groupOpen = new Map<string, boolean>();
  #machineFilter = "";
  /** leaf rows of the focus list opened in place */
  #openRows = new Set<StateNode>();
  /** the viewed machine's transitions taken in its last step, and the leaves it left then */
  #fired = new Set<TransitionNode>();
  #visited = new Set<StateNode>();
  #strings: ExplorerStrings = defaultStrings;
  /** layout breakpoint, measured on the host (container queries decide the CSS) */
  #narrow = false;
  /** the tree's keyboard cursor (roving tabindex) */
  #treeCursor?: StateNode;
  #typeahead = { text: "", at: 0 };
  #seeded = new Set<string>();

  // live region
  #announce: AnnounceMode = "all";
  #announceInterval = 3000;
  #announcer?: Announcer;
  #announcedSteps = 0;

  // geometry caches
  #hostObserver?: ResizeObserver;
  #diagramObserver?: ResizeObserver;
  #systemObserver?: ResizeObserver;
  #links?: { key: string; svg: SVGSVGElement };

  // live wiring
  #unwire: (() => void)[] = [];
  #raf = 0;

  // persistent shell elements
  #el!: {
    levels: HTMLElement;
    crumbs: HTMLElement;
    follow: HTMLButtonElement;
    treePane: HTMLElement;
    treeCount: HTMLElement;
    treeScroll: HTMLElement;
    treeViewport: HTMLElement;
    center: HTMLElement;
    centerScroll: HTMLElement;
    inspector: HTMLElement;
    inspectorSwitch: HTMLElement;
    inspectorBody: HTMLElement;
    eventsHead: HTMLElement;
    eventData: HTMLInputElement;
    tabs: HTMLElement;
    strip: HTMLElement;
    live: HTMLElement;
    treeTitle: HTMLElement;
    treeSearch: HTMLInputElement;
    activeOnlyText: HTMLElement;
    eventSearch: HTMLInputElement;
    scopes: HTMLElement;
    dataLabel: HTMLElement;
    playback: HTMLElement;
    playToggle: HTMLButtonElement;
    stepButton: HTMLButtonElement;
    speeds: HTMLSelectElement;
    clockTime: HTMLElement;
    lastStep: HTMLElement;
    shell: HTMLElement;
  };

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open" });
    this.#shadow.adoptedStyleSheets = [themeSheet(), explorerSheet()];
    this.#buildShell();
  }

  /** Custom-element lifecycle (called by the browser): detaches, keeping the session to re-attach on reconnect. */
  disconnectedCallback() {
    this.#detach();
    this.#hostObserver?.disconnect();
    this.#hostObserver = undefined;
  }

  /** Custom-element lifecycle (called by the browser): starts measuring its width and re-attaches after a move. */
  connectedCallback() {
    // focusable for the playback shortcuts. Set here, not in the constructor: a constructor that
    // adds attributes makes document.createElement("scxml-explorer") fail (HTML spec), which is
    // how React, Vue and most frameworks create elements.
    if (!this.hasAttribute("tabindex")) this.tabIndex = 0;
    // one breakpoint, measured on the host; the CSS uses the same width in its container queries
    if (typeof ResizeObserver !== "undefined" && !this.#hostObserver) {
      this.#hostObserver = new ResizeObserver(() => this.#measure());
      this.#hostObserver.observe(this);
    }
    this.#measure();
    // re-attach after being moved in the DOM (disconnectedCallback detached it)
    if (this.#session && !this.#tracker) this.#attach();
  }

  /** Custom-element lifecycle (called by the browser) for `follow` and `announce`. */
  attributeChangedCallback(name: string, _old: string | null, value: string | null) {
    if (name === "follow") this.#setFollow(value !== "false", false);
    if (name === "announce") this.#announce = value === "off" || value === "sends" ? value : "all";
  }

  #width = 0;
  /** Width changes re-render (coalesced per frame): the breakpoint and "auto" layouts depend on it. */
  #measure() {
    const width = Math.round(this.getBoundingClientRect().width || this.clientWidth);
    if (width === this.#width) return;
    this.#width = width;
    this.#narrow = width > 0 && width <= NARROW_WIDTH;
    this.#schedule();
  }

  /**
   * Every user-visible string. Set a partial object to translate or relabel;
   * unset keys keep their English default. See `ExplorerStrings` for the keys.
   */
  get strings(): ExplorerStrings {
    return this.#strings;
  }
  /** Translate: a partial object; unset keys keep their English default. */
  set strings(strings: Partial<ExplorerStrings>) {
    this.#strings = { ...defaultStrings, ...strings };
    this.#applyShellStrings();
    this.#schedule();
  }

  /** What the polite live region announces: `"all"` (steps and sent events, default), `"sends"` or `"off"`. */
  get announce(): AnnounceMode {
    return this.#announce;
  }
  /** Sets the `announce` attribute. */
  set announce(mode: AnnounceMode) {
    this.setAttribute("announce", mode);
  }

  /** While a clock is playing, announce steps at most this often (ms of real time). Default 3000. */
  get announceInterval(): number {
    return this.#announceInterval;
  }
  /** Minimum real-time gap between step announcements while playing, in ms. */
  set announceInterval(ms: number) {
    this.#announceInterval = Math.max(0, ms);
  }

  /** The root session shown. Setting it attaches (with the current `processors` and `clock`). */
  get session(): Session | undefined {
    return this.#session;
  }
  /** Attach this session (or detach with `undefined`). */
  set session(session: Session | undefined) {
    this.#session = session;
    if (session) this.#attach();
    else this.detach();
  }

  /** I/O processors to show at the System level. */
  get processors(): IOProcessor[] {
    return this.#processors;
  }
  /** The I/O processors to show; re-attaches if a session is set. */
  set processors(processors: IOProcessor[]) {
    this.#processors = processors;
    if (this.#session) this.#attach();
  }

  /** The session's clock; a `PlaybackClock` gets playback controls. */
  get clock(): Clock | undefined {
    return this.#clockOption;
  }
  /** The clock to control; re-attaches if a session is set. */
  set clock(clock: Clock | undefined) {
    this.#clockOption = clock;
    if (this.#session) this.#attach();
  }

  /** Keep the focus on the part of the machine that is moving. Reflected as `follow="true|false"`. */
  get follow(): boolean {
    return this.#follow;
  }
  /** Turn following on or off (also reflected as the `follow` attribute). */
  set follow(on: boolean) {
    this.#setFollow(on);
  }

  /** Show a (root) session. Call before or after it starts. */
  attach({ session, processors = [], clock }: ExplorerAttachOptions) {
    this.#session = session;
    this.#processors = processors;
    this.#clockOption = clock;
    this.#attach();
  }

  /** Stop showing the session and release all listeners (the session itself is left alone). */
  detach() {
    this.#detach();
    this.#session = undefined;
    this.#el.centerScroll.replaceChildren();
    this.#el.treeViewport.replaceChildren();
    this.#el.inspectorBody.replaceChildren();
  }

  #attach() {
    const session = this.#session!;
    const processors = this.#processors;
    const clock = this.#clockOption ?? session.clock;
    this.#detach();
    this.#clock = clock instanceof PlaybackClock ? clock : undefined;
    this.#el.playback.hidden = !this.#clock;
    if (this.#clock) {
      const unsubscribe = this.#clock.subscribe(() => this.#renderPlayback());
      this.#unwire.push(unsubscribe);
    }
    this.#tracker = new SystemTracker(session, processors, { clock });
    this.#announcedSteps = this.#tracker.stepCount;
    const onChange = () => {
      this.#announceSteps();
      this.#schedule();
    };
    this.#tracker.addEventListener("change", onChange);
    this.#unwire.push(() => this.#tracker?.removeEventListener("change", onChange));
    this.#openMachine(session.sessionId);
  }

  #detach() {
    for (const f of this.#unwire.splice(0)) f();
    this.#tracker?.dispose();
    this.#tracker = undefined;
    this.#announcer?.dispose();
    this.#diagramObserver?.disconnect();
    this.#systemObserver?.disconnect();
    this.#links = undefined;
  }

  // ───────────────────────────── live region ─────────────────────────────

  /** New steps since the last announcement → one message (the latest step). */
  #announceSteps() {
    const t = this.#tracker;
    if (!t || t.stepCount === this.#announcedSteps) return;
    this.#announcedSteps = t.stepCount;
    // a machine starting (no triggering event) isn't news; what happens next is
    if (this.#announce === "all" && t.lastStep?.event !== undefined) this.#say(this.#strings.announceStep(t.lastStep));
  }

  /**
   * Write to the live region. Urgent messages (sent events, steps while paused or
   * stepping) go out at once; while a clock runs, steps are throttled to one per
   * `announceInterval`, the latest one winning.
   */
  #say(text: string, urgent = false) {
    if (this.#announce === "off") return;
    this.#announcer ??= new Announcer(this.#el.live, {
      interval: () => this.#announceInterval,
      paused: () => (this.#clock ? !this.#clock.playing : false),
    });
    this.#announcer.say(text, urgent);
  }

  #setFollow(on: boolean, reflect = true) {
    if (on === this.#follow) return;
    this.#follow = on;
    if (reflect) this.setAttribute("follow", String(on));
    if (on) this.#applyFollow();
    this.#schedule();
  }

  #emit<T>(type: string, detail: T, cancelable = false): boolean {
    return this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true, cancelable }));
  }

  // ───────────────────────────── navigation ─────────────────────────────

  get #machine(): MachineInfo | undefined {
    return this.#tracker?.machines.get(this.#machineKey);
  }

  #sessionListeners: (() => void) | undefined;

  #openMachine(key: string, focus?: StateNode) {
    const m = this.#tracker?.machines.get(key);
    if (!m) return;
    this.#sessionListeners?.();
    this.#machineKey = key;
    const session = m.session;
    this.#focus = focus ?? session.model.root;
    this.#selected = undefined;
    this.#focusFilter = "";
    this.#focusShowAll = false;
    this.#openRows.clear();
    this.#fired = new Set();
    this.#visited = new Set();
    if (!this.#expanded.has(key))
      this.#expanded.set(
        key,
        activeExpansion(session.model, (s) => session.isActiveNode(s)),
      );
    // what the last step did: the transitions taken, and the leaves it left
    let taken: TransitionNode[] = [];
    let leaves = session.configuration.filter(isAtomic);
    const onMicro = (e: Event) => taken.push(...(e as unknown as { transitions: TransitionNode[] }).transitions);
    const onMacro = () => {
      const now = session.configuration.filter(isAtomic);
      if (taken.length) {
        this.#fired = new Set(taken);
        const left = leaves.filter((s) => !now.includes(s));
        if (left.length) this.#visited = new Set(left);
      }
      taken = [];
      leaves = now;
      // the first real configuration expands the active path once, whether or not we follow
      if (!this.#seeded.has(key) && session.configuration.length) {
        this.#seeded.add(key);
        const exp = this.#expanded.get(key);
        if (exp) for (const s of session.configuration) if (s.children.length) exp.add(s);
      }
      if (this.#follow) this.#applyFollow();
      this.#schedule();
    };
    session.addEventListener("microstep", onMicro);
    session.addEventListener("macrostep", onMacro);
    session.addEventListener("done", onMacro);
    this.#sessionListeners = () => {
      session.removeEventListener("microstep", onMicro);
      session.removeEventListener("macrostep", onMacro);
      session.removeEventListener("done", onMacro);
    };
    this.#unwire.push(() => this.#sessionListeners?.());
    if (this.#follow) this.#applyFollow();
    this.#schedule();
  }

  #applyFollow() {
    const m = this.#machine;
    if (!m || !this.#focus) return;
    const session = m.session;
    const next = followTarget(session.configuration, this.#focus);
    // follow only moves within the machine and only to states on the active path
    if (next !== this.#focus && (next.kind === "scxml" || session.isActiveNode(next))) this.#focus = next;
    // keep the active path visible in the tree
    const exp = this.#expanded.get(this.#machineKey);
    if (exp) for (const s of session.configuration) if (s.children.length) exp.add(s);
  }

  /** User navigation: stops following, animates with a view transition when available. */
  #navigate(change: () => void, keepFollow = false) {
    if (!keepFollow) this.#setFollow(false);
    const run = () => {
      change();
      this.#renderNow();
    };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (doc.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) doc.startViewTransition(run);
    else run();
  }

  #focusOn(s: StateNode) {
    this.#navigate(() => {
      this.#level = "machine";
      this.#focus = isContainer(s) ? s : (s.parent ?? s);
      this.#selected = isContainer(s) ? undefined : s;
      this.#focusFilter = "";
      this.#focusShowAll = false;
      this.#doorsShowAll = { exits: false, entries: false };
      if (this.#focus !== this.#lastFocus) this.#openRows.clear();
      this.#tab = "focus";
      const exp = this.#expanded.get(this.#machineKey);
      if (exp) for (const a of pathTo(s)) if (a.children.length) exp.add(a);
    });
  }

  #setLevel(level: Level) {
    this.#level = level;
    this.#tab = level === "system" ? "system" : "focus";
  }

  #showInspector(which: Inspector) {
    this.#inspector = which;
    this.#tab = which;
    this.#schedule();
  }

  /** Change view state, then re-render. */
  #update(change: () => unknown) {
    change();
    this.#schedule();
  }

  #drillInto(e: Event, s: StateNode) {
    e.stopPropagation();
    this.#focusOn(s);
  }

  #select(s: StateNode) {
    this.#selected = s;
    const session = this.#machine?.session;
    if (session) this.#emit<ExplorerSelectDetail>("scxml-select", { session, state: s });
    this.#inspector = "detail";
    this.#tab = "detail";
    this.#schedule();
  }

  // ──────────────────────────────── shell ────────────────────────────────

  #buildShell() {
    const h = html;
    const levels = h("div", { class: "levels", part: "levels", role: "group" });
    const crumbs = h("nav", { class: "crumbs", part: "crumbs" });
    const follow = h("button", { class: "follow", part: "follow", type: "button" }) as HTMLButtonElement;
    follow.addEventListener("click", () => this.#setFollow(!this.#follow));

    // tree pane
    const treeCount = h("span", { class: "count" });
    const treeTitle = h("span", { class: "pane-title" });
    const treeSearch = h("input", { type: "search", part: "tree-search" }) as HTMLInputElement;
    treeSearch.addEventListener("input", () => {
      this.#treeFilter = treeSearch.value;
      this.#treeScroll().scrollTop = 0;
      this.#schedule();
    });
    const activeOnly = h("input", { type: "checkbox" }) as HTMLInputElement;
    activeOnly.addEventListener("change", () => {
      this.#activeOnly = activeOnly.checked;
      this.#schedule();
    });
    const activeOnlyText = h("span", {});
    const treeViewport = h("div", { class: "tree-viewport", part: "tree", role: "tree" });
    treeViewport.addEventListener("keydown", (e) => this.#treeKey(e));
    const treeScroll = h("div", { class: "pane-scroll" }, treeViewport);
    treeScroll.addEventListener("scroll", () => this.#renderTree(), { passive: true });
    const treePane = h(
      "section",
      { class: "pane tree-pane", part: "tree-pane", "data-tab": "tree" },
      h("div", { class: "pane-head" }, treeTitle, treeCount),
      h("div", { class: "search" }, treeSearch, h("label", { class: "toggle" }, activeOnly, activeOnlyText)),
      treeScroll,
    );

    // center pane
    const centerScroll = h("div", { class: "pane-scroll" });
    const center = h("section", { class: "pane center", part: "focus-pane", "data-tab": "focus" }, centerScroll);

    // inspector pane
    const inspectorSwitch = h("div", { class: "mode", role: "group" });
    const eventData = h("input", { placeholder: '{"json": "data"}' }) as HTMLInputElement;
    const eventSearch = h("input", { type: "search", part: "event-search" }) as HTMLInputElement;
    eventSearch.addEventListener("input", () => {
      this.#eventFilter = eventSearch.value;
      this.#schedule();
    });
    const scopes = h("div", { class: "scopes", part: "scopes", role: "group" });
    const dataLabel = h("span", {});
    const eventsHead = h(
      "div",
      {},
      h("div", { class: "search" }, eventSearch),
      scopes,
      // event data is rarely needed: behind a disclosure
      h("details", { class: "data-field", part: "event-data" }, h("summary", {}, dataLabel), eventData),
    );
    const inspectorBody = h("div", { class: "pane-scroll" });
    const inspector = h(
      "section",
      { class: "pane inspector", part: "inspector", "data-tab": "events" },
      h("div", { class: "pane-head" }, inspectorSwitch),
      eventsHead,
      inspectorBody,
    );

    // playback: pause / step / speed for a PlaybackClock, in the header bar
    const playToggle = h("button", { class: "play", part: "play", type: "button" }) as HTMLButtonElement;
    playToggle.addEventListener("click", () => this.#clock?.toggle());
    const stepButton = h("button", { class: "step", part: "step", type: "button" }) as HTMLButtonElement;
    stepButton.addEventListener("click", () => this.#step());
    const speeds = h("select", { class: "speeds", part: "speeds" }) as HTMLSelectElement;
    speeds.addEventListener("change", () => {
      if (this.#clock) this.#clock.speed = Number(speeds.value);
    });
    const clockTime = h("span", { class: "clock-time", part: "clock" });
    const playback = h("div", { class: "playback", part: "playback", hidden: "" }, playToggle, stepButton, speeds, clockTime);
    // what the last step did: shown under the title of the center pane
    const lastStep = h("p", { class: "last-step", part: "last-step" });
    this.addEventListener("keydown", (e) => {
      const target = e.composedPath()[0] as HTMLElement;
      if (!this.#clock || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName)) return;
      // Space on focusable rows and cards is theirs; the shortcuts apply elsewhere in the explorer
      if (target.matches?.("[role=treeitem], [role=button], [role=link]")) return;
      if (e.key === " ") {
        e.preventDefault();
        this.#clock.toggle();
      } else if (e.key === ".") {
        e.preventDefault();
        this.#step();
      }
    });

    const tabs = h("nav", { class: "tabs", part: "tabs", role: "tablist" });
    const strip = h("div", { class: "events-strip", part: "strip", role: "group" });
    // polite live region: steps and sent events for screen readers (see `announce`)
    const live = h("div", { class: "sr-only", role: "status", "aria-live": "polite", "aria-atomic": "true" });
    const shell = h(
      "div",
      { class: "shell" },
      h("div", { class: "top", part: "top" }, levels, crumbs, h("slot", { name: "toolbar" }), playback, follow),
      h("div", { class: "body" }, treePane, center, inspector, strip, tabs),
      live,
    );
    this.#shadow.append(shell);
    this.#el = {
      levels,
      crumbs,
      follow,
      treePane,
      treeCount,
      treeScroll,
      treeViewport,
      center,
      centerScroll,
      inspector,
      inspectorSwitch,
      inspectorBody,
      eventsHead,
      eventData,
      tabs,
      strip,
      live,
      treeTitle,
      treeSearch,
      activeOnlyText,
      eventSearch,
      scopes,
      dataLabel,
      playback,
      playToggle,
      stepButton,
      speeds,
      clockTime,
      lastStep,
      shell,
    };
    this.#applyShellStrings();
  }

  /** The shell's static text, from `strings` (called again when they change). */
  #applyShellStrings() {
    const t = this.#strings;
    const e = this.#el;
    e.levels.setAttribute("aria-label", t.levelLabel);
    // landmarks need unique names: with several explorers on a page, each host's aria-label
    // (if the page gives one) names its breadcrumb
    const host = this.getAttribute("aria-label");
    e.crumbs.setAttribute("aria-label", host ? `${host}: ${t.breadcrumbLabel}` : t.breadcrumbLabel);
    e.follow.textContent = t.follow;
    e.follow.title = t.followHint;
    e.treeTitle.textContent = t.statesPane;
    e.treeSearch.placeholder = t.findState;
    e.treeSearch.setAttribute("aria-label", t.filterStates);
    e.activeOnlyText.textContent = t.activeOnly;
    e.treeViewport.setAttribute("aria-label", t.treeLabel);
    e.eventSearch.placeholder = t.findEvent;
    e.eventSearch.setAttribute("aria-label", t.filterEvents);
    e.scopes.setAttribute("aria-label", t.scopeLabel);
    e.dataLabel.textContent = t.eventData;
    e.eventData.setAttribute("aria-label", t.eventDataLabel);
    e.playToggle.title = t.playHint;
    e.stepButton.textContent = t.step;
    e.stepButton.title = t.stepHint;
    e.speeds.setAttribute("aria-label", t.speedLabel);
    e.speeds.title = t.speedLabel;
    e.lastStep.setAttribute("aria-label", t.lastStep);
    e.strip.setAttribute("aria-label", t.acceptedEventsLabel);
  }

  #treeScroll() {
    return this.#el.treeScroll;
  }

  /** Tree rows are windowed, so their height must be known: `--scxml-row-height` (px), default 30. */
  #rowHeight(): number {
    const v = Number.parseFloat(getComputedStyle(this).getPropertyValue("--scxml-row-height"));
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_ROW;
  }

  /** One step: run the clock until any machine in the system completes a macrostep. */
  #step() {
    const clock = this.#clock;
    const tracker = this.#tracker;
    if (!clock || !tracker) return;
    const before = tracker.stepCount;
    clock.step(() => tracker.stepCount > before);
    this.#renderNow();
  }

  #renderPlayback() {
    const clock = this.#clock;
    if (!clock) return;
    const t = this.#strings;
    const { playToggle, stepButton, speeds, clockTime } = this.#el;
    playToggle.textContent = clock.playing ? t.pause : t.play;
    playToggle.setAttribute("aria-pressed", String(!clock.playing));
    stepButton.disabled = clock.pending === 0;
    const speed = String(clock.speed);
    if (!speeds.options.length) for (const [v, text] of SPEEDS) speeds.append(html("option", { value: String(v) }, text));
    if (![...speeds.options].some((o) => o.value === speed)) speeds.append(html("option", { value: speed }, `${speed}×`));
    speeds.value = speed;
    clockTime.textContent = t.clockTime(formatTime(clock.now()));
    // what's pending is a detail: in the tooltip
    const next = clock.nextTimerAt;
    const queue = [t.virtualTime];
    if (clock.ready) queue.push(t.queued(clock.ready));
    if (next !== undefined) queue.push(t.nextTimer(formatTime(Math.max(0, next - clock.now()))));
    if (queue.length === 1) queue.push(t.idle);
    clockTime.title = queue.join(" · ");
  }

  /** The last step of any machine: "machine: event · source → target". */
  #renderLastStep() {
    const t = this.#strings;
    const el = this.#el.lastStep;
    const ls = this.#tracker?.lastStep;
    el.hidden = !ls;
    el.textContent = ls
      ? `${ls.machine}: ${ls.event ?? t.start}${ls.moves.length ? ` · ${ls.moves.slice(0, 2).join(" · ")}${ls.moves.length > 2 ? ` +${ls.moves.length - 2}` : ""}` : ` · ${t.noTransition}`}`
      : "";
    el.title = ls ? [ls.event ?? t.start, ...ls.moves].join("\n") : "";
  }

  // ─────────────────────────────── render ───────────────────────────────

  #schedule() {
    if (this.#raf) return;
    this.#raf = requestAnimationFrame(() => {
      this.#raf = 0;
      this.#renderNow();
    });
  }

  #renderNow() {
    if (this.#raf) {
      cancelAnimationFrame(this.#raf);
      this.#raf = 0;
    }
    const m = this.#machine;
    if (!m || !this.#focus) return;
    if (this.#focus !== this.#lastFocus) {
      this.#lastFocus = this.#focus;
      this.#emit<ExplorerFocusDetail>("scxml-focus", { session: m.session, state: this.#focus });
    }
    this.#renderPlayback();
    this.#renderLastStep();
    this.#el.shell.dataset.level = this.#level;
    this.#renderTop(m);
    this.#renderTree();
    if (this.#level === "system") this.#renderSystem();
    else this.#renderFocus(m);
    this.#renderInspector(m);
    this.#renderTabs();
  }

  #renderTop(m: MachineInfo) {
    const h = html;
    const t = this.#strings;
    const { levels, crumbs, follow } = this.#el;
    levels.replaceChildren(
      ...(["system", "machine"] as const).map((lv) =>
        button(lv === "system" ? t.levelSystem : t.levelMachine, () => this.#navigate(() => this.#setLevel(lv), true), {
          "aria-pressed": String(this.#level === lv),
        }),
      ),
    );
    follow.setAttribute("aria-pressed", String(this.#follow));

    type Crumb = { text: string; go: () => void; current?: boolean };
    const list: Crumb[] = [
      {
        text: t.levelSystem,
        go: () => this.#navigate(() => this.#setLevel("system"), true),
        current: this.#level === "system",
      },
    ];
    if (this.#level === "machine") {
      // machines above this one (invoke chain)
      const chain: MachineInfo[] = [];
      for (let x: MachineInfo | undefined = m; x; x = x.parentKey ? this.#tracker!.machines.get(x.parentKey) : undefined) chain.unshift(x);
      for (const x of chain)
        list.push({
          text: x.name,
          go: () => this.#navigate(() => this.#openMachine(x.key)),
          current: x === m && this.#focus === m.session.model.root && !this.#selected,
        });
      for (const s of pathTo(this.#focus!).slice(1))
        list.push({ text: label(s), go: () => this.#focusOn(s), current: s === this.#focus && !this.#selected });
      if (this.#selected && this.#selected !== this.#focus)
        list.push({ text: label(this.#selected), go: () => this.#select(this.#selected!), current: true });
    }
    let shown: (Crumb | "…")[] = list;
    const narrow = this.#narrow;
    if (!this.#crumbsExpanded && list.length > (narrow ? 2 : 5))
      shown = narrow ? ["…", ...list.slice(-2)] : [list[0]!, list[1]!, "…", ...list.slice(-2)];
    crumbs.replaceChildren(
      ...shown.flatMap((c, i) => {
        const sep = i ? [h("span", { class: "sep", "aria-hidden": "true" }, "›")] : [];
        if (c === "…")
          return [
            ...sep,
            button("…", () => this.#update(() => (this.#crumbsExpanded = true)), { title: t.showWholePath, "aria-label": t.showWholePath }),
          ];
        const b = button(c.text, c.go, { title: c.text, part: parts("crumb", c.current && "current") });
        if (c.current) b.setAttribute("aria-current", "page");
        return [...sep, b];
      }),
    );
    crumbs.scrollLeft = crumbs.scrollWidth; // narrow screens: keep the current place visible
  }

  // ── tree ──

  #treeRows: TreeRow[] = [];

  /** Render the windowed tree. `keepCursor`: a keyboard move just placed the cursor — don't re-sync it. */
  #renderTree(keepCursor = false) {
    const m = this.#machine;
    if (!m) return;
    const t = this.#strings;
    const session = m.session;
    const exp = this.#expanded.get(this.#machineKey) ?? new Set();
    this.#treeRows = treeRows(session.model, {
      expanded: exp,
      isActive: (s) => session.isActiveNode(s),
      filter: this.#treeFilter,
      activeOnly: this.#activeOnly,
    });
    const rows = this.#treeRows;
    const total = session.model.states.filter((s) => s.kind !== "scxml" && s.kind !== "history").length;
    // a count only while it says something: how many states match the filter
    this.#el.treeCount.textContent = this.#treeFilter ? t.matchesOf(rows.filter((r) => r.match).length, total) : "";
    // the roving tabindex: while the tree has keyboard focus the cursor stays where the user put it;
    // otherwise it tracks the selected / focused state, so tabbing in lands on "where we are"
    const hadFocus = (this.#shadow.activeElement as HTMLElement | null)?.getAttribute("role") === "treeitem";
    if (!hadFocus && !keepCursor) this.#treeCursor = undefined;
    const cursorIndex = this.#treeCursorIndex();
    const ROW = this.#rowHeight();
    const vp = this.#el.treeViewport;
    vp.style.height = `${rows.length * ROW}px`;
    // windowing: only rows in view (plus overscan) exist in the DOM — and always the cursor row,
    // so keyboard focus survives scrolling
    const scroll = this.#el.treeScroll;
    const first = Math.max(0, Math.floor(scroll.scrollTop / ROW) - 8);
    const last = Math.min(rows.length, Math.ceil((scroll.scrollTop + (scroll.clientHeight || 600)) / ROW) + 8);
    const indices: number[] = [];
    for (let i = first; i < last; i++) indices.push(i);
    if (cursorIndex >= 0 && (cursorIndex < first || cursorIndex >= last)) indices.push(cursorIndex);
    const h = html;
    const nodes: HTMLElement[] = [];
    for (const i of indices) {
      const r = rows[i]!;
      const twisty = h("button", { class: "twisty", type: "button", tabindex: "-1", "aria-hidden": "true" }, r.expanded ? "▾" : "▸");
      if (!r.expandable) twisty.setAttribute("hidden", "");
      twisty.addEventListener("click", (e) => {
        e.stopPropagation();
        this.#treeCursor = r.node;
        this.#toggleExpanded(r.node);
      });
      const leafActive = r.active && isAtomic(r.node);
      const siblings = r.node.parent?.children ?? [];
      const row = h(
        "div",
        {
          class: `tree-row${r.onActivePath ? " path" : ""}${leafActive ? " active" : ""}${r.match ? " match" : ""}`,
          part: parts("tree-row", r.onActivePath && "path", leafActive && "active", r.match && "match"),
          role: "treeitem",
          "data-index": String(i),
          tabindex: i === cursorIndex ? "0" : "-1",
          "aria-level": String(r.depth + 1),
          "aria-setsize": String(siblings.length || 1),
          "aria-posinset": String(siblings.indexOf(r.node) + 1 || 1),
          "aria-selected": String(r.node === this.#selected || (r.node === this.#focus && !this.#selected)),
          ...(r.expandable ? { "aria-expanded": String(r.expanded) } : {}),
          style: `top:${i * ROW}px; padding-left:${6 + r.depth * 14}px`,
          title: r.node.id,
        },
        twisty,
        h("span", { class: "name" }, label(r.node)),
        kindMark(r.node),
        // status in words, not only colour and weight
        leafActive ? srText(`, ${t.active}`) : r.onActivePath ? srText(`, ${t.containsActive}`) : "",
      );
      row.addEventListener("click", () => {
        this.#treeCursor = r.node;
        this.#focusOn(r.node);
      });
      nodes.push(row);
    }
    vp.replaceChildren(...nodes);
    if (!rows.length)
      vp.append(
        h("div", { class: "empty", part: "empty" }, h("slot", { name: "empty-tree" }, this.#treeFilter ? t.noStateMatches : t.noStates)),
      );
    if (hadFocus && cursorIndex >= 0) vp.querySelector<HTMLElement>(`[data-index="${cursorIndex}"]`)?.focus({ preventScroll: true });
  }

  /** Index of the tree's keyboard cursor among the visible rows (setting a default when needed). */
  #treeCursorIndex(): number {
    const rows = this.#treeRows;
    if (!rows.length) return -1;
    let i = this.#treeCursor ? rows.findIndex((r) => r.node === this.#treeCursor) : -1;
    if (i < 0) i = rows.findIndex((r) => r.node === (this.#selected ?? this.#focus));
    if (i < 0) i = 0;
    this.#treeCursor = rows[i]!.node;
    return i;
  }

  #toggleExpanded(node: StateNode, open?: boolean) {
    const exp = this.#expanded.get(this.#machineKey);
    if (!exp) return;
    const next = open ?? !exp.has(node);
    if (next) exp.add(node);
    else exp.delete(node);
    this.#renderTree(true);
  }

  /** Move the cursor to a row, scroll it into the window, render and focus it. */
  #moveTreeCursor(index: number) {
    const rows = this.#treeRows;
    if (!rows.length) return;
    const i = Math.max(0, Math.min(rows.length - 1, index));
    this.#treeCursor = rows[i]!.node;
    const ROW = this.#rowHeight();
    const scroll = this.#el.treeScroll;
    const view = scroll.clientHeight || 0;
    if (i * ROW < scroll.scrollTop) scroll.scrollTop = i * ROW;
    else if (view && (i + 1) * ROW > scroll.scrollTop + view) scroll.scrollTop = (i + 1) * ROW - view;
    this.#renderTree(true);
    this.#el.treeViewport.querySelector<HTMLElement>(`[data-index="${i}"]`)?.focus({ preventScroll: true });
  }

  /** The ARIA tree pattern: ↑ ↓ ← → Home End, Enter / Space, and type-ahead. */
  #treeKey(e: KeyboardEvent) {
    const rows = this.#treeRows;
    const i = this.#treeCursorIndex();
    if (i < 0) return;
    const r = rows[i]!;
    let handled = true;
    switch (e.key) {
      case "ArrowDown":
        this.#moveTreeCursor(i + 1);
        break;
      case "ArrowUp":
        this.#moveTreeCursor(i - 1);
        break;
      case "Home":
        this.#moveTreeCursor(0);
        break;
      case "End":
        this.#moveTreeCursor(rows.length - 1);
        break;
      case "ArrowRight":
        if (r.expandable && !r.expanded) {
          this.#toggleExpanded(r.node, true);
          this.#moveTreeCursor(i);
        } else if (r.expandable) this.#moveTreeCursor(i + 1);
        break;
      case "ArrowLeft": {
        if (r.expandable && r.expanded) {
          this.#toggleExpanded(r.node, false);
          this.#moveTreeCursor(i);
        } else {
          const parent = rows.findIndex((x) => x.node === r.node.parent);
          if (parent >= 0) this.#moveTreeCursor(parent);
        }
        break;
      }
      case "Enter":
      case " ":
        this.#focusOn(r.node);
        this.#moveTreeCursor(this.#treeRows.findIndex((x) => x.node === r.node));
        break;
      default:
        handled = this.#typeAhead(e, i);
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  /** Type-ahead: printable keys jump to the next row whose name starts with what was typed. */
  #typeAhead(e: KeyboardEvent, from: number): boolean {
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey || !/\S/.test(e.key)) return false;
    const now = Date.now();
    this.#typeahead = { text: now - this.#typeahead.at > 700 ? e.key : this.#typeahead.text + e.key, at: now };
    const q = this.#typeahead.text.toLowerCase();
    const rows = this.#treeRows;
    const start = q.length > 1 ? from : from + 1; // a new letter moves on; a longer prefix may stay
    for (let k = 0; k < rows.length; k++) {
      const j = (start + k) % rows.length;
      if (label(rows[j]!.node).toLowerCase().startsWith(q)) {
        this.#moveTreeCursor(j);
        return true;
      }
    }
    return true;
  }

  // ── focus ──

  #renderFocus(m: MachineInfo) {
    const h = html;
    const t = this.#strings;
    const session = m.session;
    const focus = this.#focus!;
    const isActive = (s: StateNode) => session.isActiveNode(s);
    const scope = focusScope(session.model, focus, isActive);
    const out = this.#el.centerScroll;
    const width = out.clientWidth || this.clientWidth;
    const crowded = scope.children.length > DIAGRAM_MAX_CHILDREN || scope.edges.length > 3 * DIAGRAM_MAX_CHILDREN;
    // auto: a diagram only when it fits — few children and not wider than the pane
    const ranks = estimateRanks(scope.children, scope.edges);
    const tooWide = ranks * (230 + 128) > width + 60;
    const mode =
      focus.kind === "parallel"
        ? "lanes"
        : this.#focusMode === "auto"
          ? crowded || tooWide || width < 560
            ? "list"
            : "diagram"
          : this.#focusMode;

    const layoutName = { auto: t.layoutAuto, diagram: t.layoutDiagram, list: t.layoutList } as const;
    const modeSwitch =
      focus.kind === "parallel"
        ? ""
        : h(
            "div",
            { class: "mode", role: "group", "aria-label": t.layoutLabel },
            ...(["auto", "diagram", "list"] as const).map((md) =>
              button(layoutName[md], () => this.#update(() => (this.#focusMode = md)), {
                "aria-pressed": String(this.#focusMode === md),
              }),
            ),
          );
    // the status in words only when it isn't the normal case (an active focus)
    const status =
      session.status === "done"
        ? h("span", { class: "status" }, t.terminated)
        : isActive(focus) || focus.kind === "scxml"
          ? srText(t.active)
          : h("span", { class: "status" }, t.inactive);
    const header = [
      h("h2", { class: "title", part: "title" }, label(focus)),
      h(
        "p",
        { class: "subtitle" },
        h("span", {}, t.focusSummary(t.kind(kindOf(focus)), scope.children.length, descendantCount(focus))),
        status,
        focus.parent ? button(t.up(label(focus.parent)), () => this.#focusOn(focus.parent!), { class: "drill" }) : "",
        h("span", { class: "spacer" }),
        modeSwitch,
      ),
      this.#el.lastStep,
    ];

    let body: Node;
    if (mode === "lanes") body = this.#lanes(scope.children, isActive);
    else if (mode === "diagram") body = this.#diagram(scope.children, scope.edges);
    else body = this.#list(scope.children, scope.edges, session);

    const doors = (kind: "exits" | "entries") => {
      const all = kind === "exits" ? scope.exits : scope.entries;
      if (!all.length) return [];
      const showAll = this.#doorsShowAll[kind];
      const shown = showAll ? all : all.slice(0, DOORS_SHOWN);
      return [
        h("div", { class: "section-title" }, kind === "exits" ? t.leavesTo : t.enteredFrom),
        h(
          "div",
          { class: "doors", part: "doors" },
          ...shown.map((d) => {
            const live = kind === "exits" && (d.child === focus ? isActive(focus) : isActive(d.child));
            const where = kind === "exits" ? label(d.other) : `${label(d.other)} → ${label(d.child)}`;
            const context = `${t.inState(d.other.parent ? label(d.other.parent) : t.machine)}${kind === "exits" && d.child !== focus ? ` · ${t.fromState(label(d.child))}` : ""}`;
            const events = d.events.slice(0, 3).join(", ") + (d.events.length > 3 ? ` +${d.events.length - 3}` : "");
            const el = h(
              "div",
              {
                class: `door${live ? " live" : ""}`,
                part: parts("door", kind === "exits" ? "exit" : "entry", live && "live"),
                role: "link",
                tabindex: "0",
                title: `${t.transitions(d.transitions.length)}: ${d.events.join(", ")}`,
                "aria-label": `${kind === "exits" ? t.leavesTo : t.enteredFrom}: ${where}, ${context}; ${d.events.join(", ")}`,
              },
              h("span", { class: "where" }, where),
              h("span", { class: "context" }, context),
              h("span", { class: "events" }, events),
            );
            activate(el, () => this.#focusOn(d.other));
            return el;
          }),
          all.length > DOORS_SHOWN
            ? button(
                showAll ? t.showFewer : t.more(all.length - DOORS_SHOWN),
                () => this.#update(() => (this.#doorsShowAll[kind] = !showAll)),
                { class: "more" },
              )
            : "",
        ),
      ];
    };

    // re-rendering replaces the rows: keep keyboard focus on the same control of the same state
    const had = this.#shadow.activeElement as HTMLElement | null;
    const hadRow = had && out.contains(had) ? had.closest<HTMLElement>("[data-state]") : null;
    const hadKey = had?.dataset.key ?? (had?.classList.contains("select") ? "select" : undefined);
    const scroll = out.scrollTop;
    out.replaceChildren(...header, body, ...doors("exits"), ...doors("entries"));
    out.scrollTop = scroll;
    if (hadRow && hadKey) {
      const row = out.querySelector(`[data-state="${CSS.escape(hadRow.dataset.state!)}"]`);
      (
        row?.querySelector<HTMLElement>(hadKey === "select" ? ".select" : `[data-key="${hadKey}"]`) ??
        row?.querySelector<HTMLElement>(".select")
      )?.focus({
        preventScroll: true,
      });
    }
    this.#diagramObserver?.disconnect();
    if (mode === "diagram") {
      const draw = () => this.#drawEdges(scope.edges, isActive);
      requestAnimationFrame(draw);
      // the pane resizes (window, container, split view): redraw the arrows, once per frame
      if (typeof ResizeObserver !== "undefined" && this.#diagramEl) {
        let pending = 0;
        this.#diagramObserver = new ResizeObserver(() => {
          if (pending) return;
          pending = requestAnimationFrame(() => {
            pending = 0;
            draw();
          });
        });
        this.#diagramObserver.observe(this.#diagramEl);
      }
    }
  }

  /** A diagram card: the name, and a drill-in for containers. The arrows carry the events. */
  #card(c: ChildSummary) {
    const h = html;
    const t = this.#strings;
    const s = c.node;
    const waiting =
      c.active &&
      isAtomic(s) &&
      (s.invokes.length > 0 ||
        s.onentry.some((b) =>
          [...b.getElementsByTagNameNS(s.element.namespaceURI, "send")].some(
            (x) => x.getAttribute("type") && x.getAttribute("type") !== "scxml",
          ),
        ));
    const visited = !c.onActivePath && this.#wasVisited(s);
    const cls = [
      "card",
      c.onActivePath ? "path" : "",
      c.active && isAtomic(s) ? "active" : "",
      waiting ? "waiting" : "",
      s.kind === "final" ? "final" : "",
      s === this.#selected ? "selected" : "",
      visited ? "visited" : "",
    ];
    const status = waiting ? t.waiting : c.onActivePath ? t.active : visited ? t.lastVisited : "";
    // a group, not a button: it holds its own controls (drill), and interactive elements must
    // not nest. The state's name is the card's primary button.
    const name = [label(s), t.kind(kindOf(s)), status, c.initial && t.initial].filter(Boolean).join(", ");
    const select = h(
      "button",
      { type: "button", class: "name select", "aria-label": name, "aria-pressed": String(s === this.#selected) },
      label(s),
    );
    const meta = [
      waiting ? h("span", { class: "status" }, t.waiting) : "",
      c.descendants ? button(t.inside(c.descendants), (e) => this.#drillInto(e, s), { class: "drill" }) : "",
      c.invokes ? h("span", {}, t.invokes(c.invokes)) : "",
    ].filter(Boolean);
    const card = h(
      "div",
      {
        class: cls.filter(Boolean).join(" "),
        part: parts("card", ...cls.slice(1)),
        "data-state": s.id,
        role: "group",
        "aria-label": name,
      },
      c.initial ? h("span", { class: "initial-mark", title: t.initial }) : "",
      h("div", { class: "card-head" }, select, kindMark(s)),
      meta.length ? h("div", { class: "meta" }, ...meta) : "",
      h("slot", { name: `state:${s.id}` }),
    );
    this.#operable(card, s, select);
    return card;
  }

  /** Was this state (or one inside it) left in the viewed machine's last step? */
  #wasVisited(s: StateNode): boolean {
    for (const v of this.#visited) if (pathTo(v).includes(s)) return true;
    return false;
  }

  /**
   * Click / keyboard behaviour of diagram cards: click and Space select,
   * Enter drills into a container (or selects a leaf), double-click drills in.
   */
  #operable(el: HTMLElement, s: StateNode, keys: HTMLElement = el) {
    el.addEventListener("click", () => this.#select(s));
    el.addEventListener("dblclick", () => isContainer(s) && this.#focusOn(s));
    onKeys(keys, (e) => (e.key === "Enter" && isContainer(s) ? this.#focusOn(s) : this.#select(s)));
  }

  #diagram(children: ChildSummary[], edges: FocusEdge[]) {
    const h = html;
    // layered layout: rank = shortest distance from the initial child(ren); unreachable ones last
    const rank = new Map<StateNode, number>();
    const queue = children.filter((c) => c.initial).map((c) => c.node);
    if (!queue.length && children[0]) queue.push(children[0].node);
    for (const q of queue) rank.set(q, 0);
    for (let i = 0; i < queue.length; i++) {
      const n = queue[i]!;
      for (const e of edges) {
        if (e.from !== n || rank.has(e.to)) continue;
        rank.set(e.to, rank.get(n)! + 1);
        queue.push(e.to);
      }
    }
    const maxRank = Math.max(0, ...rank.values());
    for (const c of children) if (!rank.has(c.node)) rank.set(c.node, maxRank + 1);
    const columns: ChildSummary[][] = [];
    for (const c of children) {
      const r = rank.get(c.node)!;
      const column = columns[r] ?? [];
      column.push(c);
      columns[r] = column;
    }
    const diagram = h(
      "div",
      { class: "diagram", part: "diagram" },
      ...columns.filter(Boolean).map((col) => h("div", { class: "rank" }, ...col.map((c) => this.#card(c)))),
    );
    this.#diagramEl = diagram;
    this.#rank = rank;
    return diagram;
  }

  #diagramEl?: HTMLElement;
  #rank = new Map<StateNode, number>();

  /**
   * Draw the arrows between the diagram's cards and place their labels:
   * deterministic order (live edges first, then document order), each label
   * at its arrow's middle or the nearest free spot above/below; labels with no
   * free spot collapse to their event count and open on hover / focus.
   */
  #drawEdges(edges: FocusEdge[], isActive: (s: StateNode) => boolean) {
    const d = this.#diagramEl;
    if (!d?.isConnected) return;
    for (const x of d.querySelectorAll(".edges, .edge-label")) x.remove();
    const base = d.getBoundingClientRect();
    const rect = (s: StateNode) => d.querySelector(`[data-state="${CSS.escape(s.id)}"]`)?.getBoundingClientRect();
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "edges");
    svg.setAttribute("part", "edges");
    svg.setAttribute("aria-hidden", "true");
    svg.append(arrowMarker("x-head", 10, 6, 10));
    const ordered = [...edges].sort(
      (a, b) => Number(isActive(b.from)) - Number(isActive(a.from)) || a.from.order - b.from.order || a.to.order - b.to.order,
    );
    const requests: (LabelRequest & { edge: FocusEdge; live: boolean; fired: boolean })[] = [];
    let backIndex = 0;
    for (const e of ordered) {
      const a = rect(e.from);
      const b = rect(e.to);
      if (!a || !b) continue;
      const forward = (this.#rank.get(e.to) ?? 0) > (this.#rank.get(e.from) ?? 0);
      let dPath: string;
      let mx: number;
      let my: number;
      if (forward) {
        const x1 = a.right - base.left;
        const y1 = a.top + a.height / 2 - base.top;
        const x2 = b.left - base.left;
        const y2 = b.top + b.height / 2 - base.top;
        const dx = Math.max(24, (x2 - x1) / 2);
        dPath = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2 - 1},${y2}`;
        mx = (x1 + x2) / 2;
        my = (y1 + y2) / 2;
      } else {
        // back / same-rank edges loop underneath, staggered
        const x1 = a.left + a.width / 2 - base.left;
        const y1 = a.bottom - base.top;
        const x2 = b.left + b.width / 2 - base.left;
        const y2 = b.bottom - base.top;
        const drop = 22 + (backIndex++ % 4) * 14;
        const low = Math.max(y1, y2) + drop;
        dPath = `M${x1},${y1} C${x1},${low} ${x2},${low} ${x2},${y2 + 1}`;
        mx = (x1 + x2) / 2;
        my = low - drop / 4;
      }
      const live = isActive(e.from);
      // the arrow the last step went along
      const fired = e.transitions.some((x) => this.#fired.has(x));
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", dPath);
      p.setAttribute("class", `${live ? "live" : ""}${fired ? " fired" : ""}${forward ? "" : " back"}`);
      p.setAttribute("marker-end", "url(#x-head)");
      svg.append(p);
      const text = e.events.length === 1 ? e.events[0]! : `${e.events[0]} +${e.events.length - 1}`;
      // label size: measured by the browser below; this estimate is only for layouts that can't measure
      requests.push({ cx: mx, cy: my, w: Math.min(120, 14 + text.length * 6.6), h: 18, edge: e, live, fired });
    }
    svg.setAttribute("width", String(d.scrollWidth));
    svg.setAttribute("height", String(d.scrollHeight + 80));
    d.prepend(svg);
    const labels = requests.map((r) => {
      const e = r.edge;
      const text = e.events.length === 1 ? e.events[0]! : `${e.events[0]} +${e.events.length - 1}`;
      const lab = html(
        "span",
        {
          class: `edge-label${r.live ? " live" : ""}${r.fired ? " fired" : ""}`,
          part: parts("edge-label", r.live && "live", r.fired && "fired"),
          title: `${e.events.join("\n")}${r.fired ? `\n(${this.#strings.justTaken})` : ""}`,
          tabindex: "-1",
        },
        html("span", { class: "full" }, text),
        html("span", { class: "short" }, String(e.events.length)),
      );
      d.append(lab);
      const measured = lab.getBoundingClientRect();
      if (measured.width) r.w = measured.width;
      if (measured.height) r.h = measured.height;
      return lab;
    });
    const cards = [...d.querySelectorAll<HTMLElement>("[data-state]")].map((c) => {
      const b = c.getBoundingClientRect();
      return { x: b.left - base.left, y: b.top - base.top, w: b.width, h: b.height };
    });
    const placement = placeLabels(requests, cards);
    placement.forEach((pl, i) => {
      const lab = labels[i]!;
      lab.style.left = `${pl.cx}px`;
      lab.style.top = `${pl.cy}px`;
      if (pl.collapsed) {
        lab.classList.add("collapsed");
        lab.setAttribute("part", `${lab.getAttribute("part")} collapsed`);
      }
    });
    d.style.paddingBottom = edges.some((e) => (this.#rank.get(e.to) ?? 0) <= (this.#rank.get(e.from) ?? 0)) ? "72px" : "10px";
  }

  #list(children: ChildSummary[], edges: FocusEdge[], session: Session) {
    const h = html;
    const t = this.#strings;
    const q = this.#focusFilter.trim().toLowerCase();
    const activeChildren = new Set(children.filter((c) => c.onActivePath).map((c) => c.node));
    const neighbours = new Set<StateNode>();
    for (const e of edges) {
      if (activeChildren.has(e.from)) neighbours.add(e.to);
      if (activeChildren.has(e.to)) neighbours.add(e.from);
    }
    const matches = children.filter((c) => !q || c.node.id.toLowerCase().includes(q));
    const groups: [string, ChildSummary[]][] = [
      [t.groupActivePath, matches.filter((c) => activeChildren.has(c.node))],
      [t.groupOneStep, matches.filter((c) => !activeChildren.has(c.node) && neighbours.has(c.node))],
      [t.groupElse, matches.filter((c) => !activeChildren.has(c.node) && !neighbours.has(c.node))],
    ];

    let budget = this.#focusShowAll ? Infinity : LIST_PAGE;
    const rows: Node[] = [];
    for (const [title, list] of groups) {
      if (!list.length) continue;
      // a count only where it helps: a long tail of other states
      const heading = title === t.groupElse && list.length > 12 ? t.groupCount(title, list.length) : title;
      rows.push(h("div", { class: "list-group", role: "presentation" }, heading));
      for (const c of list) {
        if (budget-- <= 0) break;
        rows.push(this.#listRow(c, session));
      }
    }
    const hidden = matches.length - Math.min(matches.length, this.#focusShowAll ? Infinity : LIST_PAGE);
    const search =
      children.length > 12
        ? (() => {
            const input = h("input", {
              type: "search",
              placeholder: t.findAmongStates(children.length),
              "aria-label": t.findAmongStates(children.length),
              value: this.#focusFilter,
            }) as HTMLInputElement;
            input.addEventListener("input", () => {
              this.#focusFilter = input.value;
              this.#focusShowAll = false;
              this.#renderNow();
              (this.#el.centerScroll.querySelector('.search input[type="search"]') as HTMLInputElement | null)?.focus();
            });
            return h("div", { class: "search", style: "padding:0 0 8px" }, input);
          })()
        : "";
    return h(
      "div",
      {},
      search,
      rows.length ? h("div", { class: "list", part: "list" }, ...rows) : h("div", { class: "empty", part: "empty" }, t.noStateMatches),
      hidden > 0
        ? button(t.showAll(matches.length), () => this.#update(() => (this.#focusShowAll = true)), {
            class: "more",
            style: "margin-top:8px",
          })
        : "",
    );
  }

  /**
   * One state of the focus list. A leaf answers what it is, what it does and how to leave it:
   * its entry actions, and its transitions as "event → target" (buttons that send the event
   * while it's active). Clicking a leaf opens it in place; clicking a container drills in.
   */
  #listRow(c: ChildSummary, session: Session): HTMLElement {
    const h = html;
    const t = this.#strings;
    const s = c.node;
    const leaf = !isContainer(s);
    const open = leaf && this.#openRows.has(s);
    const visited = !c.onActivePath && this.#wasVisited(s);
    const live = c.active && session.status === "running";
    const rowName = [label(s), t.kind(kindOf(s)), c.onActivePath && t.active, visited && t.lastVisited].filter(Boolean).join(", ");
    const select = h(
      "button",
      { type: "button", class: "name select", "aria-label": rowName, ...(leaf ? { "aria-expanded": String(open) } : {}) },
      label(s),
    );
    const does = [
      ...s.invokes.map((i) =>
        `invoke ${i.element.getAttribute("id") ?? i.element.getAttribute("src") ?? i.element.getAttribute("type") ?? ""}`.trim(),
      ),
      ...s.onentry.flatMap((b) => Array.from(b.children, describeAction)),
    ];
    const txs = s.transitions;
    const cls = ["list-row", c.onActivePath && "path", c.active && leaf && "active", visited && "visited", open && "open"];
    const row = h(
      "div",
      {
        class: cls.filter(Boolean).join(" "),
        part: parts("list-row", ...cls.slice(1)),
        "data-state": s.id,
        role: "group",
        "aria-label": rowName,
      },
      h(
        "div",
        { class: "row-head" },
        select,
        kindMark(s),
        visited ? h("span", { class: "visited-mark", part: "visited", "aria-hidden": "true" }, t.lastVisited) : "",
        c.descendants
          ? button(t.inside(c.descendants), (e) => this.#drillInto(e, s), { class: "drill", title: t.statesInside(c.descendants) })
          : "",
      ),
      does.length && !open
        ? h(
            "div",
            { class: "does", part: "row-actions", title: does.join("\n") },
            h("span", { class: "label" }, t.onEntry),
            ` ${does.slice(0, 2).join(" · ")}${does.length > 2 ? ` +${does.length - 2}` : ""}`,
          )
        : "",
      txs.length
        ? h(
            "div",
            { class: `exits${open ? " all" : ""}`, part: "row-exits", role: "list", "aria-label": t.transitionsTitle },
            ...(open ? txs : txs.slice(0, 3)).map((tr) => this.#txItem(tr, live, open)),
            !open && txs.length > 3 ? h("span", { class: "count", role: "listitem" }, t.more(txs.length - 3)) : "",
          )
        : "",
      open ? this.#rowDetail(s, session) : "",
    );
    const go = leaf ? () => this.#update(() => (open ? this.#openRows.delete(s) : this.#openRows.add(s))) : () => this.#focusOn(s);
    // clicks inside the opened part (text, its own buttons) don't close the row
    row.addEventListener("click", (e) => !(e.target as Element).closest?.(".row-detail") && go());
    onKeys(select, go);
    return row;
  }

  /** "event → target", with a mark for a condition; a button that sends the event when `live`. */
  #txItem(tr: TransitionNode, live: boolean, full: boolean): HTMLElement {
    const h = html;
    const t = this.#strings;
    const ev = tr.events.join(" ") || t.eventless;
    const to = tr.targets.map(label).join(", ") || t.stays;
    const fired = this.#fired.has(tr);
    const name = live && tr.events.length === 1 ? sendableName(tr.events[0]!) : undefined;
    const attrs = {
      class: `tx${fired ? " fired" : ""}${tr.events.length ? "" : " auto"}`,
      part: parts("row-event", fired && "fired"),
      "data-key": String(tr.order),
      title: `${ev}${tr.cond ? ` [${tr.cond}]` : ""} → ${to}${fired ? ` · ${t.justTaken}` : ""}`,
    };
    const content = [
      h("span", { class: "ev" }, ev),
      tr.cond ? h("span", { class: "guard", title: t.guard(tr.cond) }, full ? t.guard(tr.cond) : t.columnIf) : "",
      h("span", { class: "to" }, `→ ${to}`),
      fired ? srText(`, ${t.justTaken}`) : "",
    ];
    if (!name) return h("span", { ...attrs, role: "listitem" }, ...content);
    const b = h("button", { ...attrs, type: "button", "aria-label": `${t.sendEvent(name)} → ${to}` }, ...content);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      this.#send(name);
    });
    return h("span", { role: "listitem", class: "tx-item" }, b);
  }

  /** The opened part of a leaf row: every action, invoke and way in, and a link to the full detail. */
  #rowDetail(s: StateNode, session: Session): HTMLElement {
    const h = html;
    const t = this.#strings;
    const incoming = session.model.states.flatMap((x) => x.transitions.filter((tr) => tr.targets.includes(s)));
    const sources = [...new Set(incoming.map((tr) => label(tr.source)))];
    const items = this.#actionItems(s);
    return h(
      "div",
      { class: "row-detail", part: "row-detail" },
      items.length ? h("ul", { class: "actions" }, ...items) : "",
      sources.length
        ? h(
            "p",
            { class: "from" },
            h("span", { class: "label" }, t.enteredFrom),
            ` ${sources.slice(0, 6).join(", ")}${sources.length > 6 ? ` +${sources.length - 6}` : ""}`,
          )
        : "",
      button(
        t.openDetail,
        (e) => {
          e.stopPropagation();
          this.#select(s);
        },
        { class: "drill", part: "open-detail" },
      ),
    );
  }

  /** Entry and exit actions, then invokes, as list items. */
  #actionItems(s: StateNode): HTMLElement[] {
    const t = this.#strings;
    const actions = (blocks: Element[], tag: string) =>
      blocks.flatMap((b) => Array.from(b.children, (a) => html("li", {}, html("b", {}, tag), describeAction(a))));
    return [
      ...actions(s.onentry, t.entry),
      ...actions(s.onexit, t.exit),
      ...s.invokes.map((i) =>
        html(
          "li",
          {},
          html("b", {}, i.element.getAttribute("type") ?? "scxml"),
          i.element.getAttribute("id") ?? i.element.getAttribute("src") ?? t.inline,
        ),
      ),
    ];
  }

  #lanes(regions: ChildSummary[], isActive: (s: StateNode) => boolean) {
    const h = html;
    const t = this.#strings;
    const PER_LANE = 7;
    return h(
      "div",
      { class: "lanes", part: "lanes" },
      ...regions.map((r) => {
        const kids = [...r.node.children].sort((a, b) => Number(isActive(b)) - Number(isActive(a)) || a.order - b.order);
        const name = button(label(r.node), () => this.#focusOn(r.node), {
          class: "name",
          title: r.node.id,
          "aria-label": [label(r.node), r.onActivePath && t.active].filter(Boolean).join(", "),
        });
        return h(
          "section",
          { class: `lane${r.onActivePath ? " path" : ""}`, part: parts("lane", r.onActivePath && "path"), "data-state": r.node.id },
          h("div", { class: "lane-head" }, name, kindMark(r.node)),
          ...kids.slice(0, PER_LANE).map((k) => {
            const on = isActive(k);
            const visited = !on && this.#wasVisited(k);
            const row = h(
              "div",
              {
                class: `lane-row${on ? " active" : ""}${visited ? " visited" : ""}`,
                part: parts("lane-row", on && "active", visited && "visited"),
                role: "button",
                tabindex: "0",
                "aria-label": [label(k), t.kind(kindOf(k)), on && t.active, visited && t.lastVisited].filter(Boolean).join(", "),
              },
              h("span", { class: "name" }, label(k)),
              kindMark(k),
            );
            // containers open as the focus, leaves are selected
            activate(row, () => (isContainer(k) ? this.#focusOn(k) : this.#select(k)));
            return row;
          }),
          kids.length > PER_LANE ? button(t.openLane(kids.length - PER_LANE), () => this.#focusOn(r.node), { class: "more" }) : "",
        );
      }),
    );
  }

  // ── system ──

  #renderSystem() {
    const h = html;
    const tr = this.#strings;
    const t = this.#tracker!;
    const machines = t.machineList();
    const services = [...t.services.values()];
    const q = this.#machineFilter.trim().toLowerCase();
    const shownMachines = machines.filter(
      (m) => !q || m.name.toLowerCase().includes(q) || m.activeLeaves.some((l) => l.toLowerCase().includes(q)),
    );
    const compact = machines.length > 8; // many machines: one line each
    const talkOf = (m: MachineInfo) => [
      ...new Set(
        t
          .linksOf(m.key)
          .filter((l) => l.kind === "message")
          .map((l) => (l.from === m.key ? l.to : l.from))
          .map((k) => t.services.get(k)?.label ?? t.machines.get(k)?.name ?? k),
      ),
    ];
    const machineCard = (m: MachineInfo) => {
      const talk = talkOf(m);
      const hot = t.linksOf(m.key).some((l) => l.kind === "message" && t.isHot(l));
      const statusText = tr.status(m.status);
      const card = h(
        "div",
        {
          class: `card machine${compact ? " compact" : ""}${m.status === "running" ? " path" : ""}${hot ? " pulse" : ""}`,
          part: parts("machine", m.status === "running" && "running", m.status === "done" && "done", hot && "hot"),
          style: `--depth:${Math.min(m.depth, 4)}`,
          "data-node": m.key,
          role: "button",
          tabindex: "0",
          "aria-label": [m.name, statusText, m.activeLeaves.join(", ")].filter(Boolean).join(", "),
          title: [m.invokeid && tr.invokedAs(m.invokeid, m.invokedFrom), talk.length && tr.talksTo(talk.join(", "))]
            .filter(Boolean)
            .join("\n"),
        },
        // running is the normal case: only other statuses are spelled out
        h(
          "div",
          { class: "card-head" },
          h("span", { class: "name" }, m.name),
          m.status === "running" ? "" : h("span", { class: "status" }, statusText),
        ),
        m.activeLeaves.length
          ? h(
              "div",
              { class: "leaves", title: m.activeLeaves.join(", ") },
              m.activeLeaves.slice(0, compact ? 1 : 3).join(" · ") +
                (m.activeLeaves.length > (compact ? 1 : 3) ? ` +${m.activeLeaves.length - (compact ? 1 : 3)}` : ""),
            )
          : "",
        !compact && m.invokeid ? h("div", { class: "from" }, tr.invokedAs(m.invokeid, m.invokedFrom)) : "",
      );
      activate(card, () =>
        this.#navigate(() => {
          this.#setLevel("machine");
          this.#openMachine(m.key);
        }),
      );
      return card;
    };
    const serviceCard = (svc: (typeof services)[number]) => {
      const links = t.linksOf(svc.key);
      let out = 0;
      let inn = 0;
      for (const l of links) {
        if (l.from === svc.key) inn += total(l);
        else out += total(l);
      }
      const hot = links.some((l) => t.isHot(l));
      const selected = this.#selectedService === svc.key;
      const card = h(
        "div",
        {
          class: `card service${selected ? " selected" : ""}${hot ? " pulse" : ""}`,
          part: parts("service", selected && "selected", hot && "hot"),
          "data-node": svc.key,
          role: "button",
          tabindex: "0",
          "aria-pressed": String(selected),
          "aria-label": `${svc.label}, ${tr.traffic(out, inn)}`,
          title: `${svc.key}\n${tr.trafficHint}: ${out} / ${inn}`,
        },
        h(
          "div",
          { class: "card-head" },
          h("span", { class: "name" }, svc.label),
          out + inn ? h("span", { class: "status" }, tr.traffic(out, inn)) : "",
        ),
        h("slot", { name: `service:${svc.label}` }),
      );
      activate(card, () => {
        this.#selectedService = svc.key;
        this.#inspector = "detail";
        this.#schedule();
      });
      return card;
    };

    const filter =
      machines.length > 8
        ? (() => {
            const input = h("input", {
              type: "search",
              placeholder: tr.findAmongMachines(machines.length),
              "aria-label": tr.findAmongMachines(machines.length),
              value: this.#machineFilter,
            }) as HTMLInputElement;
            input.addEventListener("input", () => {
              this.#machineFilter = input.value;
              this.#renderNow();
              (this.#el.centerScroll.querySelector('.search input[type="search"]') as HTMLInputElement | null)?.focus();
            });
            return h("div", { class: "search", style: "padding:0" }, input);
          })()
        : "";
    const sys = h(
      "div",
      { class: "system", part: "system" },
      h("div", { class: "col" }, h("div", { class: "col-title" }, tr.machines), filter, ...shownMachines.map(machineCard)),
      h("div", { class: "col" }, h("div", { class: "col-title" }, tr.services), ...services.map(serviceCard)),
    );
    const out = this.#el.centerScroll;
    const scroll = out.scrollTop;
    out.replaceChildren(
      h("h2", { class: "title", part: "title" }, tr.system),
      h(
        "p",
        { class: "subtitle" },
        tr.systemSummary(
          machines.length,
          services.length,
          [...t.links.values()].reduce((n, l) => n + total(l), 0),
        ),
      ),
      this.#el.lastStep,
      sys,
    );
    out.scrollTop = scroll;

    // Links: geometry only changes when the cards' layout does. Reuse the drawn SVG while the
    // layout key is the same (only "hot" classes change); redraw on structural change or resize.
    const layoutKey = JSON.stringify([
      compact,
      q,
      shownMachines.map((m) => [m.key, m.activeLeaves.length > 0, !compact && !!m.invokeid]),
      services.map((svc) => svc.key),
      [...t.links.values()].map((l) => `${l.from}>${l.to}:${l.kind}`),
    ]);
    if (typeof ResizeObserver !== "undefined" && !this.#systemObserver) {
      this.#systemObserver = new ResizeObserver(() => {
        this.#links = undefined;
        if (this.#level === "system") this.#schedule();
      });
      this.#systemObserver.observe(this.#el.centerScroll);
    }
    const cached = this.#links;
    if (cached && cached.key === layoutKey) {
      for (const path of cached.svg.querySelectorAll<SVGPathElement>("path[data-link]")) {
        const link = t.links.get(path.dataset.link!);
        path.classList.toggle("hot", !!link && link.kind === "message" && t.isHot(link));
      }
      sys.prepend(cached.svg);
    } else requestAnimationFrame(() => this.#drawLinks(sys, layoutKey));
  }

  #drawLinks(sys: HTMLElement, key: string) {
    if (!sys.isConnected || !this.#tracker) return;
    const base = sys.getBoundingClientRect();
    if (base.width < 500) return;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "links");
    svg.setAttribute("aria-hidden", "true");
    const pos = (k: string) => sys.querySelector(`[data-node="${CSS.escape(k)}"]`)?.getBoundingClientRect();
    for (const [id, l] of this.#tracker.links) {
      const a = pos(l.from);
      const b = pos(l.to);
      if (!a || !b) continue;
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.dataset.link = id;
      if (l.kind === "invoke") {
        // parent → child, along the left edge
        const x1 = a.left - base.left + 8;
        const y1 = a.bottom - base.top;
        const x2 = b.left - base.left;
        const y2 = b.top + 14 - base.top;
        p.setAttribute("d", `M${x1},${y1} L${x1},${y2} L${x2},${y2}`);
        p.setAttribute("class", "invoke");
      } else {
        // machine ↔ machine messages: the invoke line (and the cards' tooltips) already say it
        if (!this.#tracker.services.has(l.to) && !this.#tracker.services.has(l.from)) continue;
        const [m, svc] = this.#tracker.services.has(l.to) ? [a, b] : [b, a];
        const x1 = m.right - base.left;
        const y1 = m.top + m.height / 2 - base.top;
        const x2 = svc.left - base.left;
        const y2 = svc.top + svc.height / 2 - base.top;
        const dx = (x2 - x1) / 2;
        p.setAttribute("d", `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`);
        if (this.#tracker.isHot(l)) p.setAttribute("class", "hot");
      }
      svg.append(p);
    }
    svg.setAttribute("width", String(sys.scrollWidth));
    svg.setAttribute("height", String(sys.scrollHeight));
    sys.querySelector(".links")?.remove();
    sys.prepend(svg);
    this.#links = { key, svg };
  }

  // ── inspector: accepted events / state detail ──

  #renderInspector(m: MachineInfo) {
    const h = html;
    const t = this.#strings;
    const session = m.session;
    const focus = this.#focus!;
    const all = session.status === "running" ? acceptedEvents(session, focus) : [];
    const counts = {
      here: all.filter((e) => e.scope === "here").length,
      inherited: all.filter((e) => e.scope !== "elsewhere").length,
      all: all.length,
    };
    // the System level has services to inspect, not a machine's accepted events
    const system = this.#level === "system";
    const which = system ? "detail" : this.#inspector;
    this.#el.inspectorSwitch.replaceChildren(
      ...(system
        ? [h("span", { class: "pane-title" }, t.serviceTab)]
        : [
            button(t.accepts(counts.inherited), () => this.#showInspector("events"), { "aria-pressed": String(which === "events") }),
            button(t.stateTab, () => this.#showInspector("detail"), { "aria-pressed": String(which === "detail") }),
          ]),
    );
    this.#el.eventsHead.style.display = which === "events" ? "" : "none";
    // a scope that adds nothing to the one before it is left out; with only one left, the switch is
    const scopes = (
      [
        ["here", counts.here, t.scopeHere],
        ["inherited", counts.inherited, t.scopeInherited],
        ["all", counts.all, t.scopeAll],
      ] as const
    ).filter(([, n], i, list) => i === 0 || n !== list[i - 1]![1]);
    this.#el.scopes.hidden = scopes.length < 2;
    const current = counts[this.#eventScope];
    this.#el.scopes.replaceChildren(
      ...scopes.map(([k, n, text]) =>
        button(text(n), () => this.#update(() => (this.#eventScope = k)), { "aria-pressed": String(n === current) }),
      ),
    );

    const body = this.#el.inspectorBody;
    const scroll = body.scrollTop;
    if (which === "events") body.replaceChildren(this.#eventsList(all));
    else if (system) body.replaceChildren(this.#serviceDetail());
    else body.replaceChildren(this.#stateDetail(this.#selected ?? focus, session));
    body.scrollTop = scroll;

    // narrow layout: the most relevant events as a strip
    const strip = all.filter((e) => e.scope !== "elsewhere");
    this.#el.strip.replaceChildren(
      ...strip.slice(0, 8).map((e) => {
        const name = sendableName(e.descriptor);
        const c = h(
          "button",
          {
            class: `chip${name ? "" : " muted"}`,
            type: "button",
            title: e.transitions.map((x) => `${label(x.source)} → ${x.targets.map(label).join(" ") || t.internal}`).join("\n"),
            ...(name ? { "aria-label": t.sendEvent(name) } : { disabled: "" }),
          },
          e.descriptor,
        );
        if (name) c.addEventListener("click", () => this.#send(name));
        return c;
      }),
      strip.length > 8 || all.length > strip.length
        ? button(t.allEvents(all.length), () => this.#showInspector("events"), { class: "more" })
        : "",
    );
  }

  #eventsList(all: AcceptedEvent[]) {
    const h = html;
    const t = this.#strings;
    const q = this.#eventFilter.trim().toLowerCase();
    const inScope = all.filter(
      (e) =>
        (this.#eventScope === "all" || (this.#eventScope === "here" ? e.scope === "here" : e.scope !== "elsewhere")) &&
        (!q || e.descriptor.toLowerCase().includes(q)),
    );
    if (!inScope.length)
      return h(
        "div",
        { class: "empty", part: "empty" },
        h(
          "slot",
          { name: "empty-events" },
          all.length ? t.noEventMatches : this.#machine?.session.status === "done" ? t.machineTerminated : t.nothingAccepted,
        ),
      );
    const groups = groupEvents(inScope);
    const autoOpen = inScope.length <= 14;
    return h(
      "div",
      { part: "events" },
      ...groups.map((g) => {
        const open = this.#groupOpen.get(g.prefix) ?? (autoOpen || g.events.length <= 4 || !!q);
        const details = h(
          "details",
          { class: "ev-group", part: "event-group", ...(open ? { open: "" } : {}) },
          h("summary", {}, g.prefix === "·" ? t.noPrefix : `${g.prefix}.*`, h("span", { class: "count" }, String(g.events.length))),
          ...g.events.map((e) => this.#eventRow(e)),
        ) as HTMLDetailsElement;
        details.addEventListener("toggle", () => this.#groupOpen.set(g.prefix, details.open));
        return details;
      }),
    );
  }

  #eventRow(e: AcceptedEvent) {
    const h = html;
    const t = this.#strings;
    const x = e.transitions[0]!;
    const name = sendableName(e.descriptor);
    // the event's name is its send button
    const send = button(e.descriptor, () => name && this.#send(name), {
      class: "ev send",
      part: "send",
      title: name ? t.sendEvent(name) : t.cannotSendWildcard,
      "aria-label": name ? t.sendEvent(name) : `${e.descriptor}: ${t.cannotSendWildcard}`,
    });
    if (!name) send.setAttribute("disabled", "");
    return h(
      "div",
      { class: `ev-row scope-${e.scope}`, part: parts("event-row", e.scope) },
      send,
      h(
        "span",
        {
          class: "how",
          title: e.transitions
            .map((y) => `${label(y.source)}${y.guarded ? ` [${y.transition.cond}]` : ""} → ${y.targets.map(label).join(" ") || t.internal}`)
            .join("\n"),
        },
        `${label(x.source)} `,
        x.guarded ? h("span", { class: "guard" }, `${t.guard(truncate(x.transition.cond ?? "", 28))} `) : "",
        `→ ${x.targets.map(label).join(", ") || t.stays}`,
        e.transitions.length > 1 ? ` · +${e.transitions.length - 1}` : "",
        // the scope in words, not only the colour of the event name
        e.scope !== "here" ? " · " : "",
        e.scope !== "here" ? h("span", { class: "scope-tag" }, e.scope === "inherited" ? t.inherited : t.elsewhere) : "",
      ),
      h("slot", { name: `event:${e.descriptor}` }),
    );
  }

  #sendDescriptor(descriptor: string) {
    const name = sendableName(descriptor);
    if (name) this.#send(name);
  }

  #send(name: string) {
    const machine = this.#machine;
    const session = machine?.session;
    if (!session) return;
    let data: unknown;
    const raw = this.#el.eventData.value.trim();
    if (raw) {
      try {
        data = JSON.parse(raw);
      } catch {
        this.#el.eventData.setCustomValidity(this.#strings.invalidJson);
        this.#el.eventData.reportValidity();
        return;
      }
    }
    this.#el.eventData.setCustomValidity("");
    if (!this.#emit<ExplorerSendDetail>("scxml-send", { session, name, data }, true)) return;
    this.#setFollow(true);
    if (this.#announce !== "off") this.#say(this.#strings.announceSent(name, machine.name), true);
    session.send(name, data);
  }

  #stateDetail(s: StateNode, session: Session) {
    const h = html;
    const t = this.#strings;
    const TX_PAGE = 30;
    const incoming = session.model.states.flatMap((x) => x.transitions.filter((tr) => tr.targets.includes(s)));
    const kv = (k: string, v: string | Node) => [h("dt", {}, k), h("dd", {}, v)];
    const txRows = s.transitions
      .slice(0, TX_PAGE)
      .map((tr: TransitionNode) =>
        h(
          "tr",
          {},
          h("td", { class: "ev" }, tr.events.join(" ") || "ε"),
          h("td", { class: "cond" }, tr.cond ?? ""),
          h(
            "td",
            { class: "to" },
            tr.targets.length ? tr.targets.map(label).join(", ") : tr.type === "internal" ? t.internal : `(${t.stays})`,
          ),
        ),
      );
    return h(
      "div",
      { class: "detail", part: "detail" },
      h("h2", { class: "title small" }, label(s)),
      h(
        "p",
        { class: "subtitle" },
        pathTo(s).slice(1, -1).map(label).join(" › ") || t.topLevel,
        session.isActiveNode(s) ? h("span", { class: "status active" }, t.active) : "",
      ),
      h(
        "dl",
        { class: "kv" },
        ...kv(t.detailKind, t.kind(kindOf(s))),
        ...kv(t.detailId, s.id),
        ...(s.children.length ? kv(t.detailStates, t.directAndInside(s.children.length, descendantCount(s))) : []),
        ...(s.initial?.targets.length ? kv(t.detailInitial, s.initial.targets.map(label).join(", ")) : []),
        ...(s.historyType ? kv(t.detailHistory, s.historyType) : []),
        ...(s.data.length ? kv(t.detailData, s.data.map((d) => d.getAttribute("id")).join(", ")) : []),
      ),
      isContainer(s) && s !== this.#focus
        ? button(t.focusState(label(s)), () => this.#focusOn(s), { class: "drill", style: "margin-top:8px" })
        : "",
      // authoring warnings about this state (model.warnings): likely mistakes that are still valid SCXML
      ...(() => {
        const warnings = session.model.warnings.filter((w) => w.state === s);
        if (!warnings.length) return [];
        return [
          h(
            "div",
            {},
            h("div", { class: "section-title" }, t.warningsTitle, h("span", { class: "count" }, String(warnings.length))),
            h("ul", { class: "warnings" }, ...warnings.map((w) => h("li", { part: "warning", "data-code": w.code }, w.message))),
          ),
        ];
      })(),
      s.onentry.length || s.onexit.length || s.invokes.length
        ? h("div", {}, h("div", { class: "section-title" }, t.actions), h("ul", { class: "actions" }, ...this.#actionItems(s)))
        : "",
      s.transitions.length
        ? h(
            "div",
            {},
            h("div", { class: "section-title" }, t.transitionsTitle),
            h(
              "table",
              { class: "tx" },
              h(
                "thead",
                {},
                h(
                  "tr",
                  {},
                  h("th", { scope: "col" }, t.columnEvent),
                  h("th", { scope: "col" }, t.columnIf),
                  h("th", { scope: "col" }, t.columnTo),
                ),
              ),
              h("tbody", {}, ...txRows),
            ),
            s.transitions.length > TX_PAGE ? h("p", { class: "count" }, t.more(s.transitions.length - TX_PAGE)) : "",
          )
        : "",
      incoming.length
        ? h(
            "div",
            {},
            h("div", { class: "section-title" }, t.enteredFrom),
            h(
              "div",
              { class: "talks" },
              ...incoming.slice(0, 12).map((tr) => {
                const c = h(
                  "button",
                  { class: "chip", type: "button", title: tr.events.join(" ") || "ε" },
                  `${label(tr.source)} ${tr.events[0] ? `(${tr.events[0]})` : ""}`,
                );
                c.addEventListener("click", () => this.#focusOn(tr.source));
                return c;
              }),
              incoming.length > 12 ? h("span", { class: "count" }, `+${incoming.length - 12}`) : "",
            ),
          )
        : "",
      h("slot", { name: `detail:${s.id}` }),
    );
  }

  #serviceDetail() {
    const h = html;
    const tr = this.#strings;
    const t = this.#tracker!;
    const key = this.#selectedService;
    const svc = key ? t.services.get(key) : undefined;
    if (!svc) return h("div", { class: "empty", part: "empty" }, h("slot", { name: "empty-detail" }, tr.selectService));
    const traffic = (svc.processor as { traffic?: { at: number; direction: "in" | "out"; event: string; sessionId: string }[] }).traffic;
    const links = t.linksOf(svc.key);
    return h(
      "div",
      { class: "detail", part: "detail" },
      h("h2", { class: "title small" }, svc.label),
      h("p", { class: "subtitle" }, svc.key),
      h("div", { class: "section-title" }, tr.talksWith),
      h(
        "ul",
        { class: "actions" },
        ...links.map((l) => {
          const other = l.from === svc.key ? l.to : l.from;
          const events = [...l.observed].sort((a, b) => b[1] - a[1]);
          return h(
            "li",
            {},
            h("b", {}, l.from === svc.key ? "→" : "←"),
            `${t.machines.get(other)?.name ?? other}: `,
            events
              .slice(0, 4)
              .map(([e, n]) => `${e}×${n}`)
              .join(", ") || [...l.declared].join(", "),
          );
        }),
      ),
      traffic?.length
        ? h(
            "div",
            {},
            h("div", { class: "section-title" }, tr.recentTraffic, h("span", { class: "count" }, String(traffic.length))),
            h(
              "ul",
              { class: "traffic" },
              ...traffic
                .slice(-40)
                .reverse()
                .map((x) =>
                  h(
                    "li",
                    {},
                    h("span", { class: "dir", "aria-hidden": "true" }, x.direction === "out" ? "↗" : "↙"),
                    `${x.event}  ·  ${t.machines.get(x.sessionId)?.name ?? x.sessionId}`,
                  ),
                ),
            ),
          )
        : "",
    );
  }

  // ── tabs (narrow layout) ──

  #renderTabs() {
    const s = this.#strings;
    const tabs: [Tab, string][] = [
      ["system", s.tabSystem],
      ["tree", s.tabStates],
      ["focus", s.tabFocus],
      ["events", s.tabEvents],
      ["detail", s.tabDetail],
    ];
    const paneFor: Record<Tab, HTMLElement> = {
      system: this.#el.center,
      tree: this.#el.treePane,
      focus: this.#el.center,
      events: this.#el.inspector,
      detail: this.#el.inspector,
    };
    for (const p of [this.#el.treePane, this.#el.center, this.#el.inspector])
      p.toggleAttribute("data-tab-active", paneFor[this.#tab] === p);
    this.#el.tabs.replaceChildren(
      ...tabs.map(([t, text]) =>
        button(
          text,
          () => {
            this.#tab = t;
            if (t === "system") this.#level = "system";
            if (t === "focus" || t === "events") this.#level = "machine";
            if (t === "events" || t === "detail") this.#inspector = t;
            this.#renderNow();
          },
          { role: "tab", part: parts("tab", this.#tab === t && "selected"), "aria-selected": String(this.#tab === t) },
        ),
      ),
    );
  }
}

// ───────────────────────────────── helpers ─────────────────────────────────

const explorerSheet = lazySheet(EXPLORER_CSS);

/** Make a focusable element behave like a button: click, Enter and Space all run `fn`. */
function activate(el: HTMLElement, fn: () => void) {
  el.addEventListener("click", fn);
  onKeys(el, fn);
}

/** Enter and Space on `el` itself (not on controls inside it) run `fn` instead of its default. */
function onKeys(el: HTMLElement, fn: (e: KeyboardEvent) => void) {
  el.addEventListener("keydown", (e) => {
    if (e.target !== el || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    fn(e);
  });
}

/** The mark of a parallel, final or history state; screen readers get the kind from the row's name. */
function kindMark(s: StateNode): HTMLElement | "" {
  const mark = KIND_MARK[kindOf(s)];
  return mark ? html("span", { class: "kind", "aria-hidden": "true" }, mark) : "";
}

/** Text only screen readers see: status in words where the screen shows colour or shape. */
function srText(text: string): HTMLElement {
  return html("span", { class: "sr-only" }, text);
}

/** A `part` attribute: the base name plus modifiers that apply ("card path active"). */
function parts(base: string, ...modifiers: (string | false | null | undefined)[]): string {
  return [base, ...modifiers.filter((m): m is string => !!m)].join(" ");
}

type Attrs = Record<string, string>;
function html(tag: string, attrs: Attrs = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "value" && "value" in el) (el as HTMLInputElement).value = v;
    // through the CSSOM, not the style attribute: a strict Content-Security-Policy (no 'unsafe-inline') allows it
    else if (k === "style") el.style.cssText = v;
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

function button(text: string, onClick: (e: MouseEvent) => void, attrs: Attrs = {}) {
  const b = html("button", { type: "button", ...attrs }, text);
  b.addEventListener("click", onClick);
  return b;
}

/** Number of layers the diagram would need (longest shortest-path from the initial child, +1 for unreachable ones). */
function estimateRanks(children: ChildSummary[], edges: FocusEdge[]): number {
  const rank = new Map<StateNode, number>();
  const queue = children.filter((c) => c.initial).map((c) => c.node);
  if (!queue.length && children[0]) queue.push(children[0].node);
  for (const q of queue) rank.set(q, 0);
  for (let i = 0; i < queue.length; i++) {
    const n = queue[i]!;
    for (const e of edges) {
      if (e.from !== n || rank.has(e.to)) continue;
      rank.set(e.to, rank.get(n)! + 1);
      queue.push(e.to);
    }
  }
  const max = Math.max(0, ...rank.values()) + 1;
  return rank.size < children.length ? max + 1 : max;
}

function formatTime(ms: number) {
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function describeAction(a: Element): string {
  const at = (n: string) => a.getAttribute(n);
  switch (a.localName) {
    case "send":
      return `send ${at("type") && at("type") !== "scxml" ? `${at("type")}:` : ""}${at("event") ?? at("eventexpr") ?? ""}${at("target") ? ` → ${at("target")}` : ""}${at("delay") || at("delayexpr") ? " ⏱" : ""}`;
    case "log":
      return `log ${at("label") ?? ""}`;
    case "assign":
      return `${at("location")} ← ${truncate(at("expr") ?? "…", 30)}`;
    case "raise":
      return `raise ${at("event")}`;
    case "cancel":
      return `cancel ${at("sendid") ?? ""}`;
    case "if":
      return `if ${truncate(at("cond") ?? "", 30)} …`;
    case "foreach":
      return `foreach ${at("item")} in ${at("array")}`;
    default:
      return a.localName;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("scxml-explorer")) customElements.define("scxml-explorer", ScxmlExplorer);

declare global {
  interface HTMLElementTagNameMap {
    "scxml-explorer": ScxmlExplorer;
  }
}

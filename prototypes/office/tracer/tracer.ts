/**
 * A generic recorder for systems of @tinyactors/scxmljs statecharts. It turns a run of any system
 * into the Office's trace format (../SCHEMA.md, v1–v3), with no code for any one system.
 *
 *   const tracer = createTracer({ system: "orders", clock });
 *   tracer.captureAll();                 // or: const engine = tracer.wrapEngine(createSession)
 *   …boot the system, drive it on the VirtualClock…
 *   const trace = tracer.finish();
 *
 * What it hooks (all from public events, plus a few private fields listed in README.md):
 *   - every session it observes (created through `wrapEngine`, started anywhere after
 *     `captureAll()`, or invoked as an SCXML child of an observed session): spawn, end (with the
 *     reason), microsteps (→ transition, with the triggering event and its cause), macrosteps
 *     (→ config, data, snapshot), `<send>`s (→ message), `<invoke>`s;
 *   - each session's I/O processor handles (`IOSession.deliver`, patched in place): inbound events;
 *   - each session's custom invokers (patched in place): what a service sends back to its parent;
 *   - `session.send()` (patched on the instance): what application code sends;
 *   - the session's clock (replaced on the instance by a thin wrapper): delayed sends, so a timer
 *     is seen when it is set (by which step) and when it fires.
 *
 * Events are emitted as they happen (`onEvent`), with two exceptions, documented in README.md:
 * what a session sends during a step is held until the step's transition is recorded (so it can
 * point at it), and a `<send>` to an I/O processor that nobody received at once is emitted when the
 * clock moves on (as a message to the processor itself). `finish()` sorts by time.
 */
import { SCXMLSession } from "@tinyactors/scxmljs";

// ───────────────────────────── trace types ─────────────────────────────

export type Action = Record<string, unknown> & { type: string };
export interface TNode {
  id: string;
  kind: "compound" | "parallel" | "atomic" | "final" | "history";
  initial?: string[];
  children: TNode[];
  transitions: { event?: string; cond?: string; targets: string[]; actions?: Action[]; internal?: boolean }[];
  invokes?: { type: string; id?: string; src?: string; autoforward?: boolean }[];
  doc?: string;
  onentry?: Action[];
  onexit?: Action[];
  history?: "shallow" | "deep";
}
export interface DataDecl {
  id: string;
  expr?: string;
  type?: string;
  doc?: string;
  scope?: string;
  readBy?: string[];
  writtenBy?: string[];
}
export interface Chart {
  root: TNode;
  purpose?: string;
  datamodel?: DataDecl[];
  source?: string;
  name?: string;
  depth?: number;
  states?: number;
}
export interface Actor {
  id: string;
  chart: string;
  label: string;
  role: string;
  parent?: string;
  bornAt: number;
  diedAt?: number;
  /** The logical identity: incarnations of one thing (a task resumed by a new process) share it. */
  identity?: string;
  /** 1 for the first actor with this identity, 2 for the next… */
  incarnation?: number;
  /** The invokeid, for actors started by `<invoke>`. */
  invokeid?: string;
  sessionId?: string;
}
export interface External {
  id: string;
  label: string;
  kind: string;
  /** Only named by the static wiring: no message reached or left it in this run. */
  unused?: boolean;
}
export interface Wire {
  from: string;
  to: string;
  event: string;
  fromState?: string;
  count?: number;
}
export type Ev = Record<string, unknown> & { id: string; t: number; type: string; cause?: string };
export interface StoryStep {
  text: string;
  actor: string;
  events: string[];
  t0: number;
  t1: number;
}
export interface Story {
  id: string;
  question: string;
  answer: string;
  steps: StoryStep[];
  derived?: boolean;
}
export interface Trace {
  system: string;
  scenario: string;
  duration: number;
  version: 3;
  recorder: string;
  charts: Record<string, Chart>;
  actors: Actor[];
  externals: External[];
  wiring: Wire[];
  events: Ev[];
  stories?: Story[];
}

/** What a driver may say about a session (all optional). */
export interface Identity {
  /** Actor id (made unique with `~2`, `~3` when taken). */
  id?: string;
  label?: string;
  role?: string;
  /** Chart key: sessions of structurally equal charts share one chart anyway. */
  chart?: string;
  /** The chart's file name. */
  source?: string;
  /** What the chart is for (default: the comment that introduces it, when the source text is known). */
  purpose?: string;
  /** Logical identity across incarnations (see Actor.identity). Default: the label. */
  identity?: string;
}
export interface SessionInfo {
  /** `<scxml name>`. */
  name: string;
  sessionId: string;
  /** `SessionOptions.data` (initial values). */
  data: Record<string, unknown>;
  /** For invoked children: the parent's actor id and the invokeid; `src` of the `<invoke>` when static. */
  parent?: string;
  invokeid?: string;
  src?: string;
}

export interface TracerOptions {
  system: string;
  scenario?: string;
  /** The system's clock: event times come from it. */
  clock: { now(): number };
  /** Name sessions. Return nothing to use the defaults (label from `<scxml name>`). */
  identify?: (session: SCXMLSession, info: SessionInfo) => Identity | undefined;
  /**
   * Who delivered an inbound event that no observed `<send>` explains: return an endpoint id
   * (an actor or external id), or nothing for the default (the origin when it is a short name,
   * else the processor's alias).
   */
  resolveOrigin?: (alias: string, origin: string | undefined, info: { to: string; name: string }) => string | undefined;
  /** The endpoint `session.send()` from application code is attributed to. Default `app`. */
  app?: { id: string; label: string; kind?: string };
  /**
   * How an application send gets a cause: `none` (an outside stimulus, the default) or `same-tick`
   * (inferred: the newest message into any external at the same instant — for systems whose
   * application code reacts to what charts tell it, like a harness process).
   */
  appCause?: "none" | "same-tick";
  /** With `appCause: "same-tick"`: how far back (ms) the inferred cause may be. Default 0 (the same instant). */
  appCauseWindowMs?: number;
  /** Called for every event as it is recorded (see the header for ordering). */
  onEvent?: (e: Ev) => void;
  /** Called when an actor or external appears (so a live view can place it before its events). */
  onEndpoint?: (kind: "actor" | "external", value: Actor | External) => void;
  /** Name the external an I/O processor stands for (by its alias), e.g. a wire whose far end is a server. */
  externalFor?: (alias: string) => string | undefined;
  /** Max ms between a `<send>` to an I/O processor and a delivery that counts as receiving it. Default 0. */
  deliveryWindowMs?: number;
}

// ───────────────────────────── helpers ─────────────────────────────

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const squash = (s: string) =>
  s
    .replace(/[─━═—=-]{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
/** JSON value, truncated: strings ≤ 200 chars, arrays ≤ 20 items, depth ≤ 3. */
export function trunc(v: unknown, depth = 0, maxDepth = 3, maxItems = 20): unknown {
  if (v === undefined) return null;
  if (typeof v === "string") return v.length > 200 ? `${v.slice(0, 199)}…` : v;
  if (typeof v === "number" || typeof v === "boolean" || v === null) return Number.isNaN(v) ? null : v;
  if (typeof v === "bigint") return String(v);
  if (typeof v !== "object") return `[${typeof v}]`;
  if ((v as Node).nodeType !== undefined && typeof (v as Node).nodeName === "string") return `<${(v as Node).nodeName}>`;
  if (depth >= maxDepth) return Array.isArray(v) ? `[array(${v.length})]` : `[object(${Object.keys(v).length})]`;
  if (Array.isArray(v)) {
    const a = v.slice(0, maxItems).map((x) => trunc(x, depth + 1, maxDepth, maxItems));
    if (v.length > maxItems) a.push(`…+${v.length - maxItems} more`);
    return a;
  }
  const o: Record<string, unknown> = {};
  let n = 0;
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (++n > Math.max(maxItems, 10)) {
      o["…"] = `+${Object.keys(v).length - n + 1} more keys`;
      break;
    }
    o[k] = trunc(x, depth + 1, maxDepth, maxItems);
  }
  return o;
}
/** `trunc`, made shallower until its JSON fits in `budget` characters (big documents in a datamodel). */
export function truncFit(v: unknown, budget = 700): unknown {
  for (const [d, n] of [
    [3, 20],
    [3, 8],
    [2, 8],
    [2, 4],
    [1, 4],
  ] as const) {
    const x = trunc(v, 0, d, n);
    if (JSON.stringify(x).length <= budget) return x;
  }
  return short(v);
}
function summarize(data: unknown, n = 90): string | undefined {
  if (data === undefined || data === null) return undefined;
  try {
    const j = typeof data === "string" ? JSON.stringify(data) : JSON.stringify(trunc(data));
    return j === "{}" || j === undefined ? undefined : clip(j, n);
  } catch {
    return undefined;
  }
}
function short(v: unknown): string {
  if (v === undefined || v === null) return String(v);
  if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? "" : "s"}${v.length ? `: ${clip(JSON.stringify(trunc(v)), 70)}` : ""}`;
  if (typeof v === "object") {
    const k = Object.keys(v);
    return `${k.length} key${k.length === 1 ? "" : "s"}${k.length ? `: ${clip(k.join(", "), 70)}` : ""}`;
  }
  return clip(String(v), 90);
}
const slug = (s: string) =>
  s
    .trim()
    .replace(/[^\w.@:/#-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "actor";
/** A processor's short name: its first alias, else the last segment of its type URI. */
const aliasOf = (p: { type: string; aliases?: readonly string[] }) =>
  p.aliases?.[0] ?? (p.type.replace(/[/#:]+$/, "").split(/[/#:]/).pop() || p.type);
const SCXML_TYPES = new Set(["scxml", "http://www.w3.org/TR/scxml/#SCXMLEventProcessor", "http://www.w3.org/TR/scxml/", "http://www.w3.org/TR/scxml"]);
const isScxmlType = (t: string) => SCXML_TYPES.has(t);

// ───────────────────────────── static analysis ─────────────────────────────

type SNode = SCXMLSession["model"]["root"];
const kids = (el: Element) => Array.from(el.children) as Element[];
const tag = (el: Element) => el.localName ?? el.tagName.toLowerCase();
/** `el` and every element inside it (works with any DOM, the library's own parser included). */
const descendants = (el: Element): Element[] => [el, ...kids(el).flatMap(descendants)];

function commentBefore(el: Element): string | undefined {
  let p = el.previousSibling;
  while (p && p.nodeType === 3 && !p.textContent?.trim()) p = p.previousSibling;
  if (p && p.nodeType === 8) return squash(p.textContent ?? "") || undefined;
  return undefined;
}
function firstCommentInside(el: Element): string | undefined {
  for (const c of Array.from(el.childNodes)) {
    if (c.nodeType === 8) return squash(c.textContent ?? "") || undefined;
    if (c.nodeType === 1) return undefined;
  }
  return undefined;
}
const attrs = (el: Element, names: string[]) => {
  const o: Record<string, string> = {};
  for (const n of names) {
    const v = el.getAttribute(n);
    if (v !== null) o[n] = v;
  }
  return o;
};

function actionsOf(list: Element[]): Action[] {
  const out: Action[] = [];
  for (const c of list) {
    switch (tag(c)) {
      case "assign": {
        const a: Action = { type: "assign", location: c.getAttribute("location") ?? "" };
        const e = c.getAttribute("expr") ?? (c.textContent?.trim() || null);
        if (e) a.expr = clip(squash(e), 300);
        out.push(a);
        break;
      }
      case "send": {
        const a: Action = { type: "send", ...attrs(c, ["event", "eventexpr", "target", "targetexpr", "delay", "delayexpr", "id", "idlocation"]) };
        const ty = c.getAttribute("type") ?? c.getAttribute("typeexpr");
        if (ty) a.sendType = ty;
        const params = kids(c)
          .filter((p) => tag(p) === "param")
          .map((p) => p.getAttribute("name"));
        if (params.length) a.params = params;
        const nl = c.getAttribute("namelist");
        if (nl) a.namelist = nl;
        out.push(a);
        break;
      }
      case "raise":
        out.push({ type: "raise", event: c.getAttribute("event") ?? "" });
        break;
      case "cancel": {
        const a: Action = { type: "cancel" };
        const s = c.getAttribute("sendid") ?? c.getAttribute("sendidexpr");
        if (s) a.sendid = s;
        out.push(a);
        break;
      }
      case "script":
        out.push({ type: "script", code: clip((c.textContent ?? "").trim() || `src=${c.getAttribute("src") ?? ""}`, 1500) });
        break;
      case "log":
        out.push({ type: "log", ...attrs(c, ["label", "expr"]) });
        break;
      case "foreach":
        out.push({ type: "foreach", array: c.getAttribute("array") ?? "", item: c.getAttribute("item") ?? "", body: actionsOf(kids(c)) });
        break;
      case "if": {
        const branches: { cond: string | null; els: Element[] }[] = [{ cond: c.getAttribute("cond") ?? "", els: [] }];
        for (const k of kids(c)) {
          const t = tag(k);
          if (t === "elseif") branches.push({ cond: k.getAttribute("cond") ?? "", els: [] });
          else if (t === "else") branches.push({ cond: null, els: [] });
          else branches.at(-1)!.els.push(k);
        }
        let tail: Action[] | undefined;
        for (let j = branches.length - 1; j >= 0; j--) {
          const br = branches[j]!;
          if (br.cond === null) tail = actionsOf(br.els);
          else {
            const node: Action = { type: "if", cond: br.cond, then: actionsOf(br.els) };
            if (tail) node.else = tail;
            tail = [node];
          }
        }
        if (tail?.[0]) out.push(tail[0]);
        break;
      }
    }
  }
  return out;
}

function inferType(e?: string): string {
  if (e === undefined) return "unknown";
  const x = e.trim().replace(/^\((.*)\)$/s, "$1").trim();
  if (/^-?\d/.test(x)) return "number";
  if (/^['"`]/.test(x)) return "string";
  if (x === "true" || x === "false") return "boolean";
  if (x === "null") return "null";
  if (x.startsWith("[")) return "array";
  if (x.startsWith("{")) return "object";
  return "unknown";
}
const typeOfValue = (v: unknown) =>
  v === null || v === undefined ? "null" : Array.isArray(v) ? "array" : typeof v === "object" ? "object" : typeof v === "number" || typeof v === "string" || typeof v === "boolean" ? typeof v : "unknown";

function inferDoc(n: TNode): string {
  if (n.kind === "history") return `Remembers the last active ${n.history === "deep" ? "states (deep)" : "child"}`;
  if (n.kind === "final") return "Done";
  const evs = [...new Set(n.transitions.map((t) => t.event).filter(Boolean))].slice(0, 3).join(", ");
  const base =
    n.kind === "parallel"
      ? `Regions run together: ${n.children.map((c) => c.id).slice(0, 3).join(", ")}`
      : n.kind === "compound"
        ? `Groups ${n.children
            .filter((c) => c.kind !== "history")
            .map((c) => c.id)
            .slice(0, 3)
            .join(", ")}`
        : n.invokes?.length
          ? `Runs ${n.invokes.map((i) => i.src ?? i.type).join(", ")}`
          : `In ${n.id}`;
  return clip(`${base}${evs ? `; reacts to ${evs}` : ""}`, 90);
}

export interface StaticSend {
  state: string;
  event: string;
  target?: string;
  type?: string;
  delayed: boolean;
}
export interface Analysis {
  chart: Chart;
  sends: StaticSend[];
  invokes: { state: string; type: string; id?: string; src?: string }[];
  signature: string;
}

/** The static structure of a compiled chart (state tree, actions, datamodel, docs). */
/** The comment that introduces a chart in its source text: the last one before `<scxml`, else the first inside it. */
export function leadingComment(text: string): string | undefined {
  const at = text.search(/<scxml[\s>]/);
  if (at < 0) return undefined;
  const before = [...text.slice(0, at).matchAll(/<!--([\s\S]*?)-->/g)].at(-1)?.[1];
  if (before) return squash(before) || undefined;
  const open = text.indexOf(">", at);
  const inside = /^\s*<!--([\s\S]*?)-->/.exec(text.slice(open + 1))?.[1];
  return inside ? squash(inside) || undefined : undefined;
}

export function analyzeModel(model: SCXMLSession["model"], purposeText?: string): Analysis {
  const sid = (s: SNode) => (s === model.root ? "__root__" : s.id);
  const datamodel: DataDecl[] = [];
  const sends: StaticSend[] = [];
  const invokes: Analysis["invokes"] = [];
  const reads = new Map<string, string[]>();
  const writes = new Map<string, string[]>();
  const bucket = (m: Map<string, string[]>, k: string) => m.get(k) ?? m.set(k, []).get(k)!;
  const collectRW = (state: string, acts: Action[]) => {
    for (const a of acts) {
      const r = bucket(reads, state);
      const w = bucket(writes, state);
      if (a.type === "assign") {
        w.push(String(a.location));
        if (a.expr) r.push(String(a.expr));
      } else if (a.type === "script") {
        const code = String(a.code);
        r.push(code);
        for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*(?:\.[\w$]+|\[[^\]]*\])*\s*(?:[+\-*/]?=(?!=)|\+\+|--|\.(?:push|splice|shift|pop|unshift|set|delete|add)\()/g))
          w.push(m[1]!);
        for (const m of code.matchAll(/\bdelete\s+([A-Za-z_$][\w$]*)/g)) w.push(m[1]!);
      } else if (a.type === "if") {
        r.push(String(a.cond));
        collectRW(state, (a.then as Action[]) ?? []);
        collectRW(state, (a.else as Action[]) ?? []);
      } else if (a.type === "foreach") {
        r.push(String(a.array));
        w.push(String(a.item));
        collectRW(state, a.body as Action[]);
      } else r.push(JSON.stringify(a));
    }
  };
  const collectSends = (state: string, els: Element[]) => {
    for (const el of els)
      for (const s of descendants(el).filter((x) => tag(x) === "send")) {
        const x: StaticSend = {
          state,
          event: s.getAttribute("event") ?? `(${s.getAttribute("eventexpr") ?? "?"})`,
          delayed: s.hasAttribute("delay") || s.hasAttribute("delayexpr"),
        };
        const target = s.getAttribute("target") ?? (s.hasAttribute("targetexpr") ? `{${s.getAttribute("targetexpr")}}` : undefined);
        const type = s.getAttribute("type") ?? (s.hasAttribute("typeexpr") ? `{${s.getAttribute("typeexpr")}}` : undefined);
        if (target !== undefined) x.target = target;
        if (type !== undefined) x.type = type;
        sends.push(x);
      }
  };
  let maxDepth = 0;
  let count = 0;
  const walk = (s: SNode, depth: number): TNode => {
    const isRoot = s === model.root;
    count++;
    maxDepth = Math.max(maxDepth, depth);
    const all = [...s.history, ...s.children].sort((a, b) => a.order - b.order);
    const children = all.map((c) => walk(c, depth + 1));
    const kind: TNode["kind"] = isRoot
      ? "compound"
      : s.kind === "parallel"
        ? "parallel"
        : s.kind === "final"
          ? "final"
          : s.kind === "history"
            ? "history"
            : s.children.length
              ? "compound"
              : "atomic";
    const id = sid(s);
    const node: TNode = { id, kind, children, transitions: [] };
    if (s.kind === "history") node.history = s.historyType ?? "shallow";
    if (s.initial && (isRoot || s.children.length)) node.initial = s.initial.targets.map(sid);
    for (const t of s.transitions) {
      const x: TNode["transitions"][number] = { targets: t.targets.map(sid) };
      if (t.events.length) x.event = t.events.join(" ");
      if (t.cond) x.cond = t.cond;
      if (t.element) {
        const acts = actionsOf(kids(t.element));
        if (acts.length) x.actions = acts;
        collectRW(id, acts);
        collectSends(id, kids(t.element));
      }
      if (t.type === "internal") x.internal = true;
      if (t.cond) bucket(reads, id).push(t.cond);
      node.transitions.push(x);
    }
    for (const which of ["onentry", "onexit"] as const) {
      const blocks = s[which];
      if (blocks.length) {
        node[which] = blocks.flatMap((b) => actionsOf(kids(b)));
        collectRW(id, node[which]!);
        for (const b of blocks) collectSends(id, kids(b));
      }
    }
    if (s.invokes.length)
      node.invokes = s.invokes.map((inv) => {
        const el = inv.element;
        const o: NonNullable<TNode["invokes"]>[number] = { type: el.getAttribute("type") ?? (el.hasAttribute("typeexpr") ? `{${el.getAttribute("typeexpr")}}` : "scxml") };
        const iid = el.getAttribute("id");
        const src = el.getAttribute("src") ?? (el.hasAttribute("srcexpr") ? `{${el.getAttribute("srcexpr")}}` : undefined);
        if (iid) o.id = iid;
        if (src) o.src = src;
        if (inv.autoforward) o.autoforward = true;
        invokes.push({ state: id, ...o });
        if (inv.finalize) collectSends(id, kids(inv.finalize));
        return o;
      });
    if (!isRoot) {
      const before = commentBefore(s.element);
      const inside = firstCommentInside(s.element);
      node.doc = before ? clip(before, 160) : inside ? clip(inside, 160) : inferDoc(node);
    }
    return node;
  };
  const root = walk(model.root, 0);
  for (const d of model.allData) {
    const decl: DataDecl = { id: d.getAttribute("id") ?? "" };
    const e = d.getAttribute("expr") ?? (d.hasAttribute("src") ? `src=${d.getAttribute("src")}` : d.textContent?.trim() || undefined);
    if (e) decl.expr = clip(squash(e), 300);
    decl.type = inferType(d.getAttribute("expr") ?? (d.textContent?.trim() || undefined));
    const c = commentBefore(d);
    if (c) decl.doc = clip(c, 200);
    const owner = d.parentElement?.parentElement;
    const st = owner ? model.byElement.get(owner) : undefined;
    if (st && st !== model.root) decl.scope = st.id;
    datamodel.push(decl);
  }
  for (const d of datamodel) {
    const re = new RegExp(`(^|[^\\w$.])${d.id.replace(/[$]/g, "\\$")}\\b`);
    const readBy = [...reads].filter(([, txt]) => txt.some((x) => re.test(x))).map(([s]) => s);
    const writtenBy = [...writes].filter(([, w]) => w.some((x) => x === d.id || x.startsWith(`${d.id}.`) || x.startsWith(`${d.id}[`))).map(([s]) => s);
    if (readBy.length) d.readBy = readBy;
    if (writtenBy.length) d.writtenBy = writtenBy;
  }
  const rootEl = model.root.element;
  // the structure alone identifies a chart: sessions of one chart with different names share it
  const signature = JSON.stringify([root, datamodel]);
  const purpose = purposeText ?? commentBefore(rootEl) ?? firstCommentInside(rootEl);
  root.doc = purpose ? clip(purpose, 300) : model.name || "The chart";
  const chart: Chart = { root, datamodel, depth: maxDepth, states: count - 1 };
  if (purpose) chart.purpose = clip(purpose, 300);
  return { chart, sends, invokes, signature };
}

// ───────────────────────────── the tracer ─────────────────────────────

interface InboxEntry {
  name: string;
  msg: Ev;
}
interface TimerRec {
  ev?: Ev; // the "timer set" event (buffered until the step that set it is recorded)
  delay: number;
  sess: Sess;
}
interface Pending {
  from: string;
  sess: Sess;
  alias: string;
  procExt: string;
  name: string;
  data: unknown;
  t: number;
  delivered: number;
  extra: Record<string, unknown>;
  /** The message as it will be emitted if nobody receives it (its cause is filled when the step is recorded). */
  ev: Ev;
}
interface Sess {
  id: string;
  session: SCXMLSession;
  chart: string;
  actor: Actor;
  inbox: InboxEntry[];
  outbox: (Ev | { __pending: Pending })[];
  lastStep?: Ev;
  macroTrigger?: InboxEntry;
  lastCfgKey?: string;
  microCfg?: string[];
  lastSnap?: string;
  lastValues: Map<string, string>;
  ended: boolean;
  disposing: boolean;
  firing?: TimerRec;
  invokeExt: Map<string, string>; // invokeid → endpoint (child actor or external)
  procExt: Map<object, string>; // processor → external id
}

const RECORDER = "prototypes/office/tracer";
const OBSERVED = Symbol("tracer.observed");
const WRAPPED = Symbol("tracer.wrapped");

export type Tracer = ReturnType<typeof createTracer>;

export function createTracer(opts: TracerOptions) {
  const now = () => opts.clock.now();
  const window = opts.deliveryWindowMs ?? 0;
  const events: Ev[] = [];
  const actors: Actor[] = [];
  const externals = new Map<string, External>();
  const presetExternals = new Map<string, { label: string; kind: string }>();
  const charts: Record<string, Chart> = {};
  const analyses = new Map<string, Analysis>(); // chart key → analysis
  const chartBySig = new Map<string, string>();
  const chartOfModel = new WeakMap<object, string>();
  const sessBySession = new WeakMap<SCXMLSession, Sess>();
  const sessById = new Map<string, Sess>(); // actor id
  const sessBySessionId = new Map<string, Sess>();
  const identities = new Map<string, number>();
  const pendings: Pending[] = [];
  const loaded = new Map<string, string>(); // src → chart text, through patched loaders
  const lastInto = new Map<string, Ev>(); // external → newest message into it
  const lastFromTo = new Map<string, Ev>(); // `${actor}|${external}` → newest
  const procInstances = new Map<string, object[]>(); // alias → processor instances, in order seen
  const procOwners = new Map<object, Set<string>>(); // processor → actor ids that use it
  let seq = 0;
  let appCtx: string[] = [];
  let invoking: Sess | undefined;
  let finished = false;
  const app = opts.app ?? { id: "app", label: "the application", kind: "app" };

  // ── emission ──
  const flushPendings = (force = false) => {
    if (!pendings.length) return;
    const t = now();
    for (let i = 0; i < pendings.length; ) {
      const p = pendings[i]!;
      if (!force && t <= p.t + window) {
        i++;
        continue;
      }
      pendings.splice(i, 1);
      if (p.delivered > 0) continue;
      // nobody received it at once: it went to the processor itself (an external endpoint)
      p.ev.id = `e${seq++}`;
      emitRaw(p.ev);
    }
  };
  const emitRaw = (ev: Ev) => {
    events.push(ev);
    if (ev.type === "message") {
      const to = String(ev.to);
      if (externals.has(to)) {
        lastInto.set(to, ev);
        lastFromTo.set(`${ev.from}|${to}`, ev);
      }
    }
    opts.onEvent?.(ev);
  };
  /** Record an event now (or in the sender's outbox while its step runs). */
  const record = (e: Omit<Ev, "id" | "t"> & { t?: number }, holder?: Sess): Ev => {
    const ev = { id: "", t: now(), ...e } as Ev;
    if (holder && busy(holder) && !holder.ended) {
      holder.outbox.push(ev);
      return ev;
    }
    commit(ev);
    return ev;
  };
  const commit = (ev: Ev) => {
    if (finished) return;
    flushPendings();
    ev.id = `e${seq++}`;
    emitRaw(ev);
  };
  const busy = (s: Sess) => !!(s.session as unknown as { busy?: boolean }).busy;
  /** Emit what a session sent during its step, pointing at the step. */
  const flushOutbox = (s: Sess, step?: Ev) => {
    if (!s.outbox.length) return;
    const list = s.outbox.splice(0);
    for (const x of list) {
      if ("__pending" in x) {
        const p = x.__pending as Pending;
        const c = step ?? s.lastStep;
        if (c) {
          p.ev.cause = c.id;
          if (step) p.ev.via = step.id;
        }
        continue;
      }
      const ev = x as Ev;
      if (!ev.cause) {
        const c = step ?? s.lastStep;
        if (c) ev.cause = c.id;
        if (step && ev.type === "message") ev.via = step.id;
      }
      commit(ev);
    }
  };

  // ── endpoints ──
  const external = (id: string, label?: string, kind?: string): string => {
    if (!externals.has(id)) {
      const pre = presetExternals.get(id);
      const x: External = { id, label: pre?.label ?? label ?? id, kind: pre?.kind ?? kind ?? "external" };
      externals.set(id, x);
      opts.onEndpoint?.("external", x);
    }
    return id;
  };
  const freeId = (base: string) => {
    let id = base;
    for (let n = 2; sessById.has(id) || externals.has(id) || presetExternals.has(id); n++) id = `${base}~${n}`;
    return id;
  };
  /** An external id that no actor has. */
  const extName = (base: string) => (sessById.has(base) ? `${base}@io` : base);
  /**
   * The external a processor stands for: one per alias while recording (`externalFor` may name
   * it); `finish()` splits it into one per session when every instance served a single session
   * (a client's own tools), and keeps one when instances are shared (a bus, a process's storage).
   */
  const procExternal = (s: Sess, p: { type: string; aliases?: readonly string[] }): string => {
    const known = s.procExt.get(p);
    if (known) return known;
    const alias = aliasOf(p);
    const list = procInstances.get(alias) ?? procInstances.set(alias, []).get(alias)!;
    if (!list.includes(p)) list.push(p);
    const named = opts.externalFor?.(alias);
    const id = named ?? extName(alias);
    if (named && sessById.has(named)) return named;
    external(id, `${alias} (I/O processor)`, "processor");
    s.procExt.set(p, id);
    return id;
  };
  /** Remember which processor instance a message went through (for the split in finish). */
  const tagProc = (ev: Ev, p: object | undefined, side: "from" | "to") => {
    if (p) Object.defineProperty(ev, "_proc", { value: { p, side }, enumerable: false });
    return ev;
  };

  // ── charts ──
  const chartFor = (model: SCXMLSession["model"], ident?: Identity): string => {
    const known = chartOfModel.get(model);
    if (known) return known;
    const a = analyzeModel(model, ident?.purpose);
    let key = chartBySig.get(a.signature);
    if (!key) {
      const base = slug(ident?.chart ?? (model.name.split(" · ")[0]?.trim() || ident?.source?.replace(/\.scxml$/, "") || "chart"));
      key = base;
      for (let n = 2; charts[key]; n++) key = `${base}-${n}`;
      if (model.name) a.chart.name = model.name.split(" · ")[0]!.trim();
      if (ident?.source) a.chart.source = ident.source;
      charts[key] = a.chart;
      analyses.set(key, a);
      chartBySig.set(a.signature, key);
    } else {
      if (ident?.source && !charts[key]!.source) charts[key]!.source = ident.source;
      if (ident?.purpose && !charts[key]!.purpose) {
        charts[key]!.purpose = clip(ident.purpose, 300);
        charts[key]!.root.doc = charts[key]!.purpose;
      }
    }
    chartOfModel.set(model, key);
    return key;
  };

  // ── observing a session ──
  function observe(session: SCXMLSession, hint: { parent?: Sess; invokeid?: string; src?: string } = {}): string {
    const existing = sessBySession.get(session);
    if (existing) return existing.id;
    const priv = session as unknown as {
      opts?: { data?: Record<string, unknown>; invokers?: Record<string, (ctx: Record<string, unknown>) => unknown>; loader?: (src: string) => unknown };
      ioSessions?: Map<{ type: string; aliases?: readonly string[] }, { sessionId: string; deliver: (n: string, d?: unknown, o?: string) => void }>;
      clock: { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void; defer(fn: () => void): void };
    };
    const info: SessionInfo = { name: session.model.name, sessionId: session.sessionId, data: priv.opts?.data ?? {} };
    if (hint.parent) info.parent = hint.parent.id;
    if (hint.invokeid) info.invokeid = hint.invokeid;
    if (hint.src) info.src = hint.src;
    const ident: Identity = { ...pendingHints.get(session), ...opts.identify?.(session, info) };
    if (!ident.source && hint.src && !hint.src.startsWith("{")) ident.source = hint.src;
    if (!ident.purpose && hint.src && loaded.has(hint.src)) ident.purpose = leadingComment(loaded.get(hint.src)!);
    const chart = chartFor(session.model, ident);
    const nameLabel = session.model.name.includes(" · ") ? session.model.name.split(" · ").slice(1).join(" · ").trim() : "";
    const label =
      ident.label ?? (nameLabel || (hint.invokeid ? `${chart} (${hint.invokeid.split(".")[0]})` : session.model.name || chart));
    const identity = ident.identity ?? label;
    const incarnation = (identities.get(identity) ?? 0) + 1;
    identities.set(identity, incarnation);
    const id = freeId(slug(ident.id ?? (hint.invokeid ? `${hint.parent?.id}/${hint.invokeid.split(".")[0]}` : nameLabel || chart)));
    const actor: Actor = {
      id,
      chart,
      label,
      role: ident.role ?? (hint.parent ? `${chart}, invoked by ${hint.parent.actor.label}` : chart),
      bornAt: now(),
      identity,
      incarnation,
      sessionId: session.sessionId,
    };
    if (hint.parent) actor.parent = hint.parent.id;
    if (hint.invokeid) actor.invokeid = hint.invokeid;
    const s: Sess = {
      id,
      session,
      chart,
      actor,
      inbox: [],
      outbox: [],
      lastValues: new Map(),
      ended: false,
      disposing: false,
      invokeExt: new Map(),
      procExt: new Map(),
    };
    (session as unknown as Record<symbol, boolean>)[OBSERVED] = true;
    sessBySession.set(session, s);
    sessById.set(id, s);
    sessBySessionId.set(session.sessionId, s);
    actors.push(actor);
    opts.onEndpoint?.("actor", actor);
    const spawnCause = hint.parent?.lastStep ?? currentAppCause();
    // committed at once (never held in the parent's outbox): the child's first step may come before the parent's step ends
    const spawn = { id: "", t: now(), type: "spawn", actor: id, ...(hint.parent ? { parent: hint.parent.id } : {}), ...(spawnCause?.id ? { cause: spawnCause.id } : {}) } as Ev;
    commit(spawn);
    s.lastStep = spawn;
    if (hint.parent && hint.invokeid) {
      hint.parent.invokeExt.set(hint.invokeid, id);
      record({ type: "message", from: hint.parent.id, to: id, name: "invoke", summary: hint.src ?? hint.invokeid, invoke: hint.invokeid }, hint.parent);
    }

    // inbound through I/O processors: patch each handle's deliver in place
    for (const [p, io] of priv.ioSessions ?? []) {
      (procOwners.get(p) ?? procOwners.set(p, new Set()).get(p)!).add(id);
      const orig = io.deliver;
      io.deliver = (name, data, origin) => {
        onDeliver(s, p, name, data, origin);
        orig(name, data, origin);
      };
    }
    // custom invokers: patch in place (shared with children through the options)
    const invs = priv.opts?.invokers;
    if (invs)
      for (const [type, fn] of Object.entries(invs)) {
        if ((fn as unknown as Record<symbol, boolean>)[WRAPPED]) continue;
        const wrapped = (ctx: Record<string, unknown>) => wrapInvoke(type, fn, ctx);
        (wrapped as unknown as Record<symbol, boolean>)[WRAPPED] = true;
        invs[type] = wrapped;
      }
    // the loader: remember invoked charts' text (for their purpose comment)
    const o = priv.opts;
    if (o?.loader && !(o.loader as unknown as Record<symbol, boolean>)[WRAPPED]) {
      const load = o.loader;
      const wrappedLoader = (src: string) => {
        const r = load(src);
        if (typeof r === "string") loaded.set(src, r);
        else if (r instanceof Promise) return r.then((t: unknown) => (typeof t === "string" && loaded.set(src, t), t));
        return r;
      };
      (wrappedLoader as unknown as Record<symbol, boolean>)[WRAPPED] = true;
      o.loader = wrappedLoader;
    }
    // application sends
    const origSend = session.send.bind(session);
    session.send = (name: string, data?: unknown) => {
      flushPendings();
      const from = appCtx.at(-1) ?? external(app.id, app.label, app.kind ?? "app");
      const cause = sessById.has(from) ? sessById.get(from)!.lastStep : currentAppCause();
      const m = record({ type: "message", from, to: id, name, ...sum(data), ...(cause ? { cause: cause.id, ...(appCtx.length ? {} : { inferred: true }) } : {}) });
      if (!s.ended && session.status !== "done") s.inbox.push({ name, msg: m });
      origSend(name, data);
    };
    const origDispose = session.dispose.bind(session);
    session.dispose = () => {
      s.disposing = true;
      origDispose();
      if (!s.ended) end(s, "disposed");
    };
    // the clock: see delayed sends being set, cancelled and fired
    const clock = priv.clock;
    const timers = new Map<unknown, TimerRec>();
    priv.clock = {
      now: () => clock.now(),
      defer: (fn) => clock.defer(fn),
      setTimeout: (fn, ms) => {
        if (!busy(s) || s.ended) return clock.setTimeout(fn, ms);
        const rec: TimerRec = { delay: ms, sess: s };
        rec.ev = record({ type: "timer", actor: id, action: "set", delay: ms, due: now() + ms }, s);
        let h: unknown;
        // biome-ignore lint/suspicious/noAssignInExpressions: handle used inside the callback
        h = clock.setTimeout(() => {
          timers.delete(h);
          const prev = s.firing;
          s.firing = rec;
          try {
            fn();
          } finally {
            s.firing = prev;
          }
        }, ms);
        timers.set(h, rec);
        return h;
      },
      clearTimeout: (h) => {
        const rec = timers.get(h);
        if (rec) {
          timers.delete(h);
          if (!s.ended) record({ type: "timer", actor: id, action: "cancel", timer: rec.ev?.id || undefined }, s);
        }
        clock.clearTimeout(h);
      },
    };

    session.addEventListener("microstep", (e) => onMicrostep(s, e));
    session.addEventListener("macrostep", (e) => onMacrostep(s, e));
    session.addEventListener("send", (e) => onSend(s, e.message));
    session.addEventListener("invoke", (e) => onInvoke(s, e));
    session.addEventListener("child", (e) => {
      const node = e.child.model;
      void node;
      const inv = session.invocations.find((i) => i.invokeid === e.invokeid);
      const src = inv?.node.element.getAttribute("src") ?? undefined;
      observe(e.child, { parent: s, invokeid: e.invokeid, ...(src ? { src } : {}) });
    });
    session.addEventListener("done", () => onDone(s));
    session.addEventListener("error", (e) => {
      if (!s.ended) record({ type: "error", actor: id, kind: e.kind, message: clip(e.message, 160) }, s);
    });
    return id;
  }

  const sum = (data: unknown) => {
    const x = summarize(data);
    return x ? { summary: x } : {};
  };
  const currentAppCause = (): Ev | undefined => {
    // inside `as(endpoint, fn)`: an actor's acts follow its last step; an external's are stimuli
    if (appCtx.length) return sessById.get(appCtx.at(-1)!)?.lastStep;
    if (opts.appCause !== "same-tick") return undefined;
    // a send to a processor at this instant that the application is now acting on: it reached the processor
    const p = pendings.findLast((x) => x.t === now() && !x.delivered && x.ev.cause);
    if (p) {
      pendings.splice(pendings.indexOf(p), 1);
      commit(p.ev);
      return p.ev;
    }
    let best: Ev | undefined;
    const since = now() - (opts.appCauseWindowMs ?? 0);
    for (const ev of lastInto.values()) if (ev.t >= since && ev.id && (!best || Number(ev.id.slice(1)) > Number(best.id.slice(1)))) best = ev;
    return best;
  };

  // ── inbound ──
  function onDeliver(s: Sess, p: { type: string; aliases?: readonly string[] }, name: string, data: unknown, origin?: string) {
    if (finished) return;
    flushPendings();
    const alias = aliasOf(p);
    const accepting = !s.ended && s.session.status !== "done";
    // a <send> through the same processor that this delivery completes?
    const match = pendings.find(
      (x) => x.alias === alias && x.name === name && (x.data === data || (isNil(x.data) && isNil(data))) && now() <= x.t + window,
    );
    if (match) {
      match.delivered++;
      const m: Ev = { id: "", t: now(), type: "message", from: match.from, to: s.id, name, ...sum(data), channel: alias, ...match.extra };
      if (now() > match.t) m.sentAt = match.t;
      if (match.ev.cause) m.cause = match.ev.cause;
      if (match.ev.via) m.via = match.ev.via;
      if (busy(match.sess) && !match.ev.cause) match.sess.outbox.push(m);
      else commit(m);
      if (accepting) s.inbox.push({ name, msg: m });
      return;
    }
    let procSide = false;
    let from = appCtx.at(-1) ?? opts.resolveOrigin?.(alias, origin, { to: s.id, name });
    if (!from) {
      const bySession = origin ? (sessBySessionId.get(origin.replace(/^#_scxml_/, "")) ?? undefined) : undefined;
      if (bySession) from = bySession.id;
      else if (origin && /^[\w.-]{1,24}$/.test(origin) && !sessById.has(origin)) from = external(origin, `${origin} (via ${alias})`, alias);
      else {
        from = procExternal(s, p);
        procSide = true;
      }
    } else if (!sessById.has(from)) external(from, `${from} (via ${alias})`, alias);
    // cause: a reply to what this actor last sent there, else to the newest message into it (inferred)
    let cause: Ev | undefined;
    let inferred = false;
    const fs = sessById.get(from);
    if (fs) cause = fs.lastStep;
    else if (appCtx.length) cause = currentAppCause();
    else {
      cause = lastFromTo.get(`${s.id}|${from}`) ?? lastInto.get(from);
      inferred = !!cause;
    }
    const m = record({
      type: "message",
      from,
      to: s.id,
      name,
      ...sum(data),
      channel: alias,
      ...(cause?.id ? { cause: cause.id } : {}),
      ...(inferred ? { inferred: true } : {}),
      ...(accepting ? {} : { dropped: true }),
    });
    if (procSide) tagProc(m, p, "from");
    if (accepting) s.inbox.push({ name, msg: m });
  }
  const isNil = (v: unknown) => v === undefined || v === null;

  // ── outbound ──
  function onSend(s: Sess, m: { event: string; target: string; type: string; data: unknown; sendid?: string }) {
    if (finished || s.ended) return;
    const timer = s.firing;
    const extra: Record<string, unknown> = {};
    if (timer) {
      extra.delay = timer.delay;
      if (timer.ev?.id) extra.timer = timer.ev.id;
    }
    if (m.sendid && !/^session/.test(m.sendid)) extra.sendid = m.sendid;
    const causeFromTimer = timer?.ev?.cause ? { cause: timer.ev.cause } : {};
    if (isScxmlType(m.type)) {
      const t = m.target;
      let to: Sess | undefined;
      let toExt: string | undefined;
      if (t === "" || t === "#_internal") to = s;
      else if (t === "#_parent") {
        to = s.actor.parent ? sessById.get(s.actor.parent) : undefined;
        if (!to) toExt = external("parent", "the parent (not observed)", "external");
      } else if (t.startsWith("#_scxml_")) {
        to = sessBySessionId.get(t.slice(8));
        if (!to) toExt = external("scxml", "other SCXML sessions", "external");
      } else if (t.startsWith("#_")) {
        const ep = s.invokeExt.get(t.slice(2));
        if (ep && sessById.has(ep)) to = sessById.get(ep);
        else toExt = ep ?? external("scxml", "other SCXML sessions", "external");
      } else toExt = external("scxml", "other SCXML sessions", "external");
      const ev = record(
        {
          type: "message",
          from: s.id,
          to: to ? to.id : toExt!,
          name: m.event,
          ...sum(m.data),
          ...(t === "#_internal" ? { internal: true } : {}),
          ...extra,
          ...causeFromTimer,
        },
        timer ? undefined : s,
      );
      if (to && t !== "#_internal" && !to.ended && to.session.status !== "done") to.inbox.push({ name: m.event, msg: ev });
      return;
    }
    // a custom I/O processor: who receives it is decided by the deliveries that follow
    const p = (s.session as unknown as { processors?: Map<string, { type: string; aliases?: readonly string[] }> }).processors?.get(m.type);
    const alias = p ? aliasOf(p) : m.type;
    const procExt = p ? procExternal(s, p) : external(alias, alias, "processor");
    const ev: Ev = {
      id: "",
      t: now(),
      type: "message",
      from: s.id,
      to: procExt,
      name: m.event,
      ...sum(m.data),
      ...(m.target ? { target: clip(m.target, 60) } : {}),
      ...extra,
      ...causeFromTimer,
    };
    tagProc(ev, p, "to");
    const pending: Pending = { from: s.id, sess: s, alias, procExt, name: m.event, data: m.data, t: now(), delivered: 0, extra, ev };
    if (timer && !ev.cause && s.lastStep) ev.cause = s.lastStep.id;
    pendings.push(pending);
    if (busy(s) && !timer) s.outbox.push({ __pending: pending });
  }

  // ── invokes ──
  function onInvoke(s: Sess, e: { invokeid: string; invokeType: string; state: { id: string } }) {
    invoking = s;
    if (SCXML_TYPES.has(e.invokeType) || e.invokeType === "scxml") return; // the child event does the rest
    const ext = external(extName(e.invokeType), `${e.invokeType} (invoked service)`, "service");
    s.invokeExt.set(e.invokeid, ext);
    record({ type: "message", from: s.id, to: ext, name: "invoke", summary: e.invokeid, invoke: e.invokeid }, s);
  }
  function wrapInvoke(type: string, fn: (ctx: Record<string, unknown>) => unknown, ctx: Record<string, unknown>) {
    const parent = invoking;
    const invokeid = String(ctx.invokeid);
    const ext = external(extName(type), `${type} (invoked service)`, "service");
    if (parent) {
      const toParent = (name: string, data: unknown) => {
        if (finished || parent.ended) return;
        const active = parent.session.invocations.some((i) => i.invokeid === invokeid);
        const cause = lastFromTo.get(`${parent.id}|${ext}`);
        const m = record({
          type: "message",
          from: ext,
          to: parent.id,
          name,
          ...sum(data),
          invoke: invokeid,
          ...(cause ? { cause: cause.id, inferred: true } : {}),
          ...(active ? {} : { dropped: true }),
        });
        if (active) parent.inbox.push({ name, msg: m });
      };
      const send = ctx.sendToParent as (n: string, d?: unknown) => void;
      const done = ctx.done as (d?: unknown) => void;
      ctx.sendToParent = (name: string, data?: unknown) => {
        toParent(name, data);
        send(name, data);
      };
      ctx.done = (data?: unknown) => {
        toParent(`done.invoke.${invokeid}`, data);
        done(data);
      };
    }
    const r = fn(ctx);
    const wrapService = (svc: { send(ev: unknown): void; cancel(): void }) => {
      if (!parent || !svc) return svc;
      const cancel = svc.cancel.bind(svc);
      svc.cancel = () => {
        if (!parent.ended) record({ type: "message", from: parent.id, to: ext, name: "cancel", invoke: invokeid }, parent);
        cancel();
      };
      return svc;
    };
    return r instanceof Promise ? r.then(wrapService) : wrapService(r as { send(ev: unknown): void; cancel(): void });
  }

  // ── steps ──
  function takeInbox(s: Sess, name: string, consume: boolean): InboxEntry | undefined {
    const i = s.inbox.findIndex((x) => x.name === name);
    if (i < 0) return undefined;
    const entry = s.inbox[i]!;
    if (consume) s.inbox.splice(0, i + 1);
    return entry;
  }
  function onMicrostep(s: Sess, e: { event?: { name: string; type: string }; exited: { id: string }[]; entered: { id: string }[]; transitions: { source: unknown; targets: unknown[] }[] }) {
    if (finished || s.ended) return;
    const ev = e.event;
    let trigger: Ev | undefined;
    let inferred = false;
    if (!ev) trigger = s.lastStep;
    else if (ev.type === "external") {
      if (!s.macroTrigger || s.macroTrigger.name !== ev.name) s.macroTrigger = takeInbox(s, ev.name, false);
      trigger = s.macroTrigger?.msg;
      if (!trigger) {
        trigger = s.lastStep;
        inferred = true;
      }
    } else trigger = s.lastStep;
    const root = s.session.model.root;
    const src = e.transitions[0]?.source as { id: string } | undefined;
    const step: Ev = {
      id: "",
      t: now(),
      type: "transition",
      actor: s.id,
      event: ev?.name ?? "",
      from: e.exited.map((x) => x.id),
      to: e.entered.map((x) => x.id),
      ...(src ? { source: src === (root as unknown) ? "__root__" : src.id } : {}),
      ...(ev ? { eventType: ev.type } : {}),
      ...(trigger?.id ? { cause: trigger.id } : {}),
      ...(inferred && trigger ? { inferred: true } : {}),
    };
    if (!e.exited.length && !e.entered.length) step.targetless = true;
    commit(step);
    s.lastStep = step;
    s.microCfg = s.session.activeStateIds();
    flushOutbox(s, step);
  }
  function onMacrostep(s: Sess, e: { event?: { name: string; type: string } }) {
    if (finished || s.ended) return;
    if (e.event && e.event.type === "external") {
      takeInbox(s, e.event.name, true);
      s.macroTrigger = undefined;
    }
    flushOutbox(s);
    const active = s.session.activeStateIds();
    const key = active.join(" ");
    if (key !== s.lastCfgKey) {
      record({ type: "config", actor: s.id, active, ...(s.lastStep ? { cause: s.lastStep.id } : {}) });
      s.lastCfgKey = key;
    }
    snapshot(s);
  }
  function snapshot(s: Sess) {
    if (!s.session.model.allData.length) return;
    let raw: Record<string, unknown>;
    try {
      raw = s.session.snapshot();
    } catch {
      return;
    }
    const values: Record<string, unknown> = {};
    for (const d of s.session.model.allData) {
      const k = d.getAttribute("id")!;
      values[k] = truncFit(raw[k]);
    }
    const j = JSON.stringify(values);
    if (j === s.lastSnap) return;
    const first = s.lastSnap === undefined;
    s.lastSnap = j;
    const cause = s.lastStep ? { cause: s.lastStep.id } : {};
    for (const [k, v] of Object.entries(values)) {
      const vj = JSON.stringify(v);
      if (s.lastValues.get(k) !== vj) {
        if (!first) record({ type: "data", actor: s.id, key: k, summary: short(raw[k]), value: v, ...cause });
        s.lastValues.set(k, vj);
      }
    }
    record({ type: "snapshot", actor: s.id, values, ...cause });
    // types learned from the run, for declarations whose expr did not say
    const decls = charts[s.chart]?.datamodel ?? [];
    for (const d of decls) if ((d.type === "unknown" || d.type === "null") && raw[d.id] !== undefined && raw[d.id] !== null) d.type = typeOfValue(raw[d.id]);
  }
  function onDone(s: Sess) {
    if (s.ended) return;
    flushOutbox(s);
    const cfg = s.microCfg;
    if (cfg && cfg.join(" ") !== s.lastCfgKey) {
      record({ type: "config", actor: s.id, active: cfg, ...(s.lastStep ? { cause: s.lastStep.id } : {}) });
      s.lastCfgKey = cfg.join(" ");
    }
    const reason = s.session.cancelled ? (s.disposing ? "disposed" : "cancelled") : "done";
    // the parent hears done.invoke.<id> when its child reached a final state
    const parent = s.actor.parent ? sessById.get(s.actor.parent) : undefined;
    if (reason === "done" && parent && s.actor.invokeid && !parent.ended) {
      const active = parent.session.invocations.some((i) => i.invokeid === s.actor.invokeid);
      if (active) {
        const m = record({ type: "message", from: s.id, to: parent.id, name: `done.invoke.${s.actor.invokeid}`, ...(s.lastStep ? { cause: s.lastStep.id } : {}) });
        parent.inbox.push({ name: String(m.name), msg: m });
      }
    }
    end(s, reason);
  }
  function end(s: Sess, reason: string) {
    if (s.ended) return;
    flushOutbox(s);
    // what it sent through processors that nobody has received yet went to the processor
    const mine = pendings.filter((p) => p.sess === s);
    for (const p of mine) pendings.splice(pendings.indexOf(p), 1);
    for (const p of mine) if (!p.delivered) commit(p.ev);
    s.ended = true;
    s.actor.diedAt = now();
    const parentStep = s.actor.parent ? sessById.get(s.actor.parent)?.lastStep : undefined;
    const cause = reason === "cancelled" && parentStep ? parentStep : s.lastStep;
    commit({ id: "", t: now(), type: "end", actor: s.id, reason, ...(cause ? { cause: cause.id } : {}) } as Ev);
  }

  // ── stories: episodes derived from causality ──
  function deriveStories(evs: Ev[]): Story[] {
    const byId = new Map(evs.map((e) => [e.id, e]));
    const children = new Map<string, Ev[]>();
    for (const e of evs) if (e.cause) (children.get(e.cause) ?? children.set(e.cause, []).get(e.cause)!).push(e);
    const isExt = (x: unknown) => externals.has(String(x));
    const roots = evs.filter((e) => e.type === "message" && isExt(e.from) && !e.cause && !e.dropped);
    const label = (x: unknown) => sessById.get(String(x))?.actor.label ?? externals.get(String(x))?.label ?? String(x);
    const episodes = roots.map((r) => {
      const seen: Ev[] = [];
      const stack = [r];
      while (stack.length && seen.length < 400) {
        const e = stack.pop()!;
        seen.push(e);
        for (const c of children.get(e.id) ?? []) if (c.type !== "snapshot" && c.type !== "config") stack.push(c);
      }
      seen.sort((a, b) => a.t - b.t || Number(a.id.slice(1)) - Number(b.id.slice(1)));
      const who = new Set(seen.flatMap((e) => [e.actor, e.type === "message" ? e.to : undefined].filter(Boolean) as string[]));
      return { r, seen, actors: who.size };
    });
    const picked = episodes
      .filter((x) => x.seen.length >= 4 && x.actors >= 1)
      .sort((a, b) => b.actors - a.actors || b.seen.length - a.seen.length)
      .slice(0, 12)
      .sort((a, b) => a.r.t - b.r.t);
    void byId;
    return picked.map(({ r, seen }, i) => {
      // group by consecutive actor, at most 9 groups (merge the shortest neighbours)
      type G = { actor: string; evs: Ev[] };
      const groups: G[] = [];
      for (const e of seen) {
        if (e.type === "timer" || e.type === "data") {
          groups.at(-1)?.evs.push(e);
          continue;
        }
        const actor = String(e.type === "message" ? e.from : e.actor);
        const g = groups.at(-1);
        if (g && g.actor === actor) g.evs.push(e);
        else groups.push({ actor, evs: [e] });
      }
      while (groups.length > 9) {
        let k = 0;
        for (let j = 1; j < groups.length - 1; j++) if (groups[j]!.evs.length < groups[k]!.evs.length) k = j;
        const into = k > 0 ? k - 1 : k + 1;
        const [a, b] = into < k ? [groups[into]!, groups[k]!] : [groups[k]!, groups[into]!];
        a.evs.push(...b.evs);
        groups.splice(groups.indexOf(b), 1);
      }
      while (groups.length < 4 && groups.some((g) => g.evs.length > 1)) {
        const g = groups.reduce((x, y) => (y.evs.length > x.evs.length ? y : x));
        const half = Math.ceil(g.evs.length / 2);
        groups.splice(groups.indexOf(g) + 1, 0, { actor: g.actor, evs: g.evs.splice(half) });
      }
      const steps: StoryStep[] = groups.map((g) => {
        // what each participant does in this step, in order: "Order: moves to received, sends lookup to crm; payment: …"
        const byActor: { actor: string; parts: string[] }[] = [];
        for (const e of g.evs) {
          const actor = String(e.type === "message" ? e.from : e.actor);
          let part: string | undefined;
          if (e.type === "message") part = `sends ${e.name} to ${label(e.to)}`;
          else if (e.type === "transition" && (e.to as string[]).length) part = `moves to ${(e.to as string[]).at(-1)}`;
          else if (e.type === "transition") part = `handles ${e.event || "a step"}`;
          else if (e.type === "spawn") part = "starts";
          else if (e.type === "end") part = `ends (${e.reason})`;
          if (!part) continue;
          let a = byActor.at(-1);
          if (!a || a.actor !== actor) byActor.push((a = { actor, parts: [] }));
          if (!a.parts.includes(part)) a.parts.push(part);
        }
        const text = clip(
          byActor.map((a) => `${label(a.actor)} ${a.parts.slice(0, 3).join(", ")}${a.parts.length > 3 ? ` (+${a.parts.length - 3})` : ""}`).join("; "),
          200,
        );
        const main = byActor.reduce((x, y) => (y.parts.length > x.parts.length ? y : x), byActor[0] ?? { actor: g.actor, parts: [] });
        return { text, actor: main.actor, events: g.evs.map((e) => e.id), t0: g.evs[0]!.t, t1: g.evs.at(-1)!.t };
      });
      const who = [...new Set(steps.map((s) => label(s.actor)))];
      const dur = (seen.at(-1)!.t - r.t) / 1000;
      return {
        id: `episode-${i + 1}`,
        question: `What happens when ${label(r.from)} sends ${r.name} to ${label(r.to)}?`,
        answer: `${seen.length} events across ${who.length} participant${who.length === 1 ? "" : "s"} (${clip(who.join(", "), 120)}) over ${dur.toFixed(1)} s.`,
        steps,
        derived: true,
      };
    });
  }

  // ── wiring: static sends and invokes, resolved with what the run showed ──
  function deriveWiring(evs: Ev[]): Wire[] {
    const chartOf = new Map(actors.map((a) => [a.id, a.chart]));
    const node = (x: unknown) => chartOf.get(String(x)) ?? String(x);
    const wires = new Map<string, Wire>();
    const add = (w: Wire) => {
      const k = `${w.from}|${w.to}|${w.event}|${w.fromState ?? ""}`;
      if (!wires.has(k)) wires.set(k, w);
    };
    const seen = new Map<string, Set<string>>(); // `${chart}|${name}` → to-nodes
    for (const e of evs)
      if (e.type === "message") {
        const k = `${node(e.from)}|${e.name}`;
        (seen.get(k) ?? seen.set(k, new Set()).get(k)!).add(node(e.to));
      }
    for (const [chart, a] of analyses) {
      const parents = new Set(actors.filter((x) => x.chart === chart && x.parent).map((x) => node(x.parent)));
      for (const snd of a.sends) {
        const ran = seen.get(`${chart}|${snd.event}`);
        let to: string[];
        if (ran?.size) to = [...ran];
        else if (!snd.type || isScxmlType(snd.type)) {
          if (!snd.target) to = [chart];
          else if (snd.target === "#_parent") to = parents.size ? [...parents] : [];
          else if (snd.target === "#_internal") to = [chart];
          else to = [];
        } else {
          const alias = snd.type;
          const named = opts.externalFor?.(alias);
          const ext = named ?? [...externals.keys()].find((x) => x === alias || x === `${alias}@io` || x.startsWith(`${alias}.`)) ?? extName(alias);
          if (!externals.has(ext)) {
            external(ext, `${ext} (I/O processor)`, "processor");
            externals.get(ext)!.unused = true;
          }
          to = [ext];
        }
        for (const t of to) add({ from: chart, to: t, event: snd.event, fromState: snd.state });
      }
      for (const inv of a.invokes) {
        const kidsOf = new Set(actors.filter((x) => x.parent && chartOf.get(x.parent) === chart && x.invokeid).map((x) => x.chart));
        let to: string[];
        if (isScxmlType(inv.type)) to = kidsOf.size ? [...kidsOf] : [];
        else {
          const ext = extName(inv.type);
          if (!externals.has(ext)) {
            external(ext, `${inv.type} (invoked service)`, "service");
            externals.get(ext)!.unused = true;
          }
          to = [ext];
        }
        for (const t of to) add({ from: chart, to: t, event: "invoke", fromState: inv.state });
      }
    }
    for (const e of evs)
      if (e.type === "message" && externals.has(String(e.from))) add({ from: String(e.from), to: node(e.to), event: String(e.name) });
    const counts = new Map<string, number>();
    for (const e of evs) if (e.type === "message") counts.set(`${node(e.from)}|${node(e.to)}|${e.name}`, (counts.get(`${node(e.from)}|${node(e.to)}|${e.name}`) ?? 0) + 1);
    for (const w of wires.values()) w.count = counts.get(`${w.from}|${w.to}|${w.event}`) ?? 0;
    return [...wires.values()];
  }

  return {
    /** The events recorded so far (in recording order). */
    events,
    actors,
    externals,
    charts,
    /** Name an external before it appears (label and kind are kept when the tracer meets it). */
    external(id: string, info: { label: string; kind: string }) {
      presetExternals.set(id, info);
      const x = externals.get(id);
      if (x) Object.assign(x, info);
      return id;
    },
    /** `createSession` → a `createSession` that observes every session it makes. */
    wrapEngine<O, S extends SCXMLSession>(engine: (source: never, options: O) => Promise<S>, hint?: (source: unknown, options: O) => Identity | undefined) {
      return async (source: unknown, options: O): Promise<S> => {
        const s = await engine(source as never, options);
        const purpose = typeof source === "string" ? leadingComment(source) : undefined;
        const h = { ...(purpose ? { purpose } : {}), ...hint?.(source, options) };
        pendingHints.set(s, h);
        observe(s);
        return s;
      };
    },
    /** Observe every session started from now on (patches `SCXMLSession.prototype.start`). Returns an undo. */
    captureAll() {
      const proto = SCXMLSession.prototype as unknown as { start(this: SCXMLSession): SCXMLSession };
      const orig = proto.start;
      proto.start = function (this: SCXMLSession) {
        if (!finished && !(this as unknown as Record<symbol, boolean>)[OBSERVED]) observe(this);
        return orig.call(this);
      };
      return () => {
        proto.start = orig;
      };
    },
    /** Observe a session made elsewhere (before `start()`, to see its first step). */
    observe: (session: SCXMLSession) => observe(session),
    /** The actor id of a session. */
    actorOf: (session: SCXMLSession) => sessBySession.get(session)?.id,
    /** Attribute what application code sends inside `fn` (`session.send`, I/O deliveries) to an endpoint. */
    as<T>(endpoint: string, fn: () => T): T {
      if (!sessById.has(endpoint)) external(endpoint);
      appCtx.push(endpoint);
      try {
        return fn();
      } finally {
        appCtx.pop();
      }
    },
    caption(text: string) {
      commit({ id: "", t: now(), type: "caption", text } as Ev);
    },
    /** Flush pending sends (a live view calls this when the clock moves). */
    flush: () => flushPendings(true),
    /** Stop recording; sessions still running keep no `diedAt`. */
    finish(extra: { duration?: number; stories?: boolean } = {}): Trace {
      flushPendings(true);
      for (const s of sessById.values()) flushOutbox(s);
      finished = true;
      const evs = events.slice().sort((a, b) => a.t - b.t);
      // a pending send emitted late sorts after its same-instant peers: causes stay earlier
      const pos = new Map(evs.map((e, i) => [e.id, i]));
      for (const e of evs) {
        if (e.cause && !(pos.get(e.cause)! < pos.get(e.id)!)) delete e.cause;
        if (e.via && !pos.has(String(e.via))) delete e.via;
      }
      // processors private to one session each (a client's own tools): one external per session
      for (const [alias, list] of procInstances) {
        if (list.length < 2 || !list.every((p) => procOwners.get(p)?.size === 1)) continue;
        const owner = new Map(list.map((p) => [p, [...procOwners.get(p)!][0]!]));
        const merged = new Set<string>();
        for (const e of evs) {
          const tag = (e as unknown as { _proc?: { p: object; side: "from" | "to" } })._proc;
          const o = tag && owner.get(tag.p);
          if (!tag || !o) continue;
          const old = String(e[tag.side]);
          if (opts.externalFor?.(alias) === old) continue;
          merged.add(old);
          const nid = extName(`${alias}.${o}`);
          if (!externals.has(nid)) {
            const base = externals.get(old);
            external(nid, `${alias} of ${sessById.get(o)?.actor.label ?? o}`, base?.kind ?? "processor");
          }
          e[tag.side] = nid;
        }
        for (const id of merged) if (!evs.some((e) => e.type === "message" && (e.from === id || e.to === id))) externals.delete(id);
      }
      const trace: Trace = {
        system: opts.system,
        scenario: opts.scenario ?? "run",
        duration: extra.duration ?? now(),
        version: 3,
        recorder: RECORDER,
        charts,
        actors,
        externals: [],
        wiring: [],
        events: evs,
      };
      trace.wiring = deriveWiring(evs);
      trace.externals = [...externals.values()];
      if (extra.stories !== false) {
        const stories = deriveStories(evs);
        if (stories.length) trace.stories = stories;
      }
      return trace;
    },
  };
}
const pendingHints = new WeakMap<object, Identity>();

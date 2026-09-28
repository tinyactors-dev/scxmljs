/**
 * Compiles an `<scxml>` DOM element into an immutable, validated model.
 *
 * The model keeps a reference to every source element, so renderers can map
 * live state back onto the document. Validation follows the constraints of
 * spec §3 (ids, targets, initial states, history, executable content);
 * a non-conformant document raises `SCXMLValidationError` listing every problem.
 */
import { type Diagnostic, lint } from "./diagnostics.ts";
import { SCXML_NS } from "./events.ts";

/** The element a state node was compiled from (`scxml` is the root). */
export type StateKind = "scxml" | "state" | "parallel" | "final" | "history";

/**
 * A state of a compiled chart. Every node keeps its source `element`, so
 * renderers can map live state back onto the document.
 */
export interface StateNode {
  /** Which element it is. */
  kind: StateKind;
  /** The `id` attribute, or a generated one (see `generatedId`). */
  id: string;
  /** True when the author omitted `id` and one was generated (spec §3.14). */
  generatedId: boolean;
  /** The source element (`<state>`, `<parallel>`, …). */
  element: Element;
  /** The containing state; `null` for the root. */
  parent: StateNode | null;
  /** `<state>`, `<parallel>` and `<final>` children — spec `getChildStates`. */
  children: StateNode[];
  /** `<history>` children. */
  history: StateNode[];
  /** Document order. */
  order: number;
  /** Nesting depth: the root is 0. */
  depth: number;
  /** Its `<transition>`s, in document order. */
  transitions: TransitionNode[];
  /** Each `<onentry>` / `<onexit>` element is a separate executable block. */
  onentry: Element[];
  /** The `<onexit>` blocks, in document order. */
  onexit: Element[];
  /** Its `<invoke>`s, in document order. */
  invokes: InvokeNode[];
  /** `<data>` elements of this state's own `<datamodel>`. */
  data: Element[];
  /** Initial transition, for compound states and `<scxml>`. */
  initial: TransitionNode | null;
  /** For `<history>` nodes: whether it remembers only direct children (`shallow`) or the full descendant configuration (`deep`). */
  historyType?: "shallow" | "deep";
  /** For `<final>` states: the `<donedata>` element, if any. */
  donedata: Element | null;
}

/** A transition of a compiled chart. */
export interface TransitionNode {
  /** `null` for initial transitions synthesised from an `initial` attribute or default. */
  element: Element | null;
  /** The state it belongs to. */
  source: StateNode;
  /** The event descriptors of the `event` attribute (empty for eventless transitions). */
  events: string[];
  /** The `cond` expression, or `null`. */
  cond: string | null;
  /** The targets (empty for targetless transitions). */
  targets: StateNode[];
  /** The `type` attribute: `internal` doesn't exit its source state when the targets are its descendants. */
  type: "internal" | "external";
  /** Document order. */
  order: number;
}

/** An `<invoke>` of a compiled chart. */
export interface InvokeNode {
  /** The `<invoke>` element. */
  element: Element;
  /** The state it belongs to (invoked while that state is active). */
  state: StateNode;
  /** Document order. */
  order: number;
  /** The `autoforward` attribute: external events are forwarded to the invoked service. */
  autoforward: boolean;
  /** The `<finalize>` element, if any. */
  finalize: Element | null;
}

/** A compiled, validated chart. Sessions only read it, so one model can serve many sessions. */
export interface Model {
  /** The SCXML namespace the document uses. */
  ns: string | null;
  /** The `<scxml>` element's node. */
  root: StateNode;
  /** All states (including history and the root) in document order. */
  states: StateNode[];
  /** States by id (generated ids included). */
  byId: Map<string, StateNode>;
  /** States by source element. */
  byElement: Map<Element, StateNode>;
  /** Transitions by source `<transition>` element. */
  transitionsByElement: Map<Element, TransitionNode>;
  /** The `<scxml name>` attribute (`""` when absent). */
  name: string;
  /** The `binding` attribute: when `<data>` is initialised. */
  binding: "early" | "late";
  /** `<script>` children of `<scxml>`. */
  scripts: Element[];
  /** Every `<data>` element, document order. */
  allData: Element[];
  /** Pre-loaded `src` contents for `<script src>` and `<data src>` (value: text, or an Error). */
  resources: Map<Element, string | Error>;
  /** Likely mistakes that are still valid SCXML (see `Diagnostic`); empty for most charts. */
  warnings: Diagnostic[];
}

/** The document isn't valid SCXML. `problems` lists every problem found. */
export class SCXMLValidationError extends Error {
  /** Always `"SCXML_INVALID"`. */
  readonly code = "SCXML_INVALID" as const;
  /** Every problem found, one line each (they are also listed in `message`). */
  readonly problems: string[];
  /** @param problems every problem found, one line each */
  constructor(problems: string[]) {
    super(`Invalid SCXML document:\n  - ${problems.join("\n  - ")}`);
    this.problems = problems;
    this.name = "SCXMLValidationError";
  }
}

/** SCXML text couldn't be parsed (or there is no `DOMParser` to parse it with). */
export class SCXMLParseError extends Error {
  /**
   * @param code `SCXML_PARSE`: the text isn't well-formed XML (or has no `<scxml>` root);
   *   `SCXML_NO_DOMPARSER`: there is no `DOMParser` (outside browsers: pass `domParser`).
   */
  constructor(
    readonly code: "SCXML_PARSE" | "SCXML_NO_DOMPARSER",
    message: string,
  ) {
    super(message);
    this.name = "SCXMLParseError";
  }
}

/** Resolves `src` attributes (`<script>`, `<data>`, `<invoke>`) to their text; may be synchronous. */
export type Loader = (src: string) => string | Promise<string>;

const EXECUTABLE = new Set(["raise", "if", "elseif", "else", "foreach", "log", "assign", "script", "send", "cancel"]);

// ─────────────────────────────── queries ───────────────────────────────

/** A state without child states (or a `<final>`). */
export const isAtomic = (s: StateNode) => s.kind === "final" || (s.kind === "state" && s.children.length === 0);
/** A `<state>` with child states. */
export const isCompound = (s: StateNode) => s.kind === "state" && s.children.length > 0;
export const isCompoundOrRoot = (s: StateNode) => s.kind === "scxml" || isCompound(s);

/** True when `a` is a proper descendant of `b`. */
export function isDescendant(a: StateNode, b: StateNode): boolean {
  for (let p = a.parent; p; p = p.parent) if (p === b) return true;
  return false;
}

/** Ancestors of `s` up to (excluding) `upTo`; with `upTo = null`, up to and including the root. */
export function properAncestors(s: StateNode, upTo: StateNode | null): StateNode[] {
  const out: StateNode[] = [];
  for (let p = s.parent; p && p !== upTo; p = p.parent) out.push(p);
  return out;
}

/** A comparator for `Array.sort`: document order. */
export const documentOrder = (a: { order: number }, b: { order: number }) => a.order - b.order;
export const exitOrder = (a: { order: number }, b: { order: number }) => b.order - a.order;

/** SCXML-namespace child elements (foreign elements are ignored everywhere). */
export function scxmlChildren(el: Element, ns: string | null): Element[] {
  return Array.from(el.children).filter((c) => c.namespaceURI === ns);
}

// ─────────────────────────────── compile ───────────────────────────────

/**
 * Compile an `<scxml>` element. `src` attributes on `<script>` and `<data>`
 * are fetched with `loader`; the result is synchronous when the loader is.
 */
export function compile(root: Element, opts: { loader?: Loader } = {}): Model | Promise<Model> {
  const model = build(root);
  const pending: Promise<void>[] = [];
  for (const el of [...model.scripts, ...scriptsIn(model), ...model.allData]) {
    const src = el.getAttribute("src");
    if (src == null) continue;
    if (!opts.loader) {
      model.resources.set(el, new Error(`no loader to fetch "${src}"`));
      continue;
    }
    try {
      const r = opts.loader(src);
      if (typeof r === "string") model.resources.set(el, r);
      else
        pending.push(
          r.then(
            (text) => void model.resources.set(el, text),
            (e) => void model.resources.set(el, toError(e)),
          ),
        );
    } catch (e) {
      model.resources.set(el, toError(e));
    }
  }
  const finish = () => {
    // a <script src> that cannot be fetched makes the document invalid (spec §5.8)
    const bad = [...model.resources].filter(([el, v]) => el.localName === "script" && v instanceof Error);
    if (bad.length)
      throw new SCXMLValidationError(bad.map(([el, v]) => `<script src="${el.getAttribute("src")}">: ${(v as Error).message}`));
    return model;
  };
  return pending.length ? Promise.all(pending).then(finish) : finish();
}

function scriptsIn(model: Model): Element[] {
  const out: Element[] = [];
  const walk = (el: Element) => {
    for (const c of scxmlChildren(el, model.ns)) {
      if (c.localName === "script" && el !== model.root.element) out.push(c);
      if (c.localName !== "content") walk(c); // don't descend into inline child documents
    }
  };
  walk(model.root.element);
  return out;
}

function toError(e: unknown) {
  return e instanceof Error ? e : new Error(String(e));
}

function build(rootEl: Element): Model {
  const problems: string[] = [];
  const ns = rootEl.namespaceURI;
  if (rootEl.localName !== "scxml") throw new SCXMLValidationError([`root element is <${rootEl.localName}>, expected <scxml>`]);
  if (ns !== SCXML_NS) problems.push(`<scxml> must be in the namespace ${SCXML_NS} (found ${ns ?? "none"})`);
  const dm = rootEl.getAttribute("datamodel");
  // "null" (spec B.1) is a subset: its only expressions are In(), which the ECMAScript engine evaluates
  if (dm != null && dm !== "ecmascript" && dm !== "null") problems.push(`unsupported datamodel "${dm}" (supported: "ecmascript", "null")`);
  if (dm === "null") {
    const forbidden = ["data", "assign", "script", "foreach"];
    for (const name of forbidden)
      if (rootEl.getElementsByTagNameNS(SCXML_NS, name).length) problems.push(`<${name}> is not available in the null data model`);
  }
  const binding = rootEl.getAttribute("binding") ?? "early";
  if (binding !== "early" && binding !== "late") problems.push(`invalid binding "${binding}"`);

  let order = 0;
  const states: StateNode[] = [];
  const byElement = new Map<Element, StateNode>();
  const transitionsByElement = new Map<Element, TransitionNode>();
  const allData: Element[] = [];
  const kids = (el: Element) => scxmlChildren(el, ns);
  const pendingTargets: { t: TransitionNode; attr: string; where: string }[] = [];

  const makeState = (el: Element, kind: StateKind, parent: StateNode | null): StateNode => {
    const s: StateNode = {
      kind,
      id: el.getAttribute("id") ?? "",
      generatedId: false,
      element: el,
      parent,
      children: [],
      history: [],
      order: order++,
      depth: parent ? parent.depth + 1 : 0,
      transitions: [],
      onentry: [],
      onexit: [],
      invokes: [],
      data: [],
      initial: null,
      donedata: null,
    };
    states.push(s);
    byElement.set(el, s);
    const where = () => `<${el.localName}${s.id ? ` id="${s.id}"` : ""}>`;

    if (kind === "history") {
      const type = el.getAttribute("type") ?? "shallow";
      if (type !== "shallow" && type !== "deep") problems.push(`${where()}: invalid history type "${type}"`);
      s.historyType = type === "deep" ? "deep" : "shallow";
    }

    for (const c of kids(el)) {
      const name = c.localName;
      switch (name) {
        case "state":
        case "parallel":
        case "final":
          if (kind === "final" || kind === "history") problems.push(`${where()} cannot contain <${name}>`);
          s.children.push(makeState(c, name, s));
          break;
        case "history":
          if (kind !== "state" && kind !== "parallel") problems.push(`${where()} cannot contain <history>`);
          s.history.push(makeState(c, "history", s));
          break;
        case "transition": {
          if (kind === "final" || kind === "scxml") problems.push(`${where()} cannot contain <transition>`);
          const t = makeTransition(c, s);
          s.transitions.push(t);
          checkExecutable(c, `${where()} <transition>`);
          break;
        }
        case "initial": {
          order++;
          const ts = kids(c).filter((x) => x.localName === "transition");
          if (ts.length !== 1) problems.push(`${where()} <initial> must contain exactly one <transition>`);
          if (ts[0]) {
            const t = makeTransition(ts[0], s);
            if (t.events.length || t.cond) problems.push(`${where()} <initial> transition must not have event or cond`);
            if (!ts[0].getAttribute("target")) problems.push(`${where()} <initial> transition needs a target`);
            if (s.initial) problems.push(`${where()} has more than one initial specification`);
            t.type = "internal"; // same object: its targets are resolved below
            s.initial = t;
            checkExecutable(ts[0], `${where()} <initial>`);
          }
          break;
        }
        case "onentry":
          order++;
          s.onentry.push(c);
          checkExecutable(c, `${where()} <onentry>`);
          break;
        case "onexit":
          order++;
          s.onexit.push(c);
          checkExecutable(c, `${where()} <onexit>`);
          break;
        case "datamodel":
          order++;
          for (const d of kids(c)) {
            if (d.localName !== "data") {
              problems.push(`<datamodel> may only contain <data>, found <${d.localName}>`);
              continue;
            }
            order++;
            if (!d.getAttribute("id")) problems.push(`<data> requires an id`);
            const sources = ["expr", "src"].filter((a) => d.hasAttribute(a)).length + (hasContent(d) ? 1 : 0);
            if (sources > 1) problems.push(`<data id="${d.getAttribute("id")}"> may have only one of expr, src, or content`);
            s.data.push(d);
            allData.push(d);
          }
          break;
        case "invoke":
          if (kind === "scxml" || kind === "final" || kind === "history") problems.push(`${where()} cannot contain <invoke>`);
          s.invokes.push(makeInvoke(c, s));
          break;
        case "donedata":
          if (kind !== "final") problems.push(`<donedata> is only allowed in <final>`);
          s.donedata = c;
          break;
        case "script":
          if (kind !== "scxml") problems.push(`${where()}: <script> directly inside a state is not allowed`);
          checkScript(c);
          order++;
          break;
        default:
          problems.push(`${where()}: unexpected <${name}>`);
      }
    }
    if (kind === "state" && s.children.length === 0 && el.hasAttribute("initial"))
      problems.push(`${where()}: atomic state cannot have an initial attribute`);
    if (kind === "state" && el.hasAttribute("initial") && s.initial)
      problems.push(`${where()}: has both an initial attribute and an <initial> element`);
    if (kind === "history") {
      if (s.transitions.length > 1) problems.push(`${where()} must have at most one <transition>`);
      const t = s.transitions[0];
      if (t && (t.events.length || t.cond)) problems.push(`${where()} default transition must not have event or cond`);
    }
    return s;
  };

  const makeTransition = (el: Element, source: StateNode): TransitionNode => {
    const t: TransitionNode = {
      element: el,
      source,
      events: (el.getAttribute("event") ?? "").split(/\s+/).filter(Boolean),
      cond: el.getAttribute("cond"),
      targets: [],
      type: el.getAttribute("type") === "internal" ? "internal" : "external",
      order: order++,
    };
    const type = el.getAttribute("type");
    if (type != null && type !== "internal" && type !== "external") problems.push(`<transition> has invalid type "${type}"`);
    if (!el.hasAttribute("event") && !el.hasAttribute("cond") && !el.hasAttribute("target") && source.kind !== "history")
      problems.push(`<transition> in "${source.id}" needs at least one of event, cond, or target`);
    const target = el.getAttribute("target");
    if (target != null) pendingTargets.push({ t, attr: target, where: `transition in "${source.id || "(anonymous)"}"` });
    transitionsByElement.set(el, t);
    return t;
  };

  const makeInvoke = (el: Element, state: StateNode): InvokeNode => {
    const o = order++;
    const exclusive = (a: string, b: string) => {
      if (el.hasAttribute(a) && el.hasAttribute(b)) problems.push(`<invoke> may not have both ${a} and ${b}`);
    };
    exclusive("type", "typeexpr");
    exclusive("src", "srcexpr");
    exclusive("id", "idlocation");
    const content = kids(el).filter((c) => c.localName === "content");
    if (content.length > 1) problems.push(`<invoke> may contain at most one <content>`);
    if (content.length && (el.hasAttribute("src") || el.hasAttribute("srcexpr")))
      problems.push(`<invoke> may not have both src and <content>`);
    const params = kids(el).filter((c) => c.localName === "param");
    if (params.length && el.hasAttribute("namelist")) problems.push(`<invoke> may not have both namelist and <param>`);
    const finalize = kids(el).find((c) => c.localName === "finalize") ?? null;
    if (finalize) checkExecutable(finalize, "<finalize>");
    return { element: el, state, order: o, autoforward: el.getAttribute("autoforward") === "true", finalize };
  };

  const checkScript = (el: Element) => {
    if (el.hasAttribute("src") && (el.textContent ?? "").trim()) problems.push(`<script> may not have both src and content`);
  };

  const checkExecutable = (block: Element, where: string) => {
    for (const c of kids(block)) {
      const n = c.localName;
      // the <initial>/<finalize>/<transition> containers hold executable content directly
      if (!EXECUTABLE.has(n)) {
        problems.push(`${where}: <${n}> is not executable content`);
        continue;
      }
      order++;
      if ((n === "elseif" || n === "else") && block.localName !== "if") problems.push(`${where}: <${n}> outside <if>`);
      if ((n === "if" || n === "elseif") && !c.hasAttribute("cond")) problems.push(`${where}: <${n}> requires cond`);
      if (n === "raise" && !c.getAttribute("event")) problems.push(`${where}: <raise> requires event`);
      if (n === "assign" && !c.getAttribute("location")) problems.push(`${where}: <assign> requires location`);
      if (n === "foreach" && (!c.hasAttribute("array") || !c.hasAttribute("item")))
        problems.push(`${where}: <foreach> requires array and item`);
      if (n === "script") checkScript(c);
      if (n === "send") {
        for (const [a, b] of [
          ["event", "eventexpr"],
          ["target", "targetexpr"],
          ["type", "typeexpr"],
          ["id", "idlocation"],
          ["delay", "delayexpr"],
        ])
          if (c.hasAttribute(a!) && c.hasAttribute(b!)) problems.push(`${where}: <send> may not have both ${a} and ${b}`);
        const hasContentEl = kids(c).some((x) => x.localName === "content");
        if (hasContentEl && (c.hasAttribute("namelist") || kids(c).some((x) => x.localName === "param")))
          problems.push(`${where}: <send> may not combine <content> with namelist or <param>`);
        if (hasContentEl && !c.hasAttribute("event") && !c.hasAttribute("eventexpr")) {
          /* allowed: content-only sends to external processors */
        }
      }
      if (n === "cancel" && !c.hasAttribute("sendid") && !c.hasAttribute("sendidexpr"))
        problems.push(`${where}: <cancel> requires sendid or sendidexpr`);
      if (n === "if" || n === "foreach") checkExecutable(c, where);
    }
  };

  const root = makeState(rootEl, "scxml", null);

  // ids: explicit ones must be unique; missing ones are generated
  const byId = new Map<string, StateNode>();
  for (const s of states) {
    if (!s.id) continue;
    if (byId.has(s.id)) problems.push(`duplicate id "${s.id}"`);
    byId.set(s.id, s);
  }
  let gen = 0;
  for (const s of states) {
    if (s.id || s.kind === "scxml") continue;
    let id: string;
    do id = `__${s.kind}${++gen}`;
    while (byId.has(id));
    s.id = id;
    s.generatedId = true;
    byId.set(id, s);
  }

  const resolve = (ids: string, where: string): StateNode[] =>
    ids
      .split(/\s+/)
      .filter(Boolean)
      .flatMap((id) => {
        const s = byId.get(id);
        if (!s || s.kind === "scxml") {
          problems.push(`${where}: unknown target "${id}"`);
          return [];
        }
        return [s];
      });

  for (const { t, attr, where } of pendingTargets) t.targets = resolve(attr, where);

  // initial transitions
  for (const s of states) {
    if (!(s.kind === "scxml" || isCompound(s))) continue;
    const attr = s.element.getAttribute("initial");
    if (attr != null) {
      s.initial = {
        element: null,
        source: s,
        events: [],
        cond: null,
        targets: resolve(attr, `initial of "${s.id || "scxml"}"`),
        type: "internal",
        order: s.order,
      };
    } else if (!s.initial) {
      const first = s.children[0];
      s.initial = { element: null, source: s, events: [], cond: null, targets: first ? [first] : [], type: "internal", order: s.order };
    }
    for (const t of s.initial.targets)
      if (!isDescendant(t, s)) problems.push(`initial target "${t.id}" is not a descendant of "${s.id || "scxml"}"`);
    checkLegalTargets(s.initial.targets, `initial of "${s.id || "scxml"}"`);
  }
  if (root.children.length === 0) problems.push(`<scxml> has no states`);

  // history default transitions
  for (const h of states.filter((s) => s.kind === "history")) {
    const t = h.transitions[0];
    if (!t) {
      problems.push(`history "${h.id}" needs a default <transition>`);
      continue;
    }
    if (!t.targets.length) problems.push(`history "${h.id}" default transition needs a target`);
    for (const target of t.targets) {
      const ok = h.historyType === "deep" ? isDescendant(target, h.parent!) : target.parent === h.parent && target.kind !== "history";
      if (!ok)
        problems.push(
          `history "${h.id}" default target "${target.id}" is not a ${h.historyType === "deep" ? "descendant" : "child"} of its parent`,
        );
    }
  }
  for (const s of states) for (const t of s.transitions) checkLegalTargets(t.targets, `transition in "${s.id}"`);

  function checkLegalTargets(ts: StateNode[], where: string) {
    // no target may be an ancestor of another, and at most one target per compound state (spec §3.11)
    for (const a of ts)
      for (const b of ts) {
        if (a === b) continue;
        if (isDescendant(a, b)) problems.push(`${where}: targets "${b.id}" and "${a.id}" are nested`);
        else if (a.order < b.order) {
          let lca = a.parent;
          while (lca && !isDescendant(b, lca)) lca = lca.parent;
          if (lca && lca.kind !== "parallel") problems.push(`${where}: targets "${a.id}" and "${b.id}" cannot be active together`);
        }
      }
  }

  const scripts = kids(rootEl).filter((c) => c.localName === "script");
  if (problems.length) throw new SCXMLValidationError(problems);

  const model: Model = {
    ns,
    root,
    states,
    byId,
    byElement,
    transitionsByElement,
    name: rootEl.getAttribute("name") ?? "",
    binding: binding === "late" ? "late" : "early",
    scripts,
    allData,
    resources: new Map(),
    warnings: [],
  };
  model.warnings = lint(model);
  return model;
}

function hasContent(el: Element) {
  return el.children.length > 0 || (el.textContent ?? "").trim().length > 0;
}

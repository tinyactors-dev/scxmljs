/**
 * Explorer view-model: everything the explorer shows, computed as plain data
 * from compiled models and live sessions. No DOM, no rendering — so it is
 * testable, and any renderer (this prototype, a React one…) can use it.
 *
 *   System  — machines (the root session and its invoked children, recursively),
 *             external services (I/O processors), and who talks to whom.
 *   Tree    — the state hierarchy of one machine, flattened to visible rows.
 *   Focus   — one compound state: its children, the transitions between them
 *             (merged per pair), and "doors" in and out of the focus.
 *   Events  — what the machine accepts right now, scoped to the focus.
 *
 * Everything is built for large charts: lists are flattened / grouped so a UI
 * can window or collapse them, and nothing is O(n²) in the chart size.
 */
import { type Clock, realClock } from "../clock.ts";
import { nameMatch, SCXML_IOPROCESSOR } from "../events.ts";
import { isAtomic, isCompound, isDescendant, type Model, type StateNode, type TransitionNode } from "../model.ts";
// types only: the explorer must never pull in a data model (and with it QuickJS)
import type { IOProcessor, SCXMLSession as Session } from "../session.ts";

// ───────────────────────────────── helpers ─────────────────────────────────

/** Is `s` the state `ancestor` or inside it? */
export function within(s: StateNode, ancestor: StateNode): boolean {
  return s === ancestor || isDescendant(s, ancestor);
}

/** The child of `focus` that contains `s` (or undefined if `s` is not strictly inside `focus`). */
export function childContaining(focus: StateNode, s: StateNode): StateNode | undefined {
  let n: StateNode | null = s;
  while (n && n.parent !== focus) n = n.parent;
  return n ?? undefined;
}

/** A display label: anonymous states get a readable stand-in. */
export function label(s: StateNode): string {
  if (s.kind === "scxml") return s.element.getAttribute("name") || "machine";
  return s.generatedId ? `(${s.kind})` : s.id;
}

/** Ancestors from the root down to `s` (inclusive), for breadcrumbs. */
export function pathTo(s: StateNode): StateNode[] {
  const out: StateNode[] = [];
  for (let n: StateNode | null = s; n; n = n.parent) out.unshift(n);
  return out;
}

/** How many states are nested inside `s`, at any depth. */
export function descendantCount(s: StateNode): number {
  let n = 0;
  const walk = (x: StateNode) => {
    for (const c of x.children) {
      n++;
      walk(c);
    }
  };
  walk(s);
  return n;
}

/** States that can be a focus: the root, compound states and parallel states. */
export function isContainer(s: StateNode) {
  return s.kind === "scxml" || s.kind === "parallel" || isCompound(s);
}

// ───────────────────────────────── system ─────────────────────────────────

/** One machine of the system: the root session or an invoked child. */
export interface MachineInfo {
  /** The session id (the key in `SystemTracker.machines`). */
  key: string;
  /** The session. */
  session: Session;
  /** The chart's `name` (or a fallback). */
  name: string;
  /** Invoke nesting: 0 for the root. */
  depth: number;
  /** The invoking machine's key, for children. */
  parentKey?: string;
  /** The invocation's id, for children. */
  invokeid?: string;
  /** the state that invoked it */
  invokedFrom?: string;
  /** The session's status. */
  status: "idle" | "running" | "done";
  /** Labels of the active atomic states. */
  activeLeaves: string[];
}

/** An external service: an I/O processor the system talks to. */
export interface ServiceInfo {
  /** The processor's type URI (the key in `SystemTracker.services`). */
  key: string;
  /** Its first alias, or the URI. */
  label: string;
  /** The processor. */
  processor: IOProcessor;
}

/** A connection between two machines, or a machine and a service. */
export interface SystemLink {
  /** Key of the sending side. */
  from: string;
  /** Key of the receiving side. */
  to: string;
  /** `invoke`: parent to child; `message`: events sent along it. */
  kind: "invoke" | "message";
  /** event name → count observed at run time */
  observed: Map<string, number>;
  /** event names declared in the charts (`<send>` with this target/type) */
  declared: Set<string>;
  /** Session-clock time of the last observed message (0 = never). */
  lastAt: number;
}

/** What the last macrostep of any machine did (for a playback bar). */
export interface StepInfo {
  /** The name of the machine that stepped. */
  machine: string;
  /** the event that triggered the macrostep (undefined for the initial step) */
  event?: string;
  /** "source → target" per transition taken */
  moves: string[];
}

/** Options for `SystemTracker`. */
export interface SystemTrackerOptions {
  /** Time source for traffic timestamps; defaults to the root session's clock. */
  clock?: Clock;
}

/**
 * Tracks the whole system of one root session: invoked children (recursively,
 * as they appear), external services, and message traffic between them.
 * Fires "change" (debounced to one per task) whenever something changes.
 * Timestamps come from the session clock, so "recent" stays right when a
 * PlaybackClock is paused, stepped or sped up.
 */
export class SystemTracker extends EventTarget {
  /** Macrosteps taken by any machine in the system (for stepping). */
  stepCount = 0;
  /** What the most recent macrostep of any machine did. */
  lastStep?: StepInfo;
  /** Every machine seen so far, by session id (terminated ones stay, with status `done`). */
  readonly machines = new Map<string, MachineInfo>();
  /** The external services, by type URI. */
  readonly services = new Map<string, ServiceInfo>();
  /** Links by `from→to` key. */
  readonly links = new Map<string, SystemLink>();
  private byAlias = new Map<string, ServiceInfo>();
  /** The time source for traffic timestamps. */
  readonly clock: Clock;
  private pending = false;
  private stops: (() => void)[] = [];

  /**
   * @param root the root session; children are tracked as they're invoked
   * @param processors the I/O processors the session was created with
   */
  constructor(
    /** The root session. */
    readonly root: Session,
    processors: IOProcessor[] = [],
    opts: SystemTrackerOptions = {},
  ) {
    super();
    this.clock = opts.clock ?? root.clock ?? realClock;
    for (const p of processors) {
      const info: ServiceInfo = { key: p.type, label: p.aliases?.[0] ?? p.type, processor: p };
      this.services.set(p.type, info);
      for (const k of [p.type, ...(p.aliases ?? [])]) this.byAlias.set(k, info);
    }
    this.track(root, 0);
  }

  /** Stop listening to every tracked session. */
  dispose() {
    for (const s of this.stops) s();
    this.stops = [];
  }

  /** Machines in invoke-tree order (parents before children). */
  machineList(): MachineInfo[] {
    const out: MachineInfo[] = [];
    const walk = (parentKey: string | undefined) => {
      for (const m of this.machines.values()) {
        if (m.parentKey !== parentKey) continue;
        out.push(m);
        walk(m.key);
      }
    };
    walk(undefined);
    return out;
  }

  /** Did messages flow over this link within the last `windowMs` of session time? */
  isHot(link: SystemLink, windowMs = 1500): boolean {
    return link.lastAt > 0 && this.clock.now() - link.lastAt < windowMs;
  }

  /** Links touching a node, busiest first. */
  linksOf(key: string): SystemLink[] {
    return [...this.links.values()].filter((l) => l.from === key || l.to === key).sort((a, b) => total(b) - total(a));
  }

  private track(session: Session, depth: number, parentKey?: string, invokeid?: string, invokedFrom?: string) {
    const key = session.sessionId;
    const info: MachineInfo = {
      key,
      session,
      name: session.model.name || "machine",
      depth,
      parentKey,
      invokeid,
      invokedFrom,
      status: session.status,
      activeLeaves: [],
    };
    this.machines.set(key, info);
    if (parentKey) this.link(parentKey, key, "invoke", invokeid ? `invoke ${invokeid}` : "invoke", false);
    this.declareSends(session);

    let moves: string[] = [];
    const onStep = (e?: { event?: { name: string } }) => {
      this.stepCount++;
      this.lastStep = { machine: info.name, event: e?.event?.name, moves };
      moves = [];
      refresh();
    };
    const refresh = () => {
      info.status = session.status;
      info.activeLeaves = session.configuration.filter(isAtomic).map(label);
      this.changed();
    };
    const onSend = (e: { message: { event: string; target: string; type: string } }) => {
      const m = e.message;
      if (m.type === SCXML_IOPROCESSOR) {
        if (m.target === "#_parent" && parentKey) this.link(key, parentKey, "message", m.event, true);
        else if (m.target.startsWith("#_") && m.target !== "#_internal") {
          const child = [...this.machines.values()].find((c) => c.parentKey === key && c.invokeid === m.target.slice(2));
          if (child) this.link(key, child.key, "message", m.event, true);
        }
      } else {
        const svc = this.byAlias.get(m.type);
        if (svc) this.link(key, svc.key, "message", m.event, true);
      }
    };
    const onMicro = (e: { event?: { name: string; origintype?: string }; transitions: { source: StateNode; targets: StateNode[] }[] }) => {
      for (const t of e.transitions) moves.push(`${label(t.source)} → ${t.targets.map(label).join(", ") || "↺"}`);
      const ev = e.event;
      if (!ev?.origintype || ev.origintype === SCXML_IOPROCESSOR) return;
      const svc = this.byAlias.get(ev.origintype);
      if (svc) this.link(svc.key, key, "message", ev.name, true);
    };
    const onChild = (e: { invokeid: string; child: Session }) => {
      const from = session.invocations.find((i) => i.invokeid === e.invokeid)?.state;
      this.track(e.child, depth + 1, key, e.invokeid, from ? label(from) : undefined);
    };
    session.addEventListener("macrostep", onStep as never);
    session.addEventListener("done", refresh);
    session.addEventListener("send", onSend as never);
    session.addEventListener("microstep", onMicro as never);
    session.addEventListener("child", onChild as never);
    this.stops.push(() => {
      session.removeEventListener("macrostep", onStep as never);
      session.removeEventListener("done", refresh);
      session.removeEventListener("send", onSend as never);
      session.removeEventListener("microstep", onMicro as never);
      session.removeEventListener("child", onChild as never);
    });
    // children that already exist (tracker attached late)
    for (const inv of session.invocations)
      if (inv.session && !this.machines.has(inv.session.sessionId)) this.track(inv.session, depth + 1, key, inv.invokeid, label(inv.state));
    refresh();
  }

  /** Static knowledge: which services / parents a chart sends to, before anything happened. */
  private declareSends(session: Session) {
    const key = session.sessionId;
    for (const el of Array.from(session.model.root.element.getElementsByTagNameNS(session.model.ns, "send"))) {
      const type = el.getAttribute("type");
      const event = el.getAttribute("event") ?? "(dynamic)";
      if (type && type !== "scxml" && type !== SCXML_IOPROCESSOR) {
        const svc = this.byAlias.get(type);
        if (svc) this.link(key, svc.key, "message", event, false);
      }
    }
  }

  private link(from: string, to: string, kind: SystemLink["kind"], event: string, observed: boolean) {
    const id = `${from}→${to}`;
    let l = this.links.get(id);
    if (!l) {
      l = { from, to, kind, observed: new Map(), declared: new Set(), lastAt: 0 };
      this.links.set(id, l);
    }
    if (observed) {
      l.observed.set(event, (l.observed.get(event) ?? 0) + 1);
      l.lastAt = this.clock.now();
    } else l.declared.add(event);
    this.changed();
  }

  private changed() {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      this.dispatchEvent(new Event("change"));
    });
  }
}

/** The number of messages observed on a link. */
export function total(l: SystemLink) {
  let n = 0;
  for (const c of l.observed.values()) n += c;
  return n;
}

// ────────────────────────────────── tree ──────────────────────────────────

/** One visible row of the state tree. */
export interface TreeRow {
  /** the state */
  node: StateNode;
  /** indentation level (children of the root are 0) */
  depth: number;
  /** the state itself is active */
  active: boolean;
  /** some descendant is active */
  onActivePath: boolean;
  /** it has child states */
  expandable: boolean;
  /** its children are shown */
  expanded: boolean;
  /** number of direct child states */
  childCount: number;
  /** matches the search text */
  match: boolean;
}

/** Input to `treeRows`. */
export interface TreeOptions {
  /** containers whose children are shown */
  expanded: Set<StateNode>;
  /** whether a state is active (usually `session.isActiveNode`) */
  isActive: (s: StateNode) => boolean;
  /** case-insensitive substring over ids; shows matches and their ancestors */
  filter?: string;
  /** only rows on the active path (and their direct children) */
  activeOnly?: boolean;
}

/** Flatten the hierarchy into the rows currently visible (for a windowed list). */
export function treeRows(model: Model, opts: TreeOptions): TreeRow[] {
  const q = opts.filter?.trim().toLowerCase();
  const activePath = new Set<StateNode>();
  for (const s of model.states) if (opts.isActive(s)) for (let n: StateNode | null = s; n; n = n.parent) activePath.add(n);

  // with a filter: keep matches and their ancestors, force-expanded
  let keep: Set<StateNode> | undefined;
  const matches = new Set<StateNode>();
  if (q) {
    keep = new Set();
    for (const s of model.states)
      if (s.kind !== "scxml" && s.kind !== "history" && s.id.toLowerCase().includes(q)) {
        matches.add(s);
        for (let n: StateNode | null = s; n; n = n.parent) keep.add(n);
      }
  }

  const rows: TreeRow[] = [];
  const walk = (s: StateNode, depth: number) => {
    for (const c of s.children) {
      if (keep && !keep.has(c)) continue;
      if (opts.activeOnly && !activePath.has(c) && !activePath.has(s)) continue;
      const expandable = c.children.length > 0;
      const expanded = expandable && (keep ? true : opts.expanded.has(c));
      rows.push({
        node: c,
        depth,
        active: opts.isActive(c),
        onActivePath: activePath.has(c),
        expandable,
        expanded,
        childCount: c.children.length,
        match: matches.has(c),
      });
      if (expanded) walk(c, depth + 1);
    }
  };
  walk(model.root, 0);
  return rows;
}

/** The expansion that shows the active configuration and nothing else ("follow"). */
export function activeExpansion(model: Model, isActive: (s: StateNode) => boolean): Set<StateNode> {
  const out = new Set<StateNode>();
  for (const s of model.states) if (isActive(s) && s.children.length) out.add(s);
  return out;
}

// ────────────────────────────────── focus ─────────────────────────────────

/** The transitions between two children of the focus, merged into one arrow. */
export interface FocusEdge {
  /** the child the transitions start in */
  from: StateNode;
  /** the child they lead into */
  to: StateNode;
  /** every transition merged into this edge */
  transitions: TransitionNode[];
  /** their distinct event descriptors (`ε` for eventless) */
  events: string[];
}

/** Transitions crossing the focus boundary, grouped by the state outside. */
export interface Door {
  /** outside state (exits: target; entries: source) */
  other: StateNode;
  /** the child of the focus involved (exits: source child or the focus itself; entries: target child) */
  child: StateNode;
  /** every transition through this door */
  transitions: TransitionNode[];
  /** their distinct event descriptors */
  events: string[];
}

/** A child of the focus, as the focus view shows it. */
export interface ChildSummary {
  /** the child state */
  node: StateNode;
  /** the child itself is active */
  active: boolean;
  /** it or a descendant is active */
  onActivePath: boolean;
  /** it is (or contains) the focus's initial state */
  initial: boolean;
  /** number of states nested inside it */
  descendants: number;
  /** transitions whose source is inside this child and that stay inside it */
  internal: number;
  /** distinct events this child reacts to (anywhere inside it) */
  events: string[];
  /** `<invoke>`s inside it, at any depth */
  invokes: number;
}

/** Everything the focus view shows for one container state. */
export interface FocusScope {
  /** the focused container (`<scxml>`, compound or parallel) */
  focus: StateNode;
  /** its children, document order */
  children: ChildSummary[];
  /** transitions between children, merged per pair */
  edges: FocusEdge[];
  /** transitions leaving the focus, by target */
  exits: Door[];
  /** transitions entering the focus from outside, by source and target child */
  entries: Door[];
  /** transitions on the focus state itself that keep us inside (targetless or to a child) */
  frame: TransitionNode[];
}

/**
 * One level of the chart around a container: its children, the transitions
 * between them (merged per pair of children, so the view never shows more
 * than one arrow between two boxes), and "doors" for transitions crossing
 * the boundary. Linear in the size of the chart.
 */
export function focusScope(model: Model, focus: StateNode, isActive: (s: StateNode) => boolean): FocusScope {
  const initial = new Set(focus.initial?.targets.map((t) => childContaining(focus, t) ?? t) ?? []);
  const summaries = new Map<StateNode, ChildSummary>();
  for (const c of focus.children)
    summaries.set(c, {
      node: c,
      active: isActive(c),
      onActivePath: false,
      initial: initial.has(c),
      descendants: descendantCount(c),
      internal: 0,
      events: [],
      invokes: 0,
    });
  for (const s of model.states) {
    if (!isActive(s)) continue;
    const c = childContaining(focus, s);
    if (c) summaries.get(c)!.onActivePath = true;
  }

  const edges = new Map<string, FocusEdge>();
  const exits = new Map<StateNode, Door>();
  const entries = new Map<string, Door>();
  const frame: TransitionNode[] = [];
  const eventSets = new Map<StateNode, Set<string>>();

  for (const s of model.states) {
    for (const t of s.transitions) {
      const srcInside = within(s, focus);
      const fromChild = s === focus ? undefined : childContaining(focus, s);
      if (srcInside) {
        const bucket = fromChild ? (eventSets.get(fromChild) ?? eventSets.set(fromChild, new Set()).get(fromChild)!) : undefined;
        for (const e of t.events) bucket?.add(e);
        if (!t.targets.length) {
          if (fromChild) summaries.get(fromChild)!.internal++;
          else frame.push(t);
          continue;
        }
        for (const target of t.targets) {
          if (within(target, focus) && target !== focus) {
            const toChild = childContaining(focus, target)!;
            if (!fromChild) frame.push(t);
            else if (toChild === fromChild) summaries.get(fromChild)!.internal++;
            else addEdge(edges, fromChild, toChild, t);
          } else {
            const door =
              exits.get(target) ??
              exits.set(target, { other: target, child: fromChild ?? focus, transitions: [], events: [] }).get(target)!;
            door.transitions.push(t);
            for (const e of t.events.length ? t.events : ["ε"]) if (!door.events.includes(e)) door.events.push(e);
          }
        }
      } else {
        for (const target of t.targets) {
          if (!within(target, focus) || target === focus) continue;
          const toChild = childContaining(focus, target);
          if (!toChild) continue;
          const key = `${s.id}→${toChild.id}`;
          const door = entries.get(key) ?? entries.set(key, { other: s, child: toChild, transitions: [], events: [] }).get(key)!;
          door.transitions.push(t);
          for (const e of t.events.length ? t.events : ["ε"]) if (!door.events.includes(e)) door.events.push(e);
        }
      }
    }
  }
  for (const c of focus.children) {
    const sum = summaries.get(c)!;
    sum.events = [...(eventSets.get(c) ?? [])].sort();
    let inv = 0;
    const walk = (x: StateNode) => {
      inv += x.invokes.length;
      for (const k of x.children) walk(k);
    };
    walk(c);
    sum.invokes = inv;
  }
  const byCount = (a: { transitions: unknown[] }, b: { transitions: unknown[] }) => b.transitions.length - a.transitions.length;
  return {
    focus,
    children: [...summaries.values()],
    edges: [...edges.values()],
    exits: [...exits.values()].sort(byCount),
    entries: [...entries.values()].sort(byCount),
    frame,
  };
}

function addEdge(edges: Map<string, FocusEdge>, from: StateNode, to: StateNode, t: TransitionNode) {
  const key = `${from.id}→${to.id}`;
  const e = edges.get(key) ?? edges.set(key, { from, to, transitions: [], events: [] }).get(key)!;
  e.transitions.push(t);
  for (const ev of t.events.length ? t.events : ["ε"]) if (!e.events.includes(ev)) e.events.push(ev);
}

/**
 * Where "follow" should look: the lowest container that holds every active
 * leaf. One active leaf → its parent; parallel regions → the parallel state,
 * whose lanes show all of them at once instead of jumping between regions.
 */
export function followTarget(configuration: StateNode[], current: StateNode): StateNode {
  const leaves = configuration.filter(isAtomic);
  if (!leaves.length) return current;
  let lca: StateNode | null = leaves[0]!.parent;
  while (lca && !leaves.every((l) => isDescendant(l, lca!))) lca = lca.parent;
  return lca && isContainer(lca) ? lca : current;
}

// ───────────────────────────── accepted events ─────────────────────────────

/** Where an accepted event's transition is, relative to the focus: inside it, on an ancestor, or elsewhere. */
export type EventScope = "here" | "inherited" | "elsewhere";

/** A transition that would handle an accepted event. */
export interface AcceptedTransition {
  /** the transition */
  transition: TransitionNode;
  /** its (active) source state */
  source: StateNode;
  /** it has a `cond` (shown, not evaluated) */
  guarded: boolean;
  /** where it leads (empty: targetless) */
  targets: StateNode[];
}

/** An event descriptor the machine accepts right now. */
export interface AcceptedEvent {
  /** the descriptor as written (may end in `.*`) */
  descriptor: string;
  /** the closest scope any of its transitions has */
  scope: EventScope;
  /** in priority order: innermost source first */
  transitions: AcceptedTransition[];
}

/**
 * Events the machine accepts in its current configuration: descriptors on
 * transitions of active states (conditions are shown, not evaluated — that
 * could have side effects). Scoped relative to the focus:
 *   here      — the source is inside the focus
 *   inherited — the source is an ancestor of the focus (it applies here too)
 *   elsewhere — other active parts (e.g. parallel regions outside the focus)
 */
export function acceptedEvents(session: Session, focus: StateNode): AcceptedEvent[] {
  const byKey = new Map<string, AcceptedEvent>();
  const rank = { here: 0, inherited: 1, elsewhere: 2 } as const;
  const active = session.configuration.sort((a, b) => b.depth - a.depth);
  for (const s of active) {
    const scope: EventScope = within(s, focus) ? "here" : isDescendant(focus, s) ? "inherited" : "elsewhere";
    for (const t of s.transitions) {
      for (const d of t.events) {
        if (d.startsWith("done.") || d.startsWith("error.")) continue;
        const ev = byKey.get(d) ?? byKey.set(d, { descriptor: d, scope, transitions: [] }).get(d)!;
        if (rank[scope] < rank[ev.scope]) ev.scope = scope;
        ev.transitions.push({ transition: t, source: s, guarded: !!t.cond, targets: t.targets });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => rank[a.scope] - rank[b.scope] || a.descriptor.localeCompare(b.descriptor));
}

/** Accepted events sharing a first dotted token. */
export interface EventGroup {
  /** the first token (`github` for `github.comment.*`), or `·` for names without a dot */
  prefix: string;
  /** the events, in their original order */
  events: AcceptedEvent[];
}

/** Group by the first dotted token ("github.comment.*" → "github"), keeping order. */
export function groupEvents(events: AcceptedEvent[]): EventGroup[] {
  const groups = new Map<string, EventGroup>();
  for (const e of events) {
    const prefix = e.descriptor.includes(".") ? e.descriptor.split(".")[0]! : "·";
    (groups.get(prefix) ?? groups.set(prefix, { prefix, events: [] }).get(prefix)!).events.push(e);
  }
  return [...groups.values()];
}

/** The concrete name to send for a descriptor ("github.comment.*" → "github.comment.done"; "*" → null). */
export function sendableName(descriptor: string): string | null {
  if (descriptor === "*") return null;
  return descriptor.endsWith(".*") ? `${descriptor.slice(0, -2)}.done` : descriptor;
}

/** Would sending `name` be handled by some active state? (ignores conditions) */
export function wouldAccept(session: Session, name: string): boolean {
  return session.configuration.some((s) => s.transitions.some((t) => t.events.length && nameMatch(t.events, name)));
}

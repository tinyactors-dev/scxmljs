/**
 * Warnings: valid SCXML that is very likely not what the author meant.
 * `compile()` puts them on `model.warnings`; nothing is rejected.
 *
 * Each check is chosen to be precise rather than exhaustive, so warnings stay
 * rare on real charts (on the W3C suite and the example charts, see
 * docs/deviations.md for the counts). Deliberately *not* checked: events that
 * nothing in the document sends — most events come from outside (hosts,
 * I/O processors, webhooks), so that warning would fire on almost every chart.
 */
import { isCompound, isCompoundOrRoot, isDescendant, type Model, properAncestors, type StateNode, type TransitionNode } from "./model.ts";

/** The kinds of authoring warning `compile()` reports on `model.warnings`. */
export type DiagnosticCode =
  /** An external transition on a state inside a `<parallel>` targets its own descendants, so the whole parallel state is exited and re-entered. */
  | "SCXML_W_EXITS_PARALLEL"
  /** No initial state, transition or history default can ever lead to the state. */
  | "SCXML_W_UNREACHABLE"
  /** A `done.state.X` / `done.invoke.X` transition waits for something that can never happen. */
  | "SCXML_W_NEVER_DONE"
  /** An earlier transition in the same state, without a condition, handles every event this one does. */
  | "SCXML_W_SHADOWED";

/**
 * An authoring warning: valid SCXML that is very likely not what the author
 * meant. Nothing is rejected; `<scxml-view>` and the explorer show them.
 */
export interface Diagnostic {
  /** Which check fired; stable across versions, so hosts can filter on it. */
  code: DiagnosticCode;
  /** Always `"warning"`: invalid documents throw `SCXMLValidationError` instead. */
  severity: "warning";
  /** A human-readable explanation, in English, naming the states involved. */
  message: string;
  /** The source element (a `<transition>` or state element). */
  element: Element | null;
  /** The state the warning is about (for a transition: its source). */
  state: StateNode | null;
}

/** All warnings for a compiled model, in document order. */
export function lint(model: Model): Diagnostic[] {
  const out: Diagnostic[] = [];
  const warn = (code: DiagnosticCode, message: string, state: StateNode, element: Element | null = state.element) =>
    out.push({ code, severity: "warning", message, element, state });
  exitsParallel(model, warn);
  unreachable(model, warn);
  neverDone(model, warn);
  shadowed(model, warn);
  return out.sort((a, b) => (a.state?.order ?? 0) - (b.state?.order ?? 0));
}

type Warn = (code: DiagnosticCode, message: string, state: StateNode, element?: Element | null) => void;

const name = (s: StateNode) => (s.kind === "scxml" ? "<scxml>" : `"${s.id}"`);
const describe = (t: TransitionNode) => (t.events.length ? `on ${t.events.join(" ")}` : t.cond ? `[${t.cond}]` : "(eventless)");

/**
 * The trap: a transition on a region of a `<parallel>` that targets states
 * inside that region. As an external transition its domain is the nearest
 * *compound* ancestor — and a `<parallel>` isn't one — so it exits the whole
 * parallel state, resetting every sibling region. `type="internal"` keeps it
 * inside the region.
 */
function exitsParallel(model: Model, warn: Warn) {
  for (const s of model.states) {
    for (const t of s.transitions) {
      if (t.type !== "external" || !t.element || !t.targets.length) continue;
      if (!t.targets.every((x) => isDescendant(x, s))) continue;
      const domain = properAncestors(s, null).find(isCompoundOrRoot);
      const parallel = properAncestors(s, domain ?? null).find((a) => a.kind === "parallel");
      if (!parallel) continue;
      warn(
        "SCXML_W_EXITS_PARALLEL",
        `The transition ${describe(t)} in ${name(s)} targets states inside ${name(s)}, but as an external transition it exits ` +
          `and re-enters the whole parallel state ${name(parallel)}, resetting all of its regions. ` +
          `Add type="internal" if it should only change ${name(s)}.`,
        s,
        t.element,
      );
    }
  }
}

/** States that nothing can ever enter. Only the outermost unreachable state is reported. */
function unreachable(model: Model, warn: Warn) {
  const reached = new Set<StateNode>();
  const queue: StateNode[] = [];
  const mark = (s: StateNode) => {
    for (const x of [s, ...properAncestors(s, null)]) {
      if (reached.has(x)) continue;
      reached.add(x);
      queue.push(x);
    }
  };
  mark(model.root);
  while (queue.length) {
    const s = queue.shift()!;
    if (s.kind === "history") for (const t of s.transitions) t.targets.forEach(mark);
    if (s.initial) s.initial.targets.forEach(mark);
    if (s.kind === "parallel") s.children.forEach(mark);
    for (const t of s.transitions) t.targets.forEach(mark);
  }
  for (const s of model.states) {
    if (reached.has(s) || s.kind === "history" || s.kind === "scxml") continue;
    if (s.parent && !reached.has(s.parent) && s.parent.kind !== "scxml") continue; // its parent is already reported
    warn(
      "SCXML_W_UNREACHABLE",
      `State ${name(s)} can never be entered: no initial state, transition or history default leads to it or to a state inside it.`,
      s,
    );
  }
}

/** Can this state ever raise done.state.<id>? */
function canComplete(s: StateNode): boolean {
  if (isCompound(s)) return s.children.some((c) => c.kind === "final");
  if (s.kind === "parallel") return s.children.length > 0 && s.children.every(canComplete);
  return false;
}

function neverDone(model: Model, warn: Warn) {
  const invokeIds = new Set<string>();
  let generatedInvokeIds = false;
  for (const s of model.states)
    for (const inv of s.invokes) {
      const id = inv.element.getAttribute("id");
      if (id) invokeIds.add(id);
      else generatedInvokeIds = true;
    }
  for (const s of model.states) {
    for (const t of s.transitions) {
      if (!t.element) continue;
      for (const d of t.events) {
        const tokens = d.replace(/\.\*$/, "").replace(/\.$/, "").split(".");
        if (tokens[0] !== "done" || tokens.length < 3) continue;
        const id = tokens.slice(2).join(".");
        if (tokens[1] === "state") {
          const target = model.byId.get(id);
          const why = !target
            ? `there is no state "${id}"`
            : target.kind === "final"
              ? `"${id}" is a final state; done.state events carry the id of its parent${target.parent && target.parent.kind !== "scxml" ? ` ("${target.parent.id}")` : ""}`
              : `"${id}" can never complete (${target.kind === "parallel" ? "one of its regions has no final state" : "it has no final child state"})`;
          if (!target || !canComplete(target))
            warn("SCXML_W_NEVER_DONE", `The transition on ${d} in ${name(s)} can never fire: ${why}.`, s, t.element);
        } else if (tokens[1] === "invoke" && !invokeIds.has(id) && !generatedInvokeIds) {
          // done.invoke ids can also be longer than the invoke id (done.invoke.kid matches done.invoke.kid.x), so check the prefix
          if (![...invokeIds].some((i) => i === id || id.startsWith(`${i}.`)))
            warn(
              "SCXML_W_NEVER_DONE",
              `The transition on ${d} in ${name(s)} can never fire: no <invoke> has the id "${id}".`,
              s,
              t.element,
            );
        }
      }
    }
  }
}

/** Does descriptor `a` match every event that descriptor `b` matches? */
function covers(a: string, b: string): boolean {
  if (a === "*") return true;
  if (b === "*") return false;
  const ta = a.replace(/\.\*$/, "").replace(/\.$/, "").split(".");
  const tb = b.replace(/\.\*$/, "").replace(/\.$/, "").split(".");
  return ta.length <= tb.length && ta.every((t, i) => t === tb[i]);
}

function shadowed(model: Model, warn: Warn) {
  for (const s of model.states) {
    if (s.kind === "history") continue;
    const earlier: TransitionNode[] = [];
    for (const t of s.transitions) {
      const by = earlier.find(
        (e) =>
          !e.cond &&
          (e.events.length === 0
            ? t.events.length === 0
            : t.events.length > 0 && t.events.every((d) => e.events.some((c) => covers(c, d)))),
      );
      if (by && t.element)
        warn(
          "SCXML_W_SHADOWED",
          `The transition ${describe(t)} in ${name(s)} can never fire: the earlier transition ${describe(by)} in the same state has no condition and handles every event it does.`,
          s,
          t.element,
        );
      earlier.push(t);
    }
  }
}

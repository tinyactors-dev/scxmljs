/**
 * What a state is about, from the chart's own source: the XML comments that
 * document it. Pure DOM reading, no layout.
 *
 *   <!-- Waiting for the customer to pay. -->        ← describes "awaiting"
 *   <state id="awaiting">
 *     <!-- Times out after 15 minutes. -->            ← describes "awaiting" too
 *     <transition event="paid" target="shipping"/>
 *   </state>
 *
 * Two places count:
 *   1. the comments right before the element (only whitespace in between);
 *   2. the comments at the very start of its content.
 * Where the two overlap — comments opening a state's content, directly
 * followed by a child state — the last comment documents the child and the
 * ones before it the parent.
 */
import type { StateNode } from "../model.ts";

const STATE_TAGS = new Set(["state", "parallel", "final", "history"]);
const COMMENT = 8;
const TEXT = 3;
const ELEMENT = 1;

const blank = (n: Node) => n.nodeType === TEXT && !(n.nodeValue ?? "").trim();
const isState = (n: Node | null | undefined) => n?.nodeType === ELEMENT && STATE_TAGS.has((n as Element).localName);

/** A state's documentation comments, dedented and joined by blank lines; `undefined` when it has none. */
export function sourceDescription(state: StateNode): string | undefined {
  const el = state.element;
  if (!el || state.kind === "scxml") return undefined;
  let before: string[] = [];
  let n: Node | null = el.previousSibling;
  for (; n && (n.nodeType === COMMENT || blank(n)); n = n.previousSibling) if (n.nodeType === COMMENT) before.unshift(n.nodeValue ?? "");
  // the run opens a parent state's content: the parent keeps all but the last
  if (!n && isState(el.parentNode)) before = before.slice(-1);
  let inside: string[] = [];
  for (n = el.firstChild; n && (n.nodeType === COMMENT || blank(n)); n = n.nextSibling)
    if (n.nodeType === COMMENT) inside.push(n.nodeValue ?? "");
  if (isState(n)) inside = inside.slice(0, -1);
  const parts = [...before, ...inside].map(dedent).filter(Boolean);
  return parts.length ? parts.join("\n\n") : undefined;
}

/** Trim a comment and remove the indentation its lines share (a first line right after `<!--` doesn't count). */
function dedent(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const flush = !!lines[0]?.trim();
  if (flush) lines[0] = lines[0]!.trim();
  while (lines.length && !lines[0]!.trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  if (!lines.length) return "";
  const measured = (flush ? lines.slice(1) : lines).filter((l) => l.trim());
  const indent = measured.length ? Math.min(...measured.map((l) => l.match(/^[ \t]*/)![0].length)) : 0;
  return lines
    .map((l, i) => (flush && i === 0 ? l : l.slice(indent).trimEnd()))
    .join("\n")
    .trim();
}

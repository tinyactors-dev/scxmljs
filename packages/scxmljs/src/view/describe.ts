/**
 * What a state is about, from the chart's own source: the XML comments right
 * before it (only whitespace in between). Pure DOM reading, no layout.
 *
 *   <!-- Waiting for the customer to pay. -->        ← describes "awaiting"
 *   <state id="awaiting">
 *     <!-- every reminder is logged -->               ← describes the transition, not "awaiting"
 *     <transition event="remind" type="internal">…</transition>
 *   </state>
 *
 * A comment documents the element after it, so comments inside a state are
 * about its transitions or children. Section dividers lose their rules:
 * `<!-- ── intake: validate, screen ──── -->` reads "intake: validate, screen".
 */
import type { StateNode } from "../model.ts";

const COMMENT = 8;
const TEXT = 3;

const blank = (n: Node) => n.nodeType === TEXT && !(n.nodeValue ?? "").trim();
/** A run of rule characters, as in `<!-- ── section ───── -->` or `<!-- ===== -->`. */
const RULE = "[\\-‐-―─━═~=*#_+]{2,}";
const LEADING_RULE = new RegExp(`^\\s*${RULE}\\s*`);
const TRAILING_RULE = new RegExp(`\\s*${RULE}\\s*$`);

/** A state's documentation comments, dedented and joined by blank lines; `undefined` when it has none. */
export function sourceDescription(state: StateNode): string | undefined {
  const el = state.element;
  if (!el || state.kind === "scxml") return undefined;
  const before: string[] = [];
  for (let n = el.previousSibling; n && (n.nodeType === COMMENT || blank(n)); n = n.previousSibling)
    if (n.nodeType === COMMENT) before.unshift(n.nodeValue ?? "");
  const parts = before.map((c) => dedent(undecorate(c))).filter(Boolean);
  return parts.length ? parts.join("\n\n") : undefined;
}

/** Remove divider rules: lines that are only a rule, and rules around a line's text. */
function undecorate(text: string): string {
  return text
    .split(/\r\n?|\n/)
    .map((line) => {
      const bare = line.replace(LEADING_RULE, (m) => m.replace(/\S/g, "")).replace(TRAILING_RULE, "");
      return bare.trim() ? bare : "";
    })
    .join("\n");
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

/**
 * The elements' notation (docs/design-principles.md: notation over narration). Builders for the
 * things both elements show again and again, as DOM nodes with their text names kept for
 * tooltips and screen readers:
 *
 *   eventName(descriptor)   an event's name as written: the namespace quieter (cut from the left
 *                           when there's no room), the last part in full; its kind (completion,
 *                           error, wildcard) a class that colours it and the chip around it
 *   glyph(name, label)      one glyph of the table, with its name
 *   actionGlyphs(state)     what a state does on entry / exit and what it invokes, as glyphs
 */
import type { StateNode } from "../model.ts";
import * as icons from "./icons.ts";
import { type IconDef, icon } from "./svg.ts";

const h = (tag: string, attrs: Record<string, string> = {}, ...children: (Node | string)[]) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
};

/** One glyph, 14px, named: `label` is its tooltip and (unless `decorative`) its accessible name. */
export function glyph(def: IconDef, label: string, decorative = false): HTMLElement {
  const g = h("span", { class: `glyph glyph-${def[0]}`, title: label }, icon(def, 14));
  if (decorative) g.setAttribute("aria-hidden", "true");
  else {
    g.setAttribute("role", "img");
    g.setAttribute("aria-label", label);
  }
  return g;
}

/** What kind of event a name is: a completion, an error, a wildcard, or an ordinary event. */
export type EventKind = "done" | "error" | "wildcard" | "event";

/**
 * The kind of an event name: `done.state.*`, `done.invoke.*` and any name whose last part is
 * `done` are completions; `error`, `error.*` and any name whose last part is `error` are errors;
 * a name with `*` is a wildcard (a descriptor that matches many events).
 */
export function eventKind(descriptor: string): EventKind {
  const parts = descriptor.split(".");
  if (descriptor.includes("*")) return "wildcard";
  if (parts[0] === "done" || parts.at(-1) === "done") return "done";
  if (parts[0] === "error" || parts.at(-1) === "error") return "error";
  return "event";
}

/**
 * An event's name, exactly as written, in the system's monospace: the namespace quieter, the last
 * part at full strength. When there isn't room the namespace is cut from the left
 * (`…Failed.done`), never the last part. Its kind is a class (`kind-done`, `kind-error`,
 * `kind-wildcard`) that colours it, and that a chip around it takes too (see `EVENT_CHIP`): no
 * glyph ever replaces a part of the name.
 */
export function eventName(descriptor: string): HTMLElement {
  const kind = eventKind(descriptor);
  const el = h("span", { class: `ev-name kind-${kind}`, title: descriptor });
  const at = descriptor.lastIndexOf(".");
  // a trailing ".*" belongs with what it matches: carrier.* reads "carrier." + "*"
  if (at > 0) el.append(h("span", { class: "ns" }, h("span", {}, descriptor.slice(0, at + 1))));
  el.append(h("span", { class: "leaf" }, at > 0 ? descriptor.slice(at + 1) : descriptor));
  return el;
}

/** Words for what a state does (translations pass their own). */
export interface ActionWords {
  /** Before the entry actions in the accessible name. English: "on entry". */
  onEntry: string;
  /** Before the exit actions. English: "on exit". */
  onExit: string;
  /** Before the invokes. English: "invokes". */
  invokes: string;
  /** A glyph's name: sends an event or message. */
  sends: string;
  /** A glyph's name: logs. */
  logs: string;
}

/** The glyph of an executable content element, when it has one (send / raise: sends; log: logs). */
const ACTION_GLYPH: Record<string, [IconDef, keyof ActionWords]> = {
  send: [icons.send, "sends"],
  raise: [icons.send, "sends"],
  log: [icons.logs, "logs"],
};

/**
 * What a state does, as glyphs: `log-in` then the kinds of its entry actions (send, log), `log-out`
 * then its exit actions', `workflow` (with a count above one) for its invokes. One accessible
 * name for the lot, from `describe` (one phrase per action); the same text, a line each, is
 * the tooltip. `undefined` when the state does nothing.
 */
export function actionGlyphs(s: StateNode, words: ActionWords, describe: (action: Element) => string): HTMLElement | undefined {
  const entry = s.onentry.flatMap((b) => Array.from(b.children));
  const exit = s.onexit.flatMap((b) => Array.from(b.children));
  if (!entry.length && !exit.length && !s.invokes.length) return undefined;
  const el = h("span", { class: "does-glyphs", role: "img" });
  const lines: string[] = [];
  const group = (lead: IconDef, word: string, actions: Element[]) => {
    if (!actions.length) return;
    const g = h("span", { class: "does-group" }, glyph(lead, word, true));
    const seen = new Set<IconDef>();
    for (const a of actions) {
      const kind = ACTION_GLYPH[a.localName];
      if (!kind || seen.has(kind[0])) continue;
      seen.add(kind[0]);
      g.append(glyph(kind[0], words[kind[1]], true));
    }
    el.append(g);
    lines.push(`${word}: ${actions.map(describe).join(", ")}`);
  };
  group(icons.logIn, words.onEntry, entry);
  group(icons.logOut, words.onExit, exit);
  if (s.invokes.length) {
    el.append(
      h(
        "span",
        { class: "does-group" },
        glyph(icons.workflow, words.invokes, true),
        s.invokes.length > 1 ? h("span", { class: "n" }, String(s.invokes.length)) : "",
      ),
    );
    const ids = s.invokes.map((i) => i.element.getAttribute("id") ?? i.element.getAttribute("src") ?? i.element.getAttribute("type") ?? "");
    lines.push(`${words.invokes}: ${ids.filter(Boolean).join(", ") || s.invokes.length}`);
  }
  el.setAttribute("aria-label", lines.join("; "));
  el.title = lines.join("\n");
  return el;
}

/** Styles for the notation: the same in both elements' sheets. */
export const NOTATION_CSS = /* css */ `
.glyph { display: inline-grid; place-items: center; flex: none; vertical-align: -2px; }
.glyph .icon { display: block; }
/* an event's name: the system's monospace, as written; the namespace quieter, cut from the left */
.ev-name { display: inline-flex; align-items: baseline; min-width: 0; max-width: 100%; font-family: var(--x-mono); white-space: nowrap; }
.ev-name .ns { flex: 0 1 auto; min-width: 1.5em; overflow: hidden; text-overflow: ellipsis; direction: rtl; color: var(--x-fg2); }
.ev-name .ns > span { direction: ltr; unicode-bidi: embed; }
.ev-name .leaf { flex: none; }
/* its kind, as the state colours: plain text takes the colour; a chip takes the tinted pill */
.ev-name.kind-done, .ev-name.kind-done .ns { color: var(--x-done); }
.ev-name.kind-error, .ev-name.kind-error .ns { color: var(--x-err); }
.ev-name.kind-wildcard .leaf { color: var(--x-fg2); }
.ev-chip:has(> .ev-name.kind-done), .ev-chip:has(> * > .ev-name.kind-done) { background: var(--x-done-bg); border-color: color-mix(in srgb, var(--x-done) 35%, var(--x-b2)); }
.ev-chip:has(> .ev-name.kind-error), .ev-chip:has(> * > .ev-name.kind-error) { background: var(--x-err-bg); border-color: color-mix(in srgb, var(--x-err) 35%, var(--x-b2)); }
.does-glyphs { display: inline-flex; align-items: center; gap: 10px; color: var(--x-fg3); }
.does-group { display: inline-flex; align-items: center; gap: 3px; }
.does-glyphs .n { font: 11px var(--x-sans); }
`;

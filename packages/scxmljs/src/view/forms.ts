/**
 * What data each event of a chart takes, for the form `<scxml-view>` shows before it sends one:
 * the chart's `<xs:schema>` (a top-level `<xs:element name>` per event name) first, else what the
 * chart reads of `_event.data` where it handles the event (`_event.data.amount`,
 * `_event.data["card"]`), each such name an optional field of any JSON value.
 */

import { type Field, readSchemas } from "../data/xsd.ts";
import type { Model } from "../model.ts";

const READ = /_event\s*\.\s*data\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*(["'])([^"'\]]+)\2\s*\])/g;
const WHOLE = /_event\s*\.\s*data\b(?!\s*(?:\.|\[))/;

/** The text of a transition's handling: its `cond` and every attribute and text inside it. */
function handling(el: Element): string {
  const parts: string[] = [];
  const walk = (n: Element) => {
    for (const a of Array.from(n.attributes)) parts.push(a.value);
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === 1) walk(c as Element);
      else if (c.nodeType === 3 || c.nodeType === 4) parts.push(c.textContent ?? "");
    }
  };
  walk(el);
  return parts.join("\n");
}

/** Each sendable event of the chart that takes data, with what it takes. */
export function eventFields(model: Model): Map<string, Field> {
  const out = new Map<string, Field>();
  const root = model.root.element;
  const schema = readSchemas(root);
  const read = new Map<string, { names: Set<string>; whole: boolean }>();
  for (const state of model.states)
    for (const tr of state.transitions) {
      if (!tr.element) continue;
      const text = handling(tr.element);
      if (!text.includes("_event")) continue;
      for (const ev of tr.events) {
        if (ev === "*" || ev.endsWith(".*") || ev.includes("*")) continue;
        const name = ev.replace(/\.$/, "");
        const entry = read.get(name) ?? { names: new Set<string>(), whole: false };
        for (const m of text.matchAll(READ)) entry.names.add(m[1] ?? m[3]!);
        if (WHOLE.test(text)) entry.whole = true;
        read.set(name, entry);
      }
    }
  for (const [name, entry] of read) {
    if (entry.names.size)
      out.set(name, {
        name,
        type: { kind: "object", fields: [...entry.names].map((n) => ({ name: n, type: { kind: "any" }, min: 0, max: 1 })) },
        min: 1,
        max: 1,
      });
    else if (entry.whole) out.set(name, { name, type: { kind: "any" }, min: 1, max: 1 });
  }
  for (const [name, field] of schema.elements) out.set(name, field);
  return out;
}

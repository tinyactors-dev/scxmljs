/**
 * What `<scxml-view>` shows under its diagram when a chart is run as a demo, so a page needs no
 * code of its own for it:
 *
 *   unhandledSendTypes(root, processors)  the I/O processor types a chart sends to (`<send
 *                                         type="payments">`) that neither SCXML nor the page
 *                                         handles: in the view each would fail its sends
 *   standIn(type, …)                      a processor for one of them that keeps what it receives,
 *                                         and the panel that lists it, newest first; the reader
 *                                         plays the service by clicking its reply's label
 *   variablesPanel(…)                     the chart's variables (`session.snapshot()`), after
 *                                         each step: the `variables` attribute
 *
 * Notation over narration (docs/design-principles.md): names and values are text, an event is
 * its name (`eventName`), a count is a number with the send glyph, its words its accessible name.
 */
import { SCXML_IOPROCESSOR } from "../events.ts";
import type { IOProcessor, OutboundSend, SCXMLSession } from "../session.ts";
import * as icons from "../ui/icons.ts";
import { eventName, glyph } from "../ui/notation.ts";
import type { ViewStrings } from "./strings.ts";

/** The newest messages a stand-in lists. */
const KEEP = 20;
/** The types SCXML's own processor answers to. */
const SCXML_TYPES = new Set(["scxml", SCXML_IOPROCESSOR]);

const h = (tag: string, attrs: Record<string, string> = {}, ...children: (Node | string)[]) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
};

/**
 * The literal `<send type>`s of a chart (not `typeexpr`: its value is known only when it runs)
 * that neither SCXML's processor nor one of `processors` (by type or alias) handles, in document
 * order, each once.
 */
export function unhandledSendTypes(root: Element, processors: readonly IOProcessor[]): string[] {
  const handled = new Set(processors.flatMap((p) => [p.type, ...(p.aliases ?? [])]));
  const types: string[] = [];
  // walked by hand: every DOM the library runs on (happy-dom, linkedom…) has `children`
  const sends: Element[] = [];
  const walk = (el: Element) => {
    if (el.localName === "send") sends.push(el);
    for (const child of Array.from(el.children)) walk(child);
  };
  walk(root);
  for (const send of sends) {
    const type = send.getAttribute("type");
    if (type && !SCXML_TYPES.has(type) && !handled.has(type) && !types.includes(type)) types.push(type);
  }
  return types;
}

/** A stand-in processor and the panel that shows what it received. */
export interface StandIn {
  readonly processor: IOProcessor;
  readonly panel: HTMLElement;
  /** A new run of the chart: the list starts empty, its times from `now()`. */
  restart(): void;
}

/** A stand-in for the processor of `type`: it keeps each message, with the time it came (`now()`, ms). */
export function standIn(type: string, strings: ViewStrings, now: () => number): StandIn {
  const received: { at: number; message: OutboundSend }[] = [];
  let started = now();
  const count = h("span", { class: "count" });
  const log = h("ol", { class: "log" });
  const panel = h(
    "section",
    { class: "panel stand-in", part: "panel stand-in", "aria-label": strings.standInLabel(type) },
    h("p", { class: "panel-head" }, h("code", { class: "name" }, type), count),
    log,
  );
  const render = () => {
    const n = received.length;
    count.replaceChildren(glyph(icons.send, strings.received(n), true), String(n));
    count.title = strings.received(n);
    count.setAttribute("aria-label", strings.received(n));
    log.replaceChildren(
      ...received
        .slice(-KEEP)
        .reverse()
        .map(({ at, message }) => {
          const data = shown(message.data);
          return h(
            "li",
            {},
            h("span", { class: "at" }, clock(at - started)),
            eventName(message.event),
            ...(message.target ? [h("span", { class: "target" }, `→ ${message.target}`)] : []),
            ...(data ? [h("code", { class: "value", title: data }, data)] : []),
          );
        }),
    );
    if (!n) log.append(h("li", { class: "empty" }, strings.nothingReceived));
  };
  render();
  return {
    panel,
    restart() {
      received.length = 0;
      started = now();
      render();
    },
    processor: {
      type,
      location: (session) => `${type}#${session.sessionId}`,
      send(message) {
        received.push({ at: now(), message });
        render();
      },
    },
  };
}

/** The chart's variables, listed after each step of the session it watches. */
export function variablesPanel(strings: ViewStrings): { panel: HTMLElement; watch(session: SCXMLSession | undefined): void } {
  const list = h("dl", { class: "variables" });
  const panel = h(
    "section",
    { class: "panel", part: "panel variables", "aria-label": strings.variablesLabel },
    h("p", { class: "panel-head" }, h("span", {}, strings.variablesLabel)),
    list,
  );
  let session: SCXMLSession | undefined;
  const render = () => {
    const entries = Object.entries(session?.snapshot() ?? {});
    list.replaceChildren(
      ...entries.flatMap(([name, value]) => [h("dt", {}, h("code", {}, name)), h("dd", {}, h("code", { class: "value" }, json(value)))]),
    );
  };
  return {
    panel,
    /** List `next`'s variables from now on, after each of its macrosteps (`undefined`: none). */
    watch(next) {
      session?.removeEventListener("macrostep", render);
      session = next;
      session?.addEventListener("macrostep", render);
      render();
    },
  };
}

/** Milliseconds as m:ss. */
function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** A value as compact JSON (`undefined` as its name). */
function json(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "undefined";
  } catch {
    return String(value);
  }
}

/** A message's data as compact JSON: nothing for no data or an empty object. */
function shown(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = json(value);
  return text === "{}" ? "" : text;
}

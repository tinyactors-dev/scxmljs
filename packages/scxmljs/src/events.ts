/** Shared constants and the SCXML event shape. */

export const SCXML_NS = "http://www.w3.org/2005/07/scxml";
/** The SCXML Event I/O Processor type URI (spec §C.1). */
export const SCXML_IOPROCESSOR = "http://www.w3.org/TR/scxml/#SCXMLEventProcessor";
/** Types accepted by `<invoke>` for SCXML child sessions. */
export const SCXML_INVOKE_TYPES = new Set(["scxml", "http://www.w3.org/TR/scxml/", "http://www.w3.org/TR/scxml"]);

/** The `_event` object (spec §5.10.1). Every field is always present. */
export interface SCXMLEvent {
  /** The event name, for example `"issues.opened"` or `"done.state.checkout"`. */
  name: string;
  /** `platform` for events the interpreter raises (`done.*`, `error.*`), `internal` for `<raise>` and `#_internal`, `external` for everything else. */
  type: "platform" | "internal" | "external";
  /** The `id` (or generated id) of the `<send>` that produced the event; also set on errors raised by a `<send>`. */
  sendid?: string;
  /** Where to reply: for the SCXML processor, `#_scxml_<sessionid>` of the sender. */
  origin?: string;
  /** The type URI of the I/O processor the event came through. */
  origintype?: string;
  /** Set when the event comes from an invoked child session or service. */
  invokeid?: string;
  /** The payload: namelist/`<param>` values, `<content>`, `<donedata>`, or what the host passed to `send()`. */
  data?: unknown;
}

/**
 * Event descriptor matching (spec §3.12.1): a descriptor matches an event
 * name if its tokens are a prefix of the name's tokens. "*" matches every
 * event; a trailing ".*" is ignored.
 */
export function nameMatch(descriptors: readonly string[], name: string): boolean {
  const tokens = name.split(".");
  return descriptors.some((d) => {
    if (d === "*") return true;
    const want = d.replace(/\.\*$/, "").replace(/\.$/, "").split(".");
    if (want.length > tokens.length) return false;
    return want.every((t, i) => t === tokens[i]);
  });
}

/** CSS2 time values: "1.5s", "250ms". Returns milliseconds, or NaN when invalid. */
export function parseDelay(v: unknown): number {
  if (typeof v === "number") return v >= 0 ? v : NaN;
  const m = /^\s*(\d*\.?\d+)\s*(ms|s)\s*$/.exec(String(v ?? ""));
  if (!m) return NaN;
  const n = parseFloat(m[1]!);
  return m[2] === "s" ? n * 1000 : n;
}

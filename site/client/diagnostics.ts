/**
 * Playground diagnostics: XML parse errors, SCXMLValidationError problems and compile warnings,
 * mapped to source offsets for the editor. DOM elements don't carry source positions, so an element
 * is located by its index among same-named elements (the nth `<transition`), skipping comments,
 * CDATA sections and processing instructions.
 */

export interface PlaygroundDiagnostic {
  from: number;
  to: number;
  severity: "error" | "warning";
  message: string;
  /** e.g. "SCXML_PARSE", "SCXML_INVALID", "SCXML_W_UNREACHABLE" */
  code: string;
}

/** Replaces comments, CDATA and processing instructions with spaces (same length, so offsets stay valid). */
export function maskNonMarkup(source: string): string {
  return source.replace(/<!--[\s\S]*?(-->|$)|<!\[CDATA\[[\s\S]*?(\]\]>|$)|<\?[\s\S]*?(\?>|$)/g, (m) => m.replace(/[^\n]/g, " "));
}

/** Offset of a 1-based line/column. */
export function offsetAt(source: string, line: number, column: number): number {
  let offset = 0;
  for (let l = 1; l < line; l++) {
    const nl = source.indexOf("\n", offset);
    if (nl < 0) return source.length;
    offset = nl + 1;
  }
  return Math.min(source.length, offset + Math.max(0, column - 1));
}

/** Line and column from a browser's parsererror text (Chromium/WebKit: "line 3 at column 5"; Firefox: "Line Number 3, Column 5"). */
export function parseErrorPosition(text: string): { line: number; column: number } | undefined {
  const m =
    /line (\d+) at column (\d+)/i.exec(text) ??
    /Line Number (\d+), Column (\d+)/i.exec(text) ??
    /line[: ]+(\d+)[^\d]+column[: ]+(\d+)/i.exec(text);
  return m ? { line: Number(m[1]), column: Number(m[2]) } : undefined;
}

/** Cleans a browser's parsererror text into one readable sentence. */
export function parseErrorMessage(text: string): string {
  const t = text
    .replace(/This page contains the following errors:/i, "")
    .replace(/Below is a rendering of the page up to the first error\.?/i, "")
    .replace(/Location:.*$/im, "")
    .replace(/^XML Parsing Error:\s*/i, "")
    .replace(/\{[^{}\s]*\}(?=[\w.-])/g, "") // Chromium names elements {namespace}local
    .replace(/\s+/g, " ")
    .trim();
  return t || "The chart isn't well-formed XML.";
}

/** Source range of the start tag of `el` (the nth element with its local name, in document order). */
export function rangeOfElement(masked: string, doc: Document, el: Element): { from: number; to: number } | undefined {
  const same = doc.getElementsByTagNameNS(el.namespaceURI, el.localName);
  let index = -1;
  for (let i = 0; i < same.length; i++)
    if (same[i] === el) {
      index = i;
      break;
    }
  if (index < 0) return undefined;
  const re = new RegExp(`<(?:[\\w.-]+:)?${el.localName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[\\s/>])`, "g");
  let m: RegExpExecArray | null = null;
  for (let i = 0; i <= index; i++) {
    m = re.exec(masked);
    if (!m) return undefined;
  }
  if (!m) return undefined;
  const end = masked.indexOf(">", m.index);
  return { from: m.index, to: end < 0 ? m.index + m[0].length : end + 1 };
}

/**
 * Where a validation problem (a message string) points: the first quoted name in it that appears
 * as an attribute value in the source (`id="x"`, `target="… x …"`, …), else the `<scxml>` tag.
 */
export function rangeOfProblem(source: string, masked: string, problem: string): { from: number; to: number } {
  for (const [, name] of problem.matchAll(/"([^"]+)"/g)) {
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const idAttr = new RegExp(`\\bid\\s*=\\s*"${escaped}"`).exec(masked);
    const anyAttr = idAttr ?? new RegExp(`="(?:[^"]*\\s)?${escaped}(?:\\s[^"]*)?"`).exec(masked);
    if (anyAttr) {
      const at = masked.indexOf(name, anyAttr.index);
      return { from: at, to: at + name.length };
    }
  }
  const root = /<(?:[\w.-]+:)?scxml(?=[\s/>])/.exec(masked);
  return root ? { from: root.index, to: root.index + root[0].length } : { from: 0, to: Math.min(1, source.length) };
}

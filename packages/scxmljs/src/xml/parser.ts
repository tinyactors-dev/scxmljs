/**
 * An XML 1.0 (fifth edition) + Namespaces in XML 1.0 parser, non-validating,
 * building the DOM of `./dom.ts`.
 *
 * Reads elements, attributes (either quote), namespace declarations and
 * prefixes, text, CDATA sections, comments, processing instructions, the five
 * predefined entities and character references. Line ends are normalized
 * (§2.11) and attribute values too (§3.3.3, as CDATA-typed attributes); text
 * is otherwise kept exactly. The XML declaration is checked and dropped, as
 * browsers do; a DOCTYPE is skipped, its internal subset included, and
 * creates no node. Entities it declares are not expanded: a reference to one
 * is an error (the parser reads no DTD).
 *
 * A document that isn't well-formed or namespace-well-formed doesn't throw:
 * like a browser's `DOMParser`, the result is a document whose root is a
 * `<parsererror>` element (Gecko's namespace and message shape), whose text
 * gives the error, its line and its column.
 */

import { Attr, CDATASection, Comment, Document, Element, ProcessingInstruction, Text, XML_NS, XMLNS_NS } from "./dom.ts";

export const PARSERERROR_NS = "http://www.mozilla.org/newlayout/xml/parsererror.xml";

class XMLSyntaxError extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message);
  }
}

// §2.3 NameStartChar and NameChar (colons are split off later, by the namespace rules)
const START =
  ":A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}";
const NAME = new RegExp(`[${START}][${START}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040]*`, "uy");
const SPACE = /[ \t\n]*/y;
/** A surrogate that isn't half of a pair. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/** A character outside §2.2 Char. */
const NOT_CHAR = /[^\t\n\r\x20-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]/u;
const PREDEFINED: Record<string, string> = { lt: "<", gt: ">", amp: "&", apos: "'", quot: '"' };

interface Scope {
  readonly parent: Scope | null;
  readonly prefixes: Map<string, string | null>;
}

interface RawAttr {
  name: string;
  value: string;
  at: number;
}

/** Parses `text` as an XML document; never throws for bad XML (see the module comment). */
export function parseXML(text: string, contentType = "application/xml"): Document {
  const src = text.replace(/\r\n?/g, "\n");
  try {
    return new Parser(src, contentType).document();
  } catch (e) {
    if (!(e instanceof XMLSyntaxError)) throw e;
    return errorDocument(src, e, contentType);
  }
}

function errorDocument(src: string, e: XMLSyntaxError, contentType: string): Document {
  const before = src.slice(0, e.at);
  const line = before.split("\n").length;
  const lineStart = before.lastIndexOf("\n") + 1;
  // columns count characters (code points), from 1
  const column = [...src.slice(lineStart, e.at)].length + 1;
  const lineEnd = src.indexOf("\n", e.at);
  const doc = new Document(contentType);
  const root = new Element(doc, PARSERERROR_NS, null, "parsererror");
  root.appendChild(new Text(doc, `XML Parsing Error: ${e.message}\nLine Number ${line}, Column ${column}:`));
  const source = new Element(doc, PARSERERROR_NS, null, "sourcetext");
  source.appendChild(new Text(doc, `${src.slice(lineStart, lineEnd < 0 ? src.length : lineEnd)}\n${"-".repeat(column - 1)}^`));
  root.appendChild(source);
  doc.appendChild(root);
  return doc;
}

class Parser {
  private pos = 0;
  private readonly doc: Document;

  private readonly src: string;

  constructor(src: string, contentType: string) {
    // a lone surrogate becomes U+FFFD, as browsers do when they encode the string for their parser
    this.src = src.replace(LONE_SURROGATE, "\uFFFD");
    this.doc = new Document(contentType);
  }

  document(): Document {
    const bad = NOT_CHAR.exec(this.src);
    if (bad)
      throw new XMLSyntaxError(
        `not a legal XML character (U+${bad[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")})`,
        bad.index,
      );
    if (this.src.startsWith("﻿")) this.pos = 1;
    if (this.src.startsWith("<?xml", this.pos) && /[ \t\n?]/.test(this.src[this.pos + 5] ?? "")) this.xmlDecl();
    let root: Element | null = null;
    let doctype = false;
    for (;;) {
      this.space();
      if (this.pos >= this.src.length) break;
      if (this.src.startsWith("<!--", this.pos)) this.doc.appendChild(this.comment());
      else if (this.src.startsWith("<?", this.pos)) this.doc.appendChild(this.pi());
      else if (this.src.startsWith("<!DOCTYPE", this.pos)) {
        if (doctype || root) this.fail("a DOCTYPE is only allowed once, before the root element");
        this.doctype();
        doctype = true;
      } else if (this.src[this.pos] === "<" && !root) {
        root = this.element(null, this.doc);
      } else this.fail(root ? "junk after document element" : "syntax error");
    }
    if (!root) this.fail("no root element found");
    return this.doc;
  }

  // ─── lexical helpers ───

  private fail(message: string, at = this.pos): never {
    throw new XMLSyntaxError(message, at);
  }

  private space(): boolean {
    SPACE.lastIndex = this.pos;
    SPACE.exec(this.src);
    const moved = SPACE.lastIndex > this.pos;
    this.pos = SPACE.lastIndex;
    return moved;
  }

  private name(): string {
    NAME.lastIndex = this.pos;
    const m = NAME.exec(this.src);
    if (!m) this.fail(this.pos >= this.src.length ? "unclosed token" : "not a name");
    this.pos = NAME.lastIndex;
    return m[0];
  }

  private expect(s: string, message = `expected "${s}"`): void {
    if (!this.src.startsWith(s, this.pos)) this.fail(this.pos >= this.src.length ? "unclosed token" : message);
    this.pos += s.length;
  }

  /** Index of `end` from the current position, or an "unclosed" error at `start`. */
  private until(end: string, start: number, what: string): number {
    const i = this.src.indexOf(end, this.pos);
    if (i < 0) this.fail(`unclosed ${what}`, start);
    return i;
  }

  // ─── prolog ───

  private xmlDecl(): void {
    const start = this.pos;
    const end = this.until("?>", start, "XML declaration");
    const body = this.src.slice(start + 5, end);
    const decl =
      /^[ \t\n]+version[ \t\n]*=[ \t\n]*(["'])1\.[0-9]+\1([ \t\n]+encoding[ \t\n]*=[ \t\n]*(["'])[A-Za-z][A-Za-z0-9._-]*\3)?([ \t\n]+standalone[ \t\n]*=[ \t\n]*(["'])(yes|no)\5)?[ \t\n]*$/;
    if (!decl.test(body)) this.fail("XML declaration not well-formed", start);
    this.pos = end + 2;
  }

  private doctype(): void {
    const start = this.pos;
    this.pos += 9;
    if (!this.space()) this.fail("expected whitespace after DOCTYPE");
    this.name();
    this.space();
    for (const keyword of ["SYSTEM", "PUBLIC"])
      if (this.src.startsWith(keyword, this.pos)) {
        this.pos += 6;
        for (let i = keyword === "PUBLIC" ? 2 : 1; i > 0; i--) {
          if (!this.space()) this.fail("expected whitespace");
          this.quoted();
        }
        this.space();
      }
    if (this.src[this.pos] === "[") {
      // the internal subset: skip it, minding quotes, comments and PIs, which may hold "]" or ">"
      this.pos++;
      for (;;) {
        if (this.pos >= this.src.length) this.fail("unclosed DOCTYPE", start);
        const c = this.src[this.pos];
        if (c === "]") break;
        if (c === '"' || c === "'") this.quoted();
        else if (this.src.startsWith("<!--", this.pos)) this.comment();
        else if (this.src.startsWith("<?", this.pos)) this.pi();
        else this.pos++;
      }
      this.pos++;
      this.space();
    }
    this.expect(">");
  }

  private quoted(): string {
    const q = this.src[this.pos];
    if (q !== '"' && q !== "'") this.fail("expected a quoted string");
    const start = this.pos++;
    const end = this.until(q, start, "string");
    this.pos = end + 1;
    return this.src.slice(start + 1, end);
  }

  // ─── markup ───

  private comment(): Comment {
    const start = this.pos;
    this.pos += 4;
    const end = this.until("--", start, "comment");
    if (!this.src.startsWith("-->", end)) this.fail('"--" is not allowed inside a comment', end);
    const data = this.src.slice(this.pos, end);
    this.pos = end + 3;
    return new Comment(this.doc, data);
  }

  private pi(): ProcessingInstruction {
    const start = this.pos;
    this.pos += 2;
    const target = this.name();
    if (target.toLowerCase() === "xml") this.fail("XML or text declaration not at start of entity", start);
    if (target.includes(":")) this.fail("a processing instruction target can't contain a colon", start + 2);
    let data = "";
    if (!this.src.startsWith("?>", this.pos)) {
      if (!this.space()) this.fail("expected whitespace after the processing instruction target");
      const end = this.until("?>", start, "processing instruction");
      data = this.src.slice(this.pos, end);
      this.pos = end;
    }
    this.pos += 2;
    return new ProcessingInstruction(this.doc, target, data);
  }

  private reference(): string {
    const start = this.pos;
    const end = this.src.indexOf(";", start);
    const body = end < 0 ? "" : this.src.slice(start + 1, end);
    let value: string | undefined;
    if (/^#[0-9]+$/.test(body)) value = this.charRef(Number.parseInt(body.slice(1), 10), start);
    else if (/^#x[0-9a-fA-F]+$/.test(body)) value = this.charRef(Number.parseInt(body.slice(2), 16), start);
    else if (body && !body.startsWith("#")) {
      NAME.lastIndex = start + 1;
      const m = NAME.exec(this.src);
      if (!m || NAME.lastIndex !== end) this.fail("not well-formed (invalid entity reference)", start);
      value = PREDEFINED[body];
      if (value === undefined) this.fail(`undefined entity &${body};`, start);
    }
    if (value === undefined) this.fail("not well-formed (invalid character or entity reference)", start);
    this.pos = end + 1;
    return value;
  }

  private charRef(code: number, at: number): string {
    const ok =
      code === 9 ||
      code === 10 ||
      code === 13 ||
      (code >= 0x20 && code <= 0xd7ff) ||
      (code >= 0xe000 && code <= 0xfffd) ||
      (code >= 0x10000 && code <= 0x10ffff);
    if (!ok) this.fail("reference to invalid character number", at);
    return String.fromCodePoint(code);
  }

  private attrValue(): string {
    const q = this.src[this.pos];
    if (q !== '"' && q !== "'") this.fail("expected a quoted attribute value");
    const start = this.pos++;
    let out = "";
    for (;;) {
      const c = this.src[this.pos];
      if (c === undefined) this.fail("unclosed attribute value", start);
      if (c === q) break;
      if (c === "<") this.fail('"<" is not allowed in an attribute value');
      if (c === "&") out += this.reference();
      else {
        // §3.3.3: each literal whitespace character becomes a space (line ends are already "\n")
        out += c === "\t" || c === "\n" ? " " : c;
        this.pos++;
      }
    }
    this.pos++;
    return out;
  }

  private element(parentScope: Scope | null, parent: Element | Document): Element {
    const start = this.pos;
    this.pos++;
    const qname = this.name();
    const raw: RawAttr[] = [];
    for (;;) {
      const spaced = this.space();
      const c = this.src[this.pos];
      if (c === ">" || c === "/") break;
      if (c === undefined) this.fail("unclosed token", start);
      if (!spaced) this.fail("expected whitespace between attributes");
      const at = this.pos;
      const name = this.name();
      this.space();
      this.expect("=", `expected "=" after attribute ${name}`);
      this.space();
      const value = this.attrValue();
      if (raw.some((a) => a.name === name)) this.fail(`duplicate attribute ${name}`, at);
      raw.push({ name, value, at });
    }

    // namespace declarations first: they apply to the element's own name and attributes
    let prefixes: Map<string, string | null> | null = null;
    for (const a of raw) {
      const [prefix, local] = this.qname(a.name, a.at);
      if (a.name === "xmlns" || prefix === "xmlns") {
        const key = prefix === null ? "" : local;
        const ns = a.value;
        if (key === "xmlns") this.fail("the prefix xmlns can't be declared", a.at);
        if (key === "xml" ? ns !== XML_NS : ns === XML_NS) this.fail("the prefix xml is bound to its namespace only", a.at);
        if (ns === XMLNS_NS) this.fail("the xmlns namespace can't be declared", a.at);
        if (key && !ns) this.fail(`a prefix can't be undeclared (xmlns:${key}="")`, a.at);
        prefixes ??= new Map();
        prefixes.set(key, ns || null);
      }
    }
    const scope: Scope | null = prefixes ? { parent: parentScope, prefixes } : parentScope;
    const [prefix, localName] = this.qname(qname, start + 1);
    if (prefix === "xmlns") this.fail("the prefix xmlns is reserved", start + 1);
    const el = new Element(this.doc, this.resolve(scope, prefix ?? "", start + 1), prefix, localName);
    const seen = new Set<string>();
    for (const a of raw) {
      const [p, l] = this.qname(a.name, a.at);
      const ns = a.name === "xmlns" || p === "xmlns" ? XMLNS_NS : p === null ? null : this.resolve(scope, p, a.at);
      const key = `${ns ?? ""} ${l}`;
      if (seen.has(key)) this.fail(`duplicate attribute ${l} in namespace ${ns}`, a.at);
      seen.add(key);
      el.addAttribute(new Attr(this.doc, ns, p, l, a.value));
    }
    parent.appendChild(el);

    if (this.src[this.pos] === "/") {
      this.expect("/>");
      return el;
    }
    this.pos++;
    this.content(el, scope);
    const close = this.pos;
    this.pos += 2;
    NAME.lastIndex = this.pos;
    const m = NAME.exec(this.src);
    if (!m || m[0] !== qname) this.fail(`mismatched tag. Expected: </${qname}>.`, close);
    this.pos = NAME.lastIndex;
    this.space();
    this.expect(">");
    return el;
  }

  /** Content up to (not including) the element's end tag. */
  private content(el: Element, scope: Scope | null): void {
    const src = this.src;
    let text = "";
    const flush = () => {
      if (text) el.appendChild(new Text(this.doc, text));
      text = "";
    };
    for (;;) {
      const lt = src.indexOf("<", this.pos);
      const amp = src.indexOf("&", this.pos);
      const stop = lt < 0 ? (amp < 0 ? src.length : amp) : amp < 0 ? lt : Math.min(lt, amp);
      if (stop > this.pos) {
        const chunk = src.slice(this.pos, stop);
        const bad = chunk.indexOf("]]>");
        if (bad >= 0) this.fail('"]]>" is not allowed in text', this.pos + bad);
        text += chunk;
        this.pos = stop;
      }
      if (this.pos >= src.length) this.fail(`no element found: <${el.tagName}> is not closed`);
      if (src[this.pos] === "&") {
        text += this.reference();
        continue;
      }
      if (src.startsWith("</", this.pos)) break;
      if (src.startsWith("<!--", this.pos)) {
        flush();
        el.appendChild(this.comment());
      } else if (src.startsWith("<![CDATA[", this.pos)) {
        flush();
        const start = this.pos;
        this.pos += 9;
        const end = this.until("]]>", start, "CDATA section");
        el.appendChild(new CDATASection(this.doc, src.slice(this.pos, end)));
        this.pos = end + 3;
      } else if (src.startsWith("<?", this.pos)) {
        flush();
        el.appendChild(this.pi());
      } else if (src.startsWith("<!", this.pos)) {
        this.fail("syntax error");
      } else {
        flush();
        this.element(scope, el);
      }
    }
    flush();
  }

  /** A QName's prefix and local part (Namespaces §3: at most one colon, neither part empty). */
  private qname(name: string, at: number): [string | null, string] {
    const i = name.indexOf(":");
    if (i < 0) return [null, name];
    if (i === 0 || i === name.length - 1 || name.indexOf(":", i + 1) >= 0) this.fail(`not a qualified name: ${name}`, at);
    return [name.slice(0, i), name.slice(i + 1)];
  }

  /** The namespace a prefix ("" for the default) is bound to in `scope`. */
  private resolve(scope: Scope | null, prefix: string, at: number): string | null {
    if (prefix === "xml") return XML_NS;
    for (let s = scope; s; s = s.parent) if (s.prefixes.has(prefix)) return s.prefixes.get(prefix) ?? null;
    if (prefix) this.fail(`unbound prefix ${prefix}`, at);
    return null;
  }
}

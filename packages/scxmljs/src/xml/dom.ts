/**
 * A small, namespace-aware XML DOM: what `parseSCXML` returns when the
 * environment has no `DOMParser` of its own (Node, Bun, Deno).
 *
 * It implements the part of the DOM Standard the library and chart code use,
 * with the Standard's semantics. Audited uses on parsed SCXML documents
 * (packages/scxmljs/src, 2026-11-25):
 *
 * - session.ts: `getElementsByTagName("parsererror")`, `documentElement`,
 *   `textContent`, `getAttribute`, `namespaceURI`, `localName`, `children`,
 *   `nodeType`, `cloneNode(deep)`, `appendChild`;
 * - model.ts, diagnostics.ts: `children`, `namespaceURI`, `localName`,
 *   `getAttribute`, `hasAttribute`, `textContent`, `getElementsByTagNameNS`;
 * - element-events.ts (`reflect`, `elementEvents`): `setAttribute`,
 *   `removeAttribute`, `ownerDocument` (its `defaultView`), `dispatchEvent`;
 * - datamodel-base.ts / datamodel-trusted.ts: `nodeType`, `nodeName`,
 *   `cloneNode(true)` (XML values are handed to trusted chart code as they
 *   are, so chart code may use any of the API below);
 * - datamodel-quickjs.ts: `nodeType`, `documentElement`, `nodeValue`,
 *   `localName`, `prefix`, `namespaceURI`, `attributes` (iterable, `name`,
 *   `value`), `childNodes`;
 * - view/describe.ts: `previousSibling`, `nodeType`, `nodeValue` (comments
 *   before a state).
 *
 * Besides those: the tree accessors (`parentNode`, `parentElement`,
 * `firstChild`, `lastChild`, `nextSibling`, `firstElementChild`, …),
 * `insertBefore` / `removeChild` / `replaceChild` / `remove`, the attribute
 * methods with and without namespaces, `lookupNamespaceURI`, `isEqualNode`,
 * `contains`, `normalize`, the `create*` factories of `Document`, and
 * `XMLSerializer`.
 *
 * Left out on purpose: selectors (`querySelector`, `closest`, `matches`),
 * live collections (`children` and `getElementsByTagName*` return fresh
 * arrays), `DocumentType` and `DocumentFragment` nodes, mutation observers,
 * ranges, `baseURI`, and event propagation: nodes are `EventTarget`s where
 * the runtime has one, but an event dispatched on a node does not bubble to
 * its ancestors.
 */

export const XML_NS = "http://www.w3.org/XML/1998/namespace";
export const XMLNS_NS = "http://www.w3.org/2000/xmlns/";

/** `EventTarget` where the runtime has one (every current one does). */
const Base: typeof EventTarget = typeof EventTarget === "function" ? EventTarget : (class {} as unknown as typeof EventTarget);

function domError(message: string, name: string): Error {
  return typeof DOMException === "function" ? new DOMException(message, name) : new Error(`${name}: ${message}`);
}

/** An array with the `item()` of `NodeList` / `HTMLCollection`. */
export class NodeArray<T> extends Array<T> {
  item(index: number): T | null {
    return this[index] ?? null;
  }
}

function nodeArray<T>(items: Iterable<T>): NodeArray<T> {
  const out = new NodeArray<T>();
  for (const i of items) out.push(i);
  return out;
}

export abstract class Node extends Base {
  static readonly ELEMENT_NODE = 1;
  static readonly ATTRIBUTE_NODE = 2;
  static readonly TEXT_NODE = 3;
  static readonly CDATA_SECTION_NODE = 4;
  static readonly PROCESSING_INSTRUCTION_NODE = 7;
  static readonly COMMENT_NODE = 8;
  static readonly DOCUMENT_NODE = 9;

  abstract readonly nodeType: number;
  abstract readonly nodeName: string;
  /** The node's parent, or null. */
  parentNode: ParentNode | null = null;
  /** The children (live: the array the node keeps; change it through the methods). */
  readonly childNodes: NodeArray<ChildNode> = new NodeArray<ChildNode>();
  ownerDocument: Document | null;

  constructor(ownerDocument: Document | null) {
    super();
    this.ownerDocument = ownerDocument;
  }

  get parentElement(): Element | null {
    return this.parentNode instanceof Element ? this.parentNode : null;
  }
  get firstChild(): ChildNode | null {
    return this.childNodes[0] ?? null;
  }
  get lastChild(): ChildNode | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }
  get previousSibling(): ChildNode | null {
    const siblings = this.parentNode?.childNodes;
    return siblings?.[siblings.indexOf(this as unknown as ChildNode) - 1] ?? null;
  }
  get nextSibling(): ChildNode | null {
    const siblings = this.parentNode?.childNodes;
    if (!siblings) return null;
    return siblings[siblings.indexOf(this as unknown as ChildNode) + 1] ?? null;
  }
  get nodeValue(): string | null {
    return null;
  }
  set nodeValue(_v: string | null) {}
  get textContent(): string | null {
    return null;
  }
  set textContent(_v: string | null) {}

  hasChildNodes(): boolean {
    return this.childNodes.length > 0;
  }

  /** Whether `other` is this node or one of its descendants. */
  contains(other: Node | null): boolean {
    for (let n: Node | null = other; n; n = n.parentNode) if (n === this) return true;
    return false;
  }

  appendChild<T extends ChildNode>(node: T): T {
    return this.insertBefore(node, null);
  }

  insertBefore<T extends ChildNode>(node: T, ref: ChildNode | null): T {
    if (!(this instanceof Element || this instanceof Document)) throw domError("This node can't have children", "HierarchyRequestError");
    if (node.contains(this)) throw domError("The new child contains the parent", "HierarchyRequestError");
    if (ref && ref.parentNode !== this) throw domError("The reference node is not a child of this node", "NotFoundError");
    if (this instanceof Document && !(node instanceof Comment || node instanceof ProcessingInstruction)) {
      if (!(node instanceof Element) || (this.documentElement && this.documentElement !== node))
        throw domError("A document has one element child and no text", "HierarchyRequestError");
    }
    if (ref === node) ref = node.nextSibling;
    node.parentNode?.removeChild(node);
    adopt(node, this.ownerDocument ?? (this as unknown as Document));
    node.parentNode = this as unknown as ParentNode;
    const at = ref ? this.childNodes.indexOf(ref) : this.childNodes.length;
    this.childNodes.splice(at, 0, node);
    return node;
  }

  removeChild<T extends ChildNode>(node: T): T {
    const at = this.childNodes.indexOf(node);
    if (at < 0) throw domError("The node is not a child of this node", "NotFoundError");
    this.childNodes.splice(at, 1);
    node.parentNode = null;
    return node;
  }

  replaceChild<T extends ChildNode>(node: ChildNode, old: T): T {
    if ((old.parentNode as Node | null) !== this) throw domError("The node to replace is not a child of this node", "NotFoundError");
    if (node !== old) {
      this.insertBefore(node, old);
      this.removeChild(old);
    }
    return old;
  }

  /** Merges adjacent Text nodes (not CDATA sections) and drops empty ones, in the whole subtree. */
  normalize(): void {
    for (let i = 0; i < this.childNodes.length; i++) {
      const c = this.childNodes[i]!;
      if (c.nodeType !== 3) {
        c.normalize();
        continue;
      }
      const t = c as Text;
      let next = t.nextSibling;
      while (next && next.nodeType === 3) {
        t.data += (next as Text).data;
        this.removeChild(next);
        next = t.nextSibling;
      }
      if (!t.data) {
        this.removeChild(t);
        i--;
      }
    }
  }

  abstract cloneNode(deep?: boolean): Node;

  /** DOM Standard "locate a namespace". */
  lookupNamespaceURI(prefix: string | null): string | null {
    const p = prefix || null;
    if (this instanceof Document) return this.documentElement?.lookupNamespaceURI(p) ?? null;
    let el: Element | null = this instanceof Element ? this : this.parentElement;
    if (p === "xml") return XML_NS;
    if (p === "xmlns") return XMLNS_NS;
    for (; el; el = el.parentElement) {
      if (el.namespaceURI !== null && el.prefix === p) return el.namespaceURI;
      const decl = p === null ? el.getAttributeNodeNS(XMLNS_NS, "xmlns") : el.getAttributeNodeNS(XMLNS_NS, p);
      if (decl && (p === null ? decl.prefix === null : decl.prefix === "xmlns")) return decl.value || null;
    }
    return null;
  }

  /** DOM Standard "node equals". */
  isEqualNode(other: Node | null): boolean {
    if (!other || other.nodeType !== this.nodeType || other.nodeName !== this.nodeName) return false;
    if (this instanceof Element) {
      const o = other as Element;
      if (this.namespaceURI !== o.namespaceURI || this.prefix !== o.prefix || this.localName !== o.localName) return false;
      if (this.attributes.length !== o.attributes.length) return false;
      for (const a of this.attributes) if (o.getAttributeNS(a.namespaceURI, a.localName) !== a.value) return false;
    } else if (this instanceof CharacterData) {
      if (this.data !== (other as CharacterData).data) return false;
      if (this instanceof ProcessingInstruction && this.target !== (other as ProcessingInstruction).target) return false;
    }
    if (this.childNodes.length !== other.childNodes.length) return false;
    return this.childNodes.every((c, i) => c.isEqualNode(other.childNodes[i]!));
  }

  isSameNode(other: Node | null): boolean {
    return this === other;
  }
}

function adopt(node: Node, doc: Document): void {
  if (node.ownerDocument === doc) return;
  node.ownerDocument = doc;
  if (node instanceof Element) for (const a of node.attributes) a.ownerDocument = doc;
  for (const c of node.childNodes) adopt(c, doc);
}

/** An attribute. Not a tree node: it lives in its element's `attributes`. */
export class Attr {
  readonly nodeType = 2;
  readonly namespaceURI: string | null;
  readonly prefix: string | null;
  readonly localName: string;
  value: string;
  ownerElement: Element | null = null;
  ownerDocument: Document | null;
  readonly specified = true;

  constructor(doc: Document | null, ns: string | null, prefix: string | null, localName: string, value: string) {
    this.ownerDocument = doc;
    this.namespaceURI = ns;
    this.prefix = prefix;
    this.localName = localName;
    this.value = value;
  }
  get name(): string {
    return this.prefix ? `${this.prefix}:${this.localName}` : this.localName;
  }
  get nodeName(): string {
    return this.name;
  }
  get nodeValue(): string {
    return this.value;
  }
  set nodeValue(v: string) {
    this.value = String(v);
  }
  get textContent(): string {
    return this.value;
  }
  set textContent(v: string) {
    this.value = String(v);
  }
}

/** `Element.attributes`: an array of `Attr` with `NamedNodeMap`'s lookups. */
export class NamedNodeMap extends NodeArray<Attr> {
  getNamedItem(name: string): Attr | null {
    return this.find((a) => a.name === name) ?? null;
  }
  getNamedItemNS(ns: string | null, localName: string): Attr | null {
    const n = ns || null;
    return this.find((a) => a.namespaceURI === n && a.localName === localName) ?? null;
  }
}

function splitName(qualifiedName: string): [string | null, string] {
  const i = qualifiedName.indexOf(":");
  return i < 0 ? [null, qualifiedName] : [qualifiedName.slice(0, i), qualifiedName.slice(i + 1)];
}

function descendants(root: Node, out: NodeArray<Element>, test: (e: Element) => boolean): NodeArray<Element> {
  for (const c of root.childNodes)
    if (c instanceof Element) {
      if (test(c)) out.push(c);
      descendants(c, out, test);
    }
  return out;
}

function byTagName(root: Node, qualifiedName: string): NodeArray<Element> {
  return descendants(root, new NodeArray<Element>(), (e) => qualifiedName === "*" || e.tagName === qualifiedName);
}

function byTagNameNS(root: Node, ns: string | null, localName: string): NodeArray<Element> {
  const n = ns || null;
  return descendants(
    root,
    new NodeArray<Element>(),
    (e) => (ns === "*" || e.namespaceURI === n) && (localName === "*" || e.localName === localName),
  );
}

function textOf(node: Node): string {
  let s = "";
  for (const c of node.childNodes)
    if (c instanceof Element) s += textOf(c);
    else if (c.nodeType === 3 || c.nodeType === 4) s += (c as Text).data;
  return s;
}

export class Element extends Node {
  readonly nodeType = 1;
  readonly namespaceURI: string | null;
  readonly prefix: string | null;
  readonly localName: string;
  readonly attributes: NamedNodeMap = new NamedNodeMap();

  constructor(doc: Document | null, ns: string | null, prefix: string | null, localName: string) {
    super(doc);
    this.namespaceURI = ns;
    this.prefix = prefix;
    this.localName = localName;
  }
  get tagName(): string {
    return this.prefix ? `${this.prefix}:${this.localName}` : this.localName;
  }
  get nodeName(): string {
    return this.tagName;
  }
  override get textContent(): string {
    return textOf(this);
  }
  override set textContent(v: string | null) {
    for (const c of [...this.childNodes]) this.removeChild(c);
    if (v != null && v !== "") this.appendChild(new Text(this.ownerDocument, String(v)));
  }

  get children(): NodeArray<Element> {
    return nodeArray(this.childNodes.filter((c): c is Element => c instanceof Element));
  }
  get childElementCount(): number {
    return this.children.length;
  }
  get firstElementChild(): Element | null {
    return this.childNodes.find((c): c is Element => c instanceof Element) ?? null;
  }
  get lastElementChild(): Element | null {
    return this.children.at(-1) ?? null;
  }
  get nextElementSibling(): Element | null {
    for (let n = this.nextSibling; n; n = n.nextSibling) if (n instanceof Element) return n;
    return null;
  }
  get previousElementSibling(): Element | null {
    for (let n = this.previousSibling; n; n = n.previousSibling) if (n instanceof Element) return n;
    return null;
  }

  hasAttributes(): boolean {
    return this.attributes.length > 0;
  }
  getAttributeNames(): string[] {
    return this.attributes.map((a) => a.name);
  }
  getAttributeNode(name: string): Attr | null {
    return this.attributes.getNamedItem(name);
  }
  getAttributeNodeNS(ns: string | null, localName: string): Attr | null {
    return this.attributes.getNamedItemNS(ns, localName);
  }
  getAttribute(name: string): string | null {
    return this.getAttributeNode(name)?.value ?? null;
  }
  getAttributeNS(ns: string | null, localName: string): string | null {
    return this.getAttributeNodeNS(ns, localName)?.value ?? null;
  }
  hasAttribute(name: string): boolean {
    return this.getAttributeNode(name) !== null;
  }
  hasAttributeNS(ns: string | null, localName: string): boolean {
    return this.getAttributeNodeNS(ns, localName) !== null;
  }
  /** Sets the first attribute named `name`, or adds one in no namespace. */
  setAttribute(name: string, value: string): void {
    const a = this.getAttributeNode(name);
    if (a) a.value = String(value);
    else this.#add(new Attr(this.ownerDocument, null, null, name, String(value)));
  }
  setAttributeNS(ns: string | null, qualifiedName: string, value: string): void {
    const [prefix, localName] = splitName(qualifiedName);
    const n = ns || null;
    if ((prefix !== null && n === null) || (prefix === "xml" && n !== XML_NS))
      throw domError(`Invalid namespace for ${qualifiedName}`, "NamespaceError");
    if ((qualifiedName === "xmlns" || prefix === "xmlns") !== (n === XMLNS_NS))
      throw domError(`Invalid namespace for ${qualifiedName}`, "NamespaceError");
    const a = this.getAttributeNodeNS(n, localName);
    if (a) a.value = String(value);
    else this.#add(new Attr(this.ownerDocument, n, prefix, localName, String(value)));
  }
  removeAttribute(name: string): void {
    const a = this.getAttributeNode(name);
    if (a) this.#remove(a);
  }
  removeAttributeNS(ns: string | null, localName: string): void {
    const a = this.getAttributeNodeNS(ns, localName);
    if (a) this.#remove(a);
  }
  /** Adds a parsed attribute (the parser has checked it is not a duplicate). */
  #add(a: Attr): void {
    a.ownerElement = this;
    this.attributes.push(a);
  }
  #remove(a: Attr): void {
    this.attributes.splice(this.attributes.indexOf(a), 1);
    a.ownerElement = null;
  }
  /** @internal for the parser and cloneNode */
  addAttribute(a: Attr): void {
    this.#add(a);
  }

  getElementsByTagName(qualifiedName: string): NodeArray<Element> {
    return byTagName(this, qualifiedName);
  }
  getElementsByTagNameNS(ns: string | null, localName: string): NodeArray<Element> {
    return byTagNameNS(this, ns, localName);
  }

  /** Removes this element from its parent. */
  remove(): void {
    this.parentNode?.removeChild(this);
  }

  cloneNode(deep = false): Element {
    const el = new Element(this.ownerDocument, this.namespaceURI, this.prefix, this.localName);
    for (const a of this.attributes) el.addAttribute(new Attr(this.ownerDocument, a.namespaceURI, a.prefix, a.localName, a.value));
    if (deep) for (const c of this.childNodes) el.appendChild(c.cloneNode(true));
    return el;
  }
}

export abstract class CharacterData extends Node {
  data: string;
  constructor(doc: Document | null, data: string) {
    super(doc);
    this.data = data;
  }
  get length(): number {
    return this.data.length;
  }
  override get nodeValue(): string {
    return this.data;
  }
  override set nodeValue(v: string | null) {
    this.data = v ?? "";
  }
  override get textContent(): string {
    return this.data;
  }
  override set textContent(v: string | null) {
    this.data = v ?? "";
  }
  remove(): void {
    this.parentNode?.removeChild(this as unknown as ChildNode);
  }
}

export class Text extends CharacterData {
  readonly nodeType: number = 3;
  get nodeName(): string {
    return "#text";
  }
  cloneNode(): Text {
    return new Text(this.ownerDocument, this.data);
  }
}

export class CDATASection extends Text {
  override readonly nodeType: number = 4;
  override get nodeName(): string {
    return "#cdata-section";
  }
  override cloneNode(): CDATASection {
    return new CDATASection(this.ownerDocument, this.data);
  }
}

export class Comment extends CharacterData {
  readonly nodeType = 8;
  get nodeName(): string {
    return "#comment";
  }
  cloneNode(): Comment {
    return new Comment(this.ownerDocument, this.data);
  }
}

export class ProcessingInstruction extends CharacterData {
  readonly nodeType = 7;
  readonly target: string;
  constructor(doc: Document | null, target: string, data: string) {
    super(doc, data);
    this.target = target;
  }
  get nodeName(): string {
    return this.target;
  }
  cloneNode(): ProcessingInstruction {
    return new ProcessingInstruction(this.ownerDocument, this.target, this.data);
  }
}

export class Document extends Node {
  readonly nodeType = 9;
  readonly contentType: string;
  /** No browsing context: `null`, as for a document from a browser's `DOMParser`… without a window. */
  readonly defaultView = null;

  constructor(contentType = "application/xml") {
    super(null);
    this.contentType = contentType;
  }
  get nodeName(): string {
    return "#document";
  }
  get documentElement(): Element | null {
    return this.childNodes.find((c): c is Element => c instanceof Element) ?? null;
  }
  get children(): NodeArray<Element> {
    const root = this.documentElement;
    return nodeArray(root ? [root] : []);
  }
  getElementsByTagName(qualifiedName: string): NodeArray<Element> {
    return byTagName(this, qualifiedName);
  }
  getElementsByTagNameNS(ns: string | null, localName: string): NodeArray<Element> {
    return byTagNameNS(this, ns, localName);
  }
  createElement(localName: string): Element {
    return new Element(this, null, null, localName);
  }
  createElementNS(ns: string | null, qualifiedName: string): Element {
    const [prefix, localName] = splitName(qualifiedName);
    const n = ns || null;
    if (
      (prefix !== null && n === null) ||
      (prefix === "xml" && n !== XML_NS) ||
      (qualifiedName === "xmlns" || prefix === "xmlns") !== (n === XMLNS_NS)
    )
      throw domError(`Invalid namespace for ${qualifiedName}`, "NamespaceError");
    return new Element(this, n, prefix, localName);
  }
  createTextNode(data: string): Text {
    return new Text(this, String(data));
  }
  createCDATASection(data: string): CDATASection {
    if (data.includes("]]>")) throw domError('A CDATA section can\'t contain "]]>"', "InvalidCharacterError");
    return new CDATASection(this, String(data));
  }
  createComment(data: string): Comment {
    return new Comment(this, String(data));
  }
  createProcessingInstruction(target: string, data: string): ProcessingInstruction {
    if (data.includes("?>")) throw domError('A processing instruction can\'t contain "?>"', "InvalidCharacterError");
    return new ProcessingInstruction(this, target, String(data));
  }
  importNode<T extends ChildNode>(node: T, deep = false): T {
    const copy = node.cloneNode(deep) as T;
    adopt(copy, this);
    return copy;
  }
  cloneNode(deep = false): Document {
    const doc = new Document(this.contentType);
    if (deep) for (const c of this.childNodes) doc.appendChild(doc.importNode(c, true));
    return doc;
  }
}

/** A node that can be a child: everything but `Document` (and `Attr`, which is not a tree node here). */
export type ChildNode = Element | Text | Comment | ProcessingInstruction;
/** A node that can have children. */
export type ParentNode = Element | Document;

// ──────────────────────────────── serializer ─────────────────────────────────

const escapeText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\t/g, "&#9;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;");

/**
 * Serializes a node as XML, like `XMLSerializer` (DOM Parsing): attributes as
 * they are, plus the namespace declarations an element or attribute needs
 * that no ancestor (or attribute of its own) declares.
 */
export class XMLSerializer {
  serializeToString(node: Node): string {
    return serialize(node, new Map([["xml", XML_NS]]));
  }
}

function serialize(node: Node, scope: Map<string, string | null>): string {
  switch (node.nodeType) {
    case 9:
      return node.childNodes.map((c) => serialize(c, scope)).join("");
    case 3:
      return escapeText((node as Text).data);
    case 4:
      return `<![CDATA[${(node as CDATASection).data}]]>`;
    case 8:
      return `<!--${(node as Comment).data}-->`;
    case 7:
      return `<?${(node as ProcessingInstruction).target} ${(node as ProcessingInstruction).data}?>`;
  }
  const el = node as Element;
  const inner = new Map(scope);
  for (const a of el.attributes) if (a.namespaceURI === XMLNS_NS) inner.set(a.prefix === null ? "" : a.localName, a.value || null);
  let attrs = "";
  const declare = (prefix: string | null, ns: string | null) => {
    if ((inner.get(prefix ?? "") ?? null) === ns || prefix === "xml") return;
    inner.set(prefix ?? "", ns);
    attrs += prefix ? ` xmlns:${prefix}="${escapeAttr(ns ?? "")}"` : ` xmlns="${escapeAttr(ns ?? "")}"`;
  };
  declare(el.prefix, el.namespaceURI);
  for (const a of el.attributes) if (a.prefix && a.namespaceURI !== XMLNS_NS) declare(a.prefix, a.namespaceURI);
  for (const a of el.attributes) attrs += ` ${a.name}="${escapeAttr(a.value)}"`;
  const body = el.childNodes.map((c) => serialize(c, inner)).join("");
  return body ? `<${el.tagName}${attrs}>${body}</${el.tagName}>` : `<${el.tagName}${attrs}/>`;
}

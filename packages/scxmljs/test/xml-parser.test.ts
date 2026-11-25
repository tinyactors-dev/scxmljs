import { describe, expect, test } from "bun:test";
import { createSession, parseSCXML, SCXMLParseError } from "../src/index.ts";
import {
  CDATASection,
  type Comment,
  DOMParser,
  type Document,
  type Element,
  PARSERERROR_NS,
  type ProcessingInstruction,
  Text,
  XMLSerializer,
} from "../src/xml/index.ts";

const SCXML_NS = "http://www.w3.org/2005/07/scxml";
const parser = new DOMParser();
const parse = (s: string): Document => parser.parseFromString(s, "application/xml");
const root = (s: string): Element => {
  const doc = parse(s);
  const err = doc.getElementsByTagName("parsererror")[0];
  if (err) throw new Error(err.textContent);
  return doc.documentElement!;
};
const serialize = (n: Parameters<XMLSerializer["serializeToString"]>[0]) => new XMLSerializer().serializeToString(n);

/** The parsererror's message, or null for a well-formed document. */
function error(s: string): string | null {
  const doc = parse(s);
  const el = doc.documentElement;
  if (el?.localName !== "parsererror") return null;
  expect(el.namespaceURI).toBe(PARSERERROR_NS);
  expect(doc.getElementsByTagName("parsererror")).toHaveLength(1);
  return el.firstChild!.textContent;
}

describe("DOMParser", () => {
  test("parses application/xml and text/xml; refuses other types naming the supported ones", () => {
    expect(parser.parseFromString("<a/>", "application/xml").documentElement!.localName).toBe("a");
    expect(parser.parseFromString("<a/>", "text/xml").contentType).toBe("text/xml");
    expect(() => parser.parseFromString("<a/>", "text/html")).toThrow(TypeError);
    expect(() => parser.parseFromString("<a/>", "image/svg+xml")).toThrow(/application\/xml, text\/xml/);
  });
});

describe("well-formed documents", () => {
  test("elements, attributes in both quote styles, nesting", () => {
    const r = root(`<a x="1" y='two "2"'><b/><c>t</c></a>`);
    expect(r.tagName).toBe("a");
    expect(r.getAttribute("x")).toBe("1");
    expect(r.getAttribute("y")).toBe('two "2"');
    expect(r.getAttribute("z")).toBeNull();
    expect(r.hasAttribute("x")).toBe(true);
    expect(r.children.map((c) => c.localName)).toEqual(["b", "c"]);
    expect(r.children[1]!.textContent).toBe("t");
    expect(r.attributes.length).toBe(2);
    expect(Array.from(r.attributes, (a) => [a.name, a.value])).toEqual([
      ["x", "1"],
      ["y", 'two "2"'],
    ]);
  });

  test("whitespace in text is kept exactly; line ends are normalized to \\n", () => {
    const r = root("<a>\n  x\t y  \r\n z\r</a>");
    expect(r.textContent).toBe("\n  x\t y  \n z\n");
    expect(r.childNodes).toHaveLength(1);
  });

  test("whitespace in attribute values becomes spaces; character references to it don't", () => {
    expect(root('<a v="a\tb\nc\r\nd"/>').getAttribute("v")).toBe("a b c d");
    expect(root('<a v="a&#9;b&#10;c&#xD;"/>').getAttribute("v")).toBe("a\tb\nc\r");
  });

  test("the five predefined entities and character references, in text and attributes", () => {
    const r = root(`<a v="&lt;&gt;&amp;&apos;&quot;&#65;&#x42;&#x1F600;">&lt;&gt;&amp;&apos;&quot;&#65;&#x42;&#x1f600;</a>`);
    expect(r.getAttribute("v")).toBe(`<>&'"AB😀`);
    expect(r.textContent).toBe(`<>&'"AB😀`);
    expect(r.childNodes).toHaveLength(1); // references don't split text
  });

  test("CDATA sections are nodes of their own, their text untouched", () => {
    const r = root("<a>x<![CDATA[ <b>&amp; ]] > ]]>y</a>");
    expect(r.childNodes.map((n) => n.nodeType)).toEqual([3, 4, 3]);
    expect(r.childNodes[1]).toBeInstanceOf(CDATASection);
    expect((r.childNodes[1] as CDATASection).data).toBe(" <b>&amp; ]] > ");
    expect(r.childNodes[1]!.nodeName).toBe("#cdata-section");
    expect(r.textContent).toBe("x <b>&amp; ]] > y");
  });

  test("comments and processing instructions are kept; the XML declaration is not a node", () => {
    const doc = parse(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<!-- before --><?app go?><a><!-- in --><?p  data ?></a><!--after-->`,
    );
    expect(doc.childNodes.map((n) => n.nodeName)).toEqual(["#comment", "app", "a", "#comment"]);
    expect((doc.childNodes[0] as Comment).data).toBe(" before ");
    const pi = doc.childNodes[1] as ProcessingInstruction;
    expect([pi.nodeType, pi.target, pi.data]).toEqual([7, "app", "go"]);
    const a = doc.documentElement!;
    expect(a.childNodes.map((n) => n.nodeType)).toEqual([8, 7]);
    expect((a.childNodes[1] as ProcessingInstruction).data).toBe("data ");
    expect(root("<a><?empty?></a>").firstChild!.nodeValue).toBe("");
  });

  test("a byte order mark and a DOCTYPE with an internal subset are skipped", () => {
    const doc = parse(
      `﻿<?xml version="1.0"?><!DOCTYPE scxml PUBLIC "-//x//EN" "x.dtd" [\n <!ENTITY e "]>">\n <!-- ] > --> <?pi ]>?> <!ATTLIST a b CDATA "c">\n]>\n<scxml/>`,
    );
    expect(doc.documentElement!.localName).toBe("scxml");
    expect(doc.childNodes).toHaveLength(1);
    expect(root("<!DOCTYPE a><a/>").localName).toBe("a");
    expect(root('<!DOCTYPE a SYSTEM "a.dtd"><a/>').localName).toBe("a");
  });

  test("surrogate pairs and non-ASCII names", () => {
    const r = root(`<données été="ça">𝄞</données>`);
    expect(r.localName).toBe("données");
    expect(r.getAttribute("été")).toBe("ça");
    expect(r.textContent).toBe("𝄞");
  });
});

describe("namespaces", () => {
  test("default namespace, prefixes, undeclaring the default", () => {
    const r = root(
      `<scxml xmlns="${SCXML_NS}" xmlns:c="urn:c"><c:x c:a="1" b="2"/><y xmlns=""><z/></y><w xmlns="urn:w" xmlns:c="urn:c2"><c:v/></w></scxml>`,
    );
    expect(r.namespaceURI).toBe(SCXML_NS);
    expect(r.prefix).toBeNull();
    const [x, y, w] = r.children;
    expect([x!.namespaceURI, x!.prefix, x!.localName, x!.tagName]).toEqual(["urn:c", "c", "x", "c:x"]);
    expect(x!.getAttributeNS("urn:c", "a")).toBe("1");
    expect(x!.getAttribute("c:a")).toBe("1");
    expect(x!.getAttributeNode("b")!.namespaceURI).toBeNull(); // unprefixed attributes are in no namespace
    expect(y!.namespaceURI).toBeNull();
    expect(y!.firstElementChild!.namespaceURI).toBeNull();
    expect(w!.namespaceURI).toBe("urn:w");
    expect(w!.firstElementChild!.namespaceURI).toBe("urn:c2");
  });

  test("namespace declarations are attributes in the xmlns namespace", () => {
    const r = root(`<a xmlns="urn:a" xmlns:p="urn:p"/>`);
    const [d, p] = r.attributes;
    expect([d!.namespaceURI, d!.prefix, d!.localName, d!.name, d!.value]).toEqual([
      "http://www.w3.org/2000/xmlns/",
      null,
      "xmlns",
      "xmlns",
      "urn:a",
    ]);
    expect([p!.namespaceURI, p!.prefix, p!.localName, p!.name]).toEqual(["http://www.w3.org/2000/xmlns/", "xmlns", "p", "xmlns:p"]);
    expect(r.getAttribute("xmlns")).toBe("urn:a"); // what parseSCXML's namespace check reads
  });

  test("the xml prefix is always bound", () => {
    const r = root(`<a xml:lang="en" xml:space="preserve"/>`);
    expect(r.getAttributeNS("http://www.w3.org/XML/1998/namespace", "lang")).toBe("en");
    expect(root(`<a xmlns:xml="http://www.w3.org/XML/1998/namespace"/>`).localName).toBe("a");
  });

  test("lookupNamespaceURI", () => {
    const r = root(`<a xmlns="urn:a" xmlns:p="urn:p"><b xmlns=""><c/></b></a>`);
    const c = r.getElementsByTagName("c")[0]!;
    expect(c.lookupNamespaceURI(null)).toBeNull();
    expect(c.lookupNamespaceURI("p")).toBe("urn:p");
    expect(c.lookupNamespaceURI("xml")).toBe("http://www.w3.org/XML/1998/namespace");
    expect(r.lookupNamespaceURI("")).toBe("urn:a");
    expect(r.lookupNamespaceURI("q")).toBeNull();
  });

  test("getElementsByTagName matches qualified names, getElementsByTagNameNS namespace and local name", () => {
    const r = root(`<a xmlns="urn:a" xmlns:p="urn:p"><p:b/><b/><c><b/></c></a>`);
    expect(r.getElementsByTagName("b")).toHaveLength(2);
    expect(r.getElementsByTagName("p:b")).toHaveLength(1);
    expect(r.getElementsByTagName("*")).toHaveLength(4);
    expect(r.getElementsByTagNameNS("urn:a", "b")).toHaveLength(2);
    expect(r.getElementsByTagNameNS("*", "b")).toHaveLength(3);
    expect(r.getElementsByTagNameNS("urn:p", "*").item(0)!.tagName).toBe("p:b");
    expect(r.ownerDocument!.getElementsByTagName("a")[0]).toBe(r);
  });
});

describe("well-formedness errors: a <parsererror> document with line and column", () => {
  const cases: [string, string, RegExp, number, number][] = [
    ["mismatched tag", "<a>\n  <b>\n  </c>\n</a>", /mismatched tag. Expected: <\/b>/, 3, 3],
    ["unclosed element", "<a>\n<b>", /not closed/, 2, 4],
    ["duplicate attribute", `<a x="1"\n   x="2"/>`, /duplicate attribute x/, 2, 4],
    ["duplicate expanded name", `<a xmlns:p="urn:x" xmlns:q="urn:x" p:y="1" q:y="2"/>`, /duplicate attribute y in namespace urn:x/, 1, 44],
    ["unbound element prefix", "<a>\n<p:b/></a>", /unbound prefix p/, 2, 2],
    ["unbound attribute prefix", `<a q:x="1"/>`, /unbound prefix q/, 1, 4],
    ["< in an attribute value", `<a x="a<b"/>`, /"<" is not allowed in an attribute value/, 1, 8],
    ["undefined entity", "<a>&nbsp;</a>", /undefined entity &nbsp;/, 1, 4],
    ["bare ampersand", "<a>fish & chips</a>", /invalid character or entity reference/, 1, 9],
    ["unterminated reference", "<a>&amp</a>", /invalid/, 1, 4],
    ["reference to an illegal character", "<a>&#0;</a>", /invalid character number/, 1, 4],
    ["reference to a surrogate", `<a x="&#xD800;"/>`, /invalid character number/, 1, 7],
    ["illegal character", "<a>\u0001</a>", /not a legal XML character \(U\+0001\)/, 1, 4],
    ["]]> in text", "<a>x ]]> y</a>", /"]]>" is not allowed in text/, 1, 6],
    ["-- in a comment", "<a><!-- x -- y --></a>", /"--" is not allowed inside a comment/, 1, 11],
    ["unclosed comment", "<a><!-- x", /unclosed comment/, 1, 4],
    ["unclosed CDATA", "<a><![CDATA[x", /unclosed CDATA section/, 1, 4],
    ["two root elements", "<a/>\n<b/>", /junk after document element/, 2, 1],
    ["text after the root", "<a/> x", /junk after document element/, 1, 6],
    ["text before the root", "x<a/>", /syntax error/, 1, 1],
    ["no root element", "<!-- only a comment -->", /no root element found/, 1, 24],
    ["empty document", "", /no root element found/, 1, 1],
    ["misplaced XML declaration", ` <?xml version="1.0"?><a/>`, /XML or text declaration not at start of entity/, 1, 2],
    ["bad XML declaration", `<?xml version="2"?><a/>`, /XML declaration not well-formed/, 1, 1],
    ["missing whitespace between attributes", `<a x="1"y="2"/>`, /whitespace between attributes/, 1, 9],
    ["attribute without a value", "<a x/>", /expected "=" after attribute x/, 1, 5],
    ["unquoted attribute value", "<a x=1/>", /quoted attribute value/, 1, 6],
    ["the xmlns prefix on an element", `<xmlns:a xmlns:xmlns="urn:x"/>`, /the prefix xmlns can't be declared/, 1, 10],
    ["undeclaring a prefix", `<a xmlns:p=""/>`, /can't be undeclared/, 1, 4],
    ["binding xml elsewhere", `<a xmlns:xml="urn:x"/>`, /the prefix xml is bound to its namespace only/, 1, 4],
    ["a QName with two colons", "<a:b:c/>", /not a qualified name: a:b:c/, 1, 2],
    ["a name starting with a digit", "<1a/>", /not a name/, 1, 2],
    ["two DOCTYPEs", "<!DOCTYPE a><!DOCTYPE a><a/>", /DOCTYPE is only allowed once/, 1, 13],
  ];
  for (const [name, source, message, line, column] of cases)
    test(name, () => {
      const text = error(source);
      expect(text).toMatch(/^XML Parsing Error: /);
      expect(text).toMatch(message);
      expect(text).toContain(`Line Number ${line}, Column ${column}:`);
    });

  test("the error shows the line and a caret under the column", () => {
    const doc = parse("<a>\n  <b></c>\n</a>");
    expect(doc.documentElement!.lastElementChild!.textContent).toBe("  <b></c>\n-----^");
  });

  test("parseSCXML reports it as SCXML_PARSE with the message, line and column", () => {
    let caught: unknown;
    try {
      parseSCXML(`<scxml xmlns="${SCXML_NS}">\n  <state id="a">\n</scxml>`, parser);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SCXMLParseError);
    expect((caught as SCXMLParseError).code).toBe("SCXML_PARSE");
    expect((caught as Error).message).toMatch(/mismatched tag. Expected: <\/state>.\nLine Number 3, Column 1/);
  });
});

describe("DOM", () => {
  test("tree accessors", () => {
    const r = root("<a>x<b/><!--c--><d/>y</a>");
    const [x, b, c, d, y] = r.childNodes;
    expect(r.firstChild).toBe(x!);
    expect(r.lastChild).toBe(y!);
    expect(b!.previousSibling).toBe(x!);
    expect(b!.nextSibling).toBe(c!);
    expect(x!.previousSibling).toBeNull();
    expect(y!.nextSibling).toBeNull();
    expect(r.firstElementChild).toBe(b as Element);
    expect(r.lastElementChild).toBe(d as Element);
    expect((b as Element).nextElementSibling).toBe(d as Element);
    expect((d as Element).previousElementSibling).toBe(b as Element);
    expect(r.childElementCount).toBe(2);
    expect(b!.parentNode).toBe(r);
    expect(b!.parentElement).toBe(r);
    expect(r.parentElement).toBeNull();
    expect(r.parentNode).toBe(r.ownerDocument);
    expect(r.childNodes.item(0)).toBe(x!);
    expect(r.contains(c!)).toBe(true);
    expect(c!.contains(r)).toBe(false);
    expect([x!.nodeName, c!.nodeName, r.ownerDocument!.nodeName]).toEqual(["#text", "#comment", "#document"]);
    expect([r.nodeValue, x!.nodeValue, r.ownerDocument!.textContent]).toEqual([null, "x", null]);
  });

  test("textContent, nodeValue and data can be set", () => {
    const r = root("<a>x<b>y</b></a>");
    r.firstChild!.nodeValue = "X";
    expect(r.textContent).toBe("Xy");
    (r.lastChild as Element).textContent = "";
    expect(r.lastChild!.childNodes).toHaveLength(0);
    r.textContent = "only";
    expect(r.childNodes).toHaveLength(1);
    expect(r.firstChild).toBeInstanceOf(Text);
    expect(serialize(r)).toBe("<a>only</a>");
  });

  test("attributes can be set and removed, with and without namespaces", () => {
    const r = root(`<a xmlns:p="urn:p" p:x="1"/>`);
    r.setAttribute("data-active", "");
    expect(r.hasAttribute("data-active")).toBe(true);
    r.setAttribute("data-active", "yes");
    expect(r.getAttribute("data-active")).toBe("yes");
    r.removeAttribute("data-active");
    expect(r.hasAttribute("data-active")).toBe(false);
    r.setAttributeNS("urn:p", "p:x", "2");
    expect(r.getAttribute("p:x")).toBe("2");
    expect(r.attributes).toHaveLength(2);
    r.removeAttributeNS("urn:p", "x");
    expect(r.hasAttributeNS("urn:p", "x")).toBe(false);
    expect(r.getAttributeNames()).toEqual(["xmlns:p"]);
    expect(() => r.setAttributeNS(null, "q:y", "1")).toThrow();
  });

  test("cloneNode, appendChild, insertBefore, removeChild, replaceChild", () => {
    const r = root(`<a k="v"><b><c/></b></a>`);
    const shallow = r.cloneNode(false);
    expect([shallow.childNodes.length, shallow.getAttribute("k"), shallow.parentNode]).toEqual([0, "v", null]);
    const deep = r.cloneNode(true);
    expect(deep.isEqualNode(r)).toBe(true);
    expect(deep.firstElementChild).not.toBe(r.firstElementChild);
    const b = r.firstElementChild!;
    const doc = r.ownerDocument!;
    const t = doc.createTextNode("t");
    r.insertBefore(t, b);
    expect(r.firstChild).toBe(t);
    r.appendChild(t); // moves it
    expect(r.childNodes.map((n) => n.nodeName)).toEqual(["b", "#text"]);
    const e = doc.createElementNS("urn:e", "e:x");
    expect(r.replaceChild(e, b)).toBe(b);
    expect(b.parentNode).toBeNull();
    expect(r.removeChild(t)).toBe(t);
    expect(serialize(r)).toBe(`<a k="v"><e:x xmlns:e="urn:e"/></a>`);
    expect(() => e.appendChild(r)).toThrow(); // a node can't contain its ancestor
    expect(() => r.removeChild(b)).toThrow();
    expect(deep.isEqualNode(r)).toBe(false);
  });

  test("normalize merges adjacent text and drops empty text", () => {
    const r = root("<a>x<![CDATA[c]]></a>");
    const doc = r.ownerDocument!;
    r.insertBefore(doc.createTextNode("y"), r.lastChild);
    r.appendChild(doc.createTextNode(""));
    r.normalize();
    expect(r.childNodes.map((n) => [n.nodeType, n.nodeValue])).toEqual([
      [3, "xy"],
      [4, "c"],
    ]);
  });

  test("Document factories and importNode", () => {
    const doc = parse("<a/>");
    const other = parse("<b><c x='1'/></b>");
    const c = doc.importNode(other.documentElement!.firstElementChild!, true);
    expect(c.ownerDocument).toBe(doc);
    doc.documentElement!.appendChild(c);
    doc.documentElement!.appendChild(doc.createComment("k"));
    doc.documentElement!.appendChild(doc.createProcessingInstruction("t", "d"));
    doc.documentElement!.appendChild(doc.createCDATASection("<>"));
    expect(serialize(doc)).toBe(`<a><c x="1"/><!--k--><?t d?><![CDATA[<>]]></a>`);
    expect(() => doc.appendChild(doc.createElement("second"))).toThrow();
  });

  test("nodes are EventTargets, so elementEvents can dispatch on them", () => {
    const r = root("<a/>");
    let fired = 0;
    r.addEventListener("x", () => fired++);
    r.dispatchEvent(new Event("x"));
    expect(fired).toBe(1);
  });
});

describe("round trips", () => {
  const sources = [
    `<scxml xmlns="${SCXML_NS}" version="1.0" initial="a"><state id="a"><transition event="go" target="b" cond="x &lt; 3 &amp;&amp; y &gt; 1"/></state><final id="b"/></scxml>`,
    `<a xmlns:p="urn:p"><p:b p:c="&quot;q&quot;">  t\n  </p:b><!-- c --><?pi x?><![CDATA[ <raw> ]]><e xmlns=""/></a>`,
    `<a v="&#9;&#10;&#13;"/>`,
  ];
  for (const s of sources)
    test(s.slice(0, 40), () => {
      const once = serialize(parse(s));
      expect(serialize(parse(once))).toBe(once);
      expect(parse(once).documentElement!.isEqualNode(parse(s).documentElement)).toBe(true);
    });

  test("attribute whitespace written as character references survives", () => {
    expect(root(serialize(root(`<a v="&#9;&#10;&#13;"/>`))).getAttribute("v")).toBe("\t\n\r");
  });
});

describe("parseSCXML falls back to the built-in parser", () => {
  test("without a DOMParser argument or global, text parses (Bun has no DOMParser)", async () => {
    expect(typeof (globalThis as { DOMParser?: unknown }).DOMParser).toBe("undefined");
    const el = parseSCXML(`<scxml xmlns="${SCXML_NS}" initial="a"><state id="a"/></scxml>`);
    expect(el.namespaceURI).toBe(SCXML_NS);
    const session = await createSession(
      `<scxml xmlns="${SCXML_NS}" initial="a" datamodel="ecmascript"><datamodel><data id="n" expr="1"/></datamodel><state id="a"><transition event="go" target="b"><assign location="n" expr="n + 1"/></transition></state><state id="b"/></scxml>`,
    );
    session.start();
    session.send("go");
    await Promise.resolve();
    expect(session.activeStateIds()).toContain("b");
    session.dispose();
  });

  test("an explicit domParser is still used first", () => {
    const calls: string[] = [];
    const spy = {
      parseFromString: (s: string, t: string) => {
        calls.push(t);
        return parser.parseFromString(s, t);
      },
    };
    parseSCXML(`<scxml xmlns="${SCXML_NS}"/>`, spy);
    expect(calls).toEqual(["application/xml"]);
  });
});

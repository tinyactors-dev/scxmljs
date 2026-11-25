/**
 * The XSD subset (src/data/xsd.ts) and `<scxml-data>` in happy-dom: a schema read into types,
 * values checked and made, and the form that edits them.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { defaultDataStrings } from "../src/data/strings.ts";
import { check, initialValue, readSchemas } from "../src/data/xsd.ts";
import type { ScxmlData } from "../src/data.ts";

const window = new Window({ url: "http://localhost/" });
const GLOBALS = [
  "window",
  "document",
  "HTMLElement",
  "customElements",
  "CSSStyleSheet",
  "DOMParser",
  "Event",
  "CSS",
  "getComputedStyle",
] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();

beforeAll(async () => {
  const w = window as unknown as Record<string, unknown>;
  for (const k of GLOBALS) {
    saved.set(k, Object.getOwnPropertyDescriptor(globalThis, k));
    let v = k === "window" ? window : w[k];
    if (typeof v === "function" && /^[a-z]/.test(k)) v = (v as (...a: unknown[]) => unknown).bind(window);
    Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  }
  await import("../src/data.ts");
});

afterAll(async () => {
  for (const [k, d] of saved) {
    if (d) Object.defineProperty(globalThis, k, d);
    else delete (globalThis as Record<string, unknown>)[k];
  }
  await window.happyDOM.abort();
  window.close();
});

const CHART = `<scxml xmlns="http://www.w3.org/2005/07/scxml" xmlns:xs="http://www.w3.org/2001/XMLSchema" version="1.0" datamodel="ecmascript" initial="cart">
  <xs:schema>
    <xs:element name="add">
      <xs:annotation><xs:documentation>Put an item in the cart.</xs:documentation></xs:annotation>
      <xs:complexType>
        <xs:sequence>
          <xs:element name="sku" type="Sku"/>
          <xs:element name="quantity" type="xs:positiveInteger" default="1"/>
          <xs:element name="note" type="xs:string" minOccurs="0"/>
          <xs:element name="tags" type="xs:string" minOccurs="0" maxOccurs="3"/>
        </xs:sequence>
        <xs:attribute name="gift" type="xs:boolean"/>
      </xs:complexType>
    </xs:element>
    <xs:element name="pay">
      <xs:complexType>
        <xs:choice>
          <xs:element name="card"><xs:complexType><xs:sequence>
            <xs:element name="number"><xs:simpleType><xs:restriction base="xs:string"><xs:pattern value="\\d{16}"/></xs:restriction></xs:simpleType></xs:element>
          </xs:sequence></xs:complexType></xs:element>
          <xs:element name="voucher" type="xs:string"/>
        </xs:choice>
      </xs:complexType>
    </xs:element>
    <xs:element name="ship" type="Address"/>
    <xs:element name="rate">
      <xs:simpleType><xs:restriction base="xs:decimal"><xs:minInclusive value="0"/><xs:maxExclusive value="5"/></xs:restriction></xs:simpleType>
    </xs:element>
    <xs:element name="tree" type="Node"/>
    <xs:simpleType name="Sku"><xs:restriction base="xs:string"><xs:enumeration value="tea"/><xs:enumeration value="mug"/></xs:restriction></xs:simpleType>
    <xs:complexType name="Address"><xs:sequence><xs:element name="city" type="xs:string"/><xs:element name="when" type="xs:date"/></xs:sequence></xs:complexType>
    <xs:complexType name="Node"><xs:sequence><xs:element name="children" type="Node" minOccurs="0" maxOccurs="unbounded"/></xs:sequence></xs:complexType>
  </xs:schema>
  <state id="cart"/>
</scxml>`;

const schema = () => readSchemas(new DOMParser().parseFromString(CHART, "application/xml") as unknown as Document);
const W = defaultDataStrings;

describe("readSchemas", () => {
  test("reads each top-level element as the event of that name", () => {
    const s = schema();
    expect([...s.elements.keys()].sort()).toEqual(["add", "pay", "rate", "ship", "tree"]);
    const add = s.elements.get("add")!;
    expect(add.doc).toBe("Put an item in the cart.");
    expect(add.type.kind).toBe("object");
    if (add.type.kind !== "object") return;
    const byName = Object.fromEntries(add.type.fields.map((f) => [f.name, f]));
    expect(byName.sku!.type).toEqual({ kind: "string", base: "string", facets: { enumeration: ["tea", "mug"] } });
    expect(byName.quantity!.type).toMatchObject({ kind: "number", integer: true, facets: { minInclusive: 1 } });
    expect(byName.note!.min).toBe(0);
    expect(byName.tags!.max).toBe(3);
    expect(byName.gift).toMatchObject({ min: 0, type: { kind: "boolean" } });
  });

  test("a choice, a named type, a facet range and a type that refers to itself", () => {
    const s = schema();
    expect(s.elements.get("pay")!.type.kind).toBe("choice");
    expect(s.elements.get("ship")!.type).toMatchObject({
      kind: "object",
      fields: [{ name: "city" }, { name: "when", type: { kind: "date" } }],
    });
    expect(s.elements.get("rate")!.type).toMatchObject({ kind: "number", integer: false, facets: { minInclusive: 0, maxExclusive: 5 } });
    const tree = s.elements.get("tree")!.type;
    expect(tree).toMatchObject({ kind: "object", fields: [{ name: "children", max: Number.POSITIVE_INFINITY }] });
  });
});

describe("check and initialValue", () => {
  test("a first value is valid where the schema allows one", () => {
    const s = schema();
    const add = s.elements.get("add")!;
    expect(initialValue(add)).toEqual({ sku: "tea", quantity: 1 });
    expect(check(add, initialValue(add), W)).toEqual([]);
    expect(initialValue(s.elements.get("pay")!)).toEqual({ card: { number: "" } });
  });

  test("each problem at its path", () => {
    const add = schema().elements.get("add")!;
    const problems = check(add, { sku: "spoon", quantity: 0.5, tags: ["a", "b", "c", "d"], gift: "yes" }, W);
    expect(problems.map((p) => p.path.join("/"))).toEqual(["sku", "quantity", "tags", "gift"]);
    expect(problems[0]!.message).toBe("One of tea, mug");
    expect(problems[1]!.message).toBe("A whole number");
    expect(check(add, {}, W).map((p) => p.message)).toEqual(["Required", "Required"]);
  });

  test("patterns match the whole value; dates have their form; exclusive bounds exclude", () => {
    const s = schema();
    const pay = s.elements.get("pay")!;
    expect(check(pay, { card: { number: "1234" } }, W).map((p) => p.message)).toEqual([W.pattern]);
    expect(check(pay, { card: { number: "1234567812345678" } }, W)).toEqual([]);
    expect(check(pay, { voucher: "X" }, W)).toEqual([]);
    expect(check(s.elements.get("ship")!, { city: "Oslo", when: "tomorrow" }, W).map((p) => p.path.join("/"))).toEqual(["when"]);
    expect(check(s.elements.get("rate")!, 5, W).map((p) => p.message)).toEqual(["Less than 5"]);
  });
});

const flush = () => new Promise((r) => setTimeout(r, 0));
async function mount(element: string, setup?: (el: ScxmlData) => void) {
  const el = document.createElement("scxml-data") as ScxmlData;
  el.setAttribute("element", element);
  el.schema = new DOMParser().parseFromString(CHART, "application/xml") as unknown as Document;
  setup?.(el);
  document.body.append(el);
  await flush();
  return el;
}
const q = <T extends Element>(el: ScxmlData, sel: string) => el.shadowRoot!.querySelector(sel) as unknown as T;
const qa = (el: ScxmlData, sel: string) => Array.from(el.shadowRoot!.querySelectorAll(sel)) as unknown as HTMLElement[];

describe("<scxml-data>", () => {
  test("draws a field per element and attribute; the first value is the schema's", async () => {
    const el = await mount("add");
    expect(el.value).toEqual({ sku: "tea", quantity: 1 });
    expect(el.valid).toBe(true);
    const names = qa(el, ".field > .name").map((n) => n.textContent);
    expect(names).toEqual(["sku", "quantity", "note", "tags", "gift"]);
    expect(q<HTMLSelectElement>(el, "select").value).toBe("tea");
    expect(q<HTMLInputElement>(el, 'input[type="number"]').min).toBe("1");
    el.remove();
  });

  test("typing changes the value and fires input; a problem shows once the field is left", async () => {
    const el = await mount("add");
    let inputs = 0;
    el.addEventListener("input", () => inputs++);
    const qty = q<HTMLInputElement>(el, 'input[type="number"]');
    qty.value = "0";
    qty.dispatchEvent(new Event("input"));
    expect(el.value).toEqual({ sku: "tea", quantity: 0 });
    expect(inputs).toBe(1);
    expect(el.valid).toBe(false);
    const problem = () => qa(el, ".problem").find((p) => !p.hidden);
    expect(problem()).toBeUndefined();
    qty.dispatchEvent(new Event("blur"));
    expect(problem()?.textContent).toBe("At least 1");
    expect(qty.getAttribute("aria-invalid")).toBe("true");
    el.remove();
  });

  test("an optional field is added and removed; a list grows to its bound", async () => {
    const el = await mount("add");
    const add = (label: string) => qa(el, "button.add").find((b) => b.getAttribute("aria-label") === label)!;
    add("Add note").click();
    expect(el.value).toEqual({ sku: "tea", quantity: 1, note: "" });
    for (let i = 0; i < 3; i++) add("Add tags").click();
    expect((el.value as { tags: string[] }).tags).toHaveLength(3);
    expect(add("Add tags")).toBeUndefined();
    qa(el, "button.remove")
      .find((b) => b.getAttribute("aria-label") === "Remove note")!
      .click();
    expect("note" in (el.value as object)).toBe(false);
    el.remove();
  });

  test("a choice switches its option; a value set from outside is shown", async () => {
    const el = await mount("pay", (e) => {
      e.value = { voucher: "WINTER" };
    });
    const select = q<HTMLSelectElement>(el, "select");
    expect(select.value).toBe("voucher");
    expect(q<HTMLInputElement>(el, 'input[type="text"]').value).toBe("WINTER");
    select.value = "card";
    select.dispatchEvent(new Event("change"));
    expect(el.value).toEqual({ card: { number: "" } });
    expect(el.reportValidity()).toBe(false);
    expect(
      qa(el, ".problem")
        .filter((p) => !p.hidden)
        .map((p) => p.textContent),
    ).toEqual([W.required]);
    el.remove();
  });

  test("read-only shows the value as text", async () => {
    const el = await mount("ship", (e) => {
      e.value = { city: "Oslo", when: "2026-12-01" };
      e.readOnly = true;
    });
    expect(qa(el, "input, select, textarea")).toHaveLength(0);
    expect(qa(el, ".value").map((v) => v.textContent)).toEqual(["Oslo", "2026-12-01"]);
    el.remove();
  });

  test("a type that refers to itself can be composed to any depth", async () => {
    const el = await mount("tree");
    qa(el, "button.add")[0]!.click();
    qa(el, "button.add")[0]!.click();
    expect(el.value).toEqual({ children: [{ children: [{}] }] });
    el.remove();
  });
});

const MORE = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="price" type="Price"/>
  <xs:element name="line">
    <xs:complexType>
      <xs:complexContent>
        <xs:extension base="Base">
          <xs:sequence>
            <xs:element ref="price"/>
            <xs:element name="sizes"><xs:simpleType><xs:list itemType="xs:integer"/></xs:simpleType></xs:element>
            <xs:element name="tags"><xs:simpleType><xs:list><xs:simpleType><xs:restriction base="xs:token"/></xs:simpleType></xs:list></xs:simpleType></xs:element>
            <xs:choice minOccurs="0">
              <xs:element name="email" type="xs:string"/>
              <xs:element name="phone" type="xs:string"/>
            </xs:choice>
            <xs:element name="code"><xs:simpleType><xs:restriction base="xs:string"><xs:length value="3"/></xs:restriction></xs:simpleType></xs:element>
            <xs:element name="note"><xs:simpleType><xs:restriction base="xs:string"><xs:minLength value="2"/><xs:maxLength value="4"/></xs:restriction></xs:simpleType></xs:element>
            <xs:element name="at" type="xs:dateTime"/>
            <xs:element name="open" type="xs:time"/>
            <xs:element name="ratio"><xs:simpleType><xs:restriction base="xs:double"><xs:minExclusive value="0"/><xs:maxInclusive value="1"/></xs:restriction></xs:simpleType></xs:element>
            <xs:element name="level"><xs:simpleType><xs:restriction base="xs:int"><xs:enumeration value="3"/><xs:enumeration value="5"/></xs:restriction></xs:simpleType></xs:element>
            <xs:element name="flag"><xs:simpleType><xs:restriction base="xs:boolean"/></xs:simpleType></xs:element>
            <xs:element name="anything"/>
            <xs:element name="unknown" type="tns:Nowhere"/>
            <xs:element name="union"><xs:simpleType><xs:union memberTypes="xs:int xs:string"/></xs:simpleType></xs:element>
          </xs:sequence>
          <xs:attribute name="kind" use="required"><xs:simpleType><xs:restriction base="xs:string"><xs:enumeration value="a"/></xs:restriction></xs:simpleType></xs:attribute>
          <xs:attribute name="version" type="xs:string" fixed="2"/>
          <xs:attribute ref="lang"/>
        </xs:extension>
      </xs:complexContent>
    </xs:complexType>
  </xs:element>
  <xs:complexType name="Price">
    <xs:simpleContent>
      <xs:extension base="xs:decimal"><xs:attribute name="currency" type="xs:string" default="EUR"/></xs:extension>
    </xs:simpleContent>
  </xs:complexType>
  <xs:complexType name="Base"><xs:sequence><xs:element name="id" type="xs:long"/></xs:sequence></xs:complexType>
</xs:schema>`;

describe("the rest of the subset", () => {
  const more = () => readSchemas(new DOMParser().parseFromString(MORE, "application/xml") as unknown as Document);
  test("extensions, simple content, refs, lists, nested choices and the facets", () => {
    const line = more().elements.get("line")!;
    expect(line.type.kind).toBe("object");
    if (line.type.kind !== "object") return;
    const f = Object.fromEntries(line.type.fields.map((x) => [x.name || "#choice", x]));
    expect(Object.keys(f)).toEqual([
      "id",
      "price",
      "sizes",
      "tags",
      "#choice",
      "code",
      "note",
      "at",
      "open",
      "ratio",
      "level",
      "flag",
      "anything",
      "unknown",
      "union",
      "kind",
      "version",
      "lang",
    ]);
    expect(f.price!.type).toMatchObject({
      kind: "object",
      fields: [
        { name: "value", type: { kind: "number" } },
        { name: "currency", default: "EUR" },
      ],
    });
    expect(f.sizes!.type).toMatchObject({ kind: "list", item: { kind: "number", integer: true } });
    expect(f.tags!.type).toMatchObject({ kind: "list", item: { kind: "string" } });
    expect(f.version).toMatchObject({ default: "2", fixed: true });
    expect(f.kind!.min).toBe(1);
    expect(f.anything!.type.kind).toBe("any");
    expect(f.unknown!.type.kind).toBe("any");
    expect(f.union!.type.kind).toBe("string");

    const first = initialValue(line) as Record<string, unknown>;
    expect(first).toMatchObject({
      id: 0,
      price: { value: 0, currency: "EUR" },
      sizes: [],
      ratio: 0.5,
      level: 3,
      flag: false,
      kind: "a",
      version: "2",
    });
    const good = {
      ...first,
      code: "abc",
      note: "ok",
      at: "2026-11-25T10:00",
      open: "09:30",
      phone: "123",
      tags: ["x"],
      sizes: [1, 2],
      anything: { a: 1 },
      unknown: 2,
      union: "u",
    };
    expect(check(line, good, W)).toEqual([]);
    const bad = { ...good, code: "ab", note: "toolong", at: "soon", open: "9", ratio: 0, level: 4, sizes: [1.5], email: "e" };
    const messages = check(line, bad, W).map((p) => `${p.path.join("/")}: ${p.message}`);
    expect(messages).toEqual([
      "sizes/0: A whole number",
      "code: At least 3 characters",
      "note: At most 4 characters",
      "at: A date in the expected form",
      "open: A date in the expected form",
      "ratio: More than 0",
      "level: One of 3, 5",
    ]);
    expect(check(line, { ...good, ratio: 2, sizes: "1" }, W).map((p) => p.message)).toEqual([W.required, "At most 1"]);
    expect(
      check(
        { name: "x", type: { kind: "number", base: "decimal", integer: false, facets: { maxExclusive: 1 } }, min: 1, max: 1 },
        "1",
        W,
      )[0]!.message,
    ).toBe(W.notNumber);
    expect(
      check({ name: "x", type: { kind: "number", base: "decimal", integer: false, facets: { maxExclusive: 1 } }, min: 1, max: 1 }, 1, W)[0]!
        .message,
    ).toBe("Less than 1");
    expect(check({ name: "x", type: { kind: "boolean" }, min: 1, max: 1 }, "yes", W)[0]!.message).toBe(W.required);
    expect(check({ name: "x", type: { kind: "string", base: "string", facets: {} }, min: 2, max: 3 }, ["a"], W)[0]!.message).toBe(
      "At least 2 items",
    );
    expect(check({ name: "x", type: { kind: "string", base: "string", facets: { pattern: "(" } }, min: 1, max: 1 }, "anything", W)).toEqual(
      [],
    );
  });

  test("the words: every message has its default", () => {
    expect(W.add("tags")).toBe("Add tags");
    expect(W.remove("note")).toBe("Remove note");
    expect(W.item("tags", 0)).toBe("tags 1");
    expect([W.problems(1), W.problems(3)]).toEqual(["1 problem", "3 problems"]);
    expect([W.atLeast(1), W.atMost(2), W.above(0), W.below(5), W.minItems(1), W.maxItems(2)]).toEqual([
      "At least 1",
      "At most 2",
      "More than 0",
      "Less than 5",
      "At least 1 items",
      "At most 2 items",
    ]);
  });

  test("the form for all of it, edited and shown read-only", async () => {
    const el = document.createElement("scxml-data") as ScxmlData;
    el.setAttribute("element", "line");
    el.schema = MORE;
    document.body.append(el);
    await flush();
    const root = el.shadowRoot!;
    // a list of numbers typed as text, a time, a fixed attribute that can't be changed
    const sizes = root.querySelector('[data-path="sizes"]') as unknown as HTMLInputElement;
    sizes.value = "3 4";
    sizes.dispatchEvent(new Event("input"));
    expect((el.value as { sizes: number[] }).sizes).toEqual([3, 4]);
    expect((root.querySelector('[data-path="version"]') as unknown as HTMLInputElement).readOnly).toBe(true);
    // the optional choice: pick one, then another
    const choice = root.querySelector('[data-path="#choice"]') as unknown as HTMLSelectElement;
    choice.value = "phone";
    choice.dispatchEvent(new Event("change"));
    expect((el.value as { phone?: string }).phone).toBe("");
    el.strings = { unset: "—" };
    el.readOnly = true;
    await flush();
    expect(root.querySelectorAll("input, select").length).toBe(0);
    expect(root.textContent).toContain("EUR");
    el.value = { id: 1, sizes: [] };
    expect(root.textContent).toContain("none");
    expect(el.problems.length).toBeGreaterThan(0);
    el.field = undefined;
    el.removeAttribute("element");
    expect(el.problems).toEqual([]);
    el.remove();
  });
});

/**
 * The XSD subset `<scxml-data>` reads, as plain types: what a value of the ECMAScript data model may
 * be, so a form can be drawn for it, a value checked against it, and a first value made from it.
 *
 * A chart says what data an event takes with an `<xs:schema>` (XML Schema's namespace) anywhere in
 * it: each top-level `<xs:element name>` describes the `_event.data` of the event of that name, and
 * of the `<data>` of that id. The interpreter ignores elements of other namespaces, so the schema
 * changes nothing that runs.
 *
 * In the ECMAScript data model an element's value is JSON: a simple type is a string, a number or a
 * boolean; a complex type is an object whose fields are its child elements and attributes (by
 * name); an element that may occur more than once (`maxOccurs` > 1) is an array; an optional one
 * (`minOccurs="0"`, `use="optional"`) may be left out. Read: `xs:element` (`name`, `type`, `ref`,
 * `minOccurs`, `maxOccurs`, `default`, `fixed`), `xs:complexType` with `xs:sequence`, `xs:all`,
 * `xs:choice` (nested too) and `xs:attribute`, `xs:simpleType` with `xs:restriction` and its facets
 * (`enumeration`, `min/maxInclusive`, `min/maxExclusive`, `min/maxLength`, `length`, `pattern`,
 * `totalDigits`, `fractionDigits`) and `xs:list`, named types by name, `xs:annotation/xs:documentation`.
 * Anything else (`xs:any`, `xs:union`, substitution groups, imports) reads as "any JSON value".
 */

/** XML Schema's namespace. */
export const XSD_NS = "http://www.w3.org/2001/XMLSchema";

/** The facets of a simple type that a value is checked against. */
export interface Facets {
  /** The values allowed (`xs:enumeration`), as written. */
  enumeration?: string[];
  /** The smallest number allowed. */
  minInclusive?: number;
  /** The largest number allowed. */
  maxInclusive?: number;
  /** A number the value must be greater than. */
  minExclusive?: number;
  /** A number the value must be less than. */
  maxExclusive?: number;
  /** The fewest characters (`minLength`, `length`). */
  minLength?: number;
  /** The most characters (`maxLength`, `length`). */
  maxLength?: number;
  /** A regular expression the whole value matches (`xs:pattern`). */
  pattern?: string;
  /** The most digits after the decimal point. */
  fractionDigits?: number;
}

/** A type: what one value may be. */
export type DataType =
  | {
      /** Text. */
      kind: "string";
      /** The built-in type it derives from (`string`, `token`, …). */
      base: string;
      /** What the text must be. */
      facets: Facets;
    }
  | {
      /** A number. */
      kind: "number";
      /** The built-in type it derives from (`decimal`, `int`, …). */
      base: string;
      /** Whole numbers only. */
      integer: boolean;
      /** Its bounds and values. */
      facets: Facets;
    }
  | {
      /** `true` or `false`. */
      kind: "boolean";
    }
  | {
      /** A date, a date and time, or a time, as XML Schema writes it. */
      kind: "date" | "dateTime" | "time";
      /** What the text must be. */
      facets: Facets;
    }
  | {
      /** An array of simple values (`xs:list`). */
      kind: "list";
      /** What each value is. */
      item: DataType;
      /** The list's facets. */
      facets: Facets;
    }
  | {
      /** An object: a field per child element and attribute. */
      kind: "object";
      /** Its fields, in order (a nested `xs:choice` is a field with no name). */
      fields: Field[];
    }
  | {
      /** One of several fields (`xs:choice`): an object with that field only. */
      kind: "choice";
      /** The fields to choose from. */
      options: Field[];
    }
  | {
      /** Any JSON value. */
      kind: "any";
    };

/** A field of an object (a child element or an attribute), or an option of a choice. */
export interface Field {
  /** The field's name (the element's or attribute's), or `""` for a choice inside a sequence. */
  name: string;
  /** What its value is. */
  type: DataType;
  /** At least this many (0: optional). */
  min: number;
  /** At most this many (`Infinity`: unbounded); more than 1 makes the value an array. */
  max: number;
  /** What the schema says about it (`xs:documentation`). */
  doc?: string;
  /** A default value (`default`, or `fixed`, which `fixed` marks as not editable). */
  default?: string;
  /** The default can't be changed. */
  fixed?: boolean;
}

/** A schema: its top-level elements by name. */
export interface Schema {
  /** The top-level elements by name: in a chart, an event's name gives its data. */
  readonly elements: ReadonlyMap<string, Field>;
}

const INTEGERS = new Set([
  "integer",
  "int",
  "long",
  "short",
  "byte",
  "nonNegativeInteger",
  "positiveInteger",
  "nonPositiveInteger",
  "negativeInteger",
  "unsignedInt",
  "unsignedLong",
  "unsignedShort",
  "unsignedByte",
]);
const NUMBERS = new Set(["decimal", "double", "float", ...INTEGERS]);
const STRINGS = new Set(["string", "normalizedString", "token", "anyURI", "language", "Name", "NCName", "ID", "IDREF", "NMTOKEN", "QName"]);
/** The bounds an integer type implies. */
const IMPLIED: Record<string, Facets> = {
  nonNegativeInteger: { minInclusive: 0 },
  positiveInteger: { minInclusive: 1 },
  nonPositiveInteger: { maxInclusive: 0 },
  negativeInteger: { maxInclusive: -1 },
  unsignedInt: { minInclusive: 0, maxInclusive: 4294967295 },
  unsignedShort: { minInclusive: 0, maxInclusive: 65535 },
  unsignedByte: { minInclusive: 0, maxInclusive: 255 },
  byte: { minInclusive: -128, maxInclusive: 127 },
  short: { minInclusive: -32768, maxInclusive: 32767 },
  int: { minInclusive: -2147483648, maxInclusive: 2147483647 },
};

const isXsd = (n: Node): n is Element => n.nodeType === 1 && (n as Element).namespaceURI === XSD_NS;
const kids = (el: Element, name?: string): Element[] =>
  Array.from(el.childNodes).filter((n): n is Element => isXsd(n) && (!name || n.localName === name));
/** A QName's local part: `xs:string` → `string`, `tns:Item` → `Item`. */
const local = (qname: string | null) => (qname ? qname.slice(qname.indexOf(":") + 1) : "");

/** The schemas in a document (or under an element): every `<xs:schema>`, read as one. */
export function readSchemas(root: Element | Document): Schema {
  const schemas: Element[] = [];
  const walk = (el: Element) => {
    if (el.namespaceURI === XSD_NS && el.localName === "schema") schemas.push(el);
    else for (const child of Array.from(el.children)) walk(child);
  };
  const top = "documentElement" in root ? root.documentElement : root;
  if (top) walk(top);
  return readSchema(schemas);
}

/** One schema from `<xs:schema>` elements (several are read as one: names are shared). */
export function readSchema(schemas: Element[]): Schema {
  const complex = new Map<string, Element>();
  const simple = new Map<string, Element>();
  const tops = new Map<string, Element>();
  for (const s of schemas)
    for (const el of kids(s)) {
      const name = el.getAttribute("name");
      if (!name) continue;
      if (el.localName === "complexType") complex.set(name, el);
      else if (el.localName === "simpleType") simple.set(name, el);
      else if (el.localName === "element") tops.set(name, el);
    }
  // named types, each read once: a type that refers to itself gets the same object, so it can nest
  const cache = new Map<string, DataType>();
  const named = (qname: string): DataType => {
    const name = local(qname);
    if (NUMBERS.has(name)) return { kind: "number", base: name, integer: INTEGERS.has(name), facets: { ...IMPLIED[name] } };
    if (STRINGS.has(name)) return { kind: "string", base: name, facets: {} };
    if (name === "boolean") return { kind: "boolean" };
    if (name === "date" || name === "dateTime" || name === "time") return { kind: name, facets: {} };
    const known = cache.get(name);
    if (known) return known;
    const c = complex.get(name);
    const s = simple.get(name);
    if (!c && !s) return { kind: "any" };
    if (s) {
      const t = simpleType(s);
      cache.set(name, t);
      return t;
    }
    const placeholder = { kind: "object", fields: [] } as DataType;
    cache.set(name, placeholder);
    const t = complexType(c!);
    for (const k of Object.keys(placeholder)) delete (placeholder as unknown as Record<string, unknown>)[k];
    return Object.assign(placeholder, t);
  };
  const documentation = (el: Element) => {
    const text = kids(el, "annotation")
      .flatMap((a) => kids(a, "documentation"))
      .map((d) => (d.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" ");
    return text || undefined;
  };
  const occurs = (el: Element, attr: string, fallback: number) => {
    const v = el.getAttribute(attr);
    if (v == null) return fallback;
    if (v === "unbounded") return Number.POSITIVE_INFINITY;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const facetsOf = (restriction: Element, into: Facets) => {
    for (const f of kids(restriction)) {
      const value = f.getAttribute("value");
      if (value == null) continue;
      const n = Number(value);
      switch (f.localName) {
        case "enumeration":
          into.enumeration = [...(into.enumeration ?? []), value];
          break;
        case "pattern":
          into.pattern = value;
          break;
        case "length":
          into.minLength = n;
          into.maxLength = n;
          break;
        case "minInclusive":
        case "maxInclusive":
        case "minExclusive":
        case "maxExclusive":
        case "minLength":
        case "maxLength":
        case "fractionDigits":
          if (Number.isFinite(n)) into[f.localName] = n;
          break;
      }
    }
    return into;
  };
  const simpleType = (el: Element): DataType => {
    const list = kids(el, "list")[0];
    if (list) {
      const inline = kids(list, "simpleType")[0];
      return { kind: "list", item: inline ? simpleType(inline) : named(list.getAttribute("itemType") ?? "string"), facets: {} };
    }
    const restriction = kids(el, "restriction")[0];
    if (!restriction) return { kind: "string", base: "string", facets: {} }; // a union: its members' text
    const inline = kids(restriction, "simpleType")[0];
    const base = inline ? simpleType(inline) : named(restriction.getAttribute("base") ?? "string");
    if (
      base.kind === "string" ||
      base.kind === "number" ||
      base.kind === "date" ||
      base.kind === "dateTime" ||
      base.kind === "time" ||
      base.kind === "list"
    )
      return { ...base, facets: facetsOf(restriction, { ...base.facets }) } as DataType;
    if (base.kind === "boolean") return base;
    return { kind: "string", base: "string", facets: facetsOf(restriction, {}) };
  };
  const particles = (group: Element, into: Field[]) => {
    for (const p of kids(group)) {
      if (p.localName === "element") into.push(element(p));
      else if (p.localName === "sequence" || p.localName === "all") particles(p, into);
      else if (p.localName === "choice") {
        const options: Field[] = [];
        particles(p, options);
        into.push({
          name: "",
          type: { kind: "choice", options },
          min: occurs(p, "minOccurs", 1),
          max: occurs(p, "maxOccurs", 1),
          doc: documentation(p),
        });
      }
    }
    return into;
  };
  const complexType = (el: Element): DataType => {
    // simple content (a value with attributes): the value as "value", then the attributes
    const content = kids(el, "simpleContent")[0] ?? kids(el, "complexContent")[0];
    const derived = content ? (kids(content, "extension")[0] ?? kids(content, "restriction")[0]) : undefined;
    const fields: Field[] = [];
    if (derived) {
      const base = named(derived.getAttribute("base") ?? "anyType");
      if (base.kind === "object") fields.push(...base.fields);
      else if (content?.localName === "simpleContent") fields.push({ name: "value", type: base, min: 1, max: 1 });
      particles(derived, fields);
      attributes(derived, fields);
    } else {
      particles(el, fields);
      attributes(el, fields);
    }
    // a lone choice is the type itself: one of its options
    if (fields.length === 1 && fields[0]!.name === "" && fields[0]!.max === 1 && fields[0]!.min === 1) return fields[0]!.type;
    return { kind: "object", fields };
  };
  const attributes = (el: Element, into: Field[]) => {
    for (const a of kids(el, "attribute")) {
      const name = a.getAttribute("name") ?? local(a.getAttribute("ref"));
      if (!name) continue;
      const inline = kids(a, "simpleType")[0];
      into.push({
        name,
        type: inline ? simpleType(inline) : named(a.getAttribute("type") ?? "string"),
        min: a.getAttribute("use") === "required" ? 1 : 0,
        max: 1,
        doc: documentation(a),
        ...defaults(a),
      });
    }
  };
  const defaults = (el: Element): Pick<Field, "default" | "fixed"> => {
    const fixed = el.getAttribute("fixed");
    if (fixed != null) return { default: fixed, fixed: true };
    const d = el.getAttribute("default");
    return d != null ? { default: d } : {};
  };
  const element = (el: Element): Field => {
    const ref = el.getAttribute("ref");
    const min = occurs(el, "minOccurs", 1);
    const max = occurs(el, "maxOccurs", 1);
    if (ref) {
      const target = tops.get(local(ref));
      const base = target ? element(target) : { name: local(ref), type: { kind: "any" } as DataType, min: 1, max: 1 };
      return { ...base, min, max };
    }
    const inlineComplex = kids(el, "complexType")[0];
    const inlineSimple = kids(el, "simpleType")[0];
    const type: DataType = inlineComplex
      ? complexType(inlineComplex)
      : inlineSimple
        ? simpleType(inlineSimple)
        : el.hasAttribute("type")
          ? named(el.getAttribute("type")!)
          : { kind: "any" };
    return { name: el.getAttribute("name") ?? "", type, min, max, doc: documentation(el), ...defaults(el) };
  };
  const elements = new Map<string, Field>();
  for (const [name, el] of tops) elements.set(name, { ...element(el), min: 1, max: 1 });
  return { elements };
}

// ─────────────────────────────── values ───────────────────────────────

/** A problem with a value, at a path of field names and indexes (`items/2/price`). */
export interface DataProblem {
  /** Where: the field names and item indexes from the value down (`[]` is the value itself). */
  path: (string | number)[];
  /** What is wrong, in the words given to `check`. */
  message: string;
}

/** The words a check uses; `<scxml-data>`'s strings provide them. */
export interface CheckWords {
  /** A value is missing, or is not of the kind expected. */
  required: string;
  /** Not a number. */
  notNumber: string;
  /** Not a whole number. */
  notInteger: string;
  /** Less than the smallest number allowed. */
  atLeast: (n: number) => string;
  /** More than the largest number allowed. */
  atMost: (n: number) => string;
  /** Not greater than an exclusive lower bound. */
  above: (n: number) => string;
  /** Not less than an exclusive upper bound. */
  below: (n: number) => string;
  /** Not one of the values allowed. */
  oneOf: (values: string[]) => string;
  /** Fewer characters than allowed. */
  minLength: (n: number) => string;
  /** More characters than allowed. */
  maxLength: (n: number) => string;
  /** Text that does not match the pattern. */
  pattern: string;
  /** A list with fewer items than allowed. */
  minItems: (n: number) => string;
  /** A list with more items than allowed. */
  maxItems: (n: number) => string;
  /** Not a date, date and time, or time in the form XML Schema writes it. */
  notDate: string;
}

/** Check `value` against `field`: every problem, with where it is. */
export function check(field: Field, value: unknown, words: CheckWords): DataProblem[] {
  const problems: DataProblem[] = [];
  const at = (path: (string | number)[], message: string) => problems.push({ path, message });
  const one = (type: DataType, v: unknown, path: (string | number)[]) => {
    switch (type.kind) {
      case "string": {
        if (typeof v !== "string") return at(path, words.required);
        facets(type.facets, v, v.length, path);
        return;
      }
      case "number": {
        if (typeof v !== "number" || !Number.isFinite(v)) return at(path, words.notNumber);
        if (type.integer && !Number.isInteger(v)) return at(path, words.notInteger);
        facets(type.facets, String(v), undefined, path, v);
        return;
      }
      case "boolean":
        if (typeof v !== "boolean") at(path, words.required);
        return;
      case "date":
      case "dateTime":
      case "time": {
        const ok = typeof v === "string" && DATE_SHAPES[type.kind].test(v);
        if (!ok) at(path, words.notDate);
        return;
      }
      case "list":
        if (!Array.isArray(v)) return at(path, words.required);
        for (const [i, item] of v.entries()) one(type.item, item, [...path, i]);
        return;
      case "object": {
        const obj = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
        if (!obj) return at(path, words.required);
        for (const f of type.fields) {
          if (f.name === "") {
            // a choice inside a sequence: its chosen option's field
            const chosen = f.type.kind === "choice" ? f.type.options.find((o) => o.name in obj) : undefined;
            if (!chosen && f.min > 0) at(path, words.required);
            if (chosen) occurrence(chosen, obj[chosen.name], [...path, chosen.name]);
            continue;
          }
          occurrence(f, obj[f.name], [...path, f.name]);
        }
        return;
      }
      case "choice": {
        const obj = v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
        const chosen = obj && type.options.find((o) => o.name in obj);
        if (!chosen) return at(path, words.required);
        occurrence(chosen, obj![chosen.name], [...path, chosen.name]);
        return;
      }
      case "any":
        return;
    }
  };
  const occurrence = (f: Field, v: unknown, path: (string | number)[]) => {
    // an empty text box is a value left out (XSD allows "", but a form that asks for it means something)
    const blank = v === "" && (f.type.kind === "any" || (f.type.kind === "string" && !f.type.facets.enumeration?.includes("")));
    if (v === undefined || v === null || blank) {
      if (f.min > 0) at(path, words.required);
      return;
    }
    if (f.max > 1) {
      if (!Array.isArray(v)) return at(path, words.required);
      if (v.length < f.min) at(path, words.minItems(f.min));
      if (v.length > f.max) at(path, words.maxItems(f.max));
      for (const [i, item] of v.entries()) one(f.type, item, [...path, i]);
      return;
    }
    one(f.type, v, path);
  };
  const facets = (fa: Facets, text: string, length: number | undefined, path: (string | number)[], n?: number) => {
    if (fa.enumeration && !fa.enumeration.includes(text)) at(path, words.oneOf(fa.enumeration));
    if (length != null && fa.minLength != null && length < fa.minLength) at(path, words.minLength(fa.minLength));
    if (length != null && fa.maxLength != null && length > fa.maxLength) at(path, words.maxLength(fa.maxLength));
    if (fa.pattern != null && length != null && !anchored(fa.pattern).test(text)) at(path, words.pattern);
    if (n != null) {
      if (fa.minInclusive != null && n < fa.minInclusive) at(path, words.atLeast(fa.minInclusive));
      if (fa.maxInclusive != null && n > fa.maxInclusive) at(path, words.atMost(fa.maxInclusive));
      if (fa.minExclusive != null && n <= fa.minExclusive) at(path, words.above(fa.minExclusive));
      if (fa.maxExclusive != null && n >= fa.maxExclusive) at(path, words.below(fa.maxExclusive));
    }
  };
  occurrence(field, value, []);
  return problems;
}

const DATE_SHAPES = {
  date: /^-?\d{4,}-\d{2}-\d{2}(Z|[+-]\d{2}:\d{2})?$/,
  dateTime: /^-?\d{4,}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/,
  time: /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/,
};

/** An XSD pattern matches the whole value; one that JavaScript can't read matches anything. */
function anchored(pattern: string): RegExp {
  try {
    return new RegExp(`^(?:${pattern})$`, "u");
  } catch {
    return /^[\s\S]*$/u;
  }
}

/** A first value for `field`: its default, or the smallest value the type allows. */
export function initialValue(field: Field): unknown {
  if (field.max > 1)
    return field.min === 0 ? undefined : Array.from({ length: Math.min(field.min, 50) }, () => initialOf(field.type, undefined));
  if (field.min === 0 && field.default == null) return undefined;
  return initialOf(field.type, field.default);
}

function initialOf(type: DataType, given: string | undefined): unknown {
  switch (type.kind) {
    case "string":
      return given ?? type.facets.enumeration?.[0] ?? "";
    case "number": {
      const n = given != null ? Number(given) : Number.NaN;
      if (Number.isFinite(n)) return n;
      const e = type.facets.enumeration?.[0];
      if (e != null) return Number(e);
      // 0 when the bounds allow it, else the nearest bound
      const fa = type.facets;
      const lo = fa.minInclusive ?? (fa.minExclusive != null ? fa.minExclusive + (type.integer ? 1 : 0.5) : Number.NEGATIVE_INFINITY);
      const hi = fa.maxInclusive ?? (fa.maxExclusive != null ? fa.maxExclusive - (type.integer ? 1 : 0.5) : Number.POSITIVE_INFINITY);
      return lo > 0 ? lo : hi < 0 ? hi : 0;
    }
    case "boolean":
      return given === "true" || given === "1";
    case "date":
    case "dateTime":
    case "time":
      return given ?? "";
    case "list":
      return [];
    case "object": {
      const out: Record<string, unknown> = {};
      for (const f of type.fields) {
        if (f.name === "") {
          const first = f.type.kind === "choice" ? f.type.options[0] : undefined;
          if (first && f.min > 0) out[first.name] = initialValue({ ...first, min: Math.max(1, first.min) });
          continue;
        }
        const v = initialValue(f);
        if (v !== undefined) out[f.name] = v;
      }
      return out;
    }
    case "choice": {
      const first = type.options[0];
      return first ? { [first.name]: initialValue({ ...first, min: Math.max(1, first.min) }) } : {};
    }
    case "any":
      return given;
  }
}

/** Fields inferred from what a chart reads (`_event.data.price`): each name, as any JSON value. */
export function inferredObject(names: string[]): Field {
  return {
    name: "",
    type: { kind: "object", fields: names.map((name) => ({ name, type: { kind: "any" }, min: 0, max: 1 })) },
    min: 1,
    max: 1,
  };
}

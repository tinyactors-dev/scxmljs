/**
 * `<scxml-data>`: shows, edits and composes one value of the ECMAScript data model, as an XML
 * Schema type says it may be. A field per child element and attribute, a list per repeated
 * element, a choice per `xs:choice`, a select per enumeration, a number box with the facets'
 * bounds, a checkbox for a boolean, a date box for a date; problems shown at the field they are in.
 *
 * ```html
 * <scxml-data element="checkout"></scxml-data>
 * <script type="module">
 *   import "@tinyactors/scxmljs/data";
 *   const form = document.querySelector("scxml-data");
 *   form.schema = chartDocument;            // or an <xs:schema> element, its XML text, or readSchemas(...)
 *   form.addEventListener("input", () => console.log(form.value, form.valid));
 * </script>
 * ```
 */
import { lazySheet, themeSheet } from "../ui/theme.ts";
import { type DataStrings, defaultDataStrings } from "./strings.ts";
import { DATA_CSS } from "./styles.ts";
import { check, type DataProblem, type DataType, type Field, initialValue, readSchemas, type Schema } from "./xsd.ts";

const sheet = lazySheet(DATA_CSS);
const HTMLElementBase = (typeof HTMLElement !== "undefined" ? HTMLElement : class {}) as typeof HTMLElement;

type Path = (string | number)[];
const key = (path: Path) => path.join("/");
let ids = 0;

/** The value as JSON text, or the text itself when it is not JSON (a field of any type). */
function anyFromText(text: string): unknown {
  const t = text.trim();
  if (t === "") return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return text;
  }
}
const anyToText = (v: unknown) => (v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v));
/** An `<option>` (happy-dom and other DOMs without the `Option` constructor too). */
function option(text: string, value: string, _default = false, selected = false): HTMLOptionElement {
  const o = document.createElement("option");
  o.textContent = text;
  o.value = value;
  o.selected = selected;
  return o;
}
const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/**
 * The `<scxml-data>` element. Set `schema` and `element` (the name of a top-level `xs:element`),
 * or `field` directly; read `value`, `valid` and `problems`. It dispatches `input` as the value
 * changes and `change` when an edit is committed, both bubbling out of its shadow root.
 */
export class ScxmlData extends HTMLElementBase {
  /** Attributes the element reacts to. */
  static observedAttributes = ["element", "value", "readonly"];
  #shadow: ShadowRoot;
  #schema: Schema | undefined;
  #field: Field | undefined;
  #value: unknown;
  #strings: DataStrings = defaultDataStrings;
  /** Fields the person has left, or all of them after `reportValidity()`: their problems show. */
  #touched = new Set<string>();
  #all = false;
  #root!: HTMLElement;
  /** Each field's problem line and control, by path, so a check updates them without a redraw. */
  #slots = new Map<string, { problem: HTMLElement; control?: HTMLElement }>();
  #valueSet = false;

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open", delegatesFocus: true });
    this.#shadow.adoptedStyleSheets = [themeSheet(), sheet()];
  }

  /** Custom-element lifecycle (called by the browser): draws the form. */
  connectedCallback() {
    this.#render();
  }

  /** Custom-element lifecycle (called by the browser) for the observed attributes. */
  attributeChangedCallback(name: string, old: string | null, value: string | null) {
    if (old === value) return;
    if (name === "value") {
      this.#value = value == null ? undefined : anyFromText(value);
      this.#valueSet = value != null;
    }
    if (name === "element") this.#field = undefined;
    this.#render();
  }

  /** The schema: a `Schema` from `readSchemas`, a document or element holding `<xs:schema>`s, or XML text. */
  get schema(): Schema | undefined {
    return this.#schema;
  }
  /** Set the schema (redraws the form). */
  set schema(s: Schema | Element | Document | string | undefined) {
    if (typeof s === "string") s = new DOMParser().parseFromString(s, "application/xml");
    this.#schema = s == null ? undefined : "elements" in s ? s : readSchemas(s as Element | Document);
    this.#field = undefined;
    this.#render();
  }

  /** What the value may be. Set it to describe a value without a schema; otherwise it is the schema's `element`. */
  get field(): Field | undefined {
    if (this.#field) return this.#field;
    const name = this.getAttribute("element");
    return name ? this.#schema?.elements.get(name) : undefined;
  }
  /** Describe the value directly (redraws the form). */
  set field(f: Field | undefined) {
    this.#field = f;
    this.#render();
  }

  /** The value: what the form shows, as JSON. Before one is set, the type's first value. */
  get value(): unknown {
    return clone(this.#value);
  }
  /** Set the value (redraws the form). */
  set value(v: unknown) {
    this.#value = clone(v);
    this.#valueSet = true;
    this.#render();
  }

  /** Show the value, not edit it. */
  get readOnly() {
    return this.hasAttribute("readonly");
  }
  /** Show the value (`true`) or edit it (`false`). */
  set readOnly(on: boolean) {
    this.toggleAttribute("readonly", on);
  }

  /** The words the element shows. */
  get strings(): DataStrings {
    return this.#strings;
  }
  /** Replace some of the words (the rest keep their defaults). */
  set strings(s: Partial<DataStrings>) {
    this.#strings = { ...defaultDataStrings, ...s };
    this.#render();
  }

  /** What is wrong with the value, each at its path of field names and item indexes. */
  get problems(): DataProblem[] {
    const f = this.field;
    return f ? check(f, this.#value, this.#strings) : [];
  }
  /** Whether the value is what the schema says. */
  get valid() {
    return this.problems.length === 0;
  }

  /** Show every problem (not only those of the fields already left), focus the first, and say whether it is valid. */
  reportValidity(): boolean {
    this.#all = true;
    this.#check();
    const first = this.problems[0];
    if (first) (this.#slots.get(key(first.path))?.control as HTMLElement | undefined)?.focus();
    return !first;
  }

  // ───────────────────────────── drawing ─────────────────────────────

  #render() {
    if (!this.isConnected) return;
    const field = this.field;
    if (field && !this.#valueSet) {
      this.#value = initialValue({ ...field, min: Math.max(1, field.min) });
      this.#valueSet = true;
    }
    let focusPath: string | undefined;
    try {
      focusPath = (this.#shadow.activeElement as HTMLElement | null)?.dataset.path;
    } catch {
      // a DOM without focus tracking in shadow roots
    }
    this.#slots.clear();
    this.#root = document.createElement("div");
    this.#root.className = "root";
    this.#root.setAttribute("part", "form");
    if (field)
      this.#root.append(this.readOnly ? this.#show(field.type, this.#value, field.max > 1) : this.#edit(field, this.#value, [], true));
    this.#shadow.replaceChildren(this.#root);
    if (focusPath != null) (this.#shadow.querySelector(`[data-path="${CSS.escape(focusPath)}"]`) as HTMLElement | null)?.focus();
    this.#check();
  }

  /** The control (or group) for one occurrence-aware field at `path`. */
  #edit(f: Field, v: unknown, path: Path, top = false): HTMLElement {
    if (f.max > 1) return this.#list(f, Array.isArray(v) ? v : [], path);
    return this.#control(f.type, v, path, f, top);
  }

  #list(f: Field, items: unknown[], path: Path): HTMLElement {
    const box = document.createElement("div");
    box.className = "items";
    items.forEach((item, i) => {
      const row = document.createElement("div");
      row.className = "item";
      const control = this.#control(f.type, item, [...path, i], { ...f, name: this.#strings.item(f.name, i) });
      row.append(control);
      if (items.length > f.min)
        row.append(
          this.#button("remove", "×", this.#strings.remove(this.#strings.item(f.name, i)), () => {
            const list = this.#at(path) as unknown[];
            list.splice(i, 1);
            this.#changed(true);
          }),
        );
      box.append(row);
    });
    if (items.length < f.max)
      box.append(
        this.#button("add", `+ ${f.name || ""}`.trim(), this.#strings.add(f.name), () => {
          const list = (this.#at(path) as unknown[] | undefined) ?? this.#put(path, []);
          (list as unknown[]).push(initialValue({ ...f, min: 1, max: 1 }));
          this.#changed(true, [...path, (list as unknown[]).length - 1]);
        }),
      );
    box.append(this.#problemLine(path));
    return box;
  }

  #control(type: DataType, v: unknown, path: Path, f: Field, top = false): HTMLElement {
    const id = `d${++ids}`;
    switch (type.kind) {
      case "object": {
        const group = document.createElement("div");
        group.className = top ? "root" : "group";
        if (!top) group.setAttribute("role", "group"), group.setAttribute("aria-label", f.name);
        const obj = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
        for (const child of type.fields) {
          if (child.name === "" && child.type.kind === "choice") {
            group.append(this.#choiceRow(child.type.options, obj, path, child));
            continue;
          }
          group.append(this.#row(child, obj[child.name], [...path, child.name]));
        }
        group.append(this.#problemLine(path));
        return group;
      }
      case "choice": {
        const obj = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
        const group = document.createElement("div");
        group.className = top ? "root" : "group";
        // the choice is the value itself: its row is "one of", not the value's name again
        group.append(this.#choiceRow(type.options, obj, path, { ...f, name: "" }), this.#problemLine(path));
        return group;
      }
      case "boolean": {
        const box = this.#input("input", path, id) as HTMLInputElement;
        box.type = "checkbox";
        box.checked = v === true;
        box.addEventListener("change", () => this.#set(path, box.checked, true));
        return this.#wrap(box, path);
      }
      case "number": {
        const box = this.#input("input", path, id) as HTMLInputElement;
        if (type.facets.enumeration) return this.#select(type.facets.enumeration, String(v ?? ""), path, id, Number);
        box.type = "number";
        box.inputMode = type.integer ? "numeric" : "decimal";
        const fa = type.facets;
        const lo = fa.minInclusive ?? fa.minExclusive;
        const hi = fa.maxInclusive ?? fa.maxExclusive;
        if (lo != null && Math.abs(lo) < 1e15) box.min = String(lo);
        if (hi != null && Math.abs(hi) < 1e15) box.max = String(hi);
        box.step = type.integer ? "1" : fa.fractionDigits != null ? String(10 ** -fa.fractionDigits) : "any";
        box.value = typeof v === "number" ? String(v) : "";
        box.addEventListener("input", () => this.#set(path, box.value === "" ? undefined : Number(box.value)));
        box.addEventListener("change", () => this.#commit(path));
        return this.#wrap(box, path);
      }
      case "string":
      case "date":
      case "dateTime":
      case "time": {
        const fa = type.facets;
        if (fa.enumeration) return this.#select(fa.enumeration, String(v ?? ""), path, id, String);
        const box = this.#input("input", path, id) as HTMLInputElement;
        box.type = type.kind === "string" ? "text" : type.kind === "dateTime" ? "datetime-local" : type.kind;
        if (fa.maxLength != null) box.maxLength = fa.maxLength;
        if (f.fixed) box.readOnly = true;
        box.value = typeof v === "string" ? v : "";
        box.spellcheck = false;
        box.addEventListener("input", () => this.#set(path, box.value));
        box.addEventListener("change", () => this.#commit(path));
        return this.#wrap(box, path);
      }
      case "list": {
        const box = this.#input("input", path, id) as HTMLInputElement;
        box.value = Array.isArray(v) ? v.join(" ") : "";
        const item = type.item;
        const read = (s: string) => (item.kind === "number" ? Number(s) : item.kind === "boolean" ? s === "true" : s);
        box.addEventListener("input", () => this.#set(path, box.value.split(/\s+/).filter(Boolean).map(read)));
        box.addEventListener("change", () => this.#commit(path));
        return this.#wrap(box, path);
      }
      case "any": {
        const box = this.#input("textarea", path, id) as HTMLTextAreaElement;
        box.rows = 1;
        box.placeholder = this.#strings.anyPlaceholder;
        box.value = anyToText(v);
        box.spellcheck = false;
        box.addEventListener("input", () => this.#set(path, anyFromText(box.value)));
        box.addEventListener("change", () => this.#commit(path));
        return this.#wrap(box, path);
      }
    }
  }

  /** A labelled row: the field's name, its control (or an "add" button when it is optional and left out), its doc. */
  #row(f: Field, v: unknown, path: Path): HTMLElement {
    const row = document.createElement("div");
    row.className = "field";
    row.dataset.field = key(path);
    const name = document.createElement("label");
    name.className = `name${f.min > 0 ? " req" : ""}`;
    name.textContent = f.name;
    const body = document.createElement("div");
    body.className = "body";
    // an optional field of any value shows its box: left empty, it is left out
    const loose = f.type.kind === "any";
    if (v === undefined && f.min === 0 && f.max <= 1 && !loose) {
      body.append(
        this.#button("add", `+ ${f.name}`, this.#strings.add(f.name), () => {
          this.#put(path, initialValue({ ...f, min: 1 }));
          this.#changed(true, path);
        }),
      );
    } else {
      const control = this.#edit(f, v, path);
      if (f.min === 0 && f.max <= 1 && !loose) {
        const line = document.createElement("div");
        line.className = "item";
        line.append(
          control,
          this.#button("remove", "×", this.#strings.remove(f.name), () => {
            this.#put(path, undefined);
            this.#changed(true);
          }),
        );
        body.append(line);
      } else body.append(control);
      const input = control.querySelector("input, select, textarea") ?? (control.matches("input, select, textarea") ? control : null);
      if (input && f.type.kind !== "object" && f.max <= 1) name.htmlFor = input.id;
    }
    if (f.doc) {
      const doc = document.createElement("div");
      doc.className = "doc";
      doc.textContent = f.doc;
      body.append(doc);
    }
    row.append(name, body);
    return row;
  }

  /** An `xs:choice`: a select of its options, then the chosen option's control. */
  #choiceRow(options: Field[], obj: Record<string, unknown>, path: Path, f: Field): HTMLElement {
    const chosen = options.find((o) => o.name in obj && obj[o.name] !== undefined);
    const row = document.createElement("div");
    row.className = "field";
    const label = document.createElement("label");
    label.className = "name";
    label.textContent = f.name || this.#strings.choose;
    const body = document.createElement("div");
    body.className = "body";
    const id = `d${++ids}`;
    const select = this.#input("select", [...path, "#choice"], id) as HTMLSelectElement;
    label.htmlFor = id;
    if (!chosen && f.min === 0) select.append(option(`— ${this.#strings.unset} —`, ""));
    for (const o of options) select.append(option(o.name, o.name, false, o === chosen));
    select.addEventListener("change", () => {
      const target = this.#at(path) as Record<string, unknown> | undefined;
      const base = target && typeof target === "object" ? target : (this.#put(path, {}) as Record<string, unknown>);
      for (const o of options) delete base[o.name];
      const pick = options.find((o) => o.name === select.value);
      if (pick) base[pick.name] = initialValue({ ...pick, min: Math.max(1, pick.min) });
      this.#changed(true, pick ? [...path, pick.name] : undefined);
    });
    body.append(select);
    if (chosen) body.append(this.#edit({ ...chosen, min: Math.max(1, chosen.min) }, obj[chosen.name], [...path, chosen.name]));
    row.append(label, body);
    return row;
  }

  #select(values: string[], current: string, path: Path, id: string, read: (s: string) => unknown): HTMLElement {
    const select = this.#input("select", path, id) as HTMLSelectElement;
    if (!values.includes(current)) select.append(option("", "", true, true));
    for (const value of values) select.append(option(value, value, false, value === current));
    select.addEventListener("change", () => this.#set(path, select.value === "" ? undefined : read(select.value), true));
    return this.#wrap(select, path);
  }

  #input(tag: "input" | "select" | "textarea", path: Path, id: string): HTMLElement {
    const el = document.createElement(tag);
    el.id = id;
    el.dataset.path = key(path);
    el.addEventListener("blur", () => {
      this.#touched.add(key(path));
      this.#check();
    });
    return el;
  }

  /** A control with its problem line under it. */
  #wrap(control: HTMLElement, path: Path): HTMLElement {
    const box = document.createElement("div");
    box.className = "body";
    const problem = this.#problemLine(path, control);
    control.setAttribute("aria-describedby", problem.id);
    box.append(control, problem);
    return box;
  }

  #problemLine(path: Path, control?: HTMLElement): HTMLElement {
    const line = document.createElement("div");
    line.className = "problem";
    line.id = `p${++ids}`;
    line.hidden = true;
    line.setAttribute("aria-live", "polite");
    this.#slots.set(key(path), { problem: line, control });
    return line;
  }

  #button(kind: "add" | "remove", text: string, label: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = kind;
    b.textContent = text;
    b.setAttribute("aria-label", label);
    b.title = label;
    b.addEventListener("click", onClick);
    return b;
  }

  /** View mode: the value as text, its structure as nested groups. */
  #show(type: DataType, v: unknown, many: boolean): HTMLElement {
    const text = (cls: string, s: string) => {
      const span = document.createElement("span");
      span.className = `value ${cls}`;
      span.textContent = s;
      return span;
    };
    if (v === undefined || v === null) return text("unset", this.#strings.unset);
    if (many || type.kind === "list") {
      const list = Array.isArray(v) ? v : [];
      if (list.length === 0) return text("unset", this.#strings.empty);
      const box = document.createElement("div");
      box.className = "items";
      for (const item of list) box.append(this.#show(type.kind === "list" ? type.item : type, item, false));
      return box;
    }
    if (type.kind === "object" || type.kind === "choice") {
      const group = document.createElement("div");
      group.className = "group";
      const obj = typeof v === "object" ? (v as Record<string, unknown>) : {};
      const fields =
        type.kind === "object"
          ? type.fields.flatMap((f) => (f.name === "" && f.type.kind === "choice" ? f.type.options : [f]))
          : type.options;
      for (const f of fields) {
        if (type.kind === "choice" && !(f.name in obj)) continue;
        const row = document.createElement("div");
        row.className = "field";
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = f.name;
        row.append(name, this.#show(f.type, obj[f.name], f.max > 1));
        group.append(row);
      }
      return group;
    }
    if (typeof v === "string") return text(type.kind === "any" || type.kind === "string" ? "string" : "plain", v);
    return text(typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "plain", JSON.stringify(v));
  }

  // ───────────────────────────── the value ─────────────────────────────

  #at(path: Path): unknown {
    let v: unknown = this.#value;
    for (const p of path) v = v == null ? undefined : (v as Record<string | number, unknown>)[p];
    return v;
  }

  /** Set the value at `path`, making the objects on the way; `undefined` removes it. Returns what was set. */
  #put(path: Path, v: unknown): unknown {
    if (path.length === 0) {
      this.#value = v;
      return v;
    }
    if (this.#value == null || typeof this.#value !== "object") this.#value = typeof path[0] === "number" ? [] : {};
    let parent = this.#value as Record<string | number, unknown>;
    for (let i = 0; i < path.length - 1; i++) {
      const p = path[i]!;
      if (parent[p] == null || typeof parent[p] !== "object") parent[p] = typeof path[i + 1] === "number" ? [] : {};
      parent = parent[p] as Record<string | number, unknown>;
    }
    const last = path[path.length - 1]!;
    if (v === undefined && !Array.isArray(parent)) delete parent[last];
    else parent[last] = v;
    return v;
  }

  #set(path: Path, v: unknown, commit = false) {
    this.#put(path, v);
    this.#check();
    this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    if (commit) this.#commit(path);
  }

  #commit(path: Path) {
    this.#touched.add(key(path));
    this.#check();
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  /** A change to the value's shape (a field or item added or removed): draw again, focus what was added. */
  #changed(structural: boolean, focus?: Path) {
    if (structural) this.#render();
    if (focus) {
      const prefix = key(focus);
      const target = Array.from(this.#shadow.querySelectorAll<HTMLElement>("[data-path]")).find((el) => {
        const p = el.dataset.path!;
        return p === prefix || p.startsWith(`${prefix}/`);
      });
      target?.focus();
    }
    this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  /** Show each problem at its field: those of fields already left, or all after `reportValidity()`. */
  #check() {
    const problems = this.problems;
    const byPath = new Map<string, string[]>();
    for (const p of problems) {
      let k = key(p.path);
      // a problem inside a field with no slot of its own (an item of an xs:list) shows at the nearest one
      for (let path = p.path; !this.#slots.has(k) && path.length > 0; ) {
        path = path.slice(0, -1);
        k = key(path);
      }
      byPath.set(k, [...(byPath.get(k) ?? []), p.message]);
    }
    for (const [k, slot] of this.#slots) {
      const messages = byPath.get(k);
      const shown = !!messages && (this.#all || this.#touched.has(k));
      slot.problem.hidden = !shown;
      slot.problem.textContent = shown ? messages!.join(" · ") : "";
      if (slot.control) {
        if (shown) slot.control.setAttribute("aria-invalid", "true");
        else slot.control.removeAttribute("aria-invalid");
      }
    }
  }
}

if (typeof customElements !== "undefined" && !customElements.get("scxml-data")) customElements.define("scxml-data", ScxmlData);

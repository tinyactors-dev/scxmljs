/**
 * The sandboxed engine for the ECMAScript data model: one QuickJS context
 * (WebAssembly) per session. Semantics live in datamodel-base.ts.
 *
 * Why a separate engine: the spec's scoping rules need a real global scope per
 * session. `<script>` runs as a global script (so `var` and function
 * declarations persist), `<data>` ids become global variables, system
 * variables are read-only (assigning one raises `error.execution`), and
 * sessions cannot see each other or the host page.
 *
 * Values cross the boundary as plain data (JSON-like, plus `undefined`):
 * event payloads go in, send payloads / logs / snapshots come out. Anything
 * that stays inside (assign, foreach, data expressions) is never marshalled,
 * so functions and object identity survive.
 */

// the WebAssembly is inlined, so bundlers and browsers need no extra asset
import variant from "@jitl/quickjs-singlefile-browser-release-sync";
import { newQuickJSWASMModuleFromVariant, type QuickJSContext, type QuickJSHandle, type QuickJSWASMModule } from "quickjs-emscripten-core";
import {
  DataModelError,
  type DataModelFactory,
  type DataModelOptions,
  EVENT_SETTER_SOURCE,
  eventObject,
  isDomNode,
  PLAIN_DATA_SOURCE,
  ScriptDataModel,
  SYSTEM_VARIABLES_SOURCE,
  systemVariableValues,
} from "./datamodel-base.ts";
import type { SCXMLEvent } from "./events.ts";

let modulePromise: Promise<QuickJSWASMModule> | undefined;
let moduleSync: QuickJSWASMModule | undefined;

/**
 * Loads the QuickJS WebAssembly module (once; later calls return the same
 * promise). `createSession` does this for you; await it yourself before
 * constructing `Session`s directly.
 */
export function loadQuickJS(): Promise<void> {
  modulePromise ??= newQuickJSWASMModuleFromVariant(variant).then((m) => (moduleSync = m));
  return modulePromise.then(() => {});
}

/** @internal */
export function quickJSModule(): QuickJSWASMModule {
  if (!moduleSync) throw new Error("QuickJS is not loaded yet: await loadQuickJS() (createSession does this for you)");
  return moduleSync;
}

/**
 * The sandboxed ECMAScript data model: one QuickJS context per session.
 * @internal
 */
export class QuickJSDataModel extends ScriptDataModel {
  private vm: QuickJSContext;
  private setEventFn: QuickJSHandle;
  private plainFn: QuickJSHandle;
  private deadline = 0;
  private timeoutMs: number;
  private disposed = false;

  constructor(opts: DataModelOptions) {
    super();
    this.timeoutMs = opts.timeoutMs ?? 2000;
    this.vm = quickJSModule().newContext();
    const rt = this.vm.runtime;
    rt.setMemoryLimit(opts.memoryLimitBytes ?? 64 * 1024 * 1024);
    rt.setMaxStackSize(1024 * 1024);
    rt.setInterruptHandler(() => Date.now() > this.deadline);

    const inFn = this.vm.newFunction("In", (h) => (opts.In(this.vm.getString(h)) ? this.vm.true : this.vm.false));
    this.vm.setProp(this.vm.global, "In", inFn);
    inFn.dispose();

    const install = this.evalHandle(SYSTEM_VARIABLES_SOURCE);
    const values = this.toVm(systemVariableValues(opts));
    const r = this.vm.callFunction(install, this.vm.undefined, values);
    values.dispose();
    install.dispose();
    if (r.error) {
      const err = this.describe(r.error);
      r.error.dispose();
      throw new DataModelError(err);
    }
    r.value.dispose();
    this.run(MINI_DOM);
    this.setEventFn = this.evalHandle(EVENT_SETTER_SOURCE);
    this.plainFn = this.evalHandle(PLAIN_DATA_SOURCE);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.setEventFn.dispose();
    this.plainFn.dispose();
    this.vm.dispose();
  }

  setEvent(ev: SCXMLEvent) {
    const h = this.toVm(eventObject(ev));
    const r = this.vm.callFunction(this.setEventFn, this.vm.undefined, h);
    h.dispose();
    if (r.error) r.error.dispose();
    else r.value.dispose();
  }

  // ─────────────────────────── engine primitives ───────────────────────────

  protected run(code: string) {
    this.evalHandle(code).dispose();
  }

  protected read(code: string): unknown {
    const h = this.evalHandle(code);
    try {
      // converted to plain data inside the engine first (see plainData), then copied out
      this.deadline = Date.now() + this.timeoutMs;
      const r = this.vm.callFunction(this.plainFn, this.vm.undefined, h);
      if (r.error) {
        r.error.dispose();
        return undefined;
      }
      try {
        return this.dump(r.value);
      } finally {
        r.value.dispose();
      }
    } finally {
      h.dispose();
    }
  }

  protected setGlobal(name: string, value: unknown) {
    const h = this.toVm(value);
    this.vm.setProp(this.vm.global, name, h);
    h.dispose();
  }

  protected setGlobalFromExpr(name: string, code: string) {
    const h = this.evalHandle(code);
    this.vm.setProp(this.vm.global, name, h);
    h.dispose();
  }

  private evalHandle(code: string): QuickJSHandle {
    this.deadline = Date.now() + this.timeoutMs;
    const r = this.vm.evalCode(code, "scxml.js");
    if (r.error) {
      const err = this.describe(r.error);
      r.error.dispose();
      throw new DataModelError(err);
    }
    return r.value;
  }

  private describe(h: QuickJSHandle): string {
    try {
      const e = this.vm.dump(h);
      if (e && typeof e === "object" && "message" in e) {
        const err = e as { name?: string; message: unknown };
        return `${err.name ?? "Error"}: ${err.message}`;
      }
      return String(e);
    } catch {
      return "error";
    }
  }

  private dump(h: QuickJSHandle): unknown {
    try {
      return this.vm.dump(h);
    } catch {
      return undefined;
    }
  }

  // ─────────────────────────── marshalling ─────────────────────────────

  /** Host value → engine value. A reference back into its own ancestors (a cycle) becomes `undefined`, as in the trusted engine. */
  private toVm(value: unknown, depth = 0, ancestors: object[] = []): QuickJSHandle {
    const vm = this.vm;
    if (depth > 64) return vm.undefined;
    switch (typeof value) {
      case "undefined":
        return vm.undefined;
      case "boolean":
        return value ? vm.true : vm.false;
      case "number":
        return vm.newNumber(value);
      case "bigint":
        return vm.newBigInt(value);
      case "string":
        return vm.newString(value);
      case "object": {
        if (value === null) return vm.null;
        if (ancestors.includes(value)) return vm.undefined;
        if (value instanceof Date) return vm.newNumber(value.getTime());
        if (isDomNode(value)) return this.evalHandle(`__scxml_xml(${JSON.stringify(domTree(value))})`);
        ancestors.push(value);
        try {
          if (Array.isArray(value)) {
            const arr = vm.newArray();
            value.forEach((v, i) => {
              const h = this.toVm(v, depth + 1, ancestors);
              vm.setProp(arr, i, h);
              h.dispose();
            });
            return arr;
          }
          const obj = vm.newObject();
          for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            const h = this.toVm(v, depth + 1, ancestors);
            vm.setProp(obj, k, h);
            h.dispose();
          }
          return obj;
        } finally {
          ancestors.pop();
        }
      }
      default:
        return vm.undefined; // functions and symbols do not cross the boundary
    }
  }
}

/**
 * Factory for the sandboxed data model. QuickJS must be loaded (`await loadQuickJS()`).
 * @internal
 */
export const sandboxedDataModel: DataModelFactory = (opts) => new QuickJSDataModel(opts);

interface XmlTree {
  t: "e" | "x";
  n?: string;
  p?: string | null;
  ns?: string | null;
  a?: [string, string][];
  c?: XmlTree[];
  v?: string;
}

/** Host DOM → plain tree, rebuilt as a DOM inside the sandbox by MINI_DOM. */
function domTree(node: Node): XmlTree {
  if (node.nodeType === 9) return domTree((node as Document).documentElement);
  if (node.nodeType !== 1) return { t: "x", v: node.nodeValue ?? "" };
  const el = node as Element;
  return {
    t: "e",
    n: el.localName,
    p: el.prefix,
    ns: el.namespaceURI,
    a: Array.from(el.attributes).map((a) => [a.name, a.value]),
    c: Array.from(el.childNodes)
      .filter((c) => c.nodeType === 1 || c.nodeType === 3 || c.nodeType === 4)
      .map(domTree),
  };
}

/**
 * A small XML DOM for the sandbox (spec B.2: XML data values are DOM objects).
 * Values are Documents; they serialise back to XML text when they leave the
 * sandbox (toJSON) or are converted to strings.
 */
const MINI_DOM = `
var __scxml_xml = (function () {
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }
  function Text(v, parent) { this.nodeType = 3; this.nodeName = "#text"; this.nodeValue = this.data = v; this.parentNode = parent; this.childNodes = []; }
  Object.defineProperty(Text.prototype, "textContent", { get: function () { return this.nodeValue; } });
  Text.prototype.serialize = function () { return esc(this.nodeValue).replace(/"/g, '"'); };
  function Element(t, parent) {
    var self = this;
    this.nodeType = 1; this.localName = t.n; this.prefix = t.p || null; this.namespaceURI = t.ns || null;
    this.nodeName = this.tagName = t.p ? t.p + ":" + t.n : t.n; this.parentNode = parent || null;
    this.attributes = t.a.map(function (a) { return { name: a[0], nodeName: a[0], value: a[1], nodeValue: a[1] }; });
    this.childNodes = t.c.map(function (c) { return c.t === "e" ? new Element(c, self) : new Text(c.v, self); });
  }
  var E = Element.prototype;
  Object.defineProperty(E, "children", { get: function () { return this.childNodes.filter(function (c) { return c.nodeType === 1; }); } });
  Object.defineProperty(E, "firstChild", { get: function () { return this.childNodes[0] || null; } });
  Object.defineProperty(E, "lastChild", { get: function () { return this.childNodes[this.childNodes.length - 1] || null; } });
  Object.defineProperty(E, "firstElementChild", { get: function () { return this.children[0] || null; } });
  Object.defineProperty(E, "textContent", { get: function () { return this.childNodes.map(function (c) { return c.textContent; }).join(""); } });
  E.getAttribute = function (n) { for (var i = 0; i < this.attributes.length; i++) if (this.attributes[i].name === n) return this.attributes[i].value; return null; };
  E.hasAttribute = function (n) { return this.getAttribute(n) !== null; };
  E.setAttribute = function (n, v) { v = String(v); for (var i = 0; i < this.attributes.length; i++) if (this.attributes[i].name === n) { this.attributes[i].value = this.attributes[i].nodeValue = v; return; } this.attributes.push({ name: n, nodeName: n, value: v, nodeValue: v }); };
  E.getElementsByTagName = function (name) {
    var out = [];
    (function walk(e) { e.children.forEach(function (c) { if (name === "*" || c.nodeName === name || c.localName === name) out.push(c); walk(c); }); })(this);
    return out;
  };
  E.serialize = function (parentNs) {
    var self = this;
    var a = this.attributes.map(function (x) { return " " + x.name + '="' + esc(x.value) + '"'; }).join("");
    // declare the default namespace where it changes (it may have been inherited in the source)
    if (!this.prefix && (this.namespaceURI || null) !== (parentNs === undefined ? null : parentNs) && !this.hasAttribute("xmlns"))
      a = ' xmlns="' + esc(this.namespaceURI || "") + '"' + a;
    var body = this.childNodes.map(function (c) { return c.serialize(self.namespaceURI || null); }).join("");
    return "<" + this.nodeName + a + (body ? ">" + body + "</" + this.nodeName + ">" : "/>");
  };
  E.toString = E.toJSON = function () { return this.serialize(); };
  function Doc(root) { this.nodeType = 9; this.nodeName = "#document"; this.documentElement = root; this.childNodes = [root]; root.parentNode = this; }
  Doc.prototype.getElementsByTagName = function (name) {
    var r = this.documentElement;
    return (name === "*" || r.nodeName === name || r.localName === name ? [r] : []).concat(r.getElementsByTagName(name));
  };
  Doc.prototype.toString = Doc.prototype.toJSON = function () { return this.documentElement.serialize(); };
  Object.defineProperty(Doc.prototype, "textContent", { get: function () { return this.documentElement.textContent; } });
  return function (tree) { return tree.t === "e" ? new Doc(new Element(tree)) : tree.v; };
})();
`;

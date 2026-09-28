/**
 * The trusted engine for the ECMAScript data model: the host's own JavaScript
 * engine, in a separate realm per session — no WebAssembly download.
 *
 * Each session still gets its own global scope, which the spec's semantics
 * need (`<script>` declarations persist, sessions — including invoked
 * children — don't share variables, system variables are read-only):
 *
 *   - in browsers: a hidden same-origin <iframe>; code runs through the
 *     iframe's own `eval`, i.e. as a global script of that window.
 *   - in Bun / Node: a `node:vm` context (reached via process.getBuiltinModule,
 *     so browser bundles never see a Node import).
 *
 * TRUSTED means: the chart can reach the host (the iframe has `parent`, a vm
 * context is not a security boundary), can't be interrupted when it loops, and
 * needs `eval` to be allowed by the page's Content-Security-Policy. Use it for
 * charts you (or your build) authored; use the sandboxed default for anything
 * a user typed or uploaded.
 */
import {
  DataModelError,
  type DataModelFactory,
  type DataModelOptions,
  EVENT_SETTER_SOURCE,
  eventObject,
  isDomNode,
  plainData,
  ScriptDataModel,
  SYSTEM_VARIABLES_SOURCE,
  systemVariableValues,
} from "./datamodel-base.ts";
import type { SCXMLEvent } from "./events.ts";

/** The realm's global object: another realm's `globalThis`, so its properties are dynamic. */
type RealmGlobal = Record<string, unknown> & {
  Array: ArrayConstructor;
  Object: ObjectConstructor;
};

/** Just enough of `node:vm` (reached at run time, so no Node types are needed). */
interface NodeVm {
  createContext(sandbox: object): object;
  runInContext(code: string, context: object, options?: { filename?: string }): unknown;
}

interface Realm {
  /** The realm's global object. */
  global: RealmGlobal;
  /** Run code as a global script of the realm. */
  evaluate(code: string): unknown;
  dispose(): void;
}

const XHTML_NS = "http://www.w3.org/1999/xhtml";

function createRealm(): Realm {
  const doc: Document | undefined = (globalThis as { document?: Document }).document;
  const parent = doc?.body ?? doc?.documentElement;
  if (doc && parent && typeof doc.createElementNS === "function") {
    // createElementNS: works in HTML pages and in XML documents (e.g. a raw .scxml file)
    const iframe = doc.createElementNS(XHTML_NS, "iframe") as HTMLIFrameElement;
    iframe.setAttribute("aria-hidden", "true");
    iframe.setAttribute("tabindex", "-1");
    iframe.style.display = "none"; // CSSOM, not a style attribute: allowed by a strict style-src
    iframe.setAttribute("data-scxml-realm", "");
    parent.appendChild(iframe);
    const win = iframe.contentWindow as (Window & typeof globalThis) | null;
    if (win && typeof win.eval === "function") {
      return {
        global: win as unknown as RealmGlobal,
        // a method call of another realm's eval is an indirect eval: global scope of that window
        evaluate: (code) => win.eval(code),
        dispose: () => iframe.remove(),
      };
    }
    iframe.remove();
  }
  const vm = (globalThis as { process?: { getBuiltinModule?(id: string): unknown } }).process?.getBuiltinModule?.("node:vm") as
    | NodeVm
    | undefined;
  if (vm?.createContext) {
    const context = vm.createContext({});
    return {
      global: vm.runInContext("globalThis", context) as RealmGlobal,
      evaluate: (code) => vm.runInContext(code, context, { filename: "scxml.js" }),
      dispose: () => {},
    };
  }
  throw new Error("trusted data model: needs a DOM document (for an iframe realm) or node:vm");
}

/**
 * The trusted ECMAScript data model.
 * @internal
 */
export class TrustedDataModel extends ScriptDataModel {
  private realm: Realm;
  private setEventFn: (ev: unknown) => void;
  private disposed = false;

  constructor(opts: DataModelOptions) {
    super();
    this.realm = createRealm();
    this.realm.global.In = (id: unknown) => opts.In(String(id));
    const install = this.evaluateRaw(SYSTEM_VARIABLES_SOURCE) as (values: unknown) => void;
    install(this.copyIn(systemVariableValues(opts)));
    this.setEventFn = this.evaluateRaw(EVENT_SETTER_SOURCE) as (ev: unknown) => void;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.realm.dispose();
  }

  setEvent(ev: SCXMLEvent) {
    this.setEventFn(this.copyIn(eventObject(ev)));
  }

  // ─────────────────────────── engine primitives ───────────────────────────

  protected run(code: string) {
    this.evaluateRaw(code);
  }

  protected read(code: string): unknown {
    return plainData(this.evaluateRaw(code), isDomNode); // DOM values stay real nodes here
  }

  protected setGlobal(name: string, value: unknown) {
    this.realm.global[name] = this.copyIn(value);
  }

  protected setGlobalFromExpr(name: string, code: string) {
    this.realm.global[name] = this.evaluateRaw(code);
  }

  private evaluateRaw(code: string): unknown {
    try {
      return this.realm.evaluate(code);
    } catch (e) {
      throw new DataModelError(describe(e));
    }
  }

  // ─────────────────────────── marshalling ─────────────────────────────

  /**
   * Host value → a fresh copy built from the realm's own constructors, so the
   * chart never shares mutable objects with the host (or with another
   * session) and `instanceof Array/Object` work inside the chart.
   */
  private copyIn(value: unknown, depth = 0, seen = new Set<object>()): unknown {
    if (typeof value === "function" || typeof value === "symbol") return undefined;
    if (typeof value !== "object" || value === null) return value;
    if (depth > 64 || seen.has(value)) return undefined;
    if (isDomNode(value)) return value.cloneNode(true); // XML values are real DOM here
    if (value instanceof Date) return value.getTime(); // same as the sandboxed engine
    seen.add(value);
    const g = this.realm.global;
    try {
      if (Array.isArray(value)) {
        const arr = new g.Array();
        value.forEach((v, i) => {
          arr[i] = this.copyIn(v, depth + 1, seen);
        });
        return arr;
      }
      const obj = new g.Object() as Record<string, unknown>;
      for (const [k, v] of Object.entries(value)) obj[k] = this.copyIn(v, depth + 1, seen);
      return obj;
    } finally {
      seen.delete(value);
    }
  }
}

function describe(e: unknown): string {
  // errors from another realm are not `instanceof Error` here
  if (e && typeof e === "object" && "message" in e)
    return `${(e as { name?: string }).name ?? "Error"}: ${(e as { message: string }).message}`;
  return String(e);
}

/**
 * Factory for the trusted data model. Synchronous; no download.
 * @internal
 */
export const trustedDataModel: DataModelFactory = (opts) => new TrustedDataModel(opts);

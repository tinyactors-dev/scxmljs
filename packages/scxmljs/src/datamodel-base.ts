/**
 * The ECMAScript data model (spec Appendix B.2), independent of the engine
 * that runs it.
 *
 * All the spec-relevant behaviour lives here, written as JavaScript source
 * that runs *inside* the engine: read-only system variables, strict-mode
 * `<assign>` (so undeclared locations fail), `<foreach>` over a shallow
 * copy, and location checks. An engine only has to run code in a per-session
 * global scope and move values in and out. Two engines exist:
 *
 *   - sandboxed (datamodel-quickjs.ts): QuickJS in WebAssembly — isolated,
 *     interruptible; the default entry point.
 *   - trusted (datamodel-trusted.ts): the host's own JS engine in a separate
 *     realm (an iframe, or node:vm) — no download, but no isolation.
 */
import type { SCXMLEvent } from "./events.ts";

/** What a session hands a data model when it creates one (see `DataModelFactory`). */
export interface DataModelOptions {
  /** The value of the read-only `_sessionid` system variable. */
  sessionId: string;
  /** The value of `_name` (the `<scxml name>` attribute). */
  name: string;
  /** The value of `_ioprocessors`: each processor's type URI (and aliases) with its location. */
  ioprocessors: Record<
    string,
    {
      /** The address to send to this session through that processor. */
      location: string;
    }
  >;
  /** Implements the `In(stateId)` predicate against the session's configuration. */
  In: (stateId: string) => boolean;
  /** Maximum run time of a single evaluation before it is interrupted (ms). Sandboxed engine only. */
  timeoutMs?: number;
  /** Maximum memory of one session's engine, in bytes. Sandboxed engine only (default 64 MiB). */
  memoryLimitBytes?: number;
}

/** What a session needs from its data model. Values in and out are plain host data. */
export interface DataModel {
  /** Evaluate an expression; the value is returned as plain data. */
  evaluate(expr: string): unknown;
  /** Evaluate a conditional expression (spec §5.9.1); errors propagate. */
  condition(expr: string): boolean;
  /** Run `<script>` content as a global script. */
  script(code: string): void;
  /** Declare (or re-initialise) a variable from an expression, keeping the value inside the engine. */
  declareExpr(id: string, expr: string): void;
  /** Declare (or re-initialise) a variable from a host value. */
  declareValue(id: string, value: unknown): void;
  /** `<assign location expr>`: evaluated and assigned inside the engine. */
  assignExpr(location: string, expr: string): void;
  /** Assign a host value (e.g. inline content) to a location. */
  assignValue(location: string, value: unknown): void;
  /** Is `location` a valid location right now? */
  isValidLocation(location: string): boolean;
  /** `<foreach>` (spec §4.6). */
  foreach(arrayExpr: string, item: string, index: string | null, body: () => void): void;
  /** Bind `_event`. */
  setEvent(ev: SCXMLEvent): void;
  /** Current values of the given variables, as plain data. */
  snapshot(ids: Iterable<string>): Record<string, unknown>;
  /** Release the engine (QuickJS context or realm). The data model isn't used afterwards. */
  dispose(): void;
}

/** Creates one data model per session. Pass one as `SessionOptions.datamodel` to plug in another engine. */
export type DataModelFactory = (opts: DataModelOptions) => DataModel;

/** An error thrown by user code or by an illegal data model operation. */
export class DataModelError extends Error {
  /** Always `"SCXML_DATAMODEL"`, for matching without `instanceof`. */
  readonly code = "SCXML_DATAMODEL" as const;
  constructor(message: string) {
    super(message);
    this.name = "DataModelError";
  }
}

const IDENT = /^[A-Za-z_$][\w$]*$/;
const RESERVED = new Set(
  "break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with yield let static implements interface package private protected public await".split(
    " ",
  ),
);

export function isLegalVariableName(name: string) {
  return IDENT.test(name) && !RESERVED.has(name);
}

/** Expressions are wrapped in parentheses; tolerate a trailing `;` as authors often write one. */
export function exprSource(expr: string) {
  return expr.trim().replace(/;+$/, "");
}

/**
 * Read-only system variables (spec §5.10): assigning one throws, which becomes
 * error.execution. The source is CONSTANT and evaluates to an installer that
 * receives the values as data: per-session source text (with the session id
 * inlined) made the host engines' compilation caches grow with every session
 * created in trusted mode — about 2 KB per session, measured in phase 5.
 */
export const SYSTEM_VARIABLES_SOURCE = `(function () {
  function deepFreeze(o) { if (o && typeof o === "object") { Object.freeze(o); for (var k in o) deepFreeze(o[k]); } return o; }
  function define(name, value) {
    Object.defineProperty(globalThis, name, { enumerable: true, configurable: false,
      get: function () { return value; },
      set: function () { throw new Error(name + " is a read-only system variable"); } });
  }
  return function (values) {
    define("_sessionid", deepFreeze(values.sessionid));
    define("_name", deepFreeze(values.name));
    define("_ioprocessors", deepFreeze(values.ioprocessors));
  };
})()`;

/** The values SYSTEM_VARIABLES_SOURCE's installer is called with. */
export function systemVariableValues(opts: DataModelOptions) {
  return { sessionid: opts.sessionId, name: opts.name, ioprocessors: opts.ioprocessors };
}

/** Defines the read-only `_event` and evaluates to the function that rebinds it. */
export const EVENT_SETTER_SOURCE = `(function () { var ev;
  Object.defineProperty(globalThis, "_event", { enumerable: true, configurable: false,
    get: function () { return ev; },
    set: function () { throw new Error("_event is a read-only system variable"); } });
  return function (v) { ev = v; }; })()`;

/** The `_event` object with every field present (spec §5.10.1). */
export function eventObject(ev: SCXMLEvent) {
  return {
    name: ev.name,
    type: ev.type,
    sendid: ev.sendid,
    origin: ev.origin,
    origintype: ev.origintype,
    invokeid: ev.invokeid,
    data: ev.data,
  };
}

/**
 * The engine-independent part of the ECMAScript data model. Subclasses supply
 * four primitives; everything else is shared, so both engines have identical
 * semantics (and both are checked by the conformance suite).
 * @internal
 */
export abstract class ScriptDataModel implements DataModel {
  /**
   * Temporary globals are named by nesting depth and reused, not numbered
   * per use: under Bun's node:vm, ~600 uses of fresh names that are deleted
   * in a separate script make a later strict-mode read of the assignment's
   * target return undefined (a JavaScriptCore caching issue, reproduced
   * outside this library). Reusing a handful of names avoids it everywhere.
   */
  private tmpDepth = 0;

  /** Run code as a global script; throw DataModelError on failure. */
  protected abstract run(code: string): void;
  /** Evaluate expression code; return its value as plain host data. */
  protected abstract read(code: string): unknown;
  /** Set a global variable to a host value. */
  protected abstract setGlobal(name: string, value: unknown): void;
  /** Set a global variable to the value of expression code, kept inside the engine. */
  protected abstract setGlobalFromExpr(name: string, code: string): void;
  abstract setEvent(ev: SCXMLEvent): void;
  abstract dispose(): void;

  evaluate(expr: string): unknown {
    return this.read(`(${exprSource(expr)}\n)`);
  }

  condition(expr: string): boolean {
    return this.read(`!!(${exprSource(expr)}\n)`) === true;
  }

  script(code: string) {
    this.run(code);
  }

  declareExpr(id: string, expr: string) {
    this.setGlobalFromExpr(id, `(${exprSource(expr)}\n)`);
  }

  declareValue(id: string, value: unknown) {
    this.setGlobal(id, value);
  }

  /**
   * The assignment runs in strict mode, so assigning to an undeclared
   * variable, through `undefined`, or to a system variable throws.
   */
  assignExpr(location: string, expr: string) {
    const tmp = this.acquireTmp();
    try {
      this.run(`globalThis.${tmp} = (${exprSource(expr)}\n);`);
      this.assignFromTmp(location, tmp);
    } finally {
      this.releaseTmp();
    }
  }

  assignValue(location: string, value: unknown) {
    const tmp = this.acquireTmp();
    try {
      this.setGlobal(tmp, value);
      this.assignFromTmp(location, tmp);
    } finally {
      this.releaseTmp();
    }
  }

  isValidLocation(location: string): boolean {
    try {
      // evaluate only: a missing variable or a broken path throws
      this.run(`(function () { "use strict"; void (${location}\n); })()`);
      return true;
    } catch {
      return false;
    }
  }

  foreach(arrayExpr: string, item: string, index: string | null, body: () => void) {
    if (!isLegalVariableName(item)) throw new DataModelError(`foreach: "${item}" is not a legal variable name`);
    if (index != null && !isLegalVariableName(index)) throw new DataModelError(`foreach: "${index}" is not a legal variable name`);
    const tmp = this.acquireTmp();
    try {
      this.run(
        `(function (a) { if (!Array.isArray(a)) throw new TypeError("foreach: array is not an array"); globalThis.${tmp} = a.slice(); })((${exprSource(arrayExpr)}\n));`,
      );
      const length = this.read(`globalThis.${tmp}.length`) as number;
      for (const name of [item, index]) if (name) this.run(`if (!(${JSON.stringify(name)} in globalThis)) globalThis.${name} = undefined;`);
      for (let i = 0; i < length; i++) {
        this.run(`${item} = globalThis.${tmp}[${i}];${index ? ` ${index} = ${i};` : ""}`);
        body();
      }
    } finally {
      this.run(`delete globalThis.${tmp};`);
      this.releaseTmp();
    }
  }

  snapshot(ids: Iterable<string>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const id of ids) {
      try {
        out[id] = this.read(`globalThis[${JSON.stringify(id)}]`);
      } catch {
        out[id] = undefined;
      }
    }
    return out;
  }

  private assignFromTmp(location: string, tmp: string) {
    try {
      // "location" must name something that already exists (spec §5.4): strict mode enforces it
      this.run(`(function () { "use strict"; void (${location}\n); ${location} = globalThis.${tmp}; })();`);
    } finally {
      this.run(`delete globalThis.${tmp};`);
    }
  }

  /** A temporary global for the current nesting depth (released in reverse order). */
  private acquireTmp() {
    return `__scxml_tmp${this.tmpDepth++}`;
  }

  private releaseTmp() {
    this.tmpDepth--;
  }
}

/**
 * How every value leaves a data model (logs, send payloads, done data,
 * snapshots, `evaluate()`), identical in both engines:
 *
 * - top-level primitives pass through unchanged (including `undefined`,
 *   `NaN`, `-0` and bigints); a top-level function or symbol becomes `undefined`;
 * - inside objects and arrays the JSON rules apply: keys holding `undefined`,
 *   functions or symbols are dropped, such array entries become `null`,
 *   non-finite numbers become `null`, bigints become strings;
 * - anything with `toJSON()` (Dates, the sandbox's XML values) is replaced by its result;
 * - Maps, Sets and class instances become plain objects of their own enumerable keys;
 * - a reference back into its own ancestors (a cycle) is dropped;
 * - `keep(v)` objects pass through untouched (the trusted engine keeps DOM nodes).
 *
 * `PLAIN_DATA_SOURCE` is the same algorithm as engine-side source; a test
 * checks the two agree.
 */
export function plainData(value: unknown, keep?: (v: object) => boolean): unknown {
  const ancestors: object[] = [];
  const convert = (v: unknown, nested: boolean): unknown => {
    if (typeof v === "function" || typeof v === "symbol") return undefined;
    if (typeof v === "number") return nested && !Number.isFinite(v) ? null : v;
    if (typeof v === "bigint") return nested ? String(v) : v;
    if (v === null || typeof v !== "object") return v;
    if (keep?.(v)) return v;
    const toJSON = (v as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === "function") return convert(toJSON.call(v), nested);
    if (ancestors.includes(v)) return undefined;
    ancestors.push(v);
    try {
      if (Array.isArray(v)) {
        const out: unknown[] = [];
        for (let i = 0; i < v.length; i++) {
          const c = convert(v[i], true);
          out.push(c === undefined ? null : c);
        }
        return out;
      }
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v)) {
        const c = convert((v as Record<string, unknown>)[k], true);
        if (c !== undefined) out[k] = c;
      }
      return out;
    } finally {
      ancestors.pop();
    }
  };
  return convert(value, false);
}

/** `plainData` as engine-side source: evaluates to a function of one value. */
export const PLAIN_DATA_SOURCE = `(function () {
  return function (value) {
    var ancestors = [];
    function convert(v, nested) {
      if (typeof v === "function" || typeof v === "symbol") return undefined;
      if (typeof v === "number") return nested && !isFinite(v) ? null : v;
      if (typeof v === "bigint") return nested ? String(v) : v;
      if (v === null || typeof v !== "object") return v;
      if (typeof v.toJSON === "function") return convert(v.toJSON(), nested);
      if (ancestors.indexOf(v) >= 0) return undefined;
      ancestors.push(v);
      try {
        var out, c, i, k, keys;
        if (Array.isArray(v)) {
          out = [];
          for (i = 0; i < v.length; i++) { c = convert(v[i], true); out.push(c === undefined ? null : c); }
          return out;
        }
        out = {};
        keys = Object.keys(v);
        for (i = 0; i < keys.length; i++) { k = keys[i]; c = convert(v[k], true); if (c !== undefined) out[k] = c; }
        return out;
      } finally {
        ancestors.pop();
      }
    }
    return convert(value, false);
  };
})()`;

export function isDomNode(v: unknown): v is Node {
  return typeof v === "object" && v !== null && typeof (v as Node).nodeType === "number" && "nodeName" in (v as object);
}

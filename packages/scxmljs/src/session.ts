/**
 * An SCXML session: a faithful implementation of the algorithm in
 * W3C SCXML 1.0, Appendix D, plus executable content (§4), the data model
 * rules (§5), `<send>` / `<invoke>` (§6) and the SCXML Event I/O Processor
 * (Appendix C.1).
 *
 * Procedure names follow the spec so the two can be read side by side.
 * Performance is a non-goal: sets are rebuilt freely, nothing is cached.
 *
 * Scheduling: the internal queue is drained synchronously (a macrostep).
 * External events are processed one at a time on `clock.defer`, so the
 * session is always idle between external events and never re-entered.
 */
import {
  type BindOptions,
  bind as bindDeclarative,
  type ConnectOptions,
  connect as connectEvents,
  type EventNameMapper,
} from "./bridge.ts";
import { type Clock, realClock } from "./clock.ts";
import type { DataModel, DataModelFactory } from "./datamodel-base.ts";
import { ElementBridge, type ReflectOptions } from "./element-events.ts";
import { nameMatch, parseDelay, SCXML_INVOKE_TYPES, SCXML_IOPROCESSOR, type SCXMLEvent } from "./events.ts";
import {
  compile,
  documentOrder,
  exitOrder,
  type InvokeNode,
  isAtomic,
  isCompound,
  isCompoundOrRoot,
  isDescendant,
  type Loader,
  type Model,
  properAncestors,
  SCXMLParseError,
  type StateNode,
  scxmlChildren,
  type TransitionNode,
} from "./model.ts";
import {
  ChildSessionEvent,
  DoneEvent,
  InvokeEvent,
  LogEvent,
  MacrostepEvent,
  MicrostepEvent,
  SCXMLErrorEvent,
  type SCXMLErrorKind,
  SendEvent,
  type SessionEventMap,
} from "./session-events.ts";

// ─────────────────────────────── public types ───────────────────────────────

/** A message produced by `<send>` for a non-SCXML Event I/O Processor. */
export interface OutboundSend {
  /** The event name (`event` / `eventexpr`). */
  event: string;
  /** The target (`target` / `targetexpr`); what it means is up to the processor. */
  target: string;
  /** The processor's canonical type URI. */
  type: string;
  /** The payload: namelist/`<param>` values as an object, or the `<content>` value. */
  data: unknown;
  /** The send's id (`id`, or generated for `idlocation`), if it has one. */
  sendid?: string;
}

/** The handle an I/O processor uses to talk to one session. */
export interface IOSession {
  /** The session's id (as in `_sessionid`). */
  readonly sessionId: string;
  /** Deliver an inbound event to the session's external queue. */
  deliver(name: string, data?: unknown, origin?: string): void;
}

/** An Event I/O Processor (spec §6.2.4, Appendix C). */
export interface IOProcessor {
  /** Canonical type URI: key in `_ioprocessors`, and `_event.origintype` of inbound events. */
  readonly type: string;
  /** Short names accepted in `<send type="…">`. */
  readonly aliases?: readonly string[];
  /** The address other parties use to reach this session through the processor (`_ioprocessors[type].location`). */
  location(session: IOSession): string;
  /** Called when a session using the processor starts; keep the handle to deliver inbound events. */
  attach?(session: IOSession): void;
  /** Called when that session terminates or is disposed; stop delivering to it. */
  detach?(session: IOSession): void;
  /** Transport a message. Throwing places `error.communication` on the internal queue. */
  send(message: OutboundSend, session: IOSession): void;
}

/** A running invoked service, as seen by the invoking session. */
export interface InvokedService {
  /** Deliver an event from the parent (`#_<invokeid>` targets and autoforward). */
  send(event: SCXMLEvent): void;
  /** Cancel: the invoking state was exited. */
  cancel(): void;
}

/** What a custom `Invoker` receives for one `<invoke>`. */
export interface InvokeContext {
  /** The invocation's id: `id`, or a generated `stateid.platformid` (also stored in `idlocation`). */
  invokeid: string;
  /** The `type` / `typeexpr` value. */
  type: string;
  /** The `src` / `srcexpr` value, if any. */
  src?: string;
  /** Inline `<content>`: an Element, or the value of `content/@expr`. */
  content?: unknown;
  /** Values from namelist and `<param>`. */
  params: Record<string, unknown>;
  /** Send an event to the invoking session (it arrives with `invokeid` set). */
  sendToParent(name: string, data?: unknown): void;
  /** The service finished: the parent receives `done.invoke.<invokeid>`. */
  done(data?: unknown): void;
}

/** Handler for a custom `<invoke type="…">`. */
export type Invoker = (ctx: InvokeContext) => InvokedService | Promise<InvokedService>;

/**
 * A `DOMParser`: the browser's, or one from a DOM implementation such as
 * happy-dom or linkedom. Only `parseFromString` is used, and its result only
 * needs to behave like a standard XML `Document`; the return type is `unknown`
 * so any implementation's own `Document` type is accepted without a cast.
 */
export interface DOMParserLike {
  /** Parse `source` as the given MIME type (the session asks for `application/xml`). */
  parseFromString(source: string, type: string): unknown;
}

/** A running invocation (see `SCXMLSession.invocations`). */
export interface Invocation {
  /** The invocation's id. */
  invokeid: string;
  /** The invoke type (the SCXML type URI or a custom invoker's name). */
  type: string;
  /** The state whose `<invoke>` started it. */
  state: StateNode;
  /** The `<invoke>` itself. */
  node: InvokeNode;
  /** The child session, for SCXML invocations. */
  session?: SCXMLSession;
}

/** How a session was invoked (see `SCXMLSession.parentSession`). */
export interface ParentInvocation {
  /** The invoking session. */
  session: SCXMLSession;
  /** The invocation's id in the parent. */
  invokeid: string;
}

/** What `waitFor` waits for: an active state id, several ids that must all be active, or a predicate. */
export type WaitCondition = string | readonly string[] | ((session: SCXMLSession) => boolean);

/** Options for `waitFor()`. */
export interface WaitForOptions {
  /** Reject with `signal.reason` when it aborts. */
  signal?: AbortSignal;
  /** Reject with a `TimeoutError` after this many ms of the session's clock. */
  timeoutMs?: number;
}

/** Options for `createSession()` and the `Session` constructors. */
export interface SessionOptions {
  /**
   * The ECMAScript engine. Set by the entry point you import: sandboxed
   * (QuickJS/WebAssembly) from `@tinyactors/scxmljs`, trusted (the host's
   * own engine) from `@tinyactors/scxmljs/trusted`. Invoked children inherit it.
   */
  datamodel?: DataModelFactory;
  /** The session's id (`_sessionid`, and the `#_scxml_<id>` address). Default: generated and unique. */
  sessionId?: string;
  /** Where time comes from: `realClock` (default), a `VirtualClock` for tests, a `PlaybackClock` for UIs. */
  clock?: Clock;
  /** Event I/O Processors in addition to the built-in SCXML one. */
  ioprocessors?: IOProcessor[];
  /** Handlers for `<invoke>` types other than SCXML. */
  invokers?: Record<string, Invoker>;
  /** Resolves `src` attributes (`<script>`, `<data>`, `<invoke>`). May return synchronously. */
  loader?: Loader;
  /** Needed to parse SCXML given as text (invoke src/srcexpr/content expressions). Defaults to the global DOMParser. */
  domParser?: DOMParserLike;
  /** Initial values overriding `<data>` of the same id (the host's or the invoker's params). */
  data?: Record<string, unknown>;
  /** Interrupt a single evaluation after this many ms (default 2000). Sandboxed data model only. */
  scriptTimeoutMs?: number;
  /** Memory limit of the session's QuickJS context, in bytes (default 64 MiB). Sandboxed data model only. */
  memoryLimitBytes?: number;
  /** Stop after this many microsteps in one macrostep, to keep a UI responsive (default 100000). */
  maxMicrosteps?: number;
  /**
   * Dispatch bubbling `scxml:exit`, `scxml:transition`, `scxml:enter` and
   * `scxml:done` events on the chart's own source elements. Off by default:
   * sessions sharing one model would share its elements.
   */
  elementEvents?: boolean;
  /**
   * Keep `data-active`, `data-enabled`, `data-fired`, `data-initial` and
   * `data-status` attributes on the source elements in sync, for CSS. Off by default.
   */
  reflect?: boolean | ReflectOptions;
}

// ──────────────────────────────── registry ────────────────────────────────

/** Sessions by id, for `#_scxml_<sessionid>` targets. */
const sessions = new Map<string, SCXMLSession>();
let sessionCounter = 0;

interface ActiveInvoke {
  id: string;
  node: InvokeNode;
  type: string;
  service?: InvokedService;
  /** the child session, for SCXML invokes */
  child?: SCXMLSession;
  /** events for the service that arrived before it started */
  pending: SCXMLEvent[];
}

/** Marks events that came from an invoked child (for finalize and cancellation filtering). */
const FROM_CHILD = Symbol("fromChild");
type QueuedEvent = SCXMLEvent & { [FROM_CHILD]?: boolean };

/**
 * SCXML text, an `<scxml>` element or a compiled model → a compiled model.
 * @internal used by the entry points' `createSession`
 */
export function resolveModel(source: string | Element | Model, opts: SessionOptions = {}): Model | Promise<Model> {
  if (typeof source === "string") return compile(parseSCXML(source, opts.domParser), { loader: opts.loader });
  if ("root" in source && "states" in source) return source;
  return compile(source, { loader: opts.loader });
}

/**
 * Parse SCXML text into its `<scxml>` element.
 *
 * Browsers have a `DOMParser`; Node, Bun and Deno don't, so pass one there
 * (any standards-compliant implementation, e.g. happy-dom's or linkedom's).
 *
 * @throws {SCXMLParseError} `code: "SCXML_NO_DOMPARSER"` when no parser is
 *   available, `code: "SCXML_PARSE"` when the text isn't well-formed XML.
 */
export function parseSCXML(source: string, domParser?: DOMParserLike): Element {
  const parser = domParser ?? (typeof DOMParser !== "undefined" ? new DOMParser() : undefined);
  if (!parser)
    throw new SCXMLParseError(
      "SCXML_NO_DOMPARSER",
      [
        "No DOMParser is available to parse SCXML text in this environment.",
        "Browsers provide one; Node, Bun and Deno don't. Either:",
        "  • pass one in the options, e.g. with happy-dom:",
        '      import { Window } from "happy-dom";',
        "      const { DOMParser } = new Window();",
        "      await createSession(source, { domParser: new DOMParser() });",
        "  • or pass an already-parsed <scxml> Element (or a compiled model) instead of text.",
      ].join("\n"),
    );
  const doc = parser.parseFromString(source, "application/xml") as Document;
  const err = doc.getElementsByTagName("parsererror")[0];
  if (err) throw new SCXMLParseError("SCXML_PARSE", `SCXML is not well-formed XML: ${err.textContent?.trim()}`);
  return doc.documentElement;
}

// ──────────────────────────────── session ─────────────────────────────────

/**
 * A running (or not yet started) SCXML session.
 *
 * This is the type every session has, whichever data model runs it — use it
 * to type code that works with any session (renderers, tests, invoked
 * children). To create sessions, use `createSession` or `Session` from
 * `@tinyactors/scxmljs` (sandboxed) or `@tinyactors/scxmljs/trusted`.
 *
 * Lifetime: `start()` runs the chart; it ends by reaching a top-level final
 * state or by `cancel()`. Every session holds resources until `dispose()` —
 * a data model context (a QuickJS context, or an iframe / vm realm), timers,
 * listeners it installed with `connect()` / `bind()`, and an entry in a
 * page-wide registry used to route `<send target="#_scxml_<sessionid>">`
 * between sessions. Call `dispose()` when you are done with a session, even
 * a finished one.
 */
export class SCXMLSession extends EventTarget {
  /** The compiled chart the session runs. */
  readonly model: Model;
  /** The session's id: `_sessionid`, and the address `#_scxml_<sessionId>`. */
  readonly sessionId: string;
  /** The session's data model (advanced: evaluate expressions against the running chart, for example in tools). */
  readonly datamodel: DataModel;

  private readonly opts: SessionOptions;
  /** The clock this session schedules on (delayed sends, deferred event processing). */
  readonly clock: Clock;
  private readonly configurationSet = new Set<StateNode>();
  private readonly statesToInvoke = new Set<StateNode>();
  private readonly internalQueue: QueuedEvent[] = [];
  private readonly externalQueue: QueuedEvent[] = [];
  private readonly historyValue = new Map<StateNode, StateNode[]>();
  private readonly lateBound = new Set<StateNode>();
  private readonly invoked = new Map<string, ActiveInvoke>();
  private readonly invokeIds = new Map<InvokeNode, string>();
  private readonly delayed = new Map<string, unknown>(); // send key → timer
  private readonly delayedBySendid = new Map<string, Set<string>>();
  private readonly processors = new Map<string, IOProcessor>();
  private readonly ioSessions = new Map<IOProcessor, IOSession>();
  private parent?: { session: SCXMLSession; invokeid: string };
  private readonly bridge?: ElementBridge;

  private running = false;
  private started = false;
  private exited = false;
  private busy = false;
  private scheduled = false;
  private sendCounter = 0;
  private settleWaiters: (() => void)[] = [];
  private resolveDone!: (data: unknown) => void;

  /**
   * Resolves when the session terminates, with the top-level final state's
   * `<donedata>` (or `undefined`). It never rejects: a session that is
   * cancelled or disposed first resolves with `undefined` — check
   * `session.cancelled` to tell the two apart.
   */
  readonly done: Promise<unknown> = new Promise((resolve) => (this.resolveDone = resolve));

  constructor(model: Model, opts: SessionOptions = {}) {
    super();
    this.model = model;
    this.opts = opts;
    this.clock = opts.clock ?? realClock;
    if (opts.elementEvents || opts.reflect)
      this.bridge = new ElementBridge(this, model, this.clock, !!opts.elementEvents, opts.reflect === true ? {} : opts.reflect || false);
    this.sessionId = opts.sessionId ?? `session${++sessionCounter}.${Math.random().toString(36).slice(2, 8)}`;

    const ioprocessors: Record<string, { location: string }> = {
      [SCXML_IOPROCESSOR]: { location: `#_scxml_${this.sessionId}` },
      scxml: { location: `#_scxml_${this.sessionId}` },
    };
    for (const p of opts.ioprocessors ?? []) {
      const io: IOSession = {
        sessionId: this.sessionId,
        deliver: (name, data, origin) => this.enqueueExternal({ name, type: "external", data, origin, origintype: p.type }),
      };
      this.ioSessions.set(p, io);
      for (const key of [p.type, ...(p.aliases ?? [])]) {
        this.processors.set(key, p);
        ioprocessors[key] = { location: p.location(io) };
      }
    }

    if (!opts.datamodel)
      throw new Error("no data model: use SCXMLSession/createSession from '@tinyactors/scxmljs' or '@tinyactors/scxmljs/trusted'");
    this.datamodel = opts.datamodel({
      sessionId: this.sessionId,
      name: model.name,
      ioprocessors,
      In: (id) => {
        const s = this.model.byId.get(id);
        return !!s && this.configurationSet.has(s);
      },
      timeoutMs: opts.scriptTimeoutMs,
      memoryLimitBytes: opts.memoryLimitBytes,
    });
  }

  // ───────────────────────────── typed listeners ─────────────────────────────

  /**
   * Listeners are wrapped so an exception in host code is reported and
   * swallowed: it can never abort a step (in Bun an uncaught listener error
   * would otherwise terminate the process).
   */
  private readonly wrapped = new WeakMap<object, Map<string, EventListener>>();

  /**
   * Listen to a session event (`microstep`, `macrostep`, `log`, `error`, `send`, `invoke`, `child`, `done`),
   * typed through `SessionEventMap`. A listener that throws is logged and can't abort a step.
   */
  override addEventListener<K extends keyof SessionEventMap>(
    type: K,
    listener: (this: SCXMLSession, ev: SessionEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  /** Any other event type (untyped). */
  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  override addEventListener(type: string, listener: unknown, options?: boolean | AddEventListenerOptions): void {
    if (!listener) return;
    const key = `${type}\0${capture(options)}`;
    let byKey = this.wrapped.get(listener as object);
    if (!byKey) {
      byKey = new Map();
      this.wrapped.set(listener as object, byKey);
    }
    let safe = byKey.get(key);
    if (!safe) {
      safe = (ev: Event) => {
        try {
          if (typeof listener === "function") listener.call(this, ev);
          else (listener as EventListenerObject).handleEvent(ev);
        } catch (e) {
          console.error(`scxml: a "${type}" listener threw`, e);
        }
      };
      byKey.set(key, safe);
    }
    super.addEventListener(type, safe, options);
  }

  /** Remove a listener added with `addEventListener`. */
  override removeEventListener<K extends keyof SessionEventMap>(
    type: K,
    listener: (this: SCXMLSession, ev: SessionEventMap[K]) => unknown,
    options?: boolean | EventListenerOptions,
  ): void;
  /** Any other event type (untyped). */
  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void;
  override removeEventListener(type: string, listener: unknown, options?: boolean | EventListenerOptions): void {
    if (!listener) return;
    const safe = this.wrapped.get(listener as object)?.get(`${type}\0${capture(options)}`);
    if (safe) super.removeEventListener(type, safe, options);
  }

  // ─────────────────────────────── public API ───────────────────────────────

  /** Active states, document order. */
  get configuration(): StateNode[] {
    return [...this.configurationSet].sort(documentOrder);
  }

  /** The ids of the active states, document order. */
  activeStateIds(): string[] {
    return this.configuration.map((s) => s.id);
  }

  /** Whether the state with this id is active. */
  isActive(id: string): boolean {
    const s = this.model.byId.get(id);
    return !!s && this.configurationSet.has(s);
  }

  /** Whether this state node is active. */
  isActiveNode(s: StateNode): boolean {
    return this.configurationSet.has(s);
  }

  /** Active invocations: what `<invoke>` started and is still running, with the child session for SCXML invokes. */
  get invocations(): Invocation[] {
    return [...this.invoked.values()].map((a) => ({ invokeid: a.id, type: a.type, state: a.node.state, node: a.node, session: a.child }));
  }

  /** The invoking session and invokeid, when this session was started by `<invoke>`. */
  get parentSession(): ParentInvocation | undefined {
    return this.parent;
  }

  /** `"idle"` before `start()`, `"running"`, or `"done"` once the session has terminated (see `cancelled` for how). */
  get status(): "idle" | "running" | "done" {
    return this.exited ? "done" : this.started ? "running" : "idle";
  }

  /** The handle an I/O processor uses for this session. */
  ioSession(p: IOProcessor): IOSession | undefined {
    return this.ioSessions.get(p);
  }

  /**
   * A plain-data copy of every variable declared with `<data>`, keyed by id.
   *
   * Values are copied out of the data model the way JSON would copy them:
   * objects and arrays are copied, functions are dropped, dates become ISO
   * strings, and properties whose value is `undefined` may be omitted. XML
   * values are serialised strings with the sandboxed data model and DOM nodes
   * with the trusted one. Variables created by `<script>` without `<data>`
   * are not included. After `dispose()` it returns `{}`.
   */
  snapshot(): Record<string, unknown> {
    if (this.exited && !this.running && this.disposedDm) return {};
    return this.datamodel.snapshot(this.model.allData.map((d) => d.getAttribute("id")!));
  }

  /** Enqueue an external event. */
  send(name: string, data?: unknown) {
    this.enqueueExternal({ name, type: "external", data });
  }

  /** `interpret()` — spec Appendix D. */
  start(): this {
    if (this.started) return this;
    this.started = true;
    this.running = true;
    sessions.set(this.sessionId, this);
    for (const [p, io] of this.ioSessions) p.attach?.(io);
    this.busy = true;
    try {
      this.initializeDatamodel();
      for (const s of this.model.scripts) this.executeContent([s]);
      this.bridge?.start();
      const entered = this.enterStates([this.model.root.initial!]);
      this.afterMicrostep([this.model.root.initial!], [], entered, undefined);
      this.mainEventLoop();
    } finally {
      this.busy = false;
    }
    this.emit(new MacrostepEvent(this, { configuration: this.configuration }));
    this.schedule();
    this.checkSettled();
    return this;
  }

  /**
   * Cancel the session from outside (like a parent cancelling an invoke):
   * it exits all states, running `onexit` handlers, without a done event.
   */
  cancel() {
    if (!this.started || this.exited) return;
    this.running = false;
    this.wasCancelled = true;
    if (!this.busy) this.exitInterpreter();
    this.bridge?.cleanup();
  }

  /**
   * Release everything the session holds: cancels it if it is still running
   * (running `onexit` handlers, no done event), stops its timers, removes
   * listeners installed by `connect()` / `bind()` and attributes set by
   * `reflect`, frees the data model context and leaves the session registry.
   * `done` resolves (with `undefined` if it hadn't finished). Safe to call
   * more than once; the session can't be used afterwards.
   */
  dispose() {
    this.cancel();
    this.bridge?.cleanup();
    this.lifetime.abort();
    this.disposedDm = true;
    this.datamodel.dispose();
    // a session disposed before it ever started never ran exitInterpreter
    this.resolveDone(undefined);
    this.checkSettled();
  }

  /** True when the session was ended by `cancel()` / `dispose()` rather than by reaching a final state. */
  get cancelled(): boolean {
    return this.wasCancelled;
  }

  private wasCancelled = false;
  private disposedDm = false;
  private readonly lifetime = new AbortController();

  /**
   * Aborts when the session terminates (final state, cancel) or is disposed.
   * Pass it to `addEventListener(…, { signal })` to tie host listeners to the session.
   */
  get signal(): AbortSignal {
    return this.lifetime.signal;
  }

  /**
   * Send `scxmlEvent` whenever `target` fires `domType` (space-separated types or an array).
   * `scxmlEvent` may be a function of the DOM event (null/undefined: don't send);
   * `data` computes the event data. Returns a disposer; also disconnects on
   * `options.signal` abort and when the session terminates.
   */
  connect(
    target: EventTarget,
    domType: string | readonly string[],
    scxmlEvent: EventNameMapper,
    data?: (e: Event) => unknown,
    options?: ConnectOptions,
  ): () => void {
    return connectEvents(this, target, domType, scxmlEvent, data, options);
  }

  /**
   * Declarative sends by event delegation on `root`: elements with
   * `data-scxml-send` (see `bind` in bridge.ts for the attribute rules).
   * Returns a disposer; also disconnects on `options.signal` abort and when
   * the session terminates.
   */
  bind(root: Element | Document, options?: BindOptions): () => void {
    return bindDeclarative(this, root, options);
  }

  // ───────────────────────────── promise helpers ─────────────────────────────

  /**
   * Resolves once the session is idle: both queues are empty and no
   * processing is scheduled (or the session has terminated / not started).
   * Pending delayed `<send>`s and replies still owed by I/O processors or
   * invoked services do not count — the session is idle while it waits for them.
   *
   * It is driven by the session's own scheduler, never by polling: with a
   * `VirtualClock`, nothing happens until the host calls `clock.run()`, and
   * the promise resolves during that call.
   */
  settled(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.settleWaiters.push(resolve));
  }

  /**
   * Resolves with the configuration at the first moment `what` holds:
   * immediately, after a macrostep, or on entering a top-level final state
   * (the configuration is cleared right after that, per the spec).
   *
   * `what`: a state id (active), several ids (all active) or a predicate.
   * Rejects with `options.signal.reason` on abort, a `TimeoutError`
   * DOMException after `timeoutMs` (measured on the session's clock), or an
   * Error when the session terminates first.
   */
  waitFor(what: WaitCondition, options: WaitForOptions = {}): Promise<StateNode[]> {
    const test: (s: SCXMLSession) => boolean =
      typeof what === "function" ? what : (s) => (typeof what === "string" ? [what] : what).every((id) => s.isActive(id));
    const describe = typeof what === "function" ? "the condition" : `[${typeof what === "string" ? what : what.join(", ")}]`;
    const { signal, timeoutMs } = options;
    return new Promise<StateNode[]>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      let timer: unknown;
      const cleanup = () => {
        this.removeEventListener("macrostep", onMacrostep);
        this.removeEventListener("microstep", onMicrostep);
        this.signal.removeEventListener("abort", onTerminated);
        signal?.removeEventListener("abort", onAbort);
        if (timer !== undefined) this.clock.clearTimeout(timer);
      };
      const check = () => {
        let ok: boolean;
        try {
          ok = test(this);
        } catch (e) {
          cleanup();
          reject(e);
          return true;
        }
        if (ok) {
          cleanup();
          resolve(this.configuration);
        }
        return ok;
      };
      const onMacrostep = () => void check();
      // the only moment a top-level final state is observable
      const onMicrostep = (e: MicrostepEvent) => {
        if (e.entered.some((s) => s.kind === "final" && s.parent === this.model.root)) check();
      };
      const onTerminated = () => {
        cleanup();
        reject(new Error(`session ${this.sessionId} terminated before ${describe} held`));
      };
      const onAbort = () => {
        cleanup();
        reject(signal!.reason);
      };
      if (check()) return;
      if (this.signal.aborted) return onTerminated();
      this.addEventListener("macrostep", onMacrostep);
      this.addEventListener("microstep", onMicrostep);
      this.signal.addEventListener("abort", onTerminated, { once: true });
      signal?.addEventListener("abort", onAbort, { once: true });
      if (timeoutMs != null)
        timer = this.clock.setTimeout(() => {
          timer = undefined;
          cleanup();
          reject(new DOMException(`timed out after ${timeoutMs}ms waiting for ${describe}`, "TimeoutError"));
        }, timeoutMs);
    });
  }

  /**
   * An async iterator over macrosteps, ending when the session terminates
   * (or `options.signal` aborts). Macrosteps are buffered, so none are lost
   * while the consumer is busy.
   *
   *     for await (const step of session.steps()) render(step.configuration);
   */
  steps(options: { signal?: AbortSignal } = {}): AsyncIterableIterator<MacrostepEvent> {
    const buffer: MacrostepEvent[] = [];
    let wake: (() => void) | undefined;
    let ended = false;
    const onMacrostep = (e: MacrostepEvent) => {
      buffer.push(e);
      wake?.();
    };
    const end = () => {
      if (ended) return;
      ended = true;
      this.removeEventListener("macrostep", onMacrostep);
      this.signal.removeEventListener("abort", end);
      options.signal?.removeEventListener("abort", end);
      wake?.();
    };
    this.addEventListener("macrostep", onMacrostep);
    this.signal.addEventListener("abort", end, { once: true });
    options.signal?.addEventListener("abort", end, { once: true });
    if (this.signal.aborted || options.signal?.aborted) end();
    const iterator: AsyncIterableIterator<MacrostepEvent> = {
      [Symbol.asyncIterator]: () => iterator,
      next: async () => {
        while (!buffer.length && !ended) await new Promise<void>((r) => (wake = r));
        wake = undefined;
        const value = buffer.shift();
        return value ? { value, done: false } : { value: undefined, done: true };
      },
      return: async () => {
        end();
        buffer.length = 0;
        return { value: undefined, done: true };
      },
    };
    return iterator;
  }

  private isIdle() {
    return this.exited || this.disposedDm || (!this.busy && !this.scheduled && !this.externalQueue.length && !this.internalQueue.length);
  }

  private checkSettled() {
    if (this.settleWaiters.length && this.isIdle()) for (const resolve of this.settleWaiters.splice(0)) resolve();
  }

  // ──────────────────────────── event loop (App. D) ─────────────────────────

  /**
   * The part of `mainEventLoop` that runs until the session has to wait for
   * an external event: macrosteps, then invokes, repeated while invoking
   * produced internal events.
   */
  private mainEventLoop() {
    const limit = this.opts.maxMicrosteps ?? 100_000;
    let steps = 0;
    while (this.running) {
      let macrostepDone = false;
      while (this.running && !macrostepDone) {
        let trigger: QueuedEvent | undefined;
        let enabled = this.selectEventlessTransitions();
        if (enabled.length === 0) {
          trigger = this.internalQueue.shift();
          if (!trigger) macrostepDone = true;
          else {
            this.datamodel.setEvent(trigger);
            enabled = this.selectTransitions(trigger);
          }
        }
        if (enabled.length) {
          this.microstep(enabled, trigger);
          if (++steps > limit) {
            this.emitError("error.platform", `more than ${limit} microsteps in one macrostep: stopping`);
            this.running = false;
          }
        }
      }
      if (!this.running) break;
      for (const state of [...this.statesToInvoke].sort(documentOrder))
        for (const inv of [...state.invokes].sort(documentOrder)) this.invoke(inv);
      this.statesToInvoke.clear();
      if (this.internalQueue.length) continue;
      break;
    }
    if (!this.running) this.exitInterpreter();
  }

  /** Process one external event: the second half of `mainEventLoop`. */
  private processExternalEvent() {
    const ev = this.externalQueue.shift();
    if (!ev) return;
    this.datamodel.setEvent(ev);
    for (const state of this.configuration) {
      for (const inv of state.invokes) {
        const active = this.invoked.get(this.invokeIds.get(inv) ?? "");
        if (!active) continue;
        if (ev[FROM_CHILD] && ev.invokeid === active.id) this.applyFinalize(inv);
        if (inv.autoforward) this.deliverToInvoke(active, stripMarks(ev)); // every external event (§6.4.1)
      }
    }
    const enabled = this.selectTransitions(ev);
    if (enabled.length) this.microstep(enabled, ev);
    this.mainEventLoop();
    this.emit(new MacrostepEvent(this, { event: stripMarks(ev), configuration: this.configuration }));
  }

  private schedule() {
    if (this.scheduled || this.exited) return;
    if (!this.externalQueue.length && !this.internalQueue.length) return;
    this.scheduled = true;
    this.clock.defer(() => this.pump());
  }

  private pump() {
    this.scheduled = false;
    if (!this.running || this.busy) return;
    this.busy = true;
    try {
      if (this.internalQueue.length) {
        // internal events that arrived asynchronously (delayed #_internal sends, late errors)
        this.mainEventLoop();
        this.emit(new MacrostepEvent(this, { configuration: this.configuration }));
      } else this.processExternalEvent();
    } finally {
      this.busy = false;
    }
    if (!this.running && !this.exited) this.exitInterpreter();
    this.schedule();
    this.checkSettled();
  }

  private enqueueExternal(ev: QueuedEvent) {
    if (!this.running) return;
    this.externalQueue.push(ev);
    this.schedule();
  }

  private enqueueInternal(ev: QueuedEvent) {
    this.internalQueue.push(ev);
    if (!this.busy) this.schedule();
  }

  /** `exitInterpreter()` */
  private exitInterpreter() {
    if (this.exited) return;
    this.exited = true;
    this.running = false;
    let doneData: unknown;
    let reachedFinal = false;
    for (const s of [...this.configurationSet].sort(exitOrder)) {
      for (const block of s.onexit) this.executeContent(scxmlChildren(block, this.model.ns));
      for (const inv of s.invokes) this.cancelInvoke(inv);
      this.configurationSet.delete(s);
      if (s.kind === "final" && s.parent === this.model.root) {
        reachedFinal = true;
        doneData = this.evaluateDoneData(s);
      }
    }
    for (const t of this.delayed.values()) this.clock.clearTimeout(t);
    this.delayed.clear();
    for (const [p, io] of this.ioSessions) p.detach?.(io);
    sessions.delete(this.sessionId);
    if (reachedFinal && !this.wasCancelled) this.returnDoneEvent(doneData);
    this.emit(new DoneEvent(this, { data: doneData }));
    this.bridge?.done(doneData);
    this.lifetime.abort();
    this.resolveDone(doneData);
    this.checkSettled();
  }

  private returnDoneEvent(data: unknown) {
    const p = this.parent;
    if (p) p.session.receiveFromChild(p.invokeid, { name: `done.invoke.${p.invokeid}`, type: "external", data });
  }

  // ──────────────────────────── selection (App. D) ──────────────────────────

  private selectEventlessTransitions(): TransitionNode[] {
    return this.select(null);
  }

  private selectTransitions(ev: SCXMLEvent): TransitionNode[] {
    return this.select(ev);
  }

  private select(ev: SCXMLEvent | null): TransitionNode[] {
    const enabled: TransitionNode[] = [];
    const atomic = [...this.configurationSet].filter(isAtomic).sort(documentOrder);
    for (const state of atomic) {
      loop: for (const s of [state, ...properAncestors(state, null)]) {
        for (const t of [...s.transitions].sort(documentOrder)) {
          const eventOk = ev ? t.events.length > 0 && nameMatch(t.events, ev.name) : t.events.length === 0;
          if (eventOk && this.conditionMatch(t)) {
            if (!enabled.includes(t)) enabled.push(t);
            break loop;
          }
        }
      }
    }
    return this.removeConflictingTransitions(enabled);
  }

  private conditionMatch(t: TransitionNode): boolean {
    return t.cond == null ? true : this.evaluateCondition(t.cond, t.element);
  }

  private removeConflictingTransitions(enabled: TransitionNode[]): TransitionNode[] {
    let filtered: TransitionNode[] = [];
    for (const t1 of enabled) {
      let t1Preempted = false;
      const toRemove = new Set<TransitionNode>();
      const exit1 = this.computeExitSet([t1]);
      for (const t2 of filtered) {
        const exit2 = this.computeExitSet([t2]);
        if ([...exit1].some((s) => exit2.has(s))) {
          if (isDescendant(t1.source, t2.source)) toRemove.add(t2);
          else {
            t1Preempted = true;
            break;
          }
        }
      }
      if (!t1Preempted) {
        filtered = filtered.filter((t) => !toRemove.has(t));
        filtered.push(t1);
      }
    }
    return filtered;
  }

  // ───────────────────────────── microstep (App. D) ─────────────────────────

  private microstep(enabled: TransitionNode[], event: SCXMLEvent | undefined) {
    const exited = this.exitStates(enabled);
    this.executeTransitionContent(enabled);
    const entered = this.enterStates(enabled);
    this.afterMicrostep(enabled, exited, entered, event && stripMarks(event));
  }

  /** The configuration is consistent again: tell the host (session event, then element events / attributes). */
  private afterMicrostep(transitions: TransitionNode[], exited: StateNode[], entered: StateNode[], event: SCXMLEvent | undefined) {
    this.emit(new MicrostepEvent(this, { event, transitions, exited, entered }));
    this.bridge?.microstep(transitions, exited, entered, event);
  }

  private exitStates(enabled: TransitionNode[]): StateNode[] {
    const statesToExit = [...this.computeExitSet(enabled)];
    for (const s of statesToExit) this.statesToInvoke.delete(s);
    statesToExit.sort(exitOrder);
    for (const s of statesToExit)
      for (const h of s.history)
        this.historyValue.set(
          h,
          [...this.configurationSet].filter((s0) => (h.historyType === "deep" ? isAtomic(s0) && isDescendant(s0, s) : s0.parent === s)),
        );
    for (const s of statesToExit) {
      for (const block of [...s.onexit]) this.executeContent(scxmlChildren(block, this.model.ns));
      for (const inv of s.invokes) this.cancelInvoke(inv);
      this.configurationSet.delete(s);
    }
    return statesToExit;
  }

  private computeExitSet(transitions: TransitionNode[]): Set<StateNode> {
    const statesToExit = new Set<StateNode>();
    for (const t of transitions) {
      if (!t.targets.length) continue;
      const domain = this.getTransitionDomain(t);
      if (!domain) continue;
      for (const s of this.configurationSet) if (isDescendant(s, domain)) statesToExit.add(s);
    }
    return statesToExit;
  }

  private executeTransitionContent(enabled: TransitionNode[]) {
    for (const t of enabled) if (t.element) this.executeContent(scxmlChildren(t.element, this.model.ns));
  }

  private enterStates(enabled: TransitionNode[]): StateNode[] {
    const statesToEnter = new Set<StateNode>();
    const statesForDefaultEntry = new Set<StateNode>();
    const defaultHistoryContent = new Map<StateNode, Element>();
    this.computeEntrySet(enabled, statesToEnter, statesForDefaultEntry, defaultHistoryContent);
    const entered = [...statesToEnter].sort(documentOrder);
    for (const s of entered) {
      this.configurationSet.add(s);
      this.statesToInvoke.add(s);
      if (this.model.binding === "late" && !this.lateBound.has(s)) {
        this.lateBound.add(s);
        this.bindData(s.data);
      }
      for (const block of s.onentry) this.executeContent(scxmlChildren(block, this.model.ns));
      if (statesForDefaultEntry.has(s) && s.initial?.element) this.executeContent(scxmlChildren(s.initial.element, this.model.ns));
      const hc = defaultHistoryContent.get(s);
      if (hc) this.executeContent(scxmlChildren(hc, this.model.ns));
      if (s.kind === "final") {
        const parent = s.parent!;
        if (parent === this.model.root) this.running = false;
        else {
          this.internalQueue.push({ name: `done.state.${parent.id}`, type: "platform", data: this.evaluateDoneData(s) });
          const grandparent = parent.parent;
          if (grandparent?.kind === "parallel" && grandparent.children.every((c) => this.isInFinalState(c)))
            this.internalQueue.push({ name: `done.state.${grandparent.id}`, type: "platform" });
        }
      }
    }
    return entered;
  }

  private computeEntrySet(
    transitions: TransitionNode[],
    statesToEnter: Set<StateNode>,
    statesForDefaultEntry: Set<StateNode>,
    defaultHistoryContent: Map<StateNode, Element>,
  ) {
    for (const t of transitions) {
      for (const s of t.targets) this.addDescendantStatesToEnter(s, statesToEnter, statesForDefaultEntry, defaultHistoryContent);
      const ancestor = this.getTransitionDomain(t);
      for (const s of this.getEffectiveTargetStates(t))
        this.addAncestorStatesToEnter(s, ancestor, statesToEnter, statesForDefaultEntry, defaultHistoryContent);
    }
  }

  private addDescendantStatesToEnter(
    state: StateNode,
    statesToEnter: Set<StateNode>,
    statesForDefaultEntry: Set<StateNode>,
    defaultHistoryContent: Map<StateNode, Element>,
  ) {
    if (state.kind === "history") {
      const hv = this.historyValue.get(state);
      let targets: StateNode[];
      if (hv) targets = hv;
      else {
        const t = state.transitions[0]!;
        if (t.element) defaultHistoryContent.set(state.parent!, t.element);
        targets = t.targets;
      }
      for (const s of targets) this.addDescendantStatesToEnter(s, statesToEnter, statesForDefaultEntry, defaultHistoryContent);
      for (const s of targets) this.addAncestorStatesToEnter(s, state.parent, statesToEnter, statesForDefaultEntry, defaultHistoryContent);
      return;
    }
    statesToEnter.add(state);
    if (isCompound(state)) {
      statesForDefaultEntry.add(state);
      for (const s of state.initial!.targets)
        this.addDescendantStatesToEnter(s, statesToEnter, statesForDefaultEntry, defaultHistoryContent);
      for (const s of state.initial!.targets)
        this.addAncestorStatesToEnter(s, state, statesToEnter, statesForDefaultEntry, defaultHistoryContent);
    } else if (state.kind === "parallel") {
      for (const child of state.children)
        if (![...statesToEnter].some((s) => isDescendant(s, child)))
          this.addDescendantStatesToEnter(child, statesToEnter, statesForDefaultEntry, defaultHistoryContent);
    }
  }

  private addAncestorStatesToEnter(
    state: StateNode,
    ancestor: StateNode | null,
    statesToEnter: Set<StateNode>,
    statesForDefaultEntry: Set<StateNode>,
    defaultHistoryContent: Map<StateNode, Element>,
  ) {
    for (const anc of properAncestors(state, ancestor)) {
      if (anc.kind === "scxml") continue;
      statesToEnter.add(anc);
      if (anc.kind === "parallel")
        for (const child of anc.children)
          if (![...statesToEnter].some((s) => isDescendant(s, child)))
            this.addDescendantStatesToEnter(child, statesToEnter, statesForDefaultEntry, defaultHistoryContent);
    }
  }

  private isInFinalState(s: StateNode): boolean {
    if (isCompound(s)) return s.children.some((c) => c.kind === "final" && this.configurationSet.has(c));
    if (s.kind === "parallel") return s.children.every((c) => this.isInFinalState(c));
    return false;
  }

  private getTransitionDomain(t: TransitionNode): StateNode | null {
    const tstates = this.getEffectiveTargetStates(t);
    if (!tstates.length) return null;
    if (t.type === "internal" && isCompound(t.source) && tstates.every((s) => isDescendant(s, t.source))) return t.source;
    return this.findLCCA([t.source, ...tstates]);
  }

  private findLCCA(stateList: StateNode[]): StateNode {
    const [head, ...tail] = stateList;
    for (const anc of properAncestors(head!, null).filter(isCompoundOrRoot)) if (tail.every((s) => isDescendant(s, anc))) return anc;
    return this.model.root;
  }

  private getEffectiveTargetStates(t: TransitionNode): StateNode[] {
    const targets = new Set<StateNode>();
    for (const s of t.targets) {
      if (s.kind === "history") {
        const hv = this.historyValue.get(s);
        for (const x of hv ?? this.getEffectiveTargetStates(s.transitions[0]!)) targets.add(x);
      } else targets.add(s);
    }
    return [...targets];
  }

  // ───────────────────────────── data model (§5) ────────────────────────────

  private initializeDatamodel() {
    if (this.model.binding === "early") this.bindData(this.model.allData);
    else {
      // late: every variable exists from the start, values are assigned on first entry
      for (const d of this.model.allData) this.declare(d.getAttribute("id")!, undefined);
      this.lateBound.add(this.model.root);
      this.bindData(this.model.root.data);
    }
  }

  private bindData(data: Element[]) {
    for (const d of data) {
      const id = d.getAttribute("id")!;
      if (this.opts.data && id in this.opts.data) {
        this.declare(id, this.opts.data[id]);
        continue;
      }
      try {
        const expr = d.getAttribute("expr");
        if (expr != null) this.datamodel.declareExpr(id, expr);
        else if (d.hasAttribute("src")) {
          const text = this.model.resources.get(d);
          if (text == null || text instanceof Error)
            throw new Error(`could not load <data src="${d.getAttribute("src")}">: ${text?.message ?? "no loader"}`);
          this.datamodel.declareValue(id, this.parseTextValue(text));
        } else this.datamodel.declareValue(id, this.inlineValue(d));
      } catch (e) {
        this.declare(id, undefined);
        this.raiseExecutionError(e, d);
      }
    }
  }

  private declare(id: string, value: unknown) {
    try {
      this.datamodel.declareValue(id, value);
    } catch (e) {
      this.raiseExecutionError(e, null);
    }
  }

  /** Inline content of `<data>`, `<content>`, `<assign>` (spec §5.3, B.2): JSON, else a space-normalised string. */
  private inlineValue(el: Element): unknown {
    const elements = scxmlChildrenAny(el);
    if (elements.length) return elements.length === 1 ? elements[0] : elements;
    const text = el.textContent ?? "";
    if (!text.trim()) return undefined;
    return this.parseTextValue(text);
  }

  /** Text content: JSON if it parses, XML if it is a document, else a whitespace-normalised string (spec B.2). */
  private parseTextValue(text: string): unknown {
    const t = text.trim();
    try {
      return JSON.parse(t);
    } catch {
      /* not JSON */
    }
    if (t.startsWith("<")) {
      try {
        return parseSCXMLLike(t, this.opts.domParser);
      } catch {
        /* not XML either */
      }
    }
    return t.replace(/\s+/g, " ");
  }

  private evaluateCondition(cond: string, element: Element | null): boolean {
    try {
      return this.datamodel.condition(cond);
    } catch (e) {
      this.raiseExecutionError(e, element);
      return false;
    }
  }

  private evaluateDoneData(finalState: StateNode): unknown {
    const dd = finalState.donedata;
    if (!dd) return undefined;
    try {
      return this.evaluatePayload(dd);
    } catch (e) {
      this.raiseExecutionError(e, dd);
      return undefined;
    }
  }

  /** namelist / `<param>` / `<content>` → event data. */
  private evaluatePayload(el: Element): unknown {
    const kids = scxmlChildren(el, this.model.ns);
    const content = kids.find((c) => c.localName === "content");
    if (content) {
      const expr = content.getAttribute("expr");
      return expr != null ? this.datamodel.evaluate(expr) : this.inlineValue(content);
    }
    const params = kids.filter((c) => c.localName === "param");
    const namelist = (el.getAttribute("namelist") ?? "").split(/\s+/).filter(Boolean);
    if (!params.length && !namelist.length) return undefined;
    // every key/value pair is kept, even duplicates (spec §5.7): a repeated name collects its values in an array
    const out: Record<string, unknown> = {};
    const repeated = new Set<string>();
    const add = (name: string, value: unknown) => {
      if (!Object.hasOwn(out, name)) out[name] = value;
      else if (repeated.has(name)) (out[name] as unknown[]).push(value);
      else {
        out[name] = [out[name], value];
        repeated.add(name);
      }
    };
    for (const name of namelist) {
      if (!this.datamodel.isValidLocation(name)) throw new Error(`namelist: "${name}" is not a valid location`);
      add(name, this.datamodel.evaluate(name));
    }
    for (const p of params) {
      const name = p.getAttribute("name")!;
      const expr = p.getAttribute("expr");
      const location = p.getAttribute("location");
      if (location != null && !this.datamodel.isValidLocation(location))
        throw new Error(`<param name="${name}">: "${location}" is not a valid location`);
      add(name, this.datamodel.evaluate(expr ?? location ?? "undefined"));
    }
    return out;
  }

  // ────────────────────────── executable content (§4) ───────────────────────

  /** Execute a block. An error raises `error.execution` and ends the block (spec §4.9). */
  private executeContent(actions: Element[]) {
    try {
      for (const a of actions) this.execute(a);
    } catch (e) {
      this.raiseExecutionError(e, e instanceof ActionError ? e.element : null, e instanceof ActionError ? e.sendid : undefined);
    }
  }

  private execute(a: Element) {
    const attr = (n: string) => a.getAttribute(n);
    const fail = (e: unknown): never => {
      throw e instanceof ActionError ? e : new ActionError(message(e), a);
    };
    try {
      switch (a.localName) {
        case "raise":
          this.internalQueue.push({ name: attr("event")!, type: "internal" });
          break;
        case "log":
          this.emit(
            new LogEvent(this, {
              label: attr("label") ?? "",
              // an empty expr (`<log label="…" expr=""/>`, as W3C test 307 writes) logs no value
              value: (attr("expr") ?? "").trim() ? this.datamodel.evaluate(attr("expr")!) : undefined,
            }),
          );
          break;
        case "assign": {
          const location = attr("location")!;
          const expr = attr("expr");
          if (expr != null) this.datamodel.assignExpr(location, expr);
          else this.datamodel.assignValue(location, this.inlineValue(a));
          break;
        }
        case "script": {
          const src = attr("src");
          const code = src != null ? this.model.resources.get(a) : (a.textContent ?? "");
          if (code instanceof Error || code == null) throw new Error(`script src "${src}" is unavailable`);
          this.datamodel.script(code);
          break;
        }
        case "if": {
          // conditions that fail to evaluate count as false (§5.9.1) — the block goes on
          let branchTaken = this.evaluateCondition(attr("cond")!, a);
          let executing = branchTaken;
          for (const c of scxmlChildren(a, this.model.ns)) {
            if (c.localName === "elseif") {
              executing = !branchTaken && this.evaluateCondition(c.getAttribute("cond")!, c);
              branchTaken ||= executing;
            } else if (c.localName === "else") {
              executing = !branchTaken;
              branchTaken = true;
            } else if (executing) this.execute(c);
          }
          break;
        }
        case "foreach":
          this.datamodel.foreach(attr("array")!, attr("item")!, attr("index"), () => {
            for (const c of scxmlChildren(a, this.model.ns)) this.execute(c);
          });
          break;
        case "send":
          this.executeSend(a);
          break;
        case "cancel": {
          const sendid = attr("sendid") ?? String(this.datamodel.evaluate(attr("sendidexpr")!));
          for (const key of this.delayedBySendid.get(sendid) ?? []) {
            this.clock.clearTimeout(this.delayed.get(key));
            this.delayed.delete(key);
          }
          this.delayedBySendid.delete(sendid);
          break;
        }
        default:
          break;
      }
    } catch (e) {
      fail(e);
    }
  }

  // ───────────────────────────── <send> (§6.2) ─────────────────────────────

  private executeSend(a: Element) {
    const attr = (n: string) => a.getAttribute(n);
    const evalAttr = (name: string, exprName: string): string | undefined => {
      if (a.hasAttribute(name)) return attr(name)!;
      if (a.hasAttribute(exprName)) return String(this.datamodel.evaluate(attr(exprName)!));
      return undefined;
    };
    // all arguments are evaluated when <send> executes (§6.2.3)
    const event = evalAttr("event", "eventexpr");
    const target = evalAttr("target", "targetexpr") ?? "";
    const type = evalAttr("type", "typeexpr") ?? SCXML_IOPROCESSOR;
    let sendid = attr("id") ?? undefined;
    if (a.hasAttribute("idlocation")) {
      sendid = `${this.sessionId}.send${++this.sendCounter}`;
      this.datamodel.assignValue(attr("idlocation")!, sendid);
    }
    try {
      this.prepareAndSend(a, event, target, type, sendid);
    } catch (e) {
      throw new ActionError(message(e), a, sendid);
    }
  }

  private prepareAndSend(a: Element, event: string | undefined, target: string, type: string, sendid: string | undefined) {
    const attr = (n: string) => a.getAttribute(n);
    const evalAttr = (name: string, exprName: string): string | undefined => {
      if (a.hasAttribute(name)) return attr(name)!;
      if (a.hasAttribute(exprName)) return String(this.datamodel.evaluate(attr(exprName)!));
      return undefined;
    };
    const delayValue = evalAttr("delay", "delayexpr");
    const delay = delayValue == null ? 0 : parseDelay(delayValue);
    if (Number.isNaN(delay)) throw new Error(`<send>: invalid delay "${delayValue}"`);
    const data = this.evaluatePayload(a);

    const scxmlType = type === SCXML_IOPROCESSOR || type === "scxml";
    const processor = scxmlType ? undefined : this.processors.get(type);
    if (!scxmlType && !processor) throw new Error(`<send>: unsupported type "${type}"`);
    if (scxmlType && event == null) throw new Error(`<send>: the SCXML processor needs an event name`);
    if (scxmlType && !isValidScxmlTarget(target)) throw new Error(`<send>: invalid target "${target}"`);
    if (delay > 0 && target === "#_internal") throw new Error(`<send>: cannot delay an event to #_internal`);

    const dispatch = () => {
      this.emit(new SendEvent(this, { message: { event: event ?? "", target, type: processor?.type ?? SCXML_IOPROCESSOR, data, sendid } }));
      if (processor) {
        try {
          processor.send({ event: event ?? "", target, type: processor.type, data, sendid }, this.ioSessions.get(processor)!);
        } catch (e) {
          this.communicationError(sendid, e);
        }
      } else this.dispatchScxml(event!, target, data, sendid);
    };

    if (delay > 0) {
      const key = sendid ?? `${this.sessionId}.anon${++this.sendCounter}`;
      const timer = this.clock.setTimeout(() => {
        this.delayed.delete(key);
        this.delayedBySendid.get(key)?.delete(key);
        if (this.running) dispatch();
      }, delay);
      this.delayed.set(key, timer);
      if (sendid) {
        const keys = this.delayedBySendid.get(sendid) ?? new Set();
        keys.add(key);
        this.delayedBySendid.set(sendid, keys);
      }
    } else dispatch();
  }

  /** The SCXML Event I/O Processor (Appendix C.1). */
  private dispatchScxml(name: string, target: string, data: unknown, sendid: string | undefined) {
    const ev: QueuedEvent = {
      name,
      type: "external",
      sendid,
      origin: `#_scxml_${this.sessionId}`,
      origintype: SCXML_IOPROCESSOR,
      data,
    };
    if (target === "") return this.enqueueExternal(ev);
    if (target === "#_internal") return this.enqueueInternal({ ...ev, type: "internal" });
    if (target === "#_parent") {
      if (!this.parent) return this.communicationError(sendid, "no parent session");
      return this.parent.session.receiveFromChild(this.parent.invokeid, ev);
    }
    if (target.startsWith("#_scxml_")) {
      const other = sessions.get(target.slice("#_scxml_".length));
      if (!other || other.status === "done") return this.communicationError(sendid, `no session "${target}"`);
      return other.enqueueExternal(ev);
    }
    const active = this.invoked.get(target.slice(2));
    if (!active) return this.communicationError(sendid, `no invoked session "${target}"`);
    this.deliverToInvoke(active, ev);
  }

  private communicationError(sendid: string | undefined, e: unknown) {
    this.emitError("error.communication", message(e));
    this.enqueueInternal({ name: "error.communication", type: "platform", sendid });
  }

  // ───────────────────────────── <invoke> (§6.4) ────────────────────────────

  private invoke(inv: InvokeNode) {
    const el = inv.element;
    const attr = (n: string) => el.getAttribute(n);
    let id: string;
    let ctx: Omit<InvokeContext, "sendToParent" | "done">;
    try {
      const type = attr("type") ?? (el.hasAttribute("typeexpr") ? String(this.datamodel.evaluate(attr("typeexpr")!)) : "scxml");
      const src = attr("src") ?? (el.hasAttribute("srcexpr") ? String(this.datamodel.evaluate(attr("srcexpr")!)) : undefined);
      if (el.hasAttribute("id")) id = attr("id")!;
      else {
        id = `${inv.state.id}.${this.sessionId}.${++this.sendCounter}`;
        if (el.hasAttribute("idlocation")) this.datamodel.assignValue(attr("idlocation")!, id);
      }
      const params = (this.evaluatePayload(withoutContent(el, this.model.ns)) ?? {}) as Record<string, unknown>;
      const contentEl = scxmlChildren(el, this.model.ns).find((c) => c.localName === "content");
      let content: unknown;
      if (contentEl) {
        const expr = contentEl.getAttribute("expr");
        content = expr != null ? this.datamodel.evaluate(expr) : this.inlineValue(contentEl);
      }
      ctx = { invokeid: id, type, src, content, params };
    } catch (e) {
      this.raiseExecutionError(e, el);
      return;
    }

    const active: ActiveInvoke = { id, node: inv, type: ctx.type, pending: [] };
    this.invoked.set(id, active);
    this.invokeIds.set(inv, id);
    this.emit(new InvokeEvent(this, { invokeid: id, invokeType: ctx.type, state: inv.state }));

    const full: InvokeContext = {
      ...ctx,
      sendToParent: (name, data) => this.receiveFromChild(id, { name, type: "external", data }),
      done: (data) => this.receiveFromChild(id, { name: `done.invoke.${id}`, type: "external", data }),
    };
    const started = (service: InvokedService & { start?(): void }) => {
      if (this.invoked.get(id) !== active) return service.cancel(); // cancelled while starting
      active.service = service;
      // The invoked session starts now — at the end of the macrostep, as the spec's main loop does —
      // so it is already running (and has entered its states) when the next event could cancel it.
      service.start?.();
      // then the events sent to it while its source was still loading (a session that
      // hasn't started yet drops incoming events, so this must come after start)
      for (const ev of active.pending.splice(0)) service.send(ev);
    };
    const failed = (e: unknown) => {
      if (this.invoked.get(id) !== active) return;
      this.invoked.delete(id);
      this.raiseExecutionError(e, el);
    };
    try {
      const r = SCXML_INVOKE_TYPES.has(ctx.type) ? this.invokeScxml(full) : this.customInvoke(full);
      if (r instanceof Promise) r.then(started, failed);
      else started(r);
    } catch (e) {
      failed(e);
    }
  }

  private customInvoke(ctx: InvokeContext) {
    const invoker = this.opts.invokers?.[ctx.type];
    if (!invoker) throw new Error(`<invoke>: unsupported type "${ctx.type}"`);
    return invoker(ctx);
  }

  /** SCXML child sessions. Synchronous unless the loader is asynchronous. */
  private invokeScxml(ctx: InvokeContext): InvokedService | Promise<InvokedService> {
    const make = (root: Element): InvokedService | Promise<InvokedService> => {
      const m = compile(root, { loader: this.opts.loader });
      const spawn = (model: Model) => {
        // children don't inherit elementEvents/reflect: their elements live inside the parent's <content>
        const child = new SCXMLSession(model, {
          ...this.opts,
          sessionId: undefined,
          data: ctx.params,
          elementEvents: false,
          reflect: false,
        });
        child.parent = { session: this, invokeid: ctx.invokeid };
        const active = this.invoked.get(ctx.invokeid);
        if (active) active.child = child;
        this.emit(new ChildSessionEvent(this, { invokeid: ctx.invokeid, child }));
        const service: InvokedService & { start(): void } = {
          send: (ev) => child.enqueueExternal({ ...ev }),
          cancel: () => child.cancel(),
          // started by the parent once the invocation is registered, so early replies find it
          // (also when the child's source arrived asynchronously)
          start: () => child.start(),
        };
        return service;
      };
      return m instanceof Promise ? m.then(spawn) : spawn(m);
    };
    if (ctx.content instanceof Object && isElement(ctx.content)) {
      const root = ctx.content.localName === "scxml" ? ctx.content : null;
      if (!root) throw new Error("<invoke>: inline <content> must contain an <scxml> document");
      return make(root);
    }
    if (typeof ctx.content === "string") return make(parseSCXML(ctx.content, this.opts.domParser));
    if (ctx.src != null) {
      if (!this.opts.loader) throw new Error(`<invoke>: no loader for src "${ctx.src}"`);
      const text = this.opts.loader(ctx.src);
      return typeof text === "string"
        ? make(parseSCXML(text, this.opts.domParser))
        : text.then((t) => make(parseSCXML(t, this.opts.domParser)));
    }
    throw new Error("<invoke>: needs src, srcexpr or <content>");
  }

  private cancelInvoke(inv: InvokeNode) {
    const id = this.invokeIds.get(inv);
    if (!id) return;
    this.invokeIds.delete(inv);
    const active = this.invoked.get(id);
    if (!active) return;
    this.invoked.delete(id);
    active.service?.cancel();
  }

  private applyFinalize(inv: InvokeNode) {
    if (inv.finalize) this.executeContent(scxmlChildren(inv.finalize, this.model.ns));
  }

  private deliverToInvoke(active: ActiveInvoke, ev: SCXMLEvent) {
    if (active.service) active.service.send(ev);
    else active.pending.push(ev);
  }

  /** An event from an invoked child (or done.invoke): stamped with its invokeid. */
  private receiveFromChild(invokeid: string, ev: SCXMLEvent) {
    if (!this.invoked.has(invokeid)) return; // cancelled
    this.enqueueExternal({ ...ev, invokeid, [FROM_CHILD]: true });
  }

  // ─────────────────────────────── errors ───────────────────────────────

  private raiseExecutionError(e: unknown, element: Element | null, sendid?: string) {
    this.emitError("error.execution", message(e), element);
    this.internalQueue.push({ name: "error.execution", type: "platform", sendid, data: { message: message(e) } });
    if (!this.busy) this.schedule();
  }

  private emitError(kind: SCXMLErrorKind, msg: string, element: Element | null = null) {
    this.emit(new SCXMLErrorEvent(this, { kind, message: msg, element }));
  }

  private emit(event: SessionEventMap[keyof SessionEventMap]) {
    this.dispatchEvent(event);
  }
}

// ─────────────────────────────── helpers ───────────────────────────────

class ActionError extends Error {
  constructor(
    msg: string,
    readonly element: Element,
    /** set for errors raised by <send>, so the error event carries it (spec §5.10.1) */
    readonly sendid?: string,
  ) {
    super(msg);
  }
}

function capture(options?: boolean | EventListenerOptions) {
  return typeof options === "boolean" ? options : !!options?.capture;
}

function message(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

function stripMarks(ev: QueuedEvent): SCXMLEvent {
  const { [FROM_CHILD]: _, ...rest } = ev;
  return rest;
}

function isValidScxmlTarget(target: string) {
  return target === "" || target === "#_internal" || target === "#_parent" || /^#_scxml_.+/.test(target) || /^#_[^#].*/.test(target);
}

function isElement(v: unknown): v is Element {
  return typeof v === "object" && v !== null && (v as Node).nodeType === 1;
}

/** Element children of any namespace (inline XML content). */
function scxmlChildrenAny(el: Element): Element[] {
  return Array.from(el.children);
}

/** Parse arbitrary XML text into a document element (throws when it isn't XML). */
function parseSCXMLLike(text: string, domParser?: DOMParserLike): Element {
  const parser = domParser ?? (typeof DOMParser !== "undefined" ? new DOMParser() : undefined);
  if (!parser) throw new Error("no DOMParser");
  const doc = parser.parseFromString(text, "application/xml") as Document;
  if (doc.getElementsByTagName("parsererror").length) throw new Error("not XML");
  return doc.documentElement;
}

/** A shallow view of `<invoke>` without `<content>`, for namelist/param evaluation. */
function withoutContent(el: Element, ns: string | null): Element {
  const clone = el.cloneNode(false) as Element;
  for (const c of scxmlChildren(el, ns)) if (c.localName === "param") clone.appendChild(c.cloneNode(true));
  return clone;
}

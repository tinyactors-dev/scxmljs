/**
 * Events dispatched by an SCXMLSession. They are plain `Event` subclasses (not
 * CustomEvent), with typed fields, so hosts can write
 *
 *   session.addEventListener("microstep", (e) => e.entered)
 *
 * without casts. None of them bubble or are cancelable: a host observes a
 * session and influences it only by sending events.
 */
import type { SCXMLEvent } from "./events.ts";
import type { StateNode, TransitionNode } from "./model.ts";
import type { OutboundSend, SCXMLSession } from "./session.ts";

abstract class SessionEvent extends Event {
  /** The session that dispatched the event. */
  readonly session: SCXMLSession;
  constructor(type: string, session: SCXMLSession) {
    super(type);
    this.session = session;
  }
}

/** One microstep: transitions taken, states exited and entered (in exit / entry order). */
export class MicrostepEvent extends SessionEvent {
  /** The event being processed, or `undefined` for eventless transitions (and the initial step). */
  readonly event?: SCXMLEvent;
  /** The transitions taken, in document order. */
  readonly transitions: TransitionNode[];
  /** States exited, in exit order (innermost first). */
  readonly exited: StateNode[];
  /** States entered, in entry order (outermost first). */
  readonly entered: StateNode[];
  constructor(
    session: SCXMLSession,
    init: { event?: SCXMLEvent; transitions: TransitionNode[]; exited: StateNode[]; entered: StateNode[] },
  ) {
    super("microstep", session);
    this.event = init.event;
    this.transitions = init.transitions;
    this.exited = init.exited;
    this.entered = init.entered;
  }
}

/** The session is stable again (a macrostep finished); `event` is the external event that started it, if any. */
export class MacrostepEvent extends SessionEvent {
  /** The external event that started the macrostep; `undefined` for the initial one. */
  readonly event?: SCXMLEvent;
  /** The active states, in document order. */
  readonly configuration: StateNode[];
  constructor(session: SCXMLSession, init: { event?: SCXMLEvent; configuration: StateNode[] }) {
    super("macrostep", session);
    this.event = init.event;
    this.configuration = init.configuration;
  }
}

/** `<log label expr>` */
export class LogEvent extends SessionEvent {
  /** The `label` attribute (empty when absent). */
  readonly label: string;
  /** The value of `expr`, copied out of the data model (`undefined` when absent or empty). */
  readonly value: unknown;
  constructor(session: SCXMLSession, init: { label: string; value: unknown }) {
    super("log", session);
    this.label = init.label;
    this.value = init.value;
  }
}

/** The SCXML error events a session raises (spec §5.10.1). */
export type SCXMLErrorKind = "error.execution" | "error.communication" | "error.platform";

/**
 * The session raised an SCXML error (`kind`). The chart can react to it with
 * a transition on `error.*`; this event tells the host about it too.
 */
export class SCXMLErrorEvent extends SessionEvent {
  /** Which error event the session placed on its internal queue. */
  readonly kind: SCXMLErrorKind;
  /** What went wrong, for people (not a stable format). */
  readonly message: string;
  /** The element whose evaluation failed, when known (for example the `<assign>`). */
  readonly element: Element | null;
  constructor(session: SCXMLSession, init: { kind: SCXMLErrorKind; message: string; element?: Element | null }) {
    super("error", session);
    this.kind = init.kind;
    this.message = init.message;
    this.element = init.element ?? null;
  }
}

/** A `<send>` was dispatched (after any delay) — to the SCXML processor or a custom one. */
export class SendEvent extends SessionEvent {
  /** What was sent: event, target, type, data and sendid. */
  readonly message: OutboundSend;
  constructor(session: SCXMLSession, init: { message: OutboundSend }) {
    super("send", session);
    this.message = init.message;
  }
}

/** An `<invoke>` started. */
export class InvokeEvent extends SessionEvent {
  /** The invocation's id (the `id` attribute, or a generated `stateid.platformid`). */
  readonly invokeid: string;
  /** The invoke type (for example the SCXML type URI or a custom invoker's name). */
  readonly invokeType: string;
  /** The state whose `<invoke>` started it. */
  readonly state: StateNode;
  constructor(session: SCXMLSession, init: { invokeid: string; invokeType: string; state: StateNode }) {
    super("invoke", session);
    this.invokeid = init.invokeid;
    this.invokeType = init.invokeType;
    this.state = init.state;
  }
}

/** An invoked SCXML child session was created (fires before it starts, so listeners see its first step). */
export class ChildSessionEvent extends SessionEvent {
  /** The invocation's id. */
  readonly invokeid: string;
  /** The child session; add listeners now to see its first step. */
  readonly child: SCXMLSession;
  constructor(session: SCXMLSession, init: { invokeid: string; child: SCXMLSession }) {
    super("child", session);
    this.invokeid = init.invokeid;
    this.child = init.child;
  }
}

/** The session terminated; `data` is the top-level final state's donedata, if any. */
export class DoneEvent extends SessionEvent {
  /** The top-level final state's `<donedata>`, or `undefined` (always `undefined` after a cancel). */
  readonly data: unknown;
  constructor(session: SCXMLSession, init: { data: unknown }) {
    super("done", session);
    this.data = init.data;
  }
}

/** Event names → event classes, for `session.addEventListener(type, listener)` without casts. */
export interface SessionEventMap {
  /** After every microstep. */
  microstep: MicrostepEvent;
  /** When the session is stable again after an external event (and after the initial step). */
  macrostep: MacrostepEvent;
  /** A `<log>` executed. */
  log: LogEvent;
  /** An `error.*` event was raised. */
  error: SCXMLErrorEvent;
  /** A `<send>` was dispatched. */
  send: SendEvent;
  /** An `<invoke>` started. */
  invoke: InvokeEvent;
  /** An invoked SCXML child session was created. */
  child: ChildSessionEvent;
  /** The session terminated. */
  done: DoneEvent;
}

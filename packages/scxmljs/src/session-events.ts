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
import type { IOProcessor, OutboundSend, SCXMLSession } from "./session.ts";

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
  /**
   * The id of `event`: the `id` of the `enqueue` event that queued it, so a host can tell which
   * delivery this step processed. `undefined` when `event` is.
   */
  readonly eventId?: number;
  /** The transitions taken, in document order. */
  readonly transitions: TransitionNode[];
  /** States exited, in exit order (innermost first). */
  readonly exited: StateNode[];
  /** States entered, in entry order (outermost first). */
  readonly entered: StateNode[];
  constructor(
    session: SCXMLSession,
    init: { event?: SCXMLEvent; eventId?: number; transitions: TransitionNode[]; exited: StateNode[]; entered: StateNode[] },
  ) {
    super("microstep", session);
    this.event = init.event;
    this.eventId = init.eventId;
    this.transitions = init.transitions;
    this.exited = init.exited;
    this.entered = init.entered;
  }
}

/**
 * The session is stable again (a macrostep finished); `event` is the external event that started it, if any.
 *
 * The macrostep that ends the session (a top-level final state, or `cancel()` during the step)
 * is reported too, with the configuration it ended in, and always before the `done` event: no
 * session event follows `done`.
 */
export class MacrostepEvent extends SessionEvent {
  /** The external event that started the macrostep; `undefined` for the initial one. */
  readonly event?: SCXMLEvent;
  /** The id of `event` (see `EnqueueEvent.id`); `undefined` when `event` is. */
  readonly eventId?: number;
  /** The active states, in document order. */
  readonly configuration: StateNode[];
  constructor(session: SCXMLSession, init: { event?: SCXMLEvent; eventId?: number; configuration: StateNode[] }) {
    super("macrostep", session);
    this.event = init.event;
    this.eventId = init.eventId;
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
  /**
   * What was sent: event, target, type, data and sendid. For a delayed send it is the same object
   * the `sendscheduled` event carried, so the two can be matched even without a sendid.
   */
  readonly message: OutboundSend;
  /** The custom I/O processor `<send type>` resolved to (`message.type` is its canonical type); `undefined` for the SCXML processor. */
  readonly processor?: IOProcessor;
  /** The delay in ms the `<send>` asked for (`0` when it was not delayed). */
  readonly delay: number;
  /**
   * The id of the event being processed when the `<send>` executed (see `EnqueueEvent.id`), also for a
   * delayed send that is dispatched later; `undefined` when it executed in the initial step, an
   * eventless transition of it, or while the session ended.
   */
  readonly triggerId?: number;
  constructor(session: SCXMLSession, init: { message: OutboundSend; processor?: IOProcessor; delay?: number; triggerId?: number }) {
    super("send", session);
    this.message = init.message;
    this.processor = init.processor;
    this.delay = init.delay ?? 0;
    this.triggerId = init.triggerId;
  }
}

/**
 * A `<send>` with a delay was scheduled: unless a `<cancel>` or the end of the session discards it
 * first (a `sendcancelled` event), it is dispatched after `delay` ms of the session's clock (a `send`
 * event with the same `message` object).
 */
export class SendScheduledEvent extends SessionEvent {
  /** What will be sent, evaluated now (spec §6.2.3). The `send` event carries this same object. */
  readonly message: OutboundSend;
  /** The custom I/O processor it will go to; `undefined` for the SCXML processor. */
  readonly processor?: IOProcessor;
  /** The delay in ms. */
  readonly delay: number;
  /** The id of the event being processed when the `<send>` executed (see `SendEvent.triggerId`). */
  readonly triggerId?: number;
  constructor(session: SCXMLSession, init: { message: OutboundSend; processor?: IOProcessor; delay: number; triggerId?: number }) {
    super("sendscheduled", session);
    this.message = init.message;
    this.processor = init.processor;
    this.delay = init.delay;
    this.triggerId = init.triggerId;
  }
}

/** A delayed `<send>` was discarded before it was dispatched. */
export class SendCancelledEvent extends SessionEvent {
  /** The message of its `sendscheduled` event (the same object). */
  readonly message: OutboundSend;
  /** The custom I/O processor it would have gone to; `undefined` for the SCXML processor. */
  readonly processor?: IOProcessor;
  /** The delay in ms it was scheduled with. */
  readonly delay: number;
  /** `cancel`: a `<cancel>` named its sendid; `exit`: the session terminated (or was disposed) first. */
  readonly reason: "cancel" | "exit";
  constructor(session: SCXMLSession, init: { message: OutboundSend; processor?: IOProcessor; delay: number; reason: "cancel" | "exit" }) {
    super("sendcancelled", session);
    this.message = init.message;
    this.processor = init.processor;
    this.delay = init.delay;
    this.reason = init.reason;
  }
}

/**
 * An event was placed on one of the session's queues: the external queue (`session.send()`, an I/O
 * processor's `deliver`, a `<send>` from this or another session, `#_parent` and `#_<invokeid>`
 * targets, an invoked child or service, `done.invoke.*`) or the internal one (`<raise>`, `#_internal`,
 * `done.state.*`, `error.*`).
 *
 * `id` names the event from here on: the `microstep` and `macrostep` events that process it carry
 * it as `eventId`. Ids are numbers unique within the JavaScript realm; compare them, don't
 * interpret them. They are the host's: the chart never sees them (`_event` has no such field).
 */
export class EnqueueEvent extends SessionEvent {
  /** The event's id. */
  readonly id: number;
  /** The event as the chart will see it as `_event` (a copy: changing it changes nothing). */
  readonly event: SCXMLEvent;
  /** Which queue it joined. */
  readonly queue: "external" | "internal";
  /** The custom I/O processor that delivered it (`event.origintype` is its type); `undefined` for every other source. */
  readonly processor?: IOProcessor;
  /**
   * True when the session discarded the event instead of queueing it: it had terminated or was
   * disposed, or the event came from an invocation the session had already cancelled.
   */
  readonly dropped: boolean;
  constructor(
    session: SCXMLSession,
    init: { id: number; event: SCXMLEvent; queue: "external" | "internal"; processor?: IOProcessor; dropped?: boolean },
  ) {
    super("enqueue", session);
    this.id = init.id;
    this.event = init.event;
    this.queue = init.queue;
    this.processor = init.processor;
    this.dropped = init.dropped ?? false;
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

/**
 * The session terminated; `data` is the top-level final state's donedata, if any. It is the last
 * event a session dispatches, once: also for a session disposed before it started.
 */
export class DoneEvent extends SessionEvent {
  /** The top-level final state's `<donedata>`, or `undefined` (always `undefined` after a cancel). */
  readonly data: unknown;
  /**
   * True when `dispose()` ended the session (`session.cancelled` is then true too); false when it
   * reached a top-level final state or was cancelled otherwise (`cancel()`, or by the session that
   * invoked it).
   */
  readonly disposed: boolean;
  constructor(session: SCXMLSession, init: { data: unknown; disposed?: boolean }) {
    super("done", session);
    this.data = init.data;
    this.disposed = init.disposed ?? false;
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
  /** A `<send>` with a delay was scheduled. */
  sendscheduled: SendScheduledEvent;
  /** A delayed `<send>` was discarded before its dispatch. */
  sendcancelled: SendCancelledEvent;
  /** An event joined the external or internal queue (or was dropped). */
  enqueue: EnqueueEvent;
  /** An `<invoke>` started. */
  invoke: InvokeEvent;
  /** An invoked SCXML child session was created. */
  child: ChildSessionEvent;
  /** The session terminated. */
  done: DoneEvent;
}

/**
 * Generic fake external services for the explorer samples: each is an SCXML
 * Event I/O Processor that answers `<send type="…" event="verb">` with
 * `<alias>.<verb>.done` (or `.error`) after a delay on the session's clock,
 * can push unsolicited events (webhooks), and keeps a traffic log a UI can show.
 */
import type { Clock, IOProcessor, IOSession, OutboundSend } from "@tinyactors/scxmljs/trusted";

export interface TrafficEntry {
  at: number;
  direction: "out" | "in";
  sessionId: string;
  event: string;
  data?: unknown;
}

export interface FakeServiceOptions {
  /** Canonical type URI, e.g. "urn:example:warehouse". */
  type: string;
  /** Short name used in charts: `<send type="warehouse">`. Also the prefix of replies. */
  alias: string;
  clock: Clock;
  /** Delay before replying (ms). Default 400. */
  latencyMs?: number | ((message: OutboundSend) => number);
  /**
   * Custom behaviour. Call `reply(name, data, delayMs)` any number of times
   * (e.g. to emit a series of webhooks). Without a handler every verb gets
   * `<alias>.<verb>.done` with the message data echoed back.
   */
  handle?: (message: OutboundSend, reply: (name: string, data?: unknown, delayMs?: number) => void, service: FakeService) => void;
}

export class FakeService extends EventTarget implements IOProcessor {
  readonly type: string;
  readonly aliases: readonly string[];
  readonly traffic: TrafficEntry[] = [];
  private sessions = new Set<IOSession>();
  /** Remaining forced failures per verb. */
  readonly failures = new Map<string, number>();

  constructor(readonly opts: FakeServiceOptions) {
    super();
    this.type = opts.type;
    this.aliases = [opts.alias];
  }

  get alias() {
    return this.opts.alias;
  }

  location(session: IOSession) {
    return `${this.opts.alias}:${session.sessionId}`;
  }

  attach(session: IOSession) {
    this.sessions.add(session);
  }

  detach(session: IOSession) {
    this.sessions.delete(session);
  }

  failNext(verb: string, times = 1) {
    this.failures.set(verb, (this.failures.get(verb) ?? 0) + times);
  }

  send(message: OutboundSend, session: IOSession) {
    this.record({ direction: "out", sessionId: session.sessionId, event: message.event, data: message.data });
    const base = typeof this.opts.latencyMs === "function" ? this.opts.latencyMs(message) : (this.opts.latencyMs ?? 400);
    const reply = (name: string, data?: unknown, delayMs = base) =>
      this.opts.clock.setTimeout(() => this.deliver(session, name, data), delayMs);
    const left = this.failures.get(message.event) ?? 0;
    if (left > 0) {
      this.failures.set(message.event, left - 1);
      reply(`${this.alias}.${message.event}.error`, { reason: "injected failure" });
      return;
    }
    if (this.opts.handle) this.opts.handle(message, reply, this);
    else reply(`${this.alias}.${message.event}.done`, message.data);
  }

  /** Push an unsolicited event (a webhook) to every attached session, or one. */
  emit(name: string, data?: unknown, session?: IOSession) {
    for (const s of session ? [session] : this.sessions) this.deliver(s, name, data);
  }

  private deliver(session: IOSession, name: string, data?: unknown) {
    if (!this.sessions.has(session)) return; // session ended meanwhile
    this.record({ direction: "in", sessionId: session.sessionId, event: name, data });
    session.deliver(name, data, this.location(session));
  }

  private record(e: Omit<TrafficEntry, "at">) {
    this.traffic.push({ at: this.opts.clock.now(), ...e });
    if (this.traffic.length > 500) this.traffic.splice(0, this.traffic.length - 500);
    this.dispatchEvent(new Event("traffic"));
  }
}

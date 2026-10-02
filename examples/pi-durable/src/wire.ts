/**
 * The wire: an Event I/O Processor between clients (client.scxml) and whatever process is up.
 *
 * Clients are other machines: they outlive the harness. While no process is up, what they send
 * is dropped and they are told the link is down; when a process comes up they are told it is
 * back. Messages take `latencyMs` of the shared clock. Every message is reported to `tap`
 * listeners (the page's timeline).
 */
import type { Clock, IOProcessor, IOSession, OutboundSend } from "@tinyactors/scxmljs";

export const WIRE = "http://tinyactors.dev/pi-durable/wire";

export interface WireRecord {
  at: number;
  from: string;
  to: string;
  event: string;
  data: unknown;
  dropped?: boolean;
}

/** The process side: what a client's message makes the harness do. */
export type Server = (client: string, event: string, data: Record<string, unknown>) => void;

export class Wire implements IOProcessor {
  readonly type = WIRE;
  readonly aliases = ["wire"];
  latencyMs = 60;
  server: Server | null = null;
  readonly #clients = new Map<string, IOSession>();
  readonly #idOf = new Map<string, string>(); // sessionId → clientId
  readonly #taps = new Set<(r: WireRecord) => void>();
  /** Bumped when the process changes: replies a dead process had in flight are lost with it. */
  #generation = 0;

  constructor(readonly clock: Clock) {}

  register(clientId: string, session: { readonly sessionId: string }): void {
    this.#idOf.set(session.sessionId, clientId);
  }

  tap(fn: (r: WireRecord) => void): () => void {
    this.#taps.add(fn);
    return () => this.#taps.delete(fn);
  }

  get up(): boolean {
    return this.server !== null;
  }

  /** A process is up (or gone): every client hears about it. */
  setServer(server: Server | null): void {
    this.server = server;
    this.#generation++;
    for (const id of this.#clients.keys()) this.toClient(id, server ? "wire.up" : "wire.down", {});
  }

  location(session: IOSession): string {
    return `${WIRE}#${this.#idOf.get(session.sessionId) ?? session.sessionId}`;
  }

  attach(session: IOSession): void {
    const id = this.#idOf.get(session.sessionId);
    if (!id) return;
    this.#clients.set(id, session);
    if (this.server) this.toClient(id, "wire.up", {});
  }

  detach(session: IOSession): void {
    const id = this.#idOf.get(session.sessionId);
    if (id) this.#clients.delete(id);
  }

  /** A client → the process. */
  send(m: OutboundSend, session: IOSession): void {
    const from = this.#idOf.get(session.sessionId) ?? "?";
    const record: WireRecord = { at: this.clock.now(), from, to: "harness", event: m.event, data: m.data };
    if (!this.server) record.dropped = true;
    for (const t of this.#taps) t(record);
    if (record.dropped) return;
    this.clock.setTimeout(() => this.server?.(from, m.event, (m.data ?? {}) as Record<string, unknown>), this.latencyMs);
  }

  /** The process → a client. */
  toClient(client: string, event: string, data: unknown): void {
    const quiet = event === "wire.up" || event === "wire.down";
    if (!quiet) for (const t of this.#taps) t({ at: this.clock.now(), from: "harness", to: client, event, data });
    const generation = this.#generation;
    this.clock.setTimeout(
      () => {
        if (!quiet && generation !== this.#generation) return;
        this.#clients.get(client)?.deliver(event, data, "harness");
      },
      quiet ? 0 : this.latencyMs,
    );
  }

  /** The client's own screen: never crosses the network. */
  fromPanel(client: string, event: string, data: unknown = {}): void {
    this.#clients.get(client)?.deliver(event, data, "ui");
  }
}

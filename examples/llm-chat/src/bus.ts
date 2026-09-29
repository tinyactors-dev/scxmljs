/**
 * The bus: an in-memory Event I/O Processor between the host and its clients.
 *
 * Behaves like a small network so the demo can show what goes wrong on one: messages take
 * `latencyMs` of the shared clock, arrive in order per sender, and are dropped silently while
 * either end is offline. Every message is also reported to `tap` listeners (the timeline).
 */
import type { Clock, IOProcessor, IOSession, OutboundSend } from "@tinyactors/scxmljs";
import { type Address, BUS, type ClientId } from "./protocol.ts";

export interface BusRecord {
  at: number;
  from: Address | "ui";
  to: Address;
  event: string;
  data: unknown;
  dropped?: "offline" | "unknown";
}

export class Bus implements IOProcessor {
  readonly type = BUS;
  readonly aliases = ["bus"];
  /** Delivery delay per message, in clock ms. */
  latencyMs = 0;
  /** Receives what the host sends to the control panel (e.g. `input.rejected`). */
  onControlReply?: (event: string, data: unknown) => void;

  readonly #byAddress = new Map<Address, IOSession>();
  readonly #addressOf = new Map<string, Address>(); // sessionId → address
  readonly #offline = new Set<ClientId>();
  readonly #taps = new Set<(r: BusRecord) => void>();
  readonly #watchers = new Map<Address, Set<(event: string, data: unknown, from: Address) => void>>();

  constructor(readonly clock: Clock) {}

  /** Give a session its address. Call before `session.start()`: the bus binds it in `attach`. */
  register(address: Address, session: { readonly sessionId: string }): void {
    this.#addressOf.set(session.sessionId, address);
  }

  unregister(address: Address): void {
    const s = this.#byAddress.get(address);
    if (s) this.#addressOf.delete(s.sessionId);
    this.#byAddress.delete(address);
    this.#offline.delete(address);
    this.#watchers.delete(address);
  }

  setOnline(client: ClientId, online: boolean): void {
    if (online) this.#offline.delete(client);
    else this.#offline.add(client);
  }

  isOnline(client: ClientId): boolean {
    return !this.#offline.has(client);
  }

  /** Listen to every message (for the timeline). Returns an unsubscribe function. */
  tap(listener: (r: BusRecord) => void): () => void {
    this.#taps.add(listener);
    return () => this.#taps.delete(listener);
  }

  /** Observe what is delivered to `address`, as it lands (a panel's view of its client). */
  watch(address: Address, listener: (event: string, data: unknown, from: Address) => void): () => void {
    const set = this.#watchers.get(address) ?? new Set();
    this.#watchers.set(address, set);
    set.add(listener);
    return () => set.delete(listener);
  }

  // ── IOProcessor ──────────────────────────────────────────────────────────

  location(session: IOSession): string {
    return `${BUS}#${this.#addressOf.get(session.sessionId) ?? session.sessionId}`;
  }

  attach(session: IOSession): void {
    const address = this.#addressOf.get(session.sessionId);
    if (address) this.#byAddress.set(address, session);
  }

  detach(session: IOSession): void {
    const address = this.#addressOf.get(session.sessionId);
    if (address) this.unregister(address);
  }

  send(message: OutboundSend, session: IOSession): void {
    const from = this.#addressOf.get(session.sessionId);
    if (!from) throw new Error(`bus: session ${session.sessionId} has no address`);
    this.post(from, message.target as Address, message.event, message.data);
  }

  // ── host-side code (the chat log, the panels) ────────────────────────────

  /** Send as `from`. `"*"` reaches every client (never the host). */
  post(from: Address, to: Address, event: string, data?: unknown): void {
    if (to === "*") {
      for (const address of this.#byAddress.keys()) if (address !== "host") this.post(from, address, event, data);
      return;
    }
    const record: BusRecord = { at: this.clock.now(), from, to, event, data };
    // The host answering the control panel (origin "host"): that goes to the panel, not back
    // into the host chart (an `input.rejected` would match the chart's own `input.*`).
    if (from === "host" && to === "host") {
      for (const t of this.#taps) t(record);
      this.clock.setTimeout(() => this.onControlReply?.(event, data), this.latencyMs);
      return;
    }
    if (this.#offline.has(from) || this.#offline.has(to)) record.dropped = "offline";
    else if (!this.#byAddress.has(to)) record.dropped = "unknown";
    for (const t of this.#taps) t(record);
    if (record.dropped) return;
    // Resolve the session when the message lands: the receiver may have left meanwhile.
    this.clock.setTimeout(() => {
      if (this.#offline.has(to)) return;
      const session = this.#byAddress.get(to);
      if (!session) return;
      for (const w of this.#watchers.get(to) ?? []) w(event, data, from);
      session.deliver(event, data, from);
    }, this.latencyMs);
  }

  /** A client's own panel: never crosses the network, so it works while offline. */
  fromPanel(client: ClientId, event: string, data: unknown = {}): void {
    for (const t of this.#taps) t({ at: this.clock.now(), from: "ui", to: client, event, data });
    this.#byAddress.get(client)?.deliver(event, data, "ui");
  }

  /** The host's control panel: origin "host", which the host chart trusts. */
  fromControl(event: string, data: unknown = {}): void {
    for (const t of this.#taps) t({ at: this.clock.now(), from: "host", to: "host", event, data });
    this.#byAddress.get("host")?.deliver(event, data, "host");
  }
}

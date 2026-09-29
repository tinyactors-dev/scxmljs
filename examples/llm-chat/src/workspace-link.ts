/**
 * The `workspace` I/O processor: clients ⇄ the shared WebAssembly workspace (workspace.scxml).
 *
 *   client → workspace   need { packages }                       (origin = the client's id)
 *   workspace → client   workspace.progress / .ready / .failed    (target = the client's id)
 *
 * Local to the tab: no latency, no offline (the workspace is this browser's, not the host's).
 */
import type { IOProcessor, IOSession, OutboundSend } from "@tinyactors/scxmljs";
import { WORKSPACE_LINK } from "./protocol.ts";

export interface LinkRecord {
  from: string;
  to: string;
  event: string;
  data: unknown;
}

export class WorkspaceLink implements IOProcessor {
  readonly type = WORKSPACE_LINK;
  readonly aliases = ["workspace"];

  readonly #addressOf = new Map<string, string>(); // sessionId → address
  readonly #byAddress = new Map<string, IOSession>();
  readonly #taps = new Set<(r: LinkRecord) => void>();

  /** Give a session its address ("workspace", or a client id). Call before it starts. */
  register(address: string, session: { readonly sessionId: string }): void {
    this.#addressOf.set(session.sessionId, address);
  }

  tap(listener: (r: LinkRecord) => void): () => void {
    this.#taps.add(listener);
    return () => this.#taps.delete(listener);
  }

  location(session: IOSession): string {
    return `${WORKSPACE_LINK}#${this.#addressOf.get(session.sessionId) ?? session.sessionId}`;
  }

  attach(session: IOSession): void {
    const address = this.#addressOf.get(session.sessionId);
    if (address) this.#byAddress.set(address, session);
  }

  detach(session: IOSession): void {
    const address = this.#addressOf.get(session.sessionId);
    if (address && this.#byAddress.get(address) === session) this.#byAddress.delete(address);
  }

  send(message: OutboundSend, session: IOSession): void {
    const from = this.#addressOf.get(session.sessionId);
    if (!from) throw new Error(`workspace link: session ${session.sessionId} has no address`);
    const record = { from, to: message.target, event: message.event, data: message.data };
    for (const t of this.#taps) t(record);
    this.#byAddress.get(message.target)?.deliver(message.event, message.data, from);
  }
}

/**
 * The chat log: the only writer of the conversation.
 *
 * - The host chart sends it commands through the `log` I/O processor (PROTOCOL.md §2).
 * - The llm invoker streams into a draft (`draft(request)`); the chart later commits or
 *   discards it. Streamed content never passes through a chart.
 * - Every change is a numbered entry, broadcast to the clients as `log.batch`, coalesced.
 * - `history()` is the API conversation: append-only; committed messages are the model's
 *   content unchanged (thinking blocks included); discarded drafts never enter it.
 */
import type { Clock, IOProcessor, IOSession, OutboundSend } from "@tinyactors/scxmljs";
import type { Bus } from "./bus.ts";
import {
  type BetaMessage,
  type BetaMessageParam,
  type BetaRawMessageStreamEvent,
  type Input,
  LOG,
  type LogEntry,
  type LogEntryBody,
  type ToolResult,
} from "./protocol.ts";

export class Draft {
  message: BetaMessage | null = null;
  readonly #kinds = new Map<number, string>();

  constructor(
    readonly request: number,
    readonly model: string,
    private readonly log: ChatLog,
  ) {
    log.append({ kind: "assistant.start", request, model });
  }

  /** One streaming event → log entries (deltas are coalesced by the broadcast, not here). */
  apply(event: BetaRawMessageStreamEvent): void {
    const { request, log } = this;
    switch (event.type) {
      case "content_block_start": {
        const block = event.content_block;
        this.#kinds.set(event.index, block.type);
        log.append({
          kind: "block.start",
          request,
          index: event.index,
          block: block.type,
          ...(block.type === "tool_use" ? { name: block.name, id: block.id } : {}),
        });
        break;
      }
      case "content_block_delta": {
        const d = event.delta;
        if (d.type === "text_delta") log.append({ kind: "block.delta", request, index: event.index, text: d.text });
        else if (d.type === "thinking_delta") log.append({ kind: "block.delta", request, index: event.index, text: d.thinking });
        else if (d.type === "input_json_delta") log.append({ kind: "block.delta", request, index: event.index, json: d.partial_json });
        break;
      }
      case "content_block_stop":
        log.append({ kind: "block.stop", request, index: event.index });
        break;
      case "message_delta":
        log.append({
          kind: "usage",
          request,
          input: event.usage.input_tokens ?? 0,
          output: event.usage.output_tokens,
          cacheRead: event.usage.cache_read_input_tokens ?? 0,
        });
        break;
    }
  }

  kindOf(index: number): string {
    return this.#kinds.get(index) ?? "unknown";
  }

  /** The complete message, from the stream's `finalMessage()`. */
  finish(message: BetaMessage): void {
    this.message = message;
  }
}

export class ChatLog implements IOProcessor {
  readonly type = LOG;
  readonly aliases = ["log"];
  /** How long deltas are collected before a `log.batch` goes out (clock ms). */
  batchMs = 50;

  readonly entries: LogEntry[] = [];
  readonly #history: BetaMessageParam[] = [];
  readonly #drafts = new Map<number, Draft>();
  #flushAt = -1; // index of the first entry not yet broadcast
  #timer: unknown = null;
  readonly #listeners = new Set<(e: LogEntry) => void>();

  constructor(
    readonly clock: Clock,
    readonly bus: Bus,
  ) {}

  get seq(): number {
    return this.entries.length;
  }

  /** The API conversation, for the llm invoker. */
  history(): BetaMessageParam[] {
    return this.#history.slice();
  }

  /** Listen to every entry as it is appended (the host's own view, the timeline). */
  subscribe(listener: (e: LogEntry) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  append(body: LogEntryBody): LogEntry {
    const entry = { ...body, seq: this.entries.length + 1, at: this.clock.now() } as LogEntry;
    this.entries.push(entry);
    for (const l of this.#listeners) l(entry);
    if (this.#flushAt < 0) this.#flushAt = entry.seq - 1;
    this.#timer ??= this.clock.setTimeout(() => this.flush(), this.batchMs);
    return entry;
  }

  /** Broadcast what's pending now. */
  flush(): void {
    if (this.#timer !== null) this.clock.clearTimeout(this.#timer);
    this.#timer = null;
    if (this.#flushAt < 0) return;
    const entries = this.entries.slice(this.#flushAt);
    this.#flushAt = -1;
    this.bus.post("host", "*", "log.batch", { first: entries[0]!.seq, last: entries.at(-1)!.seq, entries });
  }

  draft(request: number, model: string): Draft {
    const d = new Draft(request, model, this);
    this.#drafts.set(request, d);
    return d;
  }

  /** The host's configuration, from its macrosteps. */
  state(configuration: string[]): void {
    this.append({ kind: "state", configuration });
  }

  // ── IOProcessor: commands from the host chart ────────────────────────────

  location(): string {
    return LOG;
  }

  send(message: OutboundSend, _session: IOSession): void {
    const d = (message.data ?? {}) as Record<string, unknown>;
    switch (message.event) {
      case "user.append": {
        const entries = d.entries as Input[];
        if (!entries.length) return;
        this.#history.push({
          role: "user",
          content: entries.map((e) => ({ type: "text" as const, text: `[${e.author}] ${e.text}` })),
        });
        this.append({ kind: "user", turn: d.turn as number, entries });
        return;
      }
      case "assistant.commit": {
        const request = d.request as number;
        const draft = this.#drafts.get(request);
        if (!draft?.message) throw new Error(`log: no finished draft for request ${request}`);
        this.#history.push({ role: "assistant", content: draft.message.content });
        this.#drafts.delete(request);
        this.append({ kind: "assistant.commit", request, stop: String(d.stop) });
        return;
      }
      case "assistant.discard": {
        const request = d.request as number;
        this.#drafts.delete(request);
        this.append({ kind: "assistant.discard", request, reason: String(d.reason ?? "") });
        return;
      }
      case "tools.dispatched": {
        const calls = d.calls as { id: string; name: string; provider: string | null }[];
        this.append({
          kind: "tools",
          request: d.request as number,
          calls: calls.map(({ id, name, provider }) => ({ id, name, provider })),
        });
        return;
      }
      case "tools.timer":
        this.append({ kind: "timer", request: d.request as number, ms: Number(d.ms) });
        return;
      case "tool.results": {
        const results = d.results as ToolResult[];
        const steers = (d.steers ?? []) as Input[];
        // one user message: every tool_result first (in call order), then any steering text
        const order = this.#lastToolUseIds();
        const sorted = [...results].sort((a, b) => order.indexOf(a.callId) - order.indexOf(b.callId));
        this.#history.push({
          role: "user",
          content: [
            ...sorted.map((r) => ({
              type: "tool_result" as const,
              tool_use_id: r.callId,
              is_error: r.isError,
              content: r.content,
            })),
            ...steers.map((s) => ({ type: "text" as const, text: `[${s.author}] ${s.text}` })),
          ],
        });
        this.append({ kind: "tool.results", request: d.request as number, results: sorted, steers });
        return;
      }
      case "queue.changed":
        this.append({ kind: "steers", steers: d.steers as Input[] });
        return;
      case "roster.changed":
        this.append({ kind: "roster", clients: d.clients as never });
        return;
      case "notice":
        this.append({ kind: "notice", level: d.level as "info", text: String(d.text) });
        return;
      case "snapshot.send":
        this.flush();
        this.bus.post("host", d.to as string, "snapshot", { seq: this.seq, entries: this.entries.slice() });
        return;
      default:
        throw new Error(`log: unknown command ${message.event}`);
    }
  }

  #lastToolUseIds(): string[] {
    const last = this.#history.at(-1);
    if (!last || last.role !== "assistant" || typeof last.content === "string") return [];
    return last.content.flatMap((b) => (b.type === "tool_use" ? [b.id] : []));
  }
}

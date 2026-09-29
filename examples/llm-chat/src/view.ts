/**
 * What a panel renders: the log entries folded into a transcript. Every client has one,
 * fed from the bus (`snapshot`, `log.batch`); the control panel's is fed from the log directly.
 * Its gap handling mirrors client.scxml's `sync` region: a batch that doesn't continue what we
 * have is ignored, and the chart asks for a snapshot.
 */
import type { ClientId, Input, LogBatch, LogEntry, RosterEntry, Snapshot } from "./protocol.ts";

export interface BlockView {
  kind: string;
  text: string;
  name?: string;
  id?: string;
  json?: string;
}

export type Item =
  | { type: "user"; author: string; text: string; steer: boolean }
  | {
      type: "assistant";
      request: number;
      model: string;
      blocks: BlockView[];
      status: "streaming" | "committed" | "discarded";
      note?: string;
    }
  | {
      type: "tools";
      request: number;
      calls: { id: string; name: string; provider: ClientId | null; status: "running" | "done" | "failed"; content?: string }[];
      /** the host's tool timeout, in clock time: armed at `armedAt`, due at `deadline` */
      armedAt?: number;
      deadline?: number;
    }
  | { type: "notice"; level: string; text: string };

export class ConversationView extends EventTarget {
  seq = 0;
  items: Item[] = [];
  steers: Input[] = [];
  roster: RosterEntry[] = [];
  configuration: string[] = [];
  usage = { input: 0, output: 0, cacheRead: 0 };

  /** A bus message for this client. Returns false for a batch that leaves a gap. */
  receive(event: string, data: unknown): boolean {
    if (event === "snapshot") {
      const s = data as Snapshot;
      this.#reset();
      this.#apply(s.entries);
      this.seq = s.seq;
    } else if (event === "log.batch") {
      const b = data as LogBatch;
      if (b.last <= this.seq) return true;
      if (b.first > this.seq + 1) return false;
      this.#apply(b.entries.filter((e) => e.seq > this.seq));
    } else return true;
    this.dispatchEvent(new Event("change"));
    return true;
  }

  /** Entries straight from the log (the control panel). */
  append(entry: LogEntry): void {
    this.#apply([entry]);
    this.dispatchEvent(new Event("change"));
  }

  /** The user-visible transcript as plain text (tests compare these across clients). */
  text(): string {
    return this.items
      .map((i): string => {
        switch (i.type) {
          case "user":
            return `${i.steer ? "steer" : "user"} [${i.author}] ${i.text}`;
          case "assistant":
            return `assistant(${i.status}) ${i.blocks.map((b) => (b.kind === "tool_use" ? `<${b.name}>` : b.text)).join(" | ")}`;
          case "tools":
            return `tools ${i.calls.map((c) => `${c.name}@${c.provider ?? "-"}:${c.status}`).join(", ")}`;
          default:
            return `notice(${i.level}) ${i.text}`;
        }
      })
      .join("\n");
  }

  #reset(): void {
    this.seq = 0;
    this.items = [];
    this.steers = [];
    this.roster = [];
    this.configuration = [];
    this.usage = { input: 0, output: 0, cacheRead: 0 };
  }

  #assistant(request: number): Extract<Item, { type: "assistant" }> | undefined {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]!;
      if (it.type === "assistant" && it.request === request) return it;
    }
    return undefined;
  }

  #apply(entries: LogEntry[]): void {
    for (const e of entries) {
      this.seq = e.seq;
      switch (e.kind) {
        case "user":
          for (const x of e.entries) this.items.push({ type: "user", author: x.author, text: x.text, steer: false });
          break;
        case "assistant.start":
          this.items.push({ type: "assistant", request: e.request, model: e.model, blocks: [], status: "streaming" });
          break;
        case "block.start":
          this.#assistant(e.request)?.blocks.splice(e.index, 0, {
            kind: e.block,
            text: "",
            ...(e.name ? { name: e.name } : {}),
            ...(e.id ? { id: e.id } : {}),
          });
          break;
        case "block.delta": {
          const b = this.#assistant(e.request)?.blocks[e.index];
          if (b && e.text) b.text += e.text;
          if (b && e.json) b.json = (b.json ?? "") + e.json;
          break;
        }
        case "assistant.commit": {
          const a = this.#assistant(e.request);
          if (a) a.status = "committed";
          break;
        }
        case "assistant.discard": {
          const a = this.#assistant(e.request);
          if (a) {
            a.status = "discarded";
            a.note = e.reason;
          }
          break;
        }
        case "tools":
          this.items.push({ type: "tools", request: e.request, calls: e.calls.map((c) => ({ ...c, status: "running" as const })) });
          break;
        case "timer": {
          const card = this.items.findLast((i) => i.type === "tools" && i.request === e.request);
          if (card?.type === "tools") {
            card.armedAt = e.at;
            card.deadline = e.at + e.ms;
          }
          break;
        }
        case "tool.results": {
          const card = this.items.findLast((i) => i.type === "tools" && i.request === e.request);
          if (card?.type === "tools")
            for (const r of e.results) {
              const c = card.calls.find((x) => x.id === r.callId);
              if (c) Object.assign(c, { status: r.isError ? "failed" : "done", content: r.content });
            }
          for (const s of e.steers) this.items.push({ type: "user", author: s.author, text: s.text, steer: true });
          break;
        }
        case "steers":
          this.steers = e.steers;
          break;
        case "roster":
          this.roster = e.clients;
          break;
        case "notice":
          this.items.push({ type: "notice", level: e.level, text: e.text });
          break;
        case "state":
          this.configuration = e.configuration;
          break;
        case "usage":
          this.usage.input += e.input;
          this.usage.output += e.output;
          this.usage.cacheRead += e.cacheRead;
          break;
        case "block.stop":
          break;
      }
    }
  }
}

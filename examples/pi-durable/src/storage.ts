/**
 * Storage: the only thing that survives the process.
 *
 * A memory backend in the shape of Pi Durable's `Storage` (packages/durable/src/types.ts): records
 * change only through atomic commits, each a numbered list of writes. The commit log doubles as
 * the JSONL backend's file: one line per commit. "Killing the process" throws away every session,
 * timer and promise; this object is all a new process gets.
 *
 * `Tx` is one commit being built: reads see its own writes, nothing is visible until `commit()`.
 */
import type { Clock } from "@tinyactors/scxmljs";
import {
  type CommitRecord,
  type ConversationRecord,
  DOCS,
  type DocDefinition,
  type EntryData,
  type EntryRecord,
  type SubmissionRecord,
  type TaskRecord,
  type Write,
} from "./types.ts";

interface StoredDoc {
  kind: string;
  scope: string;
  value: unknown;
  /** Every committed value, by commit: `asOf` forks read the value at the fork entry's commit. */
  history: { seq: number; value: unknown }[];
}

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

export class Storage {
  /** One process owns a storage at a time. */
  owner: string | null = null;
  seq = 0;
  readonly conversations = new Map<string, ConversationRecord>();
  readonly entries = new Map<string, EntryRecord>();
  /** Each conversation's own entries, in order (a fork's parent entries are not copied). */
  readonly order = new Map<string, string[]>();
  readonly tasks = new Map<string, TaskRecord>();
  readonly submissions = new Map<string, SubmissionRecord>();
  readonly docs = new Map<string, StoredDoc>();
  readonly log: CommitRecord[] = [];
  readonly #ids: Record<string, number> = {};
  readonly #listeners = new Set<(c: CommitRecord) => void>();

  constructor(readonly clock: Clock) {}

  /** Ids are minted durably: a new process never reuses one. */
  mint(prefix: "c" | "e" | "t" | "s"): string {
    this.#ids[prefix] = (this.#ids[prefix] ?? 0) + 1;
    return `${prefix}${this.#ids[prefix]}`;
  }

  subscribe(fn: (c: CommitRecord) => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  /** Apply every write, or none (nothing here can fail halfway). */
  commit(by: string, name: string, writes: Write[]): CommitRecord {
    const seq = ++this.seq;
    for (const w of writes) {
      switch (w.type) {
        case "conversation":
          this.conversations.set(w.record.id, clone(w.record));
          if (!this.order.has(w.record.id)) this.order.set(w.record.id, []);
          break;
        case "entry": {
          const record = { ...clone(w.record), seq };
          this.entries.set(record.id, record);
          w.record.seq = seq;
          const list = this.order.get(record.conversationId) ?? [];
          list.push(record.id);
          this.order.set(record.conversationId, list);
          break;
        }
        case "task":
          this.tasks.set(w.record.id, clone(w.record));
          break;
        case "submission":
          this.submissions.set(w.record.id, clone(w.record));
          break;
        case "doc": {
          const key = docKey(w.kind, w.scope);
          const doc = this.docs.get(key) ?? { kind: w.kind, scope: w.scope, value: undefined, history: [] };
          doc.value = clone(w.value);
          doc.history.push({ seq, value: clone(w.value) });
          this.docs.set(key, doc);
          break;
        }
        case "owner":
          this.owner = w.owner;
          break;
      }
    }
    const record: CommitRecord = { seq, at: this.clock.now(), by, name, writes: clone(writes) };
    this.log.push(record);
    for (const fn of this.#listeners) fn(record);
    return record;
  }

  doc<T>(def: DocDefinition<T>, scope: string): T {
    const d = this.docs.get(docKey(def.kind, scope));
    return d ? clone(d.value as T) : def.initial();
  }

  /** The value as of a commit (for `asOf` forks): the last value committed at or before `seq`. */
  docAsOf<T>(def: DocDefinition<T>, scope: string, seq: number): T {
    const d = this.docs.get(docKey(def.kind, scope));
    const at = d?.history.findLast((h) => h.seq <= seq);
    return at ? clone(at.value as T) : def.initial();
  }

  /** The visible transcript: the parent's through the fork entry (by reference), then our own. */
  transcript(conversationId: string): EntryRecord[] {
    const c = this.conversations.get(conversationId);
    if (!c) return [];
    const own = (this.order.get(conversationId) ?? []).map((id) => this.entries.get(id)!);
    if (!c.parent) return own;
    const parent = this.transcript(c.parent.conversationId);
    const cut = parent.findIndex((e) => e.id === c.parent!.at);
    return [...parent.slice(0, cut + 1), ...own];
  }

  /** Pending submissions, live tasks, and the active transcripts: what a SQLite harness keeps in memory. */
  workingSet(): { entries: number; tasks: number; submissions: number } {
    let entries = 0;
    for (const id of this.conversations.keys()) entries += activeContext(this.transcript(id)).entries.length;
    return {
      entries,
      tasks: [...this.tasks.values()].filter((t) => t.state.status !== "terminal").length,
      submissions: [...this.submissions.values()].filter((s) => s.status === "queued" || s.status === "placed").length,
    };
  }
}

export const docKey = (kind: string, scope: string) => `${kind}@${scope}`;

/**
 * What the model sees: entries from the newest head marker on. A `pi.compaction` marker brings
 * its summary and keeps the entries from `firstKept`; a `pi.reset` starts over (with its handoff
 * note). Older entries stay in storage. Aborted partial answers are never sent to the model.
 */
export function activeContext(transcript: EntryRecord[]): {
  summary?: string;
  handoff?: string;
  entries: EntryRecord[];
  headIndex: number;
} {
  let marker = -1;
  for (let i = transcript.length - 1; i >= 0; i--) {
    const k = transcript[i]!.data.kind;
    if (k === "pi.compaction" || k === "pi.reset") {
      marker = i;
      break;
    }
  }
  if (marker < 0) return { entries: transcript.filter(visibleToModel), headIndex: 0 };
  const m = transcript[marker]!.data;
  if (m.kind === "pi.reset") {
    return {
      ...(m.handoff ? { handoff: m.handoff } : {}),
      entries: transcript.slice(marker + 1).filter(visibleToModel),
      headIndex: marker,
    };
  }
  const data = m as Extract<EntryData, { kind: "pi.compaction" }>;
  const kept = transcript.findIndex((e) => e.id === data.firstKept);
  const from = kept >= 0 ? kept : marker + 1;
  const entries = transcript.filter((e, i) => i >= from && i !== marker && e.data.kind !== "pi.compaction" && e.data.kind !== "pi.reset");
  return { summary: data.summary, entries: entries.filter(visibleToModel), headIndex: from };
}

const visibleToModel = (e: EntryRecord) => !(e.data.kind === "pi.assistant" && e.data.stopReason === "aborted");

export const tokensOf = (text: string) => Math.max(1, Math.ceil(text.length / 4));

export function entryText(d: EntryData): string {
  switch (d.kind) {
    case "pi.user":
      return d.text;
    case "pi.assistant":
      return d.text + d.toolCalls.map((c) => ` ${c.name}(${JSON.stringify(c.args)})`).join("");
    case "pi.system":
      return Object.values(d.sections).join("\n");
    case "pi.tool-result":
      return d.text;
    case "pi.compaction":
      return d.summary;
    case "pi.reset":
      return d.handoff ?? "";
  }
}

// ── one commit ──────────────────────────────────────────────────────────────

export class Tx {
  readonly #writes = new Map<string, Write>();
  readonly #entries: EntryRecord[] = [];
  readonly #docs = new Map<string, { kind: string; scope: string; value: unknown; json: string }>();

  constructor(
    readonly storage: Storage,
    readonly by: string,
    readonly name: string,
  ) {}

  get now(): number {
    return this.storage.clock.now();
  }

  conversation(id: string): ConversationRecord | undefined {
    const w = this.#writes.get(`conversation:${id}`);
    return w ? (w as { record: ConversationRecord }).record : clone(this.storage.conversations.get(id));
  }
  task(id: string): TaskRecord | undefined {
    const w = this.#writes.get(`task:${id}`);
    return w ? (w as { record: TaskRecord }).record : clone(this.storage.tasks.get(id));
  }
  submission(id: string): SubmissionRecord | undefined {
    const w = this.#writes.get(`submission:${id}`);
    return w ? (w as { record: SubmissionRecord }).record : clone(this.storage.submissions.get(id));
  }
  entry(id: string): EntryRecord | undefined {
    return this.#entries.find((e) => e.id === id) ?? clone(this.storage.entries.get(id));
  }
  tasks(): TaskRecord[] {
    const ids = new Set([...this.storage.tasks.keys()]);
    for (const k of this.#writes.keys()) if (k.startsWith("task:")) ids.add(k.slice(5));
    return [...ids].map((id) => this.task(id)!);
  }
  conversations(): ConversationRecord[] {
    const ids = new Set([...this.storage.conversations.keys()]);
    for (const k of this.#writes.keys()) if (k.startsWith("conversation:")) ids.add(k.slice(13));
    return [...ids].map((id) => this.conversation(id)!);
  }
  submissions(conversationId: string): SubmissionRecord[] {
    const ids = new Set([...this.storage.submissions.keys()]);
    for (const k of this.#writes.keys()) if (k.startsWith("submission:")) ids.add(k.slice(11));
    return [...ids].map((id) => this.submission(id)!).filter((s) => s.conversationId === conversationId);
  }
  /** The transcript including entries appended in this commit. */
  transcript(conversationId: string): EntryRecord[] {
    return [...this.storage.transcript(conversationId), ...this.#entries.filter((e) => e.conversationId === conversationId)];
  }

  putConversation(record: ConversationRecord): void {
    this.#writes.set(`conversation:${record.id}`, { type: "conversation", record });
  }
  putTask(record: TaskRecord): void {
    this.#writes.set(`task:${record.id}`, { type: "task", record });
  }
  putSubmission(record: SubmissionRecord): void {
    this.#writes.set(`submission:${record.id}`, { type: "submission", record });
  }
  append(conversationId: string, data: EntryData, byTaskId?: string): EntryRecord {
    const record: EntryRecord = {
      id: this.storage.mint("e"),
      conversationId,
      seq: 0,
      at: this.now,
      tokens: tokensOf(entryText(data)),
      data,
      ...(byTaskId ? { byTaskId } : {}),
    };
    this.#entries.push(record);
    return record;
  }

  /** A document to read or edit in place: changes are written with the commit. */
  doc<T>(def: DocDefinition<T>, scope: string): T {
    const key = docKey(def.kind, scope);
    let d = this.#docs.get(key);
    if (!d) {
      const value = this.storage.doc(def, scope);
      d = { kind: def.kind, scope, value, json: this.storage.docs.has(key) ? JSON.stringify(value) : "" };
      this.#docs.set(key, d);
    }
    return d.value as T;
  }
  setDoc<T>(def: DocDefinition<T>, scope: string, value: T): void {
    this.doc(def, scope);
    this.#docs.get(docKey(def.kind, scope))!.value = value;
  }

  mint(prefix: "c" | "e" | "t" | "s"): string {
    return this.storage.mint(prefix);
  }

  /** Store everything, atomically. Returns null when nothing changed. */
  commit(): CommitRecord | null {
    const writes: Write[] = [];
    for (const w of this.#writes.values()) if (w.type === "conversation") writes.push(w);
    for (const e of this.#entries) writes.push({ type: "entry", record: e });
    for (const w of this.#writes.values()) if (w.type !== "conversation") writes.push(w);
    for (const d of this.#docs.values()) {
      const json = JSON.stringify(d.value);
      if (json !== d.json) writes.push({ type: "doc", kind: d.kind, scope: d.scope, value: d.value });
    }
    if (!writes.length) return null;
    return this.storage.commit(this.by, this.name, writes);
  }
}

/** Create a conversation's documents in the same commit that creates it (Pi's creation hook). */
export function createDocs(tx: Tx, conversationId: string, from?: { conversationId: string; seq: number }): void {
  for (const def of DOCS) {
    let value: unknown = def.initial();
    if (from && def.fork === "asOf") value = tx.storage.docAsOf(def, from.conversationId, from.seq);
    else if (from && def.fork === "current") value = tx.storage.doc(def, from.conversationId);
    tx.setDoc(def, conversationId, value);
  }
}

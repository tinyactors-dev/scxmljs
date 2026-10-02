/**
 * Conversations, as transactions: admission (`submit`), runs, the inbox and its two boundaries,
 * abort, and forks. Each function takes the `Tx` of the commit it belongs to, so a submission,
 * the user entry it places and the generation it starts are stored together or not at all.
 *
 * Mirrors packages/durable/src/harness/{submissions,inbox,scheduler}.ts.
 */
import type { Registry } from "./registry.ts";
import { createDocs, type Tx } from "./storage.ts";
import {
  AgentDoc,
  type AgentState,
  type ConversationOwnership,
  type EntryData,
  InboxDocDef,
  isLive,
  LiveDocDef,
  type SubmissionRecord,
  type TaskRecord,
  type UnansweredReason,
  type WhenBusy,
} from "./types.ts";

/** `whenBusy: "reject"` on a busy conversation: nothing is written. */
export class ConversationBusy extends Error {
  constructor() {
    super("ConversationBusy: the conversation is running and the submission asked to be rejected");
  }
}

export interface Draft {
  type?: "input" | "write";
  text?: string;
  author?: string;
  requestId?: string;
  whenBusy?: WhenBusy;
  write?: EntryData;
}

export function createTask(
  tx: Tx,
  reg: Registry,
  o: { conversationId: string; kind: string; input?: Record<string, unknown>; owner?: string; background?: boolean; label: string },
): string {
  const def = reg.task(o.kind);
  if (!def) throw new Error(`no task definition ${o.kind}`);
  if (o.background && o.owner) throw new Error("only conversation-owned tasks may be background");
  const id = tx.mint("t");
  const input = o.input ?? {};
  tx.putTask({
    id,
    conversationId: o.conversationId,
    kind: o.kind,
    version: def.version,
    input,
    ...(o.owner ? { owner: o.owner } : {}),
    background: !!o.background,
    abortRequested: false,
    state: { status: "pending", checkpoint: def.initial(input) },
    label: o.label,
    createdAt: tx.now,
  });
  return id;
}

export function createConversation(
  tx: Tx,
  o: { title: string; ownership: ConversationOwnership; agent?: AgentState; fork?: { conversationId: string; at: string } },
): string {
  const id = tx.mint("c");
  const owner = o.ownership.kind === "task" ? tx.task(o.ownership.taskId) : undefined;
  tx.putConversation({
    id,
    title: o.title,
    ...(o.fork ? { parent: o.fork } : {}),
    ...(owner ? { owner: { conversationId: owner.conversationId, taskId: owner.id } } : {}),
    createdAt: tx.now,
  });
  // a fork's documents follow their fork policy, as of the fork entry's commit
  const at = o.fork ? tx.entry(o.fork.at) : undefined;
  createDocs(tx, id, o.fork && at ? { conversationId: o.fork.conversationId, seq: at.seq } : undefined);
  // a subagent starts as a copy of its owner's agent
  if (owner) tx.setDoc(AgentDoc, id, structuredClone(tx.doc(AgentDoc, owner.conversationId)));
  if (o.agent) configure(tx, id, o.agent);
  return id;
}

/** Given fields replace; `null` clears. Starts nothing: the next request sees the change. */
export function configure(tx: Tx, conversationId: string, change: { [K in keyof AgentState]?: AgentState[K] | null }): void {
  const agent = tx.doc(AgentDoc, conversationId) as Record<string, unknown>;
  for (const [k, v] of Object.entries(change)) {
    if (v === null) delete agent[k];
    else if (v !== undefined) agent[k] = v;
  }
}

export const isBusy = (tx: Tx, conversationId: string) => !!tx.doc(LiveDocDef, conversationId).run;

/** Admission. A known requestId returns the original submission and writes nothing. */
export function submit(tx: Tx, reg: Registry, conversationId: string, d: Draft): { id: string; duplicate: boolean } {
  if (d.requestId) {
    const existing = tx.submissions(conversationId).find((s) => s.requestId === d.requestId);
    if (existing) return { id: existing.id, duplicate: true };
  }
  const type = d.type ?? "input";
  const busy = isBusy(tx, conversationId);
  if (busy && type === "input" && d.whenBusy === "reject") throw new ConversationBusy();
  const inbox = tx.doc(InboxDocDef, conversationId);
  const record: SubmissionRecord = {
    id: tx.mint("s"),
    conversationId,
    type,
    status: "queued",
    at: tx.now,
    ...(d.requestId ? { requestId: d.requestId } : {}),
    ...(type === "input" ? { whenBusy: d.whenBusy ?? "followUp", author: d.author ?? "You", text: d.text ?? "" } : {}),
    ...(d.write ? { write: d.write } : {}),
  };
  if (busy || inbox.items.length) {
    tx.putSubmission(record);
    inbox.items.push({
      id: record.id,
      mode: type === "write" ? "write" : record.whenBusy === "steer" ? "steer" : "followUp",
      ...(record.author ? { author: record.author } : {}),
      ...(record.text !== undefined ? { text: record.text } : d.write?.kind === "pi.compaction" ? { text: "compaction summary" } : {}),
    });
    // idle with a non-empty inbox (after a failed or stopped run): the final boundary runs now
    if (!busy) boundary(tx, reg, conversationId, "final");
    return { id: record.id, duplicate: false };
  }
  if (type === "write") placeWrite(tx, record);
  else {
    placeInput(tx, record);
    startRun(tx, reg, conversationId, [record.id]);
  }
  return { id: record.id, duplicate: false };
}

function placeInput(tx: Tx, s: SubmissionRecord): void {
  const e = tx.append(s.conversationId, { kind: "pi.user", author: s.author ?? "You", text: s.text ?? "", submissionId: s.id });
  tx.putSubmission({ ...s, status: "placed", entry: e.id });
}

function placeWrite(tx: Tx, s: SubmissionRecord): void {
  const e = tx.append(s.conversationId, s.write!);
  tx.putSubmission({ ...s, status: "done", entry: e.id });
}

/** A run: `pi.live.run` is set (the conversation is busy) and its first generation is created. */
export function startRun(tx: Tx, reg: Registry, conversationId: string, inputs: string[]): string {
  const gen = createTask(tx, reg, { conversationId, kind: "pi.generation", label: "model request" });
  const live = tx.doc(LiveDocDef, conversationId);
  live.run = { taskId: gen, inputs };
  live.generation = { taskId: gen, attempt: 1 };
  live.tools = [];
  return gen;
}

/**
 * The inbox's two boundaries. `postTools` (after a tool round): writes, then the first steer,
 * which joins the running run. `final` (the run answered): writes, then the first steer and
 * the first follow-up, which start the next run. Queue mode is Pi's default, one-at-a-time.
 */
export function boundary(
  tx: Tx,
  reg: Registry,
  conversationId: string,
  kind: "postTools" | "final",
): { placed: string[]; started?: string } {
  const inbox = tx.doc(InboxDocDef, conversationId);
  const take: string[] = [];
  for (const item of inbox.items) if (item.mode === "write") take.push(item.id);
  const firstSteer = inbox.items.find((i) => i.mode === "steer");
  if (firstSteer) take.push(firstSteer.id);
  if (kind === "final") {
    const firstFollowUp = inbox.items.find((i) => i.mode === "followUp");
    if (firstFollowUp) take.push(firstFollowUp.id);
  }
  inbox.items = inbox.items.filter((i) => !take.includes(i.id));
  const users: string[] = [];
  for (const id of take.sort(byId)) {
    const s = tx.submission(id)!;
    if (s.type === "write") placeWrite(tx, s);
    else {
      placeInput(tx, s);
      users.push(id);
    }
  }
  if (!users.length) return { placed: [] };
  const live = tx.doc(LiveDocDef, conversationId);
  if (kind === "postTools" && live.run) {
    live.run.inputs.push(...users);
    return { placed: users };
  }
  return { placed: users, started: startRun(tx, reg, conversationId, users) };
}

const byId = (a: string, b: string) => Number(a.slice(1)) - Number(b.slice(1));

/** The run ends: its inputs are answered (or not), `pi.live.run` goes away. */
export function endRun(tx: Tx, conversationId: string, outcome: { answer: string } | { reason: UnansweredReason }): void {
  const live = tx.doc(LiveDocDef, conversationId);
  for (const id of live.run?.inputs ?? []) {
    const s = tx.submission(id);
    if (!s || s.status === "done" || s.status === "unanswered") continue;
    tx.putSubmission(
      "answer" in outcome ? { ...s, status: "done", answer: outcome.answer } : { ...s, status: "unanswered", reason: outcome.reason },
    );
  }
  delete live.run;
  delete live.generation;
  live.tools = [];
}

/** Withdraw queued inputs (writes stay), then mark the conversation's current work. */
export function abortConversation(tx: Tx, conversationId: string, opts: { background?: boolean } = {}): string[] {
  const inbox = tx.doc(InboxDocDef, conversationId);
  for (const item of inbox.items) {
    if (item.mode === "write") continue;
    const s = tx.submission(item.id)!;
    tx.putSubmission({ ...s, status: "unanswered", reason: "aborted" });
  }
  inbox.items = inbox.items.filter((i) => i.mode === "write");
  const marked: string[] = [];
  for (const t of tx.tasks()) {
    if (t.conversationId !== conversationId || t.owner || !isLive(t) || t.abortRequested) continue;
    if (t.background && !opts.background) continue;
    if (t.state.status === "completing") continue;
    tx.putTask({ ...t, abortRequested: true });
    marked.push(t.id);
  }
  return marked;
}

/**
 * The ordinary work under a task: tasks it owns, and the work of conversations it owns.
 * A background task is a boundary; a terminal one has no work left to wait for.
 */
export function ownedWork(tasks: TaskRecord[], conversations: { id: string; owner?: { taskId: string } }[], taskId: string): TaskRecord[] {
  const out: TaskRecord[] = [];
  for (const t of tasks) if (t.owner === taskId && isLive(t)) out.push(t, ...ownedWork(tasks, conversations, t.id));
  for (const c of conversations) if (c.owner?.taskId === taskId) out.push(...conversationWork(tasks, conversations, c.id));
  return out;
}

/** A conversation's current work: its live, non-background top-level tasks and everything under them. */
export function conversationWork(
  tasks: TaskRecord[],
  conversations: { id: string; owner?: { taskId: string } }[],
  conversationId: string,
): TaskRecord[] {
  const out: TaskRecord[] = [];
  for (const t of tasks)
    if (t.conversationId === conversationId && !t.owner && !t.background && isLive(t))
      out.push(t, ...ownedWork(tasks, conversations, t.id));
  return out;
}

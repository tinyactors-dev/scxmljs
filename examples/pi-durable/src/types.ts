/**
 * The records a Pi Durable harness stores, modelled on `@earendil-works/pi-durable`
 * (packages/durable/src/types.ts). Names and literals are Pi's, so a reader of the post
 * recognises them; the shapes are trimmed to what the demo shows.
 */

// ── tasks ───────────────────────────────────────────────────────────────────

/** `TaskState.status`. Live = everything but `terminal`. */
export type TaskStatus = "pending" | "running" | "waiting" | "completing" | "terminal";
/** `TaskOutcome.status`. `orphaned` and `faulted` are written by the scheduler, never by task code. */
export type OutcomeStatus = "completed" | "failed" | "aborted" | "orphaned" | "faulted";
export type JoinPolicy = "failFast" | "allSettled";

export interface Outcome {
  status: OutcomeStatus;
  result?: unknown;
  error?: { message: string };
  reason?: string;
}

/** A task's whole durable state between phases: a union on `phase`. */
export interface Checkpoint {
  phase: string;
  [key: string]: unknown;
}

export type TaskState =
  | { status: "pending" | "running"; checkpoint: Checkpoint }
  | { status: "waiting"; checkpoint: Checkpoint; on: string[]; policy: JoinPolicy }
  | { status: "completing" | "terminal"; outcome: Outcome };

export interface TaskRecord {
  id: string;
  conversationId: string;
  /** The task definition's name: `pi.generation`, `pi.tool`, `pi.compaction`, `shop.checkout`, … */
  kind: string;
  version: number;
  input: Record<string, unknown>;
  /** The owning task; absent = owned by its conversation. */
  owner?: string;
  /** Only conversation-owned tasks may be background: not part of the conversation's current work. */
  background: boolean;
  /** The durable abort mark. */
  abortRequested: boolean;
  state: TaskState;
  /** Small values stored with the task; the first write wins. Dropped when the task ends. */
  memos?: Record<string, unknown>;
  /** For the page: a short label ("bash", "payment visa-4242"). */
  label: string;
  createdAt: number;
}

// ── conversations ───────────────────────────────────────────────────────────

/** `ConversationOwnership`: conversations are ownerless, or owned by a task (a subagent). */
export type ConversationOwnership = { kind: "ownerless" } | { kind: "task"; taskId: string };
/** `TaskOwnership`: tasks are owned by their conversation (top level), or by another task. */
export type TaskOwnership = { kind: "conversation" } | { kind: "task"; taskId: string };

export interface ConversationRecord {
  id: string;
  title: string;
  /** History ancestry: a fork sees the parent's transcript through `at`, by reference. */
  parent?: { conversationId: string; at: string };
  /** Task ownership: aborting the task aborts the conversation's work. */
  owner?: { conversationId: string; taskId: string };
  createdAt: number;
}

// ── entries (the transcript) ────────────────────────────────────────────────

export type EntryKind = "pi.user" | "pi.assistant" | "pi.system" | "pi.tool-result" | "pi.compaction" | "pi.reset";

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type EntryData =
  | { kind: "pi.user"; author: string; text: string; submissionId: string }
  | { kind: "pi.assistant"; text: string; toolCalls: ToolCall[]; stopReason: "stop" | "toolUse" | "aborted"; model: string }
  | { kind: "pi.system"; sections: Record<string, string | null>; toolsAdded: string[]; toolsRemoved: string[] }
  | { kind: "pi.tool-result"; callId: string; name: string; text: string; isError: boolean; code?: ToolErrorCode }
  | { kind: "pi.compaction"; firstKept: string; summary: string; reason: CompactionReason }
  | { kind: "pi.reset"; handoff?: string };

export interface EntryRecord {
  id: string;
  conversationId: string;
  /** The commit that stored it (forks and `asOf` documents read history by commit). */
  seq: number;
  byTaskId?: string;
  at: number;
  tokens: number;
  data: EntryData;
}

export type ToolErrorCode = "tool_unavailable" | "invalid_arguments" | "blocked" | "interrupted" | "aborted" | "tool_error";
export type CompactionReason = "manual" | "threshold" | "overflow";

// ── submissions ─────────────────────────────────────────────────────────────

export type WhenBusy = "steer" | "followUp" | "reject";
export type UnansweredReason = "aborted" | "stale" | "reset" | "no_model" | "model_error" | "faulted";

export interface SubmissionRecord {
  id: string;
  conversationId: string;
  /** Makes a submission exactly-once: the same requestId returns the original submission. */
  requestId?: string;
  type: "input" | "write";
  status: "queued" | "placed" | "done" | "unanswered";
  whenBusy?: WhenBusy;
  author?: string;
  text?: string;
  /** For a write: the entry to place (a compaction summary). */
  write?: EntryData;
  /** The placed entry (the user message, or the written entry). */
  entry?: string;
  /** The answer: an entry id. */
  answer?: string;
  reason?: UnansweredReason;
  at: number;
}

// ── documents ───────────────────────────────────────────────────────────────

/** `pi.agent`: names, never code. */
export interface AgentState {
  model?: string;
  extensions?: string[];
  /** Exactly these tools (`[]` = none), or the selection minus some. */
  tools?: string[] | { remove: string[] };
  instructions?: string;
  cwd?: string;
}

export interface ToolSlot {
  callId: string;
  name: string;
  taskId: string;
  status: "pending" | "running" | "done";
  /** Streamed with `api.output()`: durable, so an interrupted call reports what it printed. */
  output?: string;
  details?: Record<string, unknown>;
}

/** `pi.live`: busy exactly while `run` is set. */
export interface LiveDoc {
  run?: { taskId: string; inputs: string[] };
  generation?: { taskId: string; attempt: number; message?: string; retry?: { at: number; error: string } };
  tools?: ToolSlot[];
  compactions?: { taskId: string; reason: CompactionReason; blocking: boolean }[];
}

export interface InboxItem {
  id: string;
  mode: "steer" | "followUp" | "write";
  author?: string;
  text?: string;
}
export interface InboxDoc {
  items: InboxItem[];
}
export interface UsageDoc {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
}
export interface TodosDoc {
  items: string[];
}

/** What a fork starts with: the parent's value at the fork entry, its current value, or nothing ("initial"). */
export type ForkPolicy = "asOf" | "current" | "initial";

export interface DocDefinition<T> {
  kind: string;
  fork: ForkPolicy;
  initial(): T;
}

export const AgentDoc: DocDefinition<AgentState> = { kind: "pi.agent", fork: "asOf", initial: () => ({}) };
export const LiveDocDef: DocDefinition<LiveDoc> = { kind: "pi.live", fork: "initial", initial: () => ({}) };
export const InboxDocDef: DocDefinition<InboxDoc> = { kind: "pi.inbox", fork: "initial", initial: () => ({ items: [] }) };
export const UsageDocDef: DocDefinition<UsageDoc> = {
  kind: "pi.usage",
  fork: "initial",
  initial: () => ({ requests: 0, inputTokens: 0, outputTokens: 0, toolCalls: 0 }),
};
/** The post's `defineDoc` example: `scope: "conversation"`, `history: "rewindable"`, `fork: "asOf"`. */
export const Todos: DocDefinition<TodosDoc> = { kind: "app.todos", fork: "asOf", initial: () => ({ items: [] }) };

export const DOCS: DocDefinition<unknown>[] = [AgentDoc, LiveDocDef, InboxDocDef, UsageDocDef, Todos] as DocDefinition<unknown>[];

// ── the commit log ──────────────────────────────────────────────────────────

export type Write =
  | { type: "conversation"; record: ConversationRecord }
  | { type: "entry"; record: EntryRecord }
  | { type: "task"; record: TaskRecord }
  | { type: "submission"; record: SubmissionRecord }
  | { type: "doc"; kind: string; scope: string; value: unknown }
  | { type: "owner"; owner: string | null };

export interface CommitRecord {
  seq: number;
  at: number;
  /** Who committed: a task id, "harness", or a client. */
  by: string;
  /** What the commit did, in Pi's words ("tool.intent", "generation.toolRound", "submit", …). */
  name: string;
  writes: Write[];
}

export const ROOT_CONVERSATION_ID = "c1";
export const isLive = (t: TaskRecord) => t.state.status !== "terminal";

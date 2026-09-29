/**
 * The llm-chat protocols as types. PROTOCOL.md describes them; keep the two in step.
 */
import type {
  BetaMessage,
  BetaMessageParam,
  BetaRawMessageStreamEvent,
  BetaStopReason,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Clock } from "@tinyactors/scxmljs";

export type { BetaMessage, BetaMessageParam, BetaRawMessageStreamEvent, BetaStopReason };

/** Processor type URIs (the `_event.origintype` of inbound events). */
export const BUS = "urn:llm-chat:bus";
export const LOG = "urn:llm-chat:log";
export const TOOL = "urn:llm-chat:tool";
export const STAGE = "urn:llm-chat:stage";
export const PANEL = "urn:llm-chat:panel";
export const WORKSPACE_LINK = "urn:llm-chat:workspace";

export type ClientId = string;
/** Everyone observes; these are the extra permissions. */
export type Role = "input" | "control" | "tools";
/** Bus addresses: the host, a client, or every client. */
export type Address = "host" | "*" | ClientId;

// a type alias, not an interface: the SDK's input_schema has an index signature
export type JSONSchema = {
  type: "object";
  properties?: Record<string, { type?: string; description?: string; items?: unknown }>;
  required?: string[];
  additionalProperties?: boolean;
};

export interface ToolDef {
  name: string;
  description: string;
  input_schema: JSONSchema;
}

/** A tool as offered to the model for one turn, with the client that runs it. */
export interface FrozenTool extends ToolDef {
  provider: ClientId;
}

/** Held or appended user input. */
export interface Input {
  inputId: string;
  author: string;
  text: string;
}

export interface RosterEntry {
  id: ClientId;
  name: string;
  kind: string;
  roles: Role[];
  tools: string[];
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  /** Why the input failed the tool's schema; such calls are answered with an error, never run. */
  invalid?: string;
}

export interface ToolResult {
  callId: string;
  isError: boolean;
  content: string;
}

// ── bus messages ───────────────────────────────────────────────────────────

export interface Hello {
  name: string;
  kind: string;
  wants: Role[];
  tools: ToolDef[];
}
export interface Welcome {
  clientId: ClientId;
  granted: Role[];
  tools: string[];
  refused: string[];
  /** Whether a turn is running (host.busy / host.idle follow). */
  busy: boolean;
}

/** Why the host refused an input. `busy`: a turn is running; the client queues the message again. */
export type RejectCode = "busy" | "role" | "model" | "nothing" | "disconnected" | "other";

/** A message waiting in a client's own queue. */
export interface Queued {
  id: string;
  text: string;
}
export interface LogBatch {
  first: number;
  last: number;
  entries: LogEntry[];
}
/** Everything so far: a client rebuilds its view by replaying the entries. */
export interface Snapshot {
  seq: number;
  entries: LogEntry[];
}

/** Every message on the bus, by name. */
export interface BusMessages {
  // client → host
  "client.hello": Hello;
  "client.resync": { fromSeq: number };
  "client.bye": Record<string, never>;
  "input.submit": { inputId: string; text: string };
  "input.steer": { inputId: string; text: string };
  "input.interrupt": Record<string, never>;
  "tool.result": ToolResult;
  // control panel → host
  "roles.set": { clientId: ClientId; roles: Role[] };
  "mode.claude": Record<string, never>;
  "mode.simulated": Record<string, never>;
  "key.set": Record<string, never>;
  "key.forget": Record<string, never>;
  // host → client
  welcome: Welcome;
  snapshot: Snapshot;
  "log.batch": LogBatch;
  "roles.changed": { granted: Role[] };
  "input.accepted": { inputId: string; queued: boolean; steer?: boolean };
  "input.rejected": { inputId?: string; code: RejectCode; reason: string };
  "host.busy": Record<string, never>;
  "host.idle": { stoppedBy: ClientId | null };
  "tool.call": { callId: string; name: string; input: unknown };
  "tool.cancel": { callId: string };
  // panel → its client (origin "ui")
  "ui.submit": { text: string };
  "ui.queue.remove": { id: string };
  "ui.queue.edit": { id: string };
  "ui.steer": { text: string };
  "ui.interrupt": Record<string, never>;
  "ui.leave": Record<string, never>;
  "ui.offline": Record<string, never>;
  "ui.online": Record<string, never>;
}

// ── the log ────────────────────────────────────────────────────────────────

export type LogEntryBody =
  | { kind: "user"; turn: number; entries: Input[] }
  | { kind: "assistant.start"; request: number; model: string }
  | { kind: "block.start"; request: number; index: number; block: string; name?: string; id?: string }
  | { kind: "block.delta"; request: number; index: number; text?: string; json?: string }
  | { kind: "block.stop"; request: number; index: number }
  | { kind: "usage"; request: number; input: number; output: number; cacheRead: number }
  | { kind: "assistant.commit"; request: number; stop: string }
  | { kind: "assistant.discard"; request: number; reason: string }
  | { kind: "tools"; request: number; calls: { id: string; name: string; provider: ClientId | null }[] }
  /** the host (re)armed its tool timeout: the calls must be answered by `at + ms` (clock time) */
  | { kind: "timer"; request: number; ms: number }
  | { kind: "tool.results"; request: number; results: ToolResult[]; steers: Input[] }
  | { kind: "steers"; steers: Input[] }
  | { kind: "roster"; clients: RosterEntry[] }
  | { kind: "notice"; level: "info" | "warning" | "error"; text: string }
  | { kind: "state"; configuration: string[] };

export type LogEntry = LogEntryBody & { seq: number; at: number };

// ── the llm invoker ────────────────────────────────────────────────────────

export type LlmErrorKind = "rate_limit" | "overloaded" | "server" | "network" | "auth" | "invalid" | "stream" | "refusal" | "truncated";

export interface LlmError {
  kind: LlmErrorKind;
  status?: number;
  retryable: boolean;
  retryAfterMs?: number;
  message: string;
}

/** The data of `done.invoke.llm`. */
export type LlmDone = { ok: true; stop: BetaStopReason; toolCalls: ToolCall[] } | { ok: false; error: LlmError };

/** Thrown by model sources; the invoker turns it into `{ ok: false, error }`. */
export class ModelError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string,
    readonly details: { status?: number; retryAfterMs?: number } = {},
  ) {
    super(message);
  }
  get retryable(): boolean {
    return ["rate_limit", "overloaded", "server", "network", "stream"].includes(this.kind);
  }
}

export interface ModelRequest {
  system: string;
  messages: BetaMessageParam[];
  tools: ToolDef[];
}

/** The Messages API's streaming events, then the whole message. */
export interface ModelStream extends AsyncIterable<BetaRawMessageStreamEvent> {
  finalMessage(): Promise<BetaMessage>;
}

/** Where answers come from: the simulation, or Claude. */
export interface ModelSource {
  readonly name: string;
  stream(request: ModelRequest, signal: AbortSignal): ModelStream;
}

// ── tools ──────────────────────────────────────────────────────────────────

export interface ToolContext {
  signal: AbortSignal;
  clock: Clock;
}

/** One tool's behaviour: returns the result text, or throws for an error result. */
export type ToolImpl = (input: Record<string, unknown>, ctx: ToolContext) => Promise<string>;

/** Per-tool knobs, set from the panel or a scenario (`sim.tool`). */
export interface ToolKnobs {
  latencyMs: number;
  failNext: boolean;
  hang: boolean;
}

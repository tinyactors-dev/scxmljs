/**
 * The host's invokers: `llm` (one Messages API request, streamed into the log) and
 * `key-check`. See PROTOCOL.md §3 and §4.
 *
 * Leaving the invoking state calls `cancel()`, which aborts the request: that is how stop
 * and steering-by-interrupt work, with no special code.
 */
import type { InvokeContext, InvokedService, Invoker } from "@tinyactors/scxmljs";
import type { ChatLog } from "./log.ts";
import {
  type BetaMessage,
  type FrozenTool,
  type JSONSchema,
  type LlmDone,
  type LlmError,
  ModelError,
  type ModelSource,
  type ToolCall,
  type ToolDef,
} from "./protocol.ts";

export interface LlmInvokerOptions {
  log: ChatLog;
  models: Record<string, ModelSource>;
  system: string;
}

export function llmInvoker({ log, models, system }: LlmInvokerOptions): Invoker {
  return (ctx: InvokeContext): InvokedService => {
    const abort = new AbortController();
    const request = Number(ctx.params.request);
    const tools = (ctx.params.tools ?? []) as FrozenTool[];
    const model = models[String(ctx.params.model)];

    const run = async (): Promise<LlmDone> => {
      if (!model) return { ok: false, error: { kind: "invalid", retryable: false, message: `no model ${ctx.params.model}` } };
      const draft = log.draft(request, model.name);
      const stream = model.stream({ system, messages: log.history(), tools: tools.map(({ provider: _, ...def }) => def) }, abort.signal);
      for await (const event of stream) {
        if (abort.signal.aborted) break;
        draft.apply(event);
        if (event.type === "content_block_start") {
          const b = event.content_block;
          if (b.type === "text" || b.type === "thinking" || b.type === "tool_use")
            ctx.sendToParent("llm.block.start", { index: event.index, kind: b.type, name: "name" in b ? b.name : undefined });
        } else if (event.type === "content_block_stop") {
          ctx.sendToParent("llm.block.stop", { index: event.index, kind: draft.kindOf(event.index) });
        }
      }
      const message = await stream.finalMessage();
      draft.finish(message);
      return outcome(message, tools);
    };

    run().then(
      (done) => {
        if (!abort.signal.aborted) ctx.done(done);
      },
      (err: unknown) => {
        if (!abort.signal.aborted) ctx.done({ ok: false, error: toLlmError(err) } satisfies LlmDone);
      },
    );

    return {
      send() {},
      cancel: () => abort.abort(),
    };
  };
}

/** The finished message → what the chart decides on. */
function outcome(message: BetaMessage, tools: ToolDef[]): LlmDone {
  const uses = message.content.flatMap((b) => (b.type === "tool_use" ? [b] : []));
  const stop = message.stop_reason ?? "end_turn";
  // a refusal can cut a tool_use off mid-input; the partial message is not kept
  if (stop === "refusal") return { ok: false, error: { kind: "refusal", retryable: false, message: "The model declined to continue." } };
  // a truncated tool input can still look valid; never run it
  if (stop === "max_tokens" && uses.length)
    return { ok: false, error: { kind: "truncated", retryable: false, message: "A tool call was cut off at the output limit." } };
  const toolCalls: ToolCall[] = uses.map((u) => {
    const def = tools.find((t) => t.name === u.name);
    const invalid = def ? validate(u.input, def.input_schema) : `unknown tool ${u.name}`;
    return { id: u.id, name: u.name, input: u.input, ...(invalid ? { invalid } : {}) };
  });
  return { ok: true, stop, toolCalls };
}

/**
 * Enough of JSON Schema for tool inputs: an object, its required keys, and the types of its
 * top-level properties. With eager input streaming the API doesn't validate for us.
 */
export function validate(input: unknown, schema: JSONSchema): string | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return "the input is not an object";
  const obj = input as Record<string, unknown>;
  for (const key of schema.required ?? []) if (!(key in obj)) return `missing "${key}"`;
  for (const [key, value] of Object.entries(obj)) {
    const prop = schema.properties?.[key];
    if (!prop) {
      if (schema.additionalProperties === false) return `unexpected "${key}"`;
      continue;
    }
    const actual = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
    const expected = prop.type === "integer" ? "number" : prop.type;
    if (expected && actual !== expected) return `"${key}" should be ${prop.type}, not ${actual}`;
  }
  return undefined;
}

function toLlmError(err: unknown): LlmError {
  if (err instanceof ModelError) return { kind: err.kind, retryable: err.retryable, message: err.message, ...err.details };
  return { kind: "stream", retryable: true, message: err instanceof Error ? err.message : String(err) };
}

/** `key-check`: `check` resolves if the key works, rejects with the reason if not. */
export function keyCheckInvoker(check: (signal: AbortSignal) => Promise<void>): Invoker {
  return (ctx) => {
    const abort = new AbortController();
    check(abort.signal).then(
      () => abort.signal.aborted || ctx.done({ ok: true }),
      (err: unknown) => abort.signal.aborted || ctx.done({ ok: false, message: err instanceof Error ? err.message : String(err) }),
    );
    return { send() {}, cancel: () => abort.abort() };
  };
}

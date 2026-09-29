/**
 * Claude, called from the browser with the visitor's own key.
 *
 * The key lives in a `KeyVault` (key-vault.ts): never in a chart's data model, an event, a URL or a
 * log. The SDK sends it only to api.anthropic.com (the page's CSP `connect-src` enforces that).
 * `maxRetries: 0`: retries are the host chart's `backoff` state, so they show in the explorer.
 *
 * Load this module with `import()` only in Claude mode, so the simulation never downloads the SDK.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { KeyVault } from "./key-vault.ts";
import { ModelError, type ModelRequest, type ModelSource, type ModelStream } from "./protocol.ts";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export class ClaudeModel implements ModelSource {
  readonly name = "claude";
  /** Haiku 4.5: fast and cheap ($1 / $5 per million input / output tokens), plenty for a demo chat. */
  model = "claude-haiku-4-5";
  effort: Effort = "medium";

  constructor(readonly vault: KeyVault) {}

  #client(): Anthropic {
    const apiKey = this.vault.get();
    if (!apiKey) throw new ModelError("auth", "No API key: paste one in the control panel.");
    return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0 });
  }

  /** For the `key-check` invoker. */
  async check(signal: AbortSignal): Promise<void> {
    try {
      await this.#client().models.list({ limit: 1 }, { signal });
    } catch (err) {
      throw toModelError(err);
    }
  }

  stream(request: ModelRequest, signal: AbortSignal): ModelStream {
    const stream = this.#client().beta.messages.stream(
      {
        model: this.model,
        // Haiku 4.5 takes no effort level or adaptive thinking (only fixed thinking budgets):
        // a plain request, a short answer cap. The newer models get thinking and refusal fallbacks.
        ...(this.model.startsWith("claude-haiku")
          ? { max_tokens: 8192 }
          : {
              max_tokens: 64000,
              betas: ["server-side-fallback-2026-07-01"],
              fallbacks: "default" as const,
              thinking: { type: "adaptive" as const, display: "summarized" as const },
              output_config: { effort: this.effort },
            }),
        cache_control: { type: "ephemeral" },
        system: request.system,
        messages: request.messages,
        // eager: tool inputs stream as they're written; the llm invoker validates them
        tools: request.tools.map((t) => ({ ...t, eager_input_streaming: true })),
      },
      { signal },
    );
    return {
      async *[Symbol.asyncIterator]() {
        try {
          for await (const event of stream) yield event;
        } catch (err) {
          throw toModelError(err);
        }
      },
      finalMessage: () => stream.finalMessage().catch((err: unknown) => Promise.reject(toModelError(err))),
    };
  }
}

/** The SDK's typed errors → the protocol's error kinds (the chart decides on retries). */
function toModelError(err: unknown): unknown {
  if (err instanceof ModelError || err instanceof Anthropic.APIUserAbortError) return err;
  if (err instanceof Anthropic.APIConnectionError) return new ModelError("network", err.message);
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError)
    return new ModelError("auth", err.message, { status: err.status });
  if (err instanceof Anthropic.RateLimitError) {
    const seconds = Number(err.headers?.get("retry-after"));
    return new ModelError("rate_limit", err.message, {
      status: 429,
      ...(Number.isFinite(seconds) ? { retryAfterMs: seconds * 1000 } : {}),
    });
  }
  if (err instanceof Anthropic.APIError && err.status === 529) return new ModelError("overloaded", err.message, { status: 529 });
  if (err instanceof Anthropic.InternalServerError) return new ModelError("server", err.message, { status: err.status });
  if (err instanceof Anthropic.APIError) return new ModelError("invalid", err.message, { ...(err.status ? { status: err.status } : {}) });
  // not an API error: most likely tool input JSON the SDK couldn't parse (eager streaming)
  return new ModelError("stream", err instanceof Error ? err.message : String(err));
}

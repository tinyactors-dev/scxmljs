/**
 * Claude as a model source that downloads the SDK only when first needed (key check or request).
 */
import type { ClaudeModel } from "./claude-model.ts";
import type { KeyVault } from "./key-vault.ts";
import { ModelError, type ModelRequest, type ModelSource, type ModelStream } from "./protocol.ts";

export class LazyClaude implements ModelSource {
  readonly name = "claude";
  #model: ClaudeModel | null = null;

  constructor(readonly vault: KeyVault) {}

  async load(): Promise<ClaudeModel> {
    if (!this.#model) {
      const { ClaudeModel } = await import("./claude-model.ts");
      this.#model ??= new ClaudeModel(this.vault);
    }
    return this.#model;
  }

  /** The key check runs first (the host's `verifying` state), so the SDK is loaded by now. */
  stream(request: ModelRequest, signal: AbortSignal): ModelStream {
    if (!this.#model) throw new ModelError("auth", "Claude isn't loaded yet: set a key first.");
    return this.#model.stream(request, signal);
  }

  async check(signal: AbortSignal): Promise<void> {
    await (await this.load()).check(signal);
  }
}

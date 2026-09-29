/**
 * Where the visitor's API key lives: memory by default; with `remember`, also this browser's
 * localStorage. Never in a chart's data model, an event, a URL or a log. Kept apart from
 * claude-model.ts so the page can hold a key without downloading the SDK.
 */
export class KeyVault {
  static readonly storageKey = "llm-chat:anthropic-key";
  #key: string | null = null;

  constructor() {
    try {
      this.#key = localStorage.getItem(KeyVault.storageKey);
    } catch {
      // storage blocked or absent: memory only
    }
  }

  get(): string | null {
    return this.#key;
  }

  /** Whether the key is also stored in this browser. */
  get remembered(): boolean {
    try {
      return localStorage.getItem(KeyVault.storageKey) !== null;
    } catch {
      return false;
    }
  }

  set(key: string, remember: boolean): void {
    this.#key = key.trim() || null;
    try {
      if (remember && this.#key) localStorage.setItem(KeyVault.storageKey, this.#key);
      else localStorage.removeItem(KeyVault.storageKey);
    } catch {
      // storage blocked: memory only
    }
  }

  forget(): void {
    this.set("", false);
  }
}

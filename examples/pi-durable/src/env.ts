/**
 * Execution environments: where tools do their work.
 *
 * The `Machine` is a small simulated computer (files and a few shell commands on the shared
 * clock). It is not the harness: it keeps its files when the process dies, like a disk. The
 * harness builds an `Env` for every tool call from the conversation's working directory
 * (`pi.agent.cwd`), the way the post's `env({ cwd })` function builds a `NodeExecutionEnv`.
 */
import type { Clock } from "@tinyactors/scxmljs";

export interface Env {
  readonly cwd: string;
  readonly label: string;
  read(path: string): string | undefined;
  write(path: string, text: string): void;
  list(): string[];
  /** Run a command; lines arrive over time. Rejects when `signal` aborts. */
  exec(command: string, onLine: (line: string) => void, signal: AbortSignal): Promise<{ code: number; output: string }>;
}

const INITIAL: Record<string, string> = {
  "/work/repo/README.md": "# shop\n\nA small web shop: login, cart, checkout.\n",
  "/work/repo/AGENTS.md": "- Use bun for everything.\n- Keep answers short.\n",
  "/work/repo/test/login.test.ts": 'test("logs in", async () => {\n  await login({ timeout: 100 });\n});\n',
  "/work/repo/CHANGELOG.md": "## Unreleased\n",
  "/work/review/README.md": "# shop (review checkout)\n",
  "/work/review/AGENTS.md": "- You review; never change files.\n",
};

/** Scripted output: [delay before the line in ms, line]. */
type Script = [number, string][];

export class Machine {
  readonly files = new Map<string, string>(Object.entries(INITIAL));
  /** Each call of a command: for the page ("bun test ran 2 times"). */
  readonly runs: { command: string; cwd: string; at: number }[] = [];

  constructor(readonly clock: Clock) {}

  env(cwd = "/work/repo"): Env {
    const abs = (p: string) => (p.startsWith("/") ? p : `${cwd}/${p}`);
    return {
      cwd,
      label: `MemoryEnv(${cwd})`,
      read: (p) => this.files.get(abs(p)),
      write: (p, text) => void this.files.set(abs(p), text),
      list: () => [...this.files.keys()].filter((k) => k.startsWith(`${cwd}/`)).map((k) => k.slice(cwd.length + 1)),
      exec: (command, onLine, signal) => this.#exec(cwd, command, onLine, signal),
    };
  }

  #script(cwd: string, command: string): { script: Script; code: number } {
    const c = command.trim();
    if (c === "pwd") return { script: [[200, cwd]], code: 0 };
    if (c === "ls") return { script: [[300, this.env(cwd).list().join("  ")]], code: 0 };
    if (c.startsWith("cat ")) {
      const text = this.env(cwd).read(c.slice(4).trim());
      return text === undefined
        ? { script: [[200, `cat: ${c.slice(4)}: No such file`]], code: 1 }
        : { script: [[200, text.trimEnd()]], code: 0 };
    }
    if (c.startsWith("bun test")) {
      const test = this.files.get(`${cwd}/test/login.test.ts`) ?? "";
      const fixed = test.includes("timeout: 500");
      return {
        script: [
          [500, "bun test v1.3.0"],
          [900, "test/login.test.ts:"],
          [1200, "  ✓ renders the form [12ms]"],
          [1200, "  ✓ rejects a wrong password [31ms]"],
          [1500, fixed ? "  ✓ logs in [212ms]" : "  ✗ logs in: timed out after 100ms (the token arrived after 212ms)"],
          [600, fixed ? " 3 pass, 0 fail" : " 2 pass, 1 fail"],
        ],
        code: fixed ? 0 : 1,
      };
    }
    if (c.startsWith("tail") && c.includes("staging"))
      return {
        script: [
          [600, "staging  12:01:07  checkout: payment provider p95 1840ms"],
          [800, "staging  12:01:09  checkout: retrying card authorisation (attempt 2)"],
          [700, "staging  12:01:12  checkout: 3 of 40 requests over 2s"],
        ],
        code: 0,
      };
    if (c.startsWith("tail"))
      return {
        script: [
          [800, "prod  12:00:41  GET /checkout 200 412ms"],
          [900, "prod  12:00:44  GET /checkout 200 1207ms"],
          [900, "prod  12:00:49  POST /checkout/pay 200 1931ms"],
          [900, "prod  12:00:52  GET /checkout 200 388ms"],
        ],
        code: 0,
      };
    if (c.startsWith("git log")) return { script: [[300, "a1c9e0f fix: retry token refresh\n77d01b2 feat: split payments"]], code: 0 };
    return { script: [[200, `sh: ${c.split(" ")[0]}: command not found`]], code: 127 };
  }

  #exec(cwd: string, command: string, onLine: (line: string) => void, signal: AbortSignal): Promise<{ code: number; output: string }> {
    this.runs.push({ command, cwd, at: this.clock.now() });
    const { script, code } = this.#script(cwd, command);
    return new Promise((resolve, reject) => {
      const lines: string[] = [];
      let timer: unknown;
      let i = 0;
      const next = () => {
        if (i >= script.length) return resolve({ code, output: lines.join("\n") });
        const [delay, line] = script[i++]!;
        timer = this.clock.setTimeout(() => {
          lines.push(line);
          onLine(line);
          next();
        }, delay);
      };
      signal.addEventListener("abort", () => {
        this.clock.clearTimeout(timer);
        reject(new Error("aborted"));
      });
      next();
    });
  }
}

/**
 * The bank behind the post's checkout example: another outside system that survives the
 * process. A charge key makes a charge idempotent: charging `payment-t9` twice charges once.
 */
export class Bank {
  readonly charges = new Map<string, { card: string; status: "charged" | "refunded" | "declined" | "voided"; receipt?: string }>();
  /** Cards that are declined. */
  readonly declines = new Set(["mc-0009"]);
  /** Per card: how long a charge takes (the page and the tests set these). */
  readonly latency = new Map<string, number>();
  latencyMs = 1500;
  readonly log: string[] = [];

  constructor(readonly clock: Clock) {}

  charge(card: string, key: string, signal: AbortSignal): Promise<{ ok: boolean; receipt?: string; error?: string; repeated?: boolean }> {
    // a charge already on its way reaches the bank even if the caller dies meanwhile
    return this.#after(this.latency.get(card) ?? this.latencyMs, signal, true, () => {
      const known = this.charges.get(key);
      if (known?.status === "voided") {
        this.log.push(`${key}: voided before it arrived, not charged`);
        return { ok: false, error: "voided" };
      }
      if (known) {
        this.log.push(`${key}: already ${known.status} (idempotent)`);
        return known.status === "declined"
          ? { ok: false, error: `${card} was declined`, repeated: true }
          : { ok: true, receipt: known.receipt!, repeated: true };
      }
      if (this.declines.has(card)) {
        this.charges.set(key, { card, status: "declined" });
        this.log.push(`${key}: ${card} declined`);
        return { ok: false, error: `${card} was declined` };
      }
      const receipt = `rcpt-${card.slice(-4)}`;
      this.charges.set(key, { card, status: "charged", receipt });
      this.log.push(`${key}: charged ${card}`);
      return { ok: true, receipt };
    });
  }

  refund(key: string, signal: AbortSignal): Promise<{ refunded: boolean }> {
    return this.#after(600, signal, false, () => {
      const c = this.charges.get(key);
      if (!c) {
        // the charge may still be on its way: void the key so it can never land
        this.charges.set(key, { card: "?", status: "voided" });
        this.log.push(`${key}: voided (no charge yet)`);
        return { refunded: false };
      }
      if (c.status !== "charged") {
        this.log.push(`${key}: nothing to refund`);
        return { refunded: false };
      }
      c.status = "refunded";
      this.log.push(`${key}: refunded ${c.card}`);
      return { refunded: true };
    });
  }

  #after<T>(ms: number, signal: AbortSignal, inFlight: boolean, fn: () => T): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = this.clock.setTimeout(() => {
        const v = fn();
        if (!signal.aborted) resolve(v);
      }, ms);
      signal.addEventListener("abort", () => {
        if (!inFlight) this.clock.clearTimeout(t);
        reject(new Error("aborted"));
      });
    });
  }
}

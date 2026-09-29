/**
 * Simulated tools: small, deterministic stand-ins that are good enough to follow along.
 * Switch a client to "real" to run the WebAssembly versions (wasm.ts) instead.
 */
import { createSession, type Session, VirtualClock } from "@tinyactors/scxmljs";
import type { ToolImpl } from "../protocol.ts";

// ── shell: a tiny shell over a fake /workspace ─────────────────────────────

export const WORKSPACE: Record<string, string> = {
  "README.md":
    "# Demo workspace\n\nFiles for the llm-chat demo.\n\n- notes.md: meeting notes\n- orders.csv: last week's orders\n- report.py: summarises orders.csv\n",
  "notes.md": "# Notes\n\n- ship the chat demo\n- write the protocol doc\n",
  "orders.csv": "id,status,total\n1,shipped,20\n2,pending,35\n3,shipped,12\n4,cancelled,8\n",
  "report.py": "import csv\nrows = list(csv.DictReader(open('orders.csv')))\nprint(len(rows), 'orders')\n",
};

export function simulatedShell(files: Record<string, string> = WORKSPACE): ToolImpl {
  const glob = (pattern: string) => {
    const re = new RegExp(
      `^${pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".")}$`,
    );
    return Object.keys(files)
      .filter((f) => re.test(f))
      .sort();
  };
  const read = (f: string) => {
    const content = files[f.replace(/^(\/workspace\/|\.\/)/, "")];
    if (content === undefined) throw new Error(`${f}: No such file or directory`);
    return content;
  };
  return async (input, { clock }) => {
    const command = String(input.command ?? "").trim();
    if (/[|;&><`$]/.test(command))
      throw new Error("sh (simulated): pipes, redirects and substitutions aren't simulated; switch Terminal to real");
    const [cmd = "", ...args] = command.split(/\s+/);
    const operands = args.filter((a) => !a.startsWith("-"));
    const expand = (list: string[]) => list.flatMap((a) => (/[*?]/.test(a) ? glob(a) : [a]));
    switch (cmd) {
      case "ls":
        return (operands.length ? expand(operands) : Object.keys(files).sort()).join("\n");
      case "cat":
        return expand(operands).map(read).join("");
      case "wc": {
        const lines = expand(operands).map((f) => `${read(f).split("\n").length - 1} ${f}`);
        return lines.join("\n");
      }
      case "head":
        return expand(operands)
          .map((f) => read(f).split("\n").slice(0, 10).join("\n"))
          .join("\n");
      case "grep": {
        const [pattern = "", ...names] = operands;
        return expand(names)
          .flatMap((f) =>
            read(f)
              .split("\n")
              .filter((l) => l.includes(pattern))
              .map((l) => `${f}:${l}`),
          )
          .join("\n");
      }
      case "echo":
        return args.join(" ");
      case "pwd":
        return "/workspace";
      case "date":
        return new Date(clock.now()).toUTCString();
      case "":
        return "";
      default:
        throw new Error(`sh (simulated): ${cmd}: command not found. Simulated: ls, cat, wc, head, grep, echo, pwd, date`);
    }
  };
}

// ── python: print(<integer arithmetic>) ────────────────────────────────────

export const simulatedPython: ToolImpl = async (input) => {
  const code = String(input.code ?? "").trim();
  const m = /^print\((.*)\)$/s.exec(code);
  if (!m) throw new Error("python (simulated): only print(<integer arithmetic>) is simulated; switch Python to real");
  return `${evaluate(m[1]!)}`;
};

/** + - * / // % ** and parentheses over integers, with Python's precedence (BigInt). */
export function evaluate(source: string): bigint {
  const tokens = source.match(/\*\*|\/\/|\d+|[-+*/%()]|\S/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const take = (t?: string) => {
    const tok = tokens[i++];
    if (t && tok !== t) throw new Error(`python (simulated): expected ${t}`);
    return tok;
  };
  const atom = (): bigint => {
    const t = take();
    if (t === "(") {
      const v = sum();
      take(")");
      return v;
    }
    if (t === "-") return -power();
    if (t === "+") return power();
    if (t && /^\d+$/.test(t)) return BigInt(t);
    throw new Error(`python (simulated): unexpected ${t ?? "end of input"}`);
  };
  const power = (): bigint => {
    const base = atom();
    if (peek() === "**") {
      take();
      return base ** power();
    }
    return base;
  };
  const product = (): bigint => {
    let v = power();
    for (let op = peek(); op === "*" || op === "/" || op === "//" || op === "%"; op = peek()) {
      take();
      const r = power();
      if (r === 0n && op !== "*") throw new Error("ZeroDivisionError: division by zero");
      v = op === "*" ? v * r : op === "%" ? ((v % r) + r) % r : floorDiv(v, r);
    }
    return v;
  };
  const sum = (): bigint => {
    let v = product();
    for (let op = peek(); op === "+" || op === "-"; op = peek()) {
      take();
      v = op === "+" ? v + product() : v - product();
    }
    return v;
  };
  const v = sum();
  if (i < tokens.length) throw new Error(`python (simulated): unexpected ${tokens[i]}`);
  return v;
}

function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
}

// ── sql: a few canned queries over `orders` ────────────────────────────────

export const simulatedSql: ToolImpl = async (input) => {
  const q = String(input.query ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (/group by status/.test(q))
    return " status    | count\n-----------+-------\n shipped   |     2\n pending   |     1\n cancelled |     1\n(3 rows)";
  if (/^select count\(\*\) from orders/.test(q)) return " count\n-------\n     4\n(1 row)";
  if (/^select \* from orders/.test(q))
    return " id | status    | total\n----+-----------+-------\n  1 | shipped   |    20\n  2 | pending   |    35\n  3 | shipped   |    12\n  4 | cancelled |     8\n(4 rows)";
  throw new Error("ERROR (simulated): only a few queries on `orders` are simulated; switch Postgres to real");
};

// ── run_statechart: real, even in the simulation (local and cheap) ──────────

/** Runs a chart the model wrote in a fresh sandboxed session and reports where it ended up. */
export const runStatechart: ToolImpl = async (input) => {
  const clock = new VirtualClock();
  const logs: string[] = [];
  let session: Session | undefined;
  try {
    session = await createSession(String(input.scxml ?? ""), { clock, scriptTimeoutMs: 500 });
    session.addEventListener("log", (e) => logs.push(`${e.label ?? "log"}: ${String(e.value ?? "")}`));
    const errors: string[] = [];
    session.addEventListener("error", (e) => errors.push(`${e.kind}: ${e.message}`));
    session.start();
    clock.run();
    const steps: string[] = [`start → ${session.activeStateIds().join(", ")}`];
    for (const event of (input.events ?? []) as unknown[]) {
      session.send(String(event));
      clock.run(clock.now() + 10_000);
      steps.push(`${String(event)} → ${session.activeStateIds().join(", ")}`);
    }
    return [...steps, `status: ${session.status}`, ...logs, ...errors].join("\n");
  } finally {
    session?.dispose();
  }
};

// ── ask_*: a person answers ────────────────────────────────────────────────

export interface Question {
  id: number;
  question: string;
  answer(text: string): void;
}

/** Questions for a person, answered in their panel (or by a scenario's `answer`). */
export class HumanDesk extends EventTarget {
  readonly pending: Question[] = [];
  #ids = 0;

  readonly ask: ToolImpl = (input, { signal }) =>
    new Promise((resolve, reject) => {
      const q: Question = {
        id: ++this.#ids,
        question: String(input.question ?? ""),
        answer: (text) => {
          this.#remove(q);
          resolve(text);
        },
      };
      this.pending.push(q);
      this.dispatchEvent(new Event("change"));
      signal.addEventListener("abort", () => {
        this.#remove(q);
        reject(signal.reason);
      });
    });

  /** Answer the oldest open question. */
  answer(text: string): boolean {
    const q = this.pending[0];
    q?.answer(text);
    return !!q;
  }

  #remove(q: Question): void {
    const i = this.pending.indexOf(q);
    if (i >= 0) this.pending.splice(i, 1);
    this.dispatchEvent(new Event("change"));
  }
}

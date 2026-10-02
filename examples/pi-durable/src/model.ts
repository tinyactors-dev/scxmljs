/**
 * The simulated model: deterministic, streamed on the shared clock, so a crash can land in the
 * middle of an answer. It reads the request the harness built (the active context, the tools
 * this conversation offers, its instructions) and follows a small playbook keyed on the newest
 * user message and the latest tool round. Anything else gets a plain answer.
 */
import type { Clock } from "@tinyactors/scxmljs";

export type Msg =
  | { role: "user"; text: string; author: string }
  | { role: "assistant"; text: string; toolCalls: { name: string; args: Record<string, unknown> }[] }
  | { role: "tool"; name: string; text: string; isError: boolean; code?: string };

export interface ModelRequest {
  model: string;
  mode: "chat" | "summary";
  instructions?: string;
  /** A compaction summary or handoff note at the head of the context. */
  summary?: string;
  handoff?: string;
  sections: Record<string, string>;
  messages: Msg[];
  tools: string[];
}

export interface ModelReply {
  text: string;
  toolCalls: { name: string; args: Record<string, unknown> }[];
}

export class ModelError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export type Fault = "overloaded" | "invalid";

export class SimModel {
  /** Words per second of simulated time. */
  wordsPerSecond = 20;
  thinkMs = 600;
  readonly #faults: Fault[] = [];
  /** Every request, for the page and the tests. */
  readonly requests: { at: number; model: string; mode: string; messages: number }[] = [];

  constructor(readonly clock: Clock) {}

  /** Make the next request fail. */
  fault(kind: Fault): void {
    this.#faults.push(kind);
  }

  async stream(req: ModelRequest, onText: (textSoFar: string) => void, signal: AbortSignal): Promise<ModelReply> {
    this.requests.push({ at: this.clock.now(), model: req.model, mode: req.mode, messages: req.messages.length });
    await this.#sleep(this.thinkMs, signal);
    const fault = this.#faults.shift();
    if (fault === "overloaded") throw new ModelError("overloaded (529): try again", true);
    if (fault === "invalid") throw new ModelError("invalid request (400)", false);
    const reply = respond(req);
    const words = reply.text.split(/(?<=\s)/);
    let text = "";
    for (const w of words) {
      await this.#sleep(1000 / this.wordsPerSecond, signal);
      text += w;
      onText(text);
    }
    return reply;
  }

  #sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new Error("aborted"));
      const t = this.clock.setTimeout(resolve, ms);
      signal.addEventListener("abort", () => {
        this.clock.clearTimeout(t);
        reject(new Error("aborted"));
      });
    });
  }
}

// ── the playbook ────────────────────────────────────────────────────────────

type Results = Extract<Msg, { role: "tool" }>[];
interface Ctx {
  /** The newest user message (a steer counts: it is the newest thing the user said). */
  text: string;
  /** The latest tool round's results, after that message. */
  round: Results;
  /** Every tool result since the message. */
  all: Results;
  tools: Set<string>;
  req: ModelRequest;
}
type Step = { text: string; calls?: { name: string; args: Record<string, unknown> }[] };
interface Rule {
  match: RegExp;
  first(ctx: Ctx): Step;
  /** After a tool round; undefined = answer with `answer`. */
  next?(ctx: Ctx): Step | undefined;
  answer?(ctx: Ctx): string;
}

const call = (name: string, args: Record<string, unknown>) => ({ name, args });
const out = (r: Results, name: string) => r.find((x) => x.name === name);

const RULES: Rule[] = [
  {
    match: /staging logs/i,
    first: () => ({ text: "Checking the staging logs first.", calls: [call("bash", { command: "tail -n 20 staging.log" })] }),
    answer: () =>
      "Staging shows the payment provider at 1.8 s p95, with card authorisations retried. Checkout is slow because of the provider, not our code.",
  },
  {
    match: /checkout (is )?slow|slow checkout/i,
    first: () => ({ text: "Reading the production log.", calls: [call("bash", { command: "tail -n 20 /var/log/app.log" })] }),
    answer: () => "Production checkout requests take up to 1.9 s, mostly in POST /checkout/pay. The payment step is the slow part.",
  },
  {
    match: /flaky login/i,
    first: () => ({
      text: "Let me check the tracker for known issues and run the test.",
      calls: [call("search_issues", { query: "flaky login" }), call("bash", { command: "bun test login" })],
    }),
    next: ({ round }) => {
      const bash = out(round, "bash");
      const edit = out(round, "edit");
      if (bash?.code === "interrupted")
        return { text: "The test run was interrupted, so I'm running it again.", calls: [call("bash", { command: "bun test login" })] };
      if (bash?.text.includes("✗ logs in"))
        return {
          text: "The token takes up to 212 ms but the test waits only 100 ms. I'll raise the timeout.",
          calls: [call("edit", { path: "test/login.test.ts", find: "timeout: 100", replace: "timeout: 500" })],
        };
      if (edit) return { text: "Running the test again.", calls: [call("bash", { command: "bun test login" })] };
      return undefined;
    },
    answer: () =>
      "Fixed the flaky login test. The login token can take up to 212 ms to arrive, but the test gave up after 100 ms, so it failed whenever the token was slow. " +
      "I raised the timeout in test/login.test.ts to 500 ms, which matches issue #208, and the suite now passes three out of three. Nothing else needed to change.",
  },
  {
    match: /deploy fail/i,
    first: () => ({ text: "Searching the tracker.", calls: [call("search_issues", { query: "deploy failure" })] }),
    answer: () => "The deploy failed because migration 0042 timed out on the orders table (issue #311). v1.4.1 is the last good version.",
  },
  {
    match: /roll (it )?back|rollback/i,
    first: ({ tools }) =>
      tools.has("deploy")
        ? { text: "Rolling back to v1.4.1.", calls: [call("deploy", { version: "v1.4.1" })] }
        : {
            text: "I can't roll back from this thread: deploy isn't one of my tools here. I can search the tracker, though; ask in the channel to deploy.",
          },
    answer: ({ all }) => {
      const d = out(all, "deploy");
      return d && !d.isError ? "Rolled back: v1.4.1 is live." : `I didn't deploy: ${d?.text ?? "no result"}`;
    },
  },
  { match: /on.call/i, first: () => ({ text: "Ada is on call today; Bo is the backup." }) },
  {
    match: /deploy (v\d[\w.]*)/i,
    first: ({ text }) => {
      const version = /deploy (v\d[\w.]*)/i.exec(text)![1]!;
      return { text: `Deploying ${version}.`, calls: [call("deploy", { version })] };
    },
    answer: ({ all }) => {
      const d = out(all, "deploy");
      return d && !d.isError ? `Done: ${d.text.split("\n").at(-1)}` : `I didn't deploy: ${d?.text ?? "no result"}`;
    },
  },
  {
    match: /triage|label (this|the) issue/i,
    first: ({ text }) => ({
      text: "Asking a triage subagent.",
      calls: [call("triage", { issue: text.split(":").slice(1).join(":").trim() || text })],
    }),
    answer: ({ all }) => `Triage says: ${out(all, "triage")?.text ?? "nothing"}.`,
  },
  {
    match: /checkout|pay for/i,
    first: ({ text }) => {
      const cards = text.match(/\b(visa|amex|mc)-\d+/gi) ?? ["visa-4242", "amex-0005", "mc-0009"];
      return { text: `Paying with ${cards.length} cards.`, calls: [call("checkout", { cards })] };
    },
    answer: ({ all }) => {
      const r = out(all, "checkout");
      return r?.code === "interrupted"
        ? "The checkout was interrupted by a restart; its payments were refunded. Nothing was charged."
        : `Checkout: ${r?.text ?? "no result"}`;
    },
  },
  {
    match: /remind/i,
    first: () => ({ text: "Setting a reminder.", calls: [call("remind_me", { text: "Stretch your legs.", inSeconds: 20 })] }),
    answer: () => "I'll remind you in 20 seconds. The reminder is a background task, so I'm free in the meantime.",
  },
  {
    match: /\btodo|to my list/i,
    first: ({ text }) => {
      const items = (text.split(/:\s*/)[1] ?? text)
        .split(/,\s*|\s+and\s+/)
        .map((s) => s.trim().replace(/\.$/, ""))
        .filter(Boolean);
      return { text: `Adding ${items.length} item${items.length === 1 ? "" : "s"}.`, calls: items.map((item) => call("todo", { item })) };
    },
    answer: ({ all }) => `Added: ${all.map((r) => r.text.replace(/^Added /, "")).join(", ")}.`,
  },
  {
    match: /AGENTS\.md|house rule/i,
    first: () => ({
      text: "Adding the rule to AGENTS.md.",
      calls: [
        call("edit", {
          path: "AGENTS.md",
          find: "- Keep answers short.",
          replace: "- Keep answers short.\n- Always run the tests before you answer.",
        }),
      ],
    }),
    answer: () => "Added the rule to AGENTS.md. From the next request on, it is part of my instructions.",
  },
  {
    match: /hand ?off|start over/i,
    first: () => ({
      text: "Handing off to a fresh context.",
      calls: [call("handoff", { note: "We fixed the flaky login test (timeout 100 → 500 ms, issue #208). Next: update the changelog." })],
    }),
  },
  {
    match: /^continue\.?$/i,
    first: ({ req }) => ({
      text: req.handoff
        ? `Picking up from the handoff note: ${req.handoff} Older messages are still in storage; I can search them.`
        : "Continuing.",
    }),
  },
  {
    match: /earlier|search (the )?history|what did (we|i) (say|do)/i,
    first: ({ text }) => ({
      text: "Searching the history, including what came before the handoff.",
      calls: [call("search_history", { text: /about (\w+)/i.exec(text)?.[1] ?? "timeout" })],
    }),
    answer: ({ all }) => {
      const r = out(all, "search_history");
      const n = r && r.text !== "nothing found" ? r.text.split("\n").filter(Boolean).length : 0;
      return `Found ${n} earlier message${n === 1 ? "" : "s"}. They are older than the summary and the handoff, so I no longer see them, but they are all still in storage.`;
    },
  },
  {
    match: /\bfiles\b|\brepo\b|look around|what's in/i,
    first: () => ({ text: "Looking around.", calls: [call("bash", { command: "ls" }), call("read", { path: "README.md" })] }),
    answer: ({ all }) => `The repository has ${out(all, "bash")?.text ?? "nothing"}. It's a small web shop: login, cart, checkout.`,
  },
  {
    match: /\bpwd\b|where are you|working directory/i,
    first: () => ({ text: "Checking.", calls: [call("bash", { command: "pwd" })] }),
    answer: ({ all }) => `I'm working in ${out(all, "bash")?.text.replace(/^\(venv\) /, "") ?? "?"}.`,
  },
];

const FILLER = [
  "Here is how I'd think about it.",
  "The short version is that the system keeps every step it takes, so nothing is lost when something goes wrong.",
  "Each step is written down before the next one starts.",
  "That makes the work easy to resume, to inspect, and to share with other people who join later.",
  "If you want, I can go deeper on any part of this.",
];

export function respond(req: ModelRequest): ModelReply {
  if (req.mode === "summary") {
    const users = req.messages.filter((m) => m.role === "user").map((m) => (m as { text: string }).text);
    return {
      text: `Summary of ${req.messages.length} earlier messages. The user asked: ${users.map((u) => `“${u.slice(0, 48)}”`).join("; ")}.`,
      toolCalls: [],
    };
  }
  if (req.instructions && /one word/i.test(req.instructions)) {
    const last = [...req.messages].reverse().find((m) => m.role === "user") as { text: string } | undefined;
    const t = last?.text.toLowerCase() ?? "";
    const word = /crash|fail|error|broken|wrong/.test(t)
      ? "bug"
      : /please add|could you|would be nice|support/.test(t)
        ? "feature"
        : "question";
    return { text: word, toolCalls: [] };
  }
  const at = req.messages.findLastIndex((m) => m.role === "user");
  const text = at >= 0 ? (req.messages[at] as { text: string }).text : "";
  const after = req.messages.slice(at + 1);
  const all = after.filter((m): m is Results[number] => m.role === "tool");
  const lastCall = after.findLastIndex((m) => m.role === "assistant");
  const round = after.slice(lastCall + 1).filter((m): m is Results[number] => m.role === "tool");
  const ctx: Ctx = { text, round, all, tools: new Set(req.tools), req };
  const rule = RULES.find((r) => r.match.test(text));
  if (!rule) {
    const n = req.messages.filter((m) => m.role === "user").length;
    const tail = [0, 1, 2, 3, 4].map((i) => FILLER[(n + i) % FILLER.length]).join(" ");
    return { text: `About “${text.slice(0, 60)}”: ${tail}`, toolCalls: [] };
  }
  const step = all.length === 0 ? rule.first(ctx) : (rule.next?.(ctx) ?? { text: rule.answer?.(ctx) ?? "Done." });
  const calls = (step.calls ?? []).filter((c) => ctx.tools.has(c.name));
  if (step.calls?.length && !calls.length)
    return { text: `I would use ${step.calls.map((c) => c.name).join(", ")}, but this conversation doesn't offer it.`, toolCalls: [] };
  return { text: step.text, toolCalls: calls };
}

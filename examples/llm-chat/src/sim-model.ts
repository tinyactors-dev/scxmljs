/**
 * The simulated model: rule-based over the conversation, timed on the shared clock, and
 * producing the same streaming events as the Messages API. It never emits signed thinking
 * blocks, so a simulated history stays valid if the conversation switches to Claude.
 *
 * Rules (first user turn of a request): each rule whose words appear in the input and whose
 * tool is offered this turn becomes one tool call; all of them go out in one response, so
 * "files and python" is a parallel batch. After tool results it summarises them.
 */
import type { Clock } from "@tinyactors/scxmljs";
import {
  type BetaMessage,
  type BetaMessageParam,
  type BetaRawMessageStreamEvent,
  type BetaStopReason,
  type LlmErrorKind,
  ModelError,
  type ModelRequest,
  type ModelSource,
  type ModelStream,
} from "./protocol.ts";

export type FaultKind = "rate_limit" | "overloaded" | "stream" | "max_tokens" | "refusal" | "hang";
export interface Fault {
  kind: FaultKind;
  retryAfterMs?: number;
}

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
interface Plan {
  blocks: Block[];
  stop: BetaStopReason;
}

interface Rule {
  tool: string;
  when: RegExp;
  input(text: string): Record<string, unknown>;
}

const TRAFFIC_LIGHT = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="red">
  <state id="red"><transition event="timer" target="green"/></state>
  <state id="green"><transition event="timer" target="yellow"/></state>
  <state id="yellow"><transition event="timer" target="red"/></state>
</scxml>`;

export const RULES: Rule[] = [
  {
    tool: "shell",
    when: /\b(files?|workspace|ls|folder|directory|shell|terminal|readme|lines)\b/i,
    input: (t) => ({
      command: /\blines?\b/i.test(t) ? "wc -l README.md" : /markdown|\.md\b/i.test(t) ? "ls *.md" : "ls",
    }),
  },
  {
    tool: "python",
    when: /\b(python|compute|calculate)\b|\d\s*\*\*\s*\d/i,
    input: (t) => ({ code: `print(${arithmetic(t) ?? "2**64"})` }),
  },
  {
    tool: "sql",
    when: /\b(sql|database|postgres|orders?|table)\b/i,
    input: () => ({ query: "SELECT status, count(*) FROM orders GROUP BY status ORDER BY 2 DESC;" }),
  },
  {
    tool: "run_statechart",
    when: /\b(statecharts?|state machines?|scxml|traffic light)\b/i,
    input: () => ({ scxml: TRAFFIC_LIGHT, events: ["timer", "timer"] }),
  },
  {
    tool: "ask_ada",
    when: /\b(ask ada|check with ada|confirm|approve)\b/i,
    input: () => ({ question: "Should I go ahead with this?" }),
  },
];

/** The longest arithmetic-looking run in `text`, if it has an operator. */
function arithmetic(text: string): string | undefined {
  const runs = text.match(/[\d(][\d\s+\-*/%().]*[\d)]/g) ?? [];
  return runs
    .filter((r) => /[+\-*/%]/.test(r))
    .sort((a, b) => b.length - a.length)[0]
    ?.trim();
}

export class SimulatedModel implements ModelSource {
  readonly name = "simulated";
  timeToFirstTokenMs = 400;
  tokensPerSecond = 40;
  readonly #faults: Fault[] = [];
  #ids = 0;

  constructor(readonly clock: Clock) {}

  /** The next request fails (or ends) this way. */
  fault(fault: Fault): void {
    this.#faults.push(fault);
  }

  stream(request: ModelRequest, signal: AbortSignal): ModelStream {
    const plan = this.plan(request);
    const fault = this.#faults.shift();
    let resolve!: (m: BetaMessage) => void;
    let reject!: (e: unknown) => void;
    const final = new Promise<BetaMessage>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    final.catch(() => {}); // the iterator reports the same error
    const events = this.#events(plan, fault, signal, resolve, reject);
    return { [Symbol.asyncIterator]: () => events, finalMessage: () => final };
  }

  // ── what to say ──────────────────────────────────────────────────────────

  plan({ messages, tools }: ModelRequest): Plan {
    const last = messages.at(-1);
    const results = blocksOf(last).filter((b) => b.type === "tool_result");
    if (results.length) return { blocks: [{ type: "text", text: this.#summary(messages) }], stop: "end_turn" };

    const said = trailingUserText(messages);
    const offered = new Set(tools.map((t) => t.name));
    const calls = RULES.filter((r) => offered.has(r.tool) && r.when.test(said.text));
    if (calls.length) {
      const names = calls.map((c) => c.tool).join(" and ");
      return {
        blocks: [
          { type: "text", text: calls.length > 1 ? `I'll run ${names} at the same time.` : `Let me use ${names}.` },
          ...calls.map((c): Block => ({ type: "tool_use", id: `toolu_sim_${++this.#ids}`, name: c.tool, input: c.input(said.text) })),
        ],
        stop: "tool_use",
      };
    }
    const others = [...offered].filter((t) => t !== "ask_ada");
    const hint = others.length
      ? `Try asking about ${others.map(describeTool).join(", ")}${offered.has("ask_ada") ? ", or to check with Ada" : ""}.`
      : "Add Terminal, Python, Postgres or Statechart Lab with “Add client”, then ask about files, arithmetic, the orders table or a statechart; they each bring a tool.";
    return {
      blocks: [{ type: "text", text: `(Simulated answer for ${said.authors.join(" and ") || "you"}.) You said: “${said.text}”. ${hint}` }],
      stop: "end_turn",
    };
  }

  #summary(messages: BetaMessageParam[]): string {
    const uses = new Map<string, string>();
    for (const b of blocksOf(messages.at(-2))) if (b.type === "tool_use") uses.set(b.id, b.name);
    const lines: string[] = ["Here is what came back:"];
    const last = blocksOf(messages.at(-1));
    for (const b of last) {
      if (b.type !== "tool_result") continue;
      const text = typeof b.content === "string" ? b.content : JSON.stringify(b.content);
      const first = text.split("\n").slice(0, 3).join(" · ").slice(0, 160);
      lines.push(`- ${uses.get(b.tool_use_id) ?? "a tool"}${b.is_error ? " failed" : ""}: ${first}`);
    }
    const steers = last.filter((b) => b.type === "text");
    for (const s of steers) if (s.type === "text") lines.push(`Noted: ${s.text.replace(/[.!?]$/, "")}. I'll keep that in mind.`);
    return lines.join("\n");
  }

  // ── how to say it ────────────────────────────────────────────────────────

  async *#events(
    plan: Plan,
    fault: Fault | undefined,
    signal: AbortSignal,
    resolve: (m: BetaMessage) => void,
    reject: (e: unknown) => void,
  ): AsyncGenerator<BetaRawMessageStreamEvent> {
    const tick = 1000 / this.tokensPerSecond;
    let output = 0;
    try {
      await this.#sleep(this.timeToFirstTokenMs, signal);
      if (fault?.kind === "hang") await this.#sleep(Number.POSITIVE_INFINITY, signal);
      if (fault?.kind === "rate_limit")
        throw new ModelError("rate_limit", "429 rate limited (simulated)", { status: 429, retryAfterMs: fault.retryAfterMs ?? 2000 });
      if (fault?.kind === "overloaded") throw new ModelError("overloaded", "529 overloaded (simulated)", { status: 529 });

      const id = `msg_sim_${++this.#ids}`;
      yield ev({ type: "message_start", message: message(id, [], null, 0) });
      const content: Block[] = [];
      let stop = plan.stop;
      for (const [index, block] of plan.blocks.entries()) {
        if (block.type === "text") {
          yield ev({ type: "content_block_start", index, content_block: { type: "text", text: "", citations: null } });
          let text = "";
          const words = block.text.split(/(?<=\s)/);
          for (const [i, word] of words.entries()) {
            await this.#sleep(tick, signal);
            if (fault?.kind === "stream" && i === Math.floor(words.length / 2))
              throw new ModelError("stream", "the stream broke off (simulated)");
            if ((fault?.kind === "max_tokens" || fault?.kind === "refusal") && i === Math.floor(words.length / 2)) {
              stop = fault.kind;
              break;
            }
            text += word;
            output++;
            yield ev({ type: "content_block_delta", index, delta: { type: "text_delta", text: word } });
          }
          content.push({ type: "text", text });
          yield ev({ type: "content_block_stop", index });
        } else {
          yield ev({ type: "content_block_start", index, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
          const json = JSON.stringify(block.input);
          for (let i = 0; i < json.length; i += 16) {
            await this.#sleep(tick, signal);
            output++;
            yield ev({ type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: json.slice(i, i + 16) } });
          }
          content.push(block);
          yield ev({ type: "content_block_stop", index });
        }
        if (stop !== plan.stop) break;
      }
      yield ev({ type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: usage(output) });
      yield ev({ type: "message_stop" });
      resolve(message(id, content, stop, output));
    } catch (err) {
      reject(err);
      throw err;
    }
  }

  #sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((res, rej) => {
      if (signal.aborted) return rej(new ModelError("stream", "aborted"));
      const h = Number.isFinite(ms) ? this.clock.setTimeout(res, ms) : null;
      signal.addEventListener(
        "abort",
        () => {
          if (h !== null) this.clock.clearTimeout(h);
          rej(new ModelError("stream", "aborted"));
        },
        { once: true },
      );
    });
  }
}

export function faultKind(kind: string): kind is FaultKind {
  return ["rate_limit", "overloaded", "stream", "max_tokens", "refusal", "hang"].includes(kind);
}
export type { LlmErrorKind };

// ── helpers ────────────────────────────────────────────────────────────────

type ContentBlockParam = Exclude<BetaMessageParam["content"], string>[number];

function blocksOf(m: BetaMessageParam | undefined): ContentBlockParam[] {
  if (!m) return [];
  const { content } = m;
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

/** The user text since the model last spoke, and who wrote it (`[Ada] …` prefixes). */
function trailingUserText(messages: BetaMessageParam[]): { text: string; authors: string[] } {
  const parts: string[] = [];
  const authors = new Set<string>();
  for (let i = messages.length - 1; i >= 0 && messages[i]!.role === "user"; i--) {
    for (const b of blocksOf(messages[i]).reverse()) {
      if (b.type !== "text") continue;
      const m = /^\[([^\]]+)\]\s*(.*)$/s.exec(b.text);
      if (m) authors.add(m[1]!);
      parts.unshift(m ? m[2]! : b.text);
    }
  }
  return { text: parts.join(" "), authors: [...authors].reverse() };
}

function describeTool(name: string): string {
  return (
    { shell: "files", python: "arithmetic", sql: "the orders table", run_statechart: "a statechart", ask_ada: "asking Ada" }[name] ?? name
  );
}

// The SDK's types describe real API objects in full; the simulation fills in what the
// invoker and the log read, and casts the rest.
function ev(e: unknown): BetaRawMessageStreamEvent {
  return e as BetaRawMessageStreamEvent;
}
function usage(output: number) {
  return { input_tokens: 0, output_tokens: output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
}
function message(id: string, content: Block[], stop: BetaStopReason | null, output: number): BetaMessage {
  return {
    id,
    type: "message",
    role: "assistant",
    model: "simulated",
    content: content.map((b) => (b.type === "text" ? { ...b, citations: null } : b)),
    stop_reason: stop,
    stop_sequence: null,
    usage: usage(output),
  } as unknown as BetaMessage;
}

/**
 * The harness: one process over a storage (Pi Durable's `Harness`).
 *
 * It runs one statechart session per live task (charts/<kind>.scxml), plus harness.scxml for
 * its own life. Charts never touch storage directly: every step is a named commit sent through
 * the `durable` I/O processor, applied here in one atomic `Tx` (PROTOCOL.md lists them). Between
 * commits, the scheduler (`#pump`) does what Pi's does: reserves pending tasks, wakes waiting
 * ones, marks owned work when its owner aborts or fails (failFast too), tells a marked task when
 * its owned work has drained, and finishes `completing` tasks.
 *
 * Everything here is the process: `kill()` throws it away without writing anything. A new
 * Harness over the same Storage reconciles and continues.
 */
import type {
  Clock,
  DOMParserLike,
  InvokeContext,
  InvokedService,
  Invoker,
  IOProcessor,
  IOSession,
  OutboundSend,
  SCXMLSession,
  SessionOptions,
} from "@tinyactors/scxmljs";
import {
  abortConversation,
  boundary,
  ConversationBusy,
  configure,
  createConversation,
  createTask,
  type Draft,
  endRun,
  ownedWork,
  submit,
} from "./conversation.ts";
import type { Bank, Machine } from "./env.ts";
import { ModelError, type Msg, type SimModel } from "./model.ts";
import type { HookApi, Registry, ToolApi, ToolDef, ToolResult } from "./registry.ts";
import { activeContext, entryText, type Storage, Tx } from "./storage.ts";
import {
  AgentDoc,
  type AgentState,
  type Checkpoint,
  type ConversationRecord,
  type EntryData,
  type EntryRecord,
  type InboxDoc,
  InboxDocDef,
  isLive,
  type LiveDoc,
  LiveDocDef,
  type Outcome,
  type SubmissionRecord,
  type TaskRecord,
  Todos,
  type TodosDoc,
  type ToolErrorCode,
  type UsageDoc,
  UsageDocDef,
} from "./types.ts";

export type Engine = (source: string, options: SessionOptions) => Promise<SCXMLSession>;

export interface Settings {
  compaction: { contextWindow: number; reserveTokens: number; backgroundTokens: number; keepRecentTokens: number };
  /** The default extension selection (`settings.extensions`); unset = every installed extension. */
  extensions?: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  compaction: { contextWindow: 16_000, reserveTokens: 2_000, backgroundTokens: 3_000, keepRecentTokens: 2_000 },
};

export interface HarnessOptions {
  processId: string;
  storage: Storage;
  clock: Clock;
  engine: Engine;
  /** Chart sources by name: harness, generation, tool, compaction, checkout, payment, reminder. */
  charts: Record<string, string>;
  registry: Registry;
  model: SimModel;
  machine: Machine;
  bank: Bank;
  settings: Settings;
  domParser?: DOMParserLike;
}

export interface PendingApproval {
  taskId: string;
  conversationId: string;
  question: string;
}

export interface EntryView extends EntryRecord {
  /** Seen by the model (after the newest head marker). */
  active: boolean;
  /** Belongs to the parent conversation (a fork sees it by reference). */
  inherited: boolean;
}

/** What a client renders: Pi's `ConversationView` (transcript + the four documents), plus todos and submissions. */
export interface ConversationView {
  seq: number;
  conversation: ConversationRecord;
  entries: EntryView[];
  docs: { agent: AgentState; live: LiveDoc; inbox: InboxDoc; usage: UsageDoc; todos: TodosDoc };
  submissions: SubmissionRecord[];
}

/** One commit's changes to a view: small enough to send over a socket. */
export type ViewOp =
  | { op: "entry"; entry: EntryView }
  | { op: "head"; first: string | null }
  | { op: "doc"; name: keyof ConversationView["docs"]; value: unknown }
  | { op: "submission"; record: SubmissionRecord };

const DURABLE = "http://tinyactors.dev/pi-durable/durable";
/** Commits a task may make after its abort mark: only its abort handler's. */
const ABORT_COMMITS = new Set(["task.aborted", "tool.aborted", "generation.aborted"]);
/** Partial answers are committed at most this often. */
const STREAM_COMMIT_MS = 250;

export class Harness extends EventTarget {
  readonly processId: string;
  dead = false;
  scheduling: "paused" | "running" = "paused";
  session!: SCXMLSession;
  readonly sessions = new Map<string, SCXMLSession>();
  readonly approvals = new Map<string, PendingApproval & { resolve(ok: boolean): void }>();

  readonly #o: HarnessOptions;
  readonly #starting = new Map<string, Promise<SCXMLSession | null>>();
  readonly #taskOf = new Map<string, string>(); // sessionId → taskId
  readonly #sent = { abort: new Set<string>(), drained: new Set<string>(), terminal: new Set<string>() };
  readonly #life = new AbortController();
  /** The code each tool call resolved when it started: it finishes on it, even if the registry changes. */
  readonly #tools = new Map<string, ToolDef>();
  readonly #taskWaiters = new Map<string, ((t: TaskRecord) => void)[]>();
  readonly #submissionWaiters = new Map<string, ((s: SubmissionRecord) => void)[]>();
  readonly #watchers = new Set<{ conversationId: string; last: ConversationView; send(ops: ViewOp[], seq: number): void }>();
  #pumpQueued = false;
  readonly #unsubscribe: () => void;

  private constructor(o: HarnessOptions) {
    super();
    this.#o = o;
    this.processId = o.processId;
    this.#unsubscribe = o.storage.subscribe(() => this.#onCommit());
  }

  get storage(): Storage {
    return this.#o.storage;
  }
  get registry(): Registry {
    return this.#o.registry;
  }
  get settings(): Settings {
    return this.#o.settings;
  }

  /** `Harness.open(storage, …)`: starts harness.scxml, which takes the storage and reconciles. */
  static async open(o: HarnessOptions): Promise<Harness> {
    const h = new Harness(o);
    h.session = await o.engine(named(o.charts.harness!, `harness · ${o.processId}`), {
      clock: o.clock,
      ...(o.domParser ? { domParser: o.domParser } : {}),
      ioprocessors: [h.#processor],
      data: { process: o.processId },
    });
    h.#taskOf.set(h.session.sessionId, "harness");
    h.session.addEventListener("microstep", (e) => {
      for (const s of e.entered) h.#cue(`harness.${s.id}`);
    });
    h.session.addEventListener("macrostep", () => h.#changed());
    h.session.start();
    return h;
  }

  /** `harness.resume()`: enables scheduling. Idempotent. */
  resume(): void {
    if (!this.dead) this.session.send("resume", undefined);
  }

  /** The process dies: no outcome is written, every session, timer and promise is gone. */
  kill(): void {
    if (this.dead) return;
    this.dead = true;
    this.#life.abort();
    this.#unsubscribe();
    for (const s of this.sessions.values()) s.dispose();
    this.session.dispose();
    this.approvals.clear();
    this.#watchers.clear();
    this.#changed();
  }

  // ── the durable processor: every chart's commits ───────────────────────────

  readonly #processor: IOProcessor = {
    type: DURABLE,
    aliases: ["durable"],
    location: () => DURABLE,
    send: (m: OutboundSend, session: IOSession) => {
      if (this.dead) return;
      const who = this.#taskOf.get(session.sessionId);
      if (who === "harness") this.#harnessCommit(m.event);
      else if (who) this.#taskCommit(who, m.event, (m.data ?? {}) as Record<string, unknown>);
    },
  };

  #harnessCommit(event: string): void {
    const { storage } = this.#o;
    if (event === "harness.acquire") {
      const previousOwner = storage.owner;
      storage.commit("harness", "harness.acquire", [{ type: "owner", owner: this.processId }]);
      this.session.send("harness.acquired", { previousOwner });
    } else if (event === "harness.reconcile") {
      // one commit, no task code: what the dead process was running goes back to pending
      const tx = new Tx(storage, "harness", "harness.reconcile");
      let recovered = 0;
      for (const t of tx.tasks()) {
        if (!isLive(t)) continue;
        recovered++;
        if (t.state.status === "running") tx.putTask({ ...t, state: { status: "pending", checkpoint: t.state.checkpoint } });
      }
      tx.commit();
      this.session.send("harness.reconciled", { recovered });
    } else if (event === "harness.resume") {
      this.scheduling = "running";
      this.#schedulePump();
    }
  }

  #tx<T>(by: string, name: string, fn: (tx: Tx) => T): T {
    const tx = new Tx(this.#o.storage, by, name);
    const r = fn(tx);
    tx.commit();
    this.#cue(`commit.${name}`);
    return r;
  }

  #taskCommit(taskId: string, name: string, d: Record<string, unknown>): void {
    const task = this.#o.storage.tasks.get(taskId);
    if (!task || task.state.status === "terminal") return;
    if (task.abortRequested && !ABORT_COMMITS.has(name)) {
      // Pi rejects a run invocation's commit once the task carries an abort mark
      this.#cue(`rejected.${name}`);
      this.#schedulePump();
      return;
    }
    const reg = this.#o.registry;
    this.#tx(taskId, name, (tx) => {
      const t = tx.task(taskId)!;
      const conv = t.conversationId;
      const live = () => tx.doc(LiveDocDef, conv);
      const settle = (outcome: Outcome) => this.#settle(tx, t, outcome);
      const checkpoint = (cp: Checkpoint) => tx.putTask({ ...t, state: { status: "running", checkpoint: cp } });
      switch (name) {
        // ── any task ──
        case "task.checkpoint":
          return checkpoint(d.checkpoint as Checkpoint);
        case "task.complete":
          this.#cleanup(tx, t);
          return settle({ status: "completed", result: d.result });
        case "task.fail":
          this.#cleanup(tx, t);
          return settle({ status: "failed", error: { message: String(d.message ?? "failed") } });
        case "task.aborted":
          this.#cleanup(tx, t);
          return settle({ status: "aborted", ...(d.reason ? { reason: String(d.reason) } : {}) });

        // ── pi.generation ──
        case "generation.request": {
          this.#appendSystem(tx, conv);
          const l = live();
          if (d.background && !l.compactions?.length) {
            const id = createTask(tx, reg, {
              conversationId: conv,
              kind: "pi.compaction",
              input: { reason: "threshold", blocking: false },
              background: true,
              label: "background compaction",
            });
            l.compactions = [...(l.compactions ?? []), { taskId: id, reason: "threshold", blocking: false }];
          }
          l.generation = { taskId, attempt: Number(d.attempt) };
          return checkpoint({ phase: "request", attempt: Number(d.attempt) });
        }
        case "generation.compactBlocking": {
          const id = createTask(tx, reg, {
            conversationId: conv,
            kind: "pi.compaction",
            input: { reason: "threshold", blocking: true },
            owner: taskId,
            label: "blocking compaction",
          });
          const l = live();
          l.compactions = [...(l.compactions ?? []), { taskId: id, reason: "threshold", blocking: true }];
          return tx.putTask({
            ...t,
            state: {
              status: "waiting",
              checkpoint: { phase: "prepare", attempt: Number(d.attempt), compacted: true },
              on: [id],
              policy: "allSettled",
            },
          });
        }
        case "generation.stream": {
          const l = live();
          if (l.generation?.taskId === taskId) l.generation.message = String(d.text);
          return;
        }
        case "generation.convertPartial":
          return this.#convertPartial(tx, t);
        case "generation.toolRound": {
          const model = this.#agent(conv).model ?? "sim-sol";
          const calls = (d.toolCalls as { name: string; args: Record<string, unknown> }[]).map((c, i) => ({
            id: `${taskId}-${i + 1}`,
            ...c,
          }));
          const e = tx.append(conv, { kind: "pi.assistant", text: String(d.text), toolCalls: calls, stopReason: "toolUse", model }, taskId);
          const ids = calls.map((c) =>
            createTask(tx, reg, {
              conversationId: conv,
              kind: "pi.tool",
              input: { assistant: e.id, callId: c.id, name: c.name, args: c.args },
              owner: taskId,
              label: c.name,
            }),
          );
          const l = live();
          l.tools = calls.map((c, i) => ({ callId: c.id, name: c.name, taskId: ids[i]!, status: "pending" }));
          if (l.generation) delete l.generation.message;
          this.#usage(tx, conv, String(d.text));
          // run no code until every call is done
          return tx.putTask({
            ...t,
            state: { status: "waiting", checkpoint: { phase: "tools", assistant: e.id }, on: ids, policy: "allSettled" },
          });
        }
        case "generation.answer": {
          const model = this.#agent(conv).model ?? "sim-sol";
          const e = tx.append(conv, { kind: "pi.assistant", text: String(d.text), toolCalls: [], stopReason: "stop", model }, taskId);
          this.#usage(tx, conv, String(d.text));
          endRun(tx, conv, { answer: e.id });
          boundary(tx, reg, conv, "final");
          return settle({ status: "completed", result: { entryId: e.id } });
        }
        case "generation.retry": {
          const until = tx.now + Number(d.delayMs);
          const l = live();
          if (l.generation) l.generation.retry = { at: until, error: String(d.error) };
          return checkpoint({ phase: "retry", attempt: Number(d.attempt), until });
        }
        case "generation.failed":
          endRun(tx, conv, { reason: "model_error" });
          return settle({ status: "failed", error: { message: String(d.error) } });
        case "generation.postTools": {
          const round = tx.tasks().filter((x) => x.owner === taskId && x.kind === "pi.tool");
          const handoff = round
            .map((x) =>
              x.state.status === "terminal"
                ? (x.state.outcome.result as { control?: { handoff?: string } } | undefined)?.control?.handoff
                : undefined,
            )
            .find(Boolean);
          if (handoff) {
            // a tool asked to hand off: a new context starts from the note; nothing is deleted
            tx.append(conv, { kind: "pi.reset", handoff }, taskId);
            endRun(tx, conv, { reason: "reset" });
            boundary(tx, reg, conv, "final");
          } else {
            boundary(tx, reg, conv, "postTools");
            const next = createTask(tx, reg, { conversationId: conv, kind: "pi.generation", label: "model request" });
            const l = live();
            if (l.run) l.run.taskId = next;
            l.generation = { taskId: next, attempt: 1 };
            l.tools = [];
          }
          return settle({ status: "completed" });
        }
        case "generation.aborted":
          this.#convertPartial(tx, t);
          endRun(tx, conv, { reason: "aborted" });
          return settle({ status: "aborted" });

        // ── pi.tool ──
        case "tool.intent":
          this.#slot(tx, t, { status: "running" });
          return checkpoint({ phase: "execute", arguments: d.args, replay: d.replay });
        case "tool.unavailable":
          this.#toolResult(tx, t, `Tool ${t.input.name} is not available in this conversation.`, true, "tool_unavailable");
          return settle({ status: "completed" });
        case "tool.blocked":
          this.#toolResult(tx, t, `Blocked: ${d.reason}`, true, "blocked");
          return settle({ status: "completed" });
        case "tool.result": {
          const r = d.result as ToolResult;
          const e = this.#toolResult(tx, t, r.text, !!r.isError);
          const u = tx.doc(UsageDocDef, conv);
          u.toolCalls++;
          return settle({ status: "completed", result: { entryId: e.id, ...(r.control ? { control: r.control } : {}) } });
        }
        case "tool.error":
          this.#toolResult(tx, t, `Error: ${d.message}`, true, "tool_error");
          return settle({ status: "failed", error: { message: String(d.message) } });
        case "tool.interrupted": {
          const output = live().tools?.find((s) => s.callId === t.input.callId)?.output ?? "";
          this.#toolResult(
            tx,
            t,
            `Tool ${t.input.name} was interrupted and may have partially run.${output ? `\nOutput so far:\n${output.trimEnd()}` : ""}`,
            true,
            "interrupted",
          );
          // failed is cancellation intent: anything the call owned is aborted
          return settle({ status: "failed", error: { message: "interrupted" } });
        }
        case "tool.aborted":
          this.#toolResult(tx, t, `Tool ${t.input.name} was aborted.`, true, "aborted");
          return settle({ status: "aborted" });

        // ── pi.compaction ──
        case "compaction.nothing":
          this.#cleanup(tx, t);
          return settle({ status: "completed" });
        case "compaction.place": {
          this.#cleanup(tx, t);
          const entry: EntryData = {
            kind: "pi.compaction",
            firstKept: String(d.firstKept),
            summary: String(d.summary),
            reason: (t.input.reason as "manual" | "threshold") ?? "threshold",
          };
          if (t.owner)
            tx.append(conv, entry, taskId); // blocking: the generation waits for it
          else submit(tx, reg, conv, { type: "write", write: entry, requestId: `compaction:${taskId}` }); // placed at the next boundary
          return settle({ status: "completed" });
        }

        // ── shop.checkout ──
        case "checkout.pay": {
          const payments = (t.input.cards as string[]).map((card) =>
            createTask(tx, reg, { conversationId: conv, kind: "shop.payment", input: { card }, owner: taskId, label: `payment ${card}` }),
          );
          return tx.putTask({
            ...t,
            state: {
              status: "waiting",
              checkpoint: { phase: "decide", payments },
              on: payments,
              policy: (d.policy as "failFast") ?? "failFast",
            },
          });
        }

        // ── app.reminder ──
        case "reminder.deliver":
          submit(tx, reg, conv, {
            text: `Reminder: ${t.input.text}`,
            author: "reminder",
            requestId: `reminder:${taskId}`,
            whenBusy: "followUp",
          });
          return settle({ status: "completed" });

        default:
          throw new Error(`durable: unknown commit ${name}`);
      }
    });
    if (task.kind === "pi.tool") this.#cue(`commit.${name}.${task.label}`);
  }

  /** A terminal outcome, held as `completing` while the work the task owns is still live. */
  #settle(tx: Tx, t: TaskRecord, outcome: Outcome): void {
    const owned = ownedWork(tx.tasks(), tx.conversations(), t.id);
    const { memos: _, ...rest } = tx.task(t.id)!;
    tx.putTask({ ...rest, state: { status: owned.length ? "completing" : "terminal", outcome } });
  }

  #cleanup(tx: Tx, t: TaskRecord): void {
    if (t.kind !== "pi.compaction") return;
    const l = tx.doc(LiveDocDef, t.conversationId);
    l.compactions = (l.compactions ?? []).filter((c) => c.taskId !== t.id);
  }

  #convertPartial(tx: Tx, t: TaskRecord): void {
    const l = tx.doc(LiveDocDef, t.conversationId);
    const partial = l.generation?.taskId === t.id ? l.generation.message : undefined;
    if (!partial) return;
    tx.append(
      t.conversationId,
      {
        kind: "pi.assistant",
        text: partial,
        toolCalls: [],
        stopReason: "aborted",
        model: this.#agent(t.conversationId).model ?? "sim-sol",
      },
      t.id,
    );
    delete l.generation!.message;
  }

  #slot(
    tx: Tx,
    t: TaskRecord,
    change: Partial<{ status: "pending" | "running" | "done"; output: string; details: Record<string, unknown> }>,
  ): void {
    const l = tx.doc(LiveDocDef, t.conversationId);
    const slot = l.tools?.find((s) => s.callId === t.input.callId);
    if (slot) Object.assign(slot, change);
  }

  #toolResult(tx: Tx, t: TaskRecord, text: string, isError: boolean, code?: ToolErrorCode): EntryRecord {
    this.#slot(tx, t, { status: "done" });
    return tx.append(
      t.conversationId,
      { kind: "pi.tool-result", callId: String(t.input.callId), name: String(t.input.name), text, isError, ...(code ? { code } : {}) },
      t.id,
    );
  }

  #usage(tx: Tx, conv: string, out: string): void {
    const u = tx.doc(UsageDocDef, conv);
    u.requests++;
    u.outputTokens += Math.ceil(out.length / 4);
    u.inputTokens += this.#context(conv).tokens;
  }

  /** The system prompt is rebuilt before every request; only a change is recorded, where it happened. */
  #appendSystem(tx: Tx, conv: string): void {
    const transcript = tx.transcript(conv);
    const head = lastIndex(transcript, (e) => e.data.kind === "pi.compaction" || e.data.kind === "pi.reset");
    const shown: Record<string, string> = {};
    let tools = new Set<string>();
    for (const e of transcript.slice(head + 1)) {
      if (e.data.kind !== "pi.system") continue;
      for (const [k, v] of Object.entries(e.data.sections)) {
        if (v === null) delete shown[k];
        else shown[k] = v;
      }
      for (const n of e.data.toolsRemoved) tools.delete(n);
      for (const n of e.data.toolsAdded) tools.add(n);
    }
    const { sections, toolNames } = this.#prompt(conv);
    const changed: Record<string, string | null> = {};
    for (const [k, v] of Object.entries(sections)) if (shown[k] !== v) changed[k] = v;
    for (const k of Object.keys(shown)) if (!(k in sections)) changed[k] = null;
    const added = toolNames.filter((n) => !tools.has(n));
    const removed = [...tools].filter((n) => !toolNames.includes(n));
    tools = new Set(toolNames);
    if (Object.keys(changed).length || added.length || removed.length)
      tx.append(conv, { kind: "pi.system", sections: changed, toolsAdded: added, toolsRemoved: removed });
  }

  #agent(conv: string): AgentState {
    return this.#o.storage.doc(AgentDoc, conv);
  }

  /** The sections and tools a request offers, rendered now from the conversation's extensions. */
  #prompt(conv: string): { sections: Record<string, string>; toolNames: string[]; tools: ToolDef[] } {
    const agent = this.#agent(conv);
    const r = this.#o.registry.resolve(agent, this.#o.settings.extensions);
    const env = this.#o.machine.env(agent.cwd);
    const sections: Record<string, string> = {};
    for (const s of r.sections) {
      const v = s.render({ conversationId: conv, env, read: (def) => this.#o.storage.doc(def as typeof Todos, conv) as never });
      if (v !== undefined) sections[s.key] = v;
    }
    if (agent.instructions) sections.instructions = agent.instructions;
    return { sections, toolNames: r.tools.map((t) => t.name), tools: r.tools };
  }

  /** The active context: what the next request sends, and how many tokens that is. */
  #context(conv: string): { messages: Msg[]; summary?: string; handoff?: string; tokens: number; entries: EntryRecord[] } {
    const ctx = activeContext(this.#o.storage.transcript(conv));
    const messages: Msg[] = [];
    for (const e of ctx.entries) {
      const d = e.data;
      if (d.kind === "pi.user") messages.push({ role: "user", text: d.text, author: d.author });
      else if (d.kind === "pi.assistant") messages.push({ role: "assistant", text: d.text, toolCalls: d.toolCalls });
      else if (d.kind === "pi.tool-result")
        messages.push({ role: "tool", name: d.name, text: d.text, isError: d.isError, ...(d.code ? { code: d.code } : {}) });
    }
    const tokens = ctx.entries.reduce((n, e) => n + e.tokens, 0) + Math.ceil((ctx.summary ?? ctx.handoff ?? "").length / 4);
    return {
      messages,
      tokens,
      entries: ctx.entries,
      ...(ctx.summary ? { summary: ctx.summary } : {}),
      ...(ctx.handoff ? { handoff: ctx.handoff } : {}),
    };
  }

  /** Where a compaction would cut: keep about keepRecentTokens, at a user message. */
  #selectCut(conv: string): string | null {
    const { entries } = this.#context(conv);
    let kept = 0;
    let at = entries.length;
    while (at > 0 && kept < this.#o.settings.compaction.keepRecentTokens) kept += entries[--at]!.tokens;
    while (at < entries.length && entries[at]!.data.kind !== "pi.user") at++;
    return at > 0 && at < entries.length ? entries[at]!.id : null;
  }

  // ── invokers: what a phase does that isn't a commit ────────────────────────

  #invokers(taskId: string): Record<string, Invoker> {
    const task = () => this.#o.storage.tasks.get(taskId)!;
    const conv = () => task().conversationId;
    const { clock } = this.#o;
    const later =
      (ms: number, fn: () => unknown): Invoker =>
      (ctx) => {
        const h = clock.setTimeout(() => !this.dead && ctx.done(fn()), ms);
        return { send() {}, cancel: () => clock.clearTimeout(h) };
      };
    const async =
      (run: (ctx: InvokeContext, signal: AbortSignal) => Promise<unknown>): Invoker =>
      (ctx): InvokedService => {
        const abort = new AbortController();
        const signal = AbortSignal.any([abort.signal, this.#life.signal]);
        run(ctx, signal).then(
          (v) => signal.aborted || ctx.done(v),
          (err: unknown) => signal.aborted || ctx.done({ ok: false, error: err instanceof Error ? err.message : String(err) }),
        );
        return { send() {}, cancel: () => abort.abort() };
      };

    return {
      prepare: later(150, () => {
        const c = conv();
        const { contextWindow, reserveTokens, backgroundTokens } = this.#o.settings.compaction;
        const { tokens } = this.#context(c);
        const cut = this.#selectCut(c) !== null;
        const blocking = cut && tokens > contextWindow - reserveTokens;
        const live = this.#o.storage.doc(LiveDocDef, c);
        const background = cut && !blocking && tokens > contextWindow - reserveTokens - backgroundTokens && !live.compactions?.length;
        return { tokens, contextWindow, blocking, background };
      }),

      model: async(async (ctx, signal) => {
        const t = task();
        const c = t.conversationId;
        const agent = this.#agent(c);
        const model = agent.model ?? "sim-sol";
        if (t.kind === "pi.compaction") {
          const { entries } = this.#context(c);
          const cut = entries.findIndex((e) => e.id === ctx.params.firstKept);
          const older = this.#context(c).messages.slice(0, Math.max(0, cut));
          return this.#o.model
            .stream({ model, mode: "summary", sections: {}, messages: older, tools: [] }, () => {}, signal)
            .then((r) => ({ ok: true, text: r.text }));
        }
        const { messages, summary, handoff } = this.#context(c);
        const { sections, toolNames } = this.#prompt(c);
        let last = -Infinity;
        try {
          const r = await this.#o.model.stream(
            {
              model,
              mode: "chat",
              sections,
              messages,
              tools: toolNames,
              ...(agent.instructions ? { instructions: agent.instructions } : {}),
              ...(summary ? { summary } : {}),
              ...(handoff ? { handoff } : {}),
            },
            (text) => {
              // partials are committed (throttled): a crash leaves them in storage
              if (clock.now() - last < STREAM_COMMIT_MS) return;
              last = clock.now();
              this.#taskCommit(taskId, "generation.stream", { text });
            },
            signal,
          );
          return { ok: true, text: r.text, toolCalls: r.toolCalls };
        } catch (err) {
          if (err instanceof ModelError) return { ok: false, retryable: err.retryable, error: err.message };
          throw err;
        }
      }),

      "resolve-tool": later(120, () => {
        const t = task();
        const { tools } = this.#prompt(t.conversationId);
        const tool = tools.find((x) => x.name === t.input.name);
        if (!tool) return { found: false };
        this.#tools.set(taskId, tool);
        return { found: true, replay: tool.replay ?? "unsafe", from: tool.from, wrappedBy: tool.wrappedBy ?? [] };
      }),

      hooks: async(async (ctx, signal) => {
        const t = task();
        const r = this.#o.registry.resolve(this.#agent(t.conversationId), this.#o.settings.extensions);
        const api = this.#hookApi(t, signal);
        const call = { name: String(t.input.name), args: ctx.params.args as Record<string, unknown> };
        if (ctx.params.point === "beforeTool") {
          for (const { extension, hooks } of r.hooks) {
            if (!hooks.beforeTool) continue;
            this.#cue(`hook.beforeTool.${extension}`);
            try {
              const out = await hooks.beforeTool(call, api);
              if (out && "block" in out) return { block: out.block };
              if (out && "args" in out) call.args = out.args;
            } catch (err) {
              // a throwing beforeTool blocks the call
              return { block: err instanceof Error ? err.message : String(err) };
            }
          }
          return { args: call.args };
        }
        let result = ctx.params.result as ToolResult;
        for (const { hooks } of r.hooks) {
          if (!hooks.afterTool) continue;
          try {
            result = (await hooks.afterTool(call, result, api)) ?? result;
          } catch {
            // reported; the chain continues
          }
        }
        return { result };
      }),

      tool: async(async (ctx, signal) => {
        const t = task();
        const tool = this.#tools.get(taskId) ?? this.#prompt(t.conversationId).tools.find((x) => x.name === t.input.name);
        if (!tool) return { ok: false, error: `no tool ${t.input.name}` };
        try {
          const result = await tool.execute(ctx.params.args as Record<string, unknown>, this.#toolApi(t, signal));
          return { ok: true, result };
        } catch (err) {
          if (signal.aborted) throw err;
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }),

      bank: async((ctx, signal) => {
        const { bank } = this.#o;
        return ctx.params.op === "refund"
          ? bank.refund(String(ctx.params.key), signal)
          : bank.charge(String(ctx.params.card), String(ctx.params.key), signal);
      }),

      // runtime.outcomes(ids)
      outcomes: (ctx) => {
        const h = clock.setTimeout(() => !this.dead && ctx.done(outcomesOf(this.#o.storage, ctx.params.ids as string[])), 100);
        return { send() {}, cancel: () => clock.clearTimeout(h) };
      },

      "compaction-select": later(150, () => ({ firstKept: this.#selectCut(conv()) })),
    };
  }

  #memo<T>(taskId: string, name: string, value?: T): T | undefined {
    const t = this.#o.storage.tasks.get(taskId);
    const stored = t?.memos?.[name] as T | undefined;
    if (stored !== undefined || value === undefined || !t || !isLive(t)) return stored;
    // the first write wins
    this.#tx(taskId, `memo ${name}`, (tx) => {
      const cur = tx.task(taskId)!;
      tx.putTask({ ...cur, memos: { ...(cur.memos ?? {}), [name]: value } });
    });
    this.#cue(`memo.${name}`);
    return value;
  }

  #hookApi(t: TaskRecord, signal: AbortSignal): HookApi {
    return {
      taskId: t.id,
      conversationId: t.conversationId,
      signal,
      memo: (name, value) => this.#memo(t.id, name, value),
      ask: (question) =>
        new Promise((resolve, reject) => {
          this.approvals.set(t.id, { taskId: t.id, conversationId: t.conversationId, question, resolve });
          signal.addEventListener("abort", () => {
            this.approvals.delete(t.id);
            reject(new Error("aborted"));
          });
          this.#cue("approval.asked");
          this.#changed();
        }),
      sleep: (ms) =>
        new Promise((resolve, reject) => {
          const h = this.#o.clock.setTimeout(resolve, ms);
          signal.addEventListener("abort", () => {
            this.#o.clock.clearTimeout(h);
            reject(new Error("aborted"));
          });
        }),
    };
  }

  /** A person answers a hook's question. */
  approve(taskId: string, ok: boolean): void {
    const a = this.approvals.get(taskId);
    if (!a) return;
    this.approvals.delete(taskId);
    a.resolve(ok);
    this.#changed();
  }

  #toolApi(t: TaskRecord, signal: AbortSignal): ToolApi {
    const { clock, storage, registry } = this.#o;
    const agent = this.#agent(t.conversationId);
    return {
      taskId: t.id,
      conversationId: t.conversationId,
      callId: String(t.input.callId),
      env: this.#o.machine.env(agent.cwd),
      signal,
      output: (text) => {
        if (signal.aborted) return;
        this.#tx(t.id, "tool.output", (tx) => {
          const slot = tx.doc(LiveDocDef, t.conversationId).tools?.find((s) => s.callId === t.input.callId);
          if (slot) slot.output = (slot.output ?? "") + text;
        });
      },
      details: (details) => {
        if (signal.aborted) return;
        this.#tx(t.id, "tool.details", (tx) => {
          const slot = tx.doc(LiveDocDef, t.conversationId).tools?.find((s) => s.callId === t.input.callId);
          if (slot) slot.details = { ...(slot.details ?? {}), ...details };
        });
      },
      commit: (name, fn) => this.#tx(t.id, name, fn),
      memo: (name, value) => this.#memo(t.id, name, value),
      createTask: (kind, input, o) =>
        this.#tx(t.id, "createTask", (tx) =>
          createTask(tx, registry, {
            conversationId: t.conversationId,
            kind,
            input,
            label: o.label,
            ...(o.ownership.kind === "task" ? { owner: o.ownership.taskId } : {}),
            ...(o.background ? { background: true } : {}),
          }),
        ),
      waitForTask: (id) =>
        this.#waitFor(
          this.#taskWaiters,
          id,
          () => storage.tasks.get(id),
          (x) => x.state.status === "terminal",
          signal,
        ),
      submit: (conversationId, draft) => this.submit(conversationId, draft, t.id).id,
      waitForSubmission: (id) =>
        this.#waitFor(
          this.#submissionWaiters,
          id,
          () => storage.submissions.get(id),
          (s) => s.status === "done" || s.status === "unanswered",
          signal,
        ),
      sleep: (ms) =>
        new Promise((resolve, reject) => {
          const h = clock.setTimeout(resolve, ms);
          signal.addEventListener("abort", () => {
            clock.clearTimeout(h);
            reject(new Error("aborted"));
          });
        }),
      now: () => clock.now(),
      answerText: (id) => {
        const d = storage.entries.get(id)?.data;
        return d?.kind === "pi.assistant" ? d.text : "";
      },
      allEntries: () => storage.transcript(t.conversationId).map((e) => ({ id: e.id, text: entryText(e.data) })),
    };
  }

  #waitFor<T>(
    waiters: Map<string, ((x: T) => void)[]>,
    id: string,
    get: () => T | undefined,
    done: (x: T) => boolean,
    signal: AbortSignal,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const now = get();
      if (now && done(now)) return resolve(now);
      waiters.set(id, [...(waiters.get(id) ?? []), resolve]);
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  }

  // ── the scheduler ──────────────────────────────────────────────────────────

  #onCommit(): void {
    if (this.dead) return;
    const { storage } = this.#o;
    for (const [id, fns] of this.#taskWaiters) {
      const t = storage.tasks.get(id);
      if (t?.state.status !== "terminal") continue;
      this.#taskWaiters.delete(id);
      for (const f of fns) f(t);
    }
    for (const [id, fns] of this.#submissionWaiters) {
      const s = storage.submissions.get(id);
      if (s?.status !== "done" && s?.status !== "unanswered") continue;
      this.#submissionWaiters.delete(id);
      for (const f of fns) f(s);
    }
    for (const w of this.#watchers) {
      const next = this.view(w.conversationId);
      const ops = diffView(w.last, next);
      w.last = next;
      if (ops.length) w.send(ops, next.seq);
    }
    this.#schedulePump();
    this.#changed();
  }

  #schedulePump(): void {
    if (this.#pumpQueued || this.dead) return;
    this.#pumpQueued = true;
    this.#o.clock.setTimeout(() => {
      this.#pumpQueued = false;
      this.#pump();
    }, 0);
  }

  #pump(): void {
    if (this.dead || this.scheduling !== "running") return;
    const { storage, registry } = this.#o;
    for (let round = 0; round < 50; round++) {
      let changed = false;
      const tasks = [...storage.tasks.values()];
      const convs = [...storage.conversations.values()];
      const byId = new Map(tasks.map((t) => [t.id, t]));
      const held = (t: TaskRecord | undefined) =>
        t && (t.state.status === "terminal" || t.state.status === "completing") ? t.state.outcome : undefined;

      // 1. cancellation flows down: an abort mark, a held failure, or a failFast join marks owned work
      const tx = new Tx(storage, "harness", "harness.cascade");
      for (const t of tasks) {
        if (!isLive(t)) continue;
        const intent = t.abortRequested || (t.state.status === "completing" && t.state.outcome.status !== "completed");
        if (intent) {
          for (const c of tasks)
            if (c.owner === t.id && isLive(c) && !c.abortRequested && c.state.status !== "completing")
              tx.putTask({ ...c, abortRequested: true });
          for (const c of convs) if (c.owner?.taskId === t.id) abortConversation(tx, c.id);
        }
        if (
          t.state.status === "waiting" &&
          t.state.policy === "failFast" &&
          t.state.on.some((id) => (held(byId.get(id))?.status ?? "completed") !== "completed")
        )
          for (const id of t.state.on) {
            const o = byId.get(id);
            if (o && isLive(o) && !o.abortRequested && o.state.status !== "completing") tx.putTask({ ...o, abortRequested: true });
          }
      }
      if (tx.commit()) {
        changed = true;
        this.#cue("commit.harness.cascade");
        continue;
      }

      for (const t of tasks) {
        const owned = () => ownedWork(tasks, convs, t.id);
        const s = t.state;
        // 2. a held outcome becomes final once the owned work is done
        if (s.status === "completing" && owned().length === 0) {
          storage.commit("harness", "harness.finish", [
            { type: "task", record: { ...t, state: { status: "terminal", outcome: s.outcome } } },
          ]);
          changed = true;
          continue;
        }
        if (s.status === "terminal") {
          if (this.sessions.has(t.id) && !this.#sent.terminal.has(t.id)) {
            this.#sent.terminal.add(t.id);
            this.#deliver(t.id, "task.terminal", { outcome: s.outcome });
          }
          continue;
        }
        if (s.status === "completing") continue;
        // 3. a marked task: tell it, and once its owned work has ended, let its abort handler run
        if (t.abortRequested) {
          if (!this.#sent.abort.has(t.id)) {
            this.#sent.abort.add(t.id);
            this.#deliver(t.id, "task.abort", undefined, true);
          }
          if (owned().length === 0 && !this.#sent.drained.has(t.id)) {
            this.#sent.drained.add(t.id);
            this.#deliver(t.id, "task.drained", undefined, true);
          }
          continue;
        }
        if (!registry.task(t.kind)) continue; // blocked: missing_task, until an extension brings it
        // 4. wake a waiting task once everything it waits on is terminal
        if (s.status === "waiting") {
          if (s.on.every((id) => byId.get(id)?.state.status === "terminal")) {
            storage.commit("harness", "harness.wake", [
              { type: "task", record: { ...t, state: { status: "running", checkpoint: s.checkpoint } } },
            ]);
            this.#deliver(t.id, "task.wake", { checkpoint: s.checkpoint }, true);
            changed = true;
          } else if (!this.sessions.has(t.id)) void this.#ensureSession(t.id);
          continue;
        }
        // 5. reserve a pending task: one invocation, from its checkpoint
        if (s.status === "pending") {
          storage.commit("harness", "harness.reserve", [
            { type: "task", record: { ...t, state: { status: "running", checkpoint: s.checkpoint } } },
          ]);
          void this.#ensureSession(t.id);
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  #deliver(taskId: string, event: string, data?: unknown, start = false): void {
    const ready = this.sessions.has(taskId) || this.#starting.has(taskId) || start ? this.#ensureSession(taskId) : null;
    void ready?.then((s) => {
      if (s && !this.dead) s.send(event, data);
    });
  }

  #ensureSession(taskId: string): Promise<SCXMLSession | null> {
    const existing = this.sessions.get(taskId);
    if (existing) return Promise.resolve(existing);
    const starting = this.#starting.get(taskId);
    if (starting) return starting;
    const { storage, registry, charts, clock, engine, domParser } = this.#o;
    const t = storage.tasks.get(taskId)!;
    const def = registry.task(t.kind);
    const source = def && charts[def.chart];
    if (!source) return Promise.resolve(null);
    const p = engine(named(source, `${t.kind} · ${t.id} ${t.label}`), {
      clock,
      ...(domParser ? { domParser } : {}),
      ioprocessors: [this.#processor],
      invokers: this.#invokers(taskId),
      data: { task: structuredClone(t), now: clock.now() },
    }).then((session) => {
      this.#starting.delete(taskId);
      if (this.dead) {
        session.dispose();
        return null;
      }
      this.sessions.set(taskId, session);
      this.#taskOf.set(session.sessionId, taskId);
      const kind = t.kind;
      const tool = kind === "pi.tool" ? String(t.input.name) : null;
      session.addEventListener("microstep", (e) => {
        for (const st of e.entered) {
          this.#cue(`${kind}.${st.id}`);
          if (tool) this.#cue(`tool.${tool}.${st.id}`);
        }
      });
      session.addEventListener("macrostep", () => this.#changed());
      session.start();
      this.dispatchEvent(new CustomEvent("session", { detail: taskId }));
      return session;
    });
    this.#starting.set(taskId, p);
    return p;
  }

  // ── conversations: what clients and tools call ─────────────────────────────

  /** The root conversation: created on first use, the same one after every restart. */
  root(agent?: AgentState): string {
    const root = this.#o.storage.conversations.get("c1");
    if (root) return root.id;
    return this.#tx("harness", "root", (tx) =>
      createConversation(tx, { title: "root", ownership: { kind: "ownerless" }, ...(agent ? { agent } : {}) }),
    );
  }

  createConversation(title: string, agent?: AgentState): string {
    return this.#tx("harness", "createConversation", (tx) =>
      createConversation(tx, { title, ownership: { kind: "ownerless" }, ...(agent ? { agent } : {}) }),
    );
  }

  /** Admission: resolves (here: returns) once the submission is durable, not when it is answered. */
  submit(conversationId: string, draft: Draft, by = "client"): { id: string; duplicate: boolean } {
    const r = this.#tx(by, "submit", (tx) => submit(tx, this.#o.registry, conversationId, draft));
    this.#cue(r.duplicate ? "submit.duplicate" : "submit.admitted");
    return r;
  }

  /** Esc: withdraw queued inputs, abort the current work (and what it owns). */
  abort(conversationId: string, opts: { background?: boolean } = {}): void {
    this.#tx("client", "abort", (tx) => abortConversation(tx, conversationId, opts));
  }

  abortTask(taskId: string): void {
    this.#tx("client", "abortTask", (tx) => {
      const t = tx.task(taskId);
      if (t && isLive(t)) tx.putTask({ ...t, abortRequested: true });
    });
  }

  /** Manual compaction: foreground, owned by the conversation; the summary is placed at the next boundary. */
  compact(conversationId: string, instructions?: string): string {
    return this.#tx("client", "compact", (tx) => {
      const id = createTask(tx, this.#o.registry, {
        conversationId,
        kind: "pi.compaction",
        input: { reason: "manual", blocking: false, ...(instructions ? { instructions } : {}) },
        label: "manual compaction",
      });
      const l = tx.doc(LiveDocDef, conversationId);
      l.compactions = [...(l.compactions ?? []), { taskId: id, reason: "manual", blocking: false }];
      return id;
    });
  }

  /** A fork sees the parent's history through `at` without copying it. */
  fork(conversationId: string, at: string, o: { title: string; agent?: AgentState }): string {
    return this.#tx("client", "fork", (tx) =>
      createConversation(tx, {
        title: o.title,
        ownership: { kind: "ownerless" },
        fork: { conversationId, at },
        ...(o.agent ? { agent: o.agent } : {}),
      }),
    );
  }

  configure(conversationId: string, change: Parameters<typeof configure>[2]): void {
    this.#tx("client", "configure", (tx) => configure(tx, conversationId, change));
  }

  /** `viewState()`: the current view first; `watch` sends only what each commit changed. */
  view(conversationId: string): ConversationView {
    const { storage } = this.#o;
    const conversation = storage.conversations.get(conversationId)!;
    const transcript = storage.transcript(conversationId);
    const { headIndex } = activeContext(transcript);
    const own = new Set(storage.order.get(conversationId) ?? []);
    return {
      seq: storage.seq,
      conversation,
      entries: transcript.map((e, i) => ({ ...e, active: i >= headIndex, inherited: !own.has(e.id) })),
      docs: {
        agent: storage.doc(AgentDoc, conversationId),
        live: storage.doc(LiveDocDef, conversationId),
        inbox: storage.doc(InboxDocDef, conversationId),
        usage: storage.doc(UsageDocDef, conversationId),
        todos: storage.doc(Todos, conversationId),
      },
      submissions: [...storage.submissions.values()].filter((s) => s.conversationId === conversationId),
    };
  }

  watch(conversationId: string, send: (ops: ViewOp[], seq: number) => void): { view: ConversationView; stop(): void } {
    const w = { conversationId, last: this.view(conversationId), send };
    this.#watchers.add(w);
    return { view: w.last, stop: () => this.#watchers.delete(w) };
  }

  // ── for the page ───────────────────────────────────────────────────────────

  #cue(name: string): void {
    this.dispatchEvent(new CustomEvent("cue", { detail: name }));
  }
  #changed(): void {
    this.dispatchEvent(new Event("change"));
  }
}

function outcomesOf(storage: Storage, ids: string[]): Outcome[] {
  return ids.map((id) => {
    const s = storage.tasks.get(id)?.state;
    return s && (s.status === "terminal" || s.status === "completing")
      ? s.outcome
      : { status: "failed", error: { message: `${id} is not done` } };
  });
}

/** Give each session its own name in the explorer. */
function named(source: string, name: string): string {
  return source.replace(/(<scxml\b[^>]*\bname=")[^"]*(")/, `$1${name.replace(/[<>&"]/g, "")}$2`);
}

function lastIndex<T>(list: T[], f: (x: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) if (f(list[i]!)) return i;
  return -1;
}

export function diffView(a: ConversationView, b: ConversationView): ViewOp[] {
  const ops: ViewOp[] = [];
  const known = new Set(a.entries.map((e) => e.id));
  for (const e of b.entries) if (!known.has(e.id)) ops.push({ op: "entry", entry: e });
  const headA = a.entries.find((e) => e.active)?.id ?? null;
  const headB = b.entries.find((e) => e.active)?.id ?? null;
  if (headA !== headB) ops.push({ op: "head", first: headB });
  for (const name of Object.keys(b.docs) as (keyof ConversationView["docs"])[])
    if (JSON.stringify(a.docs[name]) !== JSON.stringify(b.docs[name])) ops.push({ op: "doc", name, value: b.docs[name] });
  const subs = new Map(a.submissions.map((s) => [s.id, JSON.stringify(s)]));
  for (const s of b.submissions) if (subs.get(s.id) !== JSON.stringify(s)) ops.push({ op: "submission", record: s });
  return ops;
}

export { ConversationBusy };

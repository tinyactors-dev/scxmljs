/**
 * The registry: the extensions a process installed. It is code, so it lives in the process,
 * not in storage; conversations store only extension and tool names (`pi.agent`), and resolve
 * them against whatever the current process installed.
 *
 * Resolution follows Pi Durable (spec "Agent resolution"): the selected extensions in install
 * order; a later tool with the same name replaces an earlier one in place; then every selected
 * extension's wraps decorate whichever tool won; then the agent's tool filter.
 */
import type { Env } from "./env.ts";
import type { Tx } from "./storage.ts";
import type { AgentState, Checkpoint, SubmissionRecord, TaskOwnership, TaskRecord, WhenBusy } from "./types.ts";

export interface ToolResult {
  text: string;
  isError?: boolean;
  /** `{ handoff }` ends the run and starts a new context from the note. */
  control?: { handoff?: string };
}

export interface Approval {
  question: string;
  taskId: string;
  conversationId: string;
}

/** What a tool's `execute` gets: the harness API for its call (`ToolExecutionApi`). */
export interface ToolApi {
  taskId: string;
  conversationId: string;
  callId: string;
  env: Env;
  signal: AbortSignal;
  /** Streamed to every client watching, and stored: an interrupted call reports it. */
  output(text: string): void;
  details(details: Record<string, unknown>): void;
  commit<T>(name: string, fn: (tx: Tx) => T): T;
  memo<T>(name: string, value?: T): T | undefined;
  createTask(kind: string, input: Record<string, unknown>, opts: { ownership: TaskOwnership; background?: boolean; label: string }): string;
  waitForTask(id: string): Promise<TaskRecord>;
  submit(conversationId: string, draft: { text: string; requestId?: string; whenBusy?: WhenBusy; author?: string }): string;
  waitForSubmission(id: string): Promise<SubmissionRecord>;
  sleep(ms: number): Promise<void>;
  now(): number;
  /** The text of an assistant entry (a subagent's answer). */
  answerText(entryId: string): string;
  /** Every entry of this conversation, including those before a compaction or handoff. */
  allEntries(): { id: string; text: string }[];
}

export interface HookApi {
  taskId: string;
  conversationId: string;
  signal: AbortSignal;
  memo<T>(name: string, value?: T): T | undefined;
  /** Ask a person (the page shows Approve / Deny). */
  ask(question: string): Promise<boolean>;
  sleep(ms: number): Promise<void>;
}

export interface ToolDef {
  name: string;
  description: string;
  /** "safe": rerun after a crash. Anything else: the model is told the call was interrupted. */
  replay?: "safe" | "unsafe";
  execute(args: Record<string, unknown>, api: ToolApi): Promise<ToolResult>;
  /** Filled in by the registry: which extension (and version) the winning tool came from, and wraps. */
  from?: string;
  wrappedBy?: string[];
}

export interface Hooks {
  /** A chain: rewritten arguments pass down; the first block stops it; a throw blocks the call. */
  beforeTool?(
    call: { name: string; args: Record<string, unknown> },
    api: HookApi,
  ): Promise<undefined | { block: string } | { args: Record<string, unknown> }>;
  /** A chain: each hook gets the previous result. */
  afterTool?(call: { name: string; args: Record<string, unknown> }, result: ToolResult, api: HookApi): Promise<ToolResult | undefined>;
}

export interface SectionInput {
  conversationId: string;
  env: Env;
  read: <T>(def: { kind: string; fork: string; initial(): T }) => T;
}
export interface SectionDef {
  key: string;
  render(input: SectionInput): string | undefined;
}

/** A task definition: its phases are a chart (charts/<chart>.scxml). */
export interface TaskDef {
  name: string;
  version: number;
  chart: string;
  /** The first checkpoint. */
  initial(input: Record<string, unknown>): Checkpoint;
}

export interface Extension {
  name: string;
  version: number;
  blurb: string;
  tools?: ToolDef[];
  sections?: SectionDef[];
  hooks?: Hooks;
  wraps?: { tool: string; wrap(tool: ToolDef): ToolDef }[];
  tasks?: TaskDef[];
}

export interface Resolved {
  extensions: Extension[];
  tools: ToolDef[];
  sections: SectionDef[];
  hooks: { extension: string; hooks: Hooks }[];
}

/** The built-in tasks every harness registers. */
export const BUILTIN_TASKS: TaskDef[] = [
  { name: "pi.generation", version: 1, chart: "generation", initial: () => ({ phase: "prepare", attempt: 1 }) },
  { name: "pi.tool", version: 1, chart: "tool", initial: () => ({ phase: "call" }) },
  { name: "pi.compaction", version: 1, chart: "compaction", initial: () => ({ phase: "select" }) },
];

export class Registry extends EventTarget {
  readonly extensions: Extension[] = [];
  /** Changes, newest last, for the page: "installed ops@2 (replaced ops@1)". */
  readonly changes: string[] = [];

  /** Install, or replace an extension of the same name in place, in one step. */
  install(ext: Extension): void {
    const i = this.extensions.findIndex((e) => e.name === ext.name);
    if (i >= 0) {
      const old = this.extensions[i]!;
      this.extensions[i] = ext;
      this.changes.push(`installed ${ext.name}@${ext.version} (replaced ${old.name}@${old.version})`);
    } else {
      this.extensions.push(ext);
      this.changes.push(`installed ${ext.name}@${ext.version}`);
    }
    this.dispatchEvent(new Event("change"));
  }

  uninstall(name: string): void {
    const i = this.extensions.findIndex((e) => e.name === name);
    if (i < 0) return;
    this.extensions.splice(i, 1);
    this.changes.push(`uninstalled ${name}`);
    this.dispatchEvent(new Event("change"));
  }

  task(kind: string): TaskDef | undefined {
    return BUILTIN_TASKS.find((t) => t.name === kind) ?? this.extensions.flatMap((e) => e.tasks ?? []).find((t) => t.name === kind);
  }

  /**
   * The agent's extensions, tools, sections and hooks, as of now. Without a selection of its
   * own, a conversation gets the harness default (`settings.extensions`), or every extension.
   */
  resolve(agent: AgentState, defaults?: string[]): Resolved {
    const names = agent.extensions ?? defaults;
    const selected = names ? names.flatMap((n) => this.extensions.filter((e) => e.name === n)) : [...this.extensions];
    const tools: ToolDef[] = [];
    for (const ext of selected)
      for (const t of ext.tools ?? []) {
        const tool = { ...t, from: `${ext.name}@${ext.version}`, wrappedBy: [] };
        const at = tools.findIndex((x) => x.name === t.name);
        if (at >= 0) tools[at] = tool;
        else tools.push(tool);
      }
    for (const ext of selected)
      for (const w of ext.wraps ?? []) {
        const at = tools.findIndex((x) => x.name === w.tool);
        if (at < 0) continue;
        const inner = tools[at]!;
        tools[at] = { ...w.wrap(inner), from: inner.from, wrappedBy: [...(inner.wrappedBy ?? []), ext.name] };
      }
    const only = Array.isArray(agent.tools) ? agent.tools : null;
    const removed = new Set(agent.tools && !Array.isArray(agent.tools) ? agent.tools.remove : []);
    return {
      extensions: selected,
      tools: only ? only.flatMap((n) => tools.filter((t) => t.name === n)) : tools.filter((t) => !removed.has(t.name)),
      sections: selected.flatMap((e) => e.sections ?? []),
      hooks: selected.filter((e) => e.hooks).map((e) => ({ extension: e.name, hooks: e.hooks! })),
    };
  }
}

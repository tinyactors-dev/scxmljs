/**
 * A client's tool runtime: the `tool` I/O processor (PROTOCOL.md §5).
 *
 *   run { callId, name, input, real }  →  tool.done { callId, isError, content }  (once)
 *   cancel { callId }                  →  nothing
 *
 * Each tool has a simulated implementation and, optionally, a real one (WebAssembly). The runtime
 * keeps no loading state: whether a client is simulated or real, and how far its downloads are,
 * lives in the charts (client.scxml's `tools` region, workspace.scxml and one package.scxml per
 * package). `mode`, `setMode` and `realState` are views onto them, through `link`.
 * Knobs: latency applies to the simulation only; "fail next call" and "hang" apply in both modes.
 */
import type { Clock, IOProcessor, IOSession, OutboundSend } from "@tinyactors/scxmljs";
import { TOOL, type ToolImpl, type ToolKnobs } from "../protocol.ts";
import type { PackageDownload } from "./packages.ts";

/** How far loading a real tool has come. */
export interface LoadProgress {
  phase: "resolving" | "downloading" | "loading" | "starting" | "ready";
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number | null;
}

export interface ToolEntry {
  simulated: ToolImpl;
  /**
   * The real implementation (WebAssembly), imported on first use. Its packages are installed
   * before it runs: the client chart holds calls until the workspace says they are ready.
   */
  real?: () => Promise<ToolImpl>;
}

export interface RealState {
  status: "idle" | "loading" | "ready" | "failed";
  progress?: LoadProgress;
  /** One entry per package this tool needs, live while loading (see tools/packages.ts). */
  packages?: PackageDownload[];
  error?: string;
}

/** What the runtime shows of the charts (the client's `tools` region, the workspace's packages). */
export interface RuntimeLink {
  mode(): "simulated" | "real";
  /** Ask the client chart to switch (or to retry a failed download). */
  request(mode: "simulated" | "real" | "retry"): void;
  state(tool: string): RealState;
}

export const MAX_OUTPUT = 16 * 1024;

export class ToolRuntime extends EventTarget implements IOProcessor {
  readonly type = TOOL;
  readonly aliases = ["tool"];
  readonly knobs = new Map<string, ToolKnobs>();
  /** Set by the system: the loading state lives in the charts, not here. */
  link: RuntimeLink | null = null;

  #session: IOSession | null = null;
  readonly #running = new Map<string, AbortController>();
  readonly #imported = new Map<string, Promise<ToolImpl>>();

  constructor(
    readonly clock: Clock,
    readonly tools: Record<string, ToolEntry>,
    defaultLatencyMs = 600,
  ) {
    super();
    for (const name of Object.keys(tools)) this.knobs.set(name, { latencyMs: defaultLatencyMs, failNext: false, hang: false });
  }

  get mode(): "simulated" | "real" {
    return this.link?.mode() ?? "simulated";
  }

  /** Whether any tool of this client has a real implementation. */
  get hasReal(): boolean {
    return Object.values(this.tools).some((t) => t.real);
  }

  /** Switch between the simulation and the real tools (the client chart decides; see its `tools` region). */
  setMode(mode: "simulated" | "real"): void {
    const failed = Object.keys(this.tools).some((t) => this.realState(t).status === "failed");
    this.link?.request(mode === "real" && failed ? "retry" : mode);
  }

  realState(name: string): RealState {
    return this.link?.state(name) ?? { status: "idle" };
  }

  /** Charts moved: the page re-reads mode and progress. */
  changed(): void {
    this.dispatchEvent(new Event("change"));
  }

  /** Calls running now, for the panel. */
  get running(): string[] {
    return [...this.#running.keys()];
  }

  location(): string {
    return TOOL;
  }

  attach(session: IOSession): void {
    this.#session = session;
  }

  detach(): void {
    for (const a of this.#running.values()) a.abort();
    this.#running.clear();
    this.#session = null;
  }

  send(message: OutboundSend): void {
    const d = message.data as { callId: string; name?: string; input?: unknown; real?: boolean };
    if (message.event === "run") void this.#run(d.callId, String(d.name), (d.input ?? {}) as Record<string, unknown>, !!d.real);
    else if (message.event === "cancel") this.#running.get(d.callId)?.abort();
    else throw new Error(`tool runtime: unknown message ${message.event}`);
  }

  async #run(callId: string, name: string, input: Record<string, unknown>, real: boolean): Promise<void> {
    const abort = new AbortController();
    this.#running.set(callId, abort);
    const { signal } = abort;
    try {
      const content = await this.invoke(name, input, signal, real);
      if (!signal.aborted) this.#session?.deliver("tool.done", { callId, isError: false, content });
    } catch (err) {
      if (!signal.aborted)
        this.#session?.deliver("tool.done", { callId, isError: true, content: err instanceof Error ? err.message : String(err) });
    } finally {
      this.#running.delete(callId);
    }
  }

  /**
   * Run one tool now with the knobs; resolves with its output or throws. `real` defaults to the
   * current mode; a real tool assumes its packages are installed (the chart makes sure of that).
   */
  async invoke(
    name: string,
    input: Record<string, unknown>,
    signal: AbortSignal = new AbortController().signal,
    real = this.mode === "real",
  ): Promise<string> {
    const knobs = this.knobs.get(name) ?? { latencyMs: 0, failNext: false, hang: false };
    const entry = this.tools[name];
    if (!entry) throw new Error(`no tool ${name}`);
    const useReal = real && entry.real;
    if (!useReal) await sleep(this.clock, knobs.latencyMs, signal);
    if (knobs.hang) await sleep(this.clock, Number.POSITIVE_INFINITY, signal);
    if (knobs.failNext) {
      knobs.failNext = false;
      this.changed();
      throw new Error("failed (“fail next call” was set)");
    }
    const impl = useReal ? await this.#import(name, useReal) : entry.simulated;
    const content = await impl(input, { signal, clock: this.clock });
    return content.length > MAX_OUTPUT
      ? `${content.slice(0, MAX_OUTPUT)}\n… (${content.length - MAX_OUTPUT} more characters cut)`
      : content;
  }

  #import(name: string, load: () => Promise<ToolImpl>): Promise<ToolImpl> {
    let p = this.#imported.get(name);
    if (!p) {
      p = load();
      p.catch(() => this.#imported.delete(name));
      this.#imported.set(name, p);
    }
    return p;
  }
}

/** Wait on the shared clock; rejects when `signal` aborts. `Infinity` waits for the abort. */
export function sleep(clock: Clock, ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const h = Number.isFinite(ms) ? clock.setTimeout(resolve, ms) : null;
    signal.addEventListener(
      "abort",
      () => {
        if (h !== null) clock.clearTimeout(h);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

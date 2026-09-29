/**
 * One tab = one system: the host, its clients, the bus, the log, the models, and optionally a
 * scenario directing it all. Everything schedules on one clock, so a PlaybackClock pauses,
 * steps and slows down the whole system at once.
 *
 * The page builds panels on top of this; the tests drive it directly.
 */
import type { Clock, DOMParserLike, Invoker, IOProcessor, OutboundSend, SCXMLSession, SessionOptions } from "@tinyactors/scxmljs";
import { Bus } from "./bus.ts";
import { CATALOG } from "./catalog.ts";
import { keyCheckInvoker, llmInvoker } from "./llm.ts";
import { ChatLog } from "./log.ts";
import { type ClientId, type ModelSource, PANEL, type Queued, STAGE, type ToolKnobs } from "./protocol.ts";
import { type Fault, faultKind, SimulatedModel } from "./sim-model.ts";
import { initialDownloads, type PackageDownload, type PackageLoader, packageCatalog, TOOL_PACKAGES } from "./tools/packages.ts";
import type { RealState, ToolRuntime as ToolRuntimeType } from "./tools/runtime.ts";
import { ToolRuntime } from "./tools/runtime.ts";
import type { HumanDesk } from "./tools/simulated.ts";
import { ConversationView } from "./view.ts";
import { WorkspaceLink } from "./workspace-link.ts";

/** `createSession` from `@tinyactors/scxmljs` (sandboxed) or `@tinyactors/scxmljs/trusted`. */
export type Engine = (source: string, options: SessionOptions) => Promise<SCXMLSession>;

export interface SystemOptions {
  clock: Clock;
  engine: Engine;
  /** The chart sources. */
  charts: { host: string; client: string; workspace: string; package: string };
  /** Installs WebAssembly packages for the real tools. Default: tools/wasm.ts, loaded on first use. */
  packageLoader?: PackageLoader;
  /** Claude, when the page has loaded it (claude-model.ts). */
  claude?: ModelSource & { check(signal: AbortSignal): Promise<void> };
  domParser?: DOMParserLike;
  system?: string;
}

export interface ClientHandle {
  id: ClientId;
  kind: string;
  name: string;
  session: SCXMLSession;
  runtime: ToolRuntimeType;
  desk?: HumanDesk;
  /** What this client's panel shows, from what the bus delivered to it. */
  view: ConversationView;
  /** What the chart tells its own panel: `restore` (CustomEvent<string>: text for the editor). */
  panel: EventTarget;
}

/** The `panel` processor: a client chart → its own panel on the page. */
/** `wasm-package`: one package.scxml machine's download (params: key); leaving `fetching` cancels it. */
function packageInvoker(load: PackageLoader): Invoker {
  return (ctx) => {
    const abort = new AbortController();
    let cached = false;
    load(String(ctx.params.key), {
      signal: abort.signal,
      onProgress: (d) => {
        cached ||= d.cached;
        if (!abort.signal.aborted)
          ctx.sendToParent("package.progress", {
            phase: d.phase,
            downloadedBytes: d.downloadedBytes,
            totalBytes: d.totalBytes,
            percent: d.percent,
            cached: d.cached,
          });
      },
    }).then(
      () => abort.signal.aborted || ctx.done({ ok: true, cached }),
      (err: unknown) => abort.signal.aborted || ctx.done({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
    return { send() {}, cancel: () => abort.abort() };
  };
}

const realLoader: PackageLoader = (key, options) => import("./tools/wasm.ts").then((m) => m.loadPackage(key, options));

function panelProcessor(target: EventTarget): IOProcessor {
  return {
    type: PANEL,
    aliases: ["panel"],
    location: () => PANEL,
    send: (m: OutboundSend) => {
      if (m.event !== "restore") throw new Error(`panel: unknown message ${m.event}`);
      target.dispatchEvent(new CustomEvent("restore", { detail: String((m.data as { text?: unknown }).text ?? "") }));
    },
  };
}

const SYSTEM_PROMPT = `You are the assistant in a group chat. Several people may write; each message starts with the author's name in brackets.
Tools are provided by other participants and may come and go between turns. When several tool calls are independent, make them in the same response so they run in parallel.
Keep answers short.`;

export class ChatSystem extends EventTarget {
  readonly clock: Clock;
  readonly bus: Bus;
  readonly log: ChatLog;
  readonly sim: SimulatedModel;
  /** The control panel's view, straight from the log. */
  readonly hostView = new ConversationView();
  readonly clients = new Map<ClientId, ClientHandle>();
  host!: SCXMLSession;
  /** The shared WebAssembly workspace (workspace.scxml), with one package.scxml per package. */
  workspace!: SCXMLSession;
  readonly workspaceLink = new WorkspaceLink();
  director: SCXMLSession | null = null;
  /** Captions from scenarios (`note`), newest last. */
  readonly notes: string[] = [];

  readonly #opts: SystemOptions;

  private constructor(opts: SystemOptions) {
    super();
    this.#opts = opts;
    this.clock = opts.clock;
    this.bus = new Bus(opts.clock);
    this.log = new ChatLog(opts.clock, this.bus);
    this.sim = new SimulatedModel(opts.clock);
    this.log.subscribe((e) => this.hostView.append(e));
  }

  static async create(opts: SystemOptions): Promise<ChatSystem> {
    const system = new ChatSystem(opts);
    await system.#startWorkspace();
    await system.#startHost();
    return system;
  }

  async #startWorkspace(): Promise<void> {
    const { engine, charts, clock, domParser } = this.#opts;
    this.workspace = await engine(charts.workspace, {
      clock,
      ...(domParser ? { domParser } : {}),
      ioprocessors: [this.workspaceLink],
      // invoked package.scxml machines get the same invokers and loader
      invokers: { "wasm-package": packageInvoker(this.#opts.packageLoader ?? realLoader) },
      loader: (src) => {
        if (src !== "package.scxml") throw new Error(`workspace: no chart ${src}`);
        return charts.package;
      },
      data: { catalog: packageCatalog() },
    });
    this.workspaceLink.register("workspace", this.workspace);
    this.workspace.addEventListener("macrostep", () => {
      for (const c of this.clients.values()) c.runtime.changed();
    });
    this.workspace.start();
  }

  /** A client's real tools as the page shows them: its `tools` region + the workspace's packages. */
  #realState(c: { id: ClientId; session: SCXMLSession }, tool: string): RealState {
    const s = c.session;
    const status: RealState["status"] = s.isActive("real-loading")
      ? "loading"
      : s.isActive("real-ready")
        ? "ready"
        : s.isActive("real-failed")
          ? "failed"
          : "idle";
    const known = (this.workspace.datamodel.evaluate("packages") ?? {}) as Record<string, Partial<PackageDownload> & { phase?: string }>;
    const firstBy = (this.workspace.datamodel.evaluate("firstBy") ?? {}) as Record<string, string>;
    const keys = ["sdk", ...(TOOL_PACKAGES[tool] ?? [])];
    const packages = initialDownloads(tool).map((base, i): PackageDownload => {
      const key = keys[i]!;
      const p = known[key];
      if (!p || status === "idle") return base;
      const phase = (p.phase ?? "waiting") as PackageDownload["phase"];
      return {
        ...base,
        phase,
        cached: !!p.cached,
        shared: phase === "ready" && !!firstBy[key] && firstBy[key] !== c.id,
        downloadedBytes: p.downloadedBytes ?? 0,
        totalBytes: p.totalBytes ?? null,
        percent: p.percent ?? null,
      };
    });
    // the failed package's own reason (its row already names it)
    const failed = keys.map((k) => known[k]).find((p) => p?.phase === "failed") as { error?: string } | undefined;
    const error = failed?.error ?? s.datamodel.evaluate("toolsError");
    return { status, packages, ...(status === "failed" && error ? { error: String(error) } : {}) };
  }

  async #startHost(): Promise<void> {
    const { engine, charts, clock, domParser, claude } = this.#opts;
    const models: Record<string, ModelSource> = { simulated: this.sim, ...(claude ? { claude } : {}) };
    this.host = await engine(charts.host, {
      clock,
      ...(domParser ? { domParser } : {}),
      ioprocessors: [this.bus, this.log],
      invokers: {
        llm: llmInvoker({ log: this.log, models, system: this.#opts.system ?? SYSTEM_PROMPT }),
        "key-check": keyCheckInvoker((signal) => (claude ? claude.check(signal) : Promise.reject(new Error("Claude isn't loaded")))),
      },
    });
    this.bus.register("host", this.host);
    let last = "";
    this.host.addEventListener("macrostep", () => {
      const configuration = this.host.activeStateIds();
      const key = configuration.join(" ");
      if (key !== last) this.log.state(configuration);
      last = key;
    });
    this.host.addEventListener("microstep", (e) => {
      for (const s of e.entered) this.#cue(`host.enter.${s.id}`);
    });
    this.host.start();
  }

  // ── what a person does on the page ───────────────────────────────────────

  /** Adds a client of that kind (CATALOG); its id is the kind, then kind-2, kind-3, … */
  async addClient(kind: string, name?: string): Promise<ClientHandle> {
    const k = CATALOG[kind];
    if (!k) throw new Error(`unknown client kind ${kind}`);
    let id = kind;
    for (let n = 2; this.clients.has(id); n++) id = `${kind}-${n}`;
    const { engine, charts, clock, domParser } = this.#opts;
    const { tools, desk } = k.implement(clock);
    const runtime = new ToolRuntime(clock, tools, k.latencyMs);
    const panel = new EventTarget();
    // every client runs the same chart; its own name tells them apart in the explorer
    const label = (name ?? k.name).replace(/[<>&"]/g, "");
    const source = charts.client.replace(`name="llm-chat-client"`, `name="llm-chat-client · ${label}"`);
    const session = await engine(source, {
      clock,
      ...(domParser ? { domParser } : {}),
      ioprocessors: [this.bus, runtime, panelProcessor(panel), this.workspaceLink],
      data: { clientId: id, name: name ?? k.name, kind, wants: k.wants, tools: k.tools, needs: needsOf(tools) },
    });
    this.workspaceLink.register(id, session);
    runtime.link = {
      mode: () => (session.isActive("real") ? "real" : "simulated"),
      request: (mode) => this.bus.fromPanel(id, `ui.tools.${mode}`),
      state: (tool) => this.#realState({ id, session }, tool),
    };
    session.addEventListener("macrostep", () => runtime.changed());
    const view = new ConversationView();
    this.bus.register(id, session);
    this.bus.watch(id, (event, data) => view.receive(event, data));
    session.addEventListener("microstep", (e) => {
      for (const s of e.entered) this.#cue(`client.${id}.enter.${s.id}`);
    });
    const handle: ClientHandle = { id, kind, name: name ?? k.name, session, runtime, view, panel, ...(desk ? { desk } : {}) };
    this.clients.set(id, handle);
    session.start();
    this.dispatchEvent(new Event("clients"));
    return handle;
  }

  /** The panel's "leave": the client says bye, then its session is disposed. */
  removeClient(id: ClientId): void {
    const c = this.clients.get(id);
    if (!c) return;
    this.bus.fromPanel(id, "ui.leave");
    // let the bye go out before the session goes away
    this.clock.setTimeout(() => {
      this.bus.unregister(id);
      this.clients.delete(id);
      // let the page drop its panel (and the explorer) before the session goes
      this.dispatchEvent(new Event("clients"));
      c.session.dispose();
    }, this.bus.latencyMs + 1);
  }

  setOnline(id: ClientId, online: boolean): void {
    this.bus.setOnline(id, online);
    this.bus.fromPanel(id, online ? "ui.online" : "ui.offline");
  }

  type(id: ClientId, text: string, steer = false): void {
    this.bus.fromPanel(id, steer ? "ui.steer" : "ui.submit", { text });
  }

  interrupt(id: ClientId): void {
    this.bus.fromPanel(id, "ui.interrupt");
  }

  /** A client's own queue, as its chart holds it. */
  queueOf(id: ClientId): Queued[] {
    const c = this.clients.get(id);
    return c ? ((c.session.datamodel.evaluate("queue") as Queued[] | undefined) ?? []) : [];
  }

  /** Delete a queued message. */
  removeQueued(id: ClientId, queuedId: string): void {
    this.bus.fromPanel(id, "ui.queue.remove", { id: queuedId });
  }

  /** Take a queued message out of the queue and back into the editor (the panel's `restore`). */
  editQueued(id: ClientId, queuedId: string): void {
    this.bus.fromPanel(id, "ui.queue.edit", { id: queuedId });
  }

  /** The control panel: roles.set, mode.*, key.*, input.interrupt. */
  control(event: string, data: unknown = {}): void {
    this.bus.fromControl(event, data);
  }

  // ── scenarios ────────────────────────────────────────────────────────────

  /** Runs a scenario chart; it drives this system through the stage processor. */
  async runScenario(source: string): Promise<SCXMLSession> {
    this.director?.dispose();
    const { engine, clock, domParser } = this.#opts;
    this.director = await engine(source, { clock, ...(domParser ? { domParser } : {}), ioprocessors: [this.#stage()] });
    this.director.start();
    return this.director;
  }

  #cue(event: string): void {
    this.#stageSession?.deliver(event, undefined, "stage");
  }

  #stageSession: { deliver(name: string, data?: unknown, origin?: string): void } | null = null;

  #stage(): IOProcessor {
    return {
      type: STAGE,
      aliases: ["stage"],
      location: () => STAGE,
      attach: (s) => {
        this.#stageSession = s;
      },
      detach: () => {
        this.#stageSession = null;
      },
      send: (m: OutboundSend) => this.#direct(m.event, (m.data ?? {}) as Record<string, unknown>),
    };
  }

  #direct(event: string, d: Record<string, unknown>): void {
    const client = String(d.client ?? "");
    switch (event) {
      case "note":
        this.notes.push(String(d.text));
        this.dispatchEvent(new CustomEvent("note", { detail: String(d.text) }));
        return;
      case "client.add":
        void this.addClient(String(d.kind), d.name === undefined ? undefined : String(d.name));
        return;
      case "client.remove":
        this.removeClient(client);
        return;
      case "client.offline":
        this.setOnline(client, false);
        return;
      case "client.online":
        this.setOnline(client, true);
        return;
      case "type":
        this.type(client, String(d.text), !!d.steer);
        return;
      case "interrupt":
        this.interrupt(client);
        return;
      case "queue.edit":
      case "queue.remove": {
        const item = this.queueOf(client)[Number(d.index ?? 0)];
        if (!item) throw new Error(`stage: ${client} has nothing queued at ${d.index}`);
        if (event === "queue.edit") this.editQueued(client, item.id);
        else this.removeQueued(client, item.id);
        return;
      }
      case "answer":
        this.clients.get(client)?.desk?.answer(String(d.text));
        return;
      case "sim.fault":
        if (!faultKind(String(d.kind))) throw new Error(`stage: unknown fault ${d.kind}`);
        this.sim.fault(d as unknown as Fault);
        return;
      case "sim.tool": {
        const knobs = this.clients.get(client)?.runtime.knobs.get(String(d.tool));
        if (!knobs) throw new Error(`stage: ${client} has no tool ${d.tool}`);
        Object.assign(knobs, pick(d, ["latencyMs", "failNext", "hang"]) as Partial<ToolKnobs>);
        return;
      }
      default:
        throw new Error(`stage: unknown message ${event}`);
    }
  }

  dispose(): void {
    this.director?.dispose();
    this.workspace?.dispose();
    for (const c of this.clients.values()) c.session.dispose();
    this.host.dispose();
  }
}

/** The packages a client's real tools need (none if it has no real tools). */
function needsOf(tools: Record<string, { real?: unknown }>): string[] {
  const keys = Object.entries(tools).flatMap(([name, t]) => (t.real ? (TOOL_PACKAGES[name] ?? []) : []));
  return [...new Set(keys)];
}

function pick(o: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
}

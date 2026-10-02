/**
 * One tab = one world: a storage, the machine and the bank tools talk to, a few clients on other
 * machines, and at most one harness process at a time. Everything schedules on one clock, so a
 * PlaybackClock pauses, steps and slows down the whole world at once.
 *
 *   start()   a new process: Harness.open(storage) → reconcile → resume()
 *   kill()    the process dies; everything in memory is gone, storage is not
 *
 * The page renders this; the tests and the tour (charts/tour/*.scxml, through the `stage`
 * processor) drive it with the same calls.
 */
import type { Clock, DOMParserLike, IOProcessor, OutboundSend, SCXMLSession } from "@tinyactors/scxmljs";
import { ConversationBusy } from "./conversation.ts";
import { Bank, Machine } from "./env.ts";
import { CATALOG, DEPLOYED } from "./extensions.ts";
import { DEFAULT_SETTINGS, type Engine, Harness, type Settings } from "./harness.ts";
import { type Fault, SimModel } from "./model.ts";
import { type Extension, Registry } from "./registry.ts";
import { Storage } from "./storage.ts";
import type { AgentState, WhenBusy } from "./types.ts";
import { Wire } from "./wire.ts";

export const STAGE = "http://tinyactors.dev/pi-durable/stage";

export interface Charts {
  harness: string;
  generation: string;
  tool: string;
  compaction: string;
  checkout: string;
  payment: string;
  reminder: string;
  client: string;
}

export interface SystemOptions {
  clock: Clock;
  engine: Engine;
  charts: Charts;
  domParser?: DOMParserLike;
  settings?: Partial<Settings>;
  /** The root conversation's agent, when the first process creates it. */
  rootAgent?: AgentState;
  /** How long a new process stays paused before resume(), so the page can show it. Default 300 ms. */
  resumeDelayMs?: number;
}

export interface ClientHandle {
  id: string;
  name: string;
  session: SCXMLSession;
}

/** A note from the tour: a caption, and which passage of the post it illustrates. */
export interface Note {
  text: string;
  cite?: string;
  /** Story focus: the side panel this caption is about. */
  panel?: "process" | "storage";
  at: number;
}

export class DurableSystem extends EventTarget {
  readonly clock: Clock;
  readonly storage: Storage;
  readonly machine: Machine;
  readonly bank: Bank;
  readonly model: SimModel;
  readonly wire: Wire;
  readonly clients = new Map<string, ClientHandle>();
  /** The code a new process installs: replacing an extension here is "the file changed on disk". */
  readonly deployed: Extension[] = [...DEPLOYED];
  settings: Settings;
  harness: Harness | null = null;
  processes = 0;
  director: SCXMLSession | null = null;
  readonly notes: Note[] = [];
  /** Processes that died, newest last: what each left running. */
  readonly deaths: { processId: string; at: number; live: number }[] = [];

  readonly #o: SystemOptions;
  readonly #watches = new Map<string, () => void>();

  private constructor(o: SystemOptions) {
    super();
    this.#o = o;
    this.clock = o.clock;
    this.storage = new Storage(o.clock);
    this.machine = new Machine(o.clock);
    this.bank = new Bank(o.clock);
    this.model = new SimModel(o.clock);
    this.wire = new Wire(o.clock);
    this.settings = { ...DEFAULT_SETTINGS, ...o.settings, compaction: { ...DEFAULT_SETTINGS.compaction, ...o.settings?.compaction } };
    this.storage.subscribe((c) => this.dispatchEvent(new CustomEvent("commit", { detail: c })));
  }

  static async create(o: SystemOptions): Promise<DurableSystem> {
    const s = new DurableSystem(o);
    await s.start();
    return s;
  }

  get registry(): Registry | null {
    return this.harness?.registry ?? null;
  }

  // ── processes ──────────────────────────────────────────────────────────────

  /** A new process opens the same storage. */
  async start(): Promise<Harness> {
    if (this.harness && !this.harness.dead) return this.harness;
    const processId = `process ${++this.processes}`;
    const registry = new Registry();
    for (const ext of this.deployed) registry.install(ext);
    registry.changes.length = 0;
    registry.addEventListener("change", () => this.#changed());
    const { engine, charts, clock, domParser } = this.#o;
    const harness = await Harness.open({
      processId,
      storage: this.storage,
      clock,
      engine,
      charts: { ...charts },
      registry,
      model: this.model,
      machine: this.machine,
      bank: this.bank,
      settings: this.settings,
      ...(domParser ? { domParser } : {}),
    });
    this.harness = harness;
    harness.addEventListener("cue", (e) => this.#cue((e as CustomEvent<string>).detail));
    harness.addEventListener("change", () => this.#changed());
    harness.addEventListener("session", (e) =>
      this.dispatchEvent(new CustomEvent("session", { detail: (e as CustomEvent<string>).detail })),
    );
    harness.addEventListener("cue", (e) => {
      if ((e as CustomEvent<string>).detail !== "harness.paused") return;
      // open: the root conversation exists from now on, clients may attach
      harness.root(this.#o.rootAgent);
      this.wire.setServer((client, event, data) => this.#serve(harness, client, event, data));
      clock.setTimeout(() => harness.resume(), this.#o.resumeDelayMs ?? 300);
    });
    this.dispatchEvent(new Event("process"));
    this.#cue("process.started");
    return harness;
  }

  /** The process dies mid-whatever: no outcome is written, nothing is cleaned up. */
  kill(): void {
    const h = this.harness;
    if (!h || h.dead) return;
    this.deaths.push({
      processId: h.processId,
      at: this.clock.now(),
      live: [...this.storage.tasks.values()].filter((t) => t.state.status !== "terminal").length,
    });
    for (const stop of this.#watches.values()) stop();
    this.#watches.clear();
    h.kill();
    this.wire.setServer(null);
    this.dispatchEvent(new Event("process"));
    this.#cue("process.killed");
  }

  get up(): boolean {
    return !!this.harness && !this.harness.dead;
  }

  /** Hot reload: the running process replaces the extension in one step, and so will the next one. */
  install(key: string): void {
    const ext = CATALOG[key];
    if (!ext) throw new Error(`no extension ${key}`);
    const i = this.deployed.findIndex((e) => e.name === ext.name);
    if (i >= 0) this.deployed[i] = ext;
    else this.deployed.push(ext);
    this.harness?.registry.install(ext);
    this.#cue(`installed.${ext.name}`);
  }

  // ── the process side of the wire ───────────────────────────────────────────

  #serve(h: Harness, client: string, event: string, d: Record<string, unknown>): void {
    if (h.dead) return;
    const conv = String(d.conversationId ?? "c1");
    switch (event) {
      case "attach": {
        this.#watches.get(client)?.();
        const w = h.watch(conv, (ops, seq) => this.wire.toClient(client, "ops", { ops, seq }));
        this.#watches.set(client, w.stop);
        this.wire.toClient(client, "view", { view: w.view });
        return;
      }
      case "submit":
        try {
          const r = h.submit(conv, {
            text: String(d.text ?? ""),
            author: String(d.author ?? client),
            whenBusy: (d.whenBusy as WhenBusy) ?? "followUp",
            ...(d.requestId ? { requestId: String(d.requestId) } : {}),
          });
          this.wire.toClient(client, "submitted", { requestId: d.requestId, submissionId: r.id, duplicate: r.duplicate });
        } catch (err) {
          if (!(err instanceof ConversationBusy)) throw err;
          this.wire.toClient(client, "rejected", { requestId: d.requestId, reason: "ConversationBusy" });
          this.#cue("submit.rejected");
        }
        return;
      case "abort":
        h.abort(conv);
        return;
      case "compact":
        h.compact(conv, d.instructions ? String(d.instructions) : undefined);
        return;
      case "fork": {
        const id = h.fork(conv, String(d.at), { title: String(d.title || "fork") });
        this.wire.toClient(client, "forked", { conversationId: id });
        return;
      }
    }
  }

  // ── clients ────────────────────────────────────────────────────────────────

  async addClient(id: string, name: string, conversationId = "c1"): Promise<ClientHandle> {
    const existing = this.clients.get(id);
    if (existing) return existing;
    const { engine, charts, clock, domParser } = this.#o;
    const source = charts.client.replace(`name="client"`, `name="client · ${name.replace(/[<>&"]/g, "")}"`);
    const session = await engine(source, {
      clock,
      ...(domParser ? { domParser } : {}),
      ioprocessors: [this.wire],
      data: { clientId: id, name, conversationId },
    });
    this.wire.register(id, session);
    session.addEventListener("microstep", (e) => {
      for (const s of e.entered) this.#cue(`client.${id}.${s.id}`);
    });
    session.addEventListener("macrostep", () => this.#changed());
    const handle = { id, name, session };
    this.clients.set(id, handle);
    session.start();
    this.dispatchEvent(new Event("clients"));
    return handle;
  }

  removeClient(id: string): void {
    const c = this.clients.get(id);
    if (!c) return;
    this.#watches.get(id)?.();
    this.#watches.delete(id);
    this.clients.delete(id);
    this.dispatchEvent(new Event("clients"));
    c.session.dispose();
  }

  /** What a person types into a client. */
  type(client: string, text: string, o: { whenBusy?: WhenBusy; requestId?: string } = {}): void {
    this.wire.fromPanel(client, "ui.submit", { text, ...o });
  }

  ui(client: string, event: string, data: Record<string, unknown> = {}): void {
    this.wire.fromPanel(client, `ui.${event}`, data);
  }

  /** The conversation a client shows. */
  conversationOf(client: string): string {
    return String(this.clients.get(client)?.session.datamodel.evaluate("conversationId") ?? "c1");
  }

  // ── the tour ───────────────────────────────────────────────────────────────

  async runScenario(source: string): Promise<SCXMLSession> {
    this.director?.dispose();
    const { engine, clock, domParser } = this.#o;
    this.director = await engine(source, { clock, ...(domParser ? { domParser } : {}), ioprocessors: [this.#stage()] });
    this.director.start();
    return this.director;
  }

  #stageSession: { deliver(name: string, data?: unknown, origin?: string): void } | null = null;

  #cue(name: string): void {
    this.#stageSession?.deliver(name, undefined, "stage");
  }

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

  /** "root", "last" (the newest conversation), "subagent" (the newest task-owned one), or an id. */
  conversationRef(ref: unknown): string {
    const r = String(ref ?? "root");
    const all = [...this.storage.conversations.values()];
    if (r === "root") return "c1";
    if (r === "last") return all.at(-1)?.id ?? "c1";
    if (r === "subagent") return all.findLast((c) => c.owner)?.id ?? "c1";
    return r;
  }

  #direct(event: string, d: Record<string, unknown>): void {
    const client = String(d.client ?? "you");
    switch (event) {
      case "note": {
        const note: Note = {
          text: String(d.text),
          at: this.clock.now(),
          ...(d.cite ? { cite: String(d.cite) } : {}),
          ...(d.panel === "process" || d.panel === "storage" ? { panel: d.panel } : {}),
        };
        this.notes.push(note);
        this.dispatchEvent(new CustomEvent("note", { detail: note }));
        return;
      }
      case "kill":
        this.kill();
        return;
      case "start":
        void this.start();
        return;
      case "client.add":
        void this.addClient(client, String(d.name ?? client), this.conversationRef(d.conversation));
        return;
      case "type":
        this.type(client, String(d.text), {
          ...(d.whenBusy ? { whenBusy: d.whenBusy as WhenBusy } : {}),
          ...(d.requestId ? { requestId: String(d.requestId) } : {}),
        });
        return;
      case "switch":
        this.ui(client, "switch", { conversationId: this.conversationRef(d.conversation) });
        return;
      case "abort":
        this.ui(client, "abort");
        return;
      case "compact":
        this.ui(client, "compact", { instructions: d.instructions ?? "" });
        return;
      case "fork": {
        // at: "lastAnswer" / "firstAnswer" = an assistant answer the client can see, or an entry id
        const conv = this.conversationOf(client);
        const answers = this.storage.transcript(conv).filter((e) => e.data.kind === "pi.assistant" && e.data.stopReason === "stop");
        const at =
          d.at === "lastAnswer" || d.at === undefined ? answers.at(-1)?.id : d.at === "firstAnswer" ? answers[0]?.id : String(d.at);
        if (at) this.ui(client, "fork", { at, title: d.title ?? "fork" });
        return;
      }
      case "conversation.create": {
        const id = this.harness?.createConversation(String(d.title ?? "conversation"), d.agent as AgentState | undefined);
        if (id && d.client) this.ui(client, "switch", { conversationId: id });
        return;
      }
      case "bank":
        if (d.latencyMs !== undefined) this.bank.latency.set(String(d.card), Number(d.latencyMs));
        if (d.decline === true) this.bank.declines.add(String(d.card));
        if (d.decline === false) this.bank.declines.delete(String(d.card));
        return;
      case "configure":
        this.harness?.configure(this.conversationRef(d.conversation), d.change as AgentState);
        return;
      case "install":
        this.install(String(d.extension));
        return;
      case "approve": {
        const a = [...(this.harness?.approvals.values() ?? [])][0];
        if (a) this.harness!.approve(a.taskId, d.ok !== false);
        return;
      }
      case "fault":
        this.model.fault(String(d.kind) as Fault);
        return;
      case "abortTask": {
        const t = [...this.storage.tasks.values()].findLast((x) => x.kind === d.kind && x.state.status !== "terminal");
        if (t) this.harness?.abortTask(t.id);
        return;
      }
      case "inspect":
        this.dispatchEvent(
          new CustomEvent("inspect", { detail: { kind: String(d.kind ?? ""), label: d.label ? String(d.label) : undefined } }),
        );
        return;
      default:
        throw new Error(`stage: unknown message ${event}`);
    }
  }

  #changed(): void {
    this.dispatchEvent(new Event("change"));
  }

  dispose(): void {
    this.director?.dispose();
    this.harness?.kill();
    for (const c of this.clients.values()) c.session.dispose();
  }
}

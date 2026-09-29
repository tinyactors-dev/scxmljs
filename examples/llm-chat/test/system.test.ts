import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createSession, VirtualClock } from "@tinyactors/scxmljs";
import { Window } from "happy-dom";
import type { BusRecord } from "../src/bus.ts";
import { ChatSystem } from "../src/system.ts";
import type { PackageDownload, PackageLoader } from "../src/tools/packages.ts";

const chart = (name: string) => readFile(new URL(`../charts/${name}`, import.meta.url), "utf8");
const charts = {
  host: await chart("host.scxml"),
  client: await chart("client.scxml"),
  workspace: await chart("workspace.scxml"),
  package: await chart("package.scxml"),
};

/** A package loader driven by the test: nothing finishes until we say so. */
function fakeLoader() {
  const pending = new Map<string, { resolve: () => void; reject: (e: Error) => void; onProgress?: (d: PackageDownload) => void }>();
  const calls: string[] = [];
  const loader: PackageLoader = (key, { onProgress, signal }) =>
    new Promise<void>((resolve, reject) => {
      calls.push(key);
      pending.set(key, { resolve, reject, ...(onProgress ? { onProgress } : {}) });
      signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
  const progress = (key: string, downloadedBytes: number, totalBytes: number) =>
    pending.get(key)?.onProgress?.({
      id: key,
      label: key,
      approxBytes: totalBytes,
      phase: "downloading",
      cached: false,
      shared: false,
      downloadedBytes,
      totalBytes,
      percent: (downloadedBytes / totalBytes) * 100,
    });
  const finish = (...keys: string[]) => {
    for (const k of keys) pending.get(k)?.resolve();
  };
  const fail = (key: string, message: string) => pending.get(key)?.reject(new Error(message));
  return { loader, calls, progress, finish, fail, loading: (key: string) => pending.has(key) };
}
let packages: ReturnType<typeof fakeLoader>;
const { DOMParser } = new Window();

let system: ChatSystem;
let clock: VirtualClock;
let bus: BusRecord[];
/** What each client's chart handed back to its editor (`restore`). */
let restores: Map<string, string[]>;

async function boot(): Promise<ChatSystem> {
  clock = new VirtualClock();
  packages = fakeLoader();
  system = await ChatSystem.create({ clock, engine: createSession, charts, domParser: new DOMParser(), packageLoader: packages.loader });
  bus = [];
  restores = new Map();
  system.bus.tap((r) => bus.push(r));
  system.addEventListener("clients", () => {
    for (const c of system.clients.values())
      if (!restores.has(c.id)) {
        restores.set(c.id, []);
        c.panel.addEventListener("restore", (e) => restores.get(c.id)!.push((e as CustomEvent<string>).detail));
      }
  });
  await system.addClient("ada");
  return system;
}

afterEach(() => system?.dispose());

const tick = () => new Promise((r) => setImmediate(r));

/** Advance the clock in small steps (letting promises settle) until `done()`. */
async function until(done: () => boolean, what: string, maxMs = 60_000): Promise<void> {
  const end = clock.now() + maxMs;
  await tick();
  while (!done()) {
    if (clock.now() >= end) throw new Error(`timed out waiting for ${what}; host: ${system.host.activeStateIds().join(" ")}`);
    clock.advance(10);
    await tick();
  }
}

const live = (...ids: string[]) => ids.every((id) => system.clients.get(id)?.session.isActive("live"));
const idleAfter = (turn: number) => () => system.host.isActive("idle") && Number(system.host.datamodel.evaluate("turn")) >= turn;
const lastAssistant = () => system.hostView.items.findLast((i) => i.type === "assistant");
const toolCards = () => system.hostView.items.filter((i) => i.type === "tools");

describe("llm-chat", () => {
  test("Ada talks to the simulated model; every view agrees", async () => {
    await boot();
    await system.addClient("viewer");
    await until(() => live("ada", "viewer"), "clients to sync");
    system.type("ada", "hello there");
    await until(idleAfter(1), "the turn to end");
    await until(() => system.clients.get("viewer")!.view.seq === system.log.seq, "the viewer to catch up");

    expect(lastAssistant()).toMatchObject({ status: "committed" });
    expect(system.log.history().map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(system.clients.get("ada")!.view.text()).toBe(system.hostView.text());
    expect(system.clients.get("viewer")!.view.text()).toBe(system.hostView.text());
  });

  test("tool calls to two providers run in parallel", async () => {
    await boot();
    await system.addClient("terminal");
    await system.addClient("python");
    await until(() => live("ada", "terminal", "python"), "clients to sync");
    system.type("ada", "How many files are in the workspace? And use python to compute 2**64.");
    await until(idleAfter(1), "the turn to end");

    const [card] = toolCards();
    expect(card).toMatchObject({
      calls: [
        { name: "shell", provider: "terminal", status: "done" },
        { name: "python", provider: "python", status: "done", content: "18446744073709551616" },
      ],
    });
    expect(system.log.history().map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    // both calls were sent before either answered
    const calls = bus.filter((r) => r.event === "tool.call").map((r) => r.at);
    const firstResult = bus.find((r) => r.event === "tool.result")!.at;
    expect(calls.length).toBe(2);
    expect(Math.max(...calls)).toBeLessThan(firstResult);
  });

  test("scenario: a provider leaves mid-call", async () => {
    await boot();
    await until(() => live("ada"), "Ada to sync");
    const director = await system.runScenario(await chart("scenarios/provider-leaves.scxml"));
    await until(() => director.status === "done", "the scenario to finish");

    expect(toolCards()[0]).toMatchObject({
      calls: [
        { name: "shell", status: "done" },
        { name: "python", status: "failed", content: "Python disconnected before answering." },
      ],
    });
    expect(system.hostView.roster.map((c) => c.id)).toEqual(["ada", "terminal"]);
    expect(system.notes.length).toBe(4);
  });

  test("scenario: queue, steer, stop", async () => {
    await boot();
    await until(() => live("ada"), "Ada to sync");
    const director = await system.runScenario(await chart("scenarios/queue-and-steer.scxml"));
    await until(() => director.status === "done", "the scenario to finish");

    // Bo may not steer
    expect(bus.find((r) => r.event === "input.rejected" && r.to === "bo")?.data).toMatchObject({ reason: "needs the control role" });
    // Ada's steer rode along with the tool results
    expect(system.hostView.items.find((i) => i.type === "user" && i.steer)).toMatchObject({
      author: "Ada",
      text: "Only the markdown files, please.",
    });
    // ...and his refused steer went back into his editor
    expect(restores.get("bo")).toEqual(["Only the markdown files, please."]);
    // the stop dropped Ada's answer; then Bo's queued message went out as its own turn
    const assistants = system.hostView.items.filter((i) => i.type === "assistant").map((i) => i.type === "assistant" && i.status);
    expect(assistants).toContain("discarded");
    expect(assistants.at(-1)).toBe("committed");
    const users = system.hostView.items.filter((i) => i.type === "user" && !i.steer);
    expect(users.at(-1)).toMatchObject({ author: "Bo", text: "Afterwards, also count the lines of the README." });
    expect(system.queueOf("bo")).toEqual([]);
  });

  test("three quick messages: one turn each, the rest wait in the sender's queue", async () => {
    await boot();
    await until(() => live("ada"), "Ada to sync");
    system.type("ada", "one");
    system.type("ada", "two");
    system.type("ada", "three");
    await until(() => system.host.isActive("turn"), "the first turn");
    expect(system.queueOf("ada").map((q) => q.text)).toEqual(["two", "three"]);
    await until(idleAfter(3), "all three turns");
    // never two turns at once: each user message is followed by its own answer
    const roles = system.log.history().map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "user", "assistant", "user", "assistant"]);
    const texts = system.hostView.items.filter((i) => i.type === "user").map((i) => i.type === "user" && i.text);
    expect(texts).toEqual(["one", "two", "three"]);
  });

  test("scenario: three in a row, one edited back into the editor", async () => {
    await boot();
    await until(() => live("ada"), "Ada to sync");
    const director = await system.runScenario(await chart("scenarios/three-in-a-row.scxml"));
    await until(() => director.status === "done", "the scenario to finish");
    expect(restores.get("ada")).toEqual(["And what can you not do?"]);
    expect(Number(system.host.datamodel.evaluate("turn"))).toBe(2);
    expect(system.queueOf("ada")).toEqual([]);
  });

  test("typing before the client has joined is queued, not lost", async () => {
    await boot();
    system.type("ada", "early bird");
    expect(system.clients.get("ada")!.session.isActive("joining")).toBe(true);
    await until(idleAfter(1), "the turn");
    expect(system.hostView.items.find((i) => i.type === "user")).toMatchObject({ text: "early bird" });
  });

  test("deleting a queued message", async () => {
    await boot();
    await until(() => live("ada"), "Ada to sync");
    system.type("ada", "one");
    system.type("ada", "two");
    await until(() => system.queueOf("ada").length === 1, "a queued message");
    system.removeQueued("ada", system.queueOf("ada")[0]!.id);
    await until(() => system.queueOf("ada").length === 0, "the queue to empty");
    await until(idleAfter(1), "the turn");
    clock.advance(5000);
    await tick();
    expect(Number(system.host.datamodel.evaluate("turn"))).toBe(1);
  });

  test("stopping a turn hands the stopper's own queue back to their editor", async () => {
    await boot();
    await until(() => live("ada"), "Ada to sync");
    system.type("ada", "tell me a story");
    system.type("ada", "a second thought");
    system.type("ada", "a third thought");
    await until(() => system.host.isActive("writing"), "the answer to stream");
    system.interrupt("ada");
    await until(() => system.host.isActive("idle"), "the stop");
    clock.advance(2000);
    await tick();
    expect(restores.get("ada")).toEqual(["a second thought\n\na third thought"]);
    expect(system.queueOf("ada")).toEqual([]);
    expect(Number(system.host.datamodel.evaluate("turn"))).toBe(1);
  });

  test("two clients race for the idle host: the loser queues again, both get a turn", async () => {
    await boot();
    await system.addClient("bo");
    await until(() => live("ada", "bo"), "clients to sync");
    system.type("ada", "first");
    await until(() => system.host.isActive("turn"), "the first turn");
    system.type("ada", "from Ada");
    system.type("bo", "from Bo");
    await until(() => system.queueOf("ada").length + system.queueOf("bo").length === 2, "two queued messages");
    await until(idleAfter(3), "both queued messages to get a turn");
    const texts = system.hostView.items.filter((i) => i.type === "user").map((i) => i.type === "user" && i.text);
    expect(texts.slice(1).sort()).toEqual(["from Ada", "from Bo"]);
    expect(bus.some((r) => r.event === "input.rejected" && (r.data as { code: string }).code === "busy")).toBe(true);
  });

  test("a rate limit backs off and retries", async () => {
    await boot();
    await until(() => live("ada"), "Ada to sync");
    system.sim.fault({ kind: "rate_limit", retryAfterMs: 3000 });
    system.type("ada", "hello");
    await until(() => system.host.isActive("backoff"), "the backoff");
    await until(idleAfter(1), "the turn to end");

    expect(lastAssistant()).toMatchObject({ status: "committed" });
    expect(system.hostView.items.filter((i) => i.type === "assistant").map((i) => i.type === "assistant" && i.status)).toEqual([
      "discarded",
      "committed",
    ]);
  });

  test("an offline provider times out, then resyncs", async () => {
    await boot();
    await system.addClient("terminal");
    await until(() => live("ada", "terminal"), "clients to sync");
    system.setOnline("terminal", false);
    system.type("ada", "list the files in the workspace");
    await until(idleAfter(1), "the turn to end", 120_000);

    expect(toolCards()[0]).toMatchObject({ calls: [{ name: "shell", status: "failed", content: "Timed out after 30s." }] });
    system.setOnline("terminal", true);
    await until(() => live("terminal") && system.clients.get("terminal")!.view.seq === system.log.seq, "the terminal to resync");
    expect(system.clients.get("terminal")!.view.text()).toBe(system.hostView.text());
  });

  test("a provider that was offline gets its calls again when it comes back, before the timeout", async () => {
    await boot();
    await system.addClient("terminal");
    await until(() => live("ada", "terminal"), "clients to sync");
    system.setOnline("terminal", false);
    system.type("ada", "list the files in the workspace");
    await until(() => system.host.isActive("tools"), "the tool call");
    const sentAt = clock.now();
    // the call was dropped on the way (offline); the card knows when it times out
    expect(bus.find((r) => r.event === "tool.call")?.dropped).toBe("offline");
    const card = () => toolCards()[0] as Extract<ReturnType<typeof toolCards>[number], { type: "tools" }>;
    await until(() => card()?.deadline !== undefined, "the timer in the log");
    expect(card().deadline! - card().armedAt!).toBe(30_000);
    clock.advance(10_000);
    system.setOnline("terminal", true);
    await until(idleAfter(1), "the turn to end");
    expect(card()).toMatchObject({ calls: [{ name: "shell", status: "done" }] });
    expect(card().calls[0]!.content).toContain("README.md");
    expect(clock.now() - sentAt).toBeLessThan(30_000);
    expect(system.hostView.items.some((i) => i.type === "notice" && i.text.includes("Terminal is back"))).toBe(true);
  });

  test("a result lost while offline is answered again, without running the tool twice", async () => {
    await boot();
    const terminal = await system.addClient("terminal");
    let runs = 0;
    const shell = terminal.runtime.tools.shell!;
    const simulated = shell.simulated;
    shell.simulated = (input, ctx) => {
      runs++;
      return simulated(input, ctx);
    };
    await until(() => live("ada", "terminal"), "clients to sync");
    system.type("ada", "list the files in the workspace");
    await until(() => terminal.session.isActive("working"), "the Terminal to run the call");
    system.setOnline("terminal", false); // its result will be dropped on the way back
    await until(() => bus.some((r) => r.event === "tool.result" && r.dropped === "offline"), "the lost result");
    system.setOnline("terminal", true);
    await until(idleAfter(1), "the turn to end");
    expect(toolCards()[0]).toMatchObject({ calls: [{ name: "shell", status: "done" }] });
    expect(runs).toBe(1);
  });

  test("revoking a role takes effect at once", async () => {
    await boot();
    await until(() => live("ada"), "Ada to sync");
    system.control("roles.set", { clientId: "ada", roles: ["control"] });
    await until(() => system.clients.get("ada")!.session.isActive("readonly"), "Ada's composer to lock");
    system.type("ada", "can I still type?");
    await until(() => system.clock.now() > 0, "a moment");
    expect(Number(system.host.datamodel.evaluate("turn"))).toBe(0);
    // a steer (control) with nothing running is a message, and control alone may send it
    system.control("roles.set", { clientId: "ada", roles: ["input", "control"] });
    await until(() => system.clients.get("ada")!.session.isActive("ready"), "Ada's composer to unlock");
    system.type("ada", "now I can", true);
    await until(idleAfter(1), "the turn to end");
  });

  describe("real tools: every download is a package.scxml machine", () => {
    /** A tool client whose real tool is a stub (the WebAssembly one needs a browser). */
    async function toolClient(kind: string, tool: string) {
      const c = await system.addClient(kind);
      c.runtime.tools[tool]!.real = async () => async () => `real ${tool}`;
      return c;
    }
    const machine = (key: string) =>
      system.workspace.invocations
        .find((i) => i.invokeid === `pkg-${key}`)!
        .session!.activeStateIds()
        .join(" ");

    test("the runtime first, then the packages; calls wait, the host waits longer, then they run for real", async () => {
      await boot();
      const terminal = await toolClient("terminal", "shell");
      await until(() => live("ada", "terminal"), "clients to sync");
      terminal.runtime.setMode("real");
      await until(() => terminal.session.isActive("real-loading") && packages.loading("sdk"), "the runtime download");
      expect(machine("sdk")).toContain("resolving");
      expect(machine("bash")).toBe("waiting");
      expect(packages.calls).toEqual(["sdk"]);

      packages.finish("sdk");
      await until(() => packages.loading("bash") && packages.loading("coreutils"), "the packages to start");
      packages.progress("coreutils", 3, 12);
      await until(() => machine("coreutils").includes("downloading"), "coreutils downloading");
      expect(terminal.runtime.realState("shell").packages!.map((p) => p.phase)).toEqual(["ready", "resolving", "downloading"]);

      // a call now waits in the client chart; the host is told, and doesn't time out at 30 s
      system.type("ada", "list the files in the workspace");
      await until(() => system.host.isActive("tools"), "the tool call");
      await until(() => bus.some((r) => r.event === "tool.delayed"), "tool.delayed");
      clock.advance(25_000);
      await tick();
      packages.finish("bash");
      await until(() => machine("bash") === "ready", "bash ready");
      clock.advance(20_000); // 45 s after the call: past 30 s, but the host was told again
      await tick();
      expect(system.host.isActive("tools")).toBe(true);

      packages.finish("coreutils");
      await until(idleAfter(1), "the turn to end");
      expect(terminal.session.isActive("real-ready")).toBe(true);
      expect(toolCards()[0]).toMatchObject({ calls: [{ name: "shell", status: "done", content: "real shell" }] });
    });

    test("a package on its way or installed is never fetched twice: Python finds bash and coreutils shared", async () => {
      await boot();
      const terminal = await toolClient("terminal", "shell");
      const python = await toolClient("python", "python");
      await until(() => live("terminal", "python"), "clients to sync");
      terminal.runtime.setMode("real");
      await until(() => packages.loading("sdk"), "the runtime");
      packages.finish("sdk");
      await until(() => packages.loading("coreutils"), "the Terminal packages");
      packages.finish("bash", "coreutils");
      await until(() => terminal.session.isActive("real-ready"), "Terminal ready");

      python.runtime.setMode("real");
      await until(() => packages.loading("python"), "the Python package");
      packages.finish("python");
      await until(() => python.session.isActive("real-ready"), "Python ready");
      expect(packages.calls.sort()).toEqual(["bash", "coreutils", "python", "sdk"]);
      const view = python.runtime.realState("python").packages!.map((p) => `${p.label}:${p.phase}${p.shared ? ":shared" : ""}`);
      expect(view).toEqual(["Wasmer runtime:ready:shared", "bash:ready:shared", "coreutils:ready:shared", "Python 3.13:ready"]);
    });

    test("a failed download fails the waiting calls with the reason; asking again retries only what failed", async () => {
      await boot();
      const pg = await toolClient("postgres", "sql");
      await until(() => live("ada", "postgres"), "clients to sync");
      pg.runtime.setMode("real");
      await until(() => packages.loading("sdk"), "the runtime");
      packages.finish("sdk");
      await until(() => packages.loading("pglite"), "PGlite");
      packages.finish("psql");
      system.type("ada", "count the orders by status in the database");
      await until(() => bus.some((r) => r.event === "tool.delayed"), "the held call");
      packages.fail("pglite", "network error");
      await until(idleAfter(1), "the turn to end");
      expect(pg.session.isActive("real-failed")).toBe(true);
      expect(pg.runtime.realState("sql")).toMatchObject({ status: "failed", error: "network error" });
      expect(toolCards()[0]).toMatchObject({ calls: [{ name: "sql", status: "failed" }] });
      expect(machine("pglite")).toBe("failed");

      pg.runtime.setMode("real"); // retry
      await until(() => pg.session.isActive("real-loading") && machine("pglite").includes("fetching"), "the retry");
      packages.finish("pglite");
      await until(() => pg.session.isActive("real-ready"), "ready after the retry");
      expect(packages.calls.filter((k) => k === "pglite")).toHaveLength(2);
      expect(packages.calls.filter((k) => k === "psql")).toHaveLength(1);
    });

    test("back to the simulation while loading: waiting calls run simulated", async () => {
      await boot();
      const terminal = await toolClient("terminal", "shell");
      await until(() => live("ada", "terminal"), "clients to sync");
      terminal.runtime.setMode("real");
      system.type("ada", "list the files in the workspace");
      await until(() => bus.some((r) => r.event === "tool.delayed"), "the held call");
      terminal.runtime.setMode("simulated");
      await until(idleAfter(1), "the turn to end");
      const card = toolCards()[0]!;
      expect(card).toMatchObject({ calls: [{ name: "shell", status: "done" }] });
      expect(card.type === "tools" && card.calls[0]!.content).toContain("README.md");
    });
  });
});

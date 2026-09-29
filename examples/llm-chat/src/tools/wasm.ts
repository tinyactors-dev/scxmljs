/**
 * Real tools, in WebAssembly sandboxes (Wasmer, @wasmer/sdk 0.19).
 *
 * One shared workspace sandbox holds the demo files in /workspace and every command-line package
 * a client switches to Real: bash + coreutils (Terminal), Python 3.13 (Python), psql (Postgres's
 * client). They all see the same files: bash writes, python reads, psql `\copy`s. Packages are
 * installed on demand, once; a client whose packages another client already installed finds them
 * ready (`shared`). PostgreSQL itself (PGlite) runs in its own sandbox, one server for the page;
 * psql reaches it over the SDK's virtual localhost.
 *
 * - The page must be cross-origin isolated (SharedArrayBuffer). GitHub Pages can't send COOP/COEP
 *   headers, so /demos/llm-chat/ registers coi-serviceworker, which adds them to every response of
 *   that page; `bun scripts/site/serve.ts` sends them itself.
 * - The SDK is not bundled: it loads its JS glue, worker and 4.8 MB .wasm relative to its own URL,
 *   so the site copies it verbatim to /demos/llm-chat/wasmer-sdk/ and this file imports it from
 *   there, only when a client switches to Real. The simulation never downloads any of it.
 * - Packages come from registry.wasmer.io and cdn.wasmer.io on first use and are cached in browser
 *   storage (sizes in packages.ts: bash 1.9 MB, coreutils 12.7 MB, Python 61.7 MB — it brings bash
 *   and coreutils too —, PGlite 76.9 MB, psql 1.1 MB). Progress is reported per package.
 * - Network: the sandboxes use the SDK's "http" mode, which is virtual localhost and HTTP ingress
 *   only, with no external egress (DNS doesn't resolve): psql can reach PGlite, nothing reaches
 *   the internet.
 * - Commands run concurrently (bash can `sleep` while python answers). Every call has a 20 s limit
 *   and a 16 KB output cap; cancelling kills the process. PGlite takes one connection per process,
 *   so psql stays connected; a cancelled or stuck query restarts the database with the demo data.
 * - Several packages provide the same command (Python's package includes bash and coreutils), so
 *   commands are always selected by their package.
 */
import type { CommandRef, Output, Package, PackageLoadProgress, Process, Sandbox, Wasmer } from "@wasmer/sdk";
import type { ToolImpl } from "../protocol.ts";
import { initialDownloads, PACKAGES, type PackageDownload, SDK, TOOL_PACKAGES } from "./packages.ts";
import { type LoadProgress, MAX_OUTPUT } from "./runtime.ts";
import { WORKSPACE } from "./simulated.ts";

/** Where the page serves the SDK (see scripts/site/build.ts). */
let sdkUrl = "/demos/llm-chat/wasmer-sdk/dist/index.js";
export function setWasmerSdkUrl(url: string): void {
  sdkUrl = url;
}

export const TIME_LIMIT_MS = 20_000;

/** "wasmer/bash@=1.0.25" and "wasmer/bash@1.0.25" → "wasmer/bash". */
const nameOf = (id: string) => id.replace(/@[^@/]*$/, "");

/** What `loadPackage` can load: "sdk" (the Wasmer runtime itself), or a key of PACKAGES. */
export type PackageKey = string;

export interface LoadPackageOptions {
  /** This package's progress, as a new snapshot each time (never mutated afterwards). */
  onProgress?: (download: PackageDownload) => void;
  /** Stops waiting (the shared download itself goes on for anyone else who needs it). */
  signal?: AbortSignal;
}

// ── the runtime, the shared workspace, and the packages ─────────────────────────

let client: Promise<Wasmer> | null = null;
let sdkLoaded = false;
let workspace: Promise<Sandbox> | null = null;
let database: Promise<Sandbox> | null = null;
const loads = new Map<PackageKey, Promise<void>>();
const installed = new Map<PackageKey, Package>();
/** Package names present in the workspace (dependencies too: Python brings bash and coreutils). */
const present = new Set<string>();

function wasmer(): Promise<Wasmer> {
  if (!globalThis.crossOriginIsolated)
    return Promise.reject(
      new Error(
        "Real tools need a cross-origin isolated page (SharedArrayBuffer). Reload the page; if that doesn't help, this browser can't run them.",
      ),
    );
  if (!client) {
    client = import(/* @vite-ignore */ sdkUrl).then((m: typeof import("@wasmer/sdk")) => new m.Wasmer().ready());
    client.catch(() => {
      client = null;
    });
  }
  return client;
}

/** The sandbox every command-line tool shares: /workspace, virtual localhost, no egress. */
async function workspaceSandbox(): Promise<Sandbox> {
  if (!workspace) {
    workspace = wasmer().then((w) => w.sandboxes.create({ files: WORKSPACE, network: { mode: "http" } }));
    workspace.catch(() => {
      workspace = null;
    });
  }
  return workspace;
}

/** What the SDK's files cost, from resource timing (0 when served from cache). */
function sdkBytes(): number {
  const entries = globalThis.performance?.getEntriesByType?.("resource") as PerformanceResourceTiming[] | undefined;
  return (entries ?? []).filter((e) => e.name.includes("/wasmer-sdk/")).reduce((n, e) => n + (e.encodedBodySize || 0), 0);
}

function infoOf(key: PackageKey) {
  const info = key === "sdk" ? SDK : PACKAGES[key];
  if (!info) throw new Error(`unknown package ${key}`);
  return info;
}

function snapshot(key: PackageKey, patch: Partial<PackageDownload>): PackageDownload {
  return { ...infoOf(key), phase: "waiting", cached: false, shared: false, downloadedBytes: 0, totalBytes: null, percent: null, ...patch };
}

/** Whether a package is loaded already (then `loadPackage` resolves at once, `shared`). */
export function isLoaded(key: PackageKey): boolean {
  return key === "sdk" ? sdkLoaded : installed.has(key);
}

/**
 * Load one package: the SDK, or a package installed into the shared workspace (PGlite: into the
 * database sandbox). Idempotent: a second call shares the first (and reports `shared: true` once
 * it's ready, if it was already loaded). Reports only this package's own progress.
 */
export async function loadPackage(key: PackageKey, { onProgress, signal }: LoadPackageOptions = {}): Promise<void> {
  const report = (patch: Partial<PackageDownload>) => onProgress?.(snapshot(key, patch));
  const done = key === "sdk" ? sdkLoaded : installed.has(key);
  if (done) {
    report({ phase: "ready", shared: true, cached: true, percent: 100 });
    return;
  }
  const name = key === "sdk" ? "@wasmer/sdk" : nameOf(infoOf(key).id);
  const already = present.has(name); // installed as another package's dependency
  let load = loads.get(key);
  const mine = !load;
  if (!load) {
    load = start(key, (p) => report(already ? { ...p, shared: true } : p));
    loads.set(key, load);
    load.catch(() => loads.delete(key));
  } else report({ phase: "loading" }); // someone else's download: wait for it
  const stopped = new Promise<never>((_, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason ?? new Error("cancelled")), { once: true });
  });
  try {
    await Promise.race(signal ? [load, stopped] : [load]);
  } catch (err) {
    report({ phase: "failed" });
    throw err;
  }
  report({ phase: "ready", percent: 100, shared: !mine || already, cached: !mine || already });
}

/** The actual work behind `loadPackage` (once per package). */
async function start(key: PackageKey, report: (patch: Partial<PackageDownload>) => void): Promise<void> {
  if (key === "sdk") {
    report({ phase: "loading" });
    await wasmer();
    sdkLoaded = true;
    const bytes = sdkBytes();
    report({ phase: "ready", percent: 100, ...(bytes ? { downloadedBytes: bytes, totalBytes: bytes } : { cached: true }) });
    return;
  }
  const info = infoOf(key);
  report({ phase: "resolving" });
  const onProgress = (p: PackageLoadProgress) => {
    for (const pk of p.packages) if (pk.phase === "ready") present.add(nameOf(pk.id));
    const own = p.packages.find((pk) => nameOf(pk.id) === nameOf(info.id));
    if (own)
      report({
        phase: own.phase,
        cached: own.cached,
        downloadedBytes: own.download.downloadedBytes,
        totalBytes: own.download.totalBytes,
        percent: own.download.percent,
      });
  };
  if (key === "pglite") {
    // PostgreSQL keeps its data in its own sandbox; psql reaches it over virtual localhost
    database ??= wasmer().then((w) =>
      w.sandboxes.create({ packages: [info.id], network: { mode: "http" }, onPackageProgress: onProgress }),
    );
    database.catch(() => {
      database = null;
    });
    await database;
    installed.set(key, null as unknown as Package); // the database sandbox is the handle
  } else {
    const sandbox = await workspaceSandbox();
    installed.set(key, await sandbox.installPackage(info.id, { onProgress }));
  }
  present.add(nameOf(info.id));
}

/** A command of an installed package (commands are ambiguous across packages: Python has bash). */
function command(key: PackageKey, name: string): CommandRef {
  const pkg = installed.get(key);
  if (!pkg) throw new Error(`${infoOf(key).label} isn't loaded`);
  return pkg.command(name);
}

/** Run one process to its end in the workspace; `signal` kills it. */
async function exec(sandbox: Sandbox, command: CommandRef, args: string[], signal: AbortSignal): Promise<string> {
  const proc = await sandbox
    .command(command, args, { cwd: "/workspace" })
    .spawn({ stdout: "capture", stderr: "capture", timeoutMs: TIME_LIMIT_MS, outputBytes: MAX_OUTPUT });
  const kill = () => void proc.kill().catch(() => {});
  signal.addEventListener("abort", kill, { once: true });
  try {
    return format(await proc.wait());
  } finally {
    signal.removeEventListener("abort", kill);
  }
}

/** stdout, then stderr; a non-zero exit or a timeout is an error result (with the output). */
function format(out: Output): string {
  const stdout = out.stdout.text().trimEnd();
  const stderr = out.stderr.text().trimEnd();
  const text = [stdout, stderr && `[stderr]\n${stderr}`].filter(Boolean).join("\n");
  if (out.reason === "timeout") throw new Error(`${text}\n[stopped after ${TIME_LIMIT_MS / 1000} s]`.trim());
  if (out.reason === "terminated") throw new Error(`${text}\n[killed]`.trim());
  if (out.exitCode !== 0) throw new Error(`${text}\n[exit ${out.exitCode}]`.trim());
  return text || "(no output)";
}

/** The simulation's `orders` table (from orders.csv), as SQL. */
export function seedSql(): string {
  const rows = (WORKSPACE["orders.csv"] ?? "")
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.split(","))
    .map(([id, status, total]) => `(${Number(id)}, '${String(status).replace(/'/g, "''")}', ${Number(total)})`);
  return `CREATE TABLE orders (id integer PRIMARY KEY, status text NOT NULL, total integer NOT NULL);\nINSERT INTO orders VALUES ${rows.join(", ")};`;
}

/** One psql session to one PGlite server, kept open (PGlite takes one connection per process). */
class Postgres {
  #server: Process | null = null;
  #psql: Process | null = null;
  #out: AsyncGenerator<string> | null = null;
  #err: AsyncGenerator<string> | null = null;
  #marker = 0;
  #tail: Promise<unknown> = Promise.resolve();

  constructor(
    readonly db: Sandbox,
    readonly client: Sandbox,
    readonly pglite: string,
    readonly psqlCommand: CommandRef,
  ) {}

  async boot(): Promise<void> {
    this.#server = await this.db.command(this.pglite).spawn({ stdout: "capture", stderr: "capture" });
    await this.db.ports.wait(5432, { timeoutMs: 15_000 });
    // no prompts: they would end up in the output
    const args = ["-X", "-q", "-h", "localhost", "-U", "postgres", "-d", "postgres", "-P", "pager=off"];
    args.push("-v", "ON_ERROR_STOP=0", "-v", "PROMPT1=", "-v", "PROMPT2=");
    this.#psql = await this.client
      .command(this.psqlCommand, args, { cwd: "/workspace" })
      .spawn({ stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    this.#out = this.#psql.stdout!.lines();
    this.#err = this.#psql.stderr!.lines();
    await this.#send(seedSql(), TIME_LIMIT_MS);
  }

  async stop(): Promise<void> {
    await Promise.allSettled([this.#psql?.kill(), this.#server?.kill()]);
    this.#psql = this.#server = null;
  }

  /** Queries run one at a time. */
  query(sql: string, signal: AbortSignal): Promise<string> {
    const run = this.#tail.then(() => this.#one(sql, signal));
    this.#tail = run.catch(() => {});
    return run;
  }

  async #one(sql: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const stopped = new Promise<never>((_, reject) =>
      signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }),
    );
    try {
      const { out, err } = await Promise.race([this.#send(sql, TIME_LIMIT_MS), stopped]);
      const text = [out.trimEnd(), err.trimEnd()].filter(Boolean).join("\n");
      if (/^(ERROR|FATAL):/m.test(err)) throw new Error(text);
      return text || "(no output)";
    } catch (e) {
      if (e instanceof Error && /^(ERROR|FATAL):/m.test(e.message)) throw e;
      // cancelled, too slow, or the session died: start over with the demo data
      await this.stop();
      await this.boot();
      throw new Error(`${e instanceof Error ? e.message : String(e)}; the database was restarted with the demo data`);
    }
  }

  /** Write the SQL, then markers on both streams, and read each stream up to its marker. */
  async #send(sql: string, timeoutMs: number): Promise<{ out: string; err: string }> {
    const psql = this.#psql;
    if (!psql?.stdin || !this.#out || !this.#err) throw new Error("the database isn't running");
    const marker = `__scxmljs_end_${++this.#marker}__`;
    const statement = /;\s*$/.test(sql) ? sql : `${sql}\n;`; // an unterminated statement would swallow the markers
    await psql.stdin.write(`${statement}\n\\echo ${marker}\n\\warn ${marker}\n`);
    const until = async (lines: AsyncGenerator<string>) => {
      const got: string[] = [];
      for (;;) {
        const { value, done } = await lines.next();
        if (done) throw new Error("psql exited");
        if (value.includes(marker)) return got.join("\n");
        got.push(value);
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`stopped after ${timeoutMs / 1000} s`)), timeoutMs);
    });
    try {
      const [out, err] = await Promise.race([Promise.all([until(this.#out), until(this.#err)]), late]);
      return { out, err };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ── the tools: they assume their packages are loaded ──────────────────────────

/** `shell { command }`: bash and coreutils in the shared /workspace (python and psql too, once loaded). */
export const shellTool: ToolImpl = async (input, { signal }) =>
  exec(await workspaceSandbox(), command("bash", "bash"), ["-c", String(input.command ?? "")], signal);

/** `python { code }`: Python 3.13 in the shared /workspace. */
export const pythonTool: ToolImpl = async (input, { signal }) =>
  exec(await workspaceSandbox(), command("python", "python"), ["-c", String(input.code ?? "")], signal);

let postgres: Promise<Postgres> | null = null;

/**
 * `sql { query }`: PostgreSQL with the demo `orders` table, booted on the first query. One server
 * for the page (a second Postgres client shares it); psql runs in the shared workspace, so it can
 * `\copy` files from /workspace.
 */
export const sqlTool: ToolImpl = async (input, { signal }) => {
  if (!postgres) {
    postgres = (async () => {
      if (!database || !installed.has("pglite")) throw new Error("PostgreSQL isn't loaded");
      const db = await database;
      const pg = new Postgres(db, await workspaceSandbox(), "pglite", command("psql", "psql"));
      await pg.boot();
      return pg;
    })();
    postgres.catch(() => {
      postgres = null;
    });
  }
  return (await postgres).query(String(input.query ?? ""), signal);
};

/**
 * The WebAssembly packages behind the real tools: what each client needs, what it is, and roughly
 * how big a first download is. No imports: the page reads this before anything is downloaded, to
 * say up front what switching a client to Real will cost.
 *
 * CONTRACT between the tool runtime (tools/*) and the page (site/client/llm-chat.ts):
 * - `ToolRuntime.realState(name).packages` lists one `PackageDownload` per package this tool
 *   needs, in the order below, updated live (a `change` event per update) while it loads.
 * - The first entry is the Wasmer SDK itself (`SDK`; no byte progress, percent null until ready).
 * - A package already installed for another client (the shared workspace sandbox) shows as
 *   `phase: "ready"` at once, with `shared: true`. After a load, `packages` stays on the state
 *   (all "ready", or the failed ones "failed").
 */

export interface PackageInfo {
  /** Registry id, pinned. */
  id: string;
  /** What a person calls it. */
  label: string;
  /** Roughly how many bytes a first (uncached) download is. */
  approxBytes: number;
}

export type PackagePhase = "waiting" | "resolving" | "downloading" | "loading" | "ready" | "failed";

/** One package's progress, as the page shows it (one bar each). */
export interface PackageDownload extends PackageInfo {
  phase: PackagePhase;
  /** Came from the browser's cache: nothing to download. */
  cached: boolean;
  /** Already installed in the shared sandbox for another client. */
  shared: boolean;
  downloadedBytes: number;
  totalBytes: number | null;
  /** 0–100, or null while the size is unknown. */
  percent: number | null;
}

const MB = 1024 * 1024;

export const PACKAGES: Record<string, PackageInfo> = {
  // sizes measured from the registry (first download, Chromium, 2026-09-30)
  bash: { id: "wasmer/bash@=1.0.25", label: "bash", approxBytes: 1_870_786 },
  coreutils: { id: "wasmer/coreutils@=1.0.27", label: "coreutils", approxBytes: 12_703_522 },
  python: { id: "python/python@=3.13.20", label: "Python 3.13", approxBytes: 61_744_083 },
  pglite: { id: "wasmer/pglite@=0.1.3", label: "PostgreSQL (PGlite)", approxBytes: 76_919_536 },
  psql: { id: "wasmer/psql@=18.4.0", label: "psql", approxBytes: 1_065_711 },
};

/**
 * The Wasmer SDK itself, fetched once from this site before any package (its .wasm and glue).
 * It has no byte-level progress: it goes from "loading" (percent null) to "ready".
 */
export const SDK: PackageInfo = { id: "@wasmer/sdk", label: "Wasmer runtime", approxBytes: 4_827_893 + 124_084 };

/**
 * Which packages each real tool needs (keys of PACKAGES), in download order. Python depends on
 * bash and coreutils (its package brings them), so they are listed for it too; whichever of
 * Terminal and Python goes first downloads them, the other finds them installed (`shared`).
 */
export const TOOL_PACKAGES: Record<string, string[]> = {
  shell: ["bash", "coreutils"],
  python: ["bash", "coreutils", "python"],
  sql: ["pglite", "psql"],
};

/** The list a tool starts from: the SDK, then its packages, all waiting. */
export function initialDownloads(tool: string): PackageDownload[] {
  const infos = [SDK, ...(TOOL_PACKAGES[tool] ?? []).flatMap((k) => (PACKAGES[k] ? [PACKAGES[k]] : []))];
  return infos.map((info) => ({
    ...info,
    phase: "waiting",
    cached: false,
    shared: false,
    downloadedBytes: 0,
    totalBytes: null,
    percent: null,
  }));
}

/** Bytes a first switch to Real downloads for these tools, at most (nothing if cached). */
export function downloadSize(tools: string[]): number {
  const keys = new Set(tools.flatMap((t) => TOOL_PACKAGES[t] ?? []));
  return SDK.approxBytes + [...keys].reduce((sum, k) => sum + (PACKAGES[k]?.approxBytes ?? 0), 0);
}

export function formatBytes(n: number): string {
  return n >= MB ? `${(n / MB).toFixed(n >= 10 * MB ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * Installs one package (a key of PACKAGES, or "sdk") into the shared workspace; idempotent.
 * tools/wasm.ts `loadPackage` is the real one; the page's `?fake-downloads` and the tests use fakes.
 * It runs inside a package.scxml machine (the `wasm-package` invoker): `signal` aborts when the
 * machine leaves its `fetching` state.
 */
export type PackageLoader = (
  key: string,
  options: { onProgress?: (download: PackageDownload) => void; signal?: AbortSignal },
) => Promise<void>;

/** The catalog workspace.scxml gets as data: key → { label, approxBytes }. */
export function packageCatalog(): Record<string, { label: string; approxBytes: number }> {
  const out: Record<string, { label: string; approxBytes: number }> = { sdk: { label: SDK.label, approxBytes: SDK.approxBytes } };
  for (const [k, info] of Object.entries(PACKAGES)) out[k] = { label: info.label, approxBytes: info.approxBytes };
  return out;
}

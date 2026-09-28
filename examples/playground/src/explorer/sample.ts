/** The contract every explorer sample implements. */
import type { Clock, IOProcessor, SCXMLSession } from "@tinyactors/scxmljs/trusted";

export interface Sample {
  id: string;
  title: string;
  /** One or two sentences for a picker. */
  description: string;
  /** SCXML text of the root machine. */
  source(): Promise<string>;
  /** Resolves invoke/data `src` attributes (browser: fetch /charts/…; Bun: read files). */
  loader: (src: string) => string | Promise<string>;
  /** Fresh fake services for one run; they reply on the given clock (so tests can use a VirtualClock). */
  ioprocessors(clock: Clock): IOProcessor[];
  data?: Record<string, unknown>;
  /** Drives the system like its environment would. Returns a stop function. */
  drive?(session: SCXMLSession, clock: Clock): () => void;
}

/** Loads a chart file from charts/: fetch in browsers, the file system under Bun. */
export function chartFile(name: string): string | Promise<string> {
  const file = name.replace(/^file:/, "").replace(/^.*\//, "");
  // under Bun/Node: read from disk (getBuiltinModule keeps browser bundles free of Node imports)
  type NodeFs = { readFileSync(path: URL, encoding: "utf8"): string };
  const process = (globalThis as { process?: { getBuiltinModule?(id: string): unknown } }).process;
  const fs = typeof window === "undefined" ? (process?.getBuiltinModule?.("node:fs") as NodeFs | undefined) : undefined;
  if (fs) return fs.readFileSync(new URL(`../../charts/${file}`, import.meta.url), "utf8");
  return fetch(`/charts/${file}`).then((r) => {
    if (!r.ok) throw new Error(`could not load ${file}: ${r.status}`);
    return r.text();
  });
}

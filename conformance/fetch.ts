#!/usr/bin/env bun

// Fetch the W3C SCXML IRP conformance tests and convert them to ECMAScript-datamodel SCXML.
//
//   bun conformance/fetch.ts           # uses conformance/.cache, only downloads what's missing
//   bun conformance/fetch.ts --refresh # re-download everything
//
// Requires bun (for `bunx xslt3`, SaxonJS). xsltproc cannot be used: confEcma.xsl needs XSLT 2.0.
//
// Output:
//   conformance/ecma/<assertId>/*.scxml (+ non-txml deps copied verbatim)
//   conformance/manifest.json

import { mkdir, readdir, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { $ } from "bun";

const BASE = "https://www.w3.org/Voice/2013/scxml-irp/";
const ROOT = import.meta.dir;
const CACHE = join(ROOT, ".cache");
const OUT = join(ROOT, "ecma");
const CONCURRENCY = 8;
const RETRIES = 4;
const refresh = process.argv.includes("--refresh");
// confEcma.xsl is an XSLT 2.0 stylesheet (xsl:analyze-string, regex-group). libxslt's xsltproc only
// implements XSLT 1.0 and silently emits empty attributes (e.g. cond="") for those templates, so we
// use SaxonJS (the `xslt3` npm CLI, run via bunx without touching package.json) instead.
const XSLT3 = ["bunx", "xslt3@2.7.0"];

export interface ManifestEntry {
  /** Test id. Equals the assert id, except for asserts with several start files (e.g. 403a/403b/403c). */
  id: string;
  /** Assertion id from the manifest (also the directory name under ecma/). */
  assert: string;
  specnum: string;
  specid: string;
  conformance: "mandatory" | "optional";
  manual: boolean;
  /** Path relative to conformance/ of the converted start document. */
  file: string;
  /** Paths relative to conformance/ of dependency files (converted sub-documents, data files). */
  deps: string[];
  description: string;
}

async function fetchWithRetry(url: string): Promise<Uint8Array> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      if (attempt < RETRIES) await Bun.sleep(500 * 2 ** attempt);
    }
  }
  throw lastErr;
}

/** Download `rel` (relative to BASE) into the cache unless already present. Returns the cache path. */
async function cached(rel: string): Promise<string> {
  const path = join(CACHE, rel);
  const file = Bun.file(path);
  if (!refresh && (await file.exists()) && file.size > 0) return path;
  await mkdir(dirname(path), { recursive: true });
  const data = await fetchWithRetry(new URL(rel, BASE).href);
  await Bun.write(path, data);
  return path;
}

async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

const attr = (s: string, name: string) => s.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

interface RawTest {
  assert: string;
  specnum: string;
  specid: string;
  id: string;
  conformance: "mandatory" | "optional";
  manual: boolean;
  starts: string[];
  deps: string[];
  description: string;
}

function parseManifest(xml: string): RawTest[] {
  const tests: RawTest[] = [];
  for (const a of xml.matchAll(/<assert\b([^>]*)>([\s\S]*?)<\/assert>/g)) {
    const [, aAttrs, body] = a as unknown as [string, string, string];
    const assert = attr(aAttrs, "id")!;
    const description = (body.match(/<!\[CDATA\[([\s\S]*?)\]\]>/)?.[1] ?? "").replace(/\s+/g, " ").trim();
    for (const t of body.matchAll(/<test\b([^>]*)>([\s\S]*?)<\/test>/g)) {
      const [, tAttrs, tBody] = t as unknown as [string, string, string];
      const conformance = attr(tAttrs, "conformance");
      if (conformance !== "mandatory" && conformance !== "optional")
        throw new Error(`assert ${assert}: unexpected conformance ${conformance}`);
      tests.push({
        assert,
        specnum: attr(aAttrs, "specnum") ?? "",
        specid: attr(aAttrs, "specid") ?? "",
        id: attr(tAttrs, "id") ?? assert,
        conformance,
        manual: attr(tAttrs, "manual") === "true",
        starts: [...tBody.matchAll(/<start\s+uri="([^"]+)"/g)].map((m) => m[1]!),
        deps: [...tBody.matchAll(/<dep\s+uri="([^"]+)"/g)].map((m) => m[1]!),
        description,
      });
    }
  }
  return tests;
}

/** Output path (relative to conformance/) for a source uri like "239/test239sub1.txml". */
function outRel(assert: string, uri: string): string {
  return join("ecma", assert, basename(uri).replace(/\.txml$/, ".scxml"));
}

async function main() {
  await mkdir(CACHE, { recursive: true });
  const [manifestPath, xslPath] = await Promise.all([cached("manifest.xml"), cached("confEcma.xsl")]);
  const tests = parseManifest(await Bun.file(manifestPath).text());

  // Every file to fetch, mapped to the assert directory it belongs in.
  const jobs = new Map<string, string>(); // uri -> assert
  for (const t of tests) for (const u of [...t.starts, ...t.deps]) jobs.set(u, t.assert);

  // Compile the stylesheet once to a SEF file; per-file transforms then take ~0.2s instead of ~0.7s.
  const sefPath = join(CACHE, "confEcma.sef.json");
  const sef = Bun.file(sefPath);
  if (refresh || !(await sef.exists()) || sef.lastModified < Bun.file(xslPath).lastModified) {
    await $`${XSLT3} -xsl:${xslPath} -export:${sefPath} -nogo`.quiet();
  }

  let downloaded = 0;
  await pool([...jobs.keys()], CONCURRENCY, async (uri) => {
    const before = await Bun.file(join(CACHE, uri)).exists();
    await cached(uri);
    if (!before || refresh) downloaded++;
  });
  console.log(`fetched ${jobs.size} test files (${downloaded} from network, rest cached)`);

  // Regenerate the output tree from scratch so it is always consistent with the cache.
  await rm(OUT, { recursive: true, force: true });
  const failures: string[] = [];
  await pool([...jobs.entries()], CONCURRENCY, async ([uri, assert]) => {
    const src = join(CACHE, uri);
    const dest = join(ROOT, outRel(assert, uri));
    await mkdir(dirname(dest), { recursive: true });
    if (uri.endsWith(".txml")) {
      const r = await $`${XSLT3} -xsl:${sefPath} -s:${src}`.nothrow().quiet();
      if (r.exitCode !== 0) {
        failures.push(`${uri}: ${r.stderr.toString().trim()}`);
        return;
      }
      await Bun.write(dest, r.stdout);
    } else {
      await Bun.write(dest, Bun.file(src));
    }
  });
  if (failures.length) {
    console.error(`XSLT failed for ${failures.length} file(s):\n  ${failures.join("\n  ")}`);
    process.exitCode = 1;
  }

  // Check that every file:/relative src reference in a converted doc resolves in its directory.
  const missingRefs: string[] = [];
  for (const dir of await readdir(OUT)) {
    for (const f of await readdir(join(OUT, dir))) {
      if (!f.endsWith(".scxml")) continue;
      const text = await Bun.file(join(OUT, dir, f)).text();
      for (const m of text.matchAll(/\bsrc="(?:file:)?([^":]+)"/g)) {
        const ref = m[1]!;
        if (!(await Bun.file(join(OUT, dir, ref)).exists())) missingRefs.push(`ecma/${dir}/${f} -> ${ref}`);
      }
    }
  }
  if (missingRefs.length) console.warn(`unresolved src references:\n  ${missingRefs.join("\n  ")}`);

  const entries: ManifestEntry[] = [];
  for (const t of tests) {
    const deps = t.deps.map((d) => outRel(t.assert, d));
    for (const start of t.starts) {
      const file = outRel(t.assert, start);
      const id = t.starts.length > 1 ? basename(start).replace(/^test|\.txml$/g, "") : t.id;
      entries.push({
        id,
        assert: t.assert,
        specnum: t.specnum,
        specid: t.specid,
        conformance: t.conformance,
        manual: t.manual,
        file,
        deps,
        description: t.description,
      });
    }
  }
  await Bun.write(join(ROOT, "manifest.json"), `${JSON.stringify(entries, null, 2)}\n`);

  const count = (p: (e: ManifestEntry) => boolean) => entries.filter(p).length;
  console.log(
    `wrote manifest.json: ${entries.length} tests ` +
      `(${count((e) => e.conformance === "mandatory")} mandatory, ` +
      `${count((e) => e.conformance === "optional")} optional, ${count((e) => e.manual)} manual)`,
  );
}

await main();

/**
 * Compares two traces of one system semantically: the same actors, the same transitions in order,
 * the same messages in order, and how many events have a cause. Ids (`e<n>`) and causes are not
 * compared one by one: they are the recorder's, and a better recorder finds more causes.
 *
 *   bun prototypes/office/tracer/diff.ts old.json new.json
 *   bun prototypes/office/tracer/diff.ts --git <system>...   # HEAD's data/<system>/trace.json against the working tree's
 *
 * Prints one line per system (`same` or what differs) and exits 1 when something differs.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { Ev, Trace } from "./tracer.ts";

/** Generated session ids (`session12.x3f9qz`) are random: they never count as a difference. */
const norm = (s: string) => s.replace(/session\d+\.[a-z0-9]{1,8}/g, "session…");
const key = (e: Ev, keys: string[]) => norm(keys.map((k) => JSON.stringify(e[k] ?? null)).join(" "));
const lines = (t: Trace, type: string, keys: string[]) => t.events.filter((e) => e.type === type).map((e) => `${e.t} ${key(e, keys)}`);

function firstDiff(a: string[], b: string[]): string | undefined {
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if (a[i] !== b[i]) return `#${i}: ${a[i] ?? "(none)"}  ≠  ${b[i] ?? "(none)"}`;
  return undefined;
}

function count(xs: string[]) {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return m;
}

/** Each multiset difference, as "+x" (only in b) and "-x" (only in a). */
function multisetDiff(a: string[], b: string[], max = 6): string[] {
  const ca = count(a);
  const cb = count(b);
  const out: string[] = [];
  for (const [k, n] of ca) if ((cb.get(k) ?? 0) < n) out.push(`-${n - (cb.get(k) ?? 0)}× ${k}`);
  for (const [k, n] of cb) if ((ca.get(k) ?? 0) < n) out.push(`+${n - (ca.get(k) ?? 0)}× ${k}`);
  return out.slice(0, max).concat(out.length > max ? [`… ${out.length - max} more`] : []);
}

const caused = (t: Trace, type: string) => {
  const xs = t.events.filter((e) => e.type === type);
  return `${xs.filter((e) => e.cause).length}/${xs.length}`;
};

export function compare(a: Trace, b: Trace): string[] {
  const out: string[] = [];
  const actor = (t: Trace) => t.actors.map((x) => `${x.id} ${x.chart} ${x.label} ${x.parent ?? ""} ${x.bornAt} ${x.diedAt ?? ""}`);
  const d1 = firstDiff(actor(a), actor(b));
  if (d1) out.push(`actors differ ${d1}`);
  const tr = ["actor", "event", "from", "to", "targetless"];
  const d2 = firstDiff(lines(a, "transition", tr), lines(b, "transition", tr));
  if (d2) out.push(`transitions differ ${d2}`);
  // messages: the same set at each instant (their order within an instant follows the recorder's emission)
  const msg = ["from", "to", "name", "summary", "delay", "dropped", "invoke", "channel"];
  const ma = lines(a, "message", msg);
  const mb = lines(b, "message", msg);
  const md = multisetDiff(ma, mb);
  if (md.length) out.push(`messages differ:\n      ${md.join("\n      ")}`);
  else if (firstDiff(ma.slice().sort(), mb.slice().sort())) out.push("messages differ in order");
  for (const type of ["spawn", "end", "config", "snapshot", "data", "timer", "error", "caption"]) {
    const keys = type === "end" ? ["actor", "reason"] : type === "config" ? ["actor", "active"] : type === "timer" ? ["actor", "action", "delay"] : type === "caption" ? ["text"] : ["actor", "key"];
    const dd = multisetDiff(lines(a, type, keys), lines(b, type, keys), 4);
    if (dd.length) out.push(`${type} differs:\n      ${dd.join("\n      ")}`);
  }
  const ca = Object.keys(a.charts).sort().join(" ");
  const cb = Object.keys(b.charts).sort().join(" ");
  if (ca !== cb) out.push(`charts differ: ${ca} ≠ ${cb}`);
  for (const k of Object.keys(a.charts))
    if (b.charts[k] && (a.charts[k]!.purpose ?? "") !== (b.charts[k]!.purpose ?? ""))
      out.push(`chart ${k} purpose: ${JSON.stringify(a.charts[k]!.purpose ?? null)} → ${JSON.stringify(b.charts[k]!.purpose ?? null)}`);
  const cov = ["transition", "message"].map((t) => `${t} causes ${caused(a, t)} → ${caused(b, t)}`).join(", ");
  out.push(`(${cov}; events ${a.events.length} → ${b.events.length})`);
  return out;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const pairs: [string, Trace, Trace][] = [];
  if (args[0] === "--git") {
    const root = new URL("../data/", import.meta.url).pathname;
    for (const system of args.slice(1)) {
      const path = `prototypes/office/data/${system}/trace.json`;
      const old = JSON.parse(execFileSync("git", ["show", `HEAD:${path}`], { maxBuffer: 1 << 28, encoding: "utf8" })) as Trace;
      pairs.push([system, old, JSON.parse(readFileSync(`${root}${system}/trace.json`, "utf8")) as Trace]);
    }
  } else pairs.push([args[1]!, JSON.parse(readFileSync(args[0]!, "utf8")), JSON.parse(readFileSync(args[1]!, "utf8"))]);
  let differs = false;
  for (const [name, a, b] of pairs) {
    const d = compare(a, b);
    const same = d.length === 1;
    differs ||= !same;
    console.log(`${same ? "same" : "DIFF"} ${name} ${d.join("\n  ")}`);
  }
  process.exit(differs ? 1 : 0);
}

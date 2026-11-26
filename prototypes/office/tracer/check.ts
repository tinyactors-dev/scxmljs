/**
 * Validates traces against SCHEMA.md and the tracer's invariants, and prints a summary.
 * Run: bun prototypes/office/tracer/check.ts [trace.json ...]   (default: every data/<system>/trace.json)
 * Exits 1 when any trace has errors.
 */
import { readdir } from "node:fs/promises";

type Any = Record<string, any>;
const dataDir = new URL("../data/", import.meta.url).pathname;
let files = process.argv.slice(2);
if (!files.length) {
  files = [];
  for (const d of await readdir(dataDir, { withFileTypes: true }))
    if (d.isDirectory() && (await Bun.file(`${dataDir}${d.name}/trace.json`).exists())) files.push(`${dataDir}${d.name}/trace.json`);
}
const quiet = process.env.QUIET === "1";
let failed = 0;
for (const file of files) {
  const text = await Bun.file(file).text();
  const errors = check(JSON.parse(text), text.length, file);
  if (errors.length) {
    failed++;
    console.log(`\n${errors.length} ERRORS in ${file}:\n  ${[...new Set(errors)].slice(0, 40).join("\n  ")}`);
  } else console.log(`OK ${file}\n`);
}
process.exit(failed ? 1 : 0);

function check(trace: Any, size: number, file: string): string[] {
  const errors: string[] = [];
  const err = (s: string) => errors.push(s);
  for (const k of ["system", "duration", "charts", "actors", "externals", "events"]) if (!(k in trace)) err(`missing ${k}`);
  // charts
  const stateIds = new Map<string, Set<string>>();
  const chartStats: string[] = [];
  const ACTIONS = new Set(["assign", "send", "raise", "cancel", "script", "log", "if", "foreach"]);
  const checkActions = (where: string, acts: Any[] = []) => {
    for (const a of acts) {
      if (!ACTIONS.has(a.type)) err(`${where}: unknown action ${a.type}`);
      if (a.type === "if") checkActions(where, [...a.then, ...(a.else ?? [])]);
      if (a.type === "foreach") checkActions(where, a.body);
    }
  };
  for (const [name, c] of Object.entries(trace.charts) as [string, Any][]) {
    const ids = new Set<string>();
    let depth = 0;
    let width = 0;
    let states = 0;
    let docs = 0;
    const kinds: Record<string, number> = {};
    const walk = (n: Any, d: number) => {
      if (ids.has(n.id)) err(`chart ${name}: duplicate state ${n.id}`);
      ids.add(n.id);
      if (!["compound", "parallel", "atomic", "final", "history"].includes(n.kind)) err(`chart ${name}: ${n.id} kind ${n.kind}`);
      if (!Array.isArray(n.children) || !Array.isArray(n.transitions)) err(`chart ${name}: ${n.id} lacks children/transitions`);
      kinds[n.kind] = (kinds[n.kind] ?? 0) + 1;
      if (d) states++;
      if (n.doc) docs++;
      depth = Math.max(depth, d);
      width = Math.max(width, n.children.length);
      checkActions(`${name}/${n.id}`, n.onentry);
      checkActions(`${name}/${n.id}`, n.onexit);
      for (const t of n.transitions) checkActions(`${name}/${n.id}`, t.actions);
      n.children.forEach((k: Any) => walk(k, d + 1));
    };
    walk(c.root, 0);
    const refs = (n: Any) => {
      for (const t of n.transitions) for (const x of t.targets) if (!ids.has(x)) err(`chart ${name}: ${n.id} targets unknown ${x}`);
      for (const x of n.initial ?? []) if (!ids.has(x)) err(`chart ${name}: ${n.id} initial unknown ${x}`);
      n.children.forEach(refs);
    };
    refs(c.root);
    for (const d of c.datamodel ?? [])
      for (const s of [...(d.readBy ?? []), ...(d.writtenBy ?? []), ...(d.scope ? [d.scope] : [])])
        if (!ids.has(s)) err(`chart ${name}: data ${d.id} names unknown state ${s}`);
    stateIds.set(name, ids);
    chartStats.push(
      `${name}: ${states} states, depth ${depth}, widest ${width}, ${Object.entries(kinds)
        .map(([k, v]) => `${v} ${k}`)
        .join(" ")}, ${c.datamodel?.length ?? 0} vars, docs ${docs}/${states + 1}${c.purpose ? "" : ", no purpose"}`,
    );
  }
  // actors and endpoints
  const actors = new Map<string, Any>(trace.actors.map((a: Any) => [a.id, a]));
  if (actors.size !== trace.actors.length) err("duplicate actor ids");
  const exts = new Map<string, Any>(trace.externals.map((x: Any) => [x.id, x]));
  for (const id of exts.keys()) if (actors.has(id)) err(`id ${id} is both an actor and an external`);
  for (const a of actors.values()) {
    if (!stateIds.has(a.chart)) err(`actor ${a.id}: unknown chart ${a.chart}`);
    if (a.parent && !actors.has(a.parent)) err(`actor ${a.id}: unknown parent ${a.parent}`);
    for (const k of ["label", "role"]) if (typeof a[k] !== "string") err(`actor ${a.id}: no ${k}`);
  }
  const endpoint = (x: string) => actors.has(x) || exts.has(x);
  // events
  const index = new Map<string, number>();
  trace.events.forEach((e: Any, i: number) => {
    if (!e.id) err(`event ${i} has no id`);
    else if (index.has(e.id)) err(`duplicate event id ${e.id}`);
    index.set(e.id, i);
  });
  const counts: Record<string, number> = {};
  const pairs: Record<string, number> = {};
  const born = new Map<string, number>();
  const died = new Map<string, number>();
  let prev = -Infinity;
  let alive = 0;
  let peak = 0;
  const timeline: number[] = [];
  const buckets = 20;
  const bucketOf = (t: number) => Math.min(buckets - 1, Math.floor((t / Math.max(1, trace.duration)) * buckets));
  trace.events.forEach((e: Any, i: number) => {
    counts[e.type] = (counts[e.type] ?? 0) + 1;
    if (typeof e.t !== "number") err(`${e.id}: no t`);
    if (e.t < prev) err(`events not sorted at ${e.id} (t=${e.t} < ${prev})`);
    prev = e.t;
    if (e.t > trace.duration) err(`${e.id} after the duration`);
    const a = e.actor !== undefined ? actors.get(e.actor) : undefined;
    if (e.actor !== undefined && !a) err(`${e.id}: unknown actor ${e.actor}`);
    if (e.type === "spawn") {
      if (born.has(e.actor)) err(`${e.actor} spawned twice`);
      born.set(e.actor, i);
      alive++;
      peak = Math.max(peak, alive);
      if (a && a.bornAt !== e.t) err(`${e.actor}: bornAt ${a.bornAt} ≠ spawn t ${e.t}`);
    } else if (e.type === "end") {
      if (died.has(e.actor)) err(`${e.actor} ended twice`);
      died.set(e.actor, i);
      alive--;
      if (a && a.diedAt !== e.t) err(`${e.actor}: diedAt ${a.diedAt} ≠ end t ${e.t}`);
    }
    timeline[bucketOf(e.t)] = Math.max(timeline[bucketOf(e.t)] ?? 0, alive);
    const acting = [e.actor, e.type === "message" && actors.has(e.from) ? e.from : undefined].filter(Boolean) as string[];
    for (const x of acting) {
      if (e.type !== "spawn" && !born.has(x)) err(`${e.id} (${e.type}) of ${x} before its spawn`);
      if (e.type !== "end" && died.has(x)) err(`${e.id} (${e.type}) of ${x} after its end`);
    }
    if (e.type === "message" && actors.has(e.to) && !born.has(e.to)) err(`${e.id}: message to ${e.to} before its spawn`);
    if (e.type === "message" && actors.has(e.to) && died.has(e.to) && !e.dropped) err(`${e.id}: message to ${e.to} after its end, not marked dropped`);
    const ids = a ? stateIds.get(a.chart) : undefined;
    if (ids) {
      const states = [...(e.type === "config" ? e.active : []), ...(e.type === "transition" ? [...e.from, ...e.to, ...(e.source ? [e.source] : [])] : [])];
      for (const s of states) if (!ids.has(s)) err(`${e.id} ${e.type} of ${e.actor}: unknown state ${s}`);
    }
    if (e.type === "transition" && (!Array.isArray(e.from) || !Array.isArray(e.to) || typeof e.event !== "string")) err(`${e.id}: malformed transition`);
    if (e.type === "message") {
      for (const x of [e.from, e.to]) if (!endpoint(x)) err(`${e.id}: unknown endpoint ${x}`);
      if (typeof e.name !== "string") err(`${e.id}: message without name`);
      const k = `${e.from} → ${e.to}`;
      pairs[k] = (pairs[k] ?? 0) + 1;
    }
    if (e.type === "snapshot") {
      const decl = new Set((trace.charts[a?.chart]?.datamodel ?? []).map((d: Any) => d.id));
      for (const k of Object.keys(e.values)) if (!decl.has(k)) err(`${e.id}: snapshot of undeclared ${k}`);
    }
    if (e.type === "data" && typeof e.summary !== "string") err(`${e.id}: data without summary`);
    if (e.type === "caption" && typeof e.text !== "string") err(`${e.id}: caption without text`);
  });
  trace.events.forEach((e: Any, i: number) => {
    for (const k of ["cause", "via"]) if (e[k] !== undefined && !index.has(e[k])) err(`${e.id}.${k} unknown ${e[k]}`);
    if (e.cause !== undefined && !(index.get(e.cause)! < i)) err(`${e.id}.cause ${e.cause} is not earlier`);
    if (e.cause !== undefined && trace.events[index.get(e.cause)!]?.t > e.t) err(`${e.id}.cause ${e.cause} is later in time`);
  });
  for (const a of actors.values()) if (!born.has(a.id)) err(`actor ${a.id} never spawned`);
  // wiring and stories
  const charts = new Set(Object.keys(trace.charts));
  for (const w of trace.wiring ?? []) {
    for (const x of [w.from, w.to]) if (!charts.has(x) && !exts.has(x)) err(`wire endpoint unknown: ${x}`);
    if (w.fromState && !stateIds.get(w.from)?.has(w.fromState)) err(`wire ${w.from}.${w.fromState}: unknown state`);
  }
  for (const st of trace.stories ?? []) {
    if (st.steps.length < 1 || st.steps.length > 9) err(`story ${st.id}: ${st.steps.length} steps`);
    for (const step of st.steps) {
      if (!endpoint(step.actor)) err(`story ${st.id}: unknown actor ${step.actor}`);
      if (!step.events.length) err(`story ${st.id}: a step with no events`);
      for (const id of step.events) if (!index.has(id)) err(`story ${st.id}: unknown event ${id}`);
    }
  }
  if (size > 3.2e6) err(`trace is ${(size / 1e6).toFixed(2)} MB (budget ~3 MB)`);
  if (quiet) return errors;
  // summary
  const cov = (type: string) => {
    const es = trace.events.filter((e: Any) => e.type === type);
    const c = es.filter((e: Any) => e.cause).length;
    return `${c}/${es.length} (${Math.round((100 * c) / Math.max(1, es.length))}%)`;
  };
  const inferred = trace.events.filter((e: Any) => e.inferred).length;
  console.log(`── ${trace.system} (${trace.scenario}) ${file}`);
  console.log(`   ${(size / 1e6).toFixed(2)} MB, ${(trace.duration / 1000).toFixed(1)} s virtual, ${trace.events.length} events`);
  console.log(`   actors: ${actors.size} total, ${peak} alive at peak, ${died.size} ended; alive over time: ${timeline.map((n) => n ?? 0).join(" ")}`);
  const reasons: Record<string, number> = {};
  for (const e of trace.events) if (e.type === "end") reasons[e.reason ?? "?"] = (reasons[e.reason ?? "?"] ?? 0) + 1;
  console.log(`   ends by reason: ${JSON.stringify(reasons)}`);
  console.log(`   events by type: ${JSON.stringify(counts)}`);
  console.log(`   causes: transitions ${cov("transition")}, messages ${cov("message")}, spawns ${cov("spawn")}, data ${cov("data")}; inferred links ${inferred}`);
  console.log(`   externals: ${trace.externals.map((x: Any) => `${x.id} (${x.kind}${x.unused ? ", unused" : ""})`).join(", ")}`);
  console.log(`   charts:\n     ${chartStats.join("\n     ")}`);
  console.log("   messages by pair (top 15):");
  for (const [k, n] of Object.entries(pairs)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15))
    console.log(`     ${String(n).padStart(5)}  ${k}`);
  console.log(`   wires: ${trace.wiring?.length ?? 0} (${(trace.wiring ?? []).filter((w: Any) => w.count > 0).length} seen in the run); stories: ${trace.stories?.length ?? 0}`);
  return errors;
}

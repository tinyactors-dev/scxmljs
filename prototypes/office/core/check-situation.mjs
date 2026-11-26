// node core/check-situation.mjs [system ...] : the situation timeline per actor (playback seconds),
// for every system in data/index.json (or those named). Also checks a stripped copy of each trace
// (only the REQUIRED fields) loads.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createSim } from "./sim.js";
const dataDir = new URL("../data/", import.meta.url);
let names = process.argv.slice(2);
if (!names.length) names = readdirSync(dataDir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(new URL(`${d.name}/trace.json`, dataDir))).map((d) => d.name);
const short = { idle: "·", working: "W", waiting: "w", exception: "!", done: "D", absent: " " };
for (const name of names) {
  const trace = JSON.parse(readFileSync(new URL(`${name}/trace.json`, dataDir), "utf8"));
  const sim = createSim(trace);
  const people = sim.actors.filter((a) => !a.external);
  console.log(`\n== ${name}: ${people.length} actors, ${sim.actors.length - people.length} externals, ${trace.events.length} events, ${(sim.duration / 1000).toFixed(1)} s run, loop ${sim.playDuration.toFixed(1)} s`);
  const cols = 100, S = sim.playDuration;
  const shown = people.length > 24 ? people.slice(0, 24) : people;
  for (const a of shown) {
    let line = ""; for (let i = 0; i < cols; i++) { const t = sim.unwarp((i + 0.5) / cols * S); line += short[sim.situationAt(a.id, t).kind] ?? "?"; }
    const counts = {}; for (const s of sim.situations(a.id)) counts[s.kind] = (counts[s.kind] || 0) + 1;
    console.log(`${a.id.slice(0, 20).padEnd(20)} |${line}| ${Object.entries(counts).map(([k, v]) => k + ":" + v).join(" ")}`);
  }
  if (people.length > shown.length) console.log(`(${people.length - shown.length} more)`);
  // the same trace with only the required fields
  const keep = new Set(["spawn", "end", "config", "transition", "message", "data", "snapshot"]);
  const bare = { charts: Object.fromEntries(Object.entries(trace.charts).map(([k, c]) => [k, { root: c.root, datamodel: c.datamodel }])), actors: trace.actors, externals: trace.externals,
    events: trace.events.filter((e) => keep.has(e.type)).map(({ id, cause, via, inferred, ...e }) => e) };
  const b = createSim(bare); const kinds = {}; for (const a of b.actors) if (!a.external) for (const s of b.situations(a.id)) kinds[s.kind] = (kinds[s.kind] || 0) + 1;
  console.log(`bare trace: loads, loop ${b.playDuration.toFixed(1)} s, segments ${JSON.stringify(kinds)}`);
}
console.log("\nlegend: · idle  W working  w waiting  ! exception  D done  (blank) absent");

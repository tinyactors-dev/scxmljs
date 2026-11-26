// node core/check-sim.mjs : prints, for a few times, each actor's active leaves and messages in flight.
import { loadSim } from "./sim.js";
const sim = await loadSim(new URL("../data/llm-chat/trace.json", import.meta.url));
console.log("duration", sim.duration, "ms; one loop", sim.playDuration.toFixed(1), "s");
const leaves = (id, t) => { const a = sim.activeAt(id, t); const ch = sim.chartOf(id); if (!ch) return a; const kids = new Map(); const walk = (n) => { kids.set(n.id, n.children.map((c) => c.id)); n.children.forEach(walk); }; walk(ch.root); return a.filter((s) => !(kids.get(s) || []).some((k) => a.includes(k))); };
let bad = 0, prev = -1; for (let t = 0; t <= sim.duration; t += 0.5) { const s = sim.warp(t); if (s < prev - 1e-9) bad++; prev = s; if (Math.abs(sim.unwarp(s) - t) > 0.6) bad++; }
console.log("warp monotone & invertible:", bad === 0 ? "ok" : `${bad} problems`);
const FLIGHT = 0.9; // playback seconds a capsule spends in its tube before arriving
for (const t of [0, 1010.1, 1410, 1560.2, 2960.2, 6690, 9040, 11000, 13000]) {
  console.log(`\n== t=${t} ms  (playback ${sim.warp(t).toFixed(2)} s)`);
  for (const a of sim.actors.filter((a) => !a.external)) { const l = leaves(a.id, t); if (l.length) console.log(`  ${a.id.padEnd(22)} ${l.join(", ")}  ${JSON.stringify(Object.fromEntries(Object.entries(sim.valuesAt(a.id, t)).filter(([k]) => ["queue","hostBusy","turn","incoming","pending","running","packages"].includes(k)))).slice(0, 110)}`); }
  const s = sim.warp(t); const inFlight = sim.messagesBetween(t, sim.unwarp(s + 1.2)).filter((m) => sim.flight(m)[0] <= s);
  for (const m of inFlight) console.log(`  ~> ${m.id} ${m.from} -> ${m.to} ${m.name} (arrives ${m.at.toFixed(2)}, depth ${m.depth})`);
}

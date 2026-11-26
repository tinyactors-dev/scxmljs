// node core/check-plan.mjs [system|path/to/trace.json ...]: the floor plan as an ASCII map, and a
// check that nobody shares a seat at the same time and that no two groups or stations overlap.
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createSim } from "./sim.js";
import { makePlan, LEAVE } from "./plan.js";
const dataDir = new URL("../data/", import.meta.url);
let names = process.argv.slice(2);
if (!names.length) names = readdirSync(dataDir, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(new URL(`${d.name}/trace.json`, dataDir))).map((d) => d.name);
let bad = 0;
for (const name of names) {
  const file = name.endsWith(".json") ? name : new URL(`${name}/trace.json`, dataDir);
  const trace = JSON.parse(readFileSync(file, "utf8"));
  const cfgFile = name.endsWith(".json") ? null : new URL(`${name}/office.json`, dataDir);
  const cfg = cfgFile && existsSync(cfgFile) ? JSON.parse(readFileSync(cfgFile, "utf8")) : {};
  const sim = createSim(trace); const plan = makePlan(sim, cfg.plan || cfg);
  const R = plan.room; console.log(`\n== ${name}: room ${(R.x1 - R.x0).toFixed(1)} x ${(R.z1 - R.z0).toFixed(1)} m, hub ${plan.hub}, groups ${plan.groups.map((g) => `${g.id}[${g.slots}]`).join(" ")}`);
  console.log(`   stations: ${plan.stations.map((s) => `${s.id}(${s.kind})`).join(" ")}; machines: ${plan.machines.map((m) => `${m.id}->${m.owner}`).join(" ")}`);
  // ASCII map, 1 char = 1 m
  const Wd = Math.ceil(R.x1 - R.x0), Dp = Math.ceil(R.z1 - R.z0); const grid = Array.from({ length: Dp }, () => Array(Wd).fill(" "));
  const put = (x, z, ch) => { const i = Math.floor(z - R.z0), j = Math.floor(x - R.x0); if (grid[i] && j >= 0 && j < Wd) grid[i][j] = ch; };
  for (const g of plan.groups) for (let x = g.x - g.w / 2; x < g.x + g.w / 2; x += 1) for (let z = g.z - g.d / 2; z < g.z + g.d / 2; z += 1) put(x, z, g.kind === "hub" ? "#" : ".");
  for (const [k, s] of plan.seats) put(s.x, s.z, "o");
  for (const s of plan.stations) put(s.x, s.z, s.kind[0].toUpperCase());
  for (const m of plan.machines) put(m.x, m.z, "m");
  put(plan.door.x + 0.5, plan.door.z, "D"); put(plan.board.x + 0.5, plan.board.z, "B");
  console.log("   +" + "-".repeat(Wd) + "+"); for (const row of grid) console.log("   |" + row.join("") + "|"); console.log("   +" + "-".repeat(Wd) + "+");
  // seat sharing over time
  const occ = []; for (const a of sim.actors.filter((x) => !x.external)) sim.lifetimes(a.id).forEach(([b, e], i) => { const s = plan.seatOfLife(a.id, i); if (!s) { console.log("   NO SEAT", a.id); bad++; return; } occ.push({ id: a.id, x: s.x, z: s.z, s0: b <= 0 ? -1 : sim.warp(b), s1: e === Infinity ? Infinity : sim.warp(e) + (plan.vanishes(a.id, i) ? 0.5 : LEAVE) }); });
  let clash = 0; for (let i = 0; i < occ.length; i++) for (let j = i + 1; j < occ.length; j++) { const p = occ[i], q = occ[j]; if (p.id !== q.id && Math.hypot(p.x - q.x, p.z - q.z) < 0.5 && p.s0 < q.s1 && q.s0 < p.s1) { if (clash++ < 5) console.log(`   CLASH ${p.id} / ${q.id} at (${p.x.toFixed(1)},${p.z.toFixed(1)})`); } }
  const g = plan.groups; let ov = 0; for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) if (Math.abs(g[i].x - g[j].x) * 2 < g[i].w + g[j].w && Math.abs(g[i].z - g[j].z) * 2 < g[i].d + g[j].d) ov++;
  console.log(`   ${occ.length} lives, seat clashes ${clash}, group overlaps ${ov}`); bad += clash + ov;
}
process.exit(bad ? 1 : 0);

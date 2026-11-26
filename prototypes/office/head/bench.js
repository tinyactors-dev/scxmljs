// head/bench.js: what head/test.html and head/gallery.html share (not used by WORLD).
import { loadSim } from "../core/sim.js";

export const traceUrl = (system) => (system.startsWith("fixture:") ? new URL(`./fixtures/${system.slice(8)}/trace.json`, import.meta.url) : new URL(`../data/${system}/trace.json`, import.meta.url)).href;
export async function listSystems() {
  const out = [];
  try { const r = await fetch(new URL("../data/index.json", import.meta.url)); if (r.ok) { const j = await r.json(); for (const s of Array.isArray(j) ? j : j.systems || []) out.push(typeof s === "string" ? s : s.id || s.name); } } catch {}
  if (!out.length) out.push("llm-chat");
  try { const r = await fetch(new URL("./fixtures/index.json", import.meta.url)); if (r.ok) for (const s of await r.json()) out.push(`fixture:${s}`); } catch {}
  const cur = new URLSearchParams(location.search).get("system"); if (cur) out.push(cur);
  return [...new Set(out)];
}
export const loadSystem = (system) => loadSim(traceUrl(system));
export function lights(THREE, scene) {
  scene.add(new THREE.HemisphereLight(0xfff3dd, 0x30343e, 1.25));
  const sun = new THREE.DirectionalLight(0xffffff, 1.7); sun.position.set(4, 10, 7); scene.add(sun);
  const fill = new THREE.DirectionalLight(0x9fc3ff, 0.5); fill.position.set(-6, 3, -4); scene.add(fill);
}
// one actor per distinct chart: the busiest
export function actorsByChart(sim) {
  const count = new Map();
  for (const e of sim.eventsBetween(-1, sim.duration + 10)) if (e.type === "transition") count.set(e.actor, (count.get(e.actor) || 0) + 1);
  const best = new Map();
  for (const a of sim.actors) if (!a.external && a.chart && sim.chartOf(a.id)) { const b = best.get(a.chart); if (!b || (count.get(a.id) || 0) > (count.get(b.id) || 0)) best.set(a.chart, a); }
  return [...best.values()];
}
// a moment worth looking at: alive, about 60 % through its transitions
export function busyTime(sim, id) {
  const trs = sim.eventsBetween(-1, sim.duration + 10).filter((e) => e.type === "transition" && e.actor === id);
  if (!trs.length) return 0;
  const e = trs[Math.min(trs.length - 1, Math.floor(trs.length * 0.6))];
  const s = sim.warp(e.at) + 0.9; const t = sim.unwarp(s);
  return sim.alive(id, t) ? t : e.at;
}

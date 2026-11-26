// node head/perf.mjs [system] [actor] : builds a head in Node (a stub canvas) and times update(); checks stillness
import * as THREE from "../vendor/three/three.module.js";
import { loadSim } from "../core/sim.js";
import { createHead } from "./head.js";
const ctx = new Proxy({ measureText: (s) => ({ width: String(s).length * 34 }), createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }) }, { get: (o, k) => (k in o ? o[k] : () => {}), set: () => true });
globalThis.document = { createElement: () => ({ width: 1, height: 1, getContext: () => ctx }) };
const system = process.argv[2] || "single-microwave";
const sim = await loadSim(new URL(`../data/${system}/trace.json`, import.meta.url));
const ids = process.argv[3] ? [process.argv[3]] : [sim.actors.find((a) => !a.external && sim.chartOf(a.id)).id];
for (const id of ids) {
  let t0 = performance.now(); const h = createHead({ THREE, sim, actorId: id }); const tc = performance.now() - t0;
  const T = sim.duration; const res = {};
  for (const d of [0, 0.57, 1]) {
    h.setDetail(d); for (let i = 0; i < 40; i++) h.update((i / 40) * T, 1 / 60); // warm
    t0 = performance.now(); const N = 300; for (let i = 0; i < N; i++) h.update((i / N) * T, 1 / 60); res[d] = +((performance.now() - t0) / N).toFixed(3);
  }
  // a zoom: detail changes every frame
  t0 = performance.now(); for (let i = 0; i < 120; i++) { h.setDetail(i / 119); h.update(T * 0.4, 1 / 60); } const zoom = +((performance.now() - t0) / 120).toFixed(3);
  console.log(id, "create", tc.toFixed(0), "ms; update ms by detail", JSON.stringify(res), "zooming", zoom, JSON.stringify(h.stats()), "affordances", h.affordances().map((a) => `${a.event}:${a.from}->${a.to}`).join(" "));
}

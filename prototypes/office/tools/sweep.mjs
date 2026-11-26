// node tools/sweep.mjs <outdir> [system...]: for every system (data/index.json), four stills of the live
// page: the overview, an eye-level view of the busiest person, the view a click on them leaves, and the
// view after leaving their head; plus a contact sheet per system and console errors / failed requests.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs"; import { execFileSync } from "node:child_process"; import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const [OUT, ...only] = process.argv.slice(2); mkdirSync(OUT, { recursive: true });
const systems = only.length ? only : JSON.parse(readFileSync(path.join(here, "../data/index.json"), "utf8")).systems.map((s) => s.id);
const pick = `api.tick(0.05); const s = api.getPlay(); const t = api.sim.unwarp(s); let best = null, bn = -1;
  for (const seat of api.people.seats.values()) { const o = seat.current; if (!o || !seat.avatar.root.visible) continue; const n = api.sim.transitionsBetween(t - 8000, t + 8000).filter((x) => x.actor === o.id).length + (seat.P && seat.P.sit > 0.5 ? 1 : 0); if (n > bn) { bn = n; best = o.id; } }
  window.__who = best; window.__shotInfo = best;`;
const spec = [
  { name: "1-overview", s: "S", js: `api.reset(); api.home(0.01); ${pick}`, tick: 0.3 },
  { name: "2-eye", s: "S", js: `const id = window.__who; const seat = api.people.seatOfActor(id, api.getPlay()); const r = seat.avatar.root; const f = r.rotation.y; const c = Math.cos(f), sn = Math.sin(f); const W = (x, y, z) => new api.camera.position.constructor(r.position.x + x * c + z * sn, y, r.position.z - x * sn + z * c); api.camera.position.copy(api.rig.resolve(W(-0.9, 1.6, 2.7))); api.controls.target.copy(W(0, 1.25, 0.3)); api.controls.update(); window.__shotInfo = id;`, tick: 0.1 },
  { name: "3-click", s: "S", js: `api.reset(); api.select(window.__who); window.__shotInfo = window.__who;`, tick: 2.0 },
  { name: "4-left-head", s: "S", js: `api.enterHead();`, tick: 3.0, js2: `api.back();`, tick2: 3.2 },
];
for (const sys of systems) {
  const dir = path.join(OUT, sys); mkdirSync(dir, { recursive: true });
  // the playhead: 40 % into the loop (read from the page by the first shot's js)
  const sp = spec.map((x) => ({ ...x, s: undefined, js: (x.name === "1-overview" ? "api.setPlay(window.state().loop * 0.4); " : "") + x.js }));
  const f = path.join(dir, "spec.json"); writeFileSync(f, JSON.stringify(sp));
  let out = ""; try { out = execFileSync("node", [path.join(here, "shoot.mjs"), sys, dir, "@" + f], { encoding: "utf8", timeout: 400000 }); } catch (e) { out = (e.stdout || "") + "\nFAILED " + e.message; }
  console.log(`== ${sys}\n` + out.split("\n").filter((l) => /shot|errors|ERR|HTTP|FAILED|page:/.test(l)).join("\n"));
  try { execFileSync("montage", [...spec.map((x) => path.join(dir, x.name + ".png")), "-tile", "4x1", "-geometry", "640x360+2+2", "-title", sys, path.join(OUT, `${sys}.png`)]); } catch {}
}

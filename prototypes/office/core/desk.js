// core/desk.js: which variables sit on a chart's desk, and as what. Pure.
// Score = how often the value changes in the run (over every actor of the chart) + 2 x how many
// states' guards/expressions read it (readBy, when the trace has it). Variables that never change
// are left off unless nothing changes. Type: declared, else the first non-null value seen.
export function typeOf(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return "array";
  return { number: "number", boolean: "boolean", string: "string", object: "object" }[typeof v] || "string";
}

export function pickVariables(sim, chartName, { max = 4, prefer = null } = {}) {
  const chart = sim.trace.charts[chartName]; if (!chart) return [];
  const actors = sim.actors.filter((a) => !a.external && a.chart === chartName);
  const decl = new Map((chart.datamodel || []).map((d) => [d.id, d]));
  const changes = new Map(), firstType = new Map();
  for (const a of actors) {
    let prev = {};
    for (const e of sim.eventsBetween(-1, sim.duration + 1)) {
      if (e.actor !== a.id) continue;
      const vals = e.type === "snapshot" ? e.values : e.type === "data" && "value" in e ? { [e.key]: e.value } : null;
      if (!vals) continue;
      for (const [k, v] of Object.entries(vals)) {
        const s = JSON.stringify(v);
        if (k in prev && prev[k] !== s) changes.set(k, (changes.get(k) || 0) + 1);
        prev[k] = s; if (!firstType.has(k) && typeOf(v)) firstType.set(k, typeOf(v));
        if (!decl.has(k)) decl.set(k, { id: k });
      }
    }
  }
  const typeFor = (d) => { const t = d.type && d.type !== "null" && d.type !== "unknown" ? d.type : firstType.get(d.id); return t || firstType.get(d.id) || "string"; };
  let vars = [...decl.values()].map((d) => ({ id: d.id, type: typeFor(d), score: (changes.get(d.id) || 0) + 2 * ((d.readBy || []).length), changes: changes.get(d.id) || 0 }));
  if (prefer && prefer.length) return prefer.map((id) => vars.find((v) => v.id === id) || { id, type: firstType.get(id) || "string" }).slice(0, max);
  const changing = vars.filter((v) => v.changes > 0);
  vars = (changing.length ? changing : vars).sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
  return vars.slice(0, max);
}

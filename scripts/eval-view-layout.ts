/**
 * Evaluates <scxml-view>'s layout: the in-house hierarchical layout
 * (packages/scxmljs/src/view/layout.ts) against ELK (elkjs, layered,
 * hierarchical, orthogonal routing) on the playground's sample charts and a
 * few W3C conformance charts. Prints a metrics table; with --svg DIR writes
 * one SVG per chart and algorithm for looking at.
 *
 *   bun scripts/eval-view-layout.ts [--svg DIR]
 *
 * Metrics (lower is better, except where noted):
 *   crossings   pairs of edge segments that cross
 *   intrusions  edge segments passing through a box that isn't their source,
 *               target or one of their ancestors
 *   overlaps    labels overlapping boxes or other labels
 *   area        width × height of the whole drawing (kpx²)
 *   bends       total bend points
 *   ms          layout time (median of 5)
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { $ } from "bun";
import { Window } from "happy-dom";
import { supportDeskChart } from "../examples/playground/src/explorer/support-desk-generator.ts";
import type { Model, StateNode, TransitionNode } from "../packages/scxmljs/src/model.ts";
import { compile, parseSCXML } from "../packages/scxmljs/src/trusted.ts";
import { type ChartLayout, layoutChart, type Point, type Rect } from "../packages/scxmljs/src/view/layout.ts";

const root = new URL("..", import.meta.url).pathname;
const svgDir = process.argv.includes("--svg") ? process.argv[process.argv.indexOf("--svg") + 1] : undefined;
const domParser = new new Window().DOMParser() as unknown as { parseFromString(s: string, t: string): Document };

// ── the same size model the element uses by default (estimates; the element measures real text) ──
export const labelText = (t: TransitionNode) => {
  const ev = t.events.join(" ");
  const cond = t.cond ? `[${t.cond.length > 22 ? `${t.cond.slice(0, 21)}…` : t.cond}]` : "";
  return [ev, cond].filter(Boolean).join(" ");
};
const measure = (s: StateNode, collapsed: boolean) => {
  const name = s.generatedId ? `(${s.kind})` : s.id;
  if (s.kind === "history") return { w: 26, h: 26 };
  const internal = s.transitions.filter((t) => !t.targets.length).length;
  const w = Math.max(64, name.length * 7.6 + 28);
  if (collapsed) return { w: w + 40, h: 48 };
  const isContainer = s.kind === "scxml" || s.kind === "parallel" || s.children.length > 0;
  if (isContainer) return { w, h: 30 + Math.min(internal, 3) * 20 };
  return { w, h: 36 + Math.min(internal, 3) * 20 };
};
const labelSize = (t: TransitionNode) => {
  const text = labelText(t);
  return text ? { w: text.length * 6.9 + 14, h: 20 } : { w: 0, h: 0 };
};

// ── charts ──
const charts: { name: string; source: string }[] = [];
for (const f of ["github-issues", "fulfillment", "fulfillment-payment", "fulfillment-shipping"])
  charts.push({ name: f, source: readFileSync(`${root}examples/playground/charts/${f}.scxml`, "utf8") });
// support-desk: its (small) invoked child machines, and the 333-state root (collapsed by the element)
const desk = supportDeskChart();
const deskDoc = domParser.parseFromString(desk, "application/xml");
const children = Array.from(deskDoc.getElementsByTagName("scxml")).slice(1, 4);
children.forEach((el, i) => {
  charts.push({ name: `support-desk-child-${i + 1}`, source: new new Window().XMLSerializer().serializeToString(el as never) });
});
for (const id of ["144", "364", "403a", "504", "533"]) {
  const dir = `${root}conformance/ecma/${id.replace(/[a-z]$/, "")}`;
  const file = readdirSync(dir).find((f) => f.startsWith(`test${id}`) && f.endsWith(".scxml"));
  if (file) charts.push({ name: `w3c-${id}`, source: readFileSync(`${dir}/${file}`, "utf8") });
}

// ── metrics ──
interface Drawing {
  width: number;
  height: number;
  boxes: { node: StateNode; rect: Rect; leaf: boolean }[];
  edges: { from: StateNode; to: StateNode; points: Point[]; label?: Rect }[];
}
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
const segCross = (p1: Point, p2: Point, p3: Point, p4: Point) => {
  const d = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return d1 * d2 < -1e-6 && d3 * d4 < -1e-6;
};
const segHitsRect = (a: Point, b: Point, r: Rect) => {
  // orthogonal segments (and short diagonals) vs an inset rectangle
  const inset = { x: r.x + 2, y: r.y + 2, w: r.w - 4, h: r.h - 4 };
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return maxX > inset.x && minX < inset.x + inset.w && maxY > inset.y && minY < inset.y + inset.h;
};
const ancestors = (s: StateNode) => {
  const out = new Set<StateNode>();
  for (let n: StateNode | null = s; n; n = n.parent) out.add(n);
  return out;
};
function metrics(d: Drawing) {
  let crossings = 0;
  let intrusions = 0;
  let overlapsN = 0;
  let bends = 0;
  const segs = d.edges.map((e) => e.points.slice(1).map((p, i) => [e.points[i]!, p] as const));
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++)
      for (const [a, b] of segs[i]!) for (const [c, e] of segs[j]!) if (segCross(a, b, c, e)) crossings++;
  for (const [i, e] of d.edges.entries()) {
    bends += Math.max(0, e.points.length - 2);
    const skip = new Set([...ancestors(e.from), ...ancestors(e.to)]);
    for (const box of d.boxes) {
      if (!box.leaf || skip.has(box.node)) continue;
      if (segs[i]!.some(([a, b]) => segHitsRect(a, b, box.rect))) {
        intrusions++;
        if (process.env.DEBUG_INTRUSIONS) console.error(`intrusion: ${e.from.id} → ${e.to.id} through ${box.node.id}`);
      }
    }
  }
  const labels = d.edges.map((e) => e.label).filter((l): l is Rect => !!l);
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) if (overlaps(labels[i]!, labels[j]!)) overlapsN++;
    for (const b of d.boxes) if (b.leaf && overlaps(labels[i]!, b.rect)) overlapsN++;
  }
  return { crossings, intrusions, overlaps: overlapsN, area: Math.round((d.width * d.height) / 1000), bends };
}

// ── in-house ──
const leafKinds = new Set(["atomic", "final", "history", "collapsed"]);
function inHouse(model: Model): Drawing {
  const l: ChartLayout = layoutChart(model.root, { measure, labelSize });
  return {
    width: l.width,
    height: l.height,
    boxes: l.boxes.map((b) => ({ node: b.node, rect: b.rect, leaf: leafKinds.has(b.kind) })),
    edges: l.edges.map((e) => ({ from: e.from, to: e.to, points: e.points, label: e.label })),
  };
}

// ── ELK (laid out by scripts/elk-layout.mjs under Node) ──
type ElkOut = { id: string; x: number; y: number; width: number; height: number; children?: ElkOut[] };
type ElkResult = {
  children: ElkOut[];
  edges: {
    sources: string[];
    targets: string[];
    container?: string;
    sections?: { startPoint: Point; endPoint: Point; bendPoints?: Point[] }[];
    labels?: { x: number; y: number; width: number; height: number }[];
  }[];
};
function elkGraph(model: Model) {
  const byId = new Map<string, StateNode>();
  const node = (s: StateNode): Record<string, unknown> => {
    byId.set(s.id || "__root", s);
    const kids = s.kind === "parallel" ? s.children : [...s.children, ...s.history];
    const m = measure(s, false);
    const isContainer = kids.length > 0;
    return {
      id: s.id || "__root",
      ...(isContainer ? {} : { width: m.w, height: m.h }),
      layoutOptions: isContainer ? { "elk.padding": `[top=${s.kind === "scxml" ? 14 : m.h + 14},left=14,bottom=14,right=14]` } : {},
      children: kids.map(node),
    };
  };
  const graph = {
    id: "g",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": "44",
      "elk.spacing.nodeNode": "18",
      "elk.spacing.edgeNode": "10",
      "elk.spacing.edgeEdge": "10",
      "elk.edgeLabels.inline": "true",
    },
    children: [node(model.root)],
    edges: [] as Record<string, unknown>[],
  };
  let n = 0;
  for (const s of model.states)
    for (const t of s.transitions)
      for (const target of t.targets) {
        if (target === s) continue;
        const size = labelSize(t);
        graph.edges.push({
          id: `e${n++}`,
          sources: [s.id || "__root"],
          targets: [target.id || "__root"],
          labels: size.w ? [{ text: labelText(t), width: size.w, height: size.h }] : [],
        });
      }
  return { graph, byId };
}
function fromElk(out: ElkResult, byId: Map<string, StateNode>): Drawing {
  const absPos = new Map<string, Rect>();
  const visit = (e: ElkOut, ox: number, oy: number) => {
    const r = { x: ox + e.x, y: oy + e.y, w: e.width, h: e.height };
    absPos.set(e.id, r);
    for (const c of e.children ?? []) visit(c, r.x, r.y);
  };
  for (const c of out.children) visit(c, 0, 0);
  const rootRect = absPos.get("__root")!;
  const boxes = [...absPos].map(([id, rect]) => {
    const s = byId.get(id)!;
    const kids = s.kind === "parallel" ? s.children : [...s.children, ...s.history];
    return { node: s, rect, leaf: kids.length === 0 };
  });
  const edges = out.edges.map((e) => {
    const off = e.container && e.container !== "g" ? absPos.get(e.container)! : { x: 0, y: 0 };
    const sec = e.sections?.[0];
    const pts = sec ? [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint].map((p) => ({ x: p.x + off.x, y: p.y + off.y })) : [];
    const lab = e.labels?.[0];
    return {
      from: byId.get(e.sources[0]!)!,
      to: byId.get(e.targets[0]!)!,
      points: pts,
      label: lab ? { x: lab.x + off.x, y: lab.y + off.y, w: lab.width, h: lab.height } : undefined,
    };
  });
  return { width: rootRect.w, height: rootRect.h, boxes, edges };
}

// ── svg (for looking) ──
function svg(d: Drawing, title: string) {
  const parts: string[] = [];
  for (const b of d.boxes)
    parts.push(
      `<rect x="${b.rect.x}" y="${b.rect.y}" width="${b.rect.w}" height="${b.rect.h}" rx="5" fill="${b.leaf ? "#fff" : "rgba(60,80,200,.04)"}" stroke="#667" stroke-width="1"/>` +
        `<text x="${b.rect.x + 8}" y="${b.rect.y + 17}" font-family="system-ui" font-size="12" font-weight="600">${b.node.id || title}</text>`,
    );
  for (const e of d.edges) {
    if (e.points.length)
      parts.push(
        `<polyline points="${e.points.map((p) => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="#3d5bd9" stroke-width="1.3" marker-end="url(#a)"/>`,
      );
    if (e.label)
      parts.push(`<rect x="${e.label.x}" y="${e.label.y}" width="${e.label.w}" height="${e.label.h}" rx="9" fill="#eef" stroke="#99c"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${d.width + 20}" height="${d.height + 20}" viewBox="-10 -10 ${d.width + 20} ${d.height + 20}"><defs><marker id="a" viewBox="0 0 10 6" refX="10" refY="3" markerWidth="10" markerHeight="6" orient="auto"><path d="M0 0L10 3L0 6z" fill="#3d5bd9"/></marker></defs><rect x="-10" y="-10" width="100%" height="100%" fill="#f6f6f8"/>${parts.join("")}</svg>`;
}

// ── run ──
const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const rows: string[][] = [];
const totals = {
  house: { crossings: 0, intrusions: 0, overlaps: 0, area: 0, bends: 0, ms: 0 },
  elk: { crossings: 0, intrusions: 0, overlaps: 0, area: 0, bends: 0, ms: 0 },
};
const models = await Promise.all(charts.map(async (c) => (await compile(parseSCXML(c.source, domParser))) as Model));
const graphs = models.map(elkGraph);
const elkOut: { graph: ElkResult; ms: number }[] = JSON.parse(
  await $`node ${root}scripts/elk-layout.mjs < ${new Response(JSON.stringify(graphs.map((g) => g.graph)))}`.text(),
);
for (const [ci, chart] of charts.entries()) {
  const model = models[ci]!;
  const states = model.states.filter((s) => s.kind !== "scxml").length;
  const tHouse: number[] = [];
  let house!: Drawing;
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    house = inHouse(model);
    tHouse.push(performance.now() - t0);
  }
  const elkD = fromElk(elkOut[ci]!.graph, graphs[ci]!.byId);
  const mh = { ...metrics(house), ms: median(tHouse) };
  const me = { ...metrics(elkD), ms: elkOut[ci]!.ms };
  for (const k of Object.keys(totals.house) as (keyof typeof totals.house)[]) {
    totals.house[k] += mh[k];
    totals.elk[k] += me[k];
  }
  const fmt = (m: typeof mh) => [m.crossings, m.intrusions, m.overlaps, m.area, m.bends, m.ms.toFixed(1)].map(String);
  rows.push([chart.name, String(states), ...fmt(mh), ...fmt(me)]);
  if (svgDir) {
    writeFileSync(`${svgDir}/${chart.name}.inhouse.svg`, svg(house, chart.name));
    writeFileSync(`${svgDir}/${chart.name}.elk.svg`, svg(elkD, chart.name));
  }
}
const head = ["chart", "states", "cross", "intr", "ovl", "area", "bends", "ms", "ELK cross", "intr", "ovl", "area", "bends", "ms"];
const all = [
  head,
  ...rows,
  [
    "TOTAL",
    "",
    ...[totals.house, totals.elk].flatMap((t) => [t.crossings, t.intrusions, t.overlaps, t.area, t.bends, t.ms.toFixed(1)].map(String)),
  ],
];
const widths = head.map((_, i) => Math.max(...all.map((r) => r[i]!.length)));
for (const r of all) console.log(r.map((c, i) => (i === 0 ? c.padEnd(widths[i]!) : c.padStart(widths[i]!))).join("  "));

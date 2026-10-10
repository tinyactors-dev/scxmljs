/**
 * How well `<scxml-view>`'s layout uses space, over every chart in the repo
 * (examples, site charts, docs examples, the W3C suite): size, how much of the
 * area the state boxes fill, edge length and bends, and overlaps that should
 * never happen. Boxes and labels are sized with the element's estimates, so
 * the numbers are deterministic and need no browser.
 *
 *   bun scripts/layout-metrics.ts                 table of the named charts + totals
 *   bun scripts/layout-metrics.ts --all           every chart
 *   bun scripts/layout-metrics.ts --json out.json write everything, to compare runs
 *   bun scripts/layout-metrics.ts --max-width 550 …  as laid out for a phone
 *   bun scripts/layout-metrics.ts --compare a.json b.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { Glob } from "bun";
import { Window } from "happy-dom";
import { compile, type StateNode, type TransitionNode } from "../packages/scxmljs/src/model.ts";
import { parseSCXML } from "../packages/scxmljs/src/session.ts";
import { type ChartLayout, type Direction, layoutChart, portalTransitions, type Rect } from "../packages/scxmljs/src/view/layout.ts";

const ROOT = join(import.meta.dir, "..");
const GLOBS = [
  "examples/playground/charts/*.scxml",
  "examples/llm-chat/charts/*.scxml",
  "examples/pi-durable/charts/*.scxml",
  "site/charts/*.scxml",
  "docs/examples/*.scxml",
  "conformance/ecma/*/*.scxml",
];
/** The charts the table shows by default: the ones people look at. */
const NAMED = /^(examples|site|docs)\//;

export interface Metrics {
  /** transitions listed in their source's box instead of drawn */
  portals: number;
  chart: string;
  direction: Direction;
  boxes: number;
  width: number;
  height: number;
  /** natural leaf box area (as measured, before the layout widens any) / diagram area */
  fill: number;
  /** total edge length, px */
  edgeLength: number;
  bends: number;
  /** pairs of sibling boxes that overlap, labels on boxes: both should be 0 */
  boxOverlaps: number;
  labelOverlaps: number;
  /** mean distance from a label to the box its transition leaves, px */
  labelDistance: number;
}

const parser = new new Window().DOMParser() as unknown as DOMParser;

// the element's size estimates (src/view/element.ts: estimateBox, estimateLabel, #measure)
const labelText = (t: TransitionNode) => [t.events.join(" "), t.cond ? `[${t.cond.slice(0, 21)}]` : ""].filter(Boolean).join(" ");
const labelSize = (t: TransitionNode) => {
  const text = labelText(t);
  return text ? { w: Math.ceil(text.length * 6.8 + 18), h: 20 } : { w: 0, h: 0 };
};
let portals = new Set<TransitionNode>();
/** `--max-width N`: lay out for an element that fits N px at the smallest automatic scale (a phone: ~550) */
const maxAt = process.argv.indexOf("--max-width");
const MAX_WIDTH = maxAt >= 0 ? Number(process.argv[maxAt + 1]) : undefined;
function measure(s: StateNode, collapsed: boolean) {
  if (s.kind === "scxml") return { w: 0, h: 0 };
  if (s.kind === "history") return { w: 26, h: 26 };
  const name = s.generatedId ? s.kind : s.id;
  const far = s.transitions.filter((t) => portals.has(t));
  const internal = [...far, ...s.transitions.filter((t) => !t.targets.length).slice(0, 3)];
  const targetW = (t: TransitionNode) => (portals.has(t) ? t.targets.map((x) => x.id).join(", ").length * 6.8 + 16 : 0);
  const chipsW = internal.reduce((w, t) => w + labelSize(t).w + targetW(t) + 4, 0);
  const container = !collapsed && (s.kind === "parallel" || s.children.length > 0);
  const icons = 22 + (container || collapsed ? 18 : 0);
  const w = Math.max(64, name.length * 7.6 + 34 + icons + (s.kind === "parallel" ? 16 : 0), Math.min(chipsW, 260) + 22);
  const rows = internal.length ? Math.ceil(Math.max(chipsW, 1) / 260) : 0;
  if (container) return { w, h: 26 + rows * 24 };
  return { w: collapsed ? Math.max(w, 120) : w, h: Math.max(34, 34 + rows * 24) + (collapsed ? 50 : 0) };
}

const overlap = (a: Rect, b: Rect, slack = 0.5) =>
  a.x + slack < b.x + b.w && b.x + slack < a.x + a.w && a.y + slack < b.y + b.h && b.y + slack < a.y + a.h;

export function metrics(chart: string, layout: ChartLayout): Metrics {
  const boxes = layout.boxes.filter((b) => b.kind !== "root");
  const leaves = boxes.filter((b) => !boxes.some((k) => k.node.parent === b.node));
  const area = layout.width * layout.height || 1;
  let edgeLength = 0;
  let bends = 0;
  for (const e of layout.edges) {
    bends += Math.max(0, e.points.length - 2);
    for (let i = 1; i < e.points.length; i++)
      edgeLength += Math.abs(e.points[i]!.x - e.points[i - 1]!.x) + Math.abs(e.points[i]!.y - e.points[i - 1]!.y);
  }
  let boxOverlaps = 0;
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (boxes[i]!.node.parent === boxes[j]!.node.parent && overlap(boxes[i]!.rect, boxes[j]!.rect)) boxOverlaps++;
  let labelDistance = 0;
  let labelled = 0;
  for (const e of layout.edges) {
    const r = boxes.find((b) => b.node === e.from)?.rect;
    if (!e.label || !r) continue;
    const cx = e.label.x + e.label.w / 2;
    const cy = e.label.y + e.label.h / 2;
    labelDistance += Math.hypot(Math.max(r.x - cx, 0, cx - r.x - r.w), Math.max(r.y - cy, 0, cy - r.y - r.h));
    labelled++;
  }
  let labelOverlaps = 0;
  for (const e of layout.edges) if (e.label && leaves.some((b) => overlap(b.rect, e.label!, 1))) labelOverlaps++;
  return {
    chart,
    portals: portals.size,
    direction: layout.direction,
    boxes: boxes.length,
    width: Math.round(layout.width),
    height: Math.round(layout.height),
    fill:
      leaves.reduce((s, b) => {
        const n = b.kind === "collapsed" ? measure(b.node, true) : measure(b.node, false);
        return s + n.w * n.h;
      }, 0) / area,
    edgeLength: Math.round(edgeLength),
    bends,
    boxOverlaps,
    labelOverlaps,
    labelDistance: labelled ? labelDistance / labelled : 0,
  };
}

async function measureAll(): Promise<Metrics[]> {
  const files: string[] = [];
  for (const g of GLOBS) for await (const f of new Glob(g).scan(ROOT)) files.push(f);
  files.sort();
  const out: Metrics[] = [];
  for (const file of files) {
    let model: Awaited<ReturnType<typeof compile>>;
    try {
      model = await compile(parseSCXML(readFileSync(join(ROOT, file), "utf8"), parser), { loader: async () => "" });
    } catch {
      continue; // charts that need files we don't provide
    }
    portals = process.env.NO_PORTALS ? new Set() : portalTransitions(model.root);
    for (const direction of ["down", "right"] as const)
      out.push(
        metrics(relative(ROOT, join(ROOT, file)), layoutChart(model.root, { direction, measure, labelSize, portals, maxWidth: MAX_WIDTH })),
      );
  }
  return out;
}

function totals(list: Metrics[]) {
  const n = list.length || 1;
  return {
    charts: list.length,
    area: list.reduce((s, m) => s + m.width * m.height, 0),
    meanFill: list.reduce((s, m) => s + m.fill, 0) / n,
    edgeLength: list.reduce((s, m) => s + m.edgeLength, 0),
    bends: list.reduce((s, m) => s + m.bends, 0),
    boxOverlaps: list.reduce((s, m) => s + m.boxOverlaps, 0),
    labelOverlaps: list.reduce((s, m) => s + m.labelOverlaps, 0),
    labelDistance: list.reduce((s, m) => s + (m.labelDistance ?? 0), 0) / n,
  };
}

function table(list: Metrics[]) {
  const rows = list.map((m) => [
    basename(m.chart),
    m.direction,
    String(m.boxes),
    `${m.width}×${m.height}`,
    `${(m.fill * 100).toFixed(0)}%`,
    String(m.edgeLength),
    String(m.bends),
    m.boxOverlaps || m.labelOverlaps ? `${m.boxOverlaps}/${m.labelOverlaps}` : "",
  ]);
  const head = ["chart", "dir", "boxes", "size", "fill", "edges px", "bends", "overlaps"];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (r: string[]) => r.map((c, i) => (i < 2 ? c.padEnd(w[i]!) : c.padStart(w[i]!))).join("  ");
  console.log(line(head));
  for (const r of rows) console.log(line(r));
}

function summary(label: string, list: Metrics[]) {
  for (const dir of ["down", "right"] as const) {
    const t = totals(list.filter((m) => m.direction === dir));
    console.log(
      `${label} ${dir.padEnd(5)}: ${t.charts} charts, area ${(t.area / 1e6).toFixed(2)} Mpx², mean fill ${(t.meanFill * 100).toFixed(1)}%, edges ${t.edgeLength} px, ${t.bends} bends, overlaps ${t.boxOverlaps} boxes / ${t.labelOverlaps} labels, labels ${t.labelDistance.toFixed(1)} px from their source`,
    );
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args[0] === "--compare") {
    const read = (f: string) => JSON.parse(readFileSync(f, "utf8")) as Metrics[];
    const a = read(args[1]!);
    const b = read(args[2]!);
    const key = (m: Metrics) => `${m.chart}|${m.direction}`;
    const before = new Map(a.map((m) => [key(m), m]));
    const rows = b
      .map((m) => ({ m, o: before.get(key(m)) }))
      .filter((r): r is { m: Metrics; o: Metrics } => !!r.o && NAMED.test(r.m.chart))
      .map(({ m, o }) => {
        const da = (m.width * m.height) / (o.width * o.height) - 1;
        return `${basename(m.chart).padEnd(28)} ${m.direction.padEnd(5)} ${`${o.width}×${o.height}`.padStart(10)} → ${`${m.width}×${m.height}`.padEnd(10)} area ${da >= 0 ? "+" : ""}${(da * 100).toFixed(0).padStart(3)}%  fill ${(o.fill * 100).toFixed(0)}% → ${(m.fill * 100).toFixed(0)}%`;
      });
    for (const r of rows) console.log(r);
    summary("before", a);
    summary("after ", b);
  } else {
    const all = await measureAll();
    const jsonAt = args.indexOf("--json");
    if (jsonAt >= 0) writeFileSync(args[jsonAt + 1]!, JSON.stringify(all, null, 1));
    table(args.includes("--all") ? all : all.filter((m) => NAMED.test(m.chart)));
    summary(
      "named",
      all.filter((m) => NAMED.test(m.chart)),
    );
    summary("all  ", all);
  }
  process.exit(0);
}

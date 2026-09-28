/**
 * The `<scxml-view>` layout, as plain data: every chart in the playground
 * lays out without overlapping siblings, boxes nest inside their parents,
 * edges start and end on their boxes, results are deterministic, and
 * autoCollapse folds large charts under a budget.
 */
import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { Window } from "happy-dom";
import { compile, type Model, parseSCXML, type StateNode } from "../src/index.ts";
import { autoCollapse, type ChartLayout, type Direction, layoutChart, type Rect } from "../src/view/layout.ts";

const domParser = new new Window().DOMParser() as unknown as DOMParser;
const NS = `xmlns="http://www.w3.org/2005/07/scxml" version="1.0" datamodel="ecmascript"`;
const CHARTS = new URL("../../../examples/playground/charts/", import.meta.url).pathname;

const load = async (text: string): Promise<Model> =>
  compile(parseSCXML(text, domParser), { loader: async (src) => Bun.file(`${CHARTS}${src.replace(/^.*\//, "")}`).text() });

const byId = (m: Model, id: string) => m.states.find((s) => s.id === id)!;

const lay = (model: Model, direction: Direction = "right", collapsed?: Set<StateNode>) =>
  layoutChart(model.root, {
    direction,
    collapsed,
    measure: (s, folded) => ({ w: Math.max(64, s.id.length * 7.6 + 28), h: folded ? 48 : s.children.length ? 30 : 36 }),
    labelSize: (t) => ({ w: t.events.join(" ").length * 6.9 + 14, h: 20 }),
  });

const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
const inside = (a: Rect, b: Rect) => a.x >= b.x - 0.5 && a.y >= b.y - 0.5 && a.x + a.w <= b.x + b.w + 0.5 && a.y + a.h <= b.y + b.h + 0.5;
const onBorder = (p: { x: number; y: number }, r: Rect) =>
  p.x >= r.x - 1.5 && p.x <= r.x + r.w + 1.5 && p.y >= r.y - 1.5 && p.y <= r.y + r.h + 1.5;

function check(layout: ChartLayout) {
  const rect = new Map(layout.boxes.map((b) => [b.node, b.rect]));
  for (const b of layout.boxes) {
    expect(b.rect.w).toBeGreaterThan(0);
    expect(b.rect.x).toBeGreaterThanOrEqual(-0.5);
    expect(b.rect.y).toBeGreaterThanOrEqual(-0.5);
    expect(b.rect.x + b.rect.w).toBeLessThanOrEqual(layout.width + 0.5);
    expect(b.rect.y + b.rect.h).toBeLessThanOrEqual(layout.height + 0.5);
    const parent = b.node.parent && rect.get(b.node.parent);
    if (parent) expect(inside(b.rect, parent)).toBe(true);
  }
  // siblings never overlap
  for (const a of layout.boxes)
    for (const b of layout.boxes) if (a !== b && a.node.parent === b.node.parent) expect(overlap(a.rect, b.rect)).toBe(false);
  // edges start on their source box and end on their target box
  for (const e of layout.edges) {
    expect(e.points.length).toBeGreaterThanOrEqual(2);
    expect(onBorder(e.points[0]!, rect.get(e.from)!)).toBe(true);
    expect(onBorder(e.points.at(-1)!, rect.get(e.to)!)).toBe(true);
  }
  // every transition's label is placed once
  const labelled = layout.edges.filter((e) => e.label).map((e) => e.transition);
  expect(new Set(labelled).size).toBe(labelled.length);
}

describe("layoutChart", async () => {
  const files = [...new Glob("*.scxml").scanSync(CHARTS)].sort();
  const models = await Promise.all(files.map(async (f) => [f, await load(await Bun.file(`${CHARTS}${f}`).text())] as const));

  for (const [file, model] of models)
    for (const direction of ["right", "down"] as const)
      test(`${file} (${direction}): boxes nest, siblings don't overlap, edges attach`, () => check(lay(model, direction)));

  test("deterministic: the same chart lays out the same way", () => {
    const [, model] = models[0]!;
    expect(
      JSON.stringify(lay(model), (k, v) =>
        k === "node" || k === "transition" || k === "target" || k === "from" || k === "to" || k === "container" || k === "inside"
          ? undefined
          : v,
      ),
    ).toBe(
      JSON.stringify(lay(model), (k, v) =>
        k === "node" || k === "transition" || k === "target" || k === "from" || k === "to" || k === "container" || k === "inside"
          ? undefined
          : v,
      ),
    );
  });

  test("direction: layers run left to right, or top to bottom", async () => {
    const m = await load(`<scxml ${NS} initial="a"><state id="a"><transition event="e" target="b"/></state><state id="b"/></scxml>`);
    const at = (l: ChartLayout, id: string) => l.boxes.find((b) => b.node.id === id)!.rect;
    expect(at(lay(m, "right"), "b").x).toBeGreaterThan(at(lay(m, "right"), "a").x);
    expect(at(lay(m, "down"), "b").y).toBeGreaterThan(at(lay(m, "down"), "a").y);
    const l = lay(m);
    expect(l.initials).toHaveLength(1);
    expect(l.initials[0]!.target.id).toBe("a");
    expect(l.edges[0]!.kind).toBe("forward");
  });

  test("cycles, self loops, targetless transitions, parallel regions and history", async () => {
    const m = await load(`<scxml ${NS} initial="p">
      <parallel id="p">
        <state id="r1" initial="a">
          <history id="h"><transition target="a"/></history>
          <state id="a"><transition event="x" target="b"/><transition event="self" target="a"/><transition event="noop"/></state>
          <state id="b"><transition event="back" target="a"/></state>
        </state>
        <state id="r2"><state id="c"><transition event="out" target="done"/></state></state>
      </parallel>
      <final id="done"/>
    </scxml>`);
    const l = lay(m);
    check(l);
    const kinds = new Set(l.edges.map((e) => e.kind));
    expect(kinds.has("self")).toBe(true);
    expect(kinds.has("back")).toBe(true);
    expect(l.boxes.find((b) => b.node.id === "r1")!.kind).toBe("region");
    expect(l.boxes.find((b) => b.node.id === "done")!.kind).toBe("final");
    expect(l.boxes.find((b) => b.node.id === "h")!.kind).toBe("history");
    expect(l.inside.get(byId(m, "a"))!.map((t) => t.events[0])).toEqual(["noop"]);
  });
});

describe("autoCollapse", () => {
  test("folds the largest containers until the chart fits, keeping what's asked for", async () => {
    const group = (g: number, n: number) =>
      `<state id="g${g}">${Array.from({ length: n }, (_, i) => `<state id="g${g}s${i}"/>`).join("")}</state>`;
    const m = await load(`<scxml ${NS}>${group(0, 20)}${group(1, 10)}${group(2, 3)}</scxml>`);
    expect(autoCollapse(m.root, 100).size).toBe(0);
    const folded = autoCollapse(m.root, 20);
    expect([...folded].map((s) => s.id)).toEqual(["g0"]);
    // a container holding a kept (e.g. active) state folds last
    expect([...autoCollapse(m.root, 30)].map((s) => s.id)).toEqual(["g0"]);
    expect([...autoCollapse(m.root, 30, new Set([byId(m, "g0s3")]))].map((s) => s.id)).toEqual(["g1"]);
    expect(autoCollapse(m.root, 20, new Set([byId(m, "g0s3")])).has(byId(m, "g0"))).toBe(true);
    const l = lay(m, "right", folded);
    check(l);
    expect(l.boxes.find((b) => b.node.id === "g0")!.kind).toBe("collapsed");
    expect(l.boxes.some((b) => b.node.id === "g0s1")).toBe(false);
  });
});

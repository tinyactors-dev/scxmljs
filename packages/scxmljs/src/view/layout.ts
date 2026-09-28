/**
 * Hierarchical layout for `<scxml-view>`: the whole chart at once, as nested
 * boxes with orthogonal transition routes. Pure and deterministic — no DOM, no
 * randomness — so it is unit-testable and the same chart always looks the same.
 *
 * Per container (the root, compound states), children are arranged with a
 * layered (Sugiyama-style) layout of the transitions between them:
 *   1. transitions between descendants of two different children are lifted to
 *      an edge between those children;
 *   2. cycles are broken by a depth-first search from the initial child
 *      (document order breaks ties); the back edges are routed separately;
 *   3. layers by longest path; edges spanning several layers get dummy nodes
 *      that reserve a corridor through the layers in between;
 *   4. crossings are reduced with barycentre sweeps (the best order wins);
 *   5. positions: layers side by side (gaps sized for labels and bend channels),
 *      nodes aligned towards the centre of their neighbours.
 * Parallel states arrange their regions in a grid. Containers size themselves
 * around their content, bottom-up.
 *
 * Routing: forward edges leave the source box on its far side, carry their
 * label in the gap after the source's layer, bend in a channel of their own and
 * enter the target box on its near side; back edges leave downwards, run along
 * a lane below the container's content and come back up. Everything is computed
 * in a canonical orientation (layers along +x) and transposed for `direction:
 * "down"`.
 */
import { isCompound, type StateNode, type TransitionNode } from "../model.ts";

/** Which way layers run: left to right (`right`) or top to bottom (`down`). */
export type Direction = "right" | "down";

/** A point in the layout's coordinate space (px, origin top-left). */
export interface Point {
  /** horizontal position */
  x: number;
  /** vertical position */
  y: number;
}

/** A size in px. */
export interface Size {
  /** width */
  w: number;
  /** height */
  h: number;
}

/** A rectangle: top-left corner and size. */
export interface Rect extends Point, Size {}

/** Gaps the layout keeps, in px (see `LayoutOptions.spacing`). */
export interface Spacing {
  /** Between boxes of one layer, and between parallel regions. */
  node: number;
  /** Minimum gap between layers (grows to fit labels and bend channels). */
  layer: number;
  /** Inside containers, around their content. */
  padding: number;
  /** Between parallel edge segments (bend channels, back-edge lanes, ports). */
  edge: number;
  /** Space kept around labels. */
  label: number;
}

/** Input to `layoutChart`: how big things are, and which way to lay them out. */
export interface LayoutOptions {
  /** Layers run left→right ("right", default) or top→bottom ("down"). */
  direction?: Direction;
  /**
   * The size a state needs for its own content. Leaves (and collapsed
   * containers): the whole box. Expanded containers: their header (name and
   * anything listed with it); the layout adds room for the children.
   */
  measure: (state: StateNode, collapsed: boolean) => Size;
  /** Size of a transition's label (real orientation). */
  labelSize: (transition: TransitionNode) => Size;
  /** Containers drawn as a single box. */
  collapsed?: ReadonlySet<StateNode>;
  /** Override some of the default gaps. */
  spacing?: Partial<Spacing>;
}

/** How a box is drawn: `region` is a child of a `<parallel>`, `collapsed` a folded container. */
export type BoxKind = "root" | "atomic" | "compound" | "parallel" | "region" | "final" | "history" | "collapsed";

/** One state's box. */
export interface BoxLayout {
  /** the state */
  node: StateNode;
  /** how to draw it */
  kind: BoxKind;
  /** where, in the layout's coordinate space */
  rect: Rect;
  /** Height of the header band at the top of a container (0 for leaves). */
  header: number;
  /** Nesting depth (the root is 0). */
  depth: number;
}

/**
 * How an edge is routed: between layers (`forward`), against the layer order
 * (`back`), a state to itself (`self`), or out of / into its own container.
 */
export type EdgeKind = "forward" | "back" | "self" | "to-ancestor" | "to-descendant";

/** One routed edge: a transition to one of its targets. */
export interface EdgeLayout {
  /** the transition */
  transition: TransitionNode;
  /** The transition's actual target (one EdgeLayout per target). */
  target: StateNode;
  /** The boxes the edge is drawn between (a collapsed ancestor stands in for hidden states). */
  from: StateNode;
  /** The box the arrow points at (the target, or a collapsed ancestor standing in for it). */
  to: StateNode;
  /** How it's routed. */
  kind: EdgeKind;
  /** Orthogonal polyline, arrow at the last point. */
  points: Point[];
  /** Where the label sits (centre = middle of the rect), if the transition has one. */
  label?: Rect;
}

/** The dot-and-arrow marking a container's initial state. */
export interface InitialMarker {
  /** the container whose initial state this marks */
  container: StateNode;
  /** The dot's centre. */
  at: Point;
  /** The arrow from the dot to the initial state's box. */
  points: Point[];
  /** the initial state */
  target: StateNode;
}

/** The result of `layoutChart`: everything needed to draw the chart. */
export interface ChartLayout {
  /** total width, px */
  width: number;
  /** total height, px */
  height: number;
  /** the direction actually used */
  direction: Direction;
  /** Every drawn box, parents before children (draw in this order). */
  boxes: BoxLayout[];
  /** Every drawn edge. */
  edges: EdgeLayout[];
  /** One marker per expanded container with an initial state. */
  initials: InitialMarker[];
  /** Transitions not drawn: targetless ones, and ones hidden inside a collapsed box — per box. */
  inside: Map<StateNode, TransitionNode[]>;
}

const DEFAULT_SPACING: Spacing = { node: 18, layer: 44, padding: 14, edge: 10, label: 6 };
const INITIAL_DOT = 10;

// ───────────────────────────────── helpers ─────────────────────────────────

const within = (s: StateNode, ancestor: StateNode) => {
  for (let n: StateNode | null = s; n; n = n.parent) if (n === ancestor) return true;
  return false;
};

/** The child of `c` on the way down to `s` (s itself when s is a child), or undefined. */
const childOf = (c: StateNode, s: StateNode): StateNode | undefined => {
  let n: StateNode | null = s;
  while (n && n.parent !== c) n = n.parent;
  return n ?? undefined;
};

const isContainerNode = (s: StateNode) => s.kind === "scxml" || s.kind === "parallel" || isCompound(s);

// canonical ⇄ real: canonical x runs along the layers
const tp = (p: Point, down: boolean): Point => (down ? { x: p.y, y: p.x } : p);
const tr = (r: Rect, down: boolean): Rect => (down ? { x: r.y, y: r.x, w: r.h, h: r.w } : r);

// ───────────────────────────── per-container data ─────────────────────────────

/** One node of a container's layered arrangement: a child state, the initial dot, or a dummy. */
interface LNode {
  id: number;
  state?: StateNode;
  kind: "state" | "initial" | "dummy";
  /** canonical size */
  w: number;
  h: number;
  layer: number;
  order: number;
  /** canonical position of the top-left corner, relative to the content origin */
  x: number;
  y: number;
}

interface LEdge {
  from: LNode;
  to: LNode;
  weight: number;
}

interface ContainerInfo {
  state: StateNode;
  kind: "root" | "compound" | "parallel" | "collapsed-leaf";
  /** real size of the whole box */
  size: Size;
  header: number;
  /** real offset of the content area inside the box */
  content: Point;
  // layered data (compound / root)
  nodes: Map<StateNode, LNode>;
  /** room kept before the first layer for an initial dot */
  initialPad: number;
  layers: LNode[][];
  /** canonical x where each layer starts, and its width */
  layerX: number[];
  layerW: number[];
  /** canonical size of the arranged children (without lanes) */
  canonW: number;
  canonH: number;
  /** long-edge dummy chains, keyed by "fromChildId→toChildId#k" */
  chains: Map<string, LNode[]>;
  /** lifted pairs that were reversed to break cycles (routed as back edges) */
  reversed: Set<string>;
  lanes: number;
  /** canonical y of the first lane, relative to the content origin */
  laneTop: number;
  /** label space reserved at the start of each gap (canonical width) */
  gapLabel: number[];
  gapChannels: number[];
  /** back-edge channels before the first / after the last layer */
  leftMargin: number;
  rightMargin: number;
}

// ─────────────────────────────── the layout ───────────────────────────────

/**
 * Lay out a whole chart (usually `model.root`) as nested boxes with
 * orthogonal edges. Pure and deterministic: no DOM, no randomness. This is
 * what `<scxml-view>` draws; hosts can use it to draw charts themselves.
 */
export function layoutChart(root: StateNode, opts: LayoutOptions): ChartLayout {
  const direction = opts.direction ?? "right";
  const down = direction === "down";
  const sp: Spacing = { ...DEFAULT_SPACING, ...opts.spacing };
  const collapsed = opts.collapsed ?? new Set<StateNode>();

  // hidden: inside a collapsed container
  const drawn = (s: StateNode): StateNode => {
    let top: StateNode = s;
    for (let n: StateNode | null = s.parent; n; n = n.parent) if (collapsed.has(n)) top = n;
    return top;
  };
  const isLeafBox = (s: StateNode) => !isContainerNode(s) || collapsed.has(s);

  /** Visible children of an expanded container: states, then history pseudo-states. */
  const kidsOf = (c: StateNode): StateNode[] => (c.kind === "parallel" ? c.children : [...c.children, ...c.history]);

  // every transition, grouped by the container that routes it (filled while lifting)
  const transitions: TransitionNode[] = [];
  const all: StateNode[] = [];
  const walk = (s: StateNode) => {
    all.push(s);
    for (const t of s.transitions) transitions.push(t);
    for (const k of [...s.children, ...s.history]) walk(k);
  };
  walk(root);

  const infos = new Map<StateNode, ContainerInfo>();
  const labelAlong = (t: TransitionNode) => {
    const l = opts.labelSize(t);
    return (down ? l.h : l.w) + 2 * sp.label;
  };

  /** Lay out a container's children; returns its real size. Leaves just measure. */
  const layout = (c: StateNode): Size => {
    if (isLeafBox(c)) return opts.measure(c, collapsed.has(c));
    const head = opts.measure(c, false);
    const kids = kidsOf(c);
    const sizes = new Map(kids.map((k) => [k, layout(k)] as const));
    const info: ContainerInfo = {
      state: c,
      kind: c.kind === "scxml" ? "root" : c.kind === "parallel" ? "parallel" : "compound",
      size: { w: 0, h: 0 },
      header: c.kind === "scxml" ? 0 : head.h,
      content: { x: sp.padding, y: (c.kind === "scxml" ? 0 : head.h) + sp.padding },
      nodes: new Map(),
      initialPad: 0,
      layers: [],
      layerX: [],
      layerW: [],
      canonW: 0,
      canonH: 0,
      chains: new Map(),
      reversed: new Set(),
      lanes: 0,
      laneTop: 0,
      gapLabel: [],
      gapChannels: [],
      leftMargin: 0,
      rightMargin: 0,
    };
    infos.set(c, info);
    let contentReal: Size;
    if (c.kind === "parallel") contentReal = arrangeRegions(info, kids, sizes);
    else contentReal = arrangeLayers(info, kids, sizes);
    const minW = c.kind === "scxml" ? 0 : head.w;
    info.size = {
      w: Math.max(minW, contentReal.w) + 2 * sp.padding,
      h: info.header + contentReal.h + 2 * sp.padding,
    };
    return info.size;
  };

  /** Parallel regions side by side in a grid (real orientation). */
  const arrangeRegions = (info: ContainerInfo, kids: StateNode[], sizes: Map<StateNode, Size>): Size => {
    // regions stack across the layer direction (each region is itself a chain along it);
    // many regions wrap into a grid
    const n = kids.length;
    const stack = n <= 4 ? n : Math.ceil(Math.sqrt(n));
    const cols = down ? stack : Math.ceil(n / stack);
    const rows = Math.ceil(n / cols);
    const colW = Array.from({ length: cols }, (_, ci) =>
      Math.max(0, ...kids.filter((_, i) => i % cols === ci).map((k) => sizes.get(k)!.w)),
    );
    const rowH = Array.from({ length: rows }, (_, ri) =>
      Math.max(0, ...kids.filter((_, i) => Math.floor(i / cols) === ri).map((k) => sizes.get(k)!.h)),
    );
    kids.forEach((k, i) => {
      const ci = i % cols;
      const ri = Math.floor(i / cols);
      const x = colW.slice(0, ci).reduce((a, b) => a + b + sp.node, 0);
      const y = rowH.slice(0, ri).reduce((a, b) => a + b + sp.node, 0);
      // regions fill their grid cell, so the dashed separators line up
      const s = sizes.get(k)!;
      local.set(k, { x, y, w: Math.max(s.w, colW[ci]!), h: Math.max(s.h, rowH[ri]!) });
    });
    // transitions between regions run along lanes below the grid
    let lanes = 0;
    for (const t of transitions) {
      if (!within(t.source, info.state)) continue;
      const a = childOf(info.state, drawn(t.source));
      for (const target of t.targets) {
        const b = within(target, info.state) ? childOf(info.state, drawn(target)) : undefined;
        if (a && b && a !== b) lanes++;
      }
    }
    info.lanes = lanes;
    return {
      w: colW.reduce((a, b) => a + b, 0) + sp.node * (cols - 1),
      h: rowH.reduce((a, b) => a + b, 0) + sp.node * (rows - 1) + (lanes ? (lanes + 1) * sp.edge : 0),
    };
  };

  /** Real position (relative to the parent's content origin) and final size of every non-root box. */
  const local = new Map<StateNode, Rect>();

  const arrangeLayers = (info: ContainerInfo, kids: StateNode[], sizes: Map<StateNode, Size>): Size => {
    const c = info.state;
    let nextId = 0;
    const mk = (kind: LNode["kind"], w: number, h: number, state?: StateNode): LNode => ({
      id: nextId++,
      state,
      kind,
      w,
      h,
      layer: 0,
      order: 0,
      x: 0,
      y: 0,
    });
    for (const k of kids) {
      const s = sizes.get(k)!;
      const canon = down ? { w: s.h, h: s.w } : s;
      info.nodes.set(k, mk("state", canon.w, canon.h, k));
    }
    const initialTargets = c.initial?.targets.map((t) => childOf(c, t)).filter((t): t is StateNode => !!t && info.nodes.has(t)) ?? [];

    // 1. lift transitions to edges between children
    const weights = new Map<string, LEdge>();
    const addEdge = (a: LNode, b: LNode) => {
      const key = `${a.id}→${b.id}`;
      const e = weights.get(key);
      if (e) e.weight++;
      else weights.set(key, { from: a, to: b, weight: 1 });
    };
    for (const t of transitions) {
      if (!within(t.source, c) || t.source === c) continue;
      const a = childOf(c, drawn(t.source));
      for (const target of t.targets) {
        if (!within(target, c) || target === c) continue;
        const b = childOf(c, drawn(target));
        if (a && b && a !== b) addEdge(info.nodes.get(a)!, info.nodes.get(b)!);
      }
    }
    const edges = [...weights.values()];

    // 2. break cycles: a greedy feedback arc set (Eades, Lin & Smyth) on edge weights —
    //    sinks go last, sources first, otherwise the node with the most (out − in) weight;
    //    the initial child gets a slight head start, document order breaks ties
    const stateNodes = [...info.nodes.values()];
    const order = stateNodes;
    const initialSet = new Set(initialTargets.map((t) => info.nodes.get(t)!));
    const rank = feedbackArcOrder(stateNodes, edges, initialSet);
    const reversedEdges = new Set(edges.filter((e) => rank.get(e.from)! > rank.get(e.to)!));
    for (const e of reversedEdges) info.reversed.add(`${e.from.state?.id}→${e.to.state?.id}`);
    const dag = edges.filter((e) => !reversedEdges.has(e));

    // 3. layers: longest path
    const indeg = new Map<LNode, number>(order.map((n) => [n, 0]));
    for (const e of dag) indeg.set(e.to, indeg.get(e.to)! + 1);
    const queue = order.filter((n) => indeg.get(n) === 0);
    for (let i = 0; i < queue.length; i++) {
      const n = queue[i]!;
      for (const e of dag) {
        if (e.from !== n) continue;
        e.to.layer = Math.max(e.to.layer, n.layer + 1);
        indeg.set(e.to, indeg.get(e.to)! - 1);
        if (indeg.get(e.to) === 0) queue.push(e.to);
      }
    }
    // a lone initial dot shouldn't cost a whole layer column of its own: keep it, it's small
    const layerCount = Math.max(0, ...order.map((n) => n.layer)) + 1;
    const layers: LNode[][] = Array.from({ length: layerCount }, () => []);
    for (const n of order) layers[n.layer]!.push(n);

    // long edges → dummy chains (one per lifted pair, in layer order; reversed edges run backwards
    // through the same kind of corridor), same-layer edges need none
    const segments: LEdge[] = [];
    for (const raw of edges) {
      if (raw.from.layer === raw.to.layer) continue;
      const e = raw.from.layer < raw.to.layer ? raw : { from: raw.to, to: raw.from, weight: raw.weight };
      if (e.to.layer - e.from.layer <= 1) {
        segments.push(e);
        continue;
      }
      const key = `${e.from.state?.id}→${e.to.state?.id}`;
      if (info.chains.has(key)) {
        const chain = info.chains.get(key)!;
        for (const d of chain) d.h += sp.edge;
        continue;
      }
      const chain: LNode[] = [];
      let prev = e.from;
      for (let l = e.from.layer + 1; l < e.to.layer; l++) {
        const d = mk("dummy", 0, sp.edge * Math.min(3, e.weight));
        d.layer = l;
        layers[l]!.push(d);
        chain.push(d);
        segments.push({ from: prev, to: d, weight: e.weight });
        prev = d;
      }
      segments.push({ from: prev, to: e.to, weight: e.weight });
      info.chains.set(key, chain);
    }

    // 4. crossing reduction: barycentre sweeps, keep the best
    layers.forEach((layer) => {
      layer.forEach((n, i) => {
        n.order = i;
      });
    });
    const up = new Map<LNode, LEdge[]>();
    const dn = new Map<LNode, LEdge[]>();
    for (const s of segments) {
      (dn.get(s.from) ?? dn.set(s.from, []).get(s.from)!).push(s);
      (up.get(s.to) ?? up.set(s.to, []).get(s.to)!).push(s);
    }
    const countCrossings = () => {
      let n = 0;
      for (let l = 0; l + 1 < layers.length; l++) {
        const segs = segments.filter((s) => s.from.layer === l);
        for (let i = 0; i < segs.length; i++)
          for (let j = i + 1; j < segs.length; j++) {
            const a = segs[i]!;
            const b = segs[j]!;
            if ((a.from.order - b.from.order) * (a.to.order - b.to.order) < 0) n += a.weight * b.weight;
          }
      }
      return n;
    };
    const snapshot = () => layers.map((layer) => [...layer]);
    let best = snapshot();
    let bestCrossings = countCrossings();
    for (let sweep = 0; sweep < 8 && bestCrossings > 0; sweep++) {
      const forward = sweep % 2 === 0;
      const range = forward
        ? layers.map((_, i) => i).slice(1)
        : layers
            .map((_, i) => i)
            .slice(0, -1)
            .reverse();
      for (const l of range) {
        const layer = layers[l]!;
        const bary = new Map<LNode, number>();
        for (const n of layer) {
          const ns = (forward ? up.get(n) : dn.get(n)) ?? [];
          let sum = 0;
          let w = 0;
          for (const s of ns) {
            sum += (forward ? s.from.order : s.to.order) * s.weight;
            w += s.weight;
          }
          bary.set(n, w ? sum / w : n.order);
        }
        layer.sort((p, q) => bary.get(p)! - bary.get(q)! || p.order - q.order);
        layer.forEach((n, i) => {
          n.order = i;
        });
      }
      const c2 = countCrossings();
      if (c2 < bestCrossings) {
        bestCrossings = c2;
        best = snapshot();
      }
    }
    layers.splice(0, layers.length, ...best);
    layers.forEach((layer) => {
      layer.forEach((n, i) => {
        n.order = i;
      });
    });
    info.layers = layers;

    // boxes sending several labelled edges forward grow so every label gets its own port
    const outgoing = new Map<LNode, number>();
    for (const t of transitions) {
      if (!within(t.source, c) || t.source === c) continue;
      const from = drawn(t.source);
      if (from.parent !== c) continue; // only edges leaving the child box itself
      const a = info.nodes.get(from)!;
      const l = opts.labelSize(t);
      for (const target of t.targets) {
        if (!within(target, c) || target === c) continue;
        const b = childOf(c, drawn(target));
        if (b && b !== from && info.nodes.get(b)!.layer > a.layer) outgoing.set(a, (outgoing.get(a) ?? 0) + (down ? l.w : l.h) + sp.label);
      }
    }
    for (const [n, need] of outgoing) if (need + sp.label > n.h) n.h = need + sp.label;

    // 5a. gaps between layers: room for labels (at the source side) and bend channels
    const gapLabel = Array.from({ length: Math.max(0, layers.length - 1) }, () => 0);
    const gapChannels = Array.from({ length: Math.max(0, layers.length - 1) }, () => 0);
    for (const t of transitions) {
      if (!within(t.source, c) || t.source === c) continue;
      const a = childOf(c, drawn(t.source));
      for (const target of t.targets) {
        if (!within(target, c) || target === c) continue;
        const b = childOf(c, drawn(target));
        if (!a || !b || a === b) continue;
        const na = info.nodes.get(a)!;
        const nb = info.nodes.get(b)!;
        if (nb.layer !== na.layer) {
          // forward: label in the gap after the source; reversed: in the gap before it (it leaves backwards)
          const lo = Math.min(na.layer, nb.layer);
          const hi = Math.max(na.layer, nb.layer);
          const lg = nb.layer > na.layer ? na.layer : na.layer - 1;
          gapLabel[lg] = Math.max(gapLabel[lg]!, labelAlong(t));
          for (let l = lo; l < hi; l++) gapChannels[l]!++;
        } else if (na.layer < layers.length - 1) {
          // same layer: a short loop through the gap after it (or the right margin)
          gapChannels[na.layer]!++;
          gapLabel[na.layer] = Math.max(gapLabel[na.layer]!, labelAlong(t));
        } else info.rightMargin++;
      }
    }
    info.gapLabel = gapLabel;
    info.gapChannels = gapChannels;
    // the initial dot sits just before its target; targets in the first layer need room for it
    const initialPad = [...initialSet].some((n) => n.layer === 0) ? INITIAL_DOT + sp.edge * 1.6 : 0;
    info.initialPad = initialPad;
    let x = initialPad + (info.leftMargin ? (info.leftMargin + 1) * sp.edge : 0);
    for (let l = 0; l < layers.length; l++) {
      const w = Math.max(0, ...layers[l]!.map((n) => n.w));
      info.layerX.push(x);
      info.layerW.push(w);
      if (l < layers.length - 1) x += w + Math.max(sp.layer, gapLabel[l]! + (gapChannels[l]! + 1) * sp.edge);
      else x += w;
    }
    info.canonW = x + (info.rightMargin ? (info.rightMargin + 1) * sp.edge : 0);

    // 5b. positions across the layers: stack, then pull towards neighbours (order preserved)
    for (const layer of layers) {
      let y = 0;
      for (const n of layer) {
        n.y = y;
        y += n.h + (n.kind === "dummy" ? sp.edge : sp.node);
      }
    }
    const gapAfter = (n: LNode) => (n.kind === "dummy" ? sp.edge : sp.node);
    /** Move nodes to their desired spots where possible, keeping their order and never overlapping. */
    const settle = (layer: LNode[], desired: Map<LNode, number>) => {
      let prevEnd = Number.NEGATIVE_INFINITY;
      for (const n of layer) {
        n.y = Math.max(desired.get(n) ?? n.y, prevEnd);
        prevEnd = n.y + n.h + gapAfter(n);
      }
    };
    const center = (n: LNode) => n.y + n.h / 2;
    for (let pass = 0; pass < 4; pass++) {
      const forward = pass % 2 === 0;
      const range = forward
        ? layers.map((_, i) => i).slice(1)
        : layers
            .map((_, i) => i)
            .slice(0, -1)
            .reverse();
      for (const l of range) {
        const desired = new Map<LNode, number>();
        for (const n of layers[l]!) {
          const ns = (forward ? up.get(n) : dn.get(n)) ?? [];
          if (!ns.length) continue;
          let sum = 0;
          let w = 0;
          for (const s of ns) {
            sum += center(forward ? s.from : s.to) * s.weight;
            w += s.weight;
          }
          desired.set(n, sum / w - n.h / 2);
        }
        settle(layers[l]!, desired);
      }
    }
    // long-edge corridors: dummies lie on the straight line between their chain's ends
    for (const [key, chain] of info.chains) {
      const [fromId, toId] = key.split("→");
      const from = stateNodes.find((n) => n.state?.id === fromId);
      const to = stateNodes.find((n) => n.state?.id === toId);
      if (!from || !to) continue;
      const y0 = center(from);
      const y1 = center(to);
      chain.forEach((d, i) => {
        const f = (i + 1) / (chain.length + 1);
        d.y = y0 + (y1 - y0) * f - d.h / 2;
      });
    }
    for (const layer of layers) {
      if (!layer.some((n) => n.kind === "dummy")) continue;
      const desired = new Map(layer.map((n) => [n, n.y] as const));
      // keep the layer's order consistent with the new positions, then resolve overlaps
      layer.sort((p, q) => p.y + p.h / 2 - (q.y + q.h / 2) || p.order - q.order);
      layer.forEach((n, i) => {
        n.order = i;
      });
      settle(layer, desired);
    }
    const minY = Math.min(...layers.flat().map((n) => n.y));
    for (const n of layers.flat()) n.y -= minY;
    for (const [l, layer] of layers.entries()) for (const n of layer) n.x = info.layerX[l]! + (info.layerW[l]! - n.w) / 2;
    info.canonH = Math.max(0, ...layers.flat().map((n) => n.y + n.h));

    const canonTotalH = info.canonH;

    for (const [k, n] of info.nodes) {
      const r = tr({ x: n.x, y: n.y, w: n.w, h: n.h }, down);
      local.set(k, r);
    }
    return down ? { w: canonTotalH, h: info.canonW } : { w: info.canonW, h: canonTotalH };
  };

  layout(root);

  // ── absolute rectangles (real) ──
  const boxes: BoxLayout[] = [];
  const abs = new Map<StateNode, Rect>();
  const rootInfo = infos.get(root);
  const rootSize = rootInfo?.size ?? opts.measure(root, false);
  abs.set(root, { x: 0, y: 0, w: rootSize.w, h: rootSize.h });
  const place = (c: StateNode, depth: number) => {
    const info = infos.get(c);
    const r = abs.get(c)!;
    const kind: BoxKind =
      c.kind === "scxml"
        ? "root"
        : collapsed.has(c)
          ? "collapsed"
          : c.kind === "parallel"
            ? "parallel"
            : c.kind === "final"
              ? "final"
              : c.kind === "history"
                ? "history"
                : c.parent?.kind === "parallel"
                  ? "region"
                  : isCompound(c)
                    ? "compound"
                    : "atomic";
    boxes.push({ node: c, kind, rect: r, header: info?.header ?? 0, depth });
    if (!info) return;
    for (const k of kidsOf(c)) {
      const l = local.get(k)!;
      const size = infos.get(k)?.size;
      // leaves keep their measured size; containers theirs; parallel regions fill their cell
      const w = c.kind === "parallel" ? l.w : (size?.w ?? l.w);
      const h = c.kind === "parallel" ? l.h : (size?.h ?? l.h);
      abs.set(k, { x: r.x + info.content.x + l.x, y: r.y + info.content.y + l.y, w, h });
      place(k, depth + 1);
    }
  };
  place(root, 0);

  const routed = routeEdges({ root, down, sp, opts, infos, abs, drawn, transitions, collapsed });
  return {
    width: rootSize.w,
    height: rootSize.h,
    direction,
    boxes,
    edges: routed.edges,
    initials: routed.initials,
    inside: routed.inside,
  };
}

// ──────────────────────────────── routing ────────────────────────────────

interface RouteContext {
  root: StateNode;
  down: boolean;
  sp: Spacing;
  opts: LayoutOptions;
  infos: Map<StateNode, ContainerInfo>;
  abs: Map<StateNode, Rect>;
  drawn: (s: StateNode) => StateNode;
  transitions: TransitionNode[];
  collapsed: ReadonlySet<StateNode>;
}

/** Which side of a box an edge attaches to (canonical: "far" = towards later layers). */
type Side = "near" | "far" | "bottom";

interface Attachment {
  side: Side;
  /** sort key: where the other end is */
  key: number;
  /** assigned position along the side (canonical) */
  at: number;
}

/**
 * How an edge runs, relative to the layers of the container that routes it:
 *   forward   source layer < target layer
 *   reversed  source layer > target layer (leaves backwards, arrow on the target's far side)
 *   same      same layer (a short loop through the gap after it)
 *   regions   between regions of a parallel state (a lane below the regions)
 */
type Route = "forward" | "reversed" | "same" | "regions" | "self" | "to-ancestor" | "to-descendant";

interface Pending {
  transition: TransitionNode;
  target: StateNode;
  from: StateNode;
  to: StateNode;
  route: Route;
  container: StateNode;
  start?: Attachment;
  end?: Attachment;
  lane?: number;
  /** channel index per gap key ("<container>|<gap>", or "<container>|R" for the right margin) */
  channels: Map<string, number>;
}

function routeEdges(ctx: RouteContext): Pick<ChartLayout, "edges" | "initials" | "inside"> {
  const { down, sp, infos, abs, drawn } = ctx;
  const R = (s: StateNode): Rect => tr(abs.get(s)!, down); // canonical rectangle
  const inside = new Map<StateNode, TransitionNode[]>();
  const addInside = (s: StateNode, t: TransitionNode) => {
    const list = inside.get(s) ?? inside.set(s, []).get(s)!;
    if (!list.includes(t)) list.push(t);
  };
  /** canonical origin of a container's content area */
  const contentOrigin = (c: StateNode): Point => {
    const info = infos.get(c)!;
    const r = abs.get(c)!;
    return tp({ x: r.x + info.content.x, y: r.y + info.content.y }, down);
  };
  const layerOf = (c: StateNode, child: StateNode) => infos.get(c)!.nodes.get(child)!.layer;
  const labelCanon = (t: TransitionNode): Size => {
    const l = ctx.opts.labelSize(t);
    return down ? { w: l.h, h: l.w } : l;
  };

  // ── 1. classify every (transition, target) pair ──
  const pending: Pending[] = [];
  for (const t of ctx.transitions) {
    const from = drawn(t.source);
    if (!t.targets.length) {
      addInside(from, t);
      continue;
    }
    for (const target of t.targets) {
      const to = drawn(target);
      const base = { transition: t, target, from, to, channels: new Map<string, number>() };
      if (from === to) {
        if (t.source === target && !ctx.collapsed.has(from)) pending.push({ ...base, route: "self", container: from });
        else addInside(from, t);
        continue;
      }
      if (within(from, to)) {
        pending.push({ ...base, route: "to-ancestor", container: to });
        continue;
      }
      if (within(to, from)) {
        pending.push({ ...base, route: "to-descendant", container: from });
        continue;
      }
      let c = from.parent!;
      while (!within(to, c)) c = c.parent!;
      if (infos.get(c)!.kind === "parallel") {
        pending.push({ ...base, route: "regions", container: c });
        continue;
      }
      const a = layerOf(c, childOf(c, from)!);
      const b = layerOf(c, childOf(c, to)!);
      pending.push({ ...base, route: b > a ? "forward" : b < a ? "reversed" : "same", container: c });
    }
  }

  // ── 2. ports: attachments per box side, spread evenly, ordered by where the other end is ──
  const attachments = new Map<string, Attachment[]>();
  const attach = (box: StateNode, side: Side, key: number): Attachment => {
    const a: Attachment = { side, key, at: 0 };
    const k = `${box.id}|${side}`;
    (attachments.get(k) ?? attachments.set(k, []).get(k)!).push(a);
    return a;
  };
  const boxOf = new Map<Attachment, StateNode>();
  const at = (box: StateNode, side: Side, key: number) => {
    const a = attach(box, side, key);
    boxOf.set(a, box);
    return a;
  };
  const cy = (s: StateNode) => R(s).y + R(s).h / 2;
  const cx = (s: StateNode) => R(s).x + R(s).w / 2;
  for (const p of pending) {
    switch (p.route) {
      case "forward":
        p.start = at(p.from, "far", cy(p.to));
        p.end = at(p.to, "near", cy(p.from));
        break;
      case "reversed":
        p.start = at(p.from, "near", cy(p.to));
        p.end = at(p.to, "far", cy(p.from));
        break;
      case "same":
        p.start = at(p.from, "far", cy(p.to));
        p.end = at(p.to, "far", cy(p.from));
        break;
      case "regions":
        p.start = at(p.from, "bottom", cx(p.to));
        p.end = at(p.to, "bottom", cx(p.from));
        break;
      case "to-ancestor":
        p.start = at(p.from, "far", cy(p.from));
        break;
      case "to-descendant":
        p.end = at(p.to, "near", Number.NEGATIVE_INFINITY);
        break;
      case "self":
        break;
    }
  }
  for (const list of attachments.values()) {
    list.sort((a, b) => a.key - b.key);
    const box = boxOf.get(list[0]!)!;
    const r = R(box);
    const info = infos.get(box);
    // on containers, keep ports clear of the header band
    const headerAcross = info && !down ? info.header : 0;
    const headerAlong = info && down ? info.header : 0;
    list.forEach((a, i) => {
      const f = (i + 1) / (list.length + 1);
      if (a.side === "bottom") a.at = r.x + headerAlong + (r.w - headerAlong) * f;
      else a.at = r.y + headerAcross + (r.h - headerAcross) * f;
    });
  }

  // ── 3. bend channels per gap (in order of the source port) and lanes per parallel state ──
  const channelUse = new Map<string, Pending[]>();
  const useChannel = (p: Pending, key: string) => (channelUse.get(key) ?? channelUse.set(key, []).get(key)!).push(p);
  for (const p of pending) {
    const c = p.container;
    if (p.route === "forward" || p.route === "reversed") {
      const a = layerOf(c, childOf(c, p.from)!);
      const b = layerOf(c, childOf(c, p.to)!);
      for (let g = Math.min(a, b); g < Math.max(a, b); g++) useChannel(p, `${c.id}|${g}`);
    } else if (p.route === "same") {
      const a = layerOf(c, childOf(c, p.from)!);
      useChannel(p, a < infos.get(c)!.layers.length - 1 ? `${c.id}|${a}` : `${c.id}|R`);
    }
  }
  // order bends in a gap so parallel runs don't cross: an edge going down bends further out the
  // higher it starts; an edge going up, the lower it starts (canonical: "out" = towards the next layer)
  const ends = (p: Pending) => {
    const s0 = p.route === "reversed" ? p.end!.at : p.start!.at;
    const s1 = p.route === "reversed" ? p.start!.at : p.end!.at;
    return { s0, s1 };
  };
  for (const [key, list] of channelUse) {
    list.sort((p, q) => {
      const a = ends(p);
      const b = ends(q);
      const downA = a.s1 >= a.s0;
      const downB = b.s1 >= b.s0;
      if (downA !== downB) return downA ? -1 : 1;
      return downA ? b.s0 - a.s0 || b.s1 - a.s1 : a.s0 - b.s0 || a.s1 - b.s1;
    });
    list.forEach((p, i) => {
      p.channels.set(key, i);
    });
  }
  const laneUse = new Map<StateNode, Pending[]>();
  for (const p of pending) if (p.route === "regions") (laneUse.get(p.container) ?? laneUse.set(p.container, []).get(p.container)!).push(p);
  for (const list of laneUse.values()) {
    list.sort((p, q) => Math.abs(cx(p.from) - cx(p.to)) - Math.abs(cx(q.from) - cx(q.to)) || p.transition.order - q.transition.order);
    list.forEach((p, i) => {
      p.lane = i;
    });
  }

  const gapStart = (c: StateNode, g: number) => {
    const info = infos.get(c)!;
    return contentOrigin(c).x + info.layerX[g]! + info.layerW[g]!;
  };
  const channelX = (p: Pending, c: StateNode, g: number) => {
    const info = infos.get(c)!;
    const last = info.layers.length - 1;
    if (g >= last) {
      const i = p.channels.get(`${c.id}|R`) ?? 0;
      return contentOrigin(c).x + info.layerX[last]! + info.layerW[last]! + (i + 1) * sp.edge;
    }
    const i = p.channels.get(`${c.id}|${g}`) ?? 0;
    return gapStart(c, g) + info.gapLabel[g]! + (i + 1) * sp.edge;
  };

  // hierarchy-aware exits: leave nested boxes on one side without crossing their siblings
  const visibleKids = (P: StateNode) => (P.kind === "parallel" ? P.children : [...P.children, ...P.history]);
  const escapes = new Map<StateNode, number>();
  const gutter = (P: StateNode, y: number) => {
    const i = escapes.get(P) ?? 0;
    escapes.set(P, i + 1);
    const PR = R(P);
    const top = contentOrigin(P).y - sp.padding / 2;
    const bottom = PR.y + PR.h - sp.padding / 2;
    return { gy: Math.abs(y - top) <= Math.abs(y - bottom) ? top : bottom, off: sp.edge * (0.6 + (i % 3) * 0.4) };
  };
  /** From `start` on a side of `from` (dir +1 = far, −1 = near) out through the same side of its ancestor `upTo`. */
  const exit = (from: StateNode, upTo: StateNode, start: Point, dir: 1 | -1): Point[] => {
    const pts = [start];
    let cur = from;
    let p = start;
    while (cur !== upTo) {
      const P = cur.parent!;
      const PR = R(P);
      const cr = R(cur);
      const border = dir > 0 ? PR.x + PR.w : PR.x;
      const blocked = visibleKids(P).some((k) => {
        if (k === cur) return false;
        const r = R(k);
        const beyond = dir > 0 ? r.x >= cr.x + cr.w - 0.5 : r.x + r.w <= cr.x + 0.5;
        return beyond && r.y - 2 < p.y && p.y < r.y + r.h + 2;
      });
      if (blocked) {
        const { gy, off } = gutter(P, p.y);
        const xe = dir > 0 ? cr.x + cr.w + off : cr.x - off;
        pts.push({ x: xe, y: p.y }, { x: xe, y: gy });
        p = { x: border, y: gy };
      } else p = { x: border, y: p.y };
      pts.push(p);
      cur = P;
    }
    return pts;
  };
  /** Through `upTo`'s side into `end` on the same side of `to` (the reverse of an exit). */
  const enter = (to: StateNode, upTo: StateNode, end: Point, dir: 1 | -1) => exit(to, upTo, end, dir).reverse();
  /** Horizontal run through layers lo…hi (canonical), bending in each gap's channel and passing dummies. */
  const corridor = (p: Pending, c: StateNode, lo: number, hi: number, yStart: number, yEnd: number): Point[] => {
    const info = infos.get(c)!;
    const A = childOf(c, p.route === "reversed" ? p.to : p.from)!;
    const B = childOf(c, p.route === "reversed" ? p.from : p.to)!;
    const chain = info.chains.get(`${A.id}→${B.id}`) ?? [];
    const pts: Point[] = [];
    let y = yStart;
    for (let g = lo; g < hi; g++) {
      const x = channelX(p, c, g);
      pts.push({ x, y });
      const next = g + 1 < hi ? chain[g - lo] : undefined;
      y = next ? contentOrigin(c).y + next.y + next.h / 2 : yEnd;
      pts.push({ x, y });
      if (next) pts.push({ x: contentOrigin(c).x + info.layerX[g + 1]! + info.layerW[g + 1]!, y });
    }
    return pts;
  };
  const laneY = (c: StateNode, lane: number) => {
    const r = R(c);
    return r.y + r.h - sp.padding / 2 - (infos.get(c)!.lanes - lane) * sp.edge;
  };

  // ── 4. points (canonical); each edge names the segment its label prefers ──
  interface Routed {
    edge: EdgeLayout;
    points: Point[];
    prefer: number;
  }
  const routed: Routed[] = [];
  for (const p of pending) {
    const S = R(p.from);
    const T = R(p.to);
    let pts: Point[] = [];
    let prefer = 0; // index of the segment the label would like to sit on
    const c = p.container;
    switch (p.route) {
      case "forward": {
        const A = childOf(c, p.from)!;
        const B = childOf(c, p.to)!;
        const out = exit(p.from, A, { x: S.x + S.w, y: p.start!.at }, 1);
        const inn = enter(p.to, B, { x: T.x, y: p.end!.at }, -1);
        pts = [...out, ...corridor(p, c, layerOf(c, A), layerOf(c, B), out[out.length - 1]!.y, inn[0]!.y), ...inn];
        prefer = out.length - 1; // the segment leaving the source's layer
        break;
      }
      case "reversed": {
        // laid out like a forward edge from the target to the source, then reversed
        const A = childOf(c, p.from)!;
        const B = childOf(c, p.to)!;
        const out = exit(p.to, B, { x: T.x + T.w, y: p.end!.at }, 1);
        const inn = enter(p.from, A, { x: S.x, y: p.start!.at }, -1);
        pts = [...out, ...corridor(p, c, layerOf(c, B), layerOf(c, A), out[out.length - 1]!.y, inn[0]!.y), ...inn].reverse();
        prefer = inn.length - 1; // the segment leaving the source backwards
        break;
      }
      case "same": {
        const A = childOf(c, p.from)!;
        const B = childOf(c, p.to)!;
        const out = exit(p.from, A, { x: S.x + S.w, y: p.start!.at }, 1);
        const inn = enter(p.to, B, { x: T.x + T.w, y: p.end!.at }, 1);
        const x = channelX(p, c, layerOf(c, A));
        pts = [...out, { x, y: out[out.length - 1]!.y }, { x, y: inn[0]!.y }, ...inn];
        prefer = out.length - 1;
        break;
      }
      case "regions": {
        const x0 = p.start!.at;
        const x1 = p.end!.at;
        const ly = laneY(c, p.lane!);
        pts = [
          { x: x0, y: S.y + S.h },
          { x: x0, y: ly },
          { x: x1, y: ly },
          { x: x1, y: T.y + T.h },
        ];
        prefer = 1;
        break;
      }
      case "to-ancestor": {
        const out = exit(p.from, childOf(p.to, p.from)!, { x: S.x + S.w, y: p.start!.at }, 1);
        const last = out[out.length - 1]!;
        pts = [...out, { x: T.x + T.w - 2, y: last.y }];
        prefer = out.length - 1;
        break;
      }
      case "to-descendant": {
        // from just inside the container, along its top gutter, then down just before the target
        const B = childOf(p.from, p.to)!;
        const inn = enter(p.to, B, { x: T.x, y: p.end!.at }, -1);
        const first = inn[0]!;
        const gy = contentOrigin(p.from).y - sp.padding / 2;
        const fi = infos.get(p.from)!;
        const xg = fi.kind === "parallel" ? first.x - sp.edge : contentOrigin(p.from).x + fi.layerX[layerOf(p.from, B)]! - sp.edge;
        pts = [{ x: S.x + sp.padding / 3, y: gy }, { x: xg, y: gy }, { x: xg, y: first.y }, ...inn];
        prefer = 0;
        break;
      }
      case "self": {
        const out = sp.edge * 1.6;
        const yA = S.y + S.h * 0.3;
        const yB = S.y + S.h * 0.7;
        pts = [
          { x: S.x + S.w, y: yA },
          { x: S.x + S.w + out, y: yA },
          { x: S.x + S.w + out, y: yB },
          { x: S.x + S.w, y: yB },
        ];
        prefer = 1;
        break;
      }
    }
    const kind: EdgeKind =
      p.route === "forward" ? "forward" : p.route === "self" || p.route === "to-ancestor" || p.route === "to-descendant" ? p.route : "back";
    const simple = simplify(pts);
    // map the preferred segment through simplification: nearest segment to the original midpoint
    const a = pts[Math.min(prefer, pts.length - 2)]!;
    const b = pts[Math.min(prefer + 1, pts.length - 1)]!;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let best = 0;
    let bestD = Number.POSITIVE_INFINITY;
    for (let i = 0; i + 1 < simple.length; i++) {
      const d = distToSegment(mid, simple[i]!, simple[i + 1]!);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const edge: EdgeLayout = {
      transition: p.transition,
      target: p.target,
      from: p.from,
      to: p.to,
      kind,
      points: simple.map((q) => tp(q, down)),
    };
    routed.push({ edge, points: simple, prefer: best });
  }

  // ── 5. labels (canonical): on their own route — the preferred segment first, then the others,
  //       sliding along each; only then stepping aside ──
  const obstacles: Rect[] = [];
  for (const [s, r] of abs) {
    const info = infos.get(s);
    if (s === ctx.root) continue;
    if (!info) obstacles.push(tr(r, down));
    else if (info.header > 0) obstacles.push(tr({ x: r.x, y: r.y, w: r.w, h: info.header }, down));
  }
  const placed: Rect[] = [];
  const free = (r: Rect) => !placed.some((o) => overlaps(o, r)) && !obstacles.some((o) => overlaps(o, r));
  const labelled = new Set<TransitionNode>(); // a transition with several targets is labelled once
  for (const { edge, points, prefer } of routed) {
    const real = ctx.opts.labelSize(edge.transition);
    if (!(real.w > 0 && real.h > 0) || labelled.has(edge.transition)) continue;
    labelled.add(edge.transition);
    const size = labelCanon(edge.transition);
    const segs = points.slice(1).map((b, i) => [points[i]!, b] as const);
    const order = [
      prefer,
      ...segs
        .map((_, i) => i)
        .filter((i) => i !== prefer)
        .sort((i, j) => segLen(segs[j]!) - segLen(segs[i]!)),
    ];
    let chosen: Rect | undefined;
    const rectAt = (x: number, y: number): Rect => ({ x: x - size.w / 2, y: y - size.h / 2, w: size.w, h: size.h });
    for (const i of order) {
      const [a, b] = segs[i]!;
      const horizontal = Math.abs(a.y - b.y) < 0.01;
      const room = horizontal ? Math.abs(b.x - a.x) - size.w : Math.abs(b.y - a.y) - size.h;
      if (room < 4) continue;
      for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        const r = rectAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
        // keep the label inside the segment's extent
        if (
          horizontal
            ? r.x < Math.min(a.x, b.x) || r.x + r.w > Math.max(a.x, b.x)
            : r.y < Math.min(a.y, b.y) || r.y + r.h > Math.max(a.y, b.y)
        )
          continue;
        if (free(inflate(r, 2))) {
          chosen = r;
          break;
        }
      }
      if (chosen) break;
    }
    if (!chosen) {
      // step aside from the preferred segment, closest first
      const [a, b] = segs[prefer]!;
      const horizontal = Math.abs(a.y - b.y) < 0.01;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const step = (horizontal ? size.h : size.w) + 4;
      for (const k of [1, -1, 2, -2, 3, -3]) {
        const r = horizontal ? rectAt(mx, my + k * step * 0.6) : rectAt(mx + k * step * 0.6, my);
        if (free(inflate(r, 2))) {
          chosen = r;
          break;
        }
      }
      chosen ??= rectAt(mx, my);
    }
    placed.push(chosen);
    edge.label = tr(chosen, down);
  }

  // ── 6. initial markers: a dot just before each (drawn) initial target ──
  const initials: InitialMarker[] = [];
  for (const [c, info] of infos) {
    if (info.kind === "parallel" || !c.initial) continue;
    for (const target of c.initial.targets) {
      const to = drawn(target);
      if (!within(to, c) || to === c) continue;
      const T = R(to);
      const ty = T.y + Math.min(T.h / 2, 16);
      const dot = { x: T.x - sp.edge * 1.6 - INITIAL_DOT / 2, y: ty };
      initials.push({
        container: c,
        at: tp(dot, down),
        points: [
          { x: dot.x + INITIAL_DOT / 2, y: ty },
          { x: T.x, y: ty },
        ].map((q) => tp(q, down)),
        target: to,
      });
    }
  }

  return { edges: routed.map((r) => r.edge), initials, inside };
}

const segLen = ([a, b]: readonly [Point, Point]) => Math.abs(b.x - a.x) + Math.abs(b.y - a.y);

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inflate = (r: Rect, d: number): Rect => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });

/** Drop repeated points and the middle of collinear runs. */
function simplify(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    out.push(p);
    while (out.length >= 3) {
      const [a, b, c] = out.slice(-3) as [Point, Point, Point];
      const collinear =
        (Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01) || (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01);
      if (!collinear) break;
      out.splice(out.length - 2, 1);
    }
  }
  return out;
}

/**
 * Greedy feedback arc set ordering (Eades, Lin & Smyth 1993), weighted: returns
 * each node's position in an order that keeps most edge weight pointing
 * forward. Deterministic: ties go to `preferred` nodes, then to input order.
 */
function feedbackArcOrder<N>(nodes: N[], edges: { from: N; to: N; weight: number }[], preferred: Set<N>): Map<N, number> {
  const left: N[] = [];
  const right: N[] = [];
  const remaining = new Set(nodes);
  const inW = (n: N) => edges.reduce((s, e) => s + (e.to === n && e.from !== n && remaining.has(e.from) ? e.weight : 0), 0);
  const outW = (n: N) => edges.reduce((s, e) => s + (e.from === n && e.to !== n && remaining.has(e.to) ? e.weight : 0), 0);
  const pick = (pred: (n: N) => boolean) => {
    const cands = nodes.filter((n) => remaining.has(n) && pred(n));
    return cands.find((n) => preferred.has(n)) ?? cands[0];
  };
  while (remaining.size) {
    let changed = true;
    while (changed) {
      changed = false;
      // sinks (nothing going out) go to the end — but never the preferred start while it has alternatives
      const sink = nodes.filter((n) => remaining.has(n) && outW(n) === 0 && !(preferred.has(n) && remaining.size > 1)).pop();
      if (sink !== undefined) {
        remaining.delete(sink);
        right.unshift(sink);
        changed = true;
        continue;
      }
      const source = pick((n) => inW(n) === 0);
      if (source !== undefined) {
        remaining.delete(source);
        left.push(source);
        changed = true;
      }
    }
    if (!remaining.size) break;
    let best: N | undefined;
    let bestDelta = Number.NEGATIVE_INFINITY;
    for (const n of nodes) {
      if (!remaining.has(n)) continue;
      const delta = outW(n) - inW(n) + (preferred.has(n) ? 0.5 : 0);
      if (delta > bestDelta) {
        bestDelta = delta;
        best = n;
      }
    }
    remaining.delete(best!);
    left.push(best!);
  }
  return new Map([...left, ...right].map((n, i) => [n, i]));
}

/**
 * Which containers to fold so that at most `maxBoxes` boxes are drawn: the
 * largest containers first (each folds into one box), never the root, and
 * never a container that holds one of the `keep` states (e.g. the active ones)
 * while there is anything else to fold. Deterministic.
 */
export function autoCollapse(root: StateNode, maxBoxes: number, keep: ReadonlySet<StateNode> = new Set()): Set<StateNode> {
  const size = new Map<StateNode, number>();
  const count = (s: StateNode): number => {
    let n = 0;
    for (const k of [...s.children, ...s.history]) n += 1 + count(k);
    size.set(s, n);
    return n;
  };
  let visible = count(root);
  const collapsed = new Set<StateNode>();
  const holdsKept = (s: StateNode) => [...keep].some((k) => k !== s && within(k, s));
  const candidates = () => {
    const out: StateNode[] = [];
    const walk = (s: StateNode) => {
      for (const k of s.children) {
        if (!(k.children.length || k.history.length)) continue;
        out.push(k);
        walk(k);
      }
    };
    walk(root);
    return out.filter((c) => ![...collapsed].some((x) => within(c, x)));
  };
  while (visible > maxBoxes) {
    const list = candidates();
    if (!list.length) break;
    // prefer containers without kept states; among those the largest (then document order)
    list.sort((a, b) => Number(holdsKept(a)) - Number(holdsKept(b)) || size.get(b)! - size.get(a)! || a.order - b.order);
    const c = list[0]!;
    // folding c hides its descendants, minus the ones already hidden by folded containers inside it
    let hidden = size.get(c)!;
    for (const x of collapsed)
      if (within(x, c)) {
        hidden -= size.get(x)!;
        collapsed.delete(x);
      }
    collapsed.add(c);
    visible -= hidden;
  }
  return collapsed;
}

/**
 * How `<scxml-view>` moves its camera when it moves the view itself (following a link in a help
 * popover, "fit", the zoom buttons and keys, a double click or tap, following the active states).
 * Pure: no DOM, no clock, so it is unit-testable; the element drives it frame by frame.
 *
 * A view is the diagram point at the middle of the canvas and the scale. Between two views the
 * camera takes van Wijk and Nuij's smooth zoom path ("Smooth and efficient zooming and panning",
 * IEEE InfoVis 2003; d3-interpolate's interpolateZoom is the same path): it zooms out on a long
 * trip just enough for both ends to pass through the canvas, and its speed looks even all the way.
 * Its length S (in the paper's units) sets the duration, so a short hop is quick and a long trip
 * takes longer, within bounds. A zoom around a point (a double click, the zoom buttons) keeps that
 * point where it is and changes the scale geometrically, the way the eye reads a zoom.
 */

/** A view: the diagram point at the canvas's middle (`x`, `y`, layout units) and the scale. */
export interface View {
  x: number;
  y: number;
  scale: number;
}

/** A camera move: the view at `t` (0 to 1, eased by the caller) and how long it should take. */
export interface Move {
  at(t: number): View;
  /** Milliseconds. */
  readonly duration: number;
}

/** The paper's ρ: how much the path prefers zooming out to panning (√2, as d3 and the paper use). */
const RHO = Math.SQRT2;
/** Milliseconds per unit of path length, and the bounds of a move. */
const MS_PER_UNIT = 650;
const MIN_MS = 220;
const MAX_MS = 950;

const duration = (length: number) => Math.min(MAX_MS, Math.max(MIN_MS, length * MS_PER_UNIT));

/**
 * The smooth zoom path from `a` to `b` on a canvas `width` px wide (the width of the canvas
 * decides how much of the diagram a scale shows).
 */
export function smoothPath(a: View, b: View, width: number): Move {
  const w0 = width / a.scale;
  const w1 = width / b.scale;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  const rho2 = RHO * RHO;
  if (!(width > 0) || d2 < 1e-12) {
    // a zoom in place: the scale changes geometrically, the point stays
    const length = Math.abs(Math.log(w1 / w0)) / RHO;
    return {
      duration: duration(length),
      at: (t) => ({ x: a.x + dx * t, y: a.y + dy * t, scale: a.scale * (b.scale / a.scale) ** t }),
    };
  }
  const d1 = Math.sqrt(d2);
  const b0 = (w1 * w1 - w0 * w0 + rho2 * rho2 * d2) / (2 * w0 * rho2 * d1);
  const b1 = (w1 * w1 - w0 * w0 - rho2 * rho2 * d2) / (2 * w1 * rho2 * d1);
  const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
  const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
  const length = (r1 - r0) / RHO;
  return {
    duration: duration(length),
    at(t) {
      const s = t * length;
      const coshR0 = Math.cosh(r0);
      const u = (w0 / (rho2 * d1)) * (coshR0 * Math.tanh(RHO * s + r0) - Math.sinh(r0));
      const w = (w0 * coshR0) / Math.cosh(RHO * s + r0);
      return { x: a.x + u * dx, y: a.y + u * dy, scale: width / w };
    },
  };
}

/**
 * A zoom from `a` to `scale` around `point`, a diagram point `offset` px from the canvas's middle
 * (where the pointer is): `point` stays under the pointer while the scale changes geometrically.
 */
export function anchoredZoom(a: View, scale: number, point: { x: number; y: number }, offset: { x: number; y: number }): Move {
  const length = Math.abs(Math.log(scale / a.scale)) / RHO;
  return {
    duration: duration(length),
    at(t) {
      const s = a.scale * (scale / a.scale) ** t;
      return { x: point.x - offset.x / s, y: point.y - offset.y / s, scale: s };
    },
  };
}

/** A pan at one scale with no zoom on the way (following the active states as a chart plays). */
export function glide(a: View, b: View): Move {
  return {
    duration: Math.min(MAX_MS, Math.max(MIN_MS, 180 + Math.hypot(b.x - a.x, b.y - a.y) * a.scale * 0.35)),
    at: (t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, scale: a.scale + (b.scale - a.scale) * t }),
  };
}

/** Ease in and out (cubic): a move starts and stops softly. */
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

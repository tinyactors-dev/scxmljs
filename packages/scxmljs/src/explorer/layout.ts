/**
 * Small, deterministic layout helpers for the explorer's focus diagram.
 * Pure functions over plain boxes, so they're testable without a browser.
 */

/** An axis-aligned box: top-left corner plus size. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A label that wants to sit centred on (cx, cy). */
export interface LabelRequest {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

export interface LabelPlacement {
  cx: number;
  cy: number;
  /** No free spot was found: show the label collapsed (it expands on hover/focus). */
  collapsed: boolean;
}

export interface PlaceOptions {
  /** Vertical distance between candidate positions (px). */
  step?: number;
  /** Candidates tried on each side of the preferred position. */
  tries?: number;
  /** Extra space kept around every label (px). */
  pad?: number;
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Place labels in the given order (earlier ones win): each takes its preferred
 * position, or the nearest vertical offset (0, −step, +step, −2·step, …) where it
 * overlaps neither an obstacle nor a label placed before it. Labels that find
 * no free spot are marked `collapsed` and stay at their preferred position.
 */
export function placeLabels(labels: LabelRequest[], obstacles: Box[] = [], opts: PlaceOptions = {}): LabelPlacement[] {
  const step = opts.step ?? 14;
  const tries = opts.tries ?? 2;
  const pad = opts.pad ?? 2;
  const placed: Box[] = [];
  const offsets = [0];
  for (let i = 1; i <= tries; i++) offsets.push(-i * step, i * step);
  return labels.map((l) => {
    for (const dy of offsets) {
      const box: Box = { x: l.cx - l.w / 2 - pad, y: l.cy + dy - l.h / 2 - pad, w: l.w + 2 * pad, h: l.h + 2 * pad };
      if (placed.some((p) => overlaps(p, box)) || obstacles.some((o) => overlaps(o, box))) continue;
      placed.push(box);
      return { cx: l.cx, cy: l.cy + dy, collapsed: false };
    }
    return { cx: l.cx, cy: l.cy, collapsed: true };
  });
}

/** WCAG 2.x relative luminance of an sRGB colour given as `#rgb` or `#rrggbb`. */
export function luminance(hex: string): number {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = Number.parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two `#rrggbb` colours (1–21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

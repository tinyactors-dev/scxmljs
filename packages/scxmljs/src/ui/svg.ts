/**
 * SVG helpers shared by the elements. Everything is built with
 * `createElementNS`, never parsed from markup, so the elements work on pages
 * that enforce Trusted Types (`require-trusted-types-for 'script'`).
 */
export const SVG_NS = "http://www.w3.org/2000/svg";

/** `<defs><marker id>` holding a triangular arrowhead `w` wide and `h` high, its tip at `refX`. */
export function arrowMarker(id: string, w: number, h: number, refX: number): SVGDefsElement {
  const defs = document.createElementNS(SVG_NS, "defs");
  const marker = document.createElementNS(SVG_NS, "marker");
  const attrs: Record<string, string> = {
    id,
    viewBox: `0 0 ${w} ${h}`,
    refX: String(refX),
    refY: String(h / 2),
    markerUnits: "userSpaceOnUse",
    markerWidth: String(w),
    markerHeight: String(h),
    orient: "auto",
  };
  for (const [k, v] of Object.entries(attrs)) marker.setAttribute(k, v);
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", `M0 0 L${w} ${h / 2} L0 ${h} z`);
  marker.append(path);
  defs.append(marker);
  return defs;
}

/** An icon: its name (the `icon-<name>` class) and its elements, Lucide-style on a 24×24 grid (see ./icons.ts). */
export type IconDef = readonly [name: string, nodes: readonly (readonly [tag: string, attrs: Readonly<Record<string, string>>])[]];

/** A Lucide-style stroke icon (`currentColor`, decorative: `aria-hidden`), `size` px square. */
export function icon([name, nodes]: IconDef, size = 14): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  const attrs: Record<string, string> = {
    class: `icon icon-${name}`,
    width: String(size),
    height: String(size),
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
    focusable: "false",
  };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  for (const [tag, a] of nodes) {
    const child = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(a)) child.setAttribute(k, v);
    svg.append(child);
  }
  return svg;
}

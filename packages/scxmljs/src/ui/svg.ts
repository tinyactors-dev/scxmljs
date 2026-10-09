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

/** Lucide icons (https://lucide.dev, ISC licence) the elements use: [element, attributes] pairs on a 24×24 grid. */
const ICONS = {
  "circle-help": [
    ["circle", { cx: "12", cy: "12", r: "10" }],
    ["path", { d: "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" }],
    ["path", { d: "M12 17h.01" }],
  ],
  "chevron-down": [["path", { d: "m6 9 6 6 6-6" }]],
  "chevron-right": [["path", { d: "m9 18 6-6-6-6" }]],
  "zoom-in": [
    ["circle", { cx: "11", cy: "11", r: "8" }],
    ["path", { d: "m21 21-4.3-4.3" }],
    ["path", { d: "M11 8v6" }],
    ["path", { d: "M8 11h6" }],
  ],
  "zoom-out": [
    ["circle", { cx: "11", cy: "11", r: "8" }],
    ["path", { d: "m21 21-4.3-4.3" }],
    ["path", { d: "M8 11h6" }],
  ],
  scan: [
    ["path", { d: "M3 7V5a2 2 0 0 1 2-2h2" }],
    ["path", { d: "M17 3h2a2 2 0 0 1 2 2v2" }],
    ["path", { d: "M21 17v2a2 2 0 0 1-2 2h-2" }],
    ["path", { d: "M7 21H5a2 2 0 0 1-2-2v-2" }],
  ],
} satisfies Record<string, [string, Record<string, string>][]>;

/** The name of an icon `icon()` can draw. */
export type IconName = keyof typeof ICONS;

/** A Lucide-style stroke icon (`currentColor`, decorative: `aria-hidden`), `size` px square. */
export function icon(name: IconName, size = 14): SVGSVGElement {
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
  for (const [tag, a] of ICONS[name]) {
    const child = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(a)) child.setAttribute(k, v);
    svg.append(child);
  }
  return svg;
}

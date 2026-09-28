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

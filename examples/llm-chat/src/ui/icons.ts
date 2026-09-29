/** Lucide icons for the demo page (resolved from this package, where lucide is a dependency). */
import { Check, ChevronDown, createElement, KeyRound, Pause, Play, Plus, Square, StepForward } from "lucide";

export const ICONS = { Check, ChevronDown, KeyRound, Pause, Play, Plus, Square, StepForward };

/** An inline SVG icon, hidden from assistive technology (the button carries the label). */
export function icon(node: (typeof ICONS)[keyof typeof ICONS], size = 16): SVGElement {
  const svg = createElement(node, { width: size, height: size, "stroke-width": 2 });
  svg.setAttribute("aria-hidden", "true");
  return svg;
}

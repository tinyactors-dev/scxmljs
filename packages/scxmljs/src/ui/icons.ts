/**
 * The glyphs of the elements' visual language (docs/design-principles.md: that table is the only
 * list, one meaning per glyph). Lucide icons (https://lucide.dev, ISC licence), copied from
 * lucide-static 0.460.0 (`funnel` from 0.500.0) as element/attribute pairs on a 24×24 grid,
 * drawn with `icon()` (./svg.ts) as DOM nodes: no asset files, nothing parsed from markup.
 * One export per icon, so a bundle carries only the icons its element draws.
 */
import type { IconDef } from "./svg.ts";

// what a state does
export const logIn: IconDef = [
  "log-in",
  [
    ["path", { d: "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" }],
    ["polyline", { points: "10 17 15 12 10 7" }],
    ["line", { x1: "15", x2: "3", y1: "12", y2: "12" }],
  ],
];
export const logOut: IconDef = [
  "log-out",
  [
    ["path", { d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" }],
    ["polyline", { points: "16 17 21 12 16 7" }],
    ["line", { x1: "21", x2: "9", y1: "12", y2: "12" }],
  ],
];
export const send: IconDef = [
  "send",
  [
    [
      "path",
      {
        d: "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z",
      },
    ],
    ["path", { d: "m21.854 2.147-10.94 10.939" }],
  ],
];
export const logs: IconDef = [
  "logs",
  [
    ["path", { d: "M13 12h8" }],
    ["path", { d: "M13 18h8" }],
    ["path", { d: "M13 6h8" }],
    ["path", { d: "M3 12h1" }],
    ["path", { d: "M3 18h1" }],
    ["path", { d: "M3 6h1" }],
    ["path", { d: "M8 12h1" }],
    ["path", { d: "M8 18h1" }],
    ["path", { d: "M8 6h1" }],
  ],
];
export const workflow: IconDef = [
  "workflow",
  [
    ["rect", { width: "8", height: "8", x: "3", y: "3", rx: "2" }],
    ["path", { d: "M7 11v4a2 2 0 0 0 2 2h4" }],
    ["rect", { width: "8", height: "8", x: "13", y: "13", rx: "2" }],
  ],
];

// transitions
export const diamond: IconDef = [
  "diamond",
  [
    [
      "path",
      {
        d: "M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z",
      },
    ],
  ],
];

// structure and navigation
export const layers: IconDef = [
  "layers",
  [
    ["path", { d: "m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" }],
    ["path", { d: "m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" }],
    ["path", { d: "m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" }],
  ],
];
export const doorOpen: IconDef = [
  "door-open",
  [
    ["path", { d: "M13 4h3a2 2 0 0 1 2 2v14" }],
    ["path", { d: "M2 20h3" }],
    ["path", { d: "M13 20h9" }],
    ["path", { d: "M10 12v.01" }],
    ["path", { d: "M13 4.562v16.157a1 1 0 0 1-1.242.97L5 20V5.562a2 2 0 0 1 1.515-1.94l4-1A2 2 0 0 1 13 4.561Z" }],
  ],
];
export const cornerDownRight: IconDef = [
  "corner-down-right",
  [
    ["polyline", { points: "15 10 20 15 15 20" }],
    ["path", { d: "M4 4v7a4 4 0 0 0 4 4h12" }],
  ],
];
export const chevronDown: IconDef = ["chevron-down", [["path", { d: "m6 9 6 6 6-6" }]]];
export const chevronRight: IconDef = ["chevron-right", [["path", { d: "m9 18 6-6-6-6" }]]];
export const circleHelp: IconDef = [
  "circle-help",
  [
    ["circle", { cx: "12", cy: "12", r: "10" }],
    ["path", { d: "M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" }],
    ["path", { d: "M12 17h.01" }],
  ],
];

// view controls
export const list: IconDef = [
  "list",
  [
    ["path", { d: "M3 12h.01" }],
    ["path", { d: "M3 18h.01" }],
    ["path", { d: "M3 6h.01" }],
    ["path", { d: "M8 12h13" }],
    ["path", { d: "M8 18h13" }],
    ["path", { d: "M8 6h13" }],
  ],
];
export const network: IconDef = [
  "network",
  [
    ["rect", { x: "16", y: "16", width: "6", height: "6", rx: "1" }],
    ["rect", { x: "2", y: "16", width: "6", height: "6", rx: "1" }],
    ["rect", { x: "9", y: "2", width: "6", height: "6", rx: "1" }],
    ["path", { d: "M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3" }],
    ["path", { d: "M12 12V8" }],
  ],
];
export const funnel: IconDef = [
  "funnel",
  [
    [
      "path",
      {
        d: "M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z",
      },
    ],
  ],
];
export const locate: IconDef = [
  "locate",
  [
    ["line", { x1: "2", x2: "5", y1: "12", y2: "12" }],
    ["line", { x1: "19", x2: "22", y1: "12", y2: "12" }],
    ["line", { x1: "12", x2: "12", y1: "2", y2: "5" }],
    ["line", { x1: "12", x2: "12", y1: "19", y2: "22" }],
    ["circle", { cx: "12", cy: "12", r: "7" }],
  ],
];
export const locateFixed: IconDef = [
  "locate-fixed",
  [
    ["line", { x1: "2", x2: "5", y1: "12", y2: "12" }],
    ["line", { x1: "19", x2: "22", y1: "12", y2: "12" }],
    ["line", { x1: "12", x2: "12", y1: "2", y2: "5" }],
    ["line", { x1: "12", x2: "12", y1: "19", y2: "22" }],
    ["circle", { cx: "12", cy: "12", r: "7" }],
    ["circle", { cx: "12", cy: "12", r: "3" }],
  ],
];
export const play: IconDef = ["play", [["polygon", { points: "6 3 20 12 6 21 6 3" }]]];
export const pause: IconDef = [
  "pause",
  [
    ["rect", { x: "14", y: "4", width: "4", height: "16", rx: "1" }],
    ["rect", { x: "6", y: "4", width: "4", height: "16", rx: "1" }],
  ],
];
export const stepForward: IconDef = [
  "step-forward",
  [
    ["line", { x1: "6", x2: "6", y1: "4", y2: "20" }],
    ["polygon", { points: "10,4 20,12 10,20" }],
  ],
];
export const scan: IconDef = [
  "scan",
  [
    ["path", { d: "M3 7V5a2 2 0 0 1 2-2h2" }],
    ["path", { d: "M17 3h2a2 2 0 0 1 2 2v2" }],
    ["path", { d: "M21 17v2a2 2 0 0 1-2 2h-2" }],
    ["path", { d: "M7 21H5a2 2 0 0 1-2-2v-2" }],
  ],
];
export const minus: IconDef = ["minus", [["path", { d: "M5 12h14" }]]];
export const plus: IconDef = [
  "plus",
  [
    ["path", { d: "M5 12h14" }],
    ["path", { d: "M12 5v14" }],
  ],
];

/**
 * Styles of `<scxml-view>`. Colours, fonts and shapes come from the shared
 * theme's private aliases (`--x-*`, sourced from the public `--scxml-*`
 * tokens in src/ui/theme.ts), so both elements theme the same way.
 */
import { SR_ONLY_CSS } from "../ui/announcer.ts";

export const VIEW_CSS = /* css */ `
:host {
  display: block; position: relative; overflow: hidden;
  background: var(--x-bg); border: 1px solid var(--x-b2); border-radius: var(--x-r);
}
:host([hidden]) { display: none; }
.frame { display: flex; flex-direction: column; max-height: var(--scxml-height, none); min-height: 0; }
.canvas:focus-visible { outline: 2px solid var(--x-accent); outline-offset: -2px; }
.canvas { overflow: auto; min-height: 0; flex: 1; overscroll-behavior: contain; }
.diagram { position: relative; margin: 12px; }
:host([fit]) .canvas { overflow: hidden; }
:host([fit]) .diagram { transform-origin: 0 0; }

/* ── boxes ─────────────────────────────────────────────── */
.box { position: absolute; box-sizing: border-box; border-radius: calc(var(--x-r) + 3px); transition: background var(--x-dur), border-color var(--x-dur), box-shadow var(--x-dur); }
.box.container { background: color-mix(in srgb, var(--x-s2) 55%, transparent); border: 1px solid var(--x-b2); }
.box.container.depth-even { background: color-mix(in srgb, var(--x-s1) 70%, transparent); }
.box.region { border-style: dashed; border-radius: var(--x-r); background: transparent; }
.box.leaf { background: var(--x-s1); border: 1px solid var(--x-strong); padding: 8px 11px; display: flex; flex-direction: column; gap: 5px; box-shadow: 0 1px 0 color-mix(in srgb, var(--x-strong) 25%, transparent); }
.box.final { border: 3px double var(--x-strong); border-radius: 999px; padding: 6px 16px; align-items: center; justify-content: center; }
.box.history { border-radius: 50%; padding: 0; display: grid; place-items: center; font: 600 11px var(--x-mono); color: var(--x-fg2); }
.box.collapsed { border-style: solid; border-width: 1px; background: var(--x-s1); box-shadow: 3px 3px 0 -1px var(--x-s1), 3px 3px 0 0 var(--x-b2); }
.head { position: absolute; left: 0; right: 0; top: 0; padding: 7px 11px 0; display: flex; flex-direction: column; gap: 4px; pointer-events: none; }
.head > * { pointer-events: auto; }
.name { font-weight: 600; font-size: 13px; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 6px; }
.name .kind { font: 600 14px/1 var(--x-sans); color: var(--x-fg3); }
.name .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--x-run); flex: none; display: none; }

/* live state: text and shape, never colour alone */
.box.active { border-color: var(--x-run); box-shadow: inset 0 0 0 1px var(--x-run); }
.box.leaf.active { background: var(--x-run-bg); }
.box.active > .name, .box.active > .head .name { color: var(--x-run); }
.box.active > .name .dot, .box.active > .head .name .dot { display: inline-block; }
.box.final.active { border-color: var(--x-done); box-shadow: none; background: var(--x-done-bg); }
.box.final.active > .name { color: var(--x-done); }
.box.region.active { box-shadow: none; }
/* a terminated session: where it ended */
.box.reached { border-color: var(--x-done); box-shadow: inset 0 0 0 1px var(--x-done); }
.box.leaf.reached, .box.final.reached { background: var(--x-done-bg); }
.box.reached > .name, .box.reached > .head .name { color: var(--x-done); }
.box.region.reached { box-shadow: none; }
.empty { margin: 0; padding: 16px; color: var(--x-fg3); }

/* internal (targetless) transitions listed in a box */
.internal { display: flex; flex-wrap: wrap; gap: 4px; }
.internal .more { font: 500 11px var(--x-mono); color: var(--x-fg3); }

/* ── transitions: labels are the buttons ───────────────── */
.label, .chip {
  position: absolute; display: inline-flex; align-items: center; gap: 5px; box-sizing: border-box;
  height: 20px; padding: 0 8px; border-radius: 999px; white-space: nowrap; overflow: hidden;
  font: 500 11px/1 var(--x-mono); color: var(--x-fg2);
  background: var(--x-bg); border: 1px solid var(--x-b2);
}
.chip { position: static; }
.label .cond, .chip .cond { color: var(--x-wait); font-weight: 400; }
button.label, button.chip { cursor: pointer; }
.label.live, .chip.live { color: var(--x-accent-fg); border-color: color-mix(in srgb, var(--x-accent) 45%, transparent); background: var(--x-s1); }
button.label.live:hover, button.chip.live:hover { background: var(--x-accent-subtle); border-color: var(--x-accent); }
button.label:disabled, button.chip:disabled { cursor: default; }
.label.fired, .chip.fired { color: var(--x-on-accent); background: var(--x-accent); border-color: var(--x-accent); }
.label.fired .cond, .chip.fired .cond { color: inherit; }

.edges { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.edges path.edge { fill: none; stroke: var(--x-fg4); stroke-width: 1.25; stroke-linejoin: round; transition: stroke var(--x-dur); }
.edges path.edge.live { stroke: var(--x-accent); }
.edges path.edge.fired { stroke: var(--x-accent); stroke-width: 2.25; }
.edges .initial { fill: var(--x-fg1); }
.edges path.initial-line { fill: none; stroke: var(--x-fg1); stroke-width: 1.25; }
.edges marker path { fill: context-stroke; stroke: none; }

/* ── folded groups ─────────────────────────────────────── */
.badge-count { font: 500 11px var(--x-mono); color: var(--x-fg3); }
.expand { align-self: flex-start; border: 1px solid var(--x-b2); background: var(--x-s1); border-radius: var(--x-r); height: 22px; padding: 0 8px; cursor: pointer; font: 500 11.5px var(--x-sans); color: var(--x-accent-fg); }
.expand:hover { border-color: var(--x-accent); }
.collapse { position: absolute; top: 5px; right: 6px; border: 0; background: none; padding: 1px 4px; cursor: pointer; font: 500 11px var(--x-sans); color: var(--x-fg3); border-radius: var(--x-r); }
.collapse:hover { color: var(--x-accent-fg); background: var(--x-accent-subtle); }

/* ── notices, errors, controls ─────────────────────────── */
.notice { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 7px 12px; font: 12px var(--x-sans); color: var(--x-fg2); background: var(--x-s2); border-bottom: 1px solid var(--x-b1); }
.notice[hidden], .controls[hidden], .error[hidden], .warnings[hidden] { display: none; }
.send-status { color: var(--x-fg1); border-left: 3px solid var(--x-wait); }
.warnings { padding: 6px 12px; font: 12px var(--x-sans); color: var(--x-fg2); background: var(--x-wait-bg); border-bottom: 1px solid var(--x-b1); }
.warnings summary { cursor: pointer; color: var(--x-wait); font-weight: 500; }
.warnings ul { margin: 6px 0 2px; padding-left: 18px; display: grid; gap: 4px; }
.warnings button { all: unset; cursor: pointer; line-height: 1.4; }
.warnings button:hover { text-decoration: underline; }
.warnings button:focus-visible { outline: 2px solid var(--x-accent); outline-offset: 2px; border-radius: 2px; }
.notice button { border: 1px solid var(--x-b2); background: var(--x-s1); border-radius: var(--x-r); height: 24px; padding: 0 9px; cursor: pointer; font: 500 12px var(--x-sans); color: var(--x-fg1); }
.error { padding: 16px 18px; color: var(--x-fg1); }
.error h2 { font: var(--x-display-weight) 16px/1.2 var(--x-serif); margin: 0 0 8px; color: var(--x-err); }
.error ul { margin: 0; padding-left: 18px; font: 12px/1.5 var(--x-mono); color: var(--x-fg2); }
.error p { margin: 0; font: 12.5px/1.5 var(--x-mono); color: var(--x-fg2); white-space: pre-wrap; }
.loading { padding: 16px 18px; color: var(--x-fg3); font-style: italic; }
.controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 10px; background: var(--x-s1); border-bottom: 1px solid var(--x-b2); font: 12px var(--x-sans); }
.controls button { height: 26px; padding: 0 10px; border-radius: var(--x-r); border: 1px solid var(--x-b2); background: var(--x-s1); color: var(--x-fg1); cursor: pointer; font: 500 12px var(--x-sans); }
.controls .play { min-width: 80px; background: var(--x-accent); border-color: var(--x-accent); color: var(--x-on-accent); }
.controls .play[aria-pressed="true"] { background: var(--x-s1); color: var(--x-fg1); border-color: var(--x-b2); }
.controls .step:disabled { opacity: .5; cursor: default; }
.controls .speeds { display: inline-flex; border: 1px solid var(--x-b2); border-radius: var(--x-r); overflow: hidden; }
.controls .speeds button { border: 0; border-radius: 0; height: 24px; padding: 0 7px; background: none; color: var(--x-fg3); min-width: 0; }
.controls .speeds button[aria-pressed="true"] { background: var(--x-s3); color: var(--x-fg1); }
.controls .clock { font: 500 12px var(--x-mono); color: var(--x-fg2); font-variant-numeric: tabular-nums; }
${SR_ONLY_CSS}

/* the diagram's geometry is left-to-right; keep it anchored at the start of the canvas in RTL pages */
.canvas { direction: ltr; }
.canvas .box, .canvas .label, .canvas .chip { direction: inherit; unicode-bidi: plaintext; }
`;

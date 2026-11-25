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
/* --scxml-height caps the diagram's area; the run bar and the panels under it add their own height */
.frame { display: flex; flex-direction: column; min-height: 0; }
.canvas:focus-visible { outline: 2px solid var(--x-accent); outline-offset: -2px; }
.viewport { position: relative; display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; max-height: var(--scxml-height, none); }
.canvas { overflow: hidden; min-height: 0; flex: 1 1 auto; cursor: grab; }
/* one finger scrolls the page; two pan and pinch-zoom the diagram (handled by the element) */
.canvas { touch-action: pan-x pan-y; }
.canvas.panning { cursor: grabbing; user-select: none; -webkit-user-select: none; }
.canvas.panning * { cursor: grabbing !important; }
.diagram { position: relative; margin: 12px; }
/* a gesture hint over the diagram: solid, centred, it takes no pointer */
.hint { position: absolute; left: 50%; top: 50%; z-index: 2; transform: translate(-50%, -50%); pointer-events: none;
  max-width: calc(100% - 32px); box-sizing: border-box; padding: 8px 14px; border: 1px solid var(--x-b2); border-radius: 999px;
  background: var(--x-bg); color: var(--x-fg1); font: 500 13px var(--x-sans); text-align: center;
  box-shadow: 0 6px 24px -8px color-mix(in srgb, var(--x-fg1) 35%, transparent); opacity: 0; transition: opacity 200ms ease; }
.hint[hidden] { display: none; }
.hint.shown { opacity: 1; }
@media (prefers-reduced-motion: reduce) { .hint { transition: none; } }

/* ── under the diagram, for a chart run as a demo: the run bar, then the panels ── */
.run, .panels { border-top: 1px solid var(--x-b1); background: var(--x-s1); }
.run[hidden], .panels[hidden] { display: none; }
.run { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px 12px; }
.run .preset { height: 26px; padding: 0 10px; font-size: 12px; }
.run .restart { margin-inline-start: auto; display: inline-grid; place-items: center; width: 30px; height: 30px; padding: 0;
  border: 1px solid var(--x-b2); border-radius: 999px; background: var(--x-bg); color: var(--x-fg2); cursor: pointer; }
.run .restart:hover { color: var(--x-fg1); background: var(--x-s2); }
.run .restart:focus-visible, .run .preset:focus-visible { outline: 2px solid var(--x-accent); outline-offset: 1px; }
.panels { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1px; background: var(--x-b1); }
.panel { background: var(--x-s1); padding: 10px 12px; min-width: 0; }
.panel-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin: 0 0 6px;
  font: 12px var(--x-sans); color: var(--x-fg3); }
.panel-head .name { font: 12px var(--x-mono); color: var(--x-fg1); }
.panel-head .count { display: inline-flex; align-items: center; gap: 4px; font: 12px var(--x-mono); font-variant-numeric: tabular-nums; }
.panel .log { margin: 0; padding: 0; list-style: none; display: grid; gap: 3px; max-height: 168px; overflow-y: auto;
  font: 12px var(--x-mono); color: var(--x-fg2); }
.panel .log li { display: flex; gap: 8px; align-items: baseline; min-width: 0; }
/* the time, processor and event keep their width; only the data shrinks (to an ellipsis) */
.panel .log li > :not(.value) { flex: none; }
.panel .log .at { color: var(--x-fg3); min-width: 3.2em; font-variant-numeric: tabular-nums; }
.panel .log .target { color: var(--x-fg3); white-space: nowrap; }
.panel .log .type { color: var(--x-fg3); }
.panel[hidden] { display: none; }
.panel .value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--x-fg2); }
.panel .variables { margin: 0; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 3px 12px; font: 12px var(--x-mono); }
.panel .variables dt { color: var(--x-fg1); }
.panel .variables dd { margin: 0; min-width: 0; }
.panel .variables .value { display: block; white-space: normal; overflow-wrap: anywhere; }
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
.title { display: flex; align-items: center; gap: 4px; min-width: 0; }
.box.final > .title { justify-content: center; }
.title .name { flex: 0 1 auto; min-width: 0; }
.name { font-weight: 600; font-size: 13px; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 6px; }
.name .kind { font: 600 14px/1 var(--x-sans); color: var(--x-fg3); }
.name .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--x-run); flex: none; display: none; }

/* live state: text and shape, never colour alone */
.box.active { border-color: var(--x-run); box-shadow: inset 0 0 0 1px var(--x-run); }
.box.leaf.active { background: var(--x-run-bg); }
.box.active > .title .name, .box.active > .head .name { color: var(--x-run); }
.box.active > .title .name .dot, .box.active > .head .name .dot { display: inline-block; }
.box.final.active { border-color: var(--x-done); box-shadow: none; background: var(--x-done-bg); }
.box.final.active > .title .name { color: var(--x-done); }
.box.region.active { box-shadow: none; }
/* a terminated session: where it ended */
.box.reached { border-color: var(--x-done); box-shadow: inset 0 0 0 1px var(--x-done); }
.box.leaf.reached, .box.final.reached { background: var(--x-done-bg); }
.box.reached > .title .name, .box.reached > .head .name { color: var(--x-done); }
.box.region.reached { box-shadow: none; }
.empty { margin: 0; padding: 16px; color: var(--x-fg3); }

/* internal (targetless) transitions listed in a box */
.internal { display: flex; flex-wrap: wrap; gap: 4px; max-width: 360px; }
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
/* a long-distance transition listed in its source's box, and its target while it's hovered */
.chip.portal .to { color: var(--x-fg3); font-weight: 400; }
.chip.portal.live .to { color: inherit; opacity: .75; }
.chip.portal.fired .to { color: inherit; }
.box.portal-target { outline: 2px dashed var(--x-accent); outline-offset: 2px; }

.edges { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
.edges path.edge { fill: none; stroke: var(--x-fg4); stroke-width: 1.25; stroke-linejoin: round; transition: stroke var(--x-dur); }
.edges path.edge.live { stroke: var(--x-accent); }
.edges path.edge.fired { stroke: var(--x-accent); stroke-width: 2.25; }
.edges .initial { fill: var(--x-fg1); }
.edges path.initial-line { fill: none; stroke: var(--x-fg1); stroke-width: 1.25; }
.edges marker path { fill: context-stroke; stroke: none; }

/* ── folded groups ─────────────────────────────────────── */
.badge-count { font: 500 11px var(--x-mono); color: var(--x-fg3); }

/* ── icon buttons in a state's title: fold toggle and help ── */
.toggle, .help {
  flex: none; display: inline-grid; place-items: center; width: 18px; height: 18px; padding: 0; margin: -2px 0;
  border: 0; border-radius: var(--x-r); background: none; color: var(--x-fg3); cursor: pointer;
}
.toggle { margin-left: -4px; }
.help { color: var(--x-fg4); }
.toggle:hover, .help:hover, .help[aria-expanded="true"] { color: var(--x-accent-fg); background: var(--x-accent-subtle); }
.toggle:focus-visible, .help:focus-visible { outline: 2px solid var(--x-accent); outline-offset: 0; }
.toggle.expand { color: var(--x-accent-fg); }
.icon { display: block; pointer-events: none; }
/* fingers: the same small icons, with a hit area of about 34px */
@media (pointer: coarse) {
  .toggle, .help { position: relative; }
  .toggle::after, .help::after { content: ""; position: absolute; inset: -8px; }
}

/* ── help popover ──────────────────────────────────────── */
.help-popover, .form-popover {
  position: absolute; z-index: 3; box-sizing: border-box; width: max-content; max-width: min(360px, calc(100% - 8px)); overflow-y: auto; overscroll-behavior: contain;
  padding: 12px 14px; border: 1px solid var(--x-b2); border-radius: calc(var(--x-r) + 2px);
  background: var(--x-bg); color: var(--x-fg1); font: 13px/1.55 var(--x-sans);
  box-shadow: 0 6px 24px -8px color-mix(in srgb, var(--x-fg1) 35%, transparent);
}
.help-popover[hidden], .form-popover[hidden] { display: none; }
/* ── event form: the data an event takes, asked for before it is sent ── */
.form-popover { position: fixed; inset: auto; margin: 0; width: min(340px, calc(100vw - 8px)); display: grid; gap: 10px; }
.form-popover .help-head { margin: 0; }
.form-doc { margin: 0; color: var(--x-fg2); font-size: 12.5px; text-wrap: pretty; }
/* the actions stay in sight when the form scrolls inside a short popover */
.form-actions {
  display: flex; justify-content: flex-end; gap: 6px; position: sticky; bottom: -12px; z-index: 1;
  margin: 0 -14px -12px; padding: 8px 14px 12px; background: var(--x-bg);
}
.form-actions button {
  height: 28px; padding: 0 12px; border-radius: var(--x-r); font: 500 12.5px var(--x-sans); cursor: pointer;
  border: 1px solid var(--x-b2); background: var(--x-s1); color: var(--x-fg1); transition: background var(--x-dur), border-color var(--x-dur);
}
.form-actions button:hover { background: var(--x-s2); }
.form-actions .primary { background: var(--x-accent); border-color: var(--x-accent); color: var(--x-on-accent); }
.form-actions .primary:hover { background: color-mix(in srgb, var(--x-accent) 88%, var(--x-fg1)); }
.ev-chip .takes { margin-left: 1px; color: var(--x-fg3); font-weight: 600; letter-spacing: .02em; }
/* it comes in from its button, and fades out when the view flies away (HELP_FADE_MS) */
.help-popover:not([hidden]), .form-popover:not([hidden]) { animation: help-in 160ms cubic-bezier(.2, .8, .2, 1); }
.help-popover.leaving { animation: help-out 140ms ease-in forwards; pointer-events: none; }
@keyframes help-in { from { opacity: 0; transform: translateY(-4px) scale(.98); } }
@keyframes help-out { to { opacity: 0; transform: scale(.98); } }
@media (prefers-reduced-motion: reduce) { .help-popover:not([hidden]), .help-popover.leaving, .form-popover:not([hidden]) { animation: none; } }
.help-popover:focus, .form-popover:focus { outline: none; }
.help-popover:focus-visible { outline: 2px solid var(--x-accent); outline-offset: 1px; }
.help-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
.help-head strong { font: 600 14px var(--x-mono); overflow-wrap: anywhere; }
.help-kind { font-size: 12px; color: var(--x-fg3); }
.help-text { max-width: 34em; }
.help-text p { margin: 0 0 8px; white-space: pre-wrap; text-wrap: pretty; }
.help-text p:last-child { margin-bottom: 0; }
.help-none { margin: 0; color: var(--x-fg3); font-style: italic; }
.help-sub { margin: 12px 0 4px; padding-top: 10px; border-top: 1px solid var(--x-b1); font-size: 11px; font-weight: 600; color: var(--x-fg3); text-transform: uppercase; letter-spacing: .05em; }
.help-transitions { margin: 0; padding: 0; list-style: none; display: grid; gap: 4px; font: 12px/1.5 var(--x-mono); color: var(--x-fg2); }
.help-transitions li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
.help-eventless { color: var(--x-fg3); font-style: italic; font-family: var(--x-sans); }
.help-cond { display: inline-flex; align-items: baseline; gap: 3px; color: var(--x-wait); }
.help-cond .glyph { align-self: center; display: inline-flex; }
.help-to .arrow { color: var(--x-fg3); margin-right: 4px; }
.help-to .go { all: unset; cursor: pointer; color: var(--x-accent-fg); font-weight: 600;
  text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--x-accent) 45%, transparent); text-underline-offset: 2px; }
.help-to .go:hover { text-decoration-color: currentColor; }
.help-to .go:focus-visible { outline: 2px solid var(--x-accent); outline-offset: 2px; border-radius: 2px; }
/* a state the view just flew to: a ring that fades */
.box.visited { animation: visited 1.4s ease-out; }
@keyframes visited {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--x-accent) 70%, transparent); }
  25% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--x-accent) 45%, transparent); }
  100% { box-shadow: 0 0 0 12px transparent; }
}
@media (prefers-reduced-motion: reduce) { .box.visited { animation: none; outline: 2px solid var(--x-accent); outline-offset: 3px; } }


/* ── notices, errors, controls ─────────────────────────── */
.notice { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; padding: 7px 12px; font: 12px var(--x-sans); color: var(--x-fg2); background: var(--x-s2); border-bottom: 1px solid var(--x-b1); }
.notice[hidden], .error[hidden], .warnings[hidden] { display: none; }
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
/* ── controls over the diagram's bottom edge ─────────────
   Playback bottom-left, zoom bottom-right: one line, the same height, inset like the diagram
   (12px). Solid surfaces with a hairline, like the boxes. */
.controls, .nav { position: absolute; bottom: 12px; z-index: 2; display: flex; align-items: center; gap: 6px; }
.controls { left: 12px; }
.nav { right: 12px; }
.controls[hidden], .nav[hidden], .controls .step[hidden], .zoom-reset[hidden] { display: none; }
.controls, .zoom, .zoom-reset {
  box-sizing: border-box; height: 36px; border: 1px solid var(--x-b2); border-radius: 999px; background: var(--x-s1);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--x-fg1) 12%, transparent);
}
.controls { gap: 0; padding: 0 2px; }
.zoom { display: flex; align-items: center; padding: 0 2px; }
.controls button, .zoom button, .zoom-reset {
  display: inline-grid; place-items: center; height: 30px; min-width: 30px; padding: 0 6px; box-sizing: border-box;
  border: 0; border-radius: 999px; background: none; color: var(--x-fg2); cursor: pointer;
  font: 500 12px var(--x-mono); font-variant-numeric: tabular-nums;
}
.controls button:hover:not(:disabled), .zoom button:hover, .zoom-reset:hover { color: var(--x-fg1); background: var(--x-s2); }
.controls button:focus-visible, .zoom button:focus-visible, .zoom-reset:focus-visible { outline: 2px solid var(--x-accent); outline-offset: 1px; }
.controls .play { color: var(--x-accent-fg); }
.controls .step:disabled { opacity: .45; cursor: default; }
.controls .speeds { min-width: 40px; }
.controls .clock { padding: 0 10px 0 4px; font: 500 12px var(--x-mono); color: var(--x-fg2); font-variant-numeric: tabular-nums; white-space: nowrap; }
/* playing untouched: just the play button (a circle the height of the others) */
.controls.idle { padding: 0 2px; }
.controls.idle > :not(.play) { display: none; }
.zoom .zoom-level { min-width: 52px; }
.zoom-reset { display: inline-flex; gap: 5px; height: 36px; padding: 0 12px 0 10px; color: var(--x-accent-fg); font-family: var(--x-sans); }
.viewport[data-narrow] .zoom-reset span { display: none; }
.viewport[data-narrow] .zoom-reset { width: 36px; padding: 0; justify-content: center; }

/* −, level, + beside Fit: on hover, keyboard focus, or while zooming */
.zoom { visibility: hidden; }
@media (hover: hover) { .viewport:hover .zoom { visibility: visible; } }
.viewport:has(:focus-visible) .zoom, .viewport[data-zooming] .zoom { visibility: visible; }

/* room under the diagram, so its last row can scroll clear of the controls */
.viewport.has-controls .canvas { padding-bottom: 56px; }

/* fingers: bigger targets; −/+ give way to pinch and double tap */
@media (pointer: coarse) {
  .controls, .zoom, .zoom-reset { height: 44px; }
  .controls button, .zoom button { height: 40px; min-width: 40px; }
  .zoom .zoom-in, .zoom .zoom-out { display: none; }
  .viewport[data-narrow] .zoom-reset { width: 44px; }
  .viewport.has-controls .canvas { padding-bottom: 64px; }
}
${SR_ONLY_CSS}

/* the diagram's geometry is left-to-right; keep it anchored at the start of the canvas in RTL pages */
.canvas { direction: ltr; }
.canvas .box, .canvas .label, .canvas .chip { direction: inherit; unicode-bidi: plaintext; }
`;

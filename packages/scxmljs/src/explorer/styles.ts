/**
 * Layout and component styles of <scxml-explorer>. Colours, type and shape
 * come from the shared theme (src/ui/theme.ts): the `--scxml-*` token
 * contract with neutral defaults, adopted before this sheet. Below
 * NARROW_WIDTH (shared with the element and `<scxml-view>`) the explorer
 * shows one pane with tabs.
 *
 * One focus, everything else quieter:
 *   - colour carries meaning only: `--x-run` is "active", `--x-wait` is
 *     "just happened" (the last step's arrows and the state it left);
 *     `--x-accent` is kept for keyboard focus
 *   - spacing on a 4 / 8 px scale; type in 11, 12, 13, 15 and 22 px;
 *     labels in sentence case, not letter-spaced capitals
 *   - hairlines between rows instead of boxes around them
 */
import { NARROW_WIDTH } from "../ui/theme.ts";

export { NARROW_WIDTH };
export const EXPLORER_CSS = /* css */ `
:host {
  display: block; container-type: inline-size; container-name: explorer;
  background: var(--x-bg);
  border: 1px solid var(--x-b2); border-radius: var(--x-r); overflow: hidden;
  height: var(--scxml-height, min(860px, calc(100dvh - 32px)));
}
[hidden] { display: none !important; }

/* ── shared type: quiet labels, one title, small counts ─── */
.pane-title, .list-group, .col-title, .section-title, .data-field summary, .ev-group > summary, table.tx th, .actions b, .does .label, .row-detail .label {
  font: 600 11px/1.3 var(--x-sans); letter-spacing: 0; text-transform: none; color: var(--x-fg3);
}
h2.title { font-size: 22px; margin: 8px 0 4px; }
h2.title.small { font: 600 15px/1.3 var(--x-sans); letter-spacing: 0; }
.subtitle { font: 12px var(--x-sans); color: var(--x-fg3); gap: 8px; margin: 0 0 4px; }
.section-title { margin: 24px 0 4px; }
.section-title::after { display: none; }
.count { font: 11px var(--x-sans); color: var(--x-fg3); }
.status { font: 12px var(--x-sans); color: var(--x-fg3); }
.status.active { color: var(--x-run); }
.spacer { flex: 1; }
.chip { color: var(--x-fg2); border-color: var(--x-b1); font-size: 12px; }
.chip:hover { color: var(--x-fg1); border-color: var(--x-strong); background: var(--x-s1); }
.more { font: 12px var(--x-sans); }
.more:hover { color: var(--x-fg1); text-decoration: underline; }
.drill { border: 0; background: none; padding: 0; cursor: pointer; color: var(--x-fg2); font: 12px var(--x-sans); white-space: nowrap; }
.drill:hover { color: var(--x-fg1); text-decoration: underline; }
.kind { font: 11px var(--x-mono); color: var(--x-fg3); flex: none; }

/* ── shell: the focus fills it; the panels float over it, like a map's ──
   panels  (wide)   tree on the left, inspector on the right
   panel            one panel on the left: the tree, and the inspector as its second page
   sheet  (narrow)  the same panel as a bottom sheet: low (head + accepted events), half, full
   Playback sits in the bottom-left corner of what the panels leave free, Follow in the bottom-right. */
.shell {
  --panel-w: 340px; --panel-w-start: 280px; --panel-w-end: 340px; --gap: 12px;
  position: relative; height: 100%;
}
.stage { position: relative; height: 100%; overflow: hidden; }
.pane { min-height: 0; min-width: 0; display: flex; flex-direction: column; }
.pane-head { display: flex; align-items: center; gap: 8px; padding: 12px 12px 8px; flex: none; }
.pane-title { flex: 1; }
.pane-scroll { overflow: auto; min-height: 0; flex: 1; overscroll-behavior: contain; }
.center { position: absolute; inset: 0; background: var(--x-bg); }
/* the focus keeps its content clear of the panels and the corners */
.center .pane-scroll { padding: 16px 24px 72px; }
.shell[data-layout="panels"] .center .pane-scroll {
  padding-left: calc(var(--panel-w-start) + 2 * var(--gap) + 12px); padding-right: calc(var(--panel-w-end) + 2 * var(--gap) + 12px);
}
.shell[data-layout="panels"][data-level="system"] .center .pane-scroll { padding-left: 24px; }
.shell[data-layout="panel"] .center .pane-scroll { padding-left: calc(var(--panel-w) + 2 * var(--gap) + 12px); }
.shell[data-layout="sheet"] .center .pane-scroll { padding: 12px 12px calc(var(--sheet-h, 88px) + 64px); }

/* ── panels: solid, a hairline and a soft edge, inset like the corners ── */
.panel {
  position: absolute; z-index: 2; box-sizing: border-box; display: flex; flex-direction: column; min-height: 0; overflow: hidden;
  background: var(--x-s1); border: 1px solid var(--x-b2); border-radius: calc(var(--x-r) + 4px);
  box-shadow: 0 1px 3px color-mix(in srgb, var(--x-fg1) 14%, transparent);
}
.shell[data-layout="panels"] .panel { top: var(--gap); bottom: var(--gap); left: var(--gap); width: var(--panel-w-start); }
.shell[data-layout="panels"] .side-panel { left: auto; right: var(--gap); width: var(--panel-w-end); }
/* the System level has no tree: with two panels, the left one has nothing to show */
.shell[data-layout="panels"][data-level="system"] .panel:not(.side-panel) { display: none; }
.shell:not([data-layout="panels"]) .side-panel { display: none; }
.shell[data-layout="panel"] .panel { top: var(--gap); bottom: var(--gap); left: var(--gap); width: var(--panel-w); }
.panel-head {
  display: flex; align-items: center; gap: 4px 8px; flex-wrap: wrap; flex: none; padding: 8px 12px;
  border-bottom: 1px solid var(--x-b1);
}
.panel-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.panel-body > .pane, .side-panel > .pane { flex: 1; }
.mode { display: inline-flex; gap: 2px; flex: none; }
.mode button, .scopes button {
  border: 0; background: none; padding: 2px 8px; min-height: 24px; border-radius: var(--x-r); cursor: pointer;
  font: 500 12px var(--x-sans); color: var(--x-fg3);
}
.mode button:hover, .scopes button:hover { color: var(--x-fg1); }
.mode button[aria-pressed="true"], .scopes button[aria-pressed="true"] { background: var(--x-s3); color: var(--x-fg1); }
.crumbs { display: flex; align-items: center; gap: 2px; min-width: 0; flex: 1 1 100%; overflow-x: auto; scrollbar-width: none; }
.crumbs button { border: 0; background: none; padding: 2px 4px; min-height: 24px; border-radius: var(--x-r); cursor: pointer; color: var(--x-fg3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 22ch; }
.crumbs button:hover { background: var(--x-s2); color: var(--x-fg1); }
.crumbs button[aria-current] { color: var(--x-fg1); font-weight: 600; }
.crumbs .sep { color: var(--x-fg4); flex: none; }

/* one panel: a page at a time, with links between them */
.shell:not([data-layout="panels"])[data-page="tree"] .panel-body .inspector,
.shell:not([data-layout="panels"])[data-page="inspector"] .panel-body .tree-pane { display: none; }
.shell[data-level="system"] .tree-pane { display: none; }
.to-inspector, .back { border: 0; background: none; padding: 2px 6px; min-height: 24px; border-radius: var(--x-r); cursor: pointer; font: 500 12px var(--x-sans); color: var(--x-fg2); white-space: nowrap; }
.to-inspector:hover, .back:hover { background: var(--x-s2); color: var(--x-fg1); }
.page-back { padding: 8px 8px 0; }
.shell[data-layout="panels"] .to-inspector, .shell[data-layout="panels"] .page-back { display: none; }

/* ── the sheet (narrow) ── */
.sheet-handle { display: none; }
.events-strip { display: none; }
.shell[data-layout="sheet"] .panel {
  left: 0; right: 0; bottom: 0; height: 88px; border-bottom: 0; border-radius: 12px 12px 0 0; transition: height var(--x-dur);
}
.shell[data-layout="sheet"] .panel.dragging { transition: none; }
.shell[data-layout="sheet"][data-sheet="half"] .panel { height: 50%; }
.shell[data-layout="sheet"][data-sheet="full"] .panel { height: calc(100% - 8px); }
.shell[data-layout="sheet"] .sheet-handle {
  display: grid; place-items: center; flex: none; width: 100%; height: 22px; padding: 0; border: 0; background: none; cursor: grab; touch-action: none;
}
.shell[data-layout="sheet"] .sheet-handle::before { content: ""; width: 36px; height: 5px; border-radius: 3px; background: var(--x-b2); }
.shell[data-layout="sheet"] .sheet-handle:focus-visible { outline: 2px solid var(--x-accent); outline-offset: -2px; }
.shell[data-layout="sheet"] .panel-head { padding-top: 0; touch-action: none; }
.shell[data-layout="sheet"] .crumbs button { max-width: 14ch; }
/* low: its head and the accepted events, nothing else */
.shell[data-layout="sheet"][data-sheet="low"] .panel-body { display: none; }
.shell[data-layout="sheet"][data-sheet="low"] .events-strip {
  display: flex; gap: 4px; padding: 8px 12px; min-width: 0; overflow-x: auto; scrollbar-width: none;
}
.events-strip > * { flex: none; max-width: 70vw; }

/* ── corners: playback (bottom left) and Follow (bottom right), clear of the panels ── */
.corner { position: absolute; z-index: 3; bottom: var(--gap); }
.corner-start { left: var(--gap); }
.corner-end { right: var(--gap); }
.shell[data-layout="panels"]:not([data-level="system"]) .corner-start { left: calc(var(--panel-w-start) + 2 * var(--gap)); }
.shell[data-layout="panels"] .corner-end { right: calc(var(--panel-w-end) + 2 * var(--gap)); }
.shell[data-layout="panel"] .corner-start { left: calc(var(--panel-w) + 2 * var(--gap)); }
.shell[data-layout="sheet"] .corner { bottom: calc(var(--sheet-h, 88px) + var(--gap)); }
.playback, .follow {
  box-sizing: border-box; height: 36px; display: flex; align-items: center; gap: 2px; padding: 0 3px;
  background: var(--x-s1); border: 1px solid var(--x-b2); border-radius: 999px;
  box-shadow: 0 1px 2px color-mix(in srgb, var(--x-fg1) 12%, transparent);
}
.playback .play, .playback .step, .playback .speeds {
  height: 30px; padding: 0 10px; border: 0; border-radius: 999px; background: none; cursor: pointer; font: 500 12px var(--x-sans); color: var(--x-fg1);
}
.playback .play { color: var(--x-accent-fg); }
.playback .play:hover, .playback .step:hover:not(:disabled), .playback .speeds:hover { background: var(--x-s2); }
.playback .step:disabled { opacity: .45; cursor: default; }
.playback .speeds { padding: 0 6px; }
.playback .clock-time { font: 12px var(--x-mono); color: var(--x-fg3); font-variant-numeric: tabular-nums; min-width: 9ch; padding: 0 10px 0 4px; cursor: help; }
.follow { gap: 6px; padding: 0 14px 0 11px; cursor: pointer; color: var(--x-fg2); font: 500 12px var(--x-sans); }
.follow:hover { color: var(--x-fg1); background: var(--x-s2); }
.follow .icon { display: block; flex: none; }
.follow[aria-pressed="true"] { color: var(--x-run); }
.follow:focus-visible, .playback button:focus-visible, .playback select:focus-visible { outline: 2px solid var(--x-accent); outline-offset: 1px; }
/* the sheet: Follow is its crosshair, centred (its name stays its accessible name), so both corners fit a phone */
.shell[data-layout="sheet"] .follow { width: 36px; padding: 0; justify-content: center; }
.shell[data-layout="sheet"] .follow-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (pointer: coarse) {
  .playback, .follow { height: 44px; }
  .shell[data-layout="sheet"] .follow { width: 44px; }
  .playback .play, .playback .step, .playback .speeds { height: 40px; }
}
@media (prefers-reduced-motion: reduce) { .shell[data-layout="sheet"] .panel { transition: none; } }
.inspector, .tree-pane { background: none; }

/* ── the title row: the breadcrumb (places above) over the focus's name, then its controls ── */
.title-row { display: flex; align-items: flex-end; gap: 8px 12px; flex-wrap: wrap; margin-bottom: 12px; }
.place { flex: 1 1 auto; min-width: 0; }
.place .crumbs { flex: none; margin-bottom: 2px; }
.place .crumbs .sep:last-child { display: none; }
.place h2.title { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mode .icon-toggle, .filter {
  display: inline-grid; place-items: center; width: 30px; height: 28px; padding: 0; border: 0; border-radius: var(--x-r);
  background: none; color: var(--x-fg3); cursor: pointer;
}
.mode .icon-toggle:hover, .filter:hover { color: var(--x-fg1); background: var(--x-s2); }
.mode .icon-toggle[aria-pressed="true"], .filter[aria-pressed="true"] { color: var(--x-fg1); background: var(--x-s3); }
.mode .icon-toggle:focus-visible, .filter:focus-visible { outline: 2px solid var(--x-accent); outline-offset: 1px; }
.search { display: flex; align-items: center; gap: 4px; }
/* a container's size: the layers glyph and the number; the way inside */
.drill.inside { display: inline-flex; align-items: center; gap: 4px; color: var(--x-fg3); font: 12px var(--x-sans); font-variant-numeric: tabular-nums; }
.drill.inside:hover { color: var(--x-fg1); text-decoration: none; }
.row-head .does-glyphs, .card .does-glyphs { margin-left: auto; }
.row-head .does-glyphs + .drill.inside { margin-left: 12px; }
.tx .glyph-diamond, .how .glyph-diamond { color: var(--x-fg3); }
.guard .glyph { margin-right: 4px; }
.playback .play, .playback .step { display: inline-grid; place-items: center; min-width: 32px; padding: 0 8px; }

/* ── tree (windowed) ───────────────────────────────────── */
.tree-viewport { position: relative; }
.tree-row {
  position: absolute; left: 0; right: 0; height: var(--x-row); display: flex; align-items: center; gap: 4px;
  padding-right: 8px; cursor: pointer; white-space: nowrap; border-left: 2px solid transparent; color: var(--x-fg2);
}
.tree-row:hover { background: var(--x-s2); color: var(--x-fg1); }
.tree-row[aria-selected="true"] { background: var(--x-s2); color: var(--x-fg1); border-left-color: var(--x-fg3); }
.tree-row .twisty { width: 16px; height: 16px; flex: none; border: 0; background: none; padding: 0; cursor: pointer; color: var(--x-fg3); font-size: 10px; }
.tree-row .twisty[hidden] { visibility: hidden; display: inline-block !important; }
.tree-row .name { overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
.tree-row.path { color: var(--x-fg1); }
.tree-row.path .name { font-weight: 600; }
.tree-row.active { border-left-color: var(--x-run); }
.tree-row.active .name { color: var(--x-run); }
.tree-row.match .name { text-decoration: underline; text-decoration-color: var(--x-fg3); text-underline-offset: 3px; }
.tree-row:focus-visible { outline-offset: -2px; }

/* ── focus ─────────────────────────────────────────────── */
.diagram { position: relative; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(150px, 230px); justify-content: start; gap: 24px 128px; align-items: start; padding: 8px 0 8px 16px; }
.rank { display: flex; flex-direction: column; gap: 16px; }
.edges { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
.edges path { fill: none; stroke: var(--x-fg4); stroke-width: 1.25; }
.edges path.live { stroke: var(--x-run); stroke-width: 1.5; }
.edges path.fired { stroke: var(--x-wait); stroke-width: 2; }
.edges path.back { stroke-dasharray: 4 3; }
.edges marker path { fill: context-stroke; stroke: none; }
.edge-label {
  position: absolute; transform: translate(-50%, -50%); z-index: 1; pointer-events: auto;
  font: 11px/1.3 var(--x-mono); background: var(--x-bg); color: var(--x-fg3); padding: 1px 4px; border-radius: var(--x-r); white-space: nowrap; max-width: 120px; overflow: hidden; text-overflow: ellipsis; cursor: help;
}
.edge-label.live { color: var(--x-fg1); }
.edge-label.fired { color: var(--x-wait); }
/* labels that found no free spot collapse to their event count and open on hover / focus */
.edge-label .short { display: none; }
.edge-label.collapsed .full { display: none; }
.edge-label.collapsed .short { display: inline; }
.edge-label.collapsed:is(:hover, :focus-visible) { z-index: 3; max-width: 240px; }
.edge-label.collapsed:is(:hover, :focus-visible) .full { display: inline; }
.edge-label.collapsed:is(:hover, :focus-visible) .short { display: none; }

.card {
  position: relative; background: var(--x-s1); border: 1px solid var(--x-b2); border-radius: var(--x-r);
  padding: 8px 12px; display: grid; gap: 4px; cursor: pointer; transition: border-color var(--x-dur), background var(--x-dur);
}
.card:hover { border-color: var(--x-strong); }
.card.path { border-color: var(--x-run); }
.card.active { background: var(--x-run-bg); box-shadow: inset 0 0 0 1px var(--x-run); }
.card.visited { border-style: dashed; border-color: var(--x-wait); }
.card.final { border-radius: 999px; border-style: double; border-width: 3px; padding: 4px 16px; }
.card.selected { outline: 2px solid var(--x-fg3); outline-offset: 2px; }
.card-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.card-head .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.card.path .card-head .name { color: var(--x-run); }
.card .meta { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; color: var(--x-fg3); font-size: 12px; }
.card .meta .status { color: var(--x-run); }
.initial-mark { position: absolute; left: -13px; top: 13px; width: 8px; height: 8px; border-radius: 50%; background: var(--x-fg1); }
.initial-mark::after { content: ""; position: absolute; left: 8px; top: 3.5px; width: 5px; border-top: 1.5px solid var(--x-fg1); }

.lanes { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.lane { border: 1px solid var(--x-b1); border-radius: var(--x-r); background: var(--x-s1); padding: 8px 12px; min-width: 0; }
.lane-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.lane-head .name { font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; min-height: 24px; }
.lane-row { display: flex; align-items: center; gap: 8px; min-height: 28px; padding: 0 8px; margin: 0 -8px; border-left: 2px solid transparent; cursor: pointer; color: var(--x-fg2); }
.lane-row:hover { background: var(--x-s2); color: var(--x-fg1); }
.lane-row .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lane-row.active { border-left-color: var(--x-run); }
.lane-row.active .name { color: var(--x-run); font-weight: 600; }
.lane-row.visited { border-left: 2px dashed var(--x-wait); }

/* the list: one row per state, hairlines between */
.list { display: grid; }
.list-group { padding: 16px 0 4px; }
.list-group:first-child { padding-top: 0; }
.list-row {
  display: grid; gap: 4px; padding: 8px 12px; cursor: pointer; min-width: 0;
  border-left: 2px solid transparent; border-top: 1px solid var(--x-b1);
}
.list-group + .list-row { border-top-color: transparent; }
.list-row:hover { background: var(--x-s2); }
.list-row.path { border-left-color: var(--x-run); }
.list-row.active { background: color-mix(in srgb, var(--x-run-bg) 70%, transparent); }
.list-row.visited { border-left: 2px dashed var(--x-wait); }
.list-row.open { background: var(--x-s1); }
.row-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.list-row .name { font-weight: 500; }
.list-row .name[aria-expanded]::after { content: "▸"; font-size: 10px; color: var(--x-fg3); margin-left: 8px; transition: transform var(--x-dur); }
.list-row .name[aria-expanded="true"]::after { transform: rotate(90deg); }
.list-row.path .name { color: var(--x-run); font-weight: 600; }
.row-head .drill { margin-left: auto; }
.visited-mark { font: 11px var(--x-sans); color: var(--x-wait); white-space: nowrap; }
.does { font: 12px var(--x-mono); color: var(--x-fg2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.exits { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 16px; font-size: 12px; min-width: 0; }
.exits.all { flex-direction: column; align-items: flex-start; }
.tx { display: inline-flex; align-items: baseline; gap: 4px; min-width: 0; max-width: 100%; color: var(--x-fg3); }
/* the events shrink (their namespaces are cut from the left), the target never */
.tx .ev { display: inline-flex; align-items: baseline; gap: 6px; flex: 0 1 auto; font: 12px var(--x-mono); color: var(--x-fg1); min-width: 0; overflow: hidden; white-space: nowrap; }
.tx.auto .ev { font-family: var(--x-sans); font-style: italic; color: var(--x-fg3); }
.tx .to { flex: none; white-space: nowrap; }
.tx .guard { font: italic 11px var(--x-mono); color: var(--x-fg3); overflow-wrap: anywhere; }
.tx.fired .ev, .tx.fired .to { color: var(--x-wait); }
.tx-item { display: inline-flex; min-width: 0; max-width: 100%; }
/* while the state is active its events can be sent from the row */
button.tx {
  align-items: center; min-height: 24px; padding: 0 8px; border: 1px solid color-mix(in srgb, var(--x-run) 45%, var(--x-b2)); border-radius: 999px;
  background: var(--x-s1); cursor: pointer; font: 12px var(--x-sans);
}
button.tx:hover { background: var(--x-run-bg); border-color: var(--x-run); }
button.tx.fired { border-color: var(--x-wait); }
.row-detail { display: grid; gap: 8px; justify-items: start; padding-top: 4px; cursor: auto; }
.row-detail .from { margin: 0; font-size: 12px; color: var(--x-fg2); }

.doors { display: grid; }
.doors { margin-top: 16px; }
.door {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 0 8px; align-items: center;
  padding: 8px 12px; border-top: 1px solid var(--x-b1); cursor: pointer; color: var(--x-fg2);
}
.door:first-child { border-top-color: transparent; }
.door:hover { background: var(--x-s2); color: var(--x-fg1); }
.door .where { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.door.live .where { color: var(--x-fg1); }
.door .glyph { color: var(--x-fg3); }
.door .events { display: inline-flex; align-items: center; gap: 4px; justify-content: flex-end; font: 12px var(--x-mono); color: var(--x-fg3); min-width: 0; overflow: hidden; white-space: nowrap; max-width: 28ch; }

/* ── events ────────────────────────────────────────────── */
.scopes { display: flex; gap: 4px; padding: 0 12px 8px; flex-wrap: wrap; }
.ev-group > summary { display: flex; align-items: center; gap: 8px; list-style: none; cursor: pointer; padding: 8px 12px; color: var(--x-fg2); border-top: 1px solid var(--x-b1); }
.ev-group > summary::-webkit-details-marker { display: none; }
.ev-group[open] > summary::before { transform: rotate(90deg); }
.ev-group > summary .count { margin-left: auto; }
.ev-row { display: grid; gap: 2px; padding: 4px 12px 8px 24px; justify-items: start; }
.ev-row:hover { background: var(--x-s2); }
/* the event's name is its send button */
.ev-row .ev {
  max-width: 100%; min-height: 24px; padding: 0 8px; border: 1px solid var(--x-b2); border-radius: 999px; background: var(--x-s1);
  font: 500 12px var(--x-mono); color: var(--x-fg1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer;
}
.ev-row .ev:hover:not(:disabled) { border-color: var(--x-run); background: var(--x-run-bg); }
.ev-row .ev:disabled { cursor: default; color: var(--x-fg3); border-style: dashed; }
.ev-row.scope-elsewhere .ev { color: var(--x-fg2); border-style: dashed; }
.ev-row .how { max-width: 100%; color: var(--x-fg3); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ev-row .how .guard { font: italic 11px var(--x-mono); }
.data-field { padding: 0 12px 8px; }
.data-field summary { cursor: pointer; width: max-content; min-height: 24px; display: flex; align-items: center; gap: 8px; list-style: none; }
.data-field summary::-webkit-details-marker { display: none; }
.data-field summary::before, .data-field[open] summary::before { transform: rotate(90deg); }
.data-field input { width: 100%; height: 28px; margin-top: 4px; padding: 0 8px; font: 12px var(--x-mono); border: 1px solid var(--x-b2); border-radius: var(--x-r); background: var(--x-s1); color: var(--x-fg1); }

/* ── detail ────────────────────────────────────────────── */
.detail { padding: 0 12px 16px; }
.kv { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 12px; font-size: 12px; margin: 0; }
.kv dt { color: var(--x-fg3); }
.kv dd { margin: 0; font-family: var(--x-mono); overflow-wrap: anywhere; }
table.tx { width: 100%; border-collapse: collapse; font-size: 12px; }
table.tx th { text-align: left; padding: 4px; border-bottom: 1px solid var(--x-b2); position: sticky; top: 0; background: var(--x-s1); }
table.tx td { padding: 4px; border-bottom: 1px solid var(--x-b1); vertical-align: top; }
table.tx td.ev { font-family: var(--x-mono); overflow-wrap: anywhere; }
table.tx td.cond { font: italic 11px var(--x-mono); color: var(--x-fg3); overflow-wrap: anywhere; }
table.tx td.to { overflow-wrap: anywhere; }
.actions { margin: 0; padding: 0; list-style: none; font: 12px var(--x-mono); color: var(--x-fg2); display: grid; gap: 4px; }
.actions b { margin-right: 8px; }

/* ── system ────────────────────────────────────────────── */
.system { position: relative; display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 16px 72px; align-items: start; }
.system .col { display: grid; gap: 8px; align-content: start; min-width: 0; }
.machine { margin-left: calc(var(--depth, 0) * 16px); }
.card.machine.path { border-color: var(--x-b2); }
.card.machine.path .card-head .name { color: var(--x-fg1); }
.machine.compact { grid-template-columns: minmax(0, 1fr) minmax(0, 40%); align-items: center; padding: 4px 12px; }
.machine.compact .leaves { text-align: right; }
.machine .leaves { font: 12px var(--x-mono); color: var(--x-run); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.machine .from { color: var(--x-fg3); font-size: 12px; }
.links { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
.links path { fill: none; stroke: var(--x-b2); stroke-width: 1.25; }
.links path.invoke { stroke: var(--x-fg4); stroke-dasharray: 3 3; }
.links path.hot { stroke: var(--x-wait); stroke-width: 2; }
.talks { display: flex; gap: 4px; flex-wrap: wrap; }
.pulse { animation: pulse 1.2s ease-out; }
@keyframes pulse { from { box-shadow: 0 0 0 0 color-mix(in srgb, var(--x-wait) 45%, transparent); } to { box-shadow: 0 0 0 8px transparent; } }
.traffic { list-style: none; margin: 0; padding: 0; font: 12px/1.4 var(--x-mono); }
.traffic li { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--x-b1); }
.traffic .dir { color: var(--x-fg3); }

/* ── accessibility ─────────────────────────────────────── */
.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.card:focus-visible, .list-row:focus-visible, .lane-row:focus-visible, .door:focus-visible { outline: 2px solid var(--x-accent); outline-offset: 2px; }
.lane-head .name { border: 0; background: none; padding: 0; text-align: left; font: inherit; font-weight: 600; }

@container explorer (max-width: ${NARROW_WIDTH}px) {
  .system { grid-template-columns: 1fr; gap: 12px; }
  .links { display: none; }
  .diagram { grid-auto-flow: row; grid-auto-columns: auto; }
}
.detail ul.warnings { margin: 0; padding: 0 0 0 16px; display: grid; gap: 4px; font: 12px/1.45 var(--x-sans); color: var(--x-fg1); }
.detail ul.warnings li::marker { color: var(--x-wait); content: "⚠  "; }

/* WCAG 2.2 target size: every control is at least 24px tall */
.chip, .drill, .more { min-height: 24px; }
.drill, .more { min-width: 24px; }
/* the state name is the card's / row's primary button: it looks like text */
button.select {
  all: unset; box-sizing: border-box; cursor: pointer; min-height: 24px; display: inline-flex; align-items: center;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 0 1 auto;
}
.card button.select { flex: 1; }
button.select:focus-visible { outline: 2px solid var(--x-accent); outline-offset: 2px; border-radius: var(--x-r); }

/* right-to-left pages: disclosure triangles point the other way */
:host(:dir(rtl)) .twisty { transform: scaleX(-1); }
`;

/**
 * Layout and component styles of <scxml-explorer>. Colours, type and shape
 * come from the shared theme (src/ui/theme.ts): the `--scxml-*` token
 * contract with neutral defaults, adopted before this sheet. Below
 * NARROW_WIDTH (shared with the element and `<scxml-view>`) the explorer
 * shows one pane with tabs.
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
/* ── shell ─────────────────────────────────────────────── */
.shell { display: grid; grid-template-rows: auto auto 1fr; grid-template-columns: minmax(0, 1fr); height: 100%; }
.shell > .playback[hidden] { display: none; }
.playback {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; padding: 6px 12px;
  background: var(--x-s2); border-bottom: 1px solid var(--x-b2); font: 12px var(--x-sans); color: var(--x-fg2);
}
.playback .play, .playback .step {
  height: 28px; padding: 0 12px; border-radius: var(--x-r); cursor: pointer; font: 500 12.5px var(--x-sans);
  border: 1px solid var(--x-b2); background: var(--x-s1); color: var(--x-fg1);
}
.playback .play { min-width: 86px; background: var(--x-accent); border-color: var(--x-accent); color: var(--x-on-accent); }
.playback .play[aria-pressed="true"] { background: var(--x-s1); color: var(--x-fg1); border-color: var(--x-b2); }
.playback .step:hover:not(:disabled) { border-color: var(--x-accent); color: var(--x-accent-fg); }
.playback .step:disabled { opacity: .45; cursor: default; }
.playback .clock-time { font: 500 12px var(--x-mono); color: var(--x-fg1); font-variant-numeric: tabular-nums; min-width: 8ch; }
.playback .clock-queue { font: 11.5px var(--x-mono); color: var(--x-fg3); }
.playback .last-step { flex: 1 1 200px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 11.5px var(--x-mono); color: var(--x-accent-fg); text-align: right; }
@container explorer (max-width: ${NARROW_WIDTH}px) {
  .playback { gap: 6px 8px; padding: 6px 10px; }
  .playback .last-step { flex-basis: 100%; text-align: left; }
  .playback .clock-queue { display: none; }
}
.top {
  display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 6px 12px;
  background: var(--x-s1); border-bottom: 1px solid var(--x-b2);
}
.levels { display: inline-flex; border: 1px solid var(--x-b2); border-radius: var(--x-r); overflow: hidden; flex: none; }
.levels button { border: 0; background: none; padding: 4px 10px; cursor: pointer; font: 500 11px/1.4 var(--x-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--x-fg3); }
.levels button[aria-pressed="true"] { background: var(--x-accent); color: var(--x-on-accent); }
.crumbs { display: flex; align-items: center; gap: 2px; min-width: 0; flex: 1; overflow: hidden; }
.crumbs button { border: 0; background: none; padding: 3px 5px; border-radius: var(--x-r); cursor: pointer; color: var(--x-fg2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 22ch; }
.crumbs button:hover { background: var(--x-s2); color: var(--x-fg1); }
.crumbs button[aria-current] { color: var(--x-fg1); font-weight: 600; }
.crumbs .sep { color: var(--x-fg4); flex: none; }
.follow { display: inline-flex; align-items: center; gap: 6px; flex: none; cursor: pointer; color: var(--x-fg2); font: 500 11px var(--x-mono); letter-spacing: .08em; text-transform: uppercase; border: 1px solid var(--x-b2); border-radius: 999px; padding: 3px 10px; background: none; }
/* off: a hollow ring; on: a filled dot (shape, not only colour) */
.follow::before { content: ""; width: 7px; height: 7px; border-radius: 50%; box-sizing: border-box; border: 1.5px solid var(--x-fg3); background: transparent; }
.follow[aria-pressed="true"] { color: var(--x-run); border-color: color-mix(in srgb, var(--x-run) 40%, transparent); }
.follow[aria-pressed="true"]::before { border-color: var(--x-run); background: var(--x-run); box-shadow: 0 0 0 3px color-mix(in srgb, var(--x-run) 20%, transparent); }

.body { display: grid; grid-template-columns: minmax(220px, 280px) minmax(0, 1fr) minmax(280px, 360px); min-height: 0; }
.pane { min-height: 0; min-width: 0; display: flex; flex-direction: column; }
.pane + .pane { border-left: 1px solid var(--x-b2); }
.pane-head { display: flex; align-items: center; gap: 8px; padding: 10px 12px 8px; flex: none; }
.pane-title { font: 500 10.5px/1 var(--x-mono); letter-spacing: .12em; text-transform: uppercase; color: var(--x-fg3); flex: 1; }
.pane-scroll { overflow: auto; min-height: 0; flex: 1; overscroll-behavior: contain; }
.center { background: var(--x-bg); }
.center .pane-scroll { padding: 4px 16px 24px; }
.inspector { background: var(--x-s1); }
.tree-pane { background: var(--x-s1); }
.tabs { display: none; }
.events-strip { display: none; }

/* narrow container: one pane at a time, bottom tabs, sticky events strip */
@container explorer (max-width: ${NARROW_WIDTH}px) {
  .body { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto auto; }
  .pane { display: none; }
  .pane + .pane { border-left: 0; }
  .pane[data-tab-active] { display: flex; }
  .tabs { display: flex; border-top: 1px solid var(--x-b2); background: var(--x-s1); }
  .tabs button { flex: 1; border: 0; background: none; padding: 9px 4px 10px; cursor: pointer; font: 500 10.5px var(--x-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--x-fg3); }
  .tabs button[aria-selected="true"] { color: var(--x-accent-fg); box-shadow: inset 0 2px 0 var(--x-accent); }
  .events-strip { display: flex; gap: 6px; padding: 8px 12px; min-width: 0; overflow-x: auto; background: var(--x-s1); border-top: 1px solid var(--x-b1); scrollbar-width: none; }
  .events-strip > * { flex: none; max-width: 70vw; }
  .crumbs { overflow-x: auto; scrollbar-width: none; }
  .crumbs button { max-width: 14ch; }
  .levels { display: none; }
  .center .pane-scroll { padding: 4px 12px 20px; }
}

/* ── tree (windowed) ───────────────────────────────────── */
.tree-viewport { position: relative; }
.tree-row {
  position: absolute; left: 0; right: 0; height: var(--x-row); display: flex; align-items: center; gap: 2px;
  padding-right: 8px; cursor: pointer; white-space: nowrap; border-left: 2px solid transparent;
}
.tree-row:hover { background: var(--x-s2); }
.tree-row[aria-selected="true"] { background: var(--x-accent-subtle); border-left-color: var(--x-accent); }
.tree-row .twisty { width: 18px; height: 18px; flex: none; border: 0; background: none; padding: 0; cursor: pointer; color: var(--x-fg3); font-size: 10px; }
.tree-row .twisty[hidden] { visibility: hidden; display: inline-block; }
.tree-row .name { overflow: hidden; text-overflow: ellipsis; flex: 1; min-width: 0; }
.tree-row.path .name { font-weight: 600; }
.tree-row.active .name { color: var(--x-run); font-weight: 600; }
.tree-row.match .name { text-decoration: underline; text-decoration-color: var(--x-accent); text-underline-offset: 3px; }
.tree-row .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--x-run); flex: none; margin-left: 4px; }
.tree-row:focus-visible { outline-offset: -2px; }

/* ── focus ─────────────────────────────────────────────── */
.mode { display: inline-flex; border: 1px solid var(--x-b2); border-radius: var(--x-r); overflow: hidden; }
.mode button { border: 0; background: none; padding: 3px 8px; cursor: pointer; font: 11px var(--x-sans); color: var(--x-fg3); }
.mode button[aria-pressed="true"] { background: var(--x-s3); color: var(--x-fg1); }
.diagram { position: relative; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(150px, 230px); justify-content: start; gap: 22px 128px; align-items: start; padding: 6px 2px 10px 16px; }
.rank { display: flex; flex-direction: column; gap: 14px; }
.edges { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
.edges path { fill: none; stroke: var(--x-fg4); stroke-width: 1.25; }
.edges path.live { stroke: var(--x-accent); stroke-width: 1.75; }
.edges path.back { stroke-dasharray: 4 3; }
.edges marker path { fill: context-stroke; stroke: none; }
.edge-label {
  position: absolute; transform: translate(-50%, -50%); z-index: 1; pointer-events: auto;
  font: 11px/1.3 var(--x-mono); background: var(--x-bg); color: var(--x-fg2); padding: 1px 6px; border: 1px solid var(--x-b1); border-radius: 999px; white-space: nowrap; max-width: 120px; overflow: hidden; text-overflow: ellipsis; cursor: help;
}
.edge-label.live { color: var(--x-accent-fg); border-color: color-mix(in srgb, var(--x-accent) 40%, transparent); }
/* labels that found no free spot collapse to their event count and open on hover / focus */
.edge-label .short { display: none; }
.edge-label.collapsed .full { display: none; }
.edge-label.collapsed .short { display: inline; }
.edge-label.collapsed:is(:hover, :focus-visible) { z-index: 3; max-width: 240px; }
.edge-label.collapsed:is(:hover, :focus-visible) .full { display: inline; }
.edge-label.collapsed:is(:hover, :focus-visible) .short { display: none; }

.card {
  position: relative; background: var(--x-s1); border: 1px solid var(--x-strong); border-radius: var(--x-r);
  padding: 8px 10px 9px; display: grid; gap: 5px; cursor: pointer; transition: border-color var(--x-dur), background var(--x-dur), box-shadow var(--x-dur);
}
.card:hover { box-shadow: 0 1px 0 var(--x-b2), 0 4px 14px rgba(40, 30, 20, .08); }
.card.path { border-color: var(--x-run); box-shadow: inset 0 0 0 1px var(--x-run); }
.card.active { background: var(--x-run-bg); }
.card.waiting { border-color: var(--x-wait); box-shadow: inset 0 0 0 1px var(--x-wait); background: var(--x-wait-bg); }
.card.final { border-radius: 999px; border-style: double; border-width: 3px; padding: 5px 14px; }
.card.selected { outline: 2px solid var(--x-accent); outline-offset: 2px; }
.card-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
.card-head .name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0; }
.card.path .card-head .name { color: var(--x-run); }
.card.waiting .card-head .name { color: var(--x-wait); }
.card .meta { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; color: var(--x-fg3); font-size: 11.5px; }
.card .events { display: flex; gap: 4px; flex-wrap: wrap; }
.card .events .chip { font-size: 10.5px; padding: 1px 6px; }
.drill { border: 0; background: none; padding: 0; cursor: pointer; color: var(--x-accent-fg); font: 500 11.5px var(--x-sans); }
.drill:hover { text-decoration: underline; }
.initial-mark { position: absolute; left: -13px; top: 13px; width: 8px; height: 8px; border-radius: 50%; background: var(--x-fg1); }
.initial-mark::after { content: ""; position: absolute; left: 8px; top: 3.5px; width: 5px; border-top: 1.5px solid var(--x-fg1); }

.lanes { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
.lane { border: 1px dashed var(--x-strong); border-radius: var(--x-r); background: var(--x-s1); padding: 8px 10px; min-width: 0; }
.lane.path { border-color: var(--x-run); border-style: solid; }
.lane-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
.lane-head .name { font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.lane.path .lane-head .name { color: var(--x-run); }
.lane-row { display: flex; align-items: center; gap: 6px; padding: 3px 6px; margin: 0 -6px; border-radius: var(--x-r); cursor: pointer; }
.lane-row:hover { background: var(--x-s2); }
.lane-row .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lane-row.active .name { color: var(--x-run); font-weight: 600; }

.list { display: grid; gap: 1px; background: var(--x-b1); border: 1px solid var(--x-b1); border-radius: var(--x-r); overflow: hidden; }
.list-row { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; gap: 4px 8px; align-items: center; padding: 7px 10px; background: var(--x-s1); cursor: pointer; }
.list-row:hover { background: var(--x-s2); }
.list-row.path { background: color-mix(in srgb, var(--x-run-bg) 55%, var(--x-s1)); }
.list-row .name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.list-row.path .name { color: var(--x-run); font-weight: 600; }
.list-row .sub { grid-column: 2 / -1; display: flex; gap: 4px; flex-wrap: wrap; color: var(--x-fg3); font-size: 11.5px; }
.list-group { font: 500 10.5px var(--x-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--x-fg3); padding: 8px 10px 4px; background: var(--x-bg); }

.doors { display: grid; gap: 6px; }
.door { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 2px 10px; align-items: baseline; padding: 6px 10px; border: 1px solid var(--x-b1); border-left: 3px solid var(--x-strong); border-radius: var(--x-r); background: var(--x-s1); cursor: pointer; }
.door:hover { border-color: var(--x-b2); border-left-color: var(--x-accent); }
.door .arrow { font: 13px var(--x-mono); color: var(--x-fg3); }
.door .where { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.door .where small { font-weight: 400; color: var(--x-fg3); }
.door .events { grid-column: 2; display: flex; gap: 4px; flex-wrap: wrap; }
.door.live { border-left-color: var(--x-accent); }

/* ── events ────────────────────────────────────────────── */
.scopes { display: flex; gap: 4px; padding: 0 12px 8px; flex-wrap: wrap; }
.scopes button { border: 1px solid var(--x-b2); background: none; border-radius: 999px; padding: 2px 9px; cursor: pointer; font: 11.5px var(--x-sans); color: var(--x-fg2); }
.scopes button[aria-pressed="true"] { background: var(--x-fg1); color: var(--x-s1); border-color: var(--x-fg1); }
.ev-group > summary { display: flex; align-items: center; gap: 8px; list-style: none; cursor: pointer; padding: 7px 12px; font: 500 11px var(--x-mono); letter-spacing: .06em; color: var(--x-fg2); border-top: 1px solid var(--x-b1); }
.ev-group > summary::-webkit-details-marker { display: none; }
.ev-group > summary::before { content: "▸"; font-size: 9px; color: var(--x-fg4); transition: transform var(--x-dur); }
.ev-group[open] > summary::before { transform: rotate(90deg); }
.ev-group > summary .count { margin-left: auto; }
.ev-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 8px; padding: 6px 12px 7px 26px; align-items: center; }
.ev-row:hover { background: var(--x-s2); }
.ev-row .ev { font: 500 12px var(--x-mono); color: var(--x-accent-fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ev-row .how { grid-column: 1; color: var(--x-fg3); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ev-row .how .guard { font: 11px var(--x-mono); color: var(--x-wait); }
.ev-row .send { grid-row: 1 / span 2; grid-column: 2; border: 1px solid var(--x-b2); background: var(--x-s1); border-radius: var(--x-r); height: 26px; padding: 0 9px; cursor: pointer; font: 500 12px var(--x-sans); }
.ev-row .send:hover { border-color: var(--x-accent); color: var(--x-accent-fg); }
.ev-row .send:disabled { opacity: .45; cursor: default; }
.ev-row .scope-tag { font: 500 10px var(--x-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--x-fg3); border: 1px solid var(--x-b2); border-radius: var(--x-r); padding: 0 4px; margin-right: 4px; }
.ev-row.scope-inherited .ev { color: var(--x-fg2); }
.ev-row.scope-elsewhere .ev { color: var(--x-fg3); }
.data-field { display: flex; gap: 6px; align-items: center; padding: 0 12px 8px; }
.data-field span { font: 500 10px var(--x-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--x-fg3); }
.data-field input { flex: 1; min-width: 0; height: 26px; padding: 0 8px; font: 11.5px var(--x-mono); border: 1px solid var(--x-b2); border-radius: var(--x-r); background: var(--x-s1); color: var(--x-fg1); }

/* ── detail ────────────────────────────────────────────── */
.detail { padding: 0 12px 16px; }
.kv { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 4px 12px; font-size: 12.5px; margin: 0; }
.kv dt { color: var(--x-fg3); }
.kv dd { margin: 0; font-family: var(--x-mono); font-size: 12px; overflow-wrap: anywhere; }
table.tx { width: 100%; border-collapse: collapse; font-size: 12px; }
table.tx th { text-align: left; font: 500 10px var(--x-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--x-fg3); padding: 4px 6px; border-bottom: 1px solid var(--x-b2); position: sticky; top: 0; background: var(--x-s1); }
table.tx td { padding: 5px 6px; border-bottom: 1px solid var(--x-b1); vertical-align: top; }
table.tx td.ev { font-family: var(--x-mono); color: var(--x-accent-fg); overflow-wrap: anywhere; }
table.tx td.cond { font-family: var(--x-mono); color: var(--x-wait); font-size: 11px; overflow-wrap: anywhere; }
table.tx td.to { overflow-wrap: anywhere; }
.actions { margin: 0; padding: 0; list-style: none; font: 12px var(--x-mono); color: var(--x-fg2); display: grid; gap: 2px; }
.actions b { font: 500 10px var(--x-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--x-fg3); margin-right: 6px; }

/* ── system ────────────────────────────────────────────── */
.system { position: relative; display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr); gap: 16px 72px; align-items: start; }
.system .col { display: grid; gap: 10px; align-content: start; min-width: 0; }
.system .col-title { font: 500 10.5px var(--x-mono); letter-spacing: .12em; text-transform: uppercase; color: var(--x-fg3); display: flex; gap: 8px; align-items: center; }
.machine { margin-left: calc(var(--depth, 0) * 18px); }
.machine.compact { grid-template-columns: minmax(0, 1fr) minmax(0, 40%); align-items: center; padding: 5px 10px; }
.machine.compact .leaves { text-align: right; }
.machine .leaves { font: 11.5px var(--x-mono); color: var(--x-run); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.machine .from { color: var(--x-fg3); font-size: 11.5px; }
.service .type { font: 11px var(--x-mono); color: var(--x-fg3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.links { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
.links path { fill: none; stroke: var(--x-b2); stroke-width: 1.25; }
.links path.invoke { stroke: var(--x-fg4); stroke-dasharray: 3 3; }
.links path.hot { stroke: var(--x-accent); stroke-width: 2; }
.talks { display: flex; gap: 4px; flex-wrap: wrap; }
.pulse { animation: pulse 1.2s ease-out; }
@keyframes pulse { from { box-shadow: 0 0 0 0 color-mix(in srgb, var(--x-accent) 45%, transparent); } to { box-shadow: 0 0 0 8px transparent; } }
.traffic { list-style: none; margin: 0; padding: 0; font: 11.5px/1.4 var(--x-mono); }
.traffic li { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 6px; padding: 4px 0; border-bottom: 1px solid var(--x-b1); }
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
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1;
}
button.select:focus-visible { outline: 2px solid var(--x-accent); outline-offset: 2px; border-radius: var(--x-r); }

/* right-to-left pages: disclosure triangles point the other way */
:host(:dir(rtl)) .twisty { transform: scaleX(-1); }
`;

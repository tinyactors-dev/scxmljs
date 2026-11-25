/** `<scxml-data>`'s stylesheet: the shared theme's tokens (`--scxml-*`), nothing of its own. */
export const DATA_CSS = /* css */ `
:host { display: block; }
:host([hidden]) { display: none; }
.root { display: grid; gap: 8px; }
.field { display: grid; grid-template-columns: minmax(70px, max-content) minmax(0, 1fr); gap: 4px 10px; align-items: start; }
.field > .name { font: 500 12px/28px var(--x-mono); color: var(--x-fg2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.field > .name.req::after { content: "*"; color: var(--x-fg3); margin-left: 2px; }
.field > .body { min-width: 0; display: grid; gap: 4px; }
.doc { font: 11.5px/1.35 var(--x-sans); color: var(--x-fg3); }
.group { display: grid; gap: 8px; padding: 8px 10px; border: 1px solid var(--x-b1); border-radius: var(--x-r); background: var(--x-s2); }
.group .group { background: var(--x-s1); }
.items { display: grid; gap: 6px; }
.item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; align-items: start; }
.row { display: flex; gap: 6px; align-items: center; min-width: 0; }
input, select, textarea {
  font: 12.5px var(--x-mono); color: var(--x-fg1); background: var(--x-s1);
  border: 1px solid var(--x-b2); border-radius: var(--x-r); min-width: 0;
}
input:not([type="checkbox"]), select { height: 28px; padding: 0 7px; width: 100%; }
textarea { padding: 5px 7px; width: 100%; min-height: 28px; resize: none; field-sizing: content; max-height: 12em; }
input[type="checkbox"] { width: 16px; height: 16px; margin: 6px 0; accent-color: var(--x-accent); }
input:focus, select:focus, textarea:focus { border-color: var(--x-accent); outline: none; box-shadow: 0 0 0 2px var(--x-accent-subtle); }
[aria-invalid="true"] { border-color: var(--x-err); }
.problem { font: 11.5px/1.3 var(--x-sans); color: var(--x-err); }
.problem::before { content: "! "; font-weight: 700; }
button.add, button.remove {
  border: 1px dashed var(--x-b2); background: transparent; color: var(--x-accent-fg); border-radius: var(--x-r);
  height: 26px; padding: 0 8px; font: 12px var(--x-sans); cursor: pointer; justify-self: start;
  transition: background var(--x-dur), border-color var(--x-dur);
}
button.add:hover { background: var(--x-accent-subtle); border-color: var(--x-accent); }
button.remove { border: 0; width: 26px; padding: 0; color: var(--x-fg3); font-size: 15px; line-height: 26px; }
button.remove:hover { color: var(--x-err); background: var(--x-err-bg); }
.unit { font: 11px var(--x-mono); color: var(--x-fg3); white-space: nowrap; }
/* view mode */
.value { font: 12.5px/28px var(--x-mono); color: var(--x-fg1); overflow-wrap: anywhere; }
.value.string::before, .value.string::after { content: '"'; color: var(--x-fg3); }
.value.number, .value.boolean { color: var(--x-accent-fg); }
.value.unset { color: var(--x-fg3); font-style: italic; font-family: var(--x-sans); }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;

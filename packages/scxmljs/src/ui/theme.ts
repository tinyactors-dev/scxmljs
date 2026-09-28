/**
 * Shared theme for the scxmljs custom elements (`<scxml-explorer>`, and
 * `<scxml-view>` once it moves into the package).
 *
 * Theming contract: every visual decision reads a public `--scxml-*` custom
 * property (set them on `scxml-explorer`, or anywhere above it). Unset ones
 * fall back to the neutral default theme below, which follows the page's
 * light/dark preference via `light-dark()` and `color-scheme`. Internally the
 * shadow DOM uses short private aliases (`--x-*`); they are not part of the API.
 *
 * No fonts are loaded: the defaults are system font stacks.
 */
/** One breakpoint for every element: at or below this width (px) the elements switch to their narrow layout. */
export const NARROW_WIDTH = 760;

export const THEME_CSS = /* css */ `
:host {
  /* follow the page: while --scxml-color-scheme is unset this is invalid, so color-scheme
     inherits and light-dark() below matches the page. Set it to "light dark" to follow the OS. */
  color-scheme: var(--scxml-color-scheme);
  /* text */
  --x-fg1: var(--scxml-fg, light-dark(#1c1c21, #ececf1));
  --x-fg2: var(--scxml-fg-muted, light-dark(#484852, #bcbcc6));
  --x-fg3: var(--scxml-fg-subtle, light-dark(#6a6a75, #90909b));
  --x-fg4: var(--scxml-fg-faint, light-dark(#85858f, #777781)); /* graphics only (≥3:1), never text */
  /* surfaces */
  --x-bg: var(--scxml-bg, light-dark(#f6f6f8, #141417));
  --x-s1: var(--scxml-surface, light-dark(#ffffff, #1c1c20));
  --x-s2: var(--scxml-surface-2, light-dark(#f0f0f3, #242429));
  --x-s3: var(--scxml-surface-3, light-dark(#e5e5ea, #2e2e34));
  /* lines */
  --x-b1: var(--scxml-border, light-dark(#e6e6eb, #2a2a30));
  --x-b2: var(--scxml-border-2, light-dark(#d3d3da, #393940));
  --x-strong: var(--scxml-border-strong, light-dark(#8b8b96, #6c6c77));
  /* the one accent */
  --x-accent: var(--scxml-accent, light-dark(#3d5bd9, #8fa3ff));
  --x-accent-fg: var(--scxml-accent-text, light-dark(#2f49b8, #aebcff));
  --x-accent-subtle: var(--scxml-accent-subtle, light-dark(#e9edfc, #252c4c));
  --x-on-accent: var(--scxml-on-accent, light-dark(#ffffff, #10132b));
  /* lifecycle */
  --x-run: var(--scxml-running, light-dark(#26733a, #6fd48a));
  --x-run-bg: var(--scxml-running-bg, light-dark(#e5f3e9, #1a3123));
  --x-wait: var(--scxml-waiting, light-dark(#a8560a, #ffb46b));
  --x-wait-bg: var(--scxml-waiting-bg, light-dark(#fdf0e1, #382815));
  --x-done: var(--scxml-done, light-dark(#48566b, #a7b5c9));
  --x-done-bg: var(--scxml-done-bg, light-dark(#e9edf3, #242b35));
  --x-err: var(--scxml-error, light-dark(#c2332f, #ff8a84));
  /* type */
  --x-sans: var(--scxml-font-sans, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
  --x-mono: var(--scxml-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  --x-serif: var(--scxml-font-display, var(--x-sans));
  --x-display-weight: var(--scxml-display-weight, 600);
  /* shape and motion */
  --x-r: var(--scxml-radius, 4px);
  --x-dur: var(--scxml-duration, 140ms);
  --x-row: var(--scxml-row-height, 30px);
  color: var(--x-fg1); font: 400 13px/1.4 var(--x-sans);
}
* { box-sizing: border-box; }
button { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--x-accent); outline-offset: 1px; }

/* ── primitives shared by the elements ─────────────────── */
.search { display: flex; gap: 6px; padding: 0 12px 8px; flex: none; }
.search input[type="search"] {
  flex: 1; min-width: 0; height: 28px; padding: 0 8px; font: 12px var(--x-mono); color: var(--x-fg1);
  background: var(--x-s1); border: 1px solid var(--x-b2); border-radius: var(--x-r);
}
.search input[type="search"]:focus { border-color: var(--x-accent); }
.toggle { display: inline-flex; align-items: center; gap: 4px; font: 11px var(--x-sans); color: var(--x-fg3); white-space: nowrap; cursor: pointer; }
.badge { display: inline-block; font: 500 10px/1 var(--x-mono); letter-spacing: .06em; text-transform: uppercase; padding: 3px 5px; border-radius: var(--x-r); white-space: nowrap; }
.badge.run { color: var(--x-run); background: var(--x-run-bg); }
.badge.wait { color: var(--x-wait); background: var(--x-wait-bg); }
.badge.done { color: var(--x-done); background: var(--x-done-bg); }
.badge.muted { color: var(--x-fg3); background: var(--x-s2); }
.count { font: 500 11px var(--x-mono); color: var(--x-fg3); font-variant-numeric: tabular-nums; }
.chip {
  display: inline-flex; align-items: center; gap: 4px; max-width: 100%; border: 1px solid var(--x-b2); background: var(--x-s1);
  border-radius: 999px; padding: 2px 8px; font: 11.5px/1.4 var(--x-mono); color: var(--x-accent-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer;
}
.chip:hover { border-color: var(--x-accent); background: var(--x-accent-subtle); }
.chip.muted { color: var(--x-fg3); cursor: default; }
.chip.muted:hover { border-color: var(--x-b2); background: var(--x-s1); }
.more { border: 0; background: none; padding: 2px 4px; font: 500 11px var(--x-mono); color: var(--x-fg3); cursor: pointer; }
.more:hover { color: var(--x-accent-fg); }
.kind { display: inline-grid; place-items: center; width: 16px; height: 16px; flex: none; font: 11px/1 var(--x-mono); color: var(--x-fg3); }
.empty { color: var(--x-fg3); padding: 16px 12px; font-style: italic; }
h2.title { font: var(--x-display-weight) 24px/1.15 var(--x-serif); letter-spacing: -.01em; margin: 6px 0 2px; }
.subtitle { color: var(--x-fg3); font: 12px var(--x-sans); margin: 0 0 14px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.section-title { display: flex; align-items: center; gap: 8px; margin: 18px 0 8px; font: 500 10.5px var(--x-mono); letter-spacing: .12em; text-transform: uppercase; color: var(--x-fg3); }
.section-title::after { content: ""; flex: 1; border-top: 1px solid var(--x-b1); }

@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
`;

/**
 * A constructable stylesheet, created on first use (so modules can be
 * imported where there is no DOM) and shared by every shadow root that
 * adopts it (browsers share the parsed sheet). One per realm: a sheet can
 * only be adopted by documents of the realm whose `CSSStyleSheet` made it.
 */
export function lazySheet(css: string): () => CSSStyleSheet {
  const made = new WeakMap<typeof CSSStyleSheet, CSSStyleSheet>();
  return () => {
    let sheet = made.get(CSSStyleSheet);
    if (!sheet) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      made.set(CSSStyleSheet, sheet);
    }
    return sheet;
  };
}

/** The shared theme as one constructable stylesheet, adopted by every element's shadow root. */
export const themeSheet = lazySheet(THEME_CSS);

/**
 * Colour pairs every theme must keep readable, as public token names:
 * [foreground, background, minimum WCAG contrast]. Text needs 4.5:1 (AA);
 * `--scxml-fg-faint` and `--scxml-border-strong` are for graphics only and need 3:1.
 * Checked for the neutral theme by the package tests and for the Tinyactors
 * mapping by the playground tests.
 */
export const CONTRAST_PAIRS: readonly [string, string, number][] = [
  ["--scxml-fg", "--scxml-bg", 4.5],
  ["--scxml-fg", "--scxml-surface", 4.5],
  ["--scxml-fg-muted", "--scxml-surface", 4.5],
  ["--scxml-fg-muted", "--scxml-surface-2", 4.5],
  ["--scxml-fg-subtle", "--scxml-bg", 4.5],
  ["--scxml-fg-subtle", "--scxml-surface", 4.5],
  ["--scxml-fg-subtle", "--scxml-surface-2", 4.5],
  ["--scxml-accent-text", "--scxml-bg", 4.5],
  ["--scxml-accent-text", "--scxml-surface", 4.5],
  ["--scxml-accent-text", "--scxml-accent-subtle", 4.5],
  ["--scxml-on-accent", "--scxml-accent", 4.5],
  ["--scxml-running", "--scxml-bg", 4.5],
  ["--scxml-running", "--scxml-surface", 4.5],
  ["--scxml-running", "--scxml-running-bg", 4.5],
  ["--scxml-waiting", "--scxml-surface", 4.5],
  ["--scxml-waiting", "--scxml-waiting-bg", 4.5],
  ["--scxml-done", "--scxml-done-bg", 4.5],
  ["--scxml-error", "--scxml-surface", 4.5],
  ["--scxml-fg-faint", "--scxml-surface", 3],
  ["--scxml-fg-faint", "--scxml-surface-2", 3],
  ["--scxml-border-strong", "--scxml-surface", 3],
];

/** The neutral theme's colours for one scheme, keyed by public token name (parsed from THEME_CSS). */
export function neutralPalette(scheme: "light" | "dark"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of THEME_CSS.matchAll(/var\((--scxml-[\w-]+),\s*light-dark\((#[0-9a-f]{3,6}),\s*(#[0-9a-f]{3,6})\)\)/gi))
    out[m[1]!] = scheme === "light" ? m[2]! : m[3]!;
  return out;
}

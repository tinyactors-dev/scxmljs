/**
 * The Tinyactors theme (@tinyactors/scxmljs/themes/tinyactors.css) mapped onto
 * the Tinyactors design tokens (web/css/tokens/colors.css): every pair in
 * CONTRAST_PAIRS must meet its WCAG minimum, in light and dark.
 */
import { expect, test } from "bun:test";
import { contrast } from "../../../packages/scxmljs/src/explorer/layout.ts";
import { CONTRAST_PAIRS } from "../../../packages/scxmljs/src/ui/theme.ts";

const tokensCss = await Bun.file(new URL("../web/css/tokens/colors.css", import.meta.url)).text();
const themeCss = await Bun.file(new URL("../../../packages/scxmljs/src/themes/tinyactors.css", import.meta.url)).text();

const declarations = (text: string) =>
  Object.fromEntries([...text.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
const block = (re: RegExp) => re.exec(tokensCss)?.[1] ?? "";
const light = declarations(block(/:root\s*\{([^}]*)\}/));
const dark = { ...light, ...declarations(block(/\[data-theme="dark"\]\s*\{([^}]*)\}/)) };
const mapping = declarations(themeCss.slice(themeCss.indexOf("{")));

const hex = (c: string) => c.replace(/^#/, "").padEnd(6, "0");
const mix = (a: string, b: string, p: number) =>
  `#${[0, 2, 4]
    .map((i) =>
      Math.round(Number.parseInt(hex(a).slice(i, i + 2), 16) * p + Number.parseInt(hex(b).slice(i, i + 2), 16) * (1 - p))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

/** Resolve var(), color-mix(in srgb, A p%, B) and hex colours against a token set. */
function resolve(value: string, env: Record<string, string>): string {
  const v = value.trim();
  const variable = /^var\((--[\w-]+)\)$/.exec(v);
  if (variable) return resolve(env[variable[1]!] ?? "", env);
  const m = /^color-mix\(in srgb,\s*(.+?)\s+(\d+)%,\s*(.+)\)$/.exec(v);
  if (m) return mix(resolve(m[1]!, env), resolve(m[3]!, env), Number(m[2]) / 100);
  if (/^#[0-9a-f]{3,6}$/i.test(v)) return v;
  throw new Error(`can't resolve "${value}"`);
}

for (const [scheme, env] of [
  ["light", light],
  ["dark", dark],
] as const) {
  test(`tinyactors theme: WCAG contrast in ${scheme}`, () => {
    const failures = CONTRAST_PAIRS.flatMap(([fg, bg, min]) => {
      const ratio = contrast(resolve(mapping[fg]!, env), resolve(mapping[bg]!, env));
      return ratio < min ? [`${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`] : [];
    });
    expect(failures).toEqual([]);
  });
}

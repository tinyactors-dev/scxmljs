/**
 * A strict Content-Security-Policy (`style-src 'self'`, no 'unsafe-inline')
 * blocks style *attributes* set from script, but not the CSSOM
 * (`el.style.x = …`, `el.style.cssText = …`) or adopted stylesheets. The
 * elements must only use the latter; docs/csp.md promises it.
 *
 * happy-dom implements the CSSOM by writing the style attribute, so a DOM
 * test can't tell the two apart; this guards the source instead (the browser
 * check lives with the browser tests).
 */
import { expect, test } from "bun:test";
import { Glob } from "bun";

const SRC = new URL("../src/", import.meta.url).pathname;
const files = [...new Glob("**/*.ts").scanSync(SRC)];

test("no style attributes from script: no setAttribute('style'), no style=\"…\" in markup strings", async () => {
  const offenders: string[] = [];
  for (const f of files) {
    const text = await Bun.file(SRC + f).text();
    text.split("\n").forEach((line, i) => {
      if (/setAttribute\(\s*["'`]style["'`]/.test(line) || /innerHTML\s*=.*\sstyle=/.test(line))
        offenders.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  expect(offenders).toEqual([]);
});

test('the elements\' markup helpers route a "style" key through the CSSOM', async () => {
  for (const f of ["explorer/element.ts", "view/element.ts"]) {
    const text = await Bun.file(SRC + f).text();
    expect(text).toMatch(/k === "style"\) el\.style\.cssText = /);
  }
});

test("no HTML parsing from strings in the elements (Trusted Types: require-trusted-types-for 'script')", async () => {
  const offenders: string[] = [];
  for (const f of files) {
    const text = await Bun.file(SRC + f).text();
    text.split("\n").forEach((line, i) => {
      if (/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML\(|createContextualFragment\(|document\.write\(/.test(line))
        offenders.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  expect(offenders).toEqual([]);
});

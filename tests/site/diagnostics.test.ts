import { expect, test } from "bun:test";
import { maskNonMarkup, offsetAt, parseErrorMessage, parseErrorPosition, rangeOfProblem } from "../../site/client/diagnostics.ts";

test("parse error positions from Chromium and Firefox messages", () => {
  expect(parseErrorPosition("error on line 3 at column 5: Unexpected token")).toEqual({ line: 3, column: 5 });
  expect(parseErrorPosition("XML Parsing Error: mismatched tag\nLine Number 7, Column 12:")).toEqual({ line: 7, column: 12 });
  expect(parseErrorPosition("something else")).toBeUndefined();
});

test("parse error messages drop the browser boilerplate and namespace prefixes", () => {
  expect(
    parseErrorMessage(
      "This page contains the following errors:error on line 37 at column 13: Unexpected closing tag: {http://www.w3.org/2005/07/scxml}parallel != {http://www.w3.org/2005/07/scxml}paralel\nBelow is a rendering of the page up to the first error.",
    ),
  ).toBe("error on line 37 at column 13: Unexpected closing tag: parallel != paralel");
});

test("offsets, masking and problem ranges", () => {
  const src = '<scxml>\n  <!-- id="a" -->\n  <state id="a"/>\n</scxml>';
  expect(offsetAt(src, 3, 3)).toBe(src.indexOf("<state"));
  const masked = maskNonMarkup(src);
  expect(masked.length).toBe(src.length);
  const r = rangeOfProblem(src, masked, 'state "a" is unreachable');
  expect(src.slice(r.from, r.to)).toBe("a");
  expect(r.from).toBe(src.indexOf('id="a"/>') + 4); // not the one in the comment
});

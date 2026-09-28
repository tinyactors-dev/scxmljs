import { describe, expect, test } from "bun:test";
import { contrast, luminance, placeLabels } from "../src/explorer/layout.ts";
import { defaultStrings } from "../src/explorer/strings.ts";
import { CONTRAST_PAIRS, neutralPalette } from "../src/ui/theme.ts";

describe("placeLabels", () => {
  test("keeps preferred spots when there is room", () => {
    const out = placeLabels([
      { cx: 50, cy: 50, w: 40, h: 16 },
      { cx: 200, cy: 50, w: 40, h: 16 },
    ]);
    expect(out).toEqual([
      { cx: 50, cy: 50, collapsed: false },
      { cx: 200, cy: 50, collapsed: false },
    ]);
  });

  test("moves a colliding label to the nearest free offset, earlier labels winning", () => {
    const out = placeLabels(
      [
        { cx: 50, cy: 50, w: 40, h: 16 },
        { cx: 55, cy: 52, w: 40, h: 16 },
      ],
      [],
      { step: 24, tries: 2 },
    );
    expect(out[0]).toEqual({ cx: 50, cy: 50, collapsed: false });
    expect(out[1]).toEqual({ cx: 55, cy: 28, collapsed: false }); // −step first
  });

  test("avoids obstacles and collapses labels with no free spot", () => {
    const wall = { x: 0, y: 0, w: 200, h: 200 };
    expect(placeLabels([{ cx: 100, cy: 100, w: 30, h: 16 }], [wall])).toEqual([{ cx: 100, cy: 100, collapsed: true }]);
    const below = placeLabels([{ cx: 100, cy: 205, w: 30, h: 16 }], [wall], { step: 14, tries: 2 });
    expect(below[0]).toEqual({ cx: 100, cy: 219, collapsed: false }); // −14 still hits the wall, +14 is free
  });

  test("is deterministic", () => {
    const labels = Array.from({ length: 12 }, (_, i) => ({ cx: 100 + (i % 3) * 5, cy: 100 + (i % 4) * 3, w: 60, h: 18 }));
    expect(placeLabels(labels)).toEqual(placeLabels(labels));
  });
});

describe("contrast", () => {
  test("WCAG luminance and ratios", () => {
    expect(luminance("#000")).toBe(0);
    expect(luminance("#ffffff")).toBe(1);
    expect(contrast("#000000", "#ffffff")).toBe(21);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });

  for (const scheme of ["light", "dark"] as const)
    test(`the neutral theme meets WCAG minimums in ${scheme}`, () => {
      const palette = neutralPalette(scheme);
      const failures = CONTRAST_PAIRS.flatMap(([fg, bg, min]) => {
        const ratio = contrast(palette[fg]!, palette[bg]!);
        return ratio < min ? [`${fg} on ${bg}: ${ratio.toFixed(2)} < ${min}`] : [];
      });
      expect(failures).toEqual([]);
    });
});

test("every default string renders (plural forms included)", () => {
  const step = { machine: "m", event: "e", moves: ["a → b"] };
  const out: string[] = [];
  for (const [k, v] of Object.entries(defaultStrings)) {
    if (typeof v === "string") out.push(v);
    else if (k === "announceStep") out.push(v(step), v({ ...step, moves: [] }), v({ machine: "m", moves: [] }));
    else if (k === "kind") out.push(v("atomic"));
    else if (k === "status") out.push(v("running"));
    else out.push(v(1, 1, 1), v(2, 3, 4));
  }
  expect(out.every((s) => typeof s === "string" && s.length > 0)).toBe(true);
  expect(defaultStrings.events(1)).toBe("1 event");
  expect(defaultStrings.events(2)).toBe("2 events");
  expect(defaultStrings.systemSummary(1, 2, 0)).toBe("1 machine · 2 external services · 0 messages");
  expect(defaultStrings.announceStep({ machine: "m", event: "go", moves: [] })).toBe("m: go, no transition");
});

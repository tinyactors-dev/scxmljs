/**
 * Pins the calibration of compare.ts on fixture pairs cropped (192×192) from real renders:
 *
 *   noise-*   arm64 and amd64 renders of the same entry, where they differ most (anti-aliasing);
 *             they must count as the same picture.
 *   change-*  an arm64 render and the same render after a small real change, where it differs
 *             most; they must count as different. The changes: the neutral accent #3d5bd9 →
 *             #4563d0 (dark #8fa3ff → #97abff); a state box moved 1px right; its bottom shadow
 *             line 1px lower; the explorer's "Step" button reading "Next"; the explorer sampled
 *             300 ms earlier; the tour sampled 400 ms earlier.
 *   video-*   the same, as decoded frames of the webm (lossy against lossy).
 *
 * PUBLISHING.md ("Documentation media") has the whole-picture numbers.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { PNG } from "pngjs";
import { diffPixels, type Picture, samePicture, TOLERANCE, type Tolerance } from "./compare.ts";

const load = async (file: string): Promise<Picture> => {
  const png = PNG.sync.read(Buffer.from(await Bun.file(join(import.meta.dir, "fixtures", file)).arrayBuffer()));
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
};
const pair = async (name: string) => Promise.all([load(`${name}.a.png`), load(`${name}.b.png`)]);
const bytesDiffer = (a: Picture, b: Picture) => a.data.some((v, i) => v !== b.data[i]);

const cases: [string, Tolerance, boolean][] = [
  ["noise-explorer-light", TOLERANCE.lossless, true],
  ["noise-explorer-dark", TOLERANCE.lossless, true],
  ["noise-view-light", TOLERANCE.lossless, true],
  ["noise-view-dark", TOLERANCE.lossless, true],
  ["noise-explorer-tour", TOLERANCE.lossless, true],
  ["change-accent-view-light", TOLERANCE.lossless, false],
  ["change-accent-view-dark", TOLERANCE.lossless, false],
  ["change-border-view-light", TOLERANCE.lossless, false],
  ["change-shadow-view-dark", TOLERANCE.lossless, false],
  ["change-word-explorer-light", TOLERANCE.lossless, false],
  ["change-state-explorer-dark", TOLERANCE.lossless, false],
  ["change-state-explorer-tour", TOLERANCE.lossless, false],
  ["video-noise-explorer-tour", TOLERANCE.video, true],
  ["video-change-word-explorer-tour", TOLERANCE.video, false],
];

describe("media comparison", () => {
  for (const [name, tolerance, same] of cases)
    test(`${name}: ${same ? "same picture" : "different"}`, async () => {
      const [a, b] = await pair(name);
      expect(bytesDiffer(a, b)).toBe(true); // a hash would call every pair different
      expect({ name, pixels: diffPixels(a, b, tolerance.threshold), same: samePicture(a, b, tolerance) }).toMatchObject({ name, same });
    });

  test("a different size is never the same picture", async () => {
    const [a] = await pair("noise-view-light");
    const smaller = { width: a.width - 1, height: a.height, data: a.data.subarray(0, (a.width - 1) * a.height * 4) };
    expect(samePicture(a, smaller, TOLERANCE.lossless)).toBe(false);
  });
});

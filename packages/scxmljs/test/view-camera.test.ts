/**
 * The view's camera (src/view/camera.ts): the smooth zoom path between two views, a zoom around a
 * point, and a glide, as plain numbers.
 */
import { describe, expect, test } from "bun:test";
import { anchoredZoom, easeInOut, glide, smoothPath, type View } from "../src/view/camera.ts";

const close = (a: View, b: View) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
  expect(a.scale).toBeCloseTo(b.scale, 6);
};
const samples = (n: number) => Array.from({ length: n + 1 }, (_, i) => i / n);

describe("smoothPath", () => {
  test("starts and ends at its views", () => {
    const a = { x: 100, y: 80, scale: 1 };
    const b = { x: 1400, y: 900, scale: 0.8 };
    const move = smoothPath(a, b, 800);
    close(move.at(0), a);
    close(move.at(1), b);
  });

  test("a long trip zooms out on the way, so both ends pass through view, and back in; a short hop barely does", () => {
    const a = { x: 0, y: 0, scale: 1 };
    const far = smoothPath(a, { x: 3000, y: 0, scale: 1 }, 800);
    const lowest = Math.min(...samples(50).map((t) => far.at(t).scale));
    expect(lowest).toBeLessThan(0.5);
    // the canvas shows both ends at the lowest point
    expect(800 / lowest).toBeGreaterThan(3000 * 0.9);
    const near = smoothPath(a, { x: 120, y: 0, scale: 1 }, 800);
    expect(Math.min(...samples(50).map((t) => near.at(t).scale))).toBeGreaterThan(0.97);
  });

  test("it moves steadily: the middle of the canvas never goes back on the way", () => {
    const move = smoothPath({ x: 0, y: 0, scale: 1 }, { x: 2000, y: 600, scale: 1.2 }, 900);
    const xs = samples(60).map((t) => move.at(t).x);
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThanOrEqual(xs[i - 1]! - 1e-9);
  });

  test("its duration grows with the trip, within bounds", () => {
    const a = { x: 0, y: 0, scale: 1 };
    const hop = smoothPath(a, { x: 50, y: 0, scale: 1 }, 800).duration;
    const trip = smoothPath(a, { x: 2500, y: 0, scale: 1 }, 800).duration;
    const huge = smoothPath(a, { x: 1e7, y: 0, scale: 1 }, 800).duration;
    expect(hop).toBeGreaterThanOrEqual(220);
    expect(trip).toBeGreaterThan(hop);
    expect(huge).toBeLessThanOrEqual(950);
  });

  test("in place it only zooms, geometrically", () => {
    const move = smoothPath({ x: 10, y: 10, scale: 1 }, { x: 10, y: 10, scale: 4 }, 800);
    close(move.at(0.5), { x: 10, y: 10, scale: 2 });
  });
});

describe("anchoredZoom", () => {
  test("the point under the pointer stays under it", () => {
    const a = { x: 400, y: 300, scale: 1 };
    const offset = { x: -150, y: 80 }; // the pointer, from the canvas's middle
    const point = { x: a.x + offset.x / a.scale, y: a.y + offset.y / a.scale };
    const move = anchoredZoom(a, 2.5, point, offset);
    for (const t of samples(10)) {
      const v = move.at(t);
      expect(v.x + offset.x / v.scale).toBeCloseTo(point.x, 6);
      expect(v.y + offset.y / v.scale).toBeCloseTo(point.y, 6);
    }
    expect(move.at(1).scale).toBe(2.5);
  });
});

describe("glide and easing", () => {
  test("a glide pans at one scale; the easing starts and stops softly", () => {
    const move = glide({ x: 0, y: 0, scale: 0.8 }, { x: 300, y: 100, scale: 0.8 });
    for (const t of samples(10)) expect(move.at(t).scale).toBe(0.8);
    close(move.at(1), { x: 300, y: 100, scale: 0.8 });
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 9);
    expect(easeInOut(0.1)).toBeLessThan(0.1);
  });
});

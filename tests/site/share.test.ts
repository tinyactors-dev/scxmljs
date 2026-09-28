import { describe, expect, test } from "bun:test";
import { deflateRawSync } from "node:zlib";
import {
  decodeChart,
  encodeChart,
  fromBase64url,
  MAX_CHART,
  MAX_ENCODED,
  makeHash,
  readHash,
  ShareError,
  toBase64url,
} from "../../site/client/share.ts";

const chart = `<scxml xmlns="http://www.w3.org/2005/07/scxml" version="1.0" initial="a">
  <state id="a"><transition event="go" target="b"/></state>
  <final id="b"/>
  <!-- unicode survives: ü, 状態, 🚦 -->
</scxml>`;

describe("playground share links", () => {
  test("round-trips a chart through the URL format", async () => {
    const code = await encodeChart(chart);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    // realistic charts are repetitive XML: the link is much shorter than the text
    const big = await Bun.file(new URL("../../examples/playground/charts/fulfillment.scxml", import.meta.url)).text();
    expect((await encodeChart(big)).length).toBeLessThan(big.length / 3);
    expect(await decodeChart(code)).toBe(chart);
    const hash = makeHash(code, "traffic-light");
    expect(readHash(hash)).toEqual({ example: "traffic-light", chart: code });
  });

  test("the build's node:zlib encoding decodes in the client", async () => {
    const code = toBase64url(new Uint8Array(deflateRawSync(Buffer.from(chart))));
    expect(await decodeChart(code)).toBe(chart);
  });

  test("base64url helpers round-trip arbitrary bytes", () => {
    const bytes = new Uint8Array(70_000).map((_, i) => (i * 7) % 256);
    expect(fromBase64url(toBase64url(bytes))).toEqual(bytes);
  });

  test("malformed codes are rejected with a ShareError", async () => {
    for (const bad of ["", "not a code!", "%%%", "AAAA", toBase64url(new TextEncoder().encode("plain text, not deflate"))]) {
      const err = await decodeChart(bad).catch((e) => e);
      expect(err).toBeInstanceOf(ShareError);
      expect(err.reason).toBe("malformed");
    }
  });

  test("invalid UTF-8 inside a valid stream is rejected", async () => {
    const code = toBase64url(new Uint8Array(deflateRawSync(Buffer.from([0xff, 0xfe, 0xfd]))));
    const err = await decodeChart(code).catch((e) => e);
    expect(err).toBeInstanceOf(ShareError);
  });

  test("oversized links and zip bombs are refused", async () => {
    const long = await decodeChart("A".repeat(MAX_ENCODED + 1)).catch((e) => e);
    expect(long.reason).toBe("too-large");
    const bomb = toBase64url(new Uint8Array(deflateRawSync(Buffer.alloc(MAX_CHART + 1, 32))));
    expect(bomb.length).toBeLessThan(MAX_ENCODED);
    const err = await decodeChart(bomb).catch((e) => e);
    expect(err.reason).toBe("too-large");
    const big = await encodeChart(" ".repeat(MAX_CHART + 1)).catch((e) => e);
    expect(big.reason).toBe("too-large");
  });
});

/**
 * Playground share links: a chart travels in the URL hash as
 * `#example=<id>&chart=<code>`, where `code` is the chart's UTF-8 text, compressed with raw
 * DEFLATE and encoded as base64url. The build (scripts/site/build.ts) makes the same links with
 * node:zlib's deflateRawSync, so docs samples can open in the playground.
 */

/** Longest `chart=` value accepted (characters). */
export const MAX_ENCODED = 60_000;
/** Largest chart accepted (bytes of UTF-8, after decompression). */
export const MAX_CHART = 256 * 1024;

export class ShareError extends Error {
  constructor(
    readonly reason: "too-large" | "malformed",
    message: string,
  ) {
    super(message);
    this.name = "ShareError";
  }
}

export function toBase64url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(code: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(code)) throw new ShareError("malformed", "the link contains characters a chart code can't have");
  const b64 = code.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (code.length % 4)) % 4);
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new ShareError("malformed", "the chart code in the link isn't valid base64url");
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Chart text → the `chart=` value. Throws ShareError("too-large") for oversized charts. */
export async function encodeChart(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_CHART) throw new ShareError("too-large", `the chart is larger than ${MAX_CHART / 1024} KB`);
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const code = toBase64url(new Uint8Array(await new Response(stream).arrayBuffer()));
  if (code.length > MAX_ENCODED) throw new ShareError("too-large", "the chart is too large for a link; download it instead");
  return code;
}

/** The `chart=` value → chart text. Throws ShareError for anything that isn't a valid, reasonably sized chart code. */
export async function decodeChart(code: string): Promise<string> {
  if (!code) throw new ShareError("malformed", "the link has no chart in it");
  if (code.length > MAX_ENCODED) throw new ShareError("too-large", "the chart code in the link is too long");
  const bytes = fromBase64url(code);
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_CHART) {
        await reader.cancel();
        throw new ShareError("too-large", `the shared chart is larger than ${MAX_CHART / 1024} KB`);
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof ShareError) throw e;
    throw new ShareError("malformed", "the chart in the link is damaged (it doesn't decompress)");
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.length;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(all);
  } catch {
    throw new ShareError("malformed", "the chart in the link isn't valid text");
  }
}

/** Reads `example` and `chart` from a location hash (`#example=…&chart=…`). */
export function readHash(hash: string): { example?: string; chart?: string } {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return { example: params.get("example") ?? undefined, chart: params.get("chart") ?? undefined };
}

/** The hash for a chart (and the example it started from). */
export function makeHash(code: string, example?: string): string {
  const params = new URLSearchParams();
  if (example) params.set("example", example);
  params.set("chart", code);
  return `#${params}`;
}

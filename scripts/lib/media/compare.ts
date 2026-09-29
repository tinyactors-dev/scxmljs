/**
 * Perceptual comparison for the docs media: is a fresh render the picture that's already published?
 *
 * Renders are deterministic per architecture, but amd64 and arm64 Skia anti-alias edges a little
 * differently, so their hashes never match. Staleness is therefore decided on pixels: pixelmatch
 * (the comparator behind Playwright's toHaveScreenshot) with its anti-aliasing detection, a
 * per-pixel colour tolerance, and a budget of differing pixels per frame. PUBLISHING.md records the
 * calibration; compare.test.ts pins it on fixture pairs.
 */
import pixelmatch from "pixelmatch";

export interface Tolerance {
  /** pixelmatch's per-pixel colour distance (0–1, YIQ); smaller is stricter. */
  threshold: number;
  /** differing (non-anti-aliasing) pixels a frame may have and still be the same picture. */
  maxDiffPixels: number;
}

/**
 * Calibrated against amd64 ↔ arm64 renders of every entry (which must pass) and small real changes
 * (which must fail): see "Documentation media" in PUBLISHING.md.
 */
export const TOLERANCE = {
  /** PNG against PNG: lossless, so only real rendering differences show. Decides stills. */
  lossless: { threshold: 0.01, maxDiffPixels: 20 },
  /** webm against webm: both VP9 at crf 30, whose artefacts differ wherever the input does. */
  video: { threshold: 0.2, maxDiffPixels: 20 },
} satisfies Record<string, Tolerance>;

export interface Picture {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel. */
  data: Uint8Array;
}

/** Pixels that differ beyond anti-aliasing and the colour tolerance. */
export function diffPixels(a: Picture, b: Picture, threshold: number): number {
  if (a.width !== b.width || a.height !== b.height) return Math.max(a.width * a.height, b.width * b.height);
  return pixelmatch(a.data, b.data, undefined, a.width, a.height, { threshold, includeAA: false });
}

export function samePicture(a: Picture, b: Picture, tolerance: Tolerance): boolean {
  return a.width === b.width && a.height === b.height && diffPixels(a, b, tolerance.threshold) <= tolerance.maxDiffPixels;
}

/** Size and duration of an image or video file (ffprobe). */
export async function probe(file: string): Promise<{ width: number; height: number; duration: number }> {
  const out = await ffprobe(["-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file]);
  const info = JSON.parse(out) as { streams: { width: number; height: number }[]; format: { duration?: string } };
  const s = info.streams[0];
  if (!s) throw new Error(`${file}: no video stream`);
  return { width: s.width, height: s.height, duration: Number(info.format.duration ?? 0) };
}

/**
 * Decodes a file's frames as RGBA, one at a time (a 2880×1800 frame is 20 MB). `select` picks
 * frame numbers (for a video: the decoded frames at its native rate); without it, every frame.
 * (ffmpeg's select filter can't take a hundred terms, so the others are skipped here.)
 */
export async function* frames(file: string, select?: number[]): AsyncGenerator<Picture> {
  const { width, height } = await probe(file);
  const size = width * height * 4;
  const wanted = select && new Set(select);
  const proc = Bun.spawn(
    ["mise", "exec", "--", "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgba", "-"],
    { stdout: "pipe", stderr: "pipe" }, // stopping early breaks its pipe, which it reports
  );
  let buf = new Uint8Array(size);
  let filled = 0;
  let index = 0;
  let finished = false;
  try {
    for await (const chunk of proc.stdout) {
      let at = 0;
      while (at < chunk.length) {
        const n = Math.min(size - filled, chunk.length - at);
        const keep = !wanted || wanted.has(index);
        if (keep) buf.set(chunk.subarray(at, at + n), filled);
        filled += n;
        at += n;
        if (filled === size) {
          if (keep) {
            yield { width, height, data: buf };
            buf = new Uint8Array(size);
          }
          filled = 0;
          index++;
        }
      }
    }
    finished = true;
  } finally {
    if (!finished) proc.kill(); // the caller stopped early
  }
  if ((await proc.exited) !== 0) throw new Error(`ffmpeg couldn't decode ${file}: ${(await new Response(proc.stderr).text()).trim()}`);
}

/** The first frame of an image (or video). */
export async function picture(file: string): Promise<Picture> {
  for await (const f of frames(file)) return f;
  throw new Error(`${file}: no frames`);
}

export interface Verdict {
  same: boolean;
  /** the most differing pixels in any compared frame */
  worst: number;
  frames: number;
  reason?: string;
}

/** Compares two stills (any format ffmpeg reads). */
export async function compareStills(a: string, b: string, tolerance: Tolerance): Promise<Verdict> {
  const [pa, pb] = await Promise.all([picture(a), picture(b)]);
  if (pa.width !== pb.width || pa.height !== pb.height)
    return { same: false, worst: Number.POSITIVE_INFINITY, frames: 1, reason: `size ${pa.width}×${pa.height} ≠ ${pb.width}×${pb.height}` };
  const worst = diffPixels(pa, pb, tolerance.threshold);
  return { same: worst <= tolerance.maxDiffPixels, worst, frames: 1 };
}

/**
 * Compares two videos: size, duration (to a frame), then the given frames pairwise (both files
 * decoded in step). Stops at the first frame that differs.
 */
export async function compareVideos(a: string, b: string, select: number[], fps: number, tolerance: Tolerance): Promise<Verdict> {
  const [ia, ib] = await Promise.all([probe(a), probe(b)]);
  if (ia.width !== ib.width || ia.height !== ib.height)
    return { same: false, worst: Number.POSITIVE_INFINITY, frames: 0, reason: `size ${ia.width}×${ia.height} ≠ ${ib.width}×${ib.height}` };
  if (Math.abs(ia.duration - ib.duration) > 1 / fps)
    return { same: false, worst: Number.POSITIVE_INFINITY, frames: 0, reason: `duration ${ia.duration}s ≠ ${ib.duration}s` };
  const picks = [...new Set(select)].sort((x, y) => x - y);
  const count = picks.length;
  const fa = frames(a, picks);
  const fb = frames(b, picks);
  let worst = 0;
  let n = 0;
  try {
    for (;;) {
      const [x, y] = await Promise.all([fa.next(), fb.next()]);
      if (x.done || y.done) {
        if (x.done !== y.done || n !== count)
          return { same: false, worst: Number.POSITIVE_INFINITY, frames: n, reason: `decoded ${n} of ${count} frames` };
        return { same: true, worst, frames: n };
      }
      const d = diffPixels(x.value, y.value, tolerance.threshold);
      worst = Math.max(worst, d);
      n++;
      if (d > tolerance.maxDiffPixels)
        return { same: false, worst, frames: n, reason: `frame ${picks[n - 1]}: ${d} px differ (> ${tolerance.maxDiffPixels})` };
    }
  } finally {
    await Promise.all([fa.return(undefined), fb.return(undefined)]);
  }
}

async function ffprobe(args: string[]): Promise<string> {
  const res = Bun.spawnSync(["mise", "exec", "--", "ffprobe", "-v", "error", ...args], { stderr: "pipe" });
  if (res.exitCode !== 0) throw new Error(`ffprobe failed: ${args.join(" ")}: ${res.stderr.toString().trim()}`);
  return res.stdout.toString();
}

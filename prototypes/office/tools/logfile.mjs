// tools/logfile.mjs: read a flight-recorder log (engine/log.js; .json or .json.gz) into arrays the
// tools use: rows of each ring as objects, events by channel, and time helpers.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

export function readLog(file) {
  let buf = readFileSync(file);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
  const j = JSON.parse(buf.toString("utf8"));
  if (!String(j.schema || "").startsWith("office-log/")) throw new Error(`${file}: not an office log (schema ${j.schema})`);
  return decode(j);
}

export function decode(j) {
  const rows = (name) => {
    const r = j.rings?.[name]; if (!r) return [];
    const n = r.fields.length, out = [];
    for (let i = 0; i + n <= r.data.length; i += n) { const o = {}; for (let k = 0; k < n; k++) o[r.fields[k]] = r.data[i + k]; out.push(o); }
    return out;
  };
  const frames = rows("frame"), cams = rows("camera"), pointer = rows("pointer");
  const events = (j.events || []).map(([t, ch, type, data]) => ({ t, ch, type, data: data || {} }));
  const by = (ch, type) => events.filter((e) => e.ch === ch && (!type || e.type === type));
  const ready = events.find((e) => e.ch === "session" && e.type === "ready")?.t ?? 0;
  // the app's own clock: each frame advances it by min(100 ms, dt) (main.js caps dt), so a slow
  // software renderer runs the app slower than the wall clock; appAt(t) maps wall ms to app ms
  const appT = [], wallT = []; let acc = 0;
  for (const f of frames) { acc += Math.min(100, f.dt); appT.push(acc); wallT.push(f.t); }
  const appAt = (t) => { if (!wallT.length) return t; let lo = 0, hi = wallT.length; while (lo < hi) { const m = (lo + hi) >> 1; if (wallT[m] <= t) lo = m + 1; else hi = m; } if (lo === 0) return t - wallT[0]; return appT[lo - 1] + Math.min(100, t - wallT[lo - 1]); };
  const wallSum = frames.reduce((a, f) => a + f.dt, 0);
  const slow = wallSum && acc ? wallSum / acc : 1; // wall ms per app ms (1 on a real GPU at >= 10 fps)
  const software = /swiftshader|llvmpipe|software/i.test(j.gl?.renderer || "") || !!j.synthetic;
  return { raw: j, session: j, frames, cams, pointer, events, by, ready, appAt, slow, software, duration: j.duration };
}

/** the camera pose at wall time t: the last sample at or before t, interpolated toward the next unless the next is a jump */
export function poseAt(cams, t) {
  if (!cams.length) return null;
  let lo = 0, hi = cams.length; while (lo < hi) { const m = (lo + hi) >> 1; if (cams[m].t <= t) lo = m + 1; else hi = m; }
  const a = cams[Math.max(0, lo - 1)], b = cams[lo];
  if (!b || b.jump || lo === 0) return a;
  const k = Math.max(0, Math.min(1, (t - a.t) / Math.max(1e-6, b.t - a.t)));
  const L = (x, y) => x + (y - x) * k;
  return { t, px: L(a.px, b.px), py: L(a.py, b.py), pz: L(a.pz, b.pz), tx: L(a.tx, b.tx), ty: L(a.ty, b.ty), tz: L(a.tz, b.tz), fov: L(a.fov, b.fov), playS: Math.abs(b.playS - a.playS) > 2 ? a.playS : L(a.playS, b.playS) };
}

export const fmt = (ms) => `${(ms / 1000).toFixed(1)}s`;

// engine/view.js: what is actually in frame, described compactly for the flight recorder (and
// later for the harness and the camera director): which subjects (people, stations, the board,
// live controls) are on screen and how large, whether the selected one is hidden behind something,
// how many engraved plates are big enough to read, and whether anything pickable is in view.
//
// Owns: projection of boxes and plates to the screen, the readable-text rule (glyph >= MIN_GLYPH_PX).
// Must never know: a system, the app's modes, how subjects are built. The caller hands it subjects
// as {kind, id, min, max} boxes (world space) and plates as meshes (a PlaneGeometry with text on it,
// userData.plate.glyph = the glyph's share of the plate's height).

export const MIN_GLYPH_PX = 9; // a glyph this tall on screen can be read (head/inspect.mjs uses the same)

export function createViewSampler(THREE) {
  const v = new THREE.Vector3(), n = new THREE.Vector3(), c = new THREE.Vector3(), up = new THREE.Vector3(), dn = new THREE.Vector3();
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(() => new THREE.Vector3());
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), bx = new THREE.Box3();

  /** a box's rectangle on screen (clamped), its share of the screen, and whether it is in front */
  function rect(min, max, camera, W, H) {
    bx.min.copy(min); bx.max.copy(max);
    if (!frustum.intersectsBox(bx)) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, front = 0;
    for (let i = 0; i < 8; i++) {
      const p = corners[i].set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z);
      p.project(camera); if (p.z < -1 || p.z > 1) continue; front++;
      const sx = ((p.x + 1) / 2) * W, sy = ((1 - p.y) / 2) * H;
      if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
    }
    if (!front) return null;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W, x1); y1 = Math.min(H, y1);
    if (x1 <= x0 || y1 <= y0) return null;
    return { x0, y0, x1, y1, frac: ((x1 - x0) * (y1 - y0)) / (W * H) };
  }
  const shown = (o) => { for (let q = o; q; q = q.parent) { if (!q.visible) return false; if (!q.parent && !q.isScene) return false; } return true; };

  /** the glyph height on screen of a text plate, or 0 when it is hidden, behind, edge-on or off screen */
  function glyphPx(mesh, camera, W, H) {
    if (!shown(mesh)) return 0;
    const m = mesh.matrixWorld; c.setFromMatrixPosition(m);
    n.set(0, 0, 1).transformDirection(m); v.copy(camera.position).sub(c);
    if (n.dot(v) <= 0) return 0; // its back
    const g = mesh.geometry.parameters || {}; const hh = (g.height ?? 1) / 2;
    up.set(0, hh, 0).applyMatrix4(m).project(camera); dn.set(0, -hh, 0).applyMatrix4(m).project(camera);
    if (up.z < -1 || up.z > 1 || dn.z < -1 || dn.z > 1) return 0;
    const sx = ((up.x + dn.x) / 2 + 1) / 2, sy = (1 - (up.y + dn.y) / 2) / 2; if (sx < 0 || sx > 1 || sy < 0 || sy > 1) return 0;
    const ph = Math.hypot(((up.x - dn.x) / 2) * W, ((up.y - dn.y) / 2) * H);
    return ph * (mesh.userData.plate?.glyph ?? 0.6);
  }

  /**
   * sample({camera, W, H, subjects, plates, selected: {id, min, max} | null, occluded(id): bool})
   * -> {in: [[kind, id, x0, y0, x1, y1, pct]...] (largest first, at most 14), n: {kind: count},
   *     sel: {on, pct, occ} | null, plates: shown, readable, pickable: count of subjects over 0.05 % of the screen}
   */
  function sample({ camera, W, H, subjects, plates = [], selected = null, occluded = null }) {
    camera.updateMatrixWorld(); pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); frustum.setFromProjectionMatrix(pv);
    const seen = []; const count = {};
    for (const s of subjects) {
      const r = rect(s.min, s.max, camera, W, H); if (!r || r.frac < 0.0005) continue;
      seen.push([s.kind, s.id, Math.round(r.x0), Math.round(r.y0), Math.round(r.x1), Math.round(r.y1), Math.round(r.frac * 1000) / 10]);
      count[s.kind] = (count[s.kind] || 0) + 1;
    }
    seen.sort((a, b) => b[6] - a[6]);
    let sel = null;
    if (selected) {
      const r = rect(selected.min, selected.max, camera, W, H);
      sel = { id: selected.id, on: !!r, pct: r ? Math.round(r.frac * 1000) / 10 : 0, occ: r && occluded ? !!occluded(selected.id) : false };
    }
    let shownN = 0, readable = 0, best = 0;
    for (const p of plates) { const g = glyphPx(p, camera, W, H); if (g > 0.5) { shownN++; if (g >= MIN_GLYPH_PX) readable++; if (g > best) best = g; } }
    return { in: seen.slice(0, 14), n: count, sel, plates: shownN, readable, bestGlyph: Math.round(best * 10) / 10, pickable: seen.length };
  }
  return { sample, rect, glyphPx };
}

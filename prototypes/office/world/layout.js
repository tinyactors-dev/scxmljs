// world/layout.js: where things are on a desk, in the SEAT frame: origin on the floor at the
// seat, the sitter faces +z, y up, so the sitter's LEFT hand is on +x and their right on -x.
// One table shared by the desk builder, the avatar's reach targets and the intersection check
// (tools/inspect.html), so a pose is checked against the furniture it is drawn with.
//
// Units: metres. A box is {name, c:[x,y,z] centre, s:[w,h,d] size, ry?}.
export const DESK = {
  topY: 0.76, thick: 0.06, cz: 0.95, w: 2.2, d: 0.95,
  get z0() { return this.cz - this.d / 2; }, get z1() { return this.cz + this.d / 2; },
};
// things on the desk top (y is the top surface they stand on)
export const SPOT = {
  keyboard: [0.02, 0.76, 0.62],     // centre of the keyboard
  monitor: [-0.36, 0.76, 1.08],     // foot of the monitor stand (screen faces the sitter)
  basket: [0.62, 0.76, 0.68],       // the in-basket the tube drops mail into (sitter's left)
  hatch: [0.62, 1.1, 0.68],       // the tube's hatch above the basket
  phone: [-0.86, 0.76, 0.66],       // the telephone (sitter's right)
  timer: [0.36, 0.76, 0.98],        // the egg timer (delayed sends)
  lamp: [-0.92, 0.76, 1.26],        // the desk lamp (lit while someone sits here)
  vars: [[0.66, 1.24], [0.2, 1.24], [-0.26, 1.24], [-0.72, 1.24]], // value objects along the back edge (x, z)
};
export const RISER_X = 1.36; // where the tube rises, at the desk's outer corner (sitter's left)
export const CHAIR = { seatTop: 0.43, cz: -0.05, w: 0.5, d: 0.48, backZ: -0.32, backTop: 0.98, aside: [-0.62, -0.2] };
export const PARTITION = { x: 1.55, z0: -1.0, z1: 1.4, h: 1.12 };

// static boxes of one desk, in the seat frame (for collisions and the pose check)
export function deskBoxes() {
  const b = [];
  b.push({ name: "desk top", c: [0, DESK.topY - DESK.thick / 2, DESK.cz], s: [DESK.w, DESK.thick, DESK.d] });
  b.push({ name: "modesty panel", c: [0, 0.17 + 0.25, DESK.z1 - 0.05], s: [2.0, 0.5, 0.05] });
  const [mx, my, mz] = SPOT.monitor;
  b.push({ name: "monitor", c: [mx, my + 0.46, mz + 0.02], s: [0.6, 0.38, 0.06], ry: 0.32 });
  b.push({ name: "monitor stand", c: [mx, my + 0.15, mz + 0.05], s: [0.06, 0.3, 0.06] });
  const [kx, ky, kz] = SPOT.keyboard; b.push({ name: "keyboard", c: [kx, ky + 0.015, kz], s: [0.5, 0.03, 0.17], soft: true });
  const [bx, by, bz] = SPOT.basket; b.push({ name: "basket", c: [bx, by + 0.045, bz], s: [0.36, 0.09, 0.27], soft: true });
  const [px, py, pz] = SPOT.phone; b.push({ name: "phone", c: [px, py + 0.05, pz], s: [0.24, 0.1, 0.2] });
  // the tube from the hatch: sideways to the desk's outer corner, then up (world/tubes.js)
  const [hx, hy, hz] = SPOT.hatch; b.push({ name: "tube", c: [(hx + RISER_X) / 2, hy + 0.12, hz], s: [RISER_X - hx + 0.17, 0.17, 0.17] }, { name: "tube riser", c: [RISER_X, 2.3, hz], s: [0.17, 2.2, 0.17] }, { name: "hatch", c: [hx, hy, hz], s: [0.21, 0.16, 0.21] });
  b.push({ name: "partition L", c: [PARTITION.x, PARTITION.h / 2, (PARTITION.z0 + PARTITION.z1) / 2], s: [0.12, PARTITION.h, PARTITION.z1 - PARTITION.z0] });
  b.push({ name: "partition R", c: [-PARTITION.x, PARTITION.h / 2, (PARTITION.z0 + PARTITION.z1) / 2], s: [0.12, PARTITION.h, PARTITION.z1 - PARTITION.z0] });
  return b;
}
// the chair: a swivel chair (it turns with its sitter) that slides aside when they stand
export function chairBoxes(aside = 0, turn = 0) {
  const ox = CHAIR.aside[0] * aside, oz = CHAIR.aside[1] * aside, ry = turn + aside * 0.5;
  const at = (z) => [ox + Math.sin(ry) * z, oz + Math.cos(ry) * z]; // turned about the chair group's origin (world/desks.js)
  const [sx, sz] = at(CHAIR.cz), [bx, bz] = at(CHAIR.backZ);
  return [
    { name: "chair seat", c: [sx, CHAIR.seatTop - 0.035, sz], s: [CHAIR.w, 0.07, CHAIR.d], ry },
    { name: "chair back", c: [bx, (CHAIR.seatTop + CHAIR.backTop) / 2, bz], s: [CHAIR.w, CHAIR.backTop - CHAIR.seatTop, 0.06], ry },
  ];
}

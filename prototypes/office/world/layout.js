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
  timer: [0.97, 0.76, 0.7],         // the egg timer (delayed sends): beside the basket
  alarm: [-0.5, 0.76, 0.68],        // the red alarm lamp (an exception): between the keyboard and the phone
  vars: [[0.87, 1.2], [-0.87, 1.2]],  // value objects on the back corners (x, z): the middle is the model's
};
// the person's marble machines as a tabletop model (world/models.js): on the back half of the desk, between the
// value objects, clear of the keyboard, the basket and the phone the hands reach; its footprint at most w x d, h tall
export const MODEL = { x: 0, z: 1.16, w: 1.22, d: 0.5, h: 0.5 };
export const RISER_X = 1.36; // where the tube rises, at the desk's outer corner (sitter's left)
export const CHAIR = { seatTop: 0.43, cz: -0.05, w: 0.5, d: 0.48, backZ: -0.32, backTop: 0.98, aside: [-0.62, -0.2] };
export const PARTITION = { x: 1.55, z0: -1.0, z1: 1.4, h: 1.12 };

// static boxes of one desk, in the seat frame (for collisions and the pose check)
export function deskBoxes() {
  const b = [];
  b.push({ name: "desk top", c: [0, DESK.topY - DESK.thick / 2, DESK.cz], s: [DESK.w, DESK.thick, DESK.d] });
  b.push({ name: "modesty panel", c: [0, 0.17 + 0.25, DESK.z1 - 0.05], s: [2.0, 0.5, 0.05] });
  b.push({ name: "model", c: [MODEL.x, DESK.topY + MODEL.h / 2, MODEL.z], s: [MODEL.w, MODEL.h, MODEL.d] }); // the tabletop model's envelope
  const [ax, ay, az] = SPOT.alarm; b.push({ name: "alarm", c: [ax, ay + 0.03, az], s: [0.14, 0.06, 0.14], soft: true });
  const [tx, ty, tz] = SPOT.timer; b.push({ name: "egg timer", c: [tx, ty + 0.11, tz], s: [0.13, 0.22, 0.13] });
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

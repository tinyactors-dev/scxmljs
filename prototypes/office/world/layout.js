// world/layout.js: where everything is. Units are metres; y up; north = -z; the camera's home
// looks from the south-east. Clients sit in a row facing south (toward the visitor), the exchange
// is in the middle, the model's room behind glass to the north, the archive east, the storeroom
// north-west, reception and the door west.
export const TUBE_Y = 3.7;
export const HUB = [0, TUBE_Y, -1];
export const ROOM = { x0: -16, x1: 16, z0: -13, z1: 11.5 };
export const DOOR = [-15.6, 0, 4.3];
export const AISLE_Z = 4.3;

export const CLIENTS = {
  ada: { x: -9, shirt: "#8e5bd6", pants: "#36324a", hair: "#2a1d18", hairStyle: "long", skin: "#f1c7a1", color: "#b07cff", name: "Ada" },
  bo: { x: -3, shirt: "#3f9a5f", pants: "#3b3a33", hair: "#6b4426", hat: "beanie", skin: "#e2ae86", color: "#ff8a4a", name: "Bo" },
  terminal: { x: 3, shirt: "#3a4150", pants: "#22252e", hair: "#bfc5cf", hairStyle: "short", accessory: "headphones", skin: "#d9a47e", color: "#46d18a", name: "Terminal", glasses: true },
  python: { x: 9, shirt: "#e0b23a", pants: "#2f4d7a", hair: "#1d1d22", skin: "#9c6b4a", color: "#4aa8ff", name: "Python" },
};
export const SEAT_Z = 7.0;     // where a client's chair is
export const DESK_Z = 7.95;    // centre of the desk in front of them (to the south)

export const clientSeat = (id) => [CLIENTS[id].x, 0, SEAT_Z];
export const clientMouth = (id) => [CLIENTS[id].x - 1.15, 1.36, SEAT_Z + 0.35]; // tube mouth, west of the desk
export const toolMachine = (id) => [CLIENTS[id].x + 1.75, 0, SEAT_Z + 0.5];

export const HOST = { seat: [0, 0, -1.2], mouth: [-1.05, 1.35, -1.55] };
export const MODEL = { at: [0, 0, -10.6], mouth: [0, 2.75, -10.0], port: [0, TUBE_Y, -9.0] };
export const ARCHIVE = { seat: [13.4, 0, -0.4], mouth: [12.0, 1.3, -1.6], desk: [12.4, 0, -0.4] };
export const STAGE = { counter: [-12.4, 0, 9.0], mouth: [-11.1, 1.4, 8.3], bell: [-12.0, 1.12, 8.65] };
export const DIRECTOR = { stand: [-14.4, 0, 8.1] };
export const CLOCK = { at: [8.5, 3.0, -12.82], mouth: [8.5, 2.05, -12.55] };
export const STORE = { keeper: [-12.0, 0, -9.3], mouth: [-10.6, 1.25, -8.9] };
export const CRATES = [[-15.0, -12.2], [-13.6, -12.2], [-12.2, -12.2], [-15.0, -10.8], [-13.6, -10.8], [-12.2, -10.8]];
export const BOARD = { center: [-15.85, 2.35, -2.6], w: 7.2, h: 4.05 };

export const HOME = { pos: [11.5, 13.0, 21.0], target: [-1.2, 0.2, 0.8] };

// Bird rigs (issue #7): chicken, rooster, duck on one skeleton, plus shared
// clips. Side view faces right ("left" mirrors it). Birds stand about half a
// character tall; shapes are chunky so they read at 16px. Joint names follow
// the contract in joints.ts.
import type { Clip, PartDef, RigDef } from "../rig";
import type { Material } from "../palette";

type V2 = [number, number];

interface Spec {
  id: string; name: string;
  body: Material; accent: Material; beak: Material; legs: Material;
  by: number; rx: number; ry: number;
  head: V2; headR: number;
  beakLen: number; beakH: number;
  comb: boolean; plume: boolean; duck: boolean;
  legLen: number;
}

const GROUND = 29;

function build(s: Spec, variant = 0): RigDef {
  void variant;
  const hipY = s.by + s.ry * 0.4;
  const hx = 14 + s.head[0], hy = s.by + s.head[1];
  const J = (id: string, parent: string | null, side: V2, down: V2, up: V2) => ({ id, parent, rest: { down, side, up } });
  const joints = [
    J("body", null, [14, s.by], [16, s.by], [16, s.by]),
    J("head", "body", [hx, hy], [16, hy + 1.5], [16, hy + 4]),
    J("beak", "head", [hx + s.headR, hy + 0.8], [16, hy + 1.5 + s.headR * 0.9], [16, hy + 4]),
    J("tail", "body", [14 - s.rx, s.by - s.ry * 0.3], [16, s.by - s.ry * 0.6], [16, s.by - s.ry * 0.2]),
    J("wingL", "body", [13, s.by - 0.5], [16 - s.rx * 0.75 - 0.5, s.by], [16 - s.rx * 0.75 - 0.5, s.by]),
    J("wingR", "body", [15, s.by - 1.5], [16 + s.rx * 0.75 + 0.5, s.by], [16 + s.rx * 0.75 + 0.5, s.by]),
    J("legL", "body", [13, hipY], [13.5, hipY], [13.5, hipY]),
    J("footL", "legL", [13, GROUND], [13.5, GROUND], [13.5, GROUND]),
    J("legR", "body", [15.5, hipY], [18.5, hipY], [18.5, hipY]),
    J("footR", "legR", [15.5, GROUND], [18.5, GROUND], [18.5, GROUND]),
  ];
  const parts: PartDef[] = [];
  const add = (...p: PartDef[]) => parts.push(...p);

  for (const L of ["L", "R"] as const) {
    const far = L === "R";
    add(
      { id: `leg${L}`, kind: "limb", from: `leg${L}`, to: `foot${L}`, r: 1.05, slot: "legs", z: { down: 1, side: far ? 0 : 1, up: 1 }, tone: far ? -1 : 0 },
      { id: `toes${L}`, kind: "ellipse", joint: `foot${L}`, dx: 1, dy: -0.4, rx: 2, ry: 0.9, slot: "legs", z: { down: 1, side: far ? 0 : 1, up: 1 }, tone: far ? -1 : 0, flat: 0.5 },
    );
  }

  // tail: fan behind the body (side), a short tuft (down/up)
  const tl = s.plume ? 5 : s.duck ? 2.2 : 3.5;
  add(
    { id: "tail", kind: "ellipse", joint: "tail", dx: -1.2, dy: s.plume ? -3 : -1.2, rx: s.plume ? 2.4 : 2, ry: tl, slot: s.plume ? "plume" : "body", tone: s.plume ? 0 : -1, z: 1, views: ["side"] },
    ...(s.plume ? [{ id: "tail2", kind: "ellipse", joint: "tail", dx: -2.6, dy: -4.6, rx: 1.4, ry: 3, slot: "plume", tone: -1, z: 1, views: ["side"] } as PartDef] : []),
    { id: "tailB", kind: "ellipse", joint: "tail", dy: s.plume ? -1 : 0.5, rx: s.plume ? 3.2 : 2.4, ry: s.plume ? 4.5 : 2.2, slot: s.plume ? "plume" : "body", tone: s.plume ? 0 : -1, z: { down: 0, side: 1, up: 6 }, views: ["down", "up"] },
  );

  add(
    { id: "wingFarR", kind: "ellipse", joint: "wingR", dx: 0, dy: 0, rx: s.rx * 0.5, ry: s.ry * 0.55, slot: "body", tone: -1, z: 1, views: ["side"] },
    { id: "body", kind: "ellipse", joint: "body", rx: s.rx, ry: s.ry, slot: "body", z: 2, views: ["side"] },
    { id: "bodyFB", kind: "ellipse", joint: "body", rx: s.ry * 1.15, ry: s.ry * 1.05, slot: "body", z: 2, views: ["down", "up"] },
    { id: "wingNear", kind: "ellipse", joint: "wingL", dx: 0, dy: 0.5, rx: s.rx * 0.55, ry: s.ry * 0.6, slot: "body", tone: -1, z: 4, views: ["side"] },
    { id: "wingFL", kind: "ellipse", joint: "wingL", rx: 1.8, ry: s.ry * 0.75, slot: "body", tone: -1, z: 3, views: ["down", "up"] },
    { id: "wingFR", kind: "ellipse", joint: "wingR", rx: 1.8, ry: s.ry * 0.75, slot: "body", tone: -1, z: 3, views: ["down", "up"] },
    { id: "neck", kind: "limb", from: "body", to: "head", r: s.duck ? 2.1 : s.rx > 6 ? 2.3 : 2, slot: "body", z: 3, views: ["side"] },
    { id: "head", kind: "ellipse", joint: "head", rx: s.headR, ry: s.headR, slot: "body", z: { down: 5, side: 5, up: 1 } },
    { id: "beakUp", kind: "ellipse", joint: "beak", dx: -s.beakLen * 0.4, rx: s.beakLen, ry: s.beakH, slot: "beak", tone: 1, z: 6, views: ["side"] },
    { id: "beakF", kind: "ellipse", joint: "beak", dy: -0.5, rx: s.duck ? 2.2 : 1.3, ry: s.duck ? 1.2 : 1.3, slot: "beak", tone: 1, z: 6, views: ["down"] },
    { id: "eye", kind: "box", joint: "head", dx: s.headR * 0.3, dy: -s.headR * 0.35, w: 1, h: 1, slot: "ink", tone: -4, z: 9, views: ["side"] },
    { id: "eyeL", kind: "box", joint: "head", dx: -s.headR * 0.55, dy: -0.5, w: 1, h: 1, slot: "ink", tone: -4, z: 9, views: ["down"] },
    { id: "eyeR", kind: "box", joint: "head", dx: s.headR * 0.45, dy: -0.5, w: 1, h: 1, slot: "ink", tone: -4, z: 9, views: ["down"] },
  );
  if (s.comb) add(
    { id: "comb", tone: 1, kind: "ellipse", joint: "head", dx: -0.5, dy: -s.headR - 0.5, rx: s.plume ? 1.8 : 1.4, ry: s.plume ? 2.2 : 1.6, slot: "accent", z: 7, views: ["side", "up"] },
    { id: "combF", tone: 1, kind: "ellipse", joint: "head", dy: -s.headR - 0.5, rx: 1.1, ry: 2, slot: "accent", z: 7, views: ["down"] },
    { id: "wattle", tone: 1, kind: "ellipse", joint: "beak", dx: -1.8, dy: 1.8, rx: 1, ry: 1.5, slot: "accent", z: 5, views: ["side"] },
  );
  return {
    id: s.id, name: s.name, grid: 32, joints, parts,
    slots: { body: s.body, accent: s.accent, plume: "foliage", beak: s.beak, legs: s.legs, ink: "ink" },
  };
}

const SPECIES: Spec[] = [
  { id: "bird-chicken", name: "Chicken", body: "sand", accent: "cloth2", beak: "gold", legs: "gold",
    by: 22, rx: 7, ry: 5, head: [7, -6.5], headR: 3, beakLen: 2, beakH: 1.1, comb: true, plume: false, duck: false, legLen: 3 },
  { id: "bird-rooster", name: "Rooster", body: "leather", accent: "cloth2", beak: "gold", legs: "gold",
    by: 21.5, rx: 7, ry: 5, head: [7, -8], headR: 3, beakLen: 2, beakH: 1.1, comb: true, plume: true, duck: false, legLen: 3.5 },
  { id: "bird-duck", name: "Duck", body: "metal", accent: "cloth2", beak: "gold", legs: "gold",
    by: 23, rx: 7.5, ry: 4.5, head: [6.5, -5.5], headR: 3, beakLen: 2.6, beakH: 1, comb: false, plume: false, duck: true, legLen: 2 },
];

export const BIRD_RIGS: RigDef[] = SPECIES.map((s) => build(s));

/** One species by short name ("duck") with a variant 0..3. */
export function birdRig(species: string, variant = 0): RigDef {
  const spec = SPECIES.find((s) => s.id.endsWith(`-${species}`)) ?? SPECIES[0];
  return build(spec, Math.max(0, Math.min(3, Math.round(variant))));
}

export const BIRD_CLIPS: Clip[] = [
  { id: "idle", fps: 2, frames: [{}, { head: [0, 1], tail: [0, -1] }] },
  {
    id: "walk", fps: 6,
    frames: {
      side: [
        { head: [1, 0], footL: [2, 0], footR: [-2, 0] },
        { head: [0, 0], footL: [0, -1], footR: [0, 0], body: [0, 0] },
        { head: [-1, 0], footL: [-2, 0], footR: [2, 0] },
        { head: [0, 0], footR: [0, -1] },
      ],
      down: [{ footL: [0, -1], head: [0, 0] }, { head: [0, 1] }, { footR: [0, -1] }, { head: [0, 1] }],
      up: [{ footL: [0, -1] }, {}, { footR: [0, -1] }, {}],
    },
  },
  { id: "peck", fps: 4, frames: [{ head: [1, 2] }, { head: [3, 7] }, { head: [1, 2] }, { head: [3, 7] }] },
  {
    id: "flap", fps: 6,
    frames: [
      { wingL: [0, -1], wingR: [0, -1] },
      { wingL: [0, -4], wingR: [0, -4], head: [0, -1] },
      { wingL: [0, -1], wingR: [0, -1] },
      { wingL: [0, 2], wingR: [0, 2], head: [0, 1] },
    ],
  },
];

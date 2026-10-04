// Quadruped rigs (issue #6): species presets built from one skeleton, plus the
// clips that every quadruped shares. Side view is primary (animal faces right,
// "left" is its mirror); down/up are simpler front/back views.
// Joint names are the contract in joints.ts.
import type { Clip, PartDef, RigDef } from "../rig";
import type { Material } from "../palette";

type V2 = [number, number];
type Ears = "point" | "flop" | "round" | "none";
type Tail = "whip" | "plume" | "curl" | "up" | "long";

interface Spec {
  id: string;
  name: string;
  coat: Material;
  accent: Material;
  by: number; bodyRx: number; bodyRy: number;
  legR: number; hoof: boolean;
  neck: V2; head: V2; headRx: number; headRy: number;
  snoutDx: number; snoutRx: number; snoutRy: number;
  neckR: number;
  ears: Ears; horns?: boolean; mane?: boolean; tail: Tail;
}

const GROUND = 28;
const BX = 13;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Swept crescent through control points with radii that taper along three segments (stamped as discs). */
function crescent(id: string, pts: [number, number][], radii: number[], z: number, view: "side" | "front", sign = 1, joint = "head"): PartDef[] {
  const out: PartDef[] = [];
  let n = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(2, Math.ceil(len / 0.8));
    for (let t = i === 0 ? 0 : 1; t <= steps; t++) {
      const u = t / steps;
      const r = radii[i] + (radii[i + 1] - radii[i]) * u;
      out.push({ id: `${id}k${n}`, kind: "ellipse", joint, dx: (ax + (bx - ax) * u) * sign, dy: ay + (by - ay) * u, rx: r + 0.7, ry: r + 0.7, slot: "ink", tone: 0, z: z - 0.5 - n * 0.001, views: view === "side" ? ["side"] : ["down", "up"] });
      out.push({ id: `${id}${n++}`, kind: "ellipse", joint, dx: (ax + (bx - ax) * u) * sign, dy: ay + (by - ay) * u, rx: r, ry: r, slot: "accent", tone: 1, z: z - n * 0.001, views: view === "side" ? ["side"] : ["down", "up"] });
    }
  }
  return out;
}

/** Variant coat markings: [dx, dy, rx, ry, tone] on the body (side), fractions of the body radii. */
const PATCHES: Record<number, [number, number, number, number, number][]> = {
  1: [[-0.35, -0.2, 0.32, 0.5, -1], [0.3, 0.2, 0.22, 0.35, -1]],
  2: [[0.05, -0.1, 0.45, 0.55, 1], [-0.55, 0.25, 0.22, 0.3, 1]],
  3: [[0.45, 0.35, 0.5, 0.35, -1], [-0.2, -0.45, 0.28, 0.3, -1], [-0.65, 0.1, 0.2, 0.3, -1]],
};

function build(s: Spec, variant = 0): RigDef {
  const { by, bodyRx, bodyRy: ry } = s;
  const legTop = by + ry * 0.45;
  const knee = (legTop + GROUND) / 2;
  const fx = BX + bodyRx * 0.55, bx = BX - bodyRx * 0.55;
  const nx = BX + s.neck[0], ny = by + s.neck[1];
  const hx = nx + s.head[0], hy = ny + s.head[1];

  // front/back views: chest wider than rump, forelegs splayed 1px wider than hind legs and shortened
  const legLen = GROUND - legTop;
  const fs = GROUND - 0.62 * legLen;
  const chestY = fs - ry * 0.55;
  const headLift = clamp(s.neck[1] * 0.5 + s.head[1] * 0.3, -3, 2);
  const dHeadY = chestY + 1 + headLift;
  const hwD = ry * 1.25 * 0.55 + 0.4, fwD = hwD + 1; // down: hind / fore half spread
  const hwU = ry * 0.78 * 0.7 + 0.5, fwU = hwU + 1;
  const uHeadY = by - ry * 0.9 + clamp(headLift * 0.6, -1.5, 0.5) - Math.max(0, -headLift) * 0.4;
  const mid = (a: number, b: number) => (a + b) / 2;

  const J = (id: string, parent: string | null, side: V2, down: V2, up: V2) => ({ id, parent, rest: { down, side, up } });
  const joints = [
    J("body", null, [BX, by], [16, chestY], [16, by]),
    J("neck", "body", [nx, ny], [16, chestY + 0.5], [16, by - ry * 0.7]),
    J("head", "neck", [hx, hy], [16, dHeadY], [16, uHeadY]),
    J("jaw", "head", [hx + s.snoutDx, hy + s.headRy * 0.55], [16, dHeadY + s.headRx * 0.55 + s.snoutRy * 0.4], [16, uHeadY]),
    J("tail", "body", [BX - bodyRx, by - ry * 0.35], [16, chestY - ry], [16, by + ry * 0.1]),
    // legs: near side is L in the side view
    J("shoulderFL", "body", [fx, legTop], [16 - fwD, fs], [16 - fwU, legTop - ry * 0.9]),
    J("kneeFL", "shoulderFL", [fx, knee], [16 - fwD, mid(fs, GROUND)], [16 - fwU, mid(legTop - ry * 0.9, GROUND - 3.5)]),
    J("footFL", "kneeFL", [fx + 0.5, GROUND], [16 - fwD - 0.3, GROUND], [16 - fwU - 0.3, GROUND - 3.5]),
    J("shoulderFR", "body", [fx - 2.6, legTop], [16 + fwD, fs], [16 + fwU, legTop - ry * 0.9]),
    J("kneeFR", "shoulderFR", [fx - 2.6, knee], [16 + fwD, mid(fs, GROUND)], [16 + fwU, mid(legTop - ry * 0.9, GROUND - 3.5)]),
    J("footFR", "kneeFR", [fx - 2.1, GROUND], [16 + fwD + 0.3, GROUND], [16 + fwU + 0.3, GROUND - 3.5]),
    J("hipBL", "body", [bx, legTop], [16 - hwD, chestY - ry * 0.2], [16 - hwU, legTop]),
    J("kneeBL", "hipBL", [bx - 1.2, knee], [16 - hwD, mid(chestY, GROUND - 2.5)], [16 - hwU, mid(legTop, GROUND)]),
    J("footBL", "kneeBL", [bx, GROUND], [16 - hwD, GROUND - 2.5], [16 - hwU, GROUND]),
    J("hipBR", "body", [bx + 2.6, legTop], [16 + hwD, chestY - ry * 0.2], [16 + hwU, legTop]),
    J("kneeBR", "hipBR", [bx + 1.4, knee], [16 + hwD, mid(chestY, GROUND - 2.5)], [16 + hwU, mid(legTop, GROUND)]),
    J("footBR", "kneeBR", [bx + 2.6, GROUND], [16 + hwD, GROUND - 2.5], [16 + hwU, GROUND]),
  ];

  const parts: PartDef[] = [];
  const add = (...p: PartDef[]) => parts.push(...p);

  // legs: two segments + optional hoof; far side (R) sits behind in side view, hind legs behind in front view
  for (const [lg, sh, kn, ft] of [
    ["FL", "shoulderFL", "kneeFL", "footFL"], ["FR", "shoulderFR", "kneeFR", "footFR"],
    ["BL", "hipBL", "kneeBL", "footBL"], ["BR", "hipBR", "kneeBR", "footBR"],
  ] as const) {
    const far = lg.endsWith("R");
    const back = lg[0] === "B";
    const z = { down: back ? 0 : 3, side: far ? 0 : 3, up: back ? 3 : 0 };
    const tone = { tone: far ? -2 : 0 };
    add(
      { id: `thigh${lg}`, kind: "limb", from: sh, to: kn, r: s.legR * (back ? 1.1 : 1), slot: "coat", z, ...tone },
      { id: `shin${lg}`, kind: "limb", from: kn, to: ft, r: s.legR * 0.85, slot: "coat", z, ...tone },
    );
    if (s.hoof) add({ id: `hoof${lg}`, kind: "ellipse", joint: ft, dy: -0.3, rx: s.legR * 0.95, ry: 1, slot: "hoof", z, tone: far ? -1 : 0 });
  }

  // torso: elongated in side view; front view = wide chest with shoulder hump, rear view = narrower rump
  add(
    { id: "body", kind: "ellipse", joint: "body", rx: bodyRx, ry, slot: "coat", z: 2, views: ["side"] },
    { id: "belly", kind: "ellipse", joint: "body", dy: ry * 0.45, rx: bodyRx * 0.8, ry: ry * 0.5, slot: "coat", tone: -1, z: 1, views: ["side"] },
    { id: "chestD", kind: "ellipse", joint: "body", dy: ry * 0.05, rx: ry * 1.25, ry: ry * 0.85, slot: "coat", z: 2, views: ["down"] },
    { id: "humpD", kind: "ellipse", joint: "body", dy: -ry * 0.8, rx: ry * 0.95, ry: ry * 0.75, slot: "coat", tone: -1, z: 1.5, views: ["down"] },
    { id: "chestU", kind: "ellipse", joint: "body", dy: -ry * 0.7, rx: ry * 1.35, ry: ry * 0.75, slot: "coat", tone: 0, z: 1.5, views: ["up"] },
    { id: "rumpU", kind: "ellipse", joint: "body", dy: ry * 0.1, rx: ry * 0.78, ry: ry * 0.9, slot: "coat", z: 2, views: ["up"] },
  );
  for (const [px, py, prx, pry, pt] of PATCHES[variant] ?? []) add(
    { id: `patch${parts.length}`, kind: "ellipse", joint: "body", dx: px * bodyRx, dy: py * ry, rx: prx * bodyRx, ry: pry * ry, slot: "coat", tone: pt, z: 2.5, views: ["side"] },
  );
  if (variant) add(
    { id: "patchD", kind: "ellipse", joint: "body", dx: variant === 2 ? 1.2 : -1.4, dy: -ry * 0.6, rx: ry * 0.45, ry: ry * 0.4, slot: "coat", tone: variant === 2 ? 1 : -1, z: 2.6, views: ["down"] },
    { id: "patchU", kind: "ellipse", joint: "body", dx: variant === 2 ? -1.2 : 1.4, dy: ry * 0.3, rx: ry * 0.45, ry: ry * 0.5, slot: "coat", tone: variant === 2 ? 1 : -1, z: 2.6, views: ["up"] },
  );

  // tail (variant 3 gets a longer tail)
  const T = s.tail;
  const tl = (T === "plume" ? 4.5 : T === "long" ? 5 : T === "whip" ? 4 : T === "up" ? 3 : 1.4) * (variant === 3 ? 1.3 : 1);
  const up = T === "long" || T === "up" || T === "curl";
  const tailSlot = T === "plume" ? "mane" : "coat";
  add(
    { id: "tail", kind: "ellipse", joint: "tail", dx: -1.2, dy: up ? -tl * 0.6 : tl * 0.7, rx: T === "plume" ? 1.8 : T === "curl" ? 1.4 : 1.1, ry: tl, slot: tailSlot, tone: T === "whip" ? -2 : 0, z: 1, views: ["side"] },
    { id: "tailB", kind: "ellipse", joint: "tail", dy: up ? -tl * 0.5 : tl * 0.7, rx: T === "plume" ? 2 : 1.3, ry: tl, slot: tailSlot, tone: T === "plume" ? 0 : -2, z: 5, views: ["up"] },
  );
  if (T === "whip") add(
    { id: "tuft", kind: "ellipse", joint: "tail", dx: -1.6, dy: tl * 1.45, rx: 1.4, ry: 1.5, slot: "mane", z: 1.1, views: ["side"] },
    { id: "tuftB", kind: "ellipse", joint: "tail", dy: tl * 1.6, rx: 1.4, ry: 1.5, slot: "mane", z: 5.1, views: ["up"] },
  );

  // neck + head
  const hr = s.headRy;
  add(
    { id: "neck", kind: "limb", from: "body", to: "head", r: s.neckR, slot: "coat", tone: -1, z: { down: 3, side: 3, up: 1 }, views: ["side"] },
    { id: "neckD", kind: "ellipse", joint: "neck", dy: -0.5, rx: s.neckR * 1.15, ry: s.neckR * 1.2, slot: "coat", tone: -1, z: 3, views: ["down"] },
    { id: "neckU", kind: "ellipse", joint: "neck", rx: s.neckR * 1.05, ry: s.neckR * 0.9, slot: "coat", tone: -1, z: 0.8, views: ["up"] },
    { id: "head", kind: "ellipse", joint: "head", rx: s.headRx, ry: s.headRy, slot: "coat", z: { down: 4, side: 4, up: 1 }, views: ["side", "up"] },
    { id: "headFront", kind: "ellipse", joint: "head", rx: hr + 0.6, ry: s.headRx * 0.95, slot: "coat", z: 4, views: ["down"] },
    { id: "snout", kind: "ellipse", joint: "jaw", rx: s.snoutRx, ry: s.snoutRy, slot: "muzzle", tone: 1, z: 5, views: ["side"] },
    { id: "snoutF", kind: "ellipse", joint: "jaw", dy: -0.5, rx: s.snoutRy + 0.8, ry: s.snoutRy * 0.85, slot: "muzzle", tone: 1, z: 5, views: ["down"] },
    // throat shadow: separates head from neck
    { id: "napeShade", kind: "ellipse", joint: "head", dx: -s.headRx * 1.0, dy: 0, rx: 0.9, ry: s.headRy * 0.75, slot: "coat", tone: -2, z: 3.9, views: ["side"] },
    { id: "jawShade", kind: "ellipse", joint: "head", dx: -s.headRx * 0.3, dy: s.headRy * 0.82, rx: s.headRx * 0.6, ry: 0.75, slot: "coat", tone: -2, z: 5.5, views: ["side"] },
  );
  if (s.mane) add({ id: "mane", kind: "ellipse", joint: "neck", dx: -1.5, dy: -0.5, rx: 1.6, ry: 4, slot: "mane", z: 2, views: ["side"] },
    { id: "maneUp", kind: "ellipse", joint: "neck", dy: -1, rx: 1.6, ry: 3.5, slot: "mane", z: 1.2, views: ["up"] },
    { id: "maneD", kind: "ellipse", joint: "head", dy: -s.headRx * 0.9, rx: 1.2, ry: 1.6, slot: "mane", z: 4.6, views: ["down"] });
  // ears
  const e = s.ears;
  if (e !== "none") {
    const er = e === "flop" ? [1.3, 2.6] : e === "point" ? [1.2, 2.4] : [1.6, 1.6];
    const ey = e === "flop" ? 0 : -s.headRy;
    add(
      { id: "earNear", kind: "ellipse", joint: "head", dx: -s.headRx * 0.6, dy: ey + (e === "flop" ? 1 : 0), rx: er[0], ry: er[1], slot: "coat", tone: -1, z: 6, views: ["side"] },
      { id: "earL", kind: "ellipse", joint: "head", dx: -(hr * 0.9), dy: e === "flop" ? 0.5 : -s.headRx * 0.7, rx: er[0], ry: er[1], slot: "coat", tone: -1, z: 6, views: ["down", "up"] },
      { id: "earR", kind: "ellipse", joint: "head", dx: hr * 0.9, dy: e === "flop" ? 0.5 : -s.headRx * 0.7, rx: er[0], ry: er[1], slot: "coat", tone: -1, z: 6, views: ["down", "up"] },
    );
  }
  if (s.horns) {
    // swept-back crescents: three tapering segments from the brow, back, and up at the tip
    const L = [1, 1.3, 0.8, 1.15][variant];
    const side: [number, number][] = [[-0.5, -3.4], [-3 * L, -5.2 * L], [-6.2 * L, -5 * L], [-8.4 * L, -7.4 * L]];
    add(...crescent("horn", side, [1.7, 1.35, 1.0, 0.6], 7, "side"));
    const front: [number, number][] = [[hr * 0.7, -1.6], [hr * 0.7 + 2.6 * L, -2.6], [hr * 0.7 + 4.4 * L, -1.4 * L - 2.4], [hr * 0.7 + 5.4 * L, -5 * L]];
    for (const sgn of [-1, 1]) add(...crescent(`hornF${sgn}_`, front, [1.6, 1.3, 1.0, 0.6], 7, "front", sgn));
  }
  // eyes: a single ink pixel (box w=1 stays 1px at any kit size)
  add(
    { id: "eye", kind: "box", joint: "head", dx: s.headRx * 0.1, dy: -s.headRy * 0.25, w: 1, h: 1, slot: "ink", tone: -4, z: 9, views: ["side"] },
    { id: "eyeL", kind: "box", joint: "head", dx: -hr * 0.5, dy: -1, w: 1, h: 1, slot: "ink", tone: -4, z: 9, views: ["down"] },
    { id: "eyeR", kind: "box", joint: "head", dx: hr * 0.5, dy: -1, w: 1, h: 1, slot: "ink", tone: -4, z: 9, views: ["down"] },
    { id: "nose", kind: "box", joint: "jaw", dx: s.snoutRx - 1, dy: -s.snoutRy * 0.5, w: 1, h: 1, slot: "ink", tone: -4, z: 9, views: ["side"] },
    { id: "noseL", kind: "box", joint: "jaw", dx: -1.5, dy: -0.5, w: 1, h: 1, slot: "ink", tone: -4, z: 9, views: ["down"] },
    { id: "noseR", kind: "box", joint: "jaw", dx: 0.8, dy: -0.5, w: 1, h: 1, slot: "ink", tone: -4, z: 9, views: ["down"] },
  );

  return {
    id: s.id, name: s.name, grid: 32, joints, parts,
    slots: { coat: s.coat, accent: s.accent, hoof: "ink", mane: "hair", muzzle: s.coat, ink: "ink" },
  };
}

const SPECIES: Spec[] = [
  { id: "quadruped-water-buffalo", name: "Water buffalo", coat: "stone", accent: "sand",
    by: 16, bodyRx: 9.2, bodyRy: 5, legR: 2.1, hoof: true,
    neck: [8, 1.5], head: [5, 2.2], headRx: 4.6, headRy: 3.8, snoutDx: 2.6, snoutRx: 2.8, snoutRy: 2.8, neckR: 3.1,
    ears: "flop", horns: true, tail: "whip" },
  { id: "quadruped-dog", name: "Dog", coat: "sand", accent: "leather",
    by: 20, bodyRx: 6.8, bodyRy: 3.8, legR: 1.5, hoof: false,
    neck: [5, -2.5], head: [3.5, -1], headRx: 3.4, headRy: 3.1, snoutDx: 2.4, snoutRx: 2.4, snoutRy: 1.7, neckR: 2.2,
    ears: "flop", tail: "up" },
  { id: "quadruped-cat", name: "Cat", coat: "gold", accent: "sand",
    by: 20.5, bodyRx: 6, bodyRy: 3.4, legR: 1.3, hoof: false,
    neck: [4.5, -2.2], head: [3, -0.8], headRx: 3.2, headRy: 2.9, snoutDx: 2, snoutRx: 1.6, snoutRy: 1.3, neckR: 2,
    ears: "point", tail: "long" },
  { id: "quadruped-horse", name: "Horse", coat: "leather", accent: "sand",
    by: 13.5, bodyRx: 8.5, bodyRy: 4.2, legR: 1.35, hoof: true,
    neck: [6.5, -6.5], head: [3.8, 2.4], headRx: 4.2, headRy: 2.7, snoutDx: 3, snoutRx: 2.8, snoutRy: 2, neckR: 2.8,
    ears: "point", mane: true, tail: "plume" },
  { id: "quadruped-pig", name: "Pig", coat: "skin", accent: "sand",
    by: 19.5, bodyRx: 7.8, bodyRy: 5, legR: 1.7, hoof: true,
    neck: [6, -1.5], head: [3.2, 0.8], headRx: 3.7, headRy: 3.4, snoutDx: 2.6, snoutRx: 2, snoutRy: 2.2, neckR: 3,
    ears: "flop", tail: "curl" },
];

export const QUADRUPED_RIGS: RigDef[] = SPECIES.map((s) => build(s));

/** One species by short name ("horse") with a variant 0..3 (coat patches, horn length, tail). */
export function quadrupedRig(species: string, variant = 0): RigDef {
  const spec = SPECIES.find((s) => s.id.endsWith(`-${species}`)) ?? SPECIES[0];
  return build(spec, Math.max(0, Math.min(3, Math.round(variant))));
}

const S = (n: number) => n;
/** Diagonal-pair gait: FL+BR swing together, then FR+BL. */
const stepA = (sw: number, lift: number) => ({
  footFL: [sw, lift] as V2, kneeFL: [sw / 2, 0] as V2, footBR: [sw, lift] as V2, kneeBR: [sw / 2, 0] as V2,
  footFR: [-sw, 0] as V2, kneeFR: [-sw / 2, 0] as V2, footBL: [-sw, 0] as V2, kneeBL: [-sw / 2, 0] as V2,
});
const stepB = (sw: number, lift: number) => ({
  footFR: [sw, lift] as V2, kneeFR: [sw / 2, 0] as V2, footBL: [sw, lift] as V2, kneeBL: [sw / 2, 0] as V2,
  footFL: [-sw, 0] as V2, kneeFL: [-sw / 2, 0] as V2, footBR: [-sw, 0] as V2, kneeBR: [-sw / 2, 0] as V2,
});

export const QUADRUPED_CLIPS: Clip[] = [
  { id: "idle", fps: 2, frames: [{}, { neck: [0, 1], tail: [S(0), -1] }] },
  {
    id: "walk", fps: 6,
    frames: {
      side: [
        { ...stepA(2.5, 0), neck: [0, 0], tail: [0, 0] },
        { ...stepA(0, -1.2), tail: [0, 1], neck: [0, 1] },
        { ...stepB(2.5, 0), tail: [0, 0] },
        { ...stepB(0, -1.2), tail: [0, 1], neck: [0, 1] },
      ],
      down: [
        { footFL: [0, -1] }, {}, { footFR: [0, -1] }, {},
      ],
      up: [
        { footBL: [0, -1] }, {}, { footBR: [0, -1] }, {},
      ],
    },
  },
  {
    id: "graze", fps: 3,
    frames: [{ neck: [1, 4] }, { neck: [2, 6] }, { neck: [2, 6], jaw: [0, 1] }, { neck: [2, 6], jaw: [0, 0] }],
  },
];

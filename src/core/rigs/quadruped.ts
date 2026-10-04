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

function build(s: Spec): RigDef {
  const { by, bodyRx, bodyRy } = s;
  const legTop = by + bodyRy * 0.45;
  const knee = (legTop + GROUND) / 2;
  const fx = BX + bodyRx * 0.55, bx = BX - bodyRx * 0.55;
  const nx = BX + s.neck[0], ny = by + s.neck[1];
  const hx = nx + s.head[0], hy = ny + s.head[1];
  const hr = s.headRy; // head half-width seen from the front

  const J = (id: string, parent: string | null, side: V2, down: V2, up: V2) => ({ id, parent, rest: { down, side, up } });
  const joints = [
    J("body", null, [BX, by], [16, 14], [16, 17]),
    J("neck", "body", [nx, ny], [16, 18.5], [16, 13]),
    J("head", "neck", [hx, hy], [16, 20], [16, 10]),
    J("jaw", "head", [hx + s.snoutDx, hy + s.headRy * 0.55], [16, 20 + s.headRx * 0.6 + s.snoutRy * 0.5], [16, 10]),
    J("tail", "body", [BX - bodyRx, by - bodyRy * 0.35], [16, 9], [16, 21]),
    // legs: near side is L in the side view
    J("shoulderFL", "body", [fx, legTop], [16 - hr * 0.75 - 1, 19], [16 - hr * 0.75 - 1, 15]),
    J("kneeFL", "shoulderFL", [fx, knee], [16 - hr * 0.75 - 1, 23], [16 - hr * 0.75 - 1, 17]),
    J("footFL", "kneeFL", [fx + 0.5, GROUND], [16 - hr * 0.75 - 1, 27], [16 - hr * 0.75 - 1, 19]),
    J("shoulderFR", "body", [fx - 2.6, legTop], [16 + hr * 0.75 + 1, 19], [16 + hr * 0.75 + 1, 15]),
    J("kneeFR", "shoulderFR", [fx - 2.6, knee], [16 + hr * 0.75 + 1, 23], [16 + hr * 0.75 + 1, 17]),
    J("footFR", "kneeFR", [fx - 2.1, GROUND], [16 + hr * 0.75 + 1, 27], [16 + hr * 0.75 + 1, 19]),
    J("hipBL", "body", [bx, legTop], [16 - hr * 0.75 - 1, 12], [16 - hr * 0.75 - 1, 21]),
    J("kneeBL", "hipBL", [bx - 1.2, knee], [16 - hr * 0.75 - 1, 14], [16 - hr * 0.75 - 1, 24]),
    J("footBL", "kneeBL", [bx, GROUND], [16 - hr * 0.75 - 1, 16], [16 - hr * 0.75 - 1, 27]),
    J("hipBR", "body", [bx + 2.6, legTop], [16 + hr * 0.75 + 1, 12], [16 + hr * 0.75 + 1, 21]),
    J("kneeBR", "hipBR", [bx + 1.4, knee], [16 + hr * 0.75 + 1, 14], [16 + hr * 0.75 + 1, 24]),
    J("footBR", "kneeBR", [bx + 2.6, GROUND], [16 + hr * 0.75 + 1, 16], [16 + hr * 0.75 + 1, 27]),
  ];

  const parts: PartDef[] = [];
  const add = (...p: PartDef[]) => parts.push(...p);

  // legs: two segments + optional hoof; far side (R) sits behind in side view
  for (const [leg, sh, kn, ft] of [
    ["FL", "shoulderFL", "kneeFL", "footFL"], ["FR", "shoulderFR", "kneeFR", "footFR"],
    ["BL", "hipBL", "kneeBL", "footBL"], ["BR", "hipBR", "kneeBR", "footBR"],
  ] as const) {
    const far = leg.endsWith("R");
    const back = leg[0] === "B";
    const z = { down: back ? 0 : 3, side: far ? 0 : 3, up: back ? 3 : 0 };
    const tone = { tone: far ? -1 : 0 };
    add(
      { id: `thigh${leg}`, kind: "limb", from: sh, to: kn, r: s.legR * (back ? 1.1 : 1), slot: "coat", z, ...tone },
      { id: `shin${leg}`, kind: "limb", from: kn, to: ft, r: s.legR * 0.85, slot: "coat", z, ...tone },
    );
    if (s.hoof) add({ id: `hoof${leg}`, kind: "ellipse", joint: ft, dy: -0.3, rx: s.legR * 0.95, ry: 1, slot: "hoof", z, tone: far ? -1 : 0 });
  }

  // body: elongated in side view, foreshortened from the front/back
  add(
    { id: "body", kind: "ellipse", joint: "body", rx: bodyRx, ry: bodyRy, slot: "coat", z: 2, views: ["side"] },
    { id: "bodyFB", kind: "ellipse", joint: "body", dy: 0, rx: bodyRy * 1.05, ry: Math.min(bodyRx * 0.5, 6), slot: "coat", z: 2, views: ["down", "up"] },
    { id: "belly", kind: "ellipse", joint: "body", dy: bodyRy * 0.45, rx: bodyRx * 0.8, ry: bodyRy * 0.5, slot: "coat", tone: -1, z: 1, views: ["side"] },
  );

  // tail
  const T = s.tail;
  const tl = T === "plume" ? 4.5 : T === "long" ? 5 : T === "whip" ? 4 : T === "up" ? 3 : 1.4;
  const up = T === "long" || T === "up" || T === "curl";
  add(
    { id: "tail", kind: "ellipse", joint: "tail", dx: -1.2, dy: up ? -tl * 0.6 : tl * 0.7, rx: T === "plume" ? 1.8 : T === "curl" ? 1.4 : 1.1, ry: tl, slot: T === "plume" ? "mane" : "coat", tone: T === "whip" ? -1 : 0, z: 1, views: ["side"] },
    { id: "tailB", kind: "ellipse", joint: "tail", dy: tl * 0.7, rx: T === "plume" ? 2 : 1.2, ry: tl, slot: T === "plume" ? "mane" : "coat", tone: T === "whip" ? -1 : 0, z: 5, views: ["up"] },
  );

  // neck + head
  add(
    { id: "neck", kind: "limb", from: "body", to: "head", r: s.neckR, slot: "coat", z: { down: 3, side: 3, up: 1 }, views: ["side", "up"] },
    { id: "head", kind: "ellipse", joint: "head", rx: s.headRx, ry: s.headRy, slot: "coat", z: { down: 4, side: 4, up: 1 } },
    { id: "headFront", kind: "ellipse", joint: "head", rx: hr + 0.6, ry: s.headRx * 0.95, slot: "coat", z: 4, views: ["down"] },
    { id: "snout", kind: "ellipse", joint: "jaw", rx: s.snoutRx, ry: s.snoutRy, slot: "muzzle", tone: 1, z: 5, views: ["side"] },
    { id: "snoutF", kind: "ellipse", joint: "jaw", dy: -0.5, rx: s.snoutRy + 0.8, ry: s.snoutRy * 0.85, slot: "muzzle", tone: 1, z: 5, views: ["down"] },
  );
  if (s.mane) add({ id: "mane", kind: "ellipse", joint: "neck", dx: -1.5, dy: -0.5, rx: 1.6, ry: 4, slot: "mane", z: 2, views: ["side"] },
    { id: "maneUp", kind: "ellipse", joint: "neck", rx: 1.6, ry: 3.5, slot: "mane", z: 2, views: ["up"] });
  // ears
  const e = s.ears;
  if (e !== "none") {
    const er = e === "flop" ? [1.3, 2.6] : e === "point" ? [1.2, 2.4] : [1.6, 1.6];
    const ey = e === "flop" ? 0 : -s.headRy;
    add(
      { id: "earNear", kind: "ellipse", joint: "head", dx: -s.headRx * 0.45, dy: ey + (e === "flop" ? 1 : 0), rx: er[0], ry: er[1], slot: "coat", tone: -1, z: 6, views: ["side"] },
      { id: "earL", kind: "ellipse", joint: "head", dx: -(hr * 0.75), dy: e === "flop" ? 0.5 : -s.headRx * 0.7, rx: er[0], ry: er[1], slot: "coat", tone: -1, z: 6, views: ["down", "up"] },
      { id: "earR", kind: "ellipse", joint: "head", dx: hr * 0.75, dy: e === "flop" ? 0.5 : -s.headRx * 0.7, rx: er[0], ry: er[1], slot: "coat", tone: -1, z: 6, views: ["down", "up"] },
    );
  }
  if (s.horns) {
    // swept-back crescent: base on the brow, arcs back, tip curls down
    const arc: [number, number, number][] = [[1, -2.6, 1.8], [-0.5, -4.8, 1.7], [-2.8, -6.2, 1.6], [-5.4, -6.4, 1.4], [-7.4, -5, 1.2]];
    arc.forEach(([dx, dy, r], i) => add({ id: `horn${i}`, kind: "ellipse", joint: "head", dx, dy, rx: r, ry: r, slot: "accent", z: 7 - i * 0.1, views: ["side"] }));
    const out: [number, number, number][] = [[2.2, -0.8, 1.5], [3.6, -1.6, 1.4], [4.6, -3.2, 1.2], [4.8, -4.6, 1.0]];
    for (const sgn of [-1, 1]) out.forEach(([dx, dy, r], i) => add(
      { id: `hornF${sgn}${i}`, kind: "ellipse", joint: "head", dx: sgn * (hr * 0.55 + dx), dy, rx: r, ry: r, slot: "accent", z: 7, views: ["down", "up"] }));
  }
  // eyes: a single ink pixel (box w=1 stays 1px at any kit size)
  add(
    { id: "eye", kind: "box", joint: "head", dx: s.headRx * 0.35, dy: -s.headRy * 0.3, w: 1, h: 1, slot: "ink", tone: -4, z: 9, views: ["side"] },
    { id: "eyeL", kind: "box", joint: "head", dx: -hr * 0.5, dy: -1, w: 1, h: 1, slot: "ink", tone: -4, z: 9, views: ["down"] },
    { id: "eyeR", kind: "box", joint: "head", dx: hr * 0.5, dy: -1, w: 1, h: 1, slot: "ink", tone: -4, z: 9, views: ["down"] },
    { id: "nose", kind: "box", joint: "jaw", dx: s.snoutRx - 1, dy: -s.snoutRy * 0.5, w: 1, h: 1, slot: "ink", tone: -4, z: 9, views: ["side"] },
  );

  return {
    id: s.id, name: s.name, grid: 32, joints, parts,
    slots: { coat: s.coat, accent: s.accent, hoof: "ink", mane: "hair", muzzle: s.coat, ink: "ink" },
  };
}

const SPECIES: Spec[] = [
  { id: "quadruped-water-buffalo", name: "Water buffalo", coat: "stone", accent: "sand",
    by: 16, bodyRx: 9.2, bodyRy: 5, legR: 2.1, hoof: true,
    neck: [7.5, -0.5], head: [5, 3.2], headRx: 4.4, headRy: 3.5, snoutDx: 2.8, snoutRx: 2.8, snoutRy: 2.6, neckR: 3.1,
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
    by: 14.5, bodyRx: 8.5, bodyRy: 4.4, legR: 1.5, hoof: true,
    neck: [6, -5], head: [3.8, 1.8], headRx: 4.2, headRy: 2.7, snoutDx: 3, snoutRx: 2.8, snoutRy: 2, neckR: 2.8,
    ears: "point", mane: true, tail: "plume" },
  { id: "quadruped-pig", name: "Pig", coat: "skin", accent: "sand",
    by: 19.5, bodyRx: 7.8, bodyRy: 5, legR: 1.7, hoof: true,
    neck: [6, -1.5], head: [3.2, 0.8], headRx: 3.7, headRy: 3.4, snoutDx: 2.6, snoutRx: 2, snoutRy: 2.2, neckR: 3,
    ears: "flop", tail: "curl" },
];

export const QUADRUPED_RIGS: RigDef[] = SPECIES.map(build);

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

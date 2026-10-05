// Monster pack (issue #44): top-down creatures with idle / walk / attack / hurt / die clips.
//   monster   family: mushroom (red, brown, poison, king), slime (green, blue, fire, metal), plant, bat
//   beast     family: wolf (the quadruped skeleton, re-dressed)
//   undead    family: skeleton (the humanoid skeleton, drawn as bone)
// Blobby monsters share one small joint contract (MONSTER_JOINTS) so one clip set animates them all;
// variants are only different slots (materials), and the king is the same rig drawn 1.2x.
//
// Two tricks keep hit flash and death in plain rig data (no renderer changes):
//  - Flash: every volume has a white twin pinned to a hidden `f_<joint>` joint parked HIDE units above
//    the canvas. A pose that moves `f_*` down by HIDE lays the twins over the body, so the sprite
//    flashes light while it still follows its own knock-back pose.
//  - Die: the body is parked off canvas the same way (`hide`) while three puff joints (`puffA/B/C`,
//    parentless so they stay put) swing in: a cloud, a ring of puffs, then scattered sparkles.
import type { Clip, Joint, PartDef, Pose, RigDef } from "../rig";
import type { Material } from "../palette";
import { HUMANOID_CLIPS } from "./clips";
import { humanoidRig } from "./humanoid";
import { QUADRUPED_CLIPS, quadrupedRig } from "./quadruped";

type V2 = [number, number];
type Slots = Record<string, Material>;

/** Parked-off-canvas distance (grid units) for hidden flash twins, puffs and a dead body. */
export const HIDE = 100;

export const MONSTER_JOINTS = ["base", "body", "head", "jaw", "wingL", "wingR", "footL", "footR"] as const;
export const FX_JOINTS = ["puffA", "puffB", "puffC"] as const;
export const flashJoint = (id: string) => `f_${id}`;

const shift = (r: Joint["rest"], dy: number): Joint["rest"] => {
  if (Array.isArray(r)) return [r[0], r[1] + dy];
  return Object.fromEntries(Object.entries(r).map(([v, p]) => [v, [p[0], p[1] + dy]])) as Joint["rest"];
};
const zMax = (z: PartDef["z"]) => (typeof z === "number" ? z : Math.max(...(Object.values(z) as number[])));

/** Add the hit-flash twins and the three death puffs. `fx` is the material of the sparkles; `centre` where the puff is. */
function withFx(rig: RigDef, centre: V2, skip: RegExp, fx: Material): RigDef {
  const joints: Joint[] = [
    ...rig.joints,
    ...rig.joints.map((j) => ({ id: flashJoint(j.id), parent: j.id, rest: shift(j.rest, -HIDE) })),
    ...FX_JOINTS.map((id) => ({ id, parent: null, rest: [centre[0], centre[1] - HIDE] as V2 })),
  ];
  const twins: PartDef[] = [];
  for (const p of rig.parts) {
    if (skip.test(p.id) || p.slot === "ink") continue;
    const z = 50 + zMax(p.z);
    if (p.kind === "limb") twins.push({ ...p, id: `fl-${p.id}`, from: flashJoint(p.from), to: flashJoint(p.to), slot: "flash", tone: 2, z });
    else if (p.kind === "ellipse" || p.kind === "box") twins.push({ ...p, id: `fl-${p.id}`, joint: flashJoint(p.joint), slot: "flash", tone: 2, z });
  }
  const [cx, cy] = [0, 0];
  const E = (id: string, joint: string, dx: number, dy: number, rx: number, ry: number, slot: string, tone = 0): PartDef =>
    ({ id, kind: "ellipse", joint, dx: cx + dx, dy: cy + dy, rx, ry, slot, tone, z: 80 });
  const dot = (id: string, dx: number, dy: number, slot = "fx", tone = 1): PartDef => ({ id, kind: "box", joint: "puffC", dx, dy, w: 1.5, h: 1.5, slot, tone, z: 80 });
  const puffs: PartDef[] = [
    // A: one fat cloud where the body was
    E("puff-a1", "puffA", 0, 0, 6, 4.5, "flash", 1), E("puff-a2", "puffA", -4.5, 1.5, 3.4, 2.8, "flash", 0), E("puff-a3", "puffA", 4.5, 1.5, 3.4, 2.8, "flash", 0),
    // B: the cloud breaks into a ring of small puffs
    E("puff-b1", "puffB", -8, 0, 2.4, 2, "flash", 1), E("puff-b2", "puffB", 8, 0, 2.4, 2, "flash", 0), E("puff-b3", "puffB", 0, -6, 2.4, 2, "flash", 1),
    E("puff-b4", "puffB", -4.8, 4, 2, 1.6, "flash", 0), E("puff-b5", "puffB", 4.8, 4, 2, 1.6, "flash", 0), E("puff-b6", "puffB", -4.6, -4.4, 1.8, 1.5, "fx", 0), E("puff-b7", "puffB", 4.6, -4.4, 1.8, 1.5, "fx", 0),
    // C: sparkles drifting up and out
    dot("puff-c1", -9, -6), dot("puff-c2", 8, -7), dot("puff-c3", -4, -10), dot("puff-c4", 5, -3, "flash", 2), dot("puff-c5", -7, 2, "flash", 2), dot("puff-c6", 1, -7, "flash", 2),
  ];
  return { ...rig, joints, parts: [...rig.parts, ...twins, ...puffs], slots: { ...rig.slots, flash: "ui", fx } };
}

// ---------------------------------------------------------------- blobby monsters

interface BlobSpec {
  id: string;
  name: string;
  scale?: number;
  slots: Slots;
}

/** Authoring helpers on a 32 grid, ground at y 28, optionally scaled about the feet (king mushroom). */
function maker(s: number) {
  const X = (x: number) => 16 + (x - 16) * s;
  const Y = (y: number) => 28 - (28 - y) * s;
  /** Joint with one rest for all views, or a separate side-view rest. */
  const J = (id: string, parent: string | null, p: V2, side: V2 = p, up: V2 = p): Joint => ({
    id, parent, rest: { down: [X(p[0]), Y(p[1])], side: [X(side[0]), Y(side[1])], up: [X(up[0]), Y(up[1])] },
  });
  const E = (id: string, joint: string, dx: number, dy: number, rx: number, ry: number, slot: string, z: PartDef["z"], o: Partial<PartDef> = {}): PartDef =>
    ({ id, kind: "ellipse", joint, dx: dx * s, dy: dy * s, rx: rx * s, ry: ry * s, slot, z, ...o }) as PartDef;
  const B = (id: string, joint: string, dx: number, dy: number, w: number, h: number, slot: string, z: PartDef["z"], o: Partial<PartDef> = {}): PartDef =>
    ({ id, kind: "box", joint, dx: dx * s, dy: dy * s, w, h, slot, z, ...o }) as PartDef;
  const L = (id: string, from: string, to: string, r: number, slot: string, z: PartDef["z"], o: Partial<PartDef> = {}): PartDef =>
    ({ id, kind: "limb", from, to, r: r * s, slot, z, ...o }) as PartDef;
  /** Cute eyes: ink with a light glint (front pair, 3/4 pair, profile single). `spread` is the half gap. */
  const eyes = (joint: string, dy: number, spread: number, z: number, o: { w?: number; h?: number; slot?: string; glint?: boolean } = {}): PartDef[] => {
    const w = o.w ?? 2, h = o.h ?? 3, slot = o.slot ?? "ink", tone = slot === "ink" ? -4 : 1;
    const eye = (id: string, dx: number, views: PartDef["views"], ew = w): PartDef[] => [
      B(id, joint, dx, dy, ew, h, slot, z, { views, tone }),
      ...(o.glint === false ? [] : [B(`${id}-glint`, joint, dx, dy, 1, 1, "ui", z + 0.1, { views, tone: 3 })]),
    ];
    return [
      ...eye("eyeL", -spread - w, ["down"]), ...eye("eyeR", spread, ["down"]),
      ...eye("eyeDa", -0.5 * spread - w * 0.5 + 1.2, ["down-side"]), ...eye("eyeDb", spread + 2.2, ["down-side"], w - 0.5),
      ...eye("eyeS", spread * 0.5 + 1.2, ["side"]),
    ];
  };
  return { X, Y, J, E, B, L, eyes };
}

type Maker = ReturnType<typeof maker>;

function mushroom(m: Maker, king: boolean): { joints: Joint[]; parts: PartDef[] } {
  const { J, E, B, eyes } = m;
  const joints = [
    J("base", null, [16, 28]),
    J("body", "base", [16, 23], [15.5, 23]),
    J("head", "body", [16, 14.5], [16, 14.5]),
    J("jaw", "body", [16, 26], [18, 26]),
    J("wingL", "body", [10.8, 23.5], [14.5, 24.5], [10.8, 23.5]),
    J("wingR", "body", [21.2, 23.5], [16.5, 24.5], [21.2, 23.5]),
    J("footL", "base", [12.8, 27.4], [13.8, 27.4]),
    J("footR", "base", [19.2, 27.4], [17.6, 27.4]),
  ];
  const parts: PartDef[] = [
    E("footL", "footL", 0, 0, 2.7, 1.6, "stalk", { down: 1, side: 1.2, up: 1 }, { tone: -1 }),
    E("footR", "footR", 0, 0, 2.7, 1.6, "stalk", { down: 1, side: 0.2, up: 1 }, { tone: -1 }),
    E("stalk", "body", 0, 0, 4.7, 5.2, "stalk", 2, { views: ["down", "up", "down-side", "up-side"] }),
    E("stalkS", "body", 0, 0, 4.3, 5.2, "stalk", 2, { views: ["side"] }),
    E("armR", "wingR", 0, 0, 1.7, 2.3, "stalk", { down: 3, side: 1, up: 3 }, { tone: -1 }),
    E("armL", "wingL", 0, 0, 1.7, 2.3, "stalk", 3, { tone: -1 }),
    // cap, its gill rim, spots
    E("gills", "head", 0, 3.7, 8.4, 2.4, "stalk", 3.6, { tone: -2, views: ["down", "side"] }),
    E("cap", "head", 0, 0, 10, 6.4, "cap", 4),
    E("spotA", "head", -5.2, -1.2, 1.9, 1.4, "spots", 5, { flat: 0.8, views: ["down", "up"] }),
    E("spotB", "head", 1.2, -3.8, 2.2, 1.6, "spots", 5, { flat: 0.8, views: ["down", "up"] }),
    E("spotC", "head", 5.6, 0.4, 1.5, 1.2, "spots", 5, { flat: 0.8, views: ["down"] }),
    E("spotD", "head", -2.5, 2.2, 1.4, 1, "spots", 5, { flat: 0.8, views: ["up"] }),
    E("spotE", "head", 4.4, 2, 1.7, 1.2, "spots", 5, { flat: 0.8, views: ["up"] }),
    E("spotSa", "head", -3.8, -2.6, 2.2, 1.5, "spots", 5, { flat: 0.8, views: ["side"] }),
    E("spotSb", "head", 2.4, -4, 1.9, 1.3, "spots", 5, { flat: 0.8, views: ["side"] }),
    E("spotSc", "head", 6, -0.4, 1.3, 1.1, "spots", 5, { flat: 0.8, views: ["side"] }),
    // face on the stalk, under the cap
    ...eyes("body", -0.8, 1.2, 6),
    E("mouth", "jaw", -0.2, 0, 1.2, 0.8, "ink", 6, { tone: -3, views: ["down"] }),
    E("mouthD", "jaw", 0.8, 0, 1.2, 0.8, "ink", 6, { tone: -3, views: ["down-side", "side"] }),
  ];
  if (king)
    parts.push(
      B("crown-band", "head", -4, -8.2, 8, 2, "crown", 6, { tone: 0 }),
      B("crown-l", "head", -4, -10.4, 2, 2.4, "crown", 6, { tone: 1 }),
      B("crown-m", "head", -1, -11.4, 2, 3.2, "crown", 6, { tone: 1 }),
      B("crown-r", "head", 2, -10.4, 2, 2.4, "crown", 6, { tone: 1 }),
    );
  return { joints, parts };
}

function slime(m: Maker): { joints: Joint[]; parts: PartDef[] } {
  const { J, E, eyes } = m;
  const joints = [
    J("base", null, [16, 28]),
    J("body", "base", [16, 22.8], [15.5, 22.8]),
    J("head", "body", [16, 18], [16.5, 18]),
    J("jaw", "body", [16, 23.8], [19.5, 23.8]),
    J("wingL", "body", [8.4, 24.2], [9.5, 24.8], [8.4, 24.2]),
    J("wingR", "body", [23.6, 24.2], [21.5, 24.8], [23.6, 24.2]),
    J("footL", "base", [11, 27.2], [11.5, 27.2]),
    J("footR", "base", [21, 27.2], [20.5, 27.2]),
  ];
  const parts: PartDef[] = [
    E("puddle", "base", 0, -1.2, 10, 2.2, "body", 0, { tone: -2, flat: 0.3 }),
    E("footL", "footL", 0, 0, 2.8, 1.7, "body", 1, { tone: -1 }),
    E("footR", "footR", 0, 0, 2.8, 1.7, "body", 1, { tone: -1 }),
    E("sideL", "wingL", 0, 0, 3.2, 2.6, "body", 1.5, { tone: -1 }),
    E("sideR", "wingR", 0, 0, 3.2, 2.6, "body", 1.5, { tone: -1 }),
    E("body", "body", 0, 0, 9.4, 6, "body", 2),
    E("head", "head", 0, 0, 6.6, 5, "body", 3),
    E("tuft", "head", 0, -5.4, 1.6, 2.6, "tuft", 2.9, { views: ["down", "side", "up"] }),
    // gloss: a soft highlight and a glint
    E("shine", "head", -2.8, -1.8, 2, 1.3, "shine", 6, { flat: 1, tone: 1 }),
    E("shine2", "head", -0.6, -3.4, 0.8, 0.6, "shine", 6, { flat: 1, tone: 2 }),
    ...eyes("head", 1.4, 1.6, 7),
    E("mouth", "jaw", 0, 0, 1.4, 0.8, "ink", 7, { tone: -3, views: ["down", "down-side", "side"] }),
  ];
  return { joints, parts };
}

function plant(m: Maker): { joints: Joint[]; parts: PartDef[] } {
  const { J, E, B, L, eyes } = m;
  const joints = [
    J("base", null, [16, 28]),
    J("body", "base", [16, 19.5], [15.5, 19.5]),
    J("head", "body", [16, 13.5], [16, 13.5]),
    J("jaw", "body", [16, 19.2], [18, 19.2]),
    J("wingL", "body", [9.2, 25], [13.2, 25.4], [9.2, 25]),
    J("wingR", "body", [22.8, 25], [17.8, 25.4], [22.8, 25]),
    J("footL", "base", [13, 28]),
    J("footR", "base", [19, 28]),
  ];
  const teeth = (id: string, joint: string, y: number, xs: number[], z: number, views: PartDef["views"]) =>
    xs.map((x, i) => B(`${id}${i}`, joint, x, y, 1.5, 1.5, "teeth", z, { views, tone: 2 }));
  const parts: PartDef[] = [
    E("mound", "base", 0, -1.2, 7, 2.3, "soil", 0, { flat: 0.2 }),
    L("stem", "base", "body", 2, "leaf", 1, { tone: -1 }),
    E("leafL", "wingL", 0, 0, 5, 2.2, "leaf", { down: 2, side: 2, up: 2 }),
    E("leafR", "wingR", 0, 0, 5, 2.2, "leaf", { down: 2, side: 0.5, up: 2 }, { tone: -1 }),
    // front: dark mouth between upper bulb and lower jaw
    E("bulbBack", "head", 0, 3, 7, 3.6, "bulb", 3, { tone: -2, views: ["up"] }),
    E("cavity", "head", 0, 3.6, 6.4, 3, "mouth", 3.5, { tone: -3, views: ["down"] }),
    E("cavityD", "head", 2.4, 3.6, 5.4, 3, "mouth", 3.5, { tone: -3, views: ["down-side"] }),
    E("cavityS", "head", 4, 3.6, 4, 3, "mouth", 3.5, { tone: -3, views: ["side"] }),
    E("jaw", "jaw", 0, 1.2, 6.4, 3, "bulb", 4, { tone: -1, views: ["down", "up"] }),
    E("jawD", "jaw", 1.2, 1.2, 6, 3, "bulb", 4, { tone: -1, views: ["down-side", "up-side"] }),
    E("jawS", "jaw", 1.4, 1.2, 5.4, 3, "bulb", 4, { tone: -1, views: ["side"], noDiag: true }),
    E("bulb", "head", 0, 0, 7.8, 6.2, "bulb", 3.8, { views: ["down", "up", "down-side", "up-side"] }),
    E("bulbS", "head", 0, 0, 6.8, 6.2, "bulb", 3.8, { views: ["side"] }),
    ...teeth("tooth", "head", 2.6, [-4, -1.4, 1.4, 4], 4.6, ["down"]),
    ...teeth("toothD", "head", 2.6, [-1, 1.8, 4.6], 4.6, ["down-side"]),
    ...teeth("toothS", "head", 2.6, [2.4, 4.6, 6.4], 4.6, ["side"]),
    ...teeth("tooth-low", "jaw", -0.6, [-2.8, 2.6], 4.7, ["down"]),
    ...teeth("tooth-lowS", "jaw", -0.6, [3.4, 5.4], 4.7, ["side"]),
    E("spotA", "head", -4.4, -2.8, 1.5, 1.2, "spots", 5, { flat: 0.8, views: ["down", "up"] }),
    E("spotB", "head", 4.2, -3.4, 1.2, 1, "spots", 5, { flat: 0.8, views: ["down", "up"] }),
    E("spotC", "head", 0.4, -4.6, 1.2, 1, "spots", 5, { flat: 0.8, views: ["up"] }),
    E("spotSa", "head", -2.6, -2.8, 1.6, 1.2, "spots", 5, { flat: 0.8, views: ["side"] }),
    ...eyes("head", -2.2, 1.4, 6, { w: 2, h: 2 }),
    // angry brows slanting toward the nose
    B("browL", "head", -4.4, -3.6, 3, 1, "ink", 6.3, { tone: -4, views: ["down"] }),
    B("browR", "head", 1.4, -3.6, 3, 1, "ink", 6.3, { tone: -4, views: ["down"] }),
  ];
  return { joints, parts };
}

function bat(m: Maker): { joints: Joint[]; parts: PartDef[] } {
  const { J, E, B, L, eyes } = m;
  const joints = [
    J("base", null, [16, 28]),
    J("body", "base", [16, 17], [15, 17]),
    J("head", "body", [16, 11.6], [17.6, 11.6]),
    J("jaw", "body", [16, 13.8], [19, 13.8]),
    J("wingL", "body", [8, 14.5], [11, 13.5], [8, 14.5]),
    J("wingR", "body", [24, 14.5], [16.5, 14.5], [24, 14.5]),
    J("footL", "body", [14.2, 21.4], [13.8, 21.6]),
    J("footR", "body", [17.8, 21.4], [16.2, 21.6]),
  ];
  const wing = (side: "L" | "R", far: boolean): PartDef[] => {
    const j = `wing${side}`;
    const sx = side === "L" ? -1 : 1;
    const z = far ? 0.8 : { down: 1.2, side: 5, up: 1.2 };
    const tone = far ? -2 : -1;
    return [
      L(`arm${side}`, "body", j, 1, "fur", far ? 0.7 : { down: 1.1, side: 4.9, up: 1.1 }, { tone: -1 }),
      E(`mem${side}`, j, sx * 1.2, 1.4, 6.2, 3.8, "wing", z, { tone }),
      E(`memB${side}`, j, sx * 3, 3.6, 3.6, 2.2, "wing", z, { tone: tone - 1 }),
    ];
  };
  const parts: PartDef[] = [
    E("shadow", "base", 0, -0.6, 5.6, 1.5, "shadow", 0, { flat: 1, tone: 1 }),
    ...wing("R", true),
    ...wing("L", false),
    E("footL", "footL", 0, 0, 1, 1.5, "fur", 1.3, { tone: -1 }),
    E("footR", "footR", 0, 0, 1, 1.5, "fur", 1.3, { tone: -1 }),
    E("body", "body", 0, 0, 4.8, 5.2, "fur", 2),
    E("belly", "body", 0, 1.6, 2.8, 2.6, "fur", 2.4, { tone: 1, views: ["down"] }),
    E("earL", "head", -3.6, -4.2, 1.7, 3, "fur", 2.8, { views: ["down", "up"] }),
    E("earR", "head", 3.6, -4.2, 1.7, 3, "fur", 2.8, { views: ["down", "up"] }),
    E("earInL", "head", -3.6, -3.6, 0.8, 1.8, "ear", 2.9, { tone: 1, views: ["down"] }),
    E("earInR", "head", 3.6, -3.6, 0.8, 1.8, "ear", 2.9, { tone: 1, views: ["down"] }),
    E("earS", "head", -1.6, -4.6, 1.7, 3, "fur", 2.8, { views: ["side"] }),
    E("earSIn", "head", -1.4, -4, 0.8, 1.8, "ear", 2.9, { tone: 1, views: ["side"] }),
    E("earSF", "head", 1.6, -4.4, 1.5, 2.6, "fur", 2.6, { tone: -1, views: ["side"] }),
    E("head", "head", 0, 0, 5.2, 4.4, "fur", 3, { views: ["down", "up", "down-side", "up-side"] }),
    E("headS", "head", 0, 0, 4.8, 4.4, "fur", 3, { views: ["side"] }),
    E("snout", "jaw", 0, -1.4, 2.4, 1.6, "fur", 3.5, { tone: 1, views: ["down"] }),
    E("snoutS", "jaw", 0.6, -1.5, 2.2, 1.5, "fur", 3.5, { tone: 1, views: ["side"] }),
    B("fangL", "jaw", -1.6, -0.2, 1, 1.6, "teeth", 3.6, { tone: 2, views: ["down"] }),
    B("fangR", "jaw", 0.6, -0.2, 1, 1.6, "teeth", 3.6, { tone: 2, views: ["down"] }),
    B("fangS", "jaw", 2.4, -0.2, 1, 1.6, "teeth", 3.6, { tone: 2, views: ["side"] }),
    ...eyes("head", -1.4, 1.6, 6, { slot: "eye", glint: false, w: 2, h: 2 }),
  ];
  return { joints, parts };
}

const BLOB_SKIP = /^(shadow|puddle|mound)$/;

/** Species prefixes: each blob species owns copies of the shared joints so one clip can move every species differently. */
export const SPECIES_PREFIX = { slime: "s_", mushroom: "m_", plant: "p_", bat: "b_" } as const;
type Species = keyof typeof SPECIES_PREFIX;
const keepName = (j: string) => j === "base";

function blob(spec: BlobSpec, make: (m: Maker) => { joints: Joint[]; parts: PartDef[] }, centre: V2, species: Species): RigDef {
  const s = spec.scale ?? 1;
  const m = maker(s);
  const made = make(m);
  const pre = SPECIES_PREFIX[species];
  const rn = (j: string) => (keepName(j) ? j : pre + j);
  const joints = made.joints.map((j) => ({ ...j, id: rn(j.id), parent: j.parent === null ? null : rn(j.parent) }));
  const parts = made.parts.map((p): PartDef => {
    if (p.kind === "limb") return { ...p, from: rn(p.from), to: rn(p.to) };
    if (p.kind === "ellipse" || p.kind === "box") return { ...p, joint: rn(p.joint) };
    return p;
  });
  const base: RigDef = { id: spec.id, name: spec.name, grid: 32, joints, parts, slots: { ink: "ink", ...spec.slots } };
  return withFx(base, [m.X(centre[0]), m.Y(centre[1])], BLOB_SKIP, spec.slots.fxMat ?? "ui");
}

const MUSH = (id: string, name: string, slots: Slots, king = false) =>
  blob({ id, name, scale: king ? 1.2 : 1, slots }, (m) => mushroom(m, king), [16, 19], "mushroom");
const SLIME = (id: string, name: string, body: Material, shine: Material, tuft: Material = body) =>
  blob({ id, name, slots: { body, shine, tuft, fx: body } as Slots }, slime, [16, 21], "slime");

export const MONSTER_RIGS: RigDef[] = [
  MUSH("monster-mushroom-red", "Mushroom (red)", { cap: "cloth2", spots: "sand", stalk: "sand" }),
  MUSH("monster-mushroom-brown", "Mushroom (brown)", { cap: "leather", spots: "sand", stalk: "sand" }),
  MUSH("monster-mushroom-poison", "Mushroom (blue poison)", { cap: "cloth", spots: "grass", stalk: "stone" }),
  MUSH("monster-mushroom-king", "Mushroom King", { cap: "accent", spots: "gold", stalk: "sand", crown: "gold" }, true),
  SLIME("monster-slime-green", "Slime (green)", "grass", "ui"),
  SLIME("monster-slime-blue", "Slime (blue)", "water", "ui"),
  SLIME("monster-slime-fire", "Slime (fire)", "cloth2", "gold", "gold"),
  SLIME("monster-slime-metal", "Slime (metal)", "metal", "ui"),
  blob({ id: "monster-plant", name: "Snapping plant", slots: { bulb: "cloth2", leaf: "foliage", spots: "sand", soil: "dirt", mouth: "roof", teeth: "ui" } }, plant, [16, 18], "plant"),
  blob({ id: "monster-bat", name: "Bat", slots: { fur: "accent", wing: "accent", ear: "skin", eye: "gold", teeth: "ui", shadow: "ink" } }, bat, [16, 15], "bat"),
];

// ---------------------------------------------------------------- beast (wolf) and undead (skeleton)

/** Scale a rig about its feet (16, 28): the dog skeleton is pup-sized, the wolf is not. */
function scaleRig(rig: RigDef, k: number): RigDef {
  const pt = (p: V2): V2 => [16 + (p[0] - 16) * k, 28 - (28 - p[1]) * k];
  const joints = rig.joints.map((j) => ({ ...j, rest: Array.isArray(j.rest) ? pt(j.rest) : Object.fromEntries(Object.entries(j.rest).map(([v, p]) => [v, pt(p as V2)])) }) as Joint);
  const parts = rig.parts.map((p): PartDef => {
    if (p.kind === "ellipse") return { ...p, rx: p.rx * k, ry: p.ry * k, dx: (p.dx ?? 0) * k, dy: (p.dy ?? 0) * k };
    if (p.kind === "box") return { ...p, w: p.w * k, h: p.h * k, dx: (p.dx ?? 0) * k, dy: (p.dy ?? 0) * k };
    if (p.kind === "limb") return { ...p, r: p.r * k };
    return p;
  });
  return { ...rig, joints, parts };
}

/** Quadruped skeleton re-dressed: grey coat, pointed ears, ruff, bushy tail, fangs. */
function wolfRig(): RigDef {
  const dog = quadrupedRig("dog");
  // the dog's front/back head, neck and tail are replaced below; side-view parts stay
  const keep = dog.parts.filter((p) => !/^(ear|tail|eye|nose|headFront|snoutF|neckD|neckU|maneD)/.test(p.id)).map((p): PartDef => {
    if (p.id === "head") return { ...p, views: ["side", "down-side", "up-side"] as PartDef["views"] };
    if (p.kind === "ellipse" && p.id === "chestD") return { ...p, rx: p.rx * 0.78, ry: p.ry * 0.85, dy: (p.dy ?? 0) - 0.8 };
    if (p.kind === "ellipse" && p.id === "humpD") return { ...p, rx: p.rx * 0.8 };
    if (p.kind === "ellipse" && p.id === "chestU") return { ...p, rx: p.rx * 0.72 };
    return p;
  });
  const E = (id: string, joint: string, dx: number, dy: number, rx: number, ry: number, slot: string, z: PartDef["z"], o: Partial<PartDef> = {}): PartDef =>
    ({ id, kind: "ellipse", joint, dx, dy, rx, ry, slot, z, ...o }) as PartDef;
  const B = (id: string, joint: string, dx: number, dy: number, w: number, h: number, slot: string, z: PartDef["z"], o: Partial<PartDef> = {}): PartDef =>
    ({ id, kind: "box", joint, dx, dy, w, h, slot, z, ...o }) as PartDef;
  // front view: lift the head clear of the chest so skull, snout and ruff read separately
  const joints = dog.joints.map((j): Joint => {
    const r = j.rest as Record<string, V2>;
    if (j.id === "head") return { ...j, rest: { ...r, down: [16, r.down[1] - 2.6] } };
    if (j.id === "jaw") return { ...j, rest: { ...r, down: [16, r.down[1] - 2.2] } };
    if (j.id === "neck") return { ...j, rest: { ...r, down: [16, r.down[1] - 1.4] } };
    return j;
  });
  const parts: PartDef[] = [
    ...keep,
    // front: broad skull, cheek ruff, short foreshortened muzzle (lighter, narrower), pointed ears, slanted eyes
    E("neckF", "neck", 0, 1.2, 4.2, 3, "coat", 3, { tone: -1, views: ["down"] }),
    E("ruffF", "neck", 0, -0.2, 6.6, 2.6, "coat", 3.4, { tone: 1, views: ["down"] }),
    E("ruffFL", "neck", -5.4, 0.8, 1.6, 2.6, "coat", 3.5, { tone: 1, views: ["down"] }),
    E("ruffFR", "neck", 5.4, 0.8, 1.6, 2.6, "coat", 3.5, { tone: 1, views: ["down"] }),
    E("skullF", "head", 0, 0, 4.6, 3.3, "coat", 4, { views: ["down"] }),
    E("cheekFL", "head", -4.2, 1.6, 1.7, 1.8, "coat", 4.1, { tone: 1, views: ["down"] }),
    E("cheekFR", "head", 4.2, 1.6, 1.7, 1.8, "coat", 4.1, { tone: 1, views: ["down"] }),
    E("browF", "head", 0, -2.2, 2.4, 1, "coat", 4.2, { tone: -1, views: ["down"] }),
    E("muzzleF", "jaw", 0, -0.2, 2.3, 2.2, "muzzle", 5, { tone: 1, views: ["down"] }),
    E("muzzleFB", "jaw", 0, 0.9, 1.6, 0.8, "muzzle", 5.1, { tone: 2, views: ["down"] }),
    B("noseF", "jaw", -0.8, -0.6, 1.6, 1, "ink", 9, { tone: -4, views: ["down"] }),
    B("fangFL", "jaw", -1.3, 1.7, 0.8, 1.2, "teeth", 9, { tone: 2, views: ["down"] }),
    B("fangFR", "jaw", 0.5, 1.7, 0.8, 1.2, "teeth", 9, { tone: 2, views: ["down"] }),
    B("eyeFL", "head", -3.2, -0.9, 1.6, 1, "eye", 9, { tone: 1, views: ["down"] }),
    B("eyeFR", "head", 1.6, -0.9, 1.6, 1, "eye", 9, { tone: 1, views: ["down"] }),
    // ears: tall points, inner skin on the front only
    E("earNear", "head", -1.4, -3.6, 1.3, 2.6, "coat", 6, { tone: -1, views: ["side"] }),
    E("earNearIn", "head", -1.2, -3.2, 0.6, 1.4, "inner", 6.1, { views: ["side"] }),
    E("earFar", "head", 0.8, -3.7, 1.2, 2.4, "coat", 3.9, { tone: -2, views: ["side"] }),
    E("earFarD", "head", 1.4, -3.4, 1.2, 2.4, "coat", 3.9, { tone: -2, views: ["down-side"] }),
    E("earL", "head", -3.6, -3.4, 1.8, 2.2, "coat", 6, { tone: -1, views: ["down", "up"] }),
    E("earR", "head", 3.6, -3.4, 1.8, 2.2, "coat", 6, { tone: -1, views: ["down", "up"] }),
    E("earLTip", "head", -3.9, -5.4, 0.9, 1.4, "coat", 6, { tone: -1, views: ["down", "up"] }),
    E("earRTip", "head", 3.9, -5.4, 0.9, 1.4, "coat", 6, { tone: -1, views: ["down", "up"] }),
    E("earLIn", "head", -3.6, -3.2, 0.7, 1.4, "inner", 6.1, { views: ["down"] }),
    E("earRIn", "head", 3.6, -3.2, 0.7, 1.4, "inner", 6.1, { views: ["down"] }),
    // back: nape, thick ruff, dark saddle stripe along the spine
    E("napeU", "head", 0, 0.4, 4.6, 3.4, "coat", 4, { views: ["up"] }),
    E("ruffU", "neck", 0, 0.6, 6.4, 2.8, "coat", 3.4, { tone: 1, views: ["up"] }),
    E("neckU2", "neck", 0, 0.4, 4.2, 2.6, "coat", 3, { tone: -1, views: ["up"] }),
    E("saddleU", "body", 0, -0.4, 2, 3.4, "coat", 2.6, { tone: -1, views: ["up"] }),
    E("saddleD", "body", 0, -2.4, 2.4, 2, "coat", 2.6, { tone: -1, views: ["down"] }),
    // ruff and tail in profile
    E("ruff", "neck", -1.2, 1.2, 2.4, 3.6, "coat", 3.2, { tone: 1, views: ["side"] }),
    E("tail", "tail", -2.4, 1.4, 1.9, 4.2, "coat", 1, { views: ["side"] }),
    E("tailTip", "tail", -2.8, 4.8, 1.5, 1.8, "tip", 1.1, { views: ["side"] }),
    // back view: a real bushy tail hanging over the rump, tip colour at the end
    E("tailB", "tail", 0, 2.4, 2.3, 4.6, "coat", 5, { tone: -2, views: ["up"] }),
    E("tailBMid", "tail", 0, 3.8, 2.5, 2.6, "coat", 5.05, { tone: -1, views: ["up"] }),
    E("tailBTip", "tail", 0, 5.8, 1.9, 1.8, "tip", 5.1, { tone: 1, views: ["up"] }),
    // fangs and eyes in profile
    B("fang", "jaw", 1.4, 0.8, 1, 1.4, "teeth", 6.5, { tone: 2, views: ["side"] }),
    B("eye", "head", 1.2, -1.3, 2, 1, "eye", 9, { tone: 1, views: ["side"] }),
    B("eyeD", "head", 2.2, -1.2, 2, 1, "eye", 9, { tone: 1, views: ["down-side"] }),
    B("nose", "jaw", 1.9, -1.2, 1, 1, "ink", 9, { tone: -4, views: ["side"] }),
  ];
  const rig: RigDef = { id: "monster-wolf", name: "Wolf", grid: 32, joints, parts, slots: { coat: "stone", accent: "metal", hoof: "ink", mane: "stone", muzzle: "metal", ink: "ink", inner: "skin", tip: "metal", teeth: "ui", eye: "gold" } };
  return withFx(scaleRig(rig, 1.3), [14, 22], /^(shadow)$/, "ui");
}

/** Humanoid skeleton drawn as bone: thin limbs, ribs, skull with eye sockets and a jaw. */
function skeletonRig(): RigDef {
  const base = humanoidRig("slim");
  const B = (id: string, joint: string, dx: number, dy: number, w: number, h: number, slot: string, z: PartDef["z"], o: Partial<PartDef> = {}): PartDef =>
    ({ id, kind: "box", joint, dx, dy, w, h, slot, z, ...o }) as PartDef;
  const E = (id: string, joint: string, dx: number, dy: number, rx: number, ry: number, slot: string, z: PartDef["z"], o: Partial<PartDef> = {}): PartDef =>
    ({ id, kind: "ellipse", joint, dx, dy, rx, ry, slot, z, ...o }) as PartDef;
  const thin = (p: PartDef): PartDef => {
    const q = p as Extract<PartDef, { kind: "ellipse" }>;
    if (p.kind === "limb") return { ...p, r: Math.max(0.9, p.r * 0.62), slot: "bone", tone: p.tone };
    if (p.id.startsWith("boot")) return { ...p, slot: "bone", tone: (p.tone ?? 0) - 1 };
    if (p.id.startsWith("hand")) return { ...q, slot: "bone", rx: 1.1, ry: 1.1 };
    if (p.id.startsWith("torso")) return { ...q, slot: "bone", rx: q.rx * 0.62, ry: q.ry * 0.9, tone: -1 };
    if (p.id.startsWith("belt")) return { ...p, slot: "bone", tone: -1 };
    if (p.id === "head") return { ...q, slot: "bone", rx: 6.4, ry: 5.6, views: ["down", "up", "down-side", "up-side"] };
    return p;
  };
  // weapon: a rusty sword in the right hand and a small shield on the left, pinned to joints so the
  // humanoid attack clip swings the blade (`toolTip`) and the shield arm
  const hand = base.joints.find((j) => j.id === "handR")!.rest as Record<string, V2>;
  const at = (dx: number, dy: number, sdx = dx): Joint["rest"] => ({ down: [hand.down[0] + dx, hand.down[1] + dy], side: [hand.side[0] + sdx, hand.side[1] + dy], up: [hand.up[0] + dx, hand.up[1] + dy] });
  const HELD = 4;
  const HZ: PartDef["z"] = { down: HELD, side: HELD, up: 1.6 };
  const HZ2: PartDef["z"] = { down: HELD + 0.1, side: HELD + 0.1, up: 1.7 };
  const joints: Joint[] = [
    ...base.joints,
    { id: "toolTip", parent: "handR", rest: at(1.5, -13, 2.5) },
    { id: "toolButt", parent: "handR", rest: at(0, 2.5, 0) },
  ];
  const weapon: PartDef[] = [
    { id: "sword-grip", kind: "limb", from: "toolButt", to: "handR", r: 0.8, slot: "leather", z: HZ },
    { id: "sword-guard", kind: "ellipse", joint: "handR", dy: -1.6, rx: 2.2, ry: 0.8, slot: "metal", tone: -2, z: HZ2 },
    { id: "sword-blade", kind: "limb", from: "handR", to: "toolTip", r: 1.2, slot: "rust", tone: -1, z: HZ },
    { id: "sword-edge", kind: "limb", from: "handR", to: "toolTip", r: 0.4, slot: "rust", tone: 1, z: HZ2, views: ["down", "up"] },
    { id: "sword-tip", kind: "box", joint: "toolTip", dx: -0.4, dy: -1, w: 1.2, h: 1.5, slot: "rust", tone: 1, z: HZ2 },
    { id: "sword-nick", kind: "box", joint: "toolTip", dx: 0.4, dy: 4, w: 1, h: 1.2, slot: "ink", tone: -2, z: HZ2, views: ["down", "up"] },
    // small shield on the left forearm
    { id: "shield-face", kind: "ellipse", joint: "handL", dy: -1.4, rx: 3.6, ry: 4.2, slot: "wood", z: HELD, views: ["down", "up"] },
    { id: "shield-rim", kind: "ellipse", joint: "handL", dy: -1.4, rx: 3.9, ry: 4.5, slot: "metal", tone: -1, z: HELD - 0.1, views: ["down", "up"] },
    { id: "shield-boss", kind: "ellipse", joint: "handL", dy: -1.4, rx: 1.2, ry: 1.2, slot: "metal", tone: 1, z: HELD + 0.1, views: ["down"] },
    { id: "shield-side", kind: "ellipse", joint: "handL", dy: -1.4, rx: 1.6, ry: 4.2, slot: "wood", z: HELD, views: ["side"] },
    { id: "shield-side-rim", kind: "ellipse", joint: "handL", dy: -1.4, rx: 1.9, ry: 4.5, slot: "metal", tone: -1, z: HELD - 0.1, views: ["side"] },
  ];
  const parts: PartDef[] = [
    ...base.parts.map(thin),
    ...weapon,
    // side-view skull: round cranium, cheekbone and a distinct brow/face step, ear hole, nose hole
    E("headS", "head", -0.6, -0.4, 5.4, 5.4, "bone", 4, { views: ["side"] }),
    E("cheekS", "head", 2.8, 2.6, 2.8, 2.6, "bone", 4.1, { tone: -1, views: ["side"] }),
    E("browS", "head", 3.6, -2.8, 2, 1, "bone", 4.2, { tone: 1, views: ["side"] }),
    B("earHoleS", "head", -1.6, 0.4, 1, 1.4, "ink", 9, { tone: -2, views: ["side"] }),
    B("noseS", "head", 5.2, 1, 1, 1.4, "ink", 9, { tone: -3, views: ["side"] }),
    E("jawbone", "head", 0, 4.6, 4, 1.7, "bone", 4.2, { tone: -1, views: ["down", "down-side"] }),
    E("jawboneS", "head", 1.4, 5, 3.4, 1.5, "bone", 4.2, { tone: -1, views: ["side"] }),
    E("pelvis", "hip", 0, -0.4, 3.4, 1.6, "bone", 2.4, { tone: -1, views: ["down", "up"] }),
    // eye sockets, nose hole, teeth
    B("socketL", "head", -3.8, -1.8, 3, 3, "ink", 9, { tone: -3, views: ["down"] }),
    B("socketR", "head", 0.8, -1.8, 3, 3, "ink", 9, { tone: -3, views: ["down"] }),
    B("socketDa", "head", -2.4, -1.8, 3, 3, "ink", 9, { tone: -3, views: ["down-side"] }),
    B("socketDb", "head", 2.8, -1.8, 2, 3, "ink", 9, { tone: -3, views: ["down-side"] }),
    B("socketS", "head", 2, -1.8, 3.4, 3.4, "ink", 9, { tone: -3, views: ["side"] }),
    B("glowL", "head", -2.8, -0.8, 1, 1, "eye", 9.5, { tone: 2, views: ["down"] }),
    B("glowR", "head", 1.8, -0.8, 1, 1, "eye", 9.5, { tone: 2, views: ["down"] }),
    B("glowD", "head", -1.4, -0.8, 1, 1, "eye", 9.5, { tone: 2, views: ["down-side"] }),
    B("glowS", "head", 3.6, -0.8, 1, 1, "eye", 9.5, { tone: 2, views: ["side"] }),
    B("nose", "head", -0.5, 1.8, 1, 1.4, "ink", 9, { tone: -3, views: ["down"] }),
    B("teeth", "head", -2.5, 3.6, 5, 1, "ink", 9, { tone: 0, views: ["down"] }),
    B("teethS", "head", 2.4, 4.3, 3.4, 1, "ink", 9, { tone: 0, views: ["side"] }),
    // ribs: dark bars across the chest, spine in the middle (front view), spine edge (side)
    B("rib1", "chest", -2.6, 0.8, 5, 1, "ink", 3.5, { tone: -1, views: ["down"] }),
    B("rib2", "chest", -2.6, 2.6, 5, 1, "ink", 3.5, { tone: -1, views: ["down"] }),
    B("rib3", "chest", -2.6, 4.4, 5, 1, "ink", 3.5, { tone: -1, views: ["down"] }),
    B("ribS1", "chest", -1, 0.8, 3, 1, "ink", 3.5, { tone: -1, views: ["side"] }),
    B("ribS2", "chest", -1, 2.6, 3, 1, "ink", 3.5, { tone: -1, views: ["side"] }),
    B("ribS3", "chest", -1, 4.4, 3, 1, "ink", 3.5, { tone: -1, views: ["side"] }),
    B("spine", "chest", -0.5, 0, 1, 7, "bone", 3.4, { tone: 1, views: ["down", "up"] }),
  ];
  const rig: RigDef = { id: "monster-skeleton", name: "Skeleton", grid: 32, joints, parts, slots: { ...base.slots, bone: "sand", eye: "accent", ink: "ink", rust: "metal", wood: "wood", metal: "metal", leather: "leather" } };
  return withFx(rig, [16, 17], /^(shadow)$/, "ui");
}

export const WOLF_RIG = wolfRig();
export const SKELETON_RIG = skeletonRig();

// ---------------------------------------------------------------- clips

type View3 = "down" | "side" | "up";
const fj = (js: readonly string[]) => js.map(flashJoint);
/** Flash twins on top of the body (joints of the family). */
const flashOn = (js: readonly string[]): Pose => Object.fromEntries(fj(js).map((j) => [j, [0, HIDE] as V2]));
/** Body parked off canvas: root up, flash twins held where they were. */
const gone = (root: string, js: readonly string[]): Pose => ({ [root]: [0, HIDE], ...Object.fromEntries(fj(js).map((j) => [j, [0, -HIDE] as V2])) });
const puff = (j: (typeof FX_JOINTS)[number]): Pose => ({ [j]: [0, HIDE] });
const merge = (...ps: Pose[]): Pose => Object.assign({}, ...ps);

/** A pose spec: joint -> [forward, up, outward]. Forward is toward the camera in `down`, away in `up`, right in `side`. */
type Spec = Record<string, [number, number, number?]>;
function pose(view: View3, spec: Spec, left: readonly string[] = []): Pose {
  const out: Pose = {};
  for (const [j, [f, u, l = 0]] of Object.entries(spec)) {
    const side = left.includes(j) ? -1 : 1;
    if (view === "side") out[j] = [f, -u];
    else out[j] = [side * l, (view === "down" ? 0.6 * f : -0.6 * f) - u];
  }
  return out;
}
const perView = (spec: (v: View3) => Pose[]): Clip["frames"] => ({ down: spec("down"), side: spec("side"), up: spec("up") });

// ---- blob family
const BJ = [...MONSTER_JOINTS];
const BL = ["wingL", "footL"];
const bp = (v: View3, s: Spec) => pose(v, s, BL);

const mIdle: Clip = {
  id: "idle", fps: 3,
  frames: perView((v) => [
    bp(v, {}),
    bp(v, { head: [0, 1], wingL: [0, 0.5, 0.5], wingR: [0, 0.5, 0.5] }),
    bp(v, {}),
    bp(v, { body: [0, -1], head: [0, -0.5], wingL: [0, -0.5], wingR: [0, -0.5] }),
  ]),
};
const mWalk: Clip = {
  id: "walk", fps: 7,
  frames: perView((v) => {
    const sway = v === "side" ? 0 : 1;
    return [
      merge(bp(v, { body: [0, -1], head: [0, -1.5], wingL: [0, -1, 0.5], wingR: [0, -1, 0.5] }), v === "side" ? {} : { body: [-sway, 0.6] }),
      bp(v, { body: [0.5, 1], head: [0.5, 2], wingL: [0, 2, 1], wingR: [0, 2, 1], footL: [1, 1.5] }),
      merge(bp(v, { body: [0, -1], head: [0, -1.5], wingL: [0, -1, 0.5], wingR: [0, -1, 0.5] }), v === "side" ? {} : { body: [sway, 0.6] }),
      bp(v, { body: [0.5, 1], head: [0.5, 2], wingL: [0, 2, 1], wingR: [0, 2, 1], footR: [1, 1.5] }),
    ];
  }),
};
const mAttack: Clip = {
  id: "attack", fps: 9,
  frames: perView((v) => [
    bp(v, { body: [-1, -1], head: [-1, -1], jaw: [0, 0], wingL: [-1, 1.5, 1.5], wingR: [-1, 1.5, 1.5] }),
    bp(v, { body: [-1.5, -2], head: [-2, -2.5], jaw: [-1, 0], wingL: [-1, 3, 2], wingR: [-1, 3, 2] }),
    bp(v, { body: [2.5, 0], head: [4, 0], jaw: [3.5, -2], wingL: [3, 0, -1], wingR: [3, 0, -1], footL: [2, 0], footR: [2, 0] }),
    bp(v, { body: [2.5, 0.5], head: [3.5, 0], jaw: [3, -2], wingL: [3, 0, -1], wingR: [3, 0, -1] }),
    bp(v, { body: [1, 0], head: [1, 0], wingL: [0, 0.5, 0.5], wingR: [0, 0.5, 0.5] }),
  ]),
};
const mHurt: Clip = {
  id: "hurt", fps: 8,
  frames: perView((v) => [
    merge(bp(v, { body: [-2, 1], head: [-2, 1], wingL: [-1, 3, 2], wingR: [-1, 3, 2] }), flashOn(BJ)),
    merge(bp(v, { body: [-3, 0], head: [-3, -1], wingL: [-2, 2, 2], wingR: [-2, 2, 2] }), flashOn(BJ)),
    bp(v, { body: [-2, -1], head: [-2, -1.5], wingL: [-1, 1, 1.5], wingR: [-1, 1, 1.5] }),
    bp(v, { body: [-1, 0], head: [-1, 0] }),
  ]),
};
const mDie: Clip = {
  id: "die", fps: 8,
  frames: perView((v) => [
    merge(bp(v, { body: [-3, 1], head: [-3, 0], wingL: [-1, 3, 2], wingR: [-1, 3, 2] }), flashOn(BJ)),
    merge(bp(v, { body: [-3, -2], head: [-3, -4], wingL: [0, -2, 2], wingR: [0, -2, 2] }), flashOn(BJ)),
    merge(gone("base", BJ), puff("puffA")),
    merge(gone("base", BJ), puff("puffB")),
    merge(gone("base", BJ), puff("puffC")),
    gone("base", BJ),
  ]),
};

// ---- per-species motion: the generic clips above move generic joints; every species also owns
// prefixed copies (s_ slime, m_ mushroom, p_ plant, b_ bat) that only its own rig has, so one clip
// per id still animates each species its own way. Hurt and die just copy the generic pose to all.
const SP = Object.values(SPECIES_PREFIX);
const keyFor = (pre: string, k: string) => (k.startsWith("f_") ? `f_${pre}${k.slice(2)}` : pre + k);
function dup(p: Pose): Pose {
  const out: Pose = { ...p };
  for (const [k, v] of Object.entries(p)) {
    if (k === "base" || k.startsWith("puff")) continue;
    for (const pre of SP) out[keyFor(pre, k)] = v;
  }
  return out;
}
type PerView = { down: Pose[]; side: Pose[]; up: Pose[] };
const dupClip = (c: Clip): Clip => {
  const fr = c.frames as PerView;
  return { ...c, frames: { down: fr.down.map(dup), side: fr.side.map(dup), up: fr.up.map(dup) } };
};
/** Species pose from a spec keyed by unprefixed joint names. */
const sp = (pre: string, v: View3, spec: Spec): Pose => pose(v, Object.fromEntries(Object.entries(spec).map(([k, a]) => [pre + k, a])), [`${pre}wingL`, `${pre}footL`]);
/** Raw grid offsets (same in every view): sways. */
const rw = (pre: string, d: Record<string, V2>): Pose => Object.fromEntries(Object.entries(d).map(([k, a]) => [pre + k, a]));
const withSpecies = (c: Clip, ...fs: ((v: View3) => Pose[])[]): Clip => {
  const fr = c.frames as PerView;
  const one = (v: View3) => fr[v].map((g, i) => merge(g, ...fs.map((f) => f(v)[i])));
  return { ...c, frames: { down: one("down"), side: one("side"), up: one("up") } };
};

// slime: squash and stretch
const S_ = SPECIES_PREFIX.slime;
const sq = (k: number): Spec => ({ head: [0, -1.5 * k], wingL: [0, -0.4 * k, 1.4 * k], wingR: [0, -0.4 * k, 1.4 * k] });
const st = (k: number): Spec => ({ head: [0, 1.8 * k], wingL: [0, 0.3 * k, -1.2 * k], wingR: [0, 0.3 * k, -1.2 * k] });
const slimeIdle = (v: View3) => [sq(0.4), {}, st(0.4), {}].map((s) => sp(S_, v, s));
const slimeWalk = (v: View3) => [
  sp(S_, v, sq(1.3)),
  sp(S_, v, { ...st(1), body: [0.8, 2.5] }),
  sp(S_, v, { ...st(0.6), body: [1.5, 3.8] }),
  sp(S_, v, { ...sq(1.7), body: [0.5, 0] }),
];
const slimeAttack = (v: View3) => [
  sp(S_, v, { ...sq(1.4), body: [-1, 0] }),
  sp(S_, v, { ...sq(2.3), body: [-1.5, -0.5] }),
  sp(S_, v, { ...st(1.8), body: [4, 2], head: [1, 3.2], jaw: [2, -1] }),
  sp(S_, v, { ...sq(2), body: [4, 0], jaw: [2, -1] }),
  sp(S_, v, { ...st(0.4), body: [1, 0] }),
];

// mushroom: waddle (weight rocks from foot to foot), cap headbutt
const M_ = SPECIES_PREFIX.mushroom;
const mushIdle = (_v: View3) => [{}, { head: [0, 1] }, {}, { body: [0, -0.5], head: [0, -1] }].map((d) => rw(M_, d as Record<string, V2>));
const mushWalk = (_v: View3) => [
  rw(M_, { body: [-1, 0.8], head: [2, -0.3], wingL: [0, -1], wingR: [0, 1], footR: [0, -1.4] }),
  rw(M_, { body: [0, -0.5], head: [0, -0.6] }),
  rw(M_, { body: [1, 0.8], head: [-2, -0.3], wingL: [0, 1], wingR: [0, -1], footL: [0, -1.4] }),
  rw(M_, { body: [0, -0.5], head: [0, -0.6] }),
];
const mushAttack = (v: View3) => [
  sp(M_, v, { head: [-1, 1.5], wingL: [-1, 2, 1.5], wingR: [-1, 2, 1.5] }),
  sp(M_, v, { body: [-1, -1], head: [-2, 2.5], wingL: [-1, 3, 2], wingR: [-1, 3, 2] }),
  sp(M_, v, { body: [2, 0.5], head: [4, -2], jaw: [3, -2], wingL: [2, 0, -1], wingR: [2, 0, -1] }),
  sp(M_, v, { body: [2, 0.5], head: [3, -2], jaw: [3, -2] }),
  sp(M_, v, { body: [0.5, 0], head: [1, 0] }),
];

// bat: wing flap with a bob, tuck-and-dive bite
const B_ = SPECIES_PREFIX.bat;
const flap = (u: number, l: number): Spec => ({ wingL: [0, u, l], wingR: [0, u, l] });
const batIdle = (v: View3) => ([
  { ...flap(1.5, 0.5), body: [0, 0] }, { ...flap(0, 1), body: [0, -0.5] }, { ...flap(-1.5, 0.5), body: [0, -1] }, { ...flap(0, 1), body: [0, -0.5] },
] as Spec[]).map((s) => sp(B_, v, s));
const batWalk = (v: View3) => ([
  { ...flap(4, 1), body: [0, 0.5], footL: [0, 0.6], footR: [0, 0.6] },
  { ...flap(0.5, 2), body: [0.5, -1] },
  { ...flap(-3.5, 0.5), body: [0, -2], footL: [0, 0.6], footR: [0, 0.6] },
  { ...flap(0, 2), body: [0.5, -0.5] },
] as Spec[]).map((s) => sp(B_, v, s));
const batAttack = (v: View3) => ([
  { ...flap(4, 1), body: [-1, -2] },
  { ...flap(5, 1.5), body: [-2, -3], head: [-1, 0] },
  { ...flap(-2, -1), body: [3, 1], head: [3, 0], jaw: [3, -2], footL: [1, 1], footR: [1, 1] },
  { ...flap(-2.5, -1), body: [3, 0], head: [3, 0], jaw: [3, -1] },
  { ...flap(1, 1), body: [1, 0] },
] as Spec[]).map((s) => sp(B_, v, s));

// plant: rooted, sways on the spot; lunges from the stem
const P_ = SPECIES_PREFIX.plant;
const plantIdle = (_v: View3) => [
  rw(P_, { body: [-0.5, 0], head: [-1, 0], wingL: [0, -0.5], wingR: [0, 0.5] }),
  rw(P_, { head: [0, -0.5] }),
  rw(P_, { body: [0.5, 0], head: [1, 0], wingL: [0, 0.5], wingR: [0, -0.5] }),
  rw(P_, { head: [0, -0.5] }),
];
const plantWalk = (_v: View3) => [
  rw(P_, { body: [-1, 0.5], head: [-1.6, 0], wingL: [0, -1.2], wingR: [0, 1.2] }),
  rw(P_, { body: [0, 1], head: [0, 0.5], wingL: [0, 0.8], wingR: [0, 0.8] }),
  rw(P_, { body: [1, 0.5], head: [1.6, 0], wingL: [0, 1.2], wingR: [0, -1.2] }),
  rw(P_, { body: [0, 1], head: [0, 0.5], wingL: [0, 0.8], wingR: [0, 0.8] }),
];
const plantAttack = (v: View3) => [
  sp(P_, v, { body: [-1, -0.5], head: [-1.5, 1], wingL: [0, 1, 1], wingR: [0, 1, 1] }),
  sp(P_, v, { body: [-1.5, -1], head: [-2.5, 1.5], jaw: [-1, 1], wingL: [0, 2, 1.5], wingR: [0, 2, 1.5] }),
  sp(P_, v, { body: [3, 0], head: [4, -1], jaw: [2, -3], wingL: [1, 0, -1], wingR: [1, 0, -1] }),
  sp(P_, v, { body: [3, 0], head: [3.5, -1], jaw: [2, 0] }),
  sp(P_, v, { body: [1, 0], head: [1, 0] }),
];

export const MONSTER_CLIPS: Clip[] = [
  withSpecies(mIdle, slimeIdle, mushIdle, batIdle, plantIdle),
  withSpecies(mWalk, slimeWalk, mushWalk, batWalk, plantWalk),
  withSpecies(mAttack, slimeAttack, mushAttack, batAttack, plantAttack),
  dupClip(mHurt),
  dupClip(mDie),
];

// ---- beast family (quadruped joints)
const QJ = ["body", "neck", "head", "jaw", "tail", "shoulderFL", "kneeFL", "footFL", "shoulderFR", "kneeFR", "footFR", "hipBL", "kneeBL", "footBL", "hipBR", "kneeBR", "footBR"];
const FEET: [string, string][] = [["footFL", "kneeFL"], ["footFR", "kneeFR"], ["footBL", "kneeBL"], ["footBR", "kneeBR"]];
/** Counter the body offset so the paws stay planted (children inherit). */
const plant4 = (b: V2, which = FEET): Pose => Object.fromEntries(which.flatMap(([f, k]) => [[f, [-b[0], -b[1]]], [k, [-b[0] / 2, -b[1] / 2]]]));
const bq = (v: View3, s: Spec) => pose(v, s);
const fwd = (v: View3, f: number, u: number): V2 => (v === "side" ? [f, -u] : [0, (v === "down" ? 0.6 * f : -0.6 * f) - u]);
const qAttack: Clip = {
  id: "attack", fps: 9,
  frames: perView((v) => {
    const k = v === "up" ? 0.4 : 1; // lunging away from the camera would leave the canvas
    const b0 = fwd(v, -1, -1), b1 = fwd(v, -2.5, -2), b2 = fwd(v, 3 * k, 1);
    return [
      merge(bq(v, { body: [-1, -1], neck: [-1, 0], head: [-1, 0], tail: [-1, 1] }), plant4(b0)),
      merge(bq(v, { body: [-2.5, -2], neck: [-1.5, 0], head: [-2, 0], tail: [-2, 2] }), plant4(b1)),
      merge(bq(v, { body: [3 * k, 1], neck: [2 * k, 0], head: [2 * k, 0], jaw: [1, -2], tail: [-2, 1] }), plant4(b2, [["footBL", "kneeBL"], ["footBR", "kneeBR"]])),
      merge(bq(v, { body: [3 * k, 0], neck: [2 * k, 0], head: [2 * k, 0], jaw: [1, -2], tail: [-1, 0] }), plant4(fwd(v, 3 * k, 0), [["footBL", "kneeBL"], ["footBR", "kneeBR"], ["footFL", "kneeFL"], ["footFR", "kneeFR"]]), v === "side" ? { footFL: [2, 0], footFR: [2, 0] } : {}),
      merge(bq(v, { body: [1, 0], neck: [1, 0], head: [1, 0] }), plant4(fwd(v, 1, 0))),
    ];
  }),
};
const qHurt: Clip = {
  id: "hurt", fps: 8,
  frames: perView((v) => [
    merge(bq(v, { body: [-2, 1], neck: [-2, 1], head: [-2, 1], jaw: [0, -1], tail: [-1, 2] }), flashOn(QJ)),
    merge(bq(v, { body: [-3, 0], neck: [-2, 0], head: [-1, 1], jaw: [0, -1], tail: [0, 2] }), flashOn(QJ)),
    merge(bq(v, { body: [-2, 0], neck: [-1, -1], head: [0, -1] }), plant4(fwd(v, -2, 0))),
    merge(bq(v, { body: [-1, 0] }), plant4(fwd(v, -1, 0))),
  ]),
};
const qDie: Clip = {
  id: "die", fps: 8,
  frames: perView((v) => [
    merge(bq(v, { body: [-2, 1], neck: [-2, 1], head: [-2, 1], tail: [-1, 2] }), flashOn(QJ)),
    merge(bq(v, { body: [-1, -3], neck: [-1, -2], head: [-1, -2], jaw: [0, -1], tail: [-1, -3] }), flashOn(QJ), plant4(fwd(v, -1, -3))),
    merge(gone("body", QJ), puff("puffA")),
    merge(gone("body", QJ), puff("puffB")),
    merge(gone("body", QJ), puff("puffC")),
    gone("body", QJ),
  ]),
};
const asBeast = (c: Clip): Clip => ({ ...c });
// wolf walk: side keeps the diagonal-pair gait with a body bob and tail swing; front/back get a real
// stride (diagonal pairs swap between forward and back, the swinging pair lifts) plus bob and head sway
const gait = (sgn: number, swap: boolean): Pose => {
  const f = (swap ? -1 : 1) * 1.4 * sgn;
  const swing = (j: string): [string, V2] => [j, [0, f - 1]];
  const stance = (j: string): [string, V2] => [j, [0, -f]];
  return Object.fromEntries([swing("footFL"), swing("footBR"), stance("footFR"), stance("footBL")]);
};
const strideFrames = (sgn: number): Pose[] => [
  merge(gait(sgn, false), { body: [0, 0.3], head: [0.6, 0] }),
  { body: [0, -0.8], head: [0, -0.3] },
  merge(gait(sgn, true), { body: [0, 0.3], head: [-0.6, 0] }),
  { body: [0, -0.8], head: [0, -0.3] },
];
const qWalk: Clip = {
  id: "walk", fps: 7,
  frames: {
    side: (QUADRUPED_CLIPS[1].frames as { side: Pose[] }).side.map((p, i) => merge(p, { body: [0, i % 2 ? -0.8 : 0.4], tail: [i % 2 ? -1 : 0, p.tail?.[1] ?? 0] })),
    down: strideFrames(1),
    up: strideFrames(-1),
  },
};
export const BEAST_CLIPS: Clip[] = [asBeast(QUADRUPED_CLIPS[0]), qWalk, qAttack, qHurt, qDie];

// ---- undead family (humanoid joints)
const HJ = ["toolTip", "toolButt", "hip", "chest", "neck", "head", "shoulderL", "elbowL", "handL", "shoulderR", "elbowR", "handR", "kneeL", "footL", "kneeR", "footR"];
const hp = (v: View3, s: Spec) => pose(v, s, ["shoulderL", "elbowL", "handL", "kneeL", "footL"]);
const LEGS: [string, string][] = [["footL", "kneeL"], ["footR", "kneeR"]];
const plantH = (b: V2): Pose => Object.fromEntries(LEGS.flatMap(([f, k]) => [[f, [-b[0], -b[1]]], [k, [-b[0] / 2, -b[1] / 2]]]));
const uHurt: Clip = {
  id: "hurt", fps: 8,
  frames: perView((v) => [
    merge(hp(v, { chest: [-2, 0], head: [-2, 1], handL: [-1, 2, 1], handR: [-1, 2, 1] }), flashOn(HJ)),
    merge(hp(v, { hip: [-1, 0], chest: [-2, 0], head: [-2, -1], elbowL: [-1, 1, 1], handL: [-2, 3, 2], handR: [-2, 3, 2] }), plantH(fwd(v, -1, 0)), flashOn(HJ)),
    merge(hp(v, { chest: [-1, -1], head: [-1, -1] })),
    hp(v, { chest: [-1, 0] }),
  ]),
};
const uDie: Clip = {
  id: "die", fps: 8,
  frames: perView((v) => [
    merge(hp(v, { chest: [-2, 0], head: [-2, 1], handL: [-1, 2, 1], handR: [-1, 2, 1] }), flashOn(HJ)),
    merge(hp(v, { hip: [0, 4], chest: [-1, 1], head: [-2, 2], handL: [0, -3, 1], handR: [0, -3, 1] }), plantH([0, 4]), flashOn(HJ)),
    merge(gone("hip", HJ), puff("puffA")),
    merge(gone("hip", HJ), puff("puffB")),
    merge(gone("hip", HJ), puff("puffC")),
    gone("hip", HJ),
  ]),
};
const asUndead = (c: Clip): Clip => ({ ...c });
export const UNDEAD_CLIPS: Clip[] = [asUndead(HUMANOID_CLIPS.find((c) => c.id === "idle")!), asUndead(HUMANOID_CLIPS.find((c) => c.id === "walk")!), asUndead(HUMANOID_CLIPS.find((c) => c.id === "attack")!), uHurt, uDie];

export const BEAST_RIGS: RigDef[] = [WOLF_RIG];
export const UNDEAD_RIGS: RigDef[] = [SKELETON_RIG];

/** Every monster rig id with the slots that make its variant (for packs and docs). */
export const MONSTER_IDS = [...MONSTER_RIGS, ...BEAST_RIGS, ...UNDEAD_RIGS].map((r) => r.id);

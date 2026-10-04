// Humanoid rigs (slim / normal / stocky) on a 32 grid, plus swappable hair parts.
// Joint names follow HUMANOID_JOINTS (joints.ts) so shared clips and attachments fit.
// A standing figure spans y 2.4..29.5 (~84% of the canvas, see proportions(kit)).
import type { Attachment, PartDef, RigDef, View } from "../rig";
import { HUMANOID_JOINTS } from "./joints";

export type Build = "slim" | "normal" | "stocky";
export const HAIR_STYLES = ["short", "long", "spiky", "ponytail", "bald"] as const;
export type HairStyle = (typeof HAIR_STYLES)[number];

const BUILDS: Record<Build, { tw: number; leg: number; arm: number }> = {
  slim: { tw: 8, leg: 1.7, arm: 1.3 },
  normal: { tw: 10, leg: 2, arm: 1.5 },
  stocky: { tw: 12, leg: 2.4, arm: 1.8 },
};

export const AGES = ["baby", "kid", "young-adult", "senior", "elder"] as const;
export type Age = (typeof AGES)[number];
export const SEXES = ["male", "female"] as const;
export type Sex = (typeof SEXES)[number];

// Feet always land on y 28.5; the head keeps its size and its offset from the neck, so shorter
// ages simply sit lower. `leg`/`torso` are hip->foot and hip->neck lengths on the 32 grid,
// `arm` scales the limb lengths, `limb` their thickness, `stoop` leans head/chest forward in side view.
const AGE: Record<Age, { leg: number; torso: number; arm: number; limb: number; stoop: number; female: number }> = {
  baby: { leg: 2.6, torso: 4.6, arm: 0.55, limb: 1, stoop: 0, female: 0 },
  kid: { leg: 4.2, torso: 6.2, arm: 0.82, limb: 1, stoop: 0, female: 0.5 },
  "young-adult": { leg: 5.5, torso: 7.5, arm: 1, limb: 1, stoop: 0, female: 1 },
  senior: { leg: 5.3, torso: 7.2, arm: 0.98, limb: 0.95, stoop: 1.2, female: 1 },
  elder: { leg: 4.9, torso: 6.6, arm: 0.92, limb: 0.85, stoop: 2.2, female: 1 },
};

const v = (down: number[], side = down, up = down) => ({ down: down as [number, number], side: side as [number, number], up: up as [number, number] });

function joints(tw: number, age: Age, fem: number): RigDef["joints"] {
  const { leg, torso, arm, stoop } = AGE[age];
  const sx = tw / 2 + 1.5 - 0.8 * fem; // shoulder offset from the centre line (front/back views)
  const hipY = 28.5 - leg, kneeY = hipY + (3 * leg) / 5.5;
  const s = torso / 7.5;
  const chestY = hipY - 5 * s, neckY = hipY - torso, headY = neckY - 6.5;
  const shY = chestY, elY = shY + 3.5 * arm, haY = elY + 3 * arm;
  const cx = 16 + stoop * 0.4; // side-view lean
  const sideX = (k: number) => 16 + stoop * k;
  const J = (id: string, parent: string | null, rest: RigDef["joints"][number]["rest"]) => ({ id, parent, rest });
  const kx = tw / 4 + 0.3;
  return [
    J("hip", null, [16, hipY]),
    J("chest", "hip", v([16, chestY], [cx, chestY])),
    J("neck", "chest", v([16, neckY], [sideX(0.7), neckY])),
    J("head", "neck", v([16, headY], [sideX(1), headY])),
    J("shoulderL", "chest", v([16 - sx, shY], [cx, shY])),
    J("shoulderR", "chest", v([16 + sx, shY], [cx, shY])),
    J("elbowL", "shoulderL", v([16 - sx, elY], [cx, elY])),
    J("elbowR", "shoulderR", v([16 + sx, elY], [cx, elY])),
    J("handL", "elbowL", v([16 - sx, haY], [cx, haY])),
    J("handR", "elbowR", v([16 + sx, haY], [cx, haY])),
    J("kneeL", "hip", v([16 - kx, kneeY], [15, kneeY])),
    J("kneeR", "hip", v([16 + kx, kneeY], [17, kneeY])),
    J("footL", "kneeL", v([16 - kx, 28.5], [15, 28.5])),
    J("footR", "kneeR", v([16 + kx, 28.5], [17, 28.5])),
  ];
}

export function humanoidRig(build: Build, age: Age = "young-adult", sex: Sex = "male"): RigDef {
  const A = AGE[age];
  const fem = sex === "female" ? A.female : 0;
  const { tw, leg: leg0, arm: arm0 } = BUILDS[build];
  const leg = leg0 * A.limb * (1 - 0.08 * fem), arm = arm0 * A.limb * (1 - 0.12 * fem);
  const s = A.torso / 7.5;
  const trw = tw / 2 + 0.6 - 0.9 * fem; // torso half width
  const trs = tw * 0.4 + 0.6 - 0.5 * fem;
  const parts: PartDef[] = [
    // legs: far leg in side view is a separate, darker part behind the torso
    { id: "legL", kind: "limb", from: "hip", to: "footL", r: leg, slot: "bottom", z: 1, views: ["down", "up", "side"] },
    { id: "legRfar", kind: "limb", from: "hip", to: "footR", r: leg, slot: "bottom", tone: -1, z: 0, views: ["side"] },
    { id: "legR", kind: "limb", from: "hip", to: "footR", r: leg, slot: "bottom", z: 1, views: ["down", "up"] },
    { id: "bootL", kind: "box", joint: "footL", dx: -leg - 0.5, dy: -1.5, w: leg * 2 + 1, h: 3, slot: "boots", z: 1.5 },
    { id: "bootRfar", kind: "box", joint: "footR", dx: -leg - 0.5, dy: -1.5, w: leg * 2 + 1, h: 3, slot: "boots", tone: -1, z: 0, views: ["side"] },
    { id: "bootR", kind: "box", joint: "footR", dx: -leg - 0.5, dy: -1.5, w: leg * 2 + 1, h: 3, slot: "boots", z: 1.5, views: ["down", "up"] },
    // torso
    { id: "torso", kind: "ellipse", joint: "chest", dy: 2.4 * s, rx: trw, ry: 5.2 * s, flat: 0.45, slot: "top", z: 2, views: ["down", "up"] },
    { id: "torsoSide", kind: "ellipse", joint: "chest", dy: 2.4 * s, rx: trs, ry: 5.2 * s, flat: 0.45, slot: "top", z: 2, views: ["side"] },
    { id: "belt", kind: "box", joint: "chest", dx: -tw / 2, dy: 5.4 * s, w: tw, h: 1, slot: "boots", tone: 1, z: 2.5, views: ["down", "up"] },
    { id: "beltSide", kind: "box", joint: "chest", dx: -tw * 0.4, dy: 5.4 * s, w: tw * 0.8, h: 1, slot: "boots", tone: 1, z: 2.5, views: ["side"] },
    // arms (sleeve + hand); in side view the near arm is L, the far arm R sits behind the torso
    { id: "upperArmL", kind: "limb", from: "shoulderL", to: "elbowL", r: arm, slot: "top", z: 3 },
    { id: "foreArmL", kind: "limb", from: "elbowL", to: "handL", r: arm, slot: "top", z: 3 },
    { id: "handLp", kind: "ellipse", joint: "handL", dy: 0.6, rx: arm + 0.2, ry: arm + 0.2, slot: "skin", z: 3.1 },
    { id: "upperArmR", kind: "limb", from: "shoulderR", to: "elbowR", r: arm, slot: "top", z: 3, tone: 0, views: ["down", "up"] },
    { id: "foreArmR", kind: "limb", from: "elbowR", to: "handR", r: arm, slot: "top", z: 3, views: ["down", "up"] },
    { id: "handRp", kind: "ellipse", joint: "handR", dy: 0.6, rx: arm + 0.2, ry: arm + 0.2, slot: "skin", z: 3.1, views: ["down", "up"] },
    { id: "armRfar", kind: "limb", from: "shoulderR", to: "handR", r: arm, slot: "top", tone: -1, z: 1, views: ["side"] },
    // head: identical for every age and sex
    { id: "head", kind: "ellipse", joint: "head", rx: 7.2, ry: 6.6, slot: "skin", z: 4 },
  ];
  if (fem > 0) {
    // slightly wider hips, drawn in the trouser/skirt slot under the torso
    parts.push(
      { id: "hips", kind: "ellipse", joint: "hip", dy: -0.6, rx: tw / 2 + 0.4 + 1.5 * fem, ry: 2.6, flat: 0.4, slot: "bottom", z: 1.8, views: ["down", "up"] },
      { id: "hipsSide", kind: "ellipse", joint: "hip", dy: -0.6, rx: tw * 0.4 + 0.4 + 1 * fem, ry: 2.6, flat: 0.4, slot: "bottom", z: 1.8, views: ["side"] },
    );
  }
  const def = age === "young-adult" && sex === "male";
  return {
    id: def ? `humanoid-${build}` : `humanoid-${build}-${sex}-${age}`,
    name: def ? `Humanoid (${build})` : `Human ${sex} ${age} (${build})`,
    grid: 32,
    slots: { skin: "skin", hair: "hair", top: "cloth", bottom: "leather", boots: "wood", accent: "cloth2", helm: "metal" },
    joints: joints(tw, age, fem),
    parts,
  };
}

export const HUMANOID_RIGS: RigDef[] = (["slim", "normal", "stocky"] as Build[]).map((b) => humanoidRig(b));

/** The ten sex x age cores, normal build, ids `human-<sex>-<age>`. */
export const HUMAN_RIGS: RigDef[] = SEXES.flatMap((sex) =>
  AGES.map((age) => ({ ...humanoidRig("normal", age, sex), id: `human-${sex}-${age}`, name: `Human ${sex} ${age}` })),
);

/** Torso width on the design grid for a build (cape / collar / weapon placement). */
export const torsoWidth = (b: Build) => BUILDS[b].tw;

const H = (id: string, p: Omit<Extract<PartDef, { kind: "ellipse" }>, "id" | "kind" | "joint" | "slot" | "z"> & { z?: number; views?: View[] }): PartDef => ({
  id, kind: "ellipse", joint: "head", slot: "hair", z: 5, ...p,
});
const HB = (id: string, p: { dx: number; dy: number; w: number; h: number; views: View[]; z?: number }): PartDef => ({
  id, kind: "box", joint: "head", slot: "hair", z: 5, ...p,
});

/**
 * Hair as attachments so the style is swappable. `fringe` (-1/0/1) shifts the parting.
 * The face window is drawn after the hair crown so the forehead stays readable.
 */
export function hairAttachment(style: HairStyle, fringe: -1 | 0 | 1 = 0): Attachment {
  if (style === "bald") return { id: "hair-bald", name: "Bald", parts: [] };
  const crown: PartDef[] = [
    H("hair-crown-front", { dy: -2.6, rx: 7.4, ry: 4.6, views: ["down"] }),
    H("hair-crown-side", { dx: -1, dy: -1.5, rx: 7, ry: 5.2, views: ["side"] }),
    H("hair-crown-up", { rx: 7.4, ry: 6.8, views: ["up"] }),
    HB("hair-back", { dx: -7.2, dy: -2, w: 5, h: 7, views: ["side"] }),
    HB("hair-tuftL", { dx: -7.2, dy: -1, w: 2, h: 5, views: ["down"] }),
    HB("hair-tuftR", { dx: 5.2, dy: -1, w: 2, h: 5, views: ["down"] }),
    { id: "hair-face", kind: "ellipse", joint: "head", dx: fringe * 0.5, dy: 1, rx: 6, ry: 4.6, slot: "skin", z: 6, views: ["down"] },
    { id: "hair-fringe-shadow", kind: "box", joint: "head", dx: -3.5 + fringe * 0.5, dy: -2.4, w: 7, h: 1, slot: "skin", tone: -1, z: 6.1, views: ["down"] },
    { id: "hair-fringe-shadow-side", kind: "box", joint: "head", dx: 1, dy: -2.4, w: 6, h: 1, slot: "skin", tone: -1, z: 6.1, views: ["side"] },
    HB("hair-part-up", { dx: -0.5, dy: -6, w: 1, h: 5, views: ["up"], z: 5.2 }),
    HB("hair-nape-up", { dx: -5, dy: 3, w: 10, h: 1, views: ["up"], z: 5.2 }),
    HB("hair-band-up", { dx: -6, dy: 0, w: 12, h: 1, views: ["up"], z: 5.1 }),
    { id: "hair-face-side", kind: "ellipse", joint: "head", dx: 3.8, dy: 1.6, rx: 3.4, ry: 3.8, slot: "skin", z: 6, views: ["side"] },
  ];
  const extra: PartDef[] = [];
  if (style === "long") {
    extra.push(
      H("hair-long-up", { dy: 3, rx: 7.6, ry: 7.4, views: ["up"], z: 5 }),
      HB("hair-long-side", { dx: -7.2, dy: 0, w: 5, h: 9, views: ["side"] }),
      HB("hair-long-L", { dx: -8, dy: 1, w: 3, h: 8, views: ["down"], z: 6 }),
      HB("hair-long-R", { dx: 5, dy: 1, w: 3, h: 8, views: ["down"], z: 6 }),
    );
  } else if (style === "spiky") {
    [-5.6, -1.9, 1.9, 5.6].forEach((dx, i) => {
      const end = i === 0 || i === 3;
      extra.push(H(`hair-spike${i}`, { dx, dy: end ? -5.8 : -7.4, rx: 1.7, ry: end ? 3 : 3.5, views: ["down", "side", "up"], z: 5 }));
    });
  } else if (style === "ponytail") {
    extra.push(
      HB("hair-tail-up", { dx: -1, dy: 3, w: 2, h: 4, views: ["up"], z: 6 }),
      HB("hair-tail-side", { dx: -10, dy: -1, w: 3, h: 8, views: ["side"], z: 5 }),
    );
  }
  return { id: `hair-${style}`, name: `Hair (${style})`, parts: [...crown, ...extra] };
}

// guard: the joint contract must be fully defined
for (const r of HUMANOID_RIGS) {
  const ids = new Set(r.joints.map((j) => j.id));
  for (const j of HUMANOID_JOINTS) if (!ids.has(j)) throw new Error(`humanoid rig ${r.id} is missing joint ${j}`);
}

/**
 * Plain face for rigged humanoids (eyes, mouth). Drawn high in z so a hat brim never hides it;
 * the character generator adds its own seeded variant instead.
 */
export const FACE: Attachment = {
  id: "face",
  name: "Face",
  parts: [
    { id: "face-eyeL", kind: "box", joint: "head", dx: -3, dy: -1, w: 1, h: 2, slot: "ink", tone: -2, z: 30, views: ["down"] },
    { id: "face-eyeR", kind: "box", joint: "head", dx: 2, dy: -1, w: 1, h: 2, slot: "ink", tone: -2, z: 30, views: ["down"] },
    { id: "face-eyeSide", kind: "box", joint: "head", dx: 3, dy: -1, w: 1, h: 2, slot: "ink", tone: -2, z: 30, views: ["side"] },
    { id: "face-mouth", kind: "box", joint: "head", dx: -0.5, dy: 2, w: 1, h: 1, slot: "skin", tone: -2, z: 30, views: ["down"] },
  ],
};
/** Opt-out marker: a rigged humanoid with this attachment gets no default face. */
export const NO_FACE: Attachment = { id: "no-face", name: "No face", parts: [] };

/**
 * Female face cues as parts: an outer lash pixel per eye, two-pixel lips and cheek blush, plus a
 * hair bow for baby/kid (the only cue that survives a 4-tone kit on a head that is otherwise
 * identical). `ex` widens the eye spacing like the generator's seeded wide eyes.
 */
export function femaleCueParts(age: Age, z: number, ex = 0, withBlush = true): PartDef[] {
  const B = (id: string, o: Record<string, unknown>) => ({ id, kind: "box", joint: "head", z, ...o }) as PartDef;
  const P: PartDef[] = [
    B("fem-lashL", { dx: -4 - ex, dy: -2, w: 1, h: 1, slot: "ink", tone: -2, views: ["down"] }),
    B("fem-lashR", { dx: 3 + ex, dy: -2, w: 1, h: 1, slot: "ink", tone: -2, views: ["down"] }),
    B("fem-lashS", { dx: 4, dy: -2, w: 1, h: 1, slot: "ink", tone: -2, views: ["side"] }),
    B("fem-lips", { dx: -1, dy: 2, w: 2, h: 1, slot: "accent", tone: 0, views: ["down"] }),
    B("fem-lipsS", { dx: 5, dy: 2, w: 1, h: 1, slot: "accent", tone: 0, views: ["side"] }),
  ];
  if (withBlush)
    P.push(
      B("fem-blushL", { dx: -4 - ex, dy: 1, w: 1, h: 1, slot: "accent", tone: 1, views: ["down"] }),
      B("fem-blushR", { dx: 3 + ex, dy: 1, w: 1, h: 1, slot: "accent", tone: 1, views: ["down"] }),
    );
  if (age !== "baby")
    // side locks falling past the jaw: the one cue that survives a 4-tone kit at adult sizes
    P.push(
      B("fem-lockL", { dx: -8, dy: 0, w: 2, h: age === "kid" ? 5 : 7, slot: "hair", z: 5.5, views: ["down"] }),
      B("fem-lockR", { dx: 6, dy: 0, w: 2, h: age === "kid" ? 5 : 7, slot: "hair", z: 5.5, views: ["down"] }),
      B("fem-lockS", { dx: -8, dy: 0, w: 3, h: age === "kid" ? 6 : 8, slot: "hair", z: 5.5, views: ["side"] }),
      B("fem-lockU", { dx: -8, dy: 0, w: 16, h: age === "kid" ? 6 : 8, slot: "hair", z: 4.5, views: ["up"] }),
    );
  if (age === "baby" || age === "kid")
    P.push(
      B("fem-bowL", { dx: 0, dy: -8, w: 2, h: 2, slot: "accent", tone: 1, z: z + 1, views: ["down", "up"] }),
      B("fem-bowR", { dx: 3, dy: -8, w: 2, h: 2, slot: "accent", tone: 1, z: z + 1, views: ["down", "up"] }),
      B("fem-bowKnot", { dx: 2, dy: -7, w: 1, h: 1, slot: "accent", tone: -1, z: z + 1, views: ["down", "up"] }),
      B("fem-bowSide", { dx: -1, dy: -8, w: 3, h: 2, slot: "accent", tone: 1, z: z + 1, views: ["side"] }),
    );
  return P;
}

/** Face for female rigs; the bow follows the age encoded in the rig id. */
export function femaleFace(age: Age): Attachment {
  return { id: "face-female", name: "Face (female)", parts: [...FACE.parts, ...femaleCueParts(age, 30)] };
}

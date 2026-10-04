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

const v = (down: number[], side = down, up = down) => ({ down: down as [number, number], side: side as [number, number], up: up as [number, number] });

function joints(tw: number): RigDef["joints"] {
  const sx = tw / 2 + 1.5; // shoulder offset from the centre line (front/back views)
  const J = (id: string, parent: string | null, rest: RigDef["joints"][number]["rest"]) => ({ id, parent, rest });
  return [
    J("hip", null, [16, 23]),
    J("chest", "hip", [16, 18]),
    J("neck", "chest", [16, 15.5]),
    J("head", "neck", [16, 9]),
    J("shoulderL", "chest", v([16 - sx, 18], [16, 18])),
    J("shoulderR", "chest", v([16 + sx, 18], [16, 18])),
    J("elbowL", "shoulderL", v([16 - sx, 21.5], [16, 21.5])),
    J("elbowR", "shoulderR", v([16 + sx, 21.5], [16, 21.5])),
    J("handL", "elbowL", v([16 - sx, 24.5], [16, 24.5])),
    J("handR", "elbowR", v([16 + sx, 24.5], [16, 24.5])),
    J("kneeL", "hip", v([16 - tw / 4 - 0.3, 26], [15, 26])),
    J("kneeR", "hip", v([16 + tw / 4 + 0.3, 26], [17, 26])),
    J("footL", "kneeL", v([16 - tw / 4 - 0.3, 28.5], [15, 28.5])),
    J("footR", "kneeR", v([16 + tw / 4 + 0.3, 28.5], [17, 28.5])),
  ];
}

export function humanoidRig(build: Build): RigDef {
  const { tw, leg, arm } = BUILDS[build];
  const parts: PartDef[] = [
    // legs: far leg in side view is a separate, darker part behind the torso
    { id: "legL", kind: "limb", from: "hip", to: "footL", r: leg, slot: "bottom", z: 1, views: ["down", "up", "side"] },
    { id: "legRfar", kind: "limb", from: "hip", to: "footR", r: leg, slot: "bottom", tone: -1, z: 0, views: ["side"] },
    { id: "legR", kind: "limb", from: "hip", to: "footR", r: leg, slot: "bottom", z: 1, views: ["down", "up"] },
    { id: "bootL", kind: "box", joint: "footL", dx: -leg - 0.5, dy: -1.5, w: leg * 2 + 1, h: 3, slot: "boots", z: 1.5 },
    { id: "bootRfar", kind: "box", joint: "footR", dx: -leg - 0.5, dy: -1.5, w: leg * 2 + 1, h: 3, slot: "boots", tone: -1, z: 0, views: ["side"] },
    { id: "bootR", kind: "box", joint: "footR", dx: -leg - 0.5, dy: -1.5, w: leg * 2 + 1, h: 3, slot: "boots", z: 1.5, views: ["down", "up"] },
    // torso
    { id: "torso", kind: "ellipse", joint: "chest", dy: 2.4, rx: tw / 2 + 0.6, ry: 5.2, flat: 0.45, slot: "top", z: 2, views: ["down", "up"] },
    { id: "torsoSide", kind: "ellipse", joint: "chest", dy: 2.4, rx: tw * 0.4 + 0.6, ry: 5.2, flat: 0.45, slot: "top", z: 2, views: ["side"] },
    { id: "belt", kind: "box", joint: "chest", dx: -tw / 2, dy: 5.4, w: tw, h: 1, slot: "boots", tone: 1, z: 2.5, views: ["down", "up"] },
    { id: "beltSide", kind: "box", joint: "chest", dx: -tw * 0.4, dy: 5.4, w: tw * 0.8, h: 1, slot: "boots", tone: 1, z: 2.5, views: ["side"] },
    // arms (sleeve + hand); in side view the near arm is L, the far arm R sits behind the torso
    { id: "upperArmL", kind: "limb", from: "shoulderL", to: "elbowL", r: arm, slot: "top", z: 3 },
    { id: "foreArmL", kind: "limb", from: "elbowL", to: "handL", r: arm, slot: "top", z: 3 },
    { id: "handLp", kind: "ellipse", joint: "handL", dy: 0.6, rx: arm + 0.2, ry: arm + 0.2, slot: "skin", z: 3.1 },
    { id: "upperArmR", kind: "limb", from: "shoulderR", to: "elbowR", r: arm, slot: "top", z: 3, tone: 0, views: ["down", "up"] },
    { id: "foreArmR", kind: "limb", from: "elbowR", to: "handR", r: arm, slot: "top", z: 3, views: ["down", "up"] },
    { id: "handRp", kind: "ellipse", joint: "handR", dy: 0.6, rx: arm + 0.2, ry: arm + 0.2, slot: "skin", z: 3.1, views: ["down", "up"] },
    { id: "armRfar", kind: "limb", from: "shoulderR", to: "handR", r: arm, slot: "top", tone: -1, z: 1, views: ["side"] },
    // head
    { id: "head", kind: "ellipse", joint: "head", rx: 7.2, ry: 6.6, slot: "skin", z: 4 },
  ];
  return {
    id: `humanoid-${build}`,
    name: `Humanoid (${build})`,
    grid: 32,
    slots: { skin: "skin", hair: "hair", top: "cloth", bottom: "leather", boots: "wood", accent: "cloth2", helm: "metal" },
    joints: joints(tw),
    parts,
  };
}

export const HUMANOID_RIGS: RigDef[] = (["slim", "normal", "stocky"] as Build[]).map(humanoidRig);

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

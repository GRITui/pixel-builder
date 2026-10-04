import { finalize } from "../enforce";
import { KIT_PRESETS } from "../kit";
import { buildLegend } from "../legend";
import { Painter } from "../painter";
import { colorIndex, type Material } from "../palette";
import { clipFrames, renderRig, type Attachment, type Clip, type PartDef } from "../rig";
import { HUMANOID_RIGS, humanoidRig, femaleCueParts, diagFaceParts, AGES, torsoWidth, type Age, type Build, type Sex } from "../rigs/humanoid";
import { attachmentById, clipById } from "../rigs";
import { WALK } from "../rigs/example";
import { hairStyleAttachment } from "../rigs/wardrobe";
import { rng, type Rng } from "../rng";
import type { FrameSet, Sprite, StyleKit } from "../types";
import { bool, mat, PAINT, str, type Generator, type Params } from "./types";

type Dir = "down" | "up" | "left" | "right";
const DIRS: Dir[] = ["down", "left", "right", "up"];
const SKINS: Material[] = ["skin", "sand", "wood", "stone", "foliage", "metal", "accent"];

/**
 * Small seeded details layered on top of the explicit params, so "same params,
 * new seed" gives a sibling character rather than an identical copy. Picked
 * once per asset so every direction and frame agrees.
 */
interface Traits {
  fringe: -1 | 0 | 1;
  wideEyes: boolean;
  blush: boolean;
  collar: boolean;
  beltTone: number;
}

function rollTraits(r: Rng): Traits {
  return { fringe: r.pick([-1, 0, 1] as const), wideEyes: r.chance(0.4), blush: r.chance(0.3), collar: r.chance(0.4), beltTone: r.pick([0, -1, 1]) };
}

const WALK_FRAMES = 4;

function walkClip(): Clip {
  const reg = clipById("walk", "humanoid")?.clip;
  const ok = reg && (["down", "side", "up"] as const).every((v) => clipFrames(reg, v).length === WALK_FRAMES);
  return ok ? reg : WALK;
}

const attach = (id: string): Attachment | undefined => attachmentById(id)?.attachment;

/** Fallback parts used when the shared attachment catalog has no entry for an id. */
function fallbackHeadwear(hat: string): PartDef[] {
  const E = (id: string, o: Record<string, unknown>) => ({ id, kind: "ellipse", joint: "head", z: 4, ...o }) as PartDef;
  const B = (id: string, o: Record<string, unknown>) => ({ id, kind: "box", joint: "head", z: 4, ...o }) as PartDef;
  if (hat === "helmet")
    return [
      E("helm-dome", { dy: -1.5, rx: 7.8, ry: 5.6, slot: "helm", views: ["down", "side"] }),
      E("helm-dome-up", { dy: -0.5, rx: 7.8, ry: 6.9, slot: "helm", views: ["up"] }),
      E("helm-face", { dy: 1.2, rx: 5.8, ry: 4.2, slot: "skin", z: 9, views: ["down"] }),
      E("helm-face-side", { dx: 3.8, dy: 1.6, rx: 3.4, ry: 3.6, slot: "skin", z: 9, views: ["side"] }),
    ];
  if (hat === "hood")
    return [
      E("hood-shell", { dy: -0.5, rx: 8.2, ry: 7.2, slot: "accent" }),
      E("hood-rim", { dy: 1.5, rx: 5.6, ry: 4.8, slot: "accent", tone: -2, z: 9, views: ["down"] }),
      E("hood-face", { dy: 1.8, rx: 4.6, ry: 3.9, slot: "skin", tone: -1, z: 10, views: ["down"] }),
      E("hood-rim-side", { dx: 3.5, dy: 1.5, rx: 3.2, ry: 4.2, slot: "accent", tone: -2, z: 9, views: ["side"] }),
      E("hood-face-side", { dx: 3.8, dy: 1.8, rx: 2.4, ry: 3.3, slot: "skin", tone: -1, z: 10, views: ["side"] }),
    ];
  if (hat === "wizard-hat")
    return [
      E("wiz-brim", { dy: -3.5, rx: 9.5, ry: 2, flat: 0.4, slot: "accent" }),
      E("wiz-1", { dy: -5.5, rx: 6, ry: 2.6, slot: "accent", z: 4.1 }),
      E("wiz-2", { dy: -7.5, rx: 4.2, ry: 2.2, slot: "accent", z: 10 }),
      E("wiz-3", { dy: -9, rx: 2.2, ry: 1.7, slot: "accent", z: 11 }),
    ];
  if (hat === "crown")
    return [
      B("crown-band", { dx: -5, dy: -7, w: 10, h: 3, slot: "gold" }),
      B("crown-pt-a", { dx: -5, dy: -9, w: 2, h: 2, slot: "gold", tone: 1 }),
      B("crown-pt-b", { dx: -1, dy: -9, w: 2, h: 2, slot: "gold", tone: 1 }),
      B("crown-pt-c", { dx: 3, dy: -9, w: 2, h: 2, slot: "gold", tone: 1 }),
      B("crown-gem", { dx: -0.5, dy: -6, w: 1, h: 1, slot: "cloth2", tone: 1, z: 9, views: ["down"] }),
    ];
  return [];
}

function fallbackItem(item: string, tw: number): PartDef[] {
  // held in the viewer-right hand from the front, the near (L) hand from the side
  const both = (id: string, o: Record<string, unknown>): PartDef[] =>
    (["handR", "handL"] as const).map((joint) => ({ id: `${id}-${joint}`, kind: "box", joint, z: 4, views: joint === "handR" ? ["down"] : ["side"], ...o }) as PartDef);
  if (item === "sword")
    return [...both("sword-blade", { dx: -1, dy: -10, w: 2, h: 10, slot: "metal", tone: 1 }), ...both("sword-guard", { dx: -2, dy: -0.5, w: 4, h: 1, slot: "gold", z: 4.1 })];
  if (item === "staff")
    return [
      ...both("staff-shaft", { dx: -0.75, dy: -12, w: 1.5, h: 18, slot: "wood" }),
      ...(["handR", "handL"] as const).map((joint) => ({ id: `staff-gem-${joint}`, kind: "ellipse", joint, dy: -13, rx: 2.2, ry: 2.2, slot: "accent", z: 4.1, views: joint === "handR" ? ["down"] : ["side"] }) as PartDef),
    ];
  if (item === "shield")
    return (["handL"] as const).flatMap((joint) => [
      { id: "shield-face", kind: "ellipse", joint, dx: -0.5, dy: -2, rx: 3.5, ry: 4.5, flat: 0.3, slot: "metal", z: 4, views: ["down", "side"] } as PartDef,
      { id: "shield-boss", kind: "ellipse", joint, dx: -0.5, dy: -2, rx: 1.5, ry: 2.5, flat: 0.3, slot: "accent", z: 4.1, views: ["down", "side"] } as PartDef,
    ]);
  if (item === "bow")
    return (["handR", "handL"] as const).map((joint) => ({
      id: `bow-${joint}`, kind: "pixels", joint, anchor: [0, 7], z: 4, views: joint === "handR" ? ["down"] : ["side"],
      rows: ["...w", "..w.", ".w..", ".w..", "w...", "w...", "w...", "w...", "w...", ".w..", ".w..", "..w.", "...w"].map((r) => r.replace(/w/g, WOOD)),
    }) as PartDef);
  void tw;
  return [];
}
const WOOD = buildLegend(KIT_PRESETS[0]).byIndex.get(colorIndex("wood", 3)) ?? "w";

/** Seeded face / trim details, drawn above hats so eyes always show. */
function detailParts(t: Traits, tw: number, size: number, eyeZ: number, fem?: Age): PartDef[] {
  const ex = t.wideEyes ? 1 : 0;
  const big = size >= 32;
  const P: PartDef[] = [
    { id: "eyeL", kind: "box", joint: "head", dx: -3 - ex, dy: -1, w: 1, h: 2, slot: "ink", tone: -2, z: eyeZ, views: ["down"] },
    { id: "eyeR", kind: "box", joint: "head", dx: 2 + ex, dy: -1, w: 1, h: 2, slot: "ink", tone: -2, z: eyeZ, views: ["down"] },
    { id: "eyeSide", kind: "box", joint: "head", dx: 3, dy: -1, w: 1, h: 2, slot: "ink", tone: -2, z: eyeZ, views: ["side"], noDiag: true },
    ...diagFaceParts(eyeZ, ex, !fem),
  ];
  if (fem) {
    // female cues: lashes, lips, always-on blush and a bow for the young (replace the neutral mouth)
    P.push(...femaleCueParts(fem, eyeZ, ex, big));
  } else P.push({ id: "mouth", kind: "box", joint: "head", dx: -0.5, dy: 2, w: 1, h: 1, slot: "skin", tone: -2, z: eyeZ, views: ["down"] });
  if (big) {
    if (t.blush && !fem) {
      P.push(
        { id: "blushL", kind: "box", joint: "head", dx: -4 - ex, dy: 1, w: 1, h: 1, slot: "cloth2", tone: 1, z: eyeZ, views: ["down"] },
        { id: "blushR", kind: "box", joint: "head", dx: 3 + ex, dy: 1, w: 1, h: 1, slot: "cloth2", tone: 1, z: eyeZ, views: ["down"] },
        { id: "blushS", kind: "box", joint: "head", dx: 4, dy: 1, w: 1, h: 1, slot: "cloth2", tone: 1, z: eyeZ, views: ["side"], noDiag: true },
      );
    }
  }
  if (t.collar) {
    P.push({ id: "collar", kind: "box", joint: "chest", dx: -tw / 2 + 1, dy: -1, w: tw - 2, h: 1, slot: "accent", normal: [0, -0.5, 0.8], z: 3.5, views: ["down"] });
    P.push({ id: "collarSide", kind: "box", joint: "chest", dx: -tw * 0.4 + 1, dy: -1, w: tw * 0.8 - 2, h: 1, slot: "accent", normal: [0, -0.5, 0.8], z: 3.5, views: ["side"] });
  }
  P.push({ id: "belt", kind: "box", joint: "chest", dx: -tw / 2, dy: 5.4, w: tw, h: 1, slot: "boots", tone: 2 + t.beltTone, z: 2.5, views: ["down", "up"] });
  P.push({ id: "beltSide", kind: "box", joint: "chest", dx: -tw * 0.4, dy: 5.4, w: tw * 0.8, h: 1, slot: "boots", tone: 2 + t.beltTone, z: 2.5, views: ["side"] });
  P.push({ id: "buckle", kind: "box", joint: "chest", dx: -0.5, dy: 5.4, w: 1, h: 1, slot: "gold", tone: 1, z: 2.6, views: ["down"] });
  return P;
}

function capeParts(tw: number): PartDef[] {
  return [
    { id: "capeL", kind: "box", joint: "chest", dx: -tw / 2 - 1.5, dy: 1, w: 2, h: 10, slot: "accent", normal: [-0.5, 0, 0.8], z: -1, views: ["down"] },
    { id: "capeR", kind: "box", joint: "chest", dx: tw / 2 - 0.5, dy: 1, w: 2, h: 10, slot: "accent", normal: [0.5, 0, 0.8], z: -1, views: ["down"] },
    { id: "capeBack", kind: "ellipse", joint: "chest", dx: 0, dy: 4.5, rx: tw / 2 + 1.8, ry: 7, flat: 0.35, slot: "accent", z: 2.7, views: ["up"] },
    { id: "capeSide", kind: "ellipse", joint: "chest", dx: -tw * 0.4 - 1.2, dy: 4.5, rx: 2.8, ry: 6.5, flat: 0.3, slot: "accent", z: -1, views: ["side"] },
  ];
}

const HEADWEAR_ID: Record<string, string> = {
  helmet: "helmet", hood: "hood", wizard: "wizard-hat", crown: "crown",
  "straw-hat": "straw-hat", "ngob-hat": "ngob-hat", cap: "hat-cap", bonnet: "hat-bonnet", bandana: "hat-bandana", beanie: "hat-beanie",
};
/** Wardrobe layers: the param value maps to an attachment id with this prefix. */
const WARDROBE_HATS = new Set(["cap", "bonnet", "bandana", "beanie"]);
const LAYER_PARAMS: [string, string][] = [["facial", "face-"], ["costume", "costume-"], ["bag", "bag-"]];

/**
 * Top-down "chibi" RPG character on the humanoid rig: 4-direction, 4-frame
 * walk cycle. Hair, headwear and held items are attachments on rig joints.
 */
function drawHumanoid(p: Params, kit: StyleKit, size: number, t: Traits): FrameSet[] {
  const build = str(p, "build") as Build;
  const sex = str(p, "sex"), age = str(p, "age");
  const rig = sex === "male" && age === "young-adult"
    ? HUMANOID_RIGS.find((r) => r.id === `humanoid-${build}`) ?? HUMANOID_RIGS[1]
    : humanoidRig(build, age as Age, sex as Sex);
  const tw = torsoWidth(build);
  const hat = str(p, "headwear"), weapon = str(p, "weapon");
  const accent = mat(p, "accent_mat");
  // helmet keeps its metal look unless the user picked an accent material (#11)
  const helmMat: Material = accent === "cloth2" ? "metal" : accent;
  const slots: Record<string, Material> = {
    skin: mat(p, "skin"), hair: mat(p, "hair"), top: mat(p, "top"), bottom: mat(p, "bottom"), boots: mat(p, "boots"), accent, helm: helmMat,
  };
  const atts: Attachment[] = [hairStyleAttachment(str(p, "hair_style"), t.fringe)];
  if (bool(p, "cape")) atts.push({ id: "cape", name: "Cape", parts: capeParts(tw) });

  const pushShared = (id: string | undefined, fallback: PartDef[], remapMetalTo?: string) => {
    const shared = id ? attach(id) : undefined;
    const parts = shared ? shared.parts.map((q) => (remapMetalTo && q.slot === "metal" ? { ...q, slot: remapMetalTo } : q)) : fallback;
    // keep the attachment's own joints (tool tips) so its limb parts can resolve them
    if (parts.length) atts.push({ id: id ?? "extra", name: id ?? "extra", parts, joints: shared?.joints });
  };
  if (hat !== "none") pushShared(HEADWEAR_ID[hat], fallbackHeadwear(HEADWEAR_ID[hat]), hat === "helmet" ? "helm" : undefined);
  if (weapon !== "none") pushShared(weapon, fallbackItem(weapon, tw));
  for (const [key, prefix] of LAYER_PARAMS) {
    const v = p[key] === undefined ? "none" : str(p, key);
    if (v === "none") continue;
    const a = attach(v === "basket" ? v : prefix + v);
    if (a) atts.push(a);
  }
  atts.push({ id: "details", name: "Seeded details", parts: detailParts(t, tw, size, hat !== "none" && (!attach(HEADWEAR_ID[hat]) || WARDROBE_HATS.has(hat)) ? 30 : 7, sex === "female" ? (age as Age) : undefined) });

  return renderRig({ rig, kit, slots, attachments: atts, size }, [walkClip()], { directions: str(p, "directions") === "8" ? 8 : 4 });
}

function drawSlime(p: Params, kit: StyleKit, dir: Dir, frame: number, size: number, _t: Traits): Sprite {
  const P = new Painter(size, size, kit);
  const k = size / 32;
  const body = mat(p, "skin");
  const squash = [0, 1.5, 0, -1.5][frame];
  const rx = (10 + squash) * k, ry = (8 - squash) * k;
  const cy = size - ry - 2 * k;
  P.ellipse(size / 2, cy, rx, ry, body, { flat: 0.1 });
  P.ellipse(size / 2 - rx * 0.4 * -P.lightSide, cy - ry * 0.5, Math.max(1, rx * 0.2), Math.max(1, ry * 0.2), body, { tone: 2 });
  if (dir !== "up") {
    const ex = dir === "left" ? -3 : dir === "right" ? 3 : 0;
    P.rect(Math.round(size / 2 + (ex - 3) * k), Math.round(cy - 1 * k), Math.max(1, Math.round(k)), Math.max(1, Math.round(2 * k)), "ink", 0);
    P.rect(Math.round(size / 2 + (ex + 3) * k), Math.round(cy - 1 * k), Math.max(1, Math.round(k)), Math.max(1, Math.round(2 * k)), "ink", 0);
  }
  return finalize(P.toSprite(), kit);
}

export const characterGenerator: Generator = {
  id: "character",
  category: "character",
  label: "Character",
  description: "Top-down RPG character (humanoid or slime) with 4-direction walk animation. Choose materials for skin, hair, clothes; headwear and weapon.",
  params: [
    { key: "archetype", label: "Archetype", type: "select", options: ["humanoid", "slime"], default: "humanoid" },
    { key: "build", label: "Build", type: "select", options: ["slim", "normal", "stocky"], default: "normal" },
    { key: "sex", label: "Sex", type: "select", options: ["male", "female"], default: "male" },
    { key: "age", label: "Age", type: "select", options: [...AGES], default: "young-adult" },
    { key: "skin", label: "Skin / body", type: "material", options: SKINS, default: "skin" },
    { key: "hair", label: "Hair", type: "material", options: PAINT, default: "hair" },
    { key: "hair_style", label: "Hair style", type: "select", options: ["short", "long", "spiky", "ponytail", "bald", "bun", "braids", "pigtails", "bob"], default: "short" },
    { key: "top", label: "Top", type: "material", options: PAINT, default: "cloth" },
    { key: "bottom", label: "Bottom", type: "material", options: PAINT, default: "leather" },
    { key: "boots", label: "Boots / belt", type: "material", options: PAINT, default: "wood" },
    { key: "headwear", label: "Headwear", type: "select", options: ["none", "helmet", "hood", "wizard", "crown", "straw-hat", "ngob-hat", "cap", "bonnet", "bandana", "beanie"], default: "none" },
    { key: "facial", label: "Facial detail", type: "select", options: ["none", "beard", "mustache", "glasses", "freckles", "wrinkles"], default: "none" },
    { key: "costume", label: "Costume", type: "select", options: ["none", "overalls", "dress", "apron", "sarong", "smock", "sweater"], default: "none" },
    { key: "bag", label: "Bag", type: "select", options: ["none", "backpack", "satchel", "tote", "basket"], default: "none" },
    { key: "weapon", label: "Held item", type: "select", options: ["none", "sword", "staff", "shield", "bow"], default: "none" },
    { key: "accent_mat", label: "Accent (cape, hat, gem)", type: "material", options: PAINT, default: "cloth2" },
    { key: "cape", label: "Cape", type: "bool", default: false },
    { key: "directions", label: "Directions (4, or 8 with 3/4 diagonals)", type: "select", options: ["4", "8"], default: "4" },
  ],
  generate(p, kit, seed) {
    const traits = rollTraits(rng(seed));
    const size = kit.sizes.character;
    if (str(p, "archetype") !== "slime") return { rows: drawHumanoid(p, kit, size, traits), fps: 6 };
    const rows: FrameSet[] = DIRS.map((d) => ({ name: `walk-${d}`, frames: [0, 1, 2, 3].map((f) => drawSlime(p, kit, d, f, size, traits)) }));
    return { rows, fps: 6 };
  },
};

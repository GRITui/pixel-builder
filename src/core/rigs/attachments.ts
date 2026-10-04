// Attachment catalog for humanoid joints (issue #5). Joints follow the contract in joints.ts;
// coordinates are on the 32 design grid, relative to the joint. Materials are literal ramps
// (leather, metal, ...) so users recolour through the kit; volumes are lit, never hand-shaded.
// Held items stand upright on the hand (a box can't tilt) and every part rides its joint,
// so they follow every pose and mirror for "left" automatically.
import type { Attachment, Joint, PartDef, View } from "../rig";
import type { Material } from "../palette";

type Box = { id: string; joint: string; dx: number; dy: number; w: number; h: number; slot: Material; z: PartDef["z"]; tone?: number; views?: PartDef["views"] };
const box = (b: Box): PartDef => ({ kind: "box", ...b });
type Ell = { id: string; joint: string; dx?: number; dy?: number; rx: number; ry: number; slot: Material; z: PartDef["z"]; tone?: number; flat?: number; views?: PartDef["views"] };
const ell = (e: Ell): PartDef => ({ kind: "ellipse", ...e });

/** Hat parts sit in front of the hair (z 5) and face (z 6, eyes z 7). */
const HZ = 8;
const HELD = 4; // held items draw over the arm (z 3) in every view

const headwear: Attachment[] = [
  {
    id: "ngob-hat",
    name: "Conical straw hat (non la)",
    // a modest cone that sits on the head: brim barely wider than the skull so it never reads as an umbrella
    parts: [
      ell({ id: "hat-brim", joint: "head", dy: -2.6, rx: 8.5, ry: 2.2, slot: "sand", flat: 0.6, z: HZ }),
      ell({ id: "hat-cone1", joint: "head", dy: -3.7, rx: 6.6, ry: 2.2, slot: "sand", flat: 0.45, z: HZ + 1 }),
      ell({ id: "hat-cone2", joint: "head", dy: -4.8, rx: 4.3, ry: 1.8, slot: "sand", flat: 0.35, z: HZ + 2 }),
      ell({ id: "hat-cone3", joint: "head", dy: -5.7, rx: 2.1, ry: 1.3, slot: "sand", flat: 0.2, z: HZ + 3 }),
      box({ id: "hat-strap", joint: "head", dx: -0.5, dy: -1, w: 1, h: 4, slot: "cloth2", z: HZ - 1, views: ["down"] }),
    ],
  },
  {
    id: "straw-hat",
    name: "Straw hat",
    parts: [
      ell({ id: "hat-brim", joint: "head", dy: -2.8, rx: 8.8, ry: 2.2, slot: "sand", flat: 0.5, z: HZ }),
      ell({ id: "hat-crown", joint: "head", dy: -4.6, rx: 5.2, ry: 3.2, slot: "sand", z: HZ + 1 }),
      ell({ id: "hat-band", joint: "head", dy: -3.2, rx: 5.3, ry: 1.1, slot: "cloth2", flat: 0.5, z: HZ + 2 }),
    ],
  },
  {
    id: "helmet",
    name: "Helmet",
    parts: [
      ell({ id: "helm-dome", joint: "head", dy: -4.2, rx: 7.6, ry: 3.2, slot: "metal", z: HZ }),
      box({ id: "helm-rim", joint: "head", dx: -7.3, dy: -2, w: 15, h: 1.5, slot: "metal", tone: -1, z: HZ + 1, views: ["down", "up"] }),
      box({ id: "helm-rim-side", joint: "head", dx: -7, dy: -2, w: 14, h: 1.5, slot: "metal", tone: -1, z: HZ + 1, views: ["side"] }),
      box({ id: "helm-crest", joint: "head", dx: -0.5, dy: -8.2, w: 1.5, h: 2, slot: "accent", z: HZ + 1 }),
      // back of the helmet drops over the nape
      ell({ id: "helm-nape", joint: "head", dy: -1.5, rx: 7.2, ry: 5.2, slot: "metal", tone: -1, z: 3, views: ["up", "side"] }),
    ],
  },
  {
    id: "hood",
    name: "Hood",
    parts: [
      ell({ id: "hood-back", joint: "head", dy: -0.2, rx: 8.2, ry: 7.6, slot: "cloth", tone: -1, z: 3.5 }),
      ell({ id: "hood-top", joint: "head", dy: -3.8, rx: 7.8, ry: 3.4, slot: "cloth", z: HZ, views: ["down", "side"] }),
      ell({ id: "hood-all", joint: "head", dy: -0.2, rx: 8, ry: 7.4, slot: "cloth", z: HZ, views: ["up"] }),
      ell({ id: "hood-drape", joint: "neck", dy: 1.2, rx: 7, ry: 2, slot: "cloth", tone: -1, z: 3.2 }),
    ],
  },
  {
    id: "wizard-hat",
    name: "Wizard hat",
    parts: [
      ell({ id: "hat-brim", joint: "head", dy: -3, rx: 9, ry: 2, slot: "cloth2", flat: 0.5, z: HZ }),
      ell({ id: "hat-cone1", joint: "head", dy: -4.3, rx: 5.2, ry: 2.1, slot: "cloth2", z: HZ + 1 }),
      ell({ id: "hat-cone2", joint: "head", dx: 0.3, dy: -5.6, rx: 3.6, ry: 1.8, slot: "cloth2", z: HZ + 2 }),
      ell({ id: "hat-cone3", joint: "head", dx: 0.8, dy: -6.6, rx: 2.2, ry: 1.3, slot: "cloth2", z: HZ + 3 }),
      ell({ id: "hat-tip", joint: "head", dx: 1.6, dy: -7.2, rx: 1.1, ry: 0.9, slot: "cloth2", tone: 1, z: HZ + 4 }),
      ell({ id: "hat-band", joint: "head", dy: -3.8, rx: 5.2, ry: 0.9, slot: "gold", flat: 0.5, z: HZ + 5 }),
    ],
  },
  {
    id: "crown",
    name: "Crown",
    parts: [
      box({ id: "crown-band", joint: "head", dx: -4.5, dy: -6.3, w: 9, h: 2.4, slot: "gold", z: HZ }),
      box({ id: "crown-p1", joint: "head", dx: -4.5, dy: -8.3, w: 2, h: 2.2, slot: "gold", z: HZ }),
      box({ id: "crown-p2", joint: "head", dx: -1, dy: -9, w: 2, h: 2.8, slot: "gold", z: HZ }),
      box({ id: "crown-p3", joint: "head", dx: 2.5, dy: -8.3, w: 2, h: 2.2, slot: "gold", z: HZ }),
      box({ id: "crown-gem", joint: "head", dx: -0.5, dy: -5.9, w: 1.5, h: 1.5, slot: "accent", z: HZ + 1, views: ["down", "side"] }),
    ],
  },
];


/**
 * Held tools. The shaft is a limb handR -> toolTip, so a clip posing `toolTip`
 * (and `bowLow`/`rodLine`) swings the tool; tips are absolute rests, tuned on the
 * normal build (handR x 22.5 in front/back, 16 in profile). `toolButt` is the
 * grip end behind the hand. In the up view the tool sits behind the body.
 */
const HAND_X = { down: 22.5, side: 16, up: 22.5 } as const;
const HAND_Y = 24.5;
type D = [number, number];
const at = (dx: Partial<Record<View, D>> & { down: D }): Joint["rest"] => {
  const out = {} as Record<View, [number, number]>;
  for (const v of ["down", "side", "up"] as View[]) {
    const d = dx[v] ?? dx.down;
    out[v] = [HAND_X[v] + d[0], HAND_Y + d[1]];
  }
  return out;
};
const tipJ = (tip: Partial<Record<View, D>> & { down: D }, butt?: Partial<Record<View, D>> & { down: D }): Joint[] => [
  { id: "toolTip", parent: "handR", rest: at(tip) },
  ...(butt ? [{ id: "toolButt", parent: "handR", rest: at(butt) }] : []),
];
const TZ: PartDef["z"] = { down: HELD, side: HELD, up: 1.6 };
const shaft = (id: string, from: string, to: string, r: number, slot: Material, tone?: number): PartDef => ({ kind: "limb", id, from, to, r, slot, tone, z: TZ });
const tipBox = (b: Omit<Box, "z" | "joint">): PartDef => box({ ...b, joint: "toolTip", z: { down: HELD + 0.1, side: HELD + 0.1, up: 1.7 } });
const tipEll = (e: Omit<Ell, "z" | "joint">): PartDef => ell({ ...e, joint: "toolTip", z: { down: HELD + 0.1, side: HELD + 0.1, up: 1.7 } });

const held: Attachment[] = [
  {
    id: "hoe",
    name: "Hoe",
    joints: tipJ({ down: [1.5, -14], side: [3, -14] }, { down: [-0.5, 3], side: [-1, 3] }),
    parts: [
      shaft("hoe-handle", "toolButt", "toolTip", 0.8, "wood"),
      tipBox({ id: "hoe-blade", dx: -1.5, dy: -1, w: 4, h: 2.5, slot: "metal" }),
      tipBox({ id: "hoe-edge", dx: 1.5, dy: 1, w: 1.5, h: 2, slot: "metal", tone: -1 }),
    ],
  },
  {
    id: "sickle",
    name: "Sickle",
    joints: tipJ({ down: [1.5, -8], side: [3, -8] }, { down: [0, 2], side: [-0.5, 2] }),
    parts: [
      shaft("sickle-handle", "toolButt", "toolTip", 0.8, "wood"),
      tipBox({ id: "sickle-blade", dx: -0.5, dy: -1.5, w: 4, h: 1.5, slot: "metal" }),
      tipBox({ id: "sickle-tip", dx: 2.5, dy: -0.5, w: 1.5, h: 2.5, slot: "metal", tone: 1 }),
    ],
  },
  {
    id: "sword",
    name: "Sword",
    joints: tipJ({ down: [1.5, -15], side: [2.5, -15] }, { down: [0, 3], side: [0, 3] }),
    parts: [
      shaft("sword-grip", "toolButt", "handR", 0.8, "leather"),
      ell({ id: "sword-guard", joint: "handR", dy: -1.6, rx: 2.4, ry: 0.8, slot: "gold", z: { down: HELD + 0.1, side: HELD + 0.1, up: 1.7 } }),
      shaft("sword-blade", "handR", "toolTip", 0.95, "metal"),
      tipBox({ id: "sword-tip", dx: -0.3, dy: -1, w: 1.2, h: 1.5, slot: "metal", tone: 1 }),
    ],
  },
  {
    id: "staff",
    name: "Staff",
    joints: tipJ({ down: [2, -19], side: [2.5, -19] }, { down: [-0.5, 5], side: [-0.5, 5] }),
    parts: [
      shaft("staff-shaft", "toolButt", "toolTip", 0.85, "wood"),
      tipEll({ id: "staff-orb", dy: -1.2, rx: 2.2, ry: 2.2, slot: "accent" }),
      tipBox({ id: "staff-cap", dx: -1.2, dy: 0.3, w: 2.6, h: 1.3, slot: "gold" }),
    ],
  },
  {
    id: "bow",
    name: "Bow",
    // the hand is the belly; both limbs sweep back toward the string
    joints: [
      { id: "toolTip", parent: "handR", rest: at({ down: [0.5, -9], side: [-2, -9] }) },
      { id: "bowLow", parent: "handR", rest: at({ down: [0.5, 8], side: [-2, 8] }) },
    ],
    parts: [
      shaft("bow-up", "handR", "toolTip", 0.9, "wood"),
      shaft("bow-low", "handR", "bowLow", 0.9, "wood"),
      { kind: "limb", id: "bow-string", from: "toolTip", to: "bowLow", r: 0.3, slot: "cloth2", tone: 2, z: { down: HELD - 0.1, side: HELD - 0.1, up: 1.5 } },
    ],
  },
  {
    id: "fishing-rod",
    name: "Fishing rod",
    joints: [
      ...tipJ({ down: [7, -13], side: [8, -12] }, { down: [-1, 2], side: [-1, 2] }),
      { id: "rodLine", parent: "toolTip", rest: at({ down: [7.5, -1], side: [8.5, 0] }) },
    ],
    parts: [
      shaft("rod-shaft", "toolButt", "toolTip", 0.8, "wood"),
      { kind: "limb", id: "rod-line", from: "toolTip", to: "rodLine", r: 0.3, slot: "cloth2", tone: 2, z: { down: HELD - 0.1, side: HELD - 0.1, up: 1.5 } },
      ell({ id: "rod-hook", joint: "rodLine", dy: 0.8, rx: 1, ry: 1, slot: "metal", z: { down: HELD, side: HELD, up: 1.6 } }),
    ],
  },
  {
    id: "shield",
    name: "Round shield",
    parts: [
      ell({ id: "shield-face", joint: "handL", dy: -2, rx: 4.8, ry: 5.6, slot: "wood", z: HELD, views: ["down", "up"] }),
      ell({ id: "shield-rim", joint: "handL", dy: -2, rx: 5, ry: 5.8, slot: "metal", tone: -1, z: HELD - 0.1, views: ["down", "up"] }),
      ell({ id: "shield-boss", joint: "handL", dy: -2, rx: 1.7, ry: 1.7, slot: "gold", z: HELD + 0.1, views: ["down"] }),
      ell({ id: "shield-side", joint: "handL", dy: -2, rx: 2, ry: 5.6, slot: "wood", z: HELD, views: ["side"] }),
      ell({ id: "shield-side-rim", joint: "handL", dy: -2, rx: 2.3, ry: 5.9, slot: "metal", tone: -1, z: HELD - 0.1, views: ["side"] }),
    ],
  },
];

const BASKET_Z = 3.5;
const carried: Attachment[] = [
  {
    id: "basket",
    name: "Basket",
    // hangs from the left hand so it does not fight with a tool in the right
    parts: [
      ell({ id: "basket-body", joint: "handL", dy: 2.5, rx: 4.2, ry: 3.4, slot: "leather", flat: 0.2, z: BASKET_Z }),
      box({ id: "basket-rim", joint: "handL", dx: -4.5, dy: -0.4, w: 9, h: 1.5, slot: "leather", tone: 1, z: BASKET_Z + 0.1 }),
      box({ id: "basket-handle", joint: "handL", dx: -0.5, dy: -2.5, w: 1.2, h: 2.5, slot: "leather", tone: -1, z: BASKET_Z }),
    ],
  },
  {
    id: "shoulder-pole",
    name: "Shoulder pole with two baskets",
    // bob joint under the chest: walk/carry clips lift the whole load 1px per step
    joints: [{ id: "pole", parent: "chest", rest: [16, 18] }],
    parts: [
      // front/back: a wooden pole 3px wider than the shoulders, baskets hang from its ends on 1px cords
      box({ id: "pole", joint: "pole", dx: -9, dy: -2, w: 18, h: 1.5, slot: "wood", z: BASKET_Z, views: ["down", "up"] }),
      box({ id: "pole-cord-l", joint: "pole", dx: -8, dy: -0.5, w: 1, h: 5, slot: "cloth2", z: BASKET_Z, views: ["down", "up"] }),
      box({ id: "pole-cord-r", joint: "pole", dx: 7, dy: -0.5, w: 1, h: 5, slot: "cloth2", z: BASKET_Z, views: ["down", "up"] }),
      ell({ id: "pole-basket-l", joint: "pole", dx: -7.5, dy: 7.2, rx: 3.6, ry: 2.6, slot: "leather", flat: 0.2, z: BASKET_Z, views: ["down", "up"] }),
      ell({ id: "pole-basket-r", joint: "pole", dx: 7.5, dy: 7.2, rx: 3.6, ry: 2.6, slot: "leather", flat: 0.2, z: BASKET_Z, views: ["down", "up"] }),
      box({ id: "pole-rim-l", joint: "pole", dx: -11, dy: 4.6, w: 7, h: 1.2, slot: "leather", tone: 1, z: BASKET_Z + 0.1, views: ["down", "up"] }),
      box({ id: "pole-rim-r", joint: "pole", dx: 4, dy: 4.6, w: 7, h: 1.2, slot: "leather", tone: 1, z: BASKET_Z + 0.1, views: ["down", "up"] }),
      // profile: pole seen end-on over the shoulder, one basket in front, one behind
      box({ id: "pole-s", joint: "pole", dx: -4, dy: -2, w: 8, h: 1.5, slot: "wood", z: BASKET_Z, views: ["side"] }),
      box({ id: "pole-cord-sf", joint: "pole", dx: 3, dy: -0.5, w: 1, h: 5, slot: "cloth2", z: BASKET_Z + 0.2, views: ["side"] }),
      box({ id: "pole-cord-sb", joint: "pole", dx: -4, dy: -0.5, w: 1, h: 5, slot: "cloth2", z: 1.4, views: ["side"] }),
      ell({ id: "pole-basket-sf", joint: "pole", dx: 3.5, dy: 7.2, rx: 3.4, ry: 2.6, slot: "leather", flat: 0.2, z: BASKET_Z + 0.2, views: ["side"] }),
      ell({ id: "pole-basket-sb", joint: "pole", dx: -3.5, dy: 7.2, rx: 3.4, ry: 2.6, slot: "leather", tone: -1, flat: 0.2, z: 1.4, views: ["side"] }),
      box({ id: "pole-rim-sf", joint: "pole", dx: 0.5, dy: 4.6, w: 6, h: 1.2, slot: "leather", tone: 1, z: BASKET_Z + 0.3, views: ["side"] }),
      box({ id: "pole-rim-sb", joint: "pole", dx: -6.5, dy: 4.6, w: 6, h: 1.2, slot: "leather", z: 1.5, views: ["side"] }),
    ],
  },
  {
    id: "rice-sack",
    name: "Rice sack on the back",
    parts: [
      // behind the body from the front, over it from the back, offset to the back in profile
      ell({ id: "sack-front", joint: "chest", dy: -1.5, rx: 6.5, ry: 6, slot: "cloth", tone: 1, z: 1.5, views: ["down"] }),
      ell({ id: "sack-side", joint: "chest", dx: -4.5, dy: -0.5, rx: 3.8, ry: 6.5, slot: "cloth", tone: 1, z: 1.5, views: ["side"] }),
      ell({ id: "sack-back", joint: "chest", dy: 0.5, rx: 7, ry: 7, slot: "cloth", tone: 1, z: 3.5, views: ["up"] }),
      box({ id: "sack-tie", joint: "chest", dx: -2.5, dy: -7, w: 5, h: 1.5, slot: "cloth2", z: 3.6, views: ["up"] }),
      box({ id: "sack-tie-s", joint: "chest", dx: -6.3, dy: -6.5, w: 3, h: 1.5, slot: "cloth2", z: 1.6, views: ["side"] }),
    ],
  },
];

export const HUMANOID_ATTACHMENTS: Attachment[] = [...headwear, ...held, ...carried];

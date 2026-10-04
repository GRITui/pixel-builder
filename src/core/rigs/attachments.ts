// Attachment catalog for humanoid joints (issue #5). Joints follow the contract in joints.ts;
// coordinates are on the 32 design grid, relative to the joint. Materials are literal ramps
// (leather, metal, ...) so users recolour through the kit; volumes are lit, never hand-shaded.
// Held items stand upright on the hand (a box can't tilt) and every part rides its joint,
// so they follow every pose and mirror for "left" automatically.
import type { Attachment, PartDef } from "../rig";
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
    // a shallow, wide cone: stacked flattened discs shrinking to a low apex
    parts: [
      ell({ id: "hat-brim", joint: "head", dy: -3.2, rx: 11, ry: 2.8, slot: "sand", flat: 0.6, z: HZ }),
      ell({ id: "hat-cone1", joint: "head", dy: -4.6, rx: 8.5, ry: 2.6, slot: "sand", flat: 0.45, z: HZ + 1 }),
      ell({ id: "hat-cone2", joint: "head", dy: -6.2, rx: 5.5, ry: 2.2, slot: "sand", flat: 0.35, z: HZ + 2 }),
      ell({ id: "hat-cone3", joint: "head", dy: -7.6, rx: 2.6, ry: 1.7, slot: "sand", flat: 0.2, z: HZ + 3 }),
      box({ id: "hat-strap", joint: "head", dx: -0.5, dy: -1, w: 1, h: 4, slot: "cloth2", z: HZ - 1, views: ["down"] }),
    ],
  },
  {
    id: "straw-hat",
    name: "Straw hat",
    parts: [
      ell({ id: "hat-brim", joint: "head", dy: -3, rx: 10, ry: 2.4, slot: "sand", flat: 0.5, z: HZ }),
      ell({ id: "hat-crown", joint: "head", dy: -5.3, rx: 5.8, ry: 3.6, slot: "sand", z: HZ + 1 }),
      ell({ id: "hat-band", joint: "head", dy: -3.6, rx: 5.9, ry: 1.2, slot: "cloth2", flat: 0.5, z: HZ + 2 }),
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
      ell({ id: "hat-brim", joint: "head", dy: -3.5, rx: 10.5, ry: 2.2, slot: "cloth2", flat: 0.5, z: HZ }),
      ell({ id: "hat-cone1", joint: "head", dy: -5, rx: 6, ry: 2.4, slot: "cloth2", z: HZ + 1 }),
      ell({ id: "hat-cone2", joint: "head", dx: 0.3, dy: -6.5, rx: 4.2, ry: 2, slot: "cloth2", z: HZ + 2 }),
      ell({ id: "hat-cone3", joint: "head", dx: 0.8, dy: -7.7, rx: 2.5, ry: 1.6, slot: "cloth2", z: HZ + 3 }),
      ell({ id: "hat-tip", joint: "head", dx: 2, dy: -8.4, rx: 1.3, ry: 1.2, slot: "cloth2", tone: 1, z: HZ + 4 }),
      ell({ id: "hat-band", joint: "head", dy: -4.2, rx: 6, ry: 1, slot: "gold", flat: 0.5, z: HZ + 5 }),
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

const held: Attachment[] = [
  {
    id: "hoe",
    name: "Hoe",
    parts: [
      box({ id: "hoe-handle", joint: "handR", dx: -0.5, dy: -13, w: 1.5, h: 18, slot: "wood", z: HELD }),
      box({ id: "hoe-blade", joint: "handR", dx: -0.5, dy: -14, w: 5, h: 3, slot: "metal", z: HELD + 0.1 }),
      box({ id: "hoe-edge", joint: "handR", dx: 3.5, dy: -12, w: 1.5, h: 2, slot: "metal", tone: -1, z: HELD + 0.1 }),
    ],
  },
  {
    id: "sickle",
    name: "Sickle",
    parts: [
      box({ id: "sickle-handle", joint: "handR", dx: -0.5, dy: -4, w: 1.5, h: 6, slot: "wood", z: HELD }),
      box({ id: "sickle-blade", joint: "handR", dx: -0.5, dy: -7, w: 4, h: 2, slot: "metal", z: HELD + 0.1 }),
      box({ id: "sickle-tip", joint: "handR", dx: 2.5, dy: -6, w: 1.5, h: 3, slot: "metal", tone: 1, z: HELD + 0.1 }),
    ],
  },
  {
    id: "sword",
    name: "Sword",
    parts: [
      box({ id: "sword-grip", joint: "handR", dx: -0.5, dy: -1.5, w: 1.5, h: 4, slot: "leather", z: HELD }),
      box({ id: "sword-guard", joint: "handR", dx: -2.5, dy: -2.8, w: 5, h: 1.5, slot: "gold", z: HELD + 0.1 }),
      box({ id: "sword-blade", joint: "handR", dx: -0.9, dy: -13.5, w: 2.4, h: 11, slot: "metal", z: HELD }),
      box({ id: "sword-tip", joint: "handR", dx: -0.3, dy: -14.8, w: 1.2, h: 1.5, slot: "metal", tone: 1, z: HELD }),
    ],
  },
  {
    id: "staff",
    name: "Staff",
    parts: [
      box({ id: "staff-shaft", joint: "handR", dx: -0.7, dy: -17, w: 1.6, h: 24, slot: "wood", z: HELD }),
      ell({ id: "staff-orb", joint: "handR", dy: -18.5, rx: 2.2, ry: 2.2, slot: "accent", z: HELD + 0.1 }),
      box({ id: "staff-cap", joint: "handR", dx: -1.2, dy: -16.5, w: 2.6, h: 1.3, slot: "gold", z: HELD + 0.1 }),
    ],
  },
  {
    id: "bow",
    name: "Bow",
    parts: [
      ell({ id: "bow-top", joint: "handR", dx: 0.2, dy: -8, rx: 1, ry: 2, slot: "wood", z: HELD }),
      ell({ id: "bow-up", joint: "handR", dx: 1.4, dy: -4.5, rx: 1.1, ry: 2.4, slot: "wood", z: HELD }),
      ell({ id: "bow-mid", joint: "handR", dx: 2, dy: -1, rx: 1.1, ry: 2.4, slot: "wood", z: HELD }),
      ell({ id: "bow-low", joint: "handR", dx: 1.4, dy: 2.5, rx: 1.1, ry: 2.4, slot: "wood", z: HELD }),
      ell({ id: "bow-bot", joint: "handR", dx: 0.2, dy: 6, rx: 1, ry: 2, slot: "wood", z: HELD }),
      box({ id: "bow-string", joint: "handR", dx: -1.2, dy: -9, w: 1, h: 17, slot: "cloth2", tone: 2, z: HELD - 0.1 }),
    ],
  },
  {
    id: "fishing-rod",
    name: "Fishing rod",
    parts: [
      ell({ id: "rod-1", joint: "handR", dx: 0.5, dy: -1.5, rx: 1, ry: 2, slot: "wood", z: HELD }),
      ell({ id: "rod-2", joint: "handR", dx: 2.2, dy: -5, rx: 1, ry: 2, slot: "wood", z: HELD }),
      ell({ id: "rod-3", joint: "handR", dx: 4, dy: -8.5, rx: 1, ry: 2, slot: "wood", z: HELD }),
      ell({ id: "rod-4", joint: "handR", dx: 5.8, dy: -12, rx: 1, ry: 2, slot: "wood", z: HELD }),
      ell({ id: "rod-5", joint: "handR", dx: 7.4, dy: -15, rx: 0.9, ry: 1.6, slot: "wood", z: HELD }),
      box({ id: "rod-line", joint: "handR", dx: 7.8, dy: -14, w: 1, h: 13, slot: "cloth2", tone: 2, z: HELD - 0.1 }),
      box({ id: "rod-hook", joint: "handR", dx: 7.3, dy: -1.5, w: 2, h: 1.5, slot: "metal", z: HELD }),
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
    parts: [
      box({ id: "pole", joint: "chest", dx: -12.5, dy: -1.2, w: 25, h: 1.5, slot: "wood", z: BASKET_Z }),
      box({ id: "pole-rope-l", joint: "chest", dx: -10.5, dy: 0.3, w: 1, h: 5, slot: "cloth2", z: BASKET_Z }),
      box({ id: "pole-rope-r", joint: "chest", dx: 9.5, dy: 0.3, w: 1, h: 5, slot: "cloth2", z: BASKET_Z }),
      ell({ id: "pole-basket-l", joint: "chest", dx: -10, dy: 7.5, rx: 3.8, ry: 2.8, slot: "leather", flat: 0.2, z: BASKET_Z }),
      ell({ id: "pole-basket-r", joint: "chest", dx: 10, dy: 7.5, rx: 3.8, ry: 2.8, slot: "leather", flat: 0.2, z: BASKET_Z }),
      box({ id: "pole-rim-l", joint: "chest", dx: -13.5, dy: 4.8, w: 7, h: 1.2, slot: "leather", tone: 1, z: BASKET_Z + 0.1 }),
      box({ id: "pole-rim-r", joint: "chest", dx: 6.5, dy: 4.8, w: 7, h: 1.2, slot: "leather", tone: 1, z: BASKET_Z + 0.1 }),
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

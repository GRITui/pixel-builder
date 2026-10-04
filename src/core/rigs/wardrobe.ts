// Wardrobe: the detail-layer catalog (face, hair, costume, hat, bag) for humanoid rigs.
// A character is a core rig plus one entry per layer, so new characters are new combinations.
// Head layers are placed relative to the `head` joint (same head on every age), body layers
// relative to `chest`/`hip`/shoulders with modest widths so they fit the slim and the stocky.
// Z conventions follow attachments.ts: legs 1, torso 2, belt 2.5, arms 3, head 4, hair 5-6,
// hats 8+, face details 20+, eyes 30. Costumes sit at 2.7 (over belt and buckle, under arms).
import type { Attachment, Joint, PartDef } from "../rig";
import { HUMANOID_ATTACHMENTS } from "./attachments";
import { FACE, hairAttachment, HAIR_STYLES, type HairStyle } from "./humanoid";

export type Layer = "face" | "hair" | "costume" | "hat" | "bag";

type Box = { id: string; joint: string; dx: number; dy: number; w: number; h: number; slot: string; z: PartDef["z"]; tone?: number; views?: PartDef["views"]; normal?: [number, number, number] };
const box = (b: Box): PartDef => ({ kind: "box", ...b });
type Ell = { id: string; joint: string; dx?: number; dy?: number; rx: number; ry: number; slot: string; z: PartDef["z"]; tone?: number; flat?: number; views?: PartDef["views"] };
const ell = (e: Ell): PartDef => ({ kind: "ellipse", ...e });
const limb = (id: string, from: string, to: string, r: number, slot: string, z: PartDef["z"], tone?: number, views?: PartDef["views"]): PartDef => ({ kind: "limb", id, from, to, r, slot, z, tone, views });

const att = (id: string, name: string, parts: PartDef[], joints?: Joint[]): Attachment => ({ id, name, parts, ...(joints ? { joints } : {}) });

// ---------------------------------------------------------------- face
const FZ = 20; // above hair, hats and skin windows; below the eyes (30)

const faceLayers: Attachment[] = [
  att("face-beard", "Beard", [
    ell({ id: "beard", joint: "head", dy: 5.3, rx: 5.2, ry: 2.9, slot: "hair", z: FZ, views: ["down"] }),
    box({ id: "beard-cheekL", joint: "head", dx: -6, dy: 1.5, w: 1.5, h: 4, slot: "hair", z: FZ, views: ["down"] }),
    box({ id: "beard-cheekR", joint: "head", dx: 4.5, dy: 1.5, w: 1.5, h: 4, slot: "hair", z: FZ, views: ["down"] }),
    ell({ id: "beard-side", joint: "head", dx: 3.6, dy: 4.6, rx: 3.4, ry: 3, slot: "hair", z: FZ, views: ["side"] }),
    box({ id: "beard-side-jaw", joint: "head", dx: 0.5, dy: 1.6, w: 2, h: 4, slot: "hair", z: FZ, views: ["side"] }),
  ]),
  att("face-mustache", "Mustache", [
    box({ id: "mustache", joint: "head", dx: -3, dy: 1.4, w: 6, h: 1.4, slot: "hair", z: FZ, views: ["down"] }),
    box({ id: "mustache-side", joint: "head", dx: 2.6, dy: 1.4, w: 3, h: 1.4, slot: "hair", z: FZ, views: ["side"] }),
  ]),
  att("face-glasses", "Glasses", [
    // two 1px frames around the eyes (eyes are drawn above at z 30)
    box({ id: "glasses-topL", joint: "head", dx: -4.4, dy: -1.9, w: 3.4, h: 1, slot: "metal", z: FZ, views: ["down"] }),
    box({ id: "glasses-botL", joint: "head", dx: -4.4, dy: 1.3, w: 3.4, h: 1, slot: "metal", z: FZ, views: ["down"] }),
    box({ id: "glasses-outL", joint: "head", dx: -4.4, dy: -1.9, w: 1, h: 4.2, slot: "metal", z: FZ, views: ["down"] }),
    box({ id: "glasses-inL", joint: "head", dx: -1.2, dy: -1.9, w: 1, h: 4.2, slot: "metal", z: FZ, views: ["down"] }),
    box({ id: "glasses-topR", joint: "head", dx: 1.0, dy: -1.9, w: 3.4, h: 1, slot: "metal", z: FZ, views: ["down"] }),
    box({ id: "glasses-botR", joint: "head", dx: 1.0, dy: 1.3, w: 3.4, h: 1, slot: "metal", z: FZ, views: ["down"] }),
    box({ id: "glasses-inR", joint: "head", dx: 1.0, dy: -1.9, w: 1, h: 4.2, slot: "metal", z: FZ, views: ["down"] }),
    box({ id: "glasses-outR", joint: "head", dx: 3.4, dy: -1.9, w: 1, h: 4.2, slot: "metal", z: FZ, views: ["down"] }),
    box({ id: "glasses-bridge", joint: "head", dx: -0.5, dy: -1.2, w: 2, h: 1, slot: "metal", z: FZ, views: ["down"] }),
    box({ id: "glasses-lens-side", joint: "head", dx: 1.8, dy: -1.9, w: 3.6, h: 4.2, slot: "metal", z: FZ, tone: 2, views: ["side"] }),
    box({ id: "glasses-lens-side-in", joint: "head", dx: 2.6, dy: -1.1, w: 2.2, h: 2.6, slot: "skin", z: FZ + 0.1, views: ["side"] }),
    box({ id: "glasses-arm", joint: "head", dx: -4, dy: -1.4, w: 6, h: 1, slot: "metal", z: FZ, views: ["side"] }),
  ]),
  att("face-freckles", "Freckles", [
    ...[[-5, 2.2], [-3, 3.2], [-6, 3.6], [4, 2.2], [2.2, 3.2], [5, 3.6]].map(([dx, dy], i) =>
      box({ id: `freckle${i}`, joint: "head", dx, dy, w: 1, h: 1, slot: "skin", tone: -2, z: FZ, views: ["down"] })),
    ...[[2.2, 2.8], [4.2, 3.4], [3.2, 1.8]].map(([dx, dy], i) =>
      box({ id: `freckle-side${i}`, joint: "head", dx, dy, w: 1, h: 1, slot: "skin", tone: -2, z: FZ, views: ["side"] })),
  ]),
  att("face-wrinkles", "Wrinkles", [
    box({ id: "wrinkle-brow", joint: "head", dx: -3.5, dy: -3.6, w: 7, h: 1, slot: "skin", tone: -1, z: FZ, views: ["down"] }),
    box({ id: "wrinkle-smileL", joint: "head", dx: -3.8, dy: 2.4, w: 1, h: 2, slot: "skin", tone: -1, z: FZ, views: ["down"] }),
    box({ id: "wrinkle-smileR", joint: "head", dx: 2.8, dy: 2.4, w: 1, h: 2, slot: "skin", tone: -1, z: FZ, views: ["down"] }),
    box({ id: "wrinkle-crowL", joint: "head", dx: -5.2, dy: -0.6, w: 1, h: 1, slot: "skin", tone: -2, z: FZ, views: ["down"] }),
    box({ id: "wrinkle-crowR", joint: "head", dx: 4.2, dy: -0.6, w: 1, h: 1, slot: "skin", tone: -2, z: FZ, views: ["down"] }),
    box({ id: "wrinkle-side", joint: "head", dx: 1.5, dy: 2.4, w: 1, h: 2, slot: "skin", tone: -1, z: FZ, views: ["side"] }),
    box({ id: "wrinkle-side-brow", joint: "head", dx: 1.5, dy: -3.6, w: 4.5, h: 1, slot: "skin", tone: -1, z: FZ, views: ["side"] }),
  ]),
];

// ---------------------------------------------------------------- hair
const NEW_HAIR = ["bun", "braids", "pigtails", "bob"] as const;
export type WardrobeHair = (typeof NEW_HAIR)[number];
export const WARDROBE_HAIR_STYLES: readonly string[] = NEW_HAIR;

const hb = (id: string, p: { dx: number; dy: number; w: number; h: number; views: PartDef["views"]; z?: number; tone?: number }): PartDef => box({ id, joint: "head", slot: "hair", z: 5, ...p });
const he = (id: string, p: { dx?: number; dy?: number; rx: number; ry: number; views?: PartDef["views"]; z?: number; tone?: number }): PartDef => ell({ id, joint: "head", slot: "hair", z: 5, ...p });

/** Short hair crown (with the face window) plus style-specific extras, same pattern as `hairAttachment`. */
export function wardrobeHair(style: WardrobeHair, fringe: -1 | 0 | 1 = 0): Attachment {
  const base = hairAttachment("short", fringe).parts;
  let extra: PartDef[] = [];
  if (style === "bun") {
    extra = [
      he("hair-bun-top", { dy: -6.4, rx: 3, ry: 2.2, views: ["down"], z: 5.2 }),
      he("hair-bun-side", { dx: -3, dy: -6.2, rx: 2.8, ry: 2.2, views: ["side"], z: 5.2 }),
      he("hair-bun-up", { dy: -6, rx: 3.2, ry: 2.4, views: ["up"], z: 5.3 }),
      box({ id: "hair-bun-tie", joint: "head", dx: -2.4, dy: -4.8, w: 4.8, h: 1, slot: "accent", z: 5.3, views: ["down"] }),
    ];
  } else if (style === "braids") {
    const seg = (side: -1 | 1, i: number) => he(`hair-braid${side}-${i}`, { dx: side * 7.8, dy: 3 + i * 2.2, rx: 1.4, ry: 1.3, views: ["down"], z: 6.2, tone: i % 2 ? -1 : 0 });
    const segUp = (side: -1 | 1, i: number) => he(`hair-braidu${side}-${i}`, { dx: side * 3.2, dy: 5 + i * 2.2, rx: 1.4, ry: 1.3, views: ["up"], z: 5.4, tone: i % 2 ? -1 : 0 });
    const segS = (i: number) => he(`hair-braids-${i}`, { dx: -7.4, dy: 2 + i * 2.2, rx: 1.4, ry: 1.3, views: ["side"], z: 5.4, tone: i % 2 ? -1 : 0 });
    extra = ([-1, 1] as const).flatMap((s) => [0, 1, 2, 3].flatMap((i) => [seg(s, i), segUp(s, i)])).concat([0, 1, 2, 3].map(segS));
    extra.push(
      box({ id: "hair-braid-tieL", joint: "head", dx: -9, dy: 11.2, w: 2.2, h: 1, slot: "accent", z: 6.3, views: ["down"] }),
      box({ id: "hair-braid-tieR", joint: "head", dx: 6.8, dy: 11.2, w: 2.2, h: 1, slot: "accent", z: 6.3, views: ["down"] }),
    );
  } else if (style === "pigtails") {
    extra = [
      he("hair-pigL", { dx: -8.2, dy: 3.2, rx: 2.3, ry: 3.8, views: ["down"], z: 6.2 }),
      he("hair-pigR", { dx: 8.2, dy: 3.2, rx: 2.3, ry: 3.8, views: ["down"], z: 6.2 }),
      box({ id: "hair-pigL-tie", joint: "head", dx: -9.8, dy: -0.4, w: 3.2, h: 1.2, slot: "accent", z: 6.3, views: ["down"] }),
      box({ id: "hair-pigR-tie", joint: "head", dx: 6.6, dy: -0.4, w: 3.2, h: 1.2, slot: "accent", z: 6.3, views: ["down"] }),
      he("hair-pig-side", { dx: -8.4, dy: 3, rx: 2.4, ry: 3.8, views: ["side"], z: 5.4 }),
      box({ id: "hair-pig-side-tie", joint: "head", dx: -10, dy: -0.6, w: 3.2, h: 1.2, slot: "accent", z: 5.5, views: ["side"] }),
      he("hair-pigL-up", { dx: -8, dy: 3.2, rx: 2.3, ry: 3.8, views: ["up"], z: 5.4 }),
      he("hair-pigR-up", { dx: 8, dy: 3.2, rx: 2.3, ry: 3.8, views: ["up"], z: 5.4 }),
    ];
  } else {
    // bob: chin-length, rounded under
    extra = [
      he("hair-bob-up", { dy: 1.8, rx: 7.6, ry: 6.8, views: ["up"] }),
      hb("hair-bob-side", { dx: -7.2, dy: 0, w: 5, h: 6.5, views: ["side"] }),
      hb("hair-bob-L", { dx: -8, dy: 0.5, w: 3.2, h: 6, views: ["down"], z: 6 }),
      hb("hair-bob-R", { dx: 4.8, dy: 0.5, w: 3.2, h: 6, views: ["down"], z: 6 }),
    ];
  }
  return att(`hair-${style}`, `Hair (${style})`, [...base, ...extra]);
}

/** Resolve a `hair_style` choice (classic or wardrobe) to its attachment. */
export function hairStyleAttachment(style: string, fringe: -1 | 0 | 1 = 0): Attachment {
  return (NEW_HAIR as readonly string[]).includes(style) ? wardrobeHair(style as WardrobeHair, fringe) : hairAttachment(style as HairStyle, fringe);
}

// ---------------------------------------------------------------- costume
const CZ = 2.7;
const CZ2 = 2.8;

const costumes: Attachment[] = [
  att("costume-overalls", "Overalls", [
    // bib over the shirt, straps over the shoulders, pocket and buttons
    box({ id: "ov-bib", joint: "chest", dx: -3.5, dy: 0.2, w: 7, h: 6.2, slot: "bottom", z: CZ, views: ["down"] }),
    box({ id: "ov-pocket", joint: "chest", dx: -2, dy: 2.4, w: 4, h: 2, slot: "bottom", tone: -1, z: CZ2, views: ["down"] }),
    box({ id: "ov-strapL", joint: "chest", dx: -3.5, dy: -2.4, w: 1.4, h: 3, slot: "bottom", z: CZ, views: ["down"] }),
    box({ id: "ov-strapR", joint: "chest", dx: 2.1, dy: -2.4, w: 1.4, h: 3, slot: "bottom", z: CZ, views: ["down"] }),
    box({ id: "ov-btnL", joint: "chest", dx: -3.5, dy: 0.4, w: 1, h: 1, slot: "gold", z: CZ2, views: ["down"] }),
    box({ id: "ov-btnR", joint: "chest", dx: 2.5, dy: 0.4, w: 1, h: 1, slot: "gold", z: CZ2, views: ["down"] }),
    // profile: front bib edge, strap over the shoulder
    box({ id: "ov-bib-s", joint: "chest", dx: -1.6, dy: 0.2, w: 5, h: 6.2, slot: "bottom", z: CZ, views: ["side"] }),
    box({ id: "ov-strap-s", joint: "chest", dx: -1.8, dy: -2.4, w: 1.4, h: 3, slot: "bottom", z: CZ, views: ["side"] }),
    box({ id: "ov-btn-s", joint: "chest", dx: 2.4, dy: 0.4, w: 1, h: 1, slot: "gold", z: CZ2, views: ["side"] }),
    // back: straps run down to the waistband
    box({ id: "ov-back", joint: "chest", dx: -3.5, dy: 4.4, w: 7, h: 2, slot: "bottom", z: CZ, views: ["up"] }),
    box({ id: "ov-back-strapL", joint: "chest", dx: -3.4, dy: -2.4, w: 1.4, h: 7, slot: "bottom", z: CZ, views: ["up"] }),
    box({ id: "ov-back-strapR", joint: "chest", dx: 2, dy: -2.4, w: 1.4, h: 7, slot: "bottom", z: CZ, views: ["up"] }),
  ]),
  att("costume-dress", "Dress", [
    // skirt flares from the waist over the legs; boots peek out below
    ell({ id: "dr-skirt", joint: "hip", dx: 0, dy: 1.8, rx: 7, ry: 4, slot: "top", flat: 0.45, z: CZ }),
    box({ id: "dr-skirt-fill", joint: "hip", dx: -5, dy: -0.8, w: 10, h: 3, slot: "top", z: CZ }),
    box({ id: "dr-hem", joint: "hip", dx: -6.2, dy: 3.8, w: 12.4, h: 1, slot: "top", tone: -1, z: CZ2, views: ["down", "up"] }),
    box({ id: "dr-hem-s", joint: "hip", dx: -5, dy: 3.8, w: 10, h: 1, slot: "top", tone: -1, z: CZ2, views: ["side"] }),
    box({ id: "dr-waist", joint: "hip", dx: -4.8, dy: -0.8, w: 9.6, h: 1.4, slot: "accent", tone: -1, z: CZ2, views: ["down", "up"] }),
    box({ id: "dr-waist-s", joint: "hip", dx: -3.8, dy: -0.8, w: 7.6, h: 1, slot: "accent", z: CZ2, views: ["side"] }),
    box({ id: "dr-neck", joint: "chest", dx: -2, dy: -1.6, w: 4, h: 1, slot: "top", tone: 1, z: CZ2, views: ["down"] }),
  ]),
  att("costume-apron", "Apron", [
    box({ id: "ap-bib", joint: "chest", dx: -3, dy: -0.6, w: 6, h: 4.4, slot: "accent", z: CZ, views: ["down"] }),
    box({ id: "ap-skirt", joint: "chest", dx: -4, dy: 3.8, w: 8, h: 5.2, slot: "accent", z: CZ, views: ["down"] }),
    box({ id: "ap-skirt-edge", joint: "chest", dx: -4, dy: 8.2, w: 8, h: 0.8, slot: "accent", tone: -1, z: CZ2, views: ["down"] }),
    box({ id: "ap-pocket", joint: "chest", dx: -2, dy: 5.8, w: 4, h: 2, slot: "accent", tone: 1, z: CZ2, views: ["down"] }),
    box({ id: "ap-tie", joint: "chest", dx: -4.8, dy: 3.4, w: 9.6, h: 1, slot: "accent", tone: -1, z: CZ2, views: ["down"] }),
    box({ id: "ap-strapL", joint: "chest", dx: -3, dy: -2.4, w: 1, h: 2, slot: "accent", tone: -1, z: CZ, views: ["down"] }),
    box({ id: "ap-strapR", joint: "chest", dx: 2, dy: -2.4, w: 1, h: 2, slot: "accent", tone: -1, z: CZ, views: ["down"] }),
    // profile: panel on the front of the body
    box({ id: "ap-bib-s", joint: "chest", dx: -0.4, dy: -0.6, w: 3.6, h: 4.4, slot: "accent", z: CZ, views: ["side"] }),
    box({ id: "ap-skirt-s", joint: "chest", dx: -0.8, dy: 3.8, w: 5, h: 5.2, slot: "accent", z: CZ, views: ["side"] }),
    box({ id: "ap-skirt-edge-s", joint: "chest", dx: -0.8, dy: 8.2, w: 5, h: 0.8, slot: "accent", tone: -1, z: CZ2, views: ["side"] }),
    box({ id: "ap-strap-s", joint: "chest", dx: -0.6, dy: -2.4, w: 1, h: 2, slot: "accent", tone: -1, z: CZ, views: ["side"] }),
    // back: waist ties and a bow
    box({ id: "ap-tie-up", joint: "chest", dx: -4.8, dy: 3.4, w: 9.6, h: 1, slot: "accent", tone: -1, z: CZ, views: ["up"] }),
    box({ id: "ap-bow-up", joint: "chest", dx: -2, dy: 4.4, w: 4, h: 2.2, slot: "accent", z: CZ2, views: ["up"] }),
    box({ id: "ap-neck-up", joint: "chest", dx: -3, dy: -2.4, w: 6, h: 1, slot: "accent", tone: -1, z: CZ, views: ["up"] }),
  ]),
  att("costume-sarong", "Sarong", [
    // a straight wrapped tube from the waist to the calves, wrap seam and a woven stripe
    box({ id: "sa-tube", joint: "hip", dx: -5.2, dy: -0.8, w: 10.4, h: 6, slot: "accent", z: CZ, views: ["down", "up"] }),
    box({ id: "sa-tube-s", joint: "hip", dx: -4, dy: -0.8, w: 8, h: 6, slot: "accent", z: CZ, views: ["side"] }),
    box({ id: "sa-band", joint: "hip", dx: -5.4, dy: -1, w: 10.8, h: 1.6, slot: "accent", tone: 1, z: CZ2, views: ["down", "up"] }),
    box({ id: "sa-band-s", joint: "hip", dx: -4.2, dy: -1, w: 8.4, h: 1.6, slot: "accent", tone: 1, z: CZ2, views: ["side"] }),
    box({ id: "sa-stripe", joint: "hip", dx: -5, dy: 3.8, w: 10, h: 1.2, slot: "gold", z: CZ2, views: ["down", "up"] }),
    box({ id: "sa-stripe-s", joint: "hip", dx: -3.8, dy: 3.8, w: 7.6, h: 1.2, slot: "gold", z: CZ2, views: ["side"] }),
    box({ id: "sa-seam", joint: "hip", dx: 0.5, dy: 0.8, w: 1, h: 3.4, slot: "accent", tone: -2, z: CZ2, views: ["down"] }),
    box({ id: "sa-knot", joint: "hip", dx: -2.2, dy: -1.6, w: 2, h: 2, slot: "accent", tone: -1, z: CZ2 + 0.1, views: ["down"] }),
  ]),
  att("costume-smock", "Smock", [
    // long farmer shirt to mid-thigh, V neck, placket, rolled sleeve cuffs
    ell({ id: "sm-body", joint: "chest", dy: 3.4, rx: 5.8, ry: 5.9, slot: "top", flat: 0.4, z: CZ, views: ["down", "up"] }),
    ell({ id: "sm-body-s", joint: "chest", dy: 3.4, rx: 4.6, ry: 5.9, slot: "top", flat: 0.4, z: CZ, views: ["side"] }),
    box({ id: "sm-hem", joint: "chest", dx: -5.4, dy: 8.4, w: 10.8, h: 1, slot: "top", tone: -1, z: CZ2, views: ["down", "up"] }),
    box({ id: "sm-hem-s", joint: "chest", dx: -4.2, dy: 8.4, w: 8.4, h: 1, slot: "top", tone: -1, z: CZ2, views: ["side"] }),
    box({ id: "sm-placket", joint: "chest", dx: -0.5, dy: -0.8, w: 1, h: 8, slot: "top", tone: -1, z: CZ2, views: ["down"] }),
    box({ id: "sm-vneck", joint: "chest", dx: -1.5, dy: -2, w: 3, h: 1.4, slot: "skin", tone: -1, z: CZ2, views: ["down"] }),
    box({ id: "sm-btn1", joint: "chest", dx: 0.5, dy: 1.4, w: 1, h: 1, slot: "gold", z: CZ2 + 0.1, views: ["down"] }),
    box({ id: "sm-btn2", joint: "chest", dx: 0.5, dy: 4, w: 1, h: 1, slot: "gold", z: CZ2 + 0.1, views: ["down"] }),
    box({ id: "sm-pocket", joint: "chest", dx: -4, dy: 4.6, w: 3, h: 2.4, slot: "top", tone: 1, z: CZ2, views: ["down"] }),
    ell({ id: "sm-cuffL", joint: "elbowL", dy: 0.4, rx: 2, ry: 0.9, slot: "top", tone: -1, z: 3.2 }),
    ell({ id: "sm-cuffR", joint: "elbowR", dy: 0.4, rx: 2, ry: 0.9, slot: "top", tone: -1, z: 3.2, views: ["down", "up"] }),
  ]),
  att("costume-sweater", "Chunky sweater", [
    // thick ribbed hem, cuffs and a rolled collar, plus a knit stripe
    box({ id: "sw-hem", joint: "chest", dx: -5, dy: 4.6, w: 10, h: 2, slot: "top", tone: 1, z: CZ, views: ["down", "up"] }),
    box({ id: "sw-hem-s", joint: "chest", dx: -3.8, dy: 4.6, w: 7.6, h: 2, slot: "top", tone: 1, z: CZ, views: ["side"] }),
    box({ id: "sw-stripe", joint: "chest", dx: -5, dy: 1, w: 10, h: 1.2, slot: "accent", z: CZ, views: ["down", "up"] }),
    box({ id: "sw-stripe-s", joint: "chest", dx: -3.8, dy: 1, w: 7.6, h: 1.2, slot: "accent", z: CZ, views: ["side"] }),
    box({ id: "sw-rib", joint: "chest", dx: -4, dy: 5.2, w: 1, h: 1.2, slot: "top", tone: -1, z: CZ2, views: ["down", "up"] }),
    box({ id: "sw-rib2", joint: "chest", dx: -1, dy: 5.2, w: 1, h: 1.2, slot: "top", tone: -1, z: CZ2, views: ["down", "up"] }),
    box({ id: "sw-rib3", joint: "chest", dx: 2, dy: 5.2, w: 1, h: 1.2, slot: "top", tone: -1, z: CZ2, views: ["down", "up"] }),
    ell({ id: "sw-collar", joint: "chest", dy: -1.2, rx: 4.6, ry: 1.7, slot: "top", tone: 1, flat: 0.4, z: 4.1, views: ["down", "up"] }),
    ell({ id: "sw-collar-s", joint: "chest", dx: -0.8, dy: -1.2, rx: 3.4, ry: 1.7, slot: "top", tone: 1, flat: 0.4, z: 4.1, views: ["side"] }),
    ell({ id: "sw-cuffL", joint: "handL", dy: -1.2, rx: 2.2, ry: 1.1, slot: "top", tone: 1, z: 3.05 }),
    ell({ id: "sw-cuffR", joint: "handR", dy: -1.2, rx: 2.2, ry: 1.1, slot: "top", tone: 1, z: 3.05, views: ["down", "up"] }),
  ]),
];

// ---------------------------------------------------------------- hats
const HZ = 8; // as in attachments.ts

const hats: Attachment[] = [
  att("hat-cap", "Peaked cap", [
    ell({ id: "cap-dome", joint: "head", dy: -4.9, rx: 7, ry: 3.1, slot: "accent", z: HZ, views: ["down"] }),
    ell({ id: "cap-dome-s", joint: "head", dx: -0.8, dy: -4.9, rx: 6.8, ry: 3.1, slot: "accent", z: HZ, views: ["side"] }),
    ell({ id: "cap-dome-up", joint: "head", dy: -2.6, rx: 7.2, ry: 5.4, slot: "accent", z: HZ, views: ["up"] }),
    box({ id: "cap-visor", joint: "head", dx: -5.2, dy: -3.2, w: 10.4, h: 1.4, slot: "accent", tone: -1, z: HZ + 1, views: ["down"] }),
    box({ id: "cap-visor-s", joint: "head", dx: 2.4, dy: -3.4, w: 6, h: 1.5, slot: "accent", tone: -1, z: HZ + 1, views: ["side"] }),
    box({ id: "cap-button", joint: "head", dx: -0.5, dy: -8.1, w: 1, h: 1, slot: "accent", tone: 1, z: HZ + 2, views: ["down", "up"] }),
    box({ id: "cap-strap-up", joint: "head", dx: -3, dy: -0.4, w: 6, h: 1, slot: "accent", tone: -1, z: HZ + 1, views: ["up"] }),
  ]),
  att("hat-bonnet", "Bonnet", [
    ell({ id: "bon-shell", joint: "head", dy: -1.4, rx: 7.9, ry: 6.8, slot: "accent", z: HZ, views: ["down"] }),
    ell({ id: "bon-shell-s", joint: "head", dx: -1.2, dy: -1, rx: 7.2, ry: 6.8, slot: "accent", z: HZ, views: ["side"] }),
    ell({ id: "bon-shell-up", joint: "head", dy: -0.3, rx: 7.8, ry: 7.2, slot: "accent", z: HZ, views: ["up"] }),
    // frilled face opening, then the face itself
    ell({ id: "bon-frill", joint: "head", dy: 1.3, rx: 6.4, ry: 5.2, slot: "accent", tone: 1, z: HZ + 1, views: ["down"] }),
    ell({ id: "bon-face", joint: "head", dy: 1.6, rx: 5.2, ry: 4.4, slot: "skin", z: HZ + 2, views: ["down"] }),
    ell({ id: "bon-frill-s", joint: "head", dx: 4.2, dy: 1.2, rx: 3.4, ry: 5.2, slot: "accent", tone: 1, z: HZ + 1, views: ["side"] }),
    ell({ id: "bon-face-s", joint: "head", dx: 4.4, dy: 1.6, rx: 2.5, ry: 4.2, slot: "skin", z: HZ + 2, views: ["side"] }),
    box({ id: "bon-tieL", joint: "head", dx: -5, dy: 5.4, w: 1, h: 3.4, slot: "accent", tone: -1, z: HZ + 1, views: ["down"] }),
    box({ id: "bon-tieR", joint: "head", dx: 4, dy: 5.4, w: 1, h: 3.4, slot: "accent", tone: -1, z: HZ + 1, views: ["down"] }),
    box({ id: "bon-bow", joint: "head", dx: -2, dy: 5.6, w: 4, h: 1.6, slot: "accent", tone: -1, z: HZ + 1, views: ["down"] }),
    box({ id: "bon-bow-up", joint: "head", dx: -2, dy: 4.4, w: 4, h: 2.4, slot: "accent", tone: -1, z: HZ + 1, views: ["up"] }),
  ]),
  att("hat-bandana", "Bandana", [
    // cloth over the crown, knotted behind with two tails
    ell({ id: "ban-cloth", joint: "head", dy: -4.2, rx: 7.4, ry: 3.3, slot: "accent", z: HZ, views: ["down"] }),
    ell({ id: "ban-cloth-s", joint: "head", dx: -0.8, dy: -4, rx: 7.1, ry: 3.4, slot: "accent", z: HZ, views: ["side"] }),
    ell({ id: "ban-cloth-up", joint: "head", dy: -2.2, rx: 7.5, ry: 5.2, slot: "accent", z: HZ, views: ["up"] }),
    box({ id: "ban-edge", joint: "head", dx: -6.4, dy: -2.2, w: 12.8, h: 1, slot: "accent", tone: -1, z: HZ + 1, views: ["down"] }),
    box({ id: "ban-dot1", joint: "head", dx: -4, dy: -5.4, w: 1, h: 1, slot: "accent", tone: 2, z: HZ + 1, views: ["down"] }),
    box({ id: "ban-dot2", joint: "head", dx: 0, dy: -6.4, w: 1, h: 1, slot: "accent", tone: 2, z: HZ + 1, views: ["down"] }),
    box({ id: "ban-dot3", joint: "head", dx: 3.4, dy: -5, w: 1, h: 1, slot: "accent", tone: 2, z: HZ + 1, views: ["down"] }),
    box({ id: "ban-knot-s", joint: "head", dx: -9, dy: -4.4, w: 3, h: 3, slot: "accent", tone: -1, z: HZ, views: ["side"] }),
    box({ id: "ban-tail-s", joint: "head", dx: -10.6, dy: -2.4, w: 2, h: 4, slot: "accent", tone: -1, z: HZ, views: ["side"] }),
    box({ id: "ban-knot-up", joint: "head", dx: -1.5, dy: -3, w: 3, h: 2.6, slot: "accent", tone: -1, z: HZ + 1, views: ["up"] }),
    box({ id: "ban-tailL-up", joint: "head", dx: -3, dy: -0.6, w: 2, h: 3.4, slot: "accent", tone: -1, z: HZ + 1, views: ["up"] }),
    box({ id: "ban-tailR-up", joint: "head", dx: 1, dy: -0.6, w: 2, h: 3.4, slot: "accent", tone: -1, z: HZ + 1, views: ["up"] }),
    box({ id: "ban-dot-up", joint: "head", dx: -4, dy: -5.4, w: 1, h: 1, slot: "accent", tone: 2, z: HZ + 1, views: ["up"] }),
  ]),
  att("hat-beanie", "Beanie", [
    ell({ id: "bean-dome", joint: "head", dy: -4.4, rx: 6.9, ry: 3, slot: "accent", z: HZ, views: ["down", "side"] }),
    ell({ id: "bean-dome-up", joint: "head", dy: -2.6, rx: 7.3, ry: 6, slot: "accent", z: HZ, views: ["up"] }),
    ell({ id: "bean-cuff", joint: "head", dy: -3, rx: 7.3, ry: 1.3, slot: "accent", tone: 1, z: HZ + 1, views: ["down", "up"] }),
    ell({ id: "bean-cuff-s", joint: "head", dx: -0.8, dy: -3, rx: 7, ry: 1.3, slot: "accent", tone: 1, z: HZ + 1, views: ["side"] }),
    ell({ id: "bean-pom", joint: "head", dy: -7, rx: 1.8, ry: 1.2, slot: "accent", tone: 2, z: HZ + 2, views: ["down", "up"] }),
    ell({ id: "bean-pom-s", joint: "head", dx: -0.8, dy: -7, rx: 1.8, ry: 1.2, slot: "accent", tone: 2, z: HZ + 2, views: ["side"] }),
  ]),
];

// ---------------------------------------------------------------- bags
const SATCHEL_BAG: Joint = {
  id: "satchelBag",
  parent: "hip",
  rest: { down: [9.8, 24.5], side: [13.2, 24.5], up: [22.2, 24.5] },
};
const TZB = 3.4;

const bags: Attachment[] = [
  att("bag-backpack", "Backpack", [
    // front: the pack shows around the body, straps on the chest
    ell({ id: "bp-body", joint: "chest", dy: 1.4, rx: 7, ry: 5.4, slot: "leather", z: 1.5, views: ["down"] }),
    box({ id: "bp-strapL", joint: "chest", dx: -3.4, dy: -2.2, w: 1.3, h: 7.4, slot: "leather", tone: -1, z: CZ, views: ["down"] }),
    box({ id: "bp-strapR", joint: "chest", dx: 2.1, dy: -2.2, w: 1.3, h: 7.4, slot: "leather", tone: -1, z: CZ, views: ["down"] }),
    box({ id: "bp-buckle", joint: "chest", dx: -3.4, dy: 1.6, w: 1, h: 1, slot: "gold", z: CZ2, views: ["down"] }),
    // profile: the pack sits behind the back
    ell({ id: "bp-body-s", joint: "chest", dx: -5, dy: 1.4, rx: 3.6, ry: 5.4, slot: "leather", z: 1.6, views: ["side"] }),
    box({ id: "bp-pocket-s", joint: "chest", dx: -8.4, dy: 3, w: 2.4, h: 3.4, slot: "leather", tone: -1, z: 1.7, views: ["side"] }),
    box({ id: "bp-flap-s", joint: "chest", dx: -7.6, dy: -2.8, w: 5.6, h: 2, slot: "leather", tone: 1, z: 1.7, views: ["side"] }),
    box({ id: "bp-strap-s", joint: "chest", dx: -2.4, dy: -2.2, w: 1.3, h: 6, slot: "leather", tone: -1, z: CZ, views: ["side"] }),
    // back: full pack with flap, pocket and buckle
    ell({ id: "bp-body-up", joint: "chest", dy: 1.6, rx: 7, ry: 6.4, slot: "leather", z: 3.5, views: ["up"] }),
    box({ id: "bp-flap-up", joint: "chest", dx: -6, dy: -3.4, w: 12, h: 3, slot: "leather", tone: 1, z: 3.6, views: ["up"] }),
    box({ id: "bp-pocket-up", joint: "chest", dx: -4, dy: 3.2, w: 8, h: 3.4, slot: "leather", tone: -1, z: 3.6, views: ["up"] }),
    box({ id: "bp-buckle-up", joint: "chest", dx: -0.5, dy: -0.8, w: 1, h: 1.4, slot: "gold", z: 3.7, views: ["up"] }),
  ]),
  att("bag-satchel", "Satchel", [
    limb("sat-strap", "shoulderR", "satchelBag", 0.8, "leather", CZ, -1, ["down", "side"]),
    limb("sat-strap-up", "shoulderL", "satchelBag", 0.8, "leather", CZ, -1, ["up"]),
    box({ id: "sat-body", joint: "satchelBag", dx: -3.2, dy: -2.4, w: 6.4, h: 5.2, slot: "leather", z: TZB }),
    box({ id: "sat-flap", joint: "satchelBag", dx: -3.2, dy: -2.4, w: 6.4, h: 2.4, slot: "leather", tone: 1, z: TZB + 0.1 }),
    box({ id: "sat-clasp", joint: "satchelBag", dx: -0.5, dy: -0.4, w: 1, h: 1, slot: "gold", z: TZB + 0.2, views: ["down", "side"] }),
  ], [SATCHEL_BAG]),
  att("bag-tote", "Tote bag", [
    // canvas bag with leather handles, carried in the right hand (near hand in profile)
    box({ id: "tote-body", joint: "handR", dx: -3, dy: 1.8, w: 6, h: 4.6, slot: "sand", z: TZB, views: ["down", "up"] }),
    box({ id: "tote-stripe", joint: "handR", dx: -3, dy: 3.2, w: 6, h: 1, slot: "cloth2", z: TZB + 0.1, views: ["down", "up"] }),
    box({ id: "tote-handleL", joint: "handR", dx: -1.8, dy: -0.4, w: 1, h: 2.4, slot: "leather", z: TZB - 0.2, views: ["down", "up"] }),
    box({ id: "tote-handleR", joint: "handR", dx: 0.8, dy: -0.4, w: 1, h: 2.4, slot: "leather", z: TZB - 0.2, views: ["down", "up"] }),
    box({ id: "tote-body-s", joint: "handL", dx: -2.6, dy: 1.8, w: 5.2, h: 4.6, slot: "sand", z: TZB, views: ["side"] }),
    box({ id: "tote-stripe-s", joint: "handL", dx: -2.6, dy: 3.2, w: 5.2, h: 1, slot: "cloth2", z: TZB + 0.1, views: ["side"] }),
    box({ id: "tote-handleL-s", joint: "handL", dx: -1.5, dy: -0.4, w: 1, h: 2.4, slot: "leather", z: TZB - 0.2, views: ["side"] }),
    box({ id: "tote-handleR-s", joint: "handL", dx: 0.6, dy: -0.4, w: 1, h: 2.4, slot: "leather", z: TZB - 0.2, views: ["side"] }),
  ]),
];

// ---------------------------------------------------------------- catalog
const existing = (id: string): Attachment => {
  const a = HUMANOID_ATTACHMENTS.find((x) => x.id === id);
  if (!a) throw new Error(`wardrobe: missing existing attachment ${id}`);
  return a;
};
const L = (layer: Layer) => (attachment: Attachment) => ({ layer, attachment });

export const WARDROBE: { layer: Layer; attachment: Attachment }[] = [
  L("face")(FACE),
  ...faceLayers.map(L("face")),
  ...HAIR_STYLES.map((s) => hairAttachment(s)).map(L("hair")),
  ...NEW_HAIR.map((s) => wardrobeHair(s)).map(L("hair")),
  ...costumes.map(L("costume")),
  L("hat")(existing("straw-hat")),
  L("hat")(existing("ngob-hat")),
  ...hats.map(L("hat")),
  L("bag")(existing("basket")),
  ...bags.map(L("bag")),
];

/** Wardrobe attachments new in this file (the existing ones are already registered); for index.ts. */
export const WARDROBE_NEW_ATTACHMENTS: Attachment[] = [...faceLayers, ...NEW_HAIR.map((s) => wardrobeHair(s)), ...costumes, ...hats, ...bags];

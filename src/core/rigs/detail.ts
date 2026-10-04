// Rich detail passes for a finished sprite (#36).
//
// Standard sprites are "pillow shaded": smooth gradients, one ink colour for
// every outline. These passes spend the same pixels more carefully and only run
// on a `detail: "rich"` kit:
//
//   - per-material sel-out: each silhouette edge is inked with its own
//     material's darkest shade instead of one global ink, and overlapping parts
//     get an inner seam so they separate;
//   - anti-aliasing: an in-between tone on the diagonal steps of a curved
//     silhouette, only where it rounds a real curve, so the pass adds no noise;
//   - rim light: one lighter step on the edge facing away from the light, which
//     is what stops the shadow side reading as flat.
//
// Every pass writes palette indices only, so the result can never leave the kit's
// palette, and every pass is gated on `kit.detail` so standard output is
// byte-identical. Ground tiles never reach here: they are un-outlined by
// contract and would lose their seamlessness to the AA band.
//
// Each pass is a pure `shape -> Map<index, index>` so the geometry every pass
// reads is always the un-outlined body. That matters: once the ink ring exists,
// an empty neighbour no longer marks the silhouette, so a pass reading the
// outlined sprite would treat the outline as part of the body.

import { colorIndex, decodeIndex, type Material } from "../palette";
import { cloneSprite } from "../sprite";
import type { PartDef, View } from "../rig";
import type { Sprite, StyleKit } from "../types";

const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;
/** Diagonals only: a diagonal-only contact is what makes an edge read as a curve. */
const DIAG = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/** Pixel index -> palette index, in application order. */
export type Marks = Map<number, number>;

const at = (s: Sprite, x: number, y: number): number => (x < 0 || y < 0 || x >= s.w || y >= s.h ? 0 : s.data[y * s.w + x]);

export interface MaterialRule {
  /** Material whose level 0 inks this one's silhouette. */
  ink: Material;
  /** Rim-light a step lighter along the silhouette; 0 disables. */
  rim: number;
}

/**
 * Per-material ink and rim strength. Organic and cloth materials take a rim
 * (that is where the PixelLab read comes from); terrain-ish ones do not, because
 * a bright rim on grass or water is noise at 16px. Ink is never re-inked or
 * rimmed — it *is* the outline.
 */
const RULES: Record<Material, MaterialRule> = {
  ink: { ink: "ink", rim: 0 },
  skin: { ink: "skin", rim: 1 },
  hair: { ink: "hair", rim: 1 },
  cloth: { ink: "cloth", rim: 1 },
  cloth2: { ink: "cloth2", rim: 1 },
  leather: { ink: "leather", rim: 1 },
  metal: { ink: "metal", rim: 1 },
  gold: { ink: "gold", rim: 1 },
  wood: { ink: "wood", rim: 0 },
  stone: { ink: "stone", rim: 0 },
  roof: { ink: "roof", rim: 0 },
  foliage: { ink: "foliage", rim: 0 },
  grass: { ink: "grass", rim: 0 },
  dirt: { ink: "dirt", rim: 0 },
  sand: { ink: "sand", rim: 0 },
  water: { ink: "water", rim: 0 },
  accent: { ink: "accent", rim: 1 },
  ui: { ink: "ui", rim: 0 },
};

const ruleOf = (m: Material): MaterialRule => RULES[m];

/** Move a palette index along its own ramp, clamped to the 5 steps. */
function shift(idx: number, steps: number): number {
  const d = decodeIndex(idx);
  if (!d) return idx;
  return colorIndex(d.mat, Math.max(0, Math.min(4, d.level + steps)));
}

/**
 * Materials the passes may rim: what the sprite paints with, plus the four
 * character materials as fallbacks so a part that ends up mostly one colour
 * still gets a sensible band next to a neighbour of another material.
 */
function materialsIn(s: Sprite): Set<Material> {
  const set = new Set<Material>();
  for (const v of s.data) {
    const d = decodeIndex(v);
    if (d) set.add(d.mat);
  }
  for (const m of ["skin", "cloth", "hair", "wood"] as const) set.add(m);
  return set;
}

/**
 * Per-material sel-out: every empty pixel beside the body takes the darkest
 * shade of the material it touches, instead of one global ink colour.
 *
 * `inside` limits the ring to the one the standard pass would have drawn, so a
 * rich sprite is exactly as large as its standard twin. Growing the silhouette
 * by a pixel is not "more detail": it changes the character's footprint in the
 * world, which is the one thing every asset in a kit has to agree on.
 */
export function selOutMarks(shape: Sprite, kit: StyleKit, inside?: Set<number>): Marks {
  const marks: Marks = new Map();
  if (kit.outline === "none") return marks;
  for (let y = 0; y < shape.h; y++)
    for (let x = 0; x < shape.w; x++) {
      const v = at(shape, x, y);
      if (!v) continue;
      const d = decodeIndex(v)!;
      if (d.level === 0) continue; // already the ink of its own material; nothing to change
      for (const [dx, dy] of N4) {
        if (at(shape, x + dx, y + dy)) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= shape.w || ny >= shape.h) continue;
        const idx = ny * shape.w + nx;
        if (inside && !inside.has(idx)) continue;
        marks.set(idx, colorIndex(ruleOf(d.mat).ink, 0));
      }
    }
  return marks;
}

/** The 1px ring `applyOutline` would draw around this shape. */
export function outlineRing(shape: Sprite): Set<number> {
  const ring: Set<number> = new Set();
  for (let y = 0; y < shape.h; y++)
    for (let x = 0; x < shape.w; x++) {
      if (at(shape, x, y)) continue;
      for (const [dx, dy] of N4)
        if (at(shape, x + dx, y + dy)) {
          ring.add(y * shape.w + x);
          break;
        }
    }
  return ring;
}

/**
 * Inner sel-out: where one part sits *in front of* another, one line of ink keeps
 * them apart at 1x.
 *
 * This is the pass that had to be constrained hardest. The obvious version — ink
 * every contact between two different materials — is wrong, and provably so: a
 * 32px character is mostly *internal* material boundaries (skin against hair,
 * cloth against skin, boot against leg), so that version fired on ~200 pixels
 * and painted a dark band across the face, over the eyes and through the torso.
 * An overlap edge and two merely adjacent parts are indistinguishable in the
 * finished image, because a palette index carries no draw order. (The rig does
 * carry one, in each part's `z`; wiring that through is lane D's `rig.ts`.)
 *
 * So the seam is drawn only where a material boundary also touches the outside
 * of the shape — a part whose edge is part of the silhouette and whose other
 * side butts against a different material. That is a hat brim over hair, a cape
 * over a shoulder, a boot against a leg: exactly the overlaps an artist inks.
 * A face next to a hat has no silhouette contact, so it is never touched, and an
 * internal join like eye-against-skin never qualifies either.
 */
export function seamMarksFor(shape: Sprite, light: [number, number, number]): Marks {
  const marks: Marks = new Map();
  for (let y = 0; y < shape.h; y++)
    for (let x = 0; x < shape.w; x++) {
      const v = at(shape, x, y);
      if (!v) continue;
      const d = decodeIndex(v)!;
      // face features are ink by definition; never re-ink them or their edges
      if (d.mat === "ink") continue;
      for (const [dx, dy] of N4) {
        const nv = at(shape, x + dx, y + dy);
        if (!nv) continue;
        const nd = decodeIndex(nv)!;
        if (nd.mat === d.mat || nd.mat === "ink") continue;
        // the other side of this boundary must be part of the silhouette, and on
        // the shadow side, which is where an artist puts the separating line
        const outside = at(shape, x + dx * 2, y + dy * 2);
        if (outside) continue;
        if (dx * light[0] + dy * light[1] > 0.3) continue;
        const idx = (y + dy) * shape.w + (x + dx);
        const held = marks.get(idx);
        // where two materials claim the same pixel, the darker side's ink wins so
        // the crease reads as one continuous line rather than a dither
        if (held === undefined || d.level < decodeIndex(held)!.level) marks.set(idx, colorIndex(ruleOf(d.mat).ink, 0));
      }
    }
  return marks;
}

/**
 * Anti-alias the curved silhouette. A pixel with no straight neighbour on the
 * body and exactly one diagonal neighbour sits on a curve, so it takes one step
 * *below that neighbour's own shade* — the in-between tone that rounds a head or
 * a hat brim off at 32px.
 *
 * Deriving the band from the neighbour's level is the whole trick. A constant
 * per-material level looks correct in the abstract and paints a dark smear in
 * practice, because a lit edge is usually already level 3-4: a level-2 band on
 * such an edge is a hard dark line, not a soft step. Two diagonals is a concave
 * notch rather than a rounded curve, so it is left alone.
 */
export function aaMarks(shape: Sprite, inside?: Set<number>): Marks {
  const marks: Marks = new Map();
  for (let y = 0; y < shape.h; y++)
    for (let x = 0; x < shape.w; x++) {
      const here = y * shape.w + x;
      if (at(shape, x, y)) continue; // inside the body, not on the silhouette
      if (inside && !inside.has(here)) continue; // never grow past the outline ring
      let ortho = 0;
      let near: { mat: Material; level: number } | null = null;
      for (const [dx, dy] of N4) {
        const v = at(shape, x + dx, y + dy);
        if (!v) continue;
        ortho++;
        const d = decodeIndex(v)!;
        // remember the closest body shade, so the band sits just under the edge
        if (!near || d.level > near.level) near = { mat: d.mat, level: d.level };
      }
      if (ortho) continue; // a straight neighbour means a flat run, not a curve
      let diagonal = 0;
      let edge: { mat: Material; level: number } | null = null;
      for (const [dx, dy] of DIAG) {
        const v = at(shape, x + dx, y + dy);
        if (!v) continue;
        diagonal++;
        const d = decodeIndex(v)!;
        if (!edge || d.level > edge.level) edge = { mat: d.mat, level: d.level };
      }
      if (diagonal !== 1 || !edge || !near) continue;
      // level 1 is already the ink; anything at or below it has no room to ease
      const band = Math.max(1, edge.level - 1);
      if (band >= edge.level) continue;
      marks.set(here, colorIndex(edge.mat, band));
    }
  return marks;
}

/**
 * Rim light: one lighter step along the body's *outer* edge where that edge faces
 * away from the light, which is what stops the shadow side of a volume reading
 * flat.
 *
 * "Outer edge" means the body pixel borders empty space. On a 32px figure almost
 * every silhouette pixel borders another body pixel, so the pass has to be
 * narrow on purpose: only the darkest-but-one shades get a rim (a level-4 pixel
 * is already a highlight, and level 0 is the ink), and only materials that want
 * it. A rim on terrain-ish materials is noise at 16px, so their rule sets rim 0.
 */
export function rimMarks(shape: Sprite, light: [number, number, number], used: Set<Material> = materialsIn(shape)): Marks {
  const marks: Marks = new Map();
  for (let y = 0; y < shape.h; y++)
    for (let x = 0; x < shape.w; x++) {
      const v = at(shape, x, y);
      if (!v) continue;
      const d = decodeIndex(v)!;
      if (!ruleOf(d.mat).rim || !used.has(d.mat)) continue;
      if (d.level <= 1 || d.level >= 4) continue;
      // on the shadow side if the empty space it borders faces away from the light
      let away = false;
      let edge = false;
      for (const [dx, dy] of N4) {
        if (at(shape, x + dx, y + dy)) continue;
        edge = true;
        if (dx * light[0] + dy * light[1] > 0.3) away = true;
      }
      if (edge && away) marks.set(y * shape.w + x, shift(v, 1));
    }
  return marks;
}

/**
 * The whole rich pass. Order is fixed and load-bearing: the seam ink lands inside
 * the body, the sel-out ink just outside it, the AA band then replaces that ink on
 * the curved steps only, and the rim light lands last on the body's own edge.
 * Geometry is read from `shape` throughout, so no pass is confused by what an
 * earlier one wrote.
 */
export function richDetail(s: Sprite, kit: StyleKit, light: [number, number, number]): Sprite {
  const out = cloneSprite(s);
  // the ring the standard outline would have drawn: the sel-out ink and the AA
  // band both stay inside it, so rich art occupies exactly the standard footprint
  const ring = kit.outline === "none" ? undefined : outlineRing(s);
  for (const marks of [seamMarksFor(s, light), selOutMarks(s, kit, ring), aaMarks(s, ring), rimMarks(s, light)])
    for (const [idx, v] of marks) out.data[idx] = v;
  return out;
}

// ---------- micro-detail parts (humanoids) ----------
//
// Issue #36 asks for detail "at the same resolution", which means spending the
// pixels a 32px figure already has rather than drawing more of them. These are
// the classic one-pixel cues that do that: an eye highlight, a nose shade, a
// fold at each elbow and knee, a shirt seam and pocket, a specular band in the
// hair, and a sole under each boot.
//
// They are ordinary rig parts, so they pose and flip with the animation and cost
// nothing at standard detail: the generator only attaches them on a rich kit.

const B = (id: string, o: Record<string, unknown>): PartDef => ({ id, kind: "box", ...o }) as PartDef;

/**
 * Micro-detail for a humanoid, on the 32-unit rig grid. `z` slots above the body
 * they annotate and below the face (which the generator draws at z 30), so a hat
 * brim still covers hair but never a fold.
 */
export function microDetailParts(opts: { tw: number; eyeZ: number; female?: boolean; views?: View[] }): PartDef[] {
  const { tw, eyeZ } = opts;
  const front = opts.views ?? ["down", "side"];
  const P: PartDef[] = [
    // a single white pixel in each eye: the cue that makes a face read as alive
    B("detail-eyeL-glint", { joint: "head", dx: -3, dy: -2, w: 1, h: 1, slot: "ui", z: eyeZ + 1, views: ["down"] }),
    B("detail-eyeR-glint", { joint: "head", dx: 2, dy: -2, w: 1, h: 1, slot: "ui", z: eyeZ + 1, views: ["down"] }),
    B("detail-eyeS-glint", { joint: "head", dx: 3, dy: -2, w: 1, h: 1, slot: "ui", z: eyeZ + 1, views: ["side"] }),
    // nose: one shade under the brow, offset toward the light
    B("detail-nose", { joint: "head", dx: -0.5, dy: 0.5, w: 1, h: 1, slot: "skin", tone: -1, z: eyeZ + 1, views: ["down"] }),
    B("detail-noseS", { joint: "head", dx: 3, dy: 0.5, w: 1, h: 1, slot: "skin", tone: -1, z: eyeZ + 1, views: ["side"] }),
    // cloth folds at the elbows and knees
    B("detail-fold-elbowL", { joint: "elbowL", dx: -0.5, dy: -0.5, w: 1, h: 1, slot: "top", tone: -1, z: 3.2 }),
    B("detail-fold-elbowR", { joint: "elbowR", dx: -0.5, dy: -0.5, w: 1, h: 1, slot: "top", tone: -1, z: 3.2 }),
    B("detail-fold-kneeL", { joint: "kneeL", dx: -0.5, dy: -0.5, w: 1, h: 1, slot: "bottom", tone: -1, z: 1.2 }),
    B("detail-fold-kneeR", { joint: "kneeR", dx: -0.5, dy: -0.5, w: 1, h: 1, slot: "bottom", tone: -1, z: 1.2 }),
    // overall seams and a pocket: vertical line down the shirt, one pocket pixel
    B("detail-seam", { joint: "chest", dx: 0, dy: 1.5, w: 1, h: 3, slot: "top", tone: -1, z: 2.2, views: front }),
    B("detail-pocket", { joint: "chest", dx: -tw / 2 + 1, dy: 2.5, w: 2, h: 1, slot: "top", tone: -1, z: 2.2, views: ["down"] }),
    // a specular band across the hair, above the fringe shadow
    B("detail-hair-spec", { joint: "head", dx: -3, dy: -4.5, w: 6, h: 1, slot: "hair", tone: 1, z: 5.5, views: ["down", "side"] }),
    // boot soles: one dark row hugging the bottom of each boot, and a lace pixel
    // above it. The sole sits *inside* the boot's own footprint (dy 0.4, not past
    // its bottom edge) so rich detail never moves a foot in the world.
    B("detail-soleL", { joint: "footL", dx: -2.5, dy: 0.4, w: 5, h: 1, slot: "boots", tone: -2, z: 1.6, views: front }),
    B("detail-soleR", { joint: "footR", dx: -2.5, dy: 0.4, w: 5, h: 1, slot: "boots", tone: -2, z: 1.6, views: front }),
    B("detail-laceL", { joint: "footL", dx: -0.5, dy: -0.5, w: 2, h: 1, slot: "boots", tone: 1, z: 1.7, views: ["down"] }),
    B("detail-laceR", { joint: "footR", dx: -0.5, dy: -0.5, w: 2, h: 1, slot: "boots", tone: 1, z: 1.7, views: ["down"] }),
  ];
  return P;
}
// Costume trim for rich / 48px characters (issue #38): collars, cuffs, rolled sleeves, pockets,
// dress seams and hems, sarong folds. Everything is a lit part in a slot ramp (tone-shifted), added
// after the costume attachment; see shapes.ts for the gate.
import type { Attachment, PartDef } from "../rig";

type V = NonNullable<PartDef["views"]>;
const Z = 2.9;
const box = (id: string, joint: string, dx: number, dy: number, w: number, h: number, slot: string, tone: number, views: V | undefined, z = Z): PartDef =>
  ({ id, kind: "box", joint, dx, dy, w, h, slot, tone, z, ...(views ? { views } : {}) }) as PartDef;
const ell = (id: string, joint: string, dx: number, dy: number, rx: number, ry: number, slot: string, tone: number, views: V | undefined, z = Z, flat?: number): PartDef =>
  ({ id, kind: "ellipse", joint, dx, dy, rx, ry, slot, tone, z, flat, ...(views ? { views } : {}) }) as PartDef;

const D: V = ["down"];

export interface WearOpts {
  /** Costume param value ("none", "overalls", ...). */
  costume: string;
  /** Torso width on the grid (see `torsoWidth`). */
  tw: number;
  /** Arm radius on the grid (see `armRadius`). */
  arm: number;
  /** Seeded: a pointed shirt collar instead of a round neck where the costume leaves the neck bare. */
  collar: boolean;
  /** Overalls / smock sleeves are rolled to the elbow. */
  age: string;
}

/** Pointed shirt collar: two stepped lapels around a V of skin. */
function shirtCollar(): PartDef[] {
  return [
    box("wx-vneck0", "chest", -1.6, -2.4, 3.2, 1, "skin", -1, D),
    box("wx-vneck1", "chest", -0.8, -1.4, 1.6, 1, "skin", -1, D),
    box("wx-lapelL0", "chest", -3.6, -2.4, 2.2, 1, "top", 2, D),
    box("wx-lapelL1", "chest", -3.0, -1.4, 1.8, 1, "top", 2, D),
    box("wx-lapelL2", "chest", -2.4, -0.4, 1.2, 0.8, "top", 1, D),
    box("wx-lapelR0", "chest", 1.4, -2.4, 2.2, 1, "top", 2, D),
    box("wx-lapelR1", "chest", 1.2, -1.4, 1.8, 1, "top", 2, D),
    box("wx-lapelR2", "chest", 1.2, -0.4, 1.2, 0.8, "top", 1, D),
    box("wx-vneckS", "chest", 1.4, -2.4, 2, 1, "top", 2, ["side"]),
  ];
}
/** Round neckline: a ring of ribbing around a patch of skin. */
function roundNeck(): PartDef[] {
  return [
    ell("wx-neck-rim", "chest", 0, -2.2, 3.1, 1.7, "top", 1, D, Z - 0.05, 0.4),
    ell("wx-neck-hole", "chest", 0, -2.5, 2.2, 1.2, "skin", -1, D, Z, 0.4),
    ell("wx-neck-rim-s", "chest", 1.2, -2.2, 2, 1.6, "top", 1, ["side"], Z - 0.05, 0.4),
  ];
}

/** Cuffs at the wrists; rolled sleeves also show the forearm skin below a thick band at the elbow. */
function sleeves(arm: number, rolled: boolean): PartDef[] {
  const out: PartDef[] = [];
  for (const [j, views] of [["handL", undefined], ["handR", ["down", "up", "down-side", "up-side"] as V]] as const) {
    if (rolled) {
      // sleeve rolled to the elbow: skin forearm under a thick lit band and a shadow line
      out.push(
        ell(`wx-fore-${j}`, j, 0, -1.2, arm * 0.85, 2.2, "skin", 0, views as V | undefined, 3.02, 0.3),
        ell(`wx-roll-${j}`, j, 0, -3.6, arm + 0.5, 1.0, "top", 1, views as V | undefined, 3.04, 0.3),
        ell(`wx-rollshade-${j}`, j, 0, -2.7, arm + 0.2, 0.45, "top", -1, views as V | undefined, 3.03, 0.3),
      );
    } else {
      out.push(
        ell(`wx-cuff-${j}`, j, 0, -1.15, arm + 0.35, 0.85, "top", 1, views as V | undefined, 3.05),
        ell(`wx-cuffshade-${j}`, j, 0, -0.4, arm + 0.2, 0.4, "top", -1, views as V | undefined, 3.04),
      );
    }
  }
  return out;
}

/** Extra trim for a costume choice (collars, cuffs, pockets, seams, hems, folds). */
export function shapedWear(o: WearOpts): Attachment {
  const c = o.costume;
  const P: PartDef[] = [];
  const rolled = c === "overalls" || c === "smock";
  if (c !== "sweater") P.push(...sleeves(o.arm, rolled));
  if (c === "none" || c === "overalls" || c === "smock") P.push(...(o.collar || c === "overalls" ? shirtCollar() : roundNeck()));
  else if (c === "apron" || c === "sarong") P.push(...roundNeck());

  if (c === "overalls") {
    P.push(
      // bib seam, pocket stitching, buckles on the straps
      box("wx-bib-top", "chest", -3.5, 0.2, 7, 0.7, "bottom", 1, D),
      box("wx-pocket-l", "chest", -2, 2.4, 0.7, 2, "bottom", -2, D, 2.85),
      box("wx-pocket-r", "chest", 1.3, 2.4, 0.7, 2, "bottom", -2, D, 2.85),
      box("wx-pocket-b", "chest", -2, 4.1, 4, 0.7, "bottom", -2, D, 2.85),
      box("wx-pocket-t", "chest", -2, 2.4, 4, 0.7, "bottom", 2, D, 2.86),
      box("wx-buckleL", "chest", -3.5, -1.4, 1.4, 1, "gold", 0, D, 2.86),
      box("wx-buckleR", "chest", 2.1, -1.4, 1.4, 1, "gold", 0, D, 2.86),
    );
  } else if (c === "apron") {
    P.push(
      box("wx-ap-pocket-l", "chest", -2, 5.8, 0.7, 2, "accent", -2, D, 2.85),
      box("wx-ap-pocket-r", "chest", 1.3, 5.8, 0.7, 2, "accent", -2, D, 2.85),
      box("wx-ap-pocket-t", "chest", -2, 5.8, 4, 0.7, "accent", 2, D, 2.86),
      box("wx-ap-hem", "chest", -4, 7.4, 8, 0.7, "accent", 2, D, 2.86),
      box("wx-ap-bib-top", "chest", -3, -0.6, 6, 0.7, "accent", 2, D, 2.86),
      // tie bow at the waist
      box("wx-ap-bowL", "chest", -5.8, 3.0, 1.6, 1.8, "accent", 1, D, 2.9),
      box("wx-ap-bowR", "chest", 4.2, 3.0, 1.6, 1.8, "accent", 1, D, 2.9),
    );
  } else if (c === "smock") {
    P.push(
      box("wx-sm-pocket-l", "chest", -4, 4.6, 0.7, 2.4, "top", -2, D, 2.85),
      box("wx-sm-pocket-b", "chest", -4, 6.3, 3, 0.7, "top", -2, D, 2.85),
      box("wx-sm-pocket-t", "chest", -4, 4.6, 3, 0.7, "top", 2, D, 2.86),
      box("wx-sm-yoke", "chest", -4.6, 0.2, 9.2, 0.7, "top", -1, D, 2.85),
    );
  } else if (c === "dress") {
    P.push(
      // bodice seam under the bust, gathers, scalloped hem with a trim line, flat collar
      box("wx-dr-seam", "chest", -4.2, 3.4, 8.4, 0.7, "top", -2, D, 2.85),
      box("wx-dr-gather0", "hip", -3.6, 0.8, 0.7, 3, "top", -1, D, 2.85),
      box("wx-dr-gather1", "hip", -0.3, 1, 0.7, 3, "top", -1, D, 2.85),
      box("wx-dr-gather2", "hip", 3.0, 0.8, 0.7, 3, "top", -1, D, 2.85),
      box("wx-dr-trim", "hip", -6.2, 3.1, 12.4, 0.8, "accent", 1, D, 2.9),
      ...[-4.6, -1.6, 1.4, 4.6].map((dx, i) => ell(`wx-dr-scallop${i}`, "hip", dx, 4.5, 1.6, 0.8, "top", 1, D, 2.9)),
      box("wx-dr-trim-s", "hip", -5, 3.1, 10, 0.8, "accent", 1, ["side"], 2.9),
      ell("wx-dr-collar", "chest", 0, -1.9, 3.8, 1.5, "accent", 1, D, 2.95, 0.4),
      ell("wx-dr-collar-hole", "chest", 0, -2.4, 2.2, 1.1, "skin", -1, D, 3.0, 0.4),
    );
  } else if (c === "sarong") {
    // wrapped fold: a stepped diagonal from the knot to the hem, with a lit edge beside it, and a rolled waist
    for (let i = 0; i < 5; i++) {
      P.push(box(`wx-sa-fold${i}`, "hip", 0.4 - i * 0.7, 0.8 + i * 1.0, 0.8, 1.2, "accent", -2, D, 2.85));
      P.push(box(`wx-sa-foldhi${i}`, "hip", 1.2 - i * 0.7, 0.8 + i * 1.0, 0.8, 1.2, "accent", 2, D, 2.85));
    }
    P.push(
      ell("wx-sa-roll", "hip", 0, -0.7, 5.6, 1.1, "accent", 1, D, 2.9, 0.4),
      box("wx-sa-hem", "hip", -5, 5.0, 10, 0.7, "accent", -1, D, 2.85),
      box("wx-sa-fold-s", "hip", -3.4, 1.6, 0.7, 3.6, "accent", -2, ["side"], 2.85),
    );
  }
  return { id: `wear-${c}`, name: `Costume trim (${c})`, parts: P };
}

// Richer character forms (issue #38): shaped hands, face (big eyes, brows, mouths, expressions),
// hair clumps, costume trim and fabric patterns. Everything here is opt-in:
//   shapesOn(kit, size)  rich kits (>= 24px) and any character canvas >= 48px
// so 32px standard-kit output never changes. Forms are declarative parts (boxes/ellipses on the
// lit Painter, tone-shifted from the slot's ramp; `pixels` only for hands/eyes where 1px control
// matters) and a sprite post-pass for fabric patterns, so every colour still comes from a ramp.
import { lightVector } from "../kit";
import { buildLegend } from "../legend";
import { colorIndex, type Material } from "../palette";
import type { Attachment, PartDef } from "../rig";
import type { StyleKit } from "../types";
import { RICH_MIN_SIZE } from "./detail";

export const SHAPES_MIN_SIZE = 48;
export const EXPRESSIONS = ["neutral", "happy", "surprised", "tired"] as const;
export type Expression = (typeof EXPRESSIONS)[number];
export const PATTERNS = ["none", "plaid", "stripes", "polka", "gingham"] as const;
export type Pattern = (typeof PATTERNS)[number];

/** Shaped hands/hair/collars/faces: rich kits from 24px up, and every canvas of 48px or more. */
export const shapesOn = (kit: StyleKit, size: number): boolean => size >= SHAPES_MIN_SIZE || (kit.detail === "rich" && size >= RICH_MIN_SIZE);
/** Big (2x3) eyes need room: 48px canvases. */
export const bigFaceOn = (size: number): boolean => size >= 40;

const LEVELS: Record<number, number[]> = { 2: [1, 3], 3: [1, 2, 3], 4: [1, 2, 3, 4], 5: [0, 1, 2, 3, 4] };
/** Ramp levels the kit's painter uses (darkest first). */
export const kitLevels = (kit: StyleKit): number[] => LEVELS[Math.max(2, Math.min(5, Math.round(kit.shadeSteps)))];

/** Symbolic pixel art: each letter maps to [material, level]; '.' is transparent. */
type Dict = Record<string, [Material, number]>;
function art(kit: StyleKit, dict: Dict, rows: string[]): string[] {
  const legend = buildLegend(kit);
  return rows.map((r) => [...r].map((c) => {
    const e = dict[c];
    return e ? (legend.byIndex.get(colorIndex(e[0], Math.max(0, Math.min(4, e[1])))) ?? ".") : ".";
  }).join(""));
}
const flipRows = (rows: string[]) => rows.map((r) => [...r].reverse().join(""));

type Rows = Extract<PartDef, { kind: "pixels" }>["rows"];
const pixelsPart = (id: string, joint: string, rows: Rows, anchor: [number, number], z: number, views?: PartDef["views"]): PartDef =>
  ({ id, kind: "pixels", joint, rows, anchor, z, ...(views ? { views } : {}) }) as PartDef;

// ---------------------------------------------------------------- hands
/** Skin ramp levels for hand shading: light / mid / shade / gap. */
function skinLevels(kit: StyleKit) {
  const L = kitLevels(kit), n = L.length;
  return { h: L[n - 1], m: L[n - 2], s: L[Math.max(0, n - 3)], d: L[0] };
}

/**
 * Hands with a thumb and a finger cluster instead of round blobs. Replaces the rig's `handLp` /
 * `handRp` parts (same ids). Highlight sits on the light side in the front view and on top elsewhere
 * (pixel parts mirror for left views, so a sideways highlight would flip with them).
 */
export function handsAttachment(kit: StyleKit, size: number, skin: Material): Attachment {
  const big = size >= 40;
  const { h, m, s, d } = skinLevels(kit);
  const dict: Dict = { h: [skin, h], m: [skin, m], s: [skin, s], d: [skin, d], t: [skin, m] };
  const A = (rows: string[]) => art(kit, dict, rows);
  // authored with the thumb on the right (inner side of the viewer-left hand)
  const downL = big
    ? ["..hhm.", ".hhmmm", ".hmmmm", ".mmmmt", "smmmmt", "sdsdm.", ".sdsd."]
    : ["hmm.", "mmmt", "mmms", "sds."];
  const sideL = big
    ? [".hhmm.", "hhmmmm", "hmmmmt", "mmmmmt", "smmmm.", ".sdsd."]
    : ["hmm.", "mmmt", "mmm.", ".ss."];
  const upL = big
    ? [".hhmm.", "hhmmmm", "hmmmms", "mmmmms", "sdsdss", ".ssss."]
    : ["hmm.", "mmms", "mmms", ".ss."];
  const dl = A(downL), dr = A(flipRows(downL)), sl = A(sideL), ul = A(upL);
  const w = (rows: string[]) => Math.max(...rows.map((r) => r.length));
  const anchor = (rows: string[]): [number, number] => [w(rows) >> 1, (rows.length >> 1) - 1];
  const z = 3.1;
  return {
    id: "hands-shaped",
    name: "Shaped hands",
    parts: [
      pixelsPart("handLp", "handL", { down: dl, side: sl, up: ul, "down-side": dl, "up-side": ul }, anchor(dl), z),
      pixelsPart("handRp", "handR", { down: dr, side: sl, up: ul, "down-side": sl, "up-side": ul }, anchor(dl), z, ["down", "up", "down-side", "up-side"]),
    ],
  };
}

// ---------------------------------------------------------------- face
type Cell = [dx: number, dy: number, w: number, h: number, slot: string, tone: number];
const ink = (dx: number, dy: number, w: number, h: number, tone = -2): Cell => [dx, dy, w, h, "ink", tone];
const skinC = (dx: number, dy: number, w: number, h: number, tone: number): Cell => [dx, dy, w, h, "skin", tone];
const browC = (dx: number, dy: number, w: number): Cell => [dx, dy, w, 1, "hair", -2];

/** Pixel-exact box: offsets are output pixels from the head joint, so one table serves any size. */
function pbox(k: number, id: string, c: Cell, z: number, views: PartDef["views"], noDiag: boolean): PartDef {
  const [dx, dy, w, h, slot, tone] = c;
  return { id, kind: "box", joint: "head", dx: dx / k, dy: dy / k, w: w / k, h: h / k, slot, tone, z, views, ...(noDiag ? { noDiag: true } : {}) } as PartDef;
}

/** Big eyes (>= 40px): 2x3 dark with a highlight pixel and a lighter lower iris row. `hx` = highlight column. */
function bigEye(e: Expression, x: number, w: number, hx: number): { eye: Cell[]; hi: Cell[] } {
  if (e === "happy") return { eye: w === 1 ? [ink(x, 0, 1, 1)] : [ink(x + ((w - 1) >> 1), -1, 1, 1), ink(x, 0, 1, 1), ink(x + w - 1, 0, 1, 1)], hi: [] };
  if (e === "tired") return { eye: [skinC(x, -1, w, 1, -2), ink(x, 0, w, 1), skinC(x, 1, w, 1, -1)], hi: [] };
  const top = e === "surprised" ? -2 : -1, h = e === "surprised" ? 4 : 3;
  return { eye: [ink(x, top, w, h), ink(x, top + h - 1, w, 1, 0)], hi: [[hx, top, 1, 1, "ui", 1]] };
}
const browY = (e: Expression, big: boolean) => (big ? { neutral: -3, happy: -4, surprised: -5, tired: -2 }[e] : { neutral: -3, happy: -3, surprised: -4, tired: -3 }[e]);
function browCells(e: Expression, x: number, y: number, w: number, innerRight: number): Cell[] {
  if (e === "tired") return innerRight > 0 ? [browC(x, y + 1, w - 1), browC(x + w - 1, y, 1)] : [browC(x, y, 1), browC(x + 1, y + 1, w - 1)];
  return [browC(x, y, w)];
}
/** Mouth whose footprint starts at column x (big: 2-4 wide at row 6; small: 1-3 wide at row 2). */
function mouthCells(e: Expression, x: number, fem: boolean, big: boolean): Cell[] {
  const slot = fem ? "accent" : "skin", t = fem ? 0 : -2;
  const c = (dx: number, dy: number, w: number, h: number, tone = t): Cell => [dx, dy, w, h, slot, tone];
  if (big) {
    if (e === "happy") return [c(x, 4, 1, 1), c(x + 1, 5, 2, 1), c(x + 3, 4, 1, 1)];
    if (e === "surprised") return [ink(x + 1, 5, 2, 2, -1), [x + 1, 6, 2, 1, "accent", -1]];
    if (e === "tired") return [c(x + 1, 6, 2, 1, t + 1)];
    return [c(x + 1, 5, 2, 1)];
  }
  if (e === "happy") return [c(x, 1, 1, 1), c(x + 1, 2, 1, 1), c(x + 2, 1, 1, 1)];
  if (e === "surprised") return [ink(x + 1, 2, 1, 2, -1)];
  if (e === "tired") return [c(x + 1, 3, 1, 1)];
  return [c(x + 1, 2, fem ? 2 : 1, 1)];
}

export interface FaceOpts {
  kit: StyleKit;
  size: number;
  expression: Expression;
  /** Female cue: lips are accent-coloured and drawn here instead of the plain mouth. */
  fem?: boolean;
  /** Widen the eye spacing by one pixel (seeded wide eyes). */
  wide?: boolean;
  /** Seeded blush on the cheeks (happy always blushes). */
  blush?: boolean;
  z: number;
}

/**
 * Eyes, brows, nose and mouth for a chosen expression, as pixel-exact boxes. At >= 40px the eyes are
 * 2x3 with a highlight; below that (rich 32) the existing 1x2 rich eyes stay and only brows and the
 * mouth shape are added. Ids start with `fx-` (a front feature, so they hide in the back 3/4 view).
 */
export function faceParts(o: FaceOpts): PartDef[] {
  const k = o.size / 32, big = bigFaceOn(o.size), e = o.expression, ex = o.wide ? 1 : 0;
  const lit = Math.sign(lightVector(o.kit.lightDir)[0]) || -1;
  const out: PartDef[] = [];
  type V = { eyes: [number, number][]; mouth: number; nose?: number; views: PartDef["views"]; noDiag: boolean; sfx: string };
  const views: V[] = big
    ? [
        { eyes: [[-5 - ex, 2], [3 + ex, 2]], mouth: -2, nose: 0, views: ["down"], noDiag: false, sfx: "" },
        { eyes: [[4, 2]], mouth: 6, views: ["side"], noDiag: true, sfx: "S" },
        { eyes: [[-1, 2], [5, 1]], mouth: 1, nose: 3, views: ["down-side"], noDiag: false, sfx: "D" },
      ]
    : [
        { eyes: [[-3 - ex, 1], [2 + ex, 1]], mouth: -1, views: ["down"], noDiag: false, sfx: "" },
        { eyes: [[3, 1]], mouth: 4, views: ["side"], noDiag: true, sfx: "S" },
        { eyes: [[0, 1], [4, 1]], mouth: 1, views: ["down-side"], noDiag: false, sfx: "D" },
      ];
  for (const v of views) {
    const eye: Cell[] = [], hi: Cell[] = [], brow: Cell[] = [];
    v.eyes.forEach(([x, w], i) => {
      const innerRight = v.eyes.length === 2 ? (i === 0 ? 1 : -1) : -1;
      if (big) {
        const b = bigEye(e, x, w, lit < 0 || w === 1 ? x : x + w - 1);
        eye.push(...b.eye);
        hi.push(...b.hi);
      } else if (e === "tired") eye.push(skinC(x, 1, 1, 1, -1));
      const bw = big ? (w === 1 ? 2 : 3) : 2;
      brow.push(...browCells(e, big ? x - (w === 2 ? 1 : 0) : x - 1 + (w === 1 && x > 0 ? 1 : 0), browY(e, big), bw, innerRight));
    });
    const put = (id: string, cells: Cell[], z: number) => cells.forEach((c, i) => out.push(pbox(k, `fx-${id}${v.sfx}${i}`, c, z, v.views, v.noDiag)));
    put("eye", eye, o.z);
    put("hi", hi, o.z + 0.01);
    put("brow", brow, o.z - 0.1);
    if (big || e !== "neutral" || o.fem) put("mouth", mouthCells(e, v.mouth, !!o.fem, big), o.z);
    if (big && v.nose !== undefined && e !== "surprised") put("nose", [skinC(v.nose, 3, 1, 1, -1)], o.z - 0.2);
    if (big && (e === "happy" || o.blush)) {
      const cheeks: Cell[] = v.eyes.map(([x], i) => [v.eyes.length === 2 ? (i === 0 ? x - 1 : x + 1) : x - 1, 3, 2, 1, "accent", 1] as Cell);
      put("blush", cheeks, o.z - 0.2);
    }
  }
  return out;
}

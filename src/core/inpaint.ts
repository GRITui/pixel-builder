// Region edit ("inpainting"): replace only the masked cells of a sprite with
// legend rows, keep everything on the kit palette, and re-outline just around
// what changed so untouched areas stay byte-identical.
import { removeOrphans, stripOutline, applyOutline } from "./enforce";
import { DEFAULT_KIT } from "./kit";
import { buildLegend, encodeSprite, type Legend } from "./legend";
import type { Sprite, StyleKit } from "./types";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One byte per cell (row-major, sprite size); non-zero = selected. */
export type Mask = Uint8Array;

export function rectMask(w: number, h: number, r: Rect): Mask {
  const m = new Uint8Array(w * h);
  for (let y = Math.max(0, r.y); y < Math.min(h, r.y + r.h); y++)
    for (let x = Math.max(0, r.x); x < Math.min(w, r.x + r.w); x++) m[y * w + x] = 1;
  return m;
}

export function cellsMask(w: number, h: number, cells: readonly (readonly [number, number])[]): Mask {
  const m = new Uint8Array(w * h);
  for (const [x, y] of cells) if (Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < w && y < h) m[y * w + x] = 1;
  return m;
}

/** Bounding box of the selected cells, or null when the mask is empty. */
export function maskBounds(m: Mask, w: number): Rect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let i = 0; i < m.length; i++) {
    if (!m[i]) continue;
    const x = i % w, y = (i - x) / w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Legend rows of a rectangle of the sprite (clipped to it): the model's view of the region. */
export function regionContext(sprite: Sprite, rect: Rect, legend: Legend = buildLegend(DEFAULT_KIT)): string[] {
  const x0 = Math.max(0, rect.x), y0 = Math.max(0, rect.y);
  const x1 = Math.min(sprite.w, rect.x + rect.w), y1 = Math.min(sprite.h, rect.y + rect.h);
  return encodeSprite(sprite, legend).slice(y0, y1).map((r) => Array.from(r).slice(x0, x1).join(""));
}

/** Problems with replacement rows for a bbox (empty = fine). Only masked cells are checked for chars. */
export function checkRegionRows(rows: unknown, bbox: Rect, legend: Legend, mask?: Mask, w?: number): string[] {
  if (!Array.isArray(rows)) return ["rows must be an array of strings"];
  const errs: string[] = [];
  if (rows.length !== bbox.h) errs.push(`expected ${bbox.h} rows, got ${rows.length}`);
  for (let y = 0; y < Math.min(rows.length, bbox.h); y++) {
    const r = rows[y];
    if (typeof r !== "string") { errs.push(`row ${y} is not a string`); continue; }
    const chars = Array.from(r);
    if (chars.length !== bbox.w) errs.push(`row ${y} has ${chars.length} chars, expected ${bbox.w}`);
    for (let x = 0; x < Math.min(chars.length, bbox.w); x++) {
      const inMask = !mask || w === undefined || mask[(bbox.y + y) * w + bbox.x + x];
      if (inMask && !legend.byChar.has(chars[x])) errs.push(`row ${y} col ${x}: ${JSON.stringify(chars[x])} is not a legend char`);
    }
  }
  return errs.length > 8 ? [...errs.slice(0, 8), `...and ${errs.length - 8} more`] : errs;
}

function dilate(cells: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(cells.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!cells[y * w + x]) continue;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h) out[ny * w + nx] = 1;
        }
    }
  return out;
}

export interface RegionEditResult {
  sprite: Sprite;
  /** Cells whose value differs from the input (including outline pixels). */
  changed: number;
}

/**
 * Replace the masked cells with `rows` (legend rows covering the mask's bounding
 * box; chars outside the mask are ignored). Throws on invalid rows/chars.
 * Then orphan cleanup and (optionally) the kit outline are applied only in the
 * 1px neighbourhood of the cells that actually changed.
 */
export function applyRegionEdit(sprite: Sprite, mask: Mask, rows: string[], kit: StyleKit, opts: { outline?: boolean; cleanup?: boolean } = {}): RegionEditResult {
  const { w, h } = sprite;
  if (mask.length !== w * h) throw new Error(`mask is ${mask.length} cells, sprite is ${w}x${h}`);
  const bbox = maskBounds(mask, w);
  if (!bbox) throw new Error("the mask is empty");
  const legend = buildLegend(kit);
  const errs = checkRegionRows(rows, bbox, legend, mask, w);
  if (errs.length) throw new Error(`Invalid replacement rows for the ${bbox.w}x${bbox.h} region: ${errs.join("; ")}`);

  const work: Sprite = { w, h, data: sprite.data.slice() };
  const touched = new Uint8Array(w * h);
  for (let y = 0; y < bbox.h; y++) {
    const chars = Array.from(rows[y]);
    for (let x = 0; x < bbox.w; x++) {
      const i = (bbox.y + y) * w + bbox.x + x;
      if (!mask[i]) continue;
      const v = legend.byChar.get(chars[x])!;
      if (v !== work.data[i]) { work.data[i] = v; touched[i] = 1; }
    }
  }
  if (!touched.some(Boolean)) return { sprite: work, changed: 0 };

  const ring = dilate(touched, w, h);
  const outline = opts.outline !== false && kit.outline !== "none";
  // Old outline pixels around the edit are stale (a shape moved or vanished): clear them so the new silhouette is outlined afresh.
  if (outline) {
    const stripped = stripOutline(sprite);
    for (let i = 0; i < ring.length; i++) if (ring[i] && !mask[i] && sprite.data[i] && !stripped.data[i]) work.data[i] = 0;
  }
  let out = work;
  if (opts.cleanup !== false) {
    const cleaned = removeOrphans(out);
    out = { w, h, data: out.data.map((v, i) => (ring[i] ? cleaned.data[i] : v)) };
  }
  if (outline) {
    const outlined = applyOutline(out, kit);
    out = { w, h, data: out.data.map((v, i) => (ring[i] && !v ? outlined.data[i] : v)) };
  }
  let changed = 0;
  for (let i = 0; i < out.data.length; i++) if (out.data[i] !== sprite.data[i]) changed++;
  return { sprite: out, changed };
}

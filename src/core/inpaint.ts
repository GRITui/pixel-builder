// Pure, shared core for AI region edit ("inpaint"). No I/O and no model calls:
// the model is invoked by the server / MCP layer, which hands the decoded
// result back here. This module owns the mask math, the masked-only merge, and
// the hard guarantee that UNMASKED pixels come back byte-identical.
//
// Wire contract (issue #18): the model sees the whole sprite as legend rows for
// context and is asked to return the complete frame; we take ONLY the masked
// cells from its output, so everything outside the region is untouched.
import { finalize } from "./enforce";
import { buildLegend, decodeRows, encodeSprite, legendText, type Legend } from "./legend";
import { cloneSprite, createSprite, getPx } from "./sprite";
import type { Sprite, StyleKit } from "./types";

/** A rectangular region in pixel (cell) coordinates. */
export interface MaskRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Per-cell mask: `mask[y][x] === true` means "this cell is editable". */
export type MaskGrid = boolean[][];

/** A region on the wire: a rect `{x,y,w,h}` OR a per-cell lasso grid. */
export type Region = MaskRect | MaskGrid;

/** True when the region is a rect (has a numeric `x`). */
export function isRect(r: Region): r is MaskRect {
  return typeof (r as MaskRect)?.x === "number";
}

/** Rect -> per-cell mask grid, clamped to the w x h frame. */
export function rectMask(w: number, h: number, rect: MaskRect): MaskGrid {
  const grid: MaskGrid = Array.from({ length: h }, () => new Array<boolean>(w).fill(false));
  const x0 = Math.max(0, Math.round(rect.x));
  const y0 = Math.max(0, Math.round(rect.y));
  const x1 = Math.min(w, Math.round(rect.x + rect.w));
  const y1 = Math.min(h, Math.round(rect.y + rect.h));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) grid[y][x] = true;
  return grid;
}

/** Normalize any Region (rect or lasso grid) to a per-cell mask for a w x h frame. */
export function toMaskGrid(w: number, h: number, region: Region): MaskGrid {
  if (isRect(region)) return rectMask(w, h, region);
  const grid: MaskGrid = Array.from({ length: h }, () => new Array<boolean>(w).fill(false));
  for (let y = 0; y < h && y < region.length; y++) {
    const row = region[y];
    if (!Array.isArray(row)) continue;
    for (let x = 0; x < w && x < row.length; x++) grid[y][x] = row[x] === true;
  }
  return grid;
}

/** True if the mask covers at least one cell. */
export function maskHasPixels(mask: MaskGrid): boolean {
  for (const row of mask) for (const v of row) if (v) return true;
  return false;
}

/** Tight bounding box of the masked cells, or null when nothing is masked. */
export function maskBounds(mask: MaskGrid): MaskRect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < mask.length; y++)
    for (let x = 0; x < (mask[y]?.length ?? 0); x++) {
      if (!mask[y][x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Masked cells of a sprite as legend rows, cropped to the mask's bounding box.
 * This is the "rows for the masked cells only" form: what an agent paints, and
 * what {@link cropRowsToSprite} reads back.
 */
export function cropSprite(sprite: Sprite, box: MaskRect, legend: Legend): string[] {
  const rows: string[] = [];
  for (let y = box.y; y < box.y + box.h; y++) {
    let row = "";
    for (let x = box.x; x < box.x + box.w; x++) {
      const idx = x < sprite.w && y < sprite.h ? sprite.data[y * sprite.w + x] : 0;
      row += idx === 0 ? "." : (legend.byIndex.get(idx) ?? ".");
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Place region rows (cropped to a bounding box) back onto a full-size frame.
 * Cells outside the box stay transparent in the returned model sprite; the
 * merge only reads masked cells anyway.
 */
export function cropRowsToSprite(rows: string[], box: MaskRect, w: number, h: number, legend: Legend): Sprite {
  const out = createSprite(w, h);
  rows.forEach((row, j) => {
    const y = box.y + j;
    if (y < 0 || y >= h || typeof row !== "string") return;
    const chars = Array.from(row);
    for (let i = 0; i < box.w && i < chars.length; i++) {
      const x = box.x + i;
      if (x < 0 || x >= w) continue;
      out.data[y * w + x] = legend.byChar.get(chars[i]) ?? 0;
    }
  });
  return out;
}

/**
 * Freehand lasso -> mask grid: every cell whose centre is inside the closed
 * polygon. Uses an even-odd crossing test, so self-intersecting paths are safe.
 */
export function polygonMask(w: number, h: number, points: Point[]): MaskGrid {
  const grid: MaskGrid = Array.from({ length: h }, () => new Array<boolean>(w).fill(false));
  if (points.length < 3) return grid;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[i];
        const b = points[j];
        if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
      }
      grid[y][x] = inside;
    }
  }
  return grid;
}

/** A point in pixel (cell) coordinates; x/y may be fractional for lasso paths. */
export interface Point {
  x: number;
  y: number;
}

/** Render a mask as a `#`/`.` grid so the model can see exactly which cells to edit. */
export function renderMask(mask: MaskGrid): string[] {
  return mask.map((row) => row.map((v) => (v ? "#" : ".")).join(""));
}

/**
 * Merge the model's output into the original, taking ONLY the masked cells.
 * Unmasked cells are copied verbatim from the original, so they are
 * byte-identical by construction (before any finalize pass).
 */
export function mergeInpaint(original: Sprite, model: Sprite, mask: MaskGrid): Sprite {
  const out = createSprite(original.w, original.h);
  for (let y = 0; y < original.h; y++) {
    for (let x = 0; x < original.w; x++) {
      out.data[y * original.w + x] = mask[y]?.[x] ? getPx(model, x, y) : original.data[y * original.w + x];
    }
  }
  return out;
}

/**
 * The full inpaint pass for one frame:
 *   1. merge the model output into the masked cells (unmasked = original, verbatim)
 *   2. run the standard finalize (sanitize + cleanup + outline)
 *   3. force every UNMASKED pixel back to its original value
 * Step 3 is what makes "unmasked pixels byte-identical" a hard guarantee, even
 * when the new silhouette would otherwise draw an outline into unmasked space.
 */
export function inpaintFrame(original: Sprite, model: Sprite, mask: MaskGrid, kit: StyleKit): Sprite {
  const merged = mergeInpaint(original, model, mask);
  const finalized = finalize(merged, kit, { cleanup: true });
  const out = cloneSprite(finalized);
  for (let y = 0; y < original.h; y++) {
    for (let x = 0; x < original.w; x++) {
      if (!mask[y]?.[x]) out.data[y * original.w + x] = original.data[y * original.w + x];
    }
  }
  return out;
}

export interface InpaintInput {
  /** The current frame being edited. */
  frame: Sprite;
  /** The model's decoded output (same w x h; off-legend chars already dropped). */
  model: Sprite;
  /** The region to edit: a rect or a lasso grid. */
  region: Region;
  kit: StyleKit;
}

/** Run the full inpaint pass for one frame and return the merged, finalized sprite. */
export function inpaint(input: InpaintInput): Sprite {
  const mask = toMaskGrid(input.frame.w, input.frame.h, input.region);
  if (!maskHasPixels(mask)) return cloneSprite(input.frame);
  return inpaintFrame(input.frame, input.model, mask, input.kit);
}

/**
 * Decode the model's legend rows into a sprite of exactly w x h. Unknown chars
 * become transparent, so a malformed model response can never corrupt the
 * palette — it just paints less.
 */
export function decodeModelRows(rows: string[], w: number, h: number, legend: Legend): Sprite {
  return decodeRows(rows, w, h, legend);
}

/**
 * The distinct characters in the model's rows that are NOT in the legend
 * (empty = the model stayed on the palette). Used to surface off-palette
 * model output instead of silently dropping it.
 */
export function offLegendChars(rows: string[], legend: Legend): string[] {
  const bad = new Set<string>();
  for (const row of rows) {
    if (typeof row !== "string") continue;
    for (const ch of Array.from(row)) if (!legend.byChar.has(ch)) bad.add(ch);
  }
  return [...bad].sort();
}

export interface InpaintPromptArgs {
  frame: Sprite;
  region: Region;
  prompt: string;
  kit: StyleKit;
}

/**
 * Build the model prompt for an inpaint: the palette legend, the whole current
 * frame as legend rows (context), the region as a `#`/`.` grid, and the edit
 * request. The model is asked to return the complete frame, changing only the
 * `#` cells — the server then merges only those cells back.
 */
export function buildInpaintPrompt(args: InpaintPromptArgs): string {
  const legend = buildLegend(args.kit);
  const rows = encodeSprite(args.frame, legend);
  const mask = toMaskGrid(args.frame.w, args.frame.h, args.region);
  const maskRows = renderMask(mask);
  const w = args.frame.w;
  const h = args.frame.h;
  return [
    "You are a pixel artist editing a small region of a game sprite.",
    "",
    "PALETTE LEGEND (use ONLY these characters):",
    legendText(legend),
    "",
    `CURRENT SPRITE (${w}x${h}, one row per line, top to bottom):`,
    ...rows,
    "",
    "REGION TO EDIT (# = edit these cells, . = leave unchanged):",
    ...maskRows,
    "",
    `REQUEST: ${args.prompt}`,
    "",
    `Return the COMPLETE sprite as exactly ${h} lines of exactly ${w} characters, using only the legend characters above.`,
    "Change ONLY the cells marked # in the region. Every cell marked . must be returned EXACTLY as it appears in the current sprite.",
    "Keep the edit on the palette and in the sprite's existing style. Do not invent characters that are not in the legend.",
  ].join("\n");
}

// Pure editing logic (no DOM, no React) so it can be unit-tested.
import { colorIndex, decodeIndex, RAMP_LEN } from "../../core/palette";
import { applyRegionEdit, rectMask, type Rect } from "../../core/inpaint";
import { blit, createSprite } from "../../core/sprite";
import type { FrameSet, Sprite, StyleKit } from "../../core/types";

export interface Point {
  x: number;
  y: number;
}

// ---------- shapes ----------

/** Bresenham line, endpoints inclusive. */
export function linePoints(x0: number, y0: number, x1: number, y1: number): Point[] {
  const pts: Point[] = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0, y = y0;
  for (;;) {
    pts.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return pts;
}

/** Rectangle between two corners (any order); outline only unless `filled`. */
export function rectPoints(x0: number, y0: number, x1: number, y1: number, filled = false): Point[] {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1);
  const ay = Math.min(y0, y1), by = Math.max(y0, y1);
  const pts: Point[] = [];
  for (let y = ay; y <= by; y++)
    for (let x = ax; x <= bx; x++)
      if (filled || x === ax || x === bx || y === ay || y === by) pts.push({ x, y });
  return pts;
}

export function mirrorX(x: number, w: number): number {
  return w - 1 - x;
}

/** Add the horizontally mirrored twin of every point. */
export function withMirror(pts: Point[], w: number): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    out.push(p);
    const mx = mirrorX(p.x, w);
    if (mx !== p.x) out.push({ x: mx, y: p.y });
  }
  return out;
}

// ---------- painting (mutating helpers work on a stroke's scratch sprite) ----------

function inside(s: { w: number; h: number }, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < s.w && y < s.h;
}

/** Set pixels to `value` in place. */
export function paintPoints(s: Sprite, pts: Point[], value: number, mirror = false): void {
  for (const p of mirror ? withMirror(pts, s.w) : pts) if (inside(s, p.x, p.y)) s.data[p.y * s.w + p.x] = value;
}

/** One step along the pixel's ramp: +1 lightens, -1 darkens; transparent stays transparent. */
export function shadePixel(idx: number, dir: 1 | -1): number {
  const d = decodeIndex(idx);
  if (!d) return idx;
  return colorIndex(d.mat, Math.max(0, Math.min(RAMP_LEN - 1, d.level + dir)));
}

/**
 * Shade pixels in place. `touched` remembers pixels already shaded in the
 * current stroke so dragging back and forth does not walk the ramp repeatedly.
 */
export function shadePoints(s: Sprite, pts: Point[], dir: 1 | -1, mirror: boolean, touched: Set<number>): void {
  for (const p of mirror ? withMirror(pts, s.w) : pts) {
    if (!inside(s, p.x, p.y)) continue;
    const i = p.y * s.w + p.x;
    if (touched.has(i)) continue;
    touched.add(i);
    s.data[i] = shadePixel(s.data[i], dir);
  }
}

/** 4-way flood fill on a grid of numbers. Returns the same array if nothing changes. */
export function floodFillGrid(data: number[], w: number, h: number, x: number, y: number, value: number): number[] {
  if (x < 0 || y < 0 || x >= w || y >= h) return data;
  const target = data[y * w + x];
  if (target === value) return data;
  const out = data.slice();
  const stack = [y * w + x];
  while (stack.length) {
    const i = stack.pop()!;
    if (out[i] !== target) continue;
    out[i] = value;
    const cx = i % w, cy = (i - cx) / w;
    if (cx > 0) stack.push(i - 1);
    if (cx < w - 1) stack.push(i + 1);
    if (cy > 0) stack.push(i - w);
    if (cy < h - 1) stack.push(i + w);
  }
  return out;
}

export function floodFill(s: Sprite, x: number, y: number, value: number): Sprite {
  const data = floodFillGrid(s.data, s.w, s.h, x, y, value);
  return data === s.data ? s : { w: s.w, h: s.h, data };
}

// ---------- resizing ----------

export type Anchor = "bottom" | "center" | "top-left";

export function resizeSprite(s: Sprite, w: number, h: number, anchor: Anchor = "bottom"): Sprite {
  const out = createSprite(w, h);
  const dx = anchor === "top-left" ? 0 : Math.floor((w - s.w) / 2);
  const dy = anchor === "bottom" ? h - s.h : anchor === "center" ? Math.floor((h - s.h) / 2) : 0;
  blit(out, s, dx, dy);
  return out;
}

/** Resize a grid keeping the top-left corner (map layers). */
export function resizeGrid(data: number[], cols: number, rows: number, ncols: number, nrows: number, fill = -1): number[] {
  const out = new Array(ncols * nrows).fill(fill);
  for (let y = 0; y < Math.min(rows, nrows); y++)
    for (let x = 0; x < Math.min(cols, ncols); x++) out[y * ncols + x] = data[y * cols + x];
  return out;
}

// ---------- history ----------

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  cap: number;
}

export function createHistory<T>(present: T, cap = 100): History<T> {
  return { past: [], present, future: [], cap };
}

/** Record `next` as the new present. No-op when it is the same reference. */
export function pushHistory<T>(h: History<T>, next: T): History<T> {
  if (next === h.present) return h;
  const past = [...h.past, h.present];
  if (past.length > h.cap) past.splice(0, past.length - h.cap);
  return { ...h, past, present: next, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h;
  return { ...h, past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h;
  return { ...h, past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

export const canUndo = (h: History<unknown>) => h.past.length > 0;
export const canRedo = (h: History<unknown>) => h.future.length > 0;

// ---------- RGBA helpers for image import ----------

export interface RGBAImage {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

function rgbKey(d: Uint8ClampedArray, i: number): number {
  return (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
}

/**
 * Make the background transparent: the most common opaque corner colour is the
 * background, flood-filled inward from the border so interior areas of the same
 * colour (eyes, highlights) survive. `tolerance` is a max RGB distance.
 */
export function removeBackground(img: RGBAImage, tolerance = 24): RGBAImage {
  const { w, h } = img;
  const data = new Uint8ClampedArray(img.data);
  if (w === 0 || h === 0) return { data, w, h };
  const corners = [0, w - 1, (h - 1) * w, h * w - 1].filter((p) => data[p * 4 + 3] >= 128);
  if (!corners.length) return { data, w, h };
  const votes = new Map<number, number>();
  for (const p of corners) votes.set(rgbKey(data, p * 4), (votes.get(rgbKey(data, p * 4)) ?? 0) + 1);
  let bg = 0, best = -1;
  for (const [k, c] of votes) if (c > best) { best = c; bg = k; }
  const br = (bg >> 16) & 255, bgG = (bg >> 8) & 255, bb = bg & 255;
  const t2 = tolerance * tolerance;
  const matches = (p: number) => {
    const i = p * 4;
    if (data[i + 3] < 128) return false;
    return (data[i] - br) ** 2 + (data[i + 1] - bgG) ** 2 + (data[i + 2] - bb) ** 2 <= t2;
  };
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const seed = (p: number) => { if (!seen[p] && matches(p)) { seen[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop()!;
    data[p * 4 + 3] = 0;
    const x = p % w, y = (p - x) / w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (y > 0) seed(p - w);
    if (y < h - 1) seed(p + w);
  }
  return { data, w, h };
}

/** Crop to the bounding box of opaque pixels (alpha >= 128). Returns the input if nothing is opaque. */
export function cropToContent(img: RGBAImage): RGBAImage {
  const { w, h, data } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3] >= 128) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return img;
  const nw = x1 - x0 + 1, nh = y1 - y0 + 1;
  const out = new Uint8ClampedArray(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const from = ((y0 + y) * w + x0) * 4;
    out.set(data.subarray(from, from + nw * 4), y * nw * 4);
  }
  return { data: out, w: nw, h: nh };
}

/** Replace a frame list entry without mutating the original list. */
export function replaceAt<T>(list: T[], i: number, v: T): T[] {
  return list.map((x, j) => (j === i ? v : x));
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const out = list.slice();
  const [it] = out.splice(from, 1);
  out.splice(to, 0, it);
  return out;
}

// ---------- region selection + AI region edit ----------

/** Rectangle between two drag corners (any order), clamped to a w x h canvas; null when fully outside. */
export function selectionRect(a: Point, b: Point, w: number, h: number): Rect | null {
  const x0 = Math.max(0, Math.min(a.x, b.x)), x1 = Math.min(w - 1, Math.max(a.x, b.x));
  const y0 = Math.max(0, Math.min(a.y, b.y)), y1 = Math.min(h - 1, Math.max(a.y, b.y));
  return x1 < x0 || y1 < y0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Apply per-frame replacement rows (legend rows for `rect`) to some frames of
 * one animation row. Returns a new FrameSet list (the input is untouched), so a
 * preview can be shown and then committed as a single history step.
 */
export function applyRegionToRow(rows: FrameSet[], ri: number, edits: { fi: number; rows: string[] }[], rect: Rect, kit: StyleKit, outline = true): FrameSet[] {
  const row = rows[ri];
  let frames = row.frames;
  for (const e of edits) {
    const f = row.frames[e.fi];
    if (!f) continue;
    frames = replaceAt(frames, e.fi, applyRegionEdit(f, rectMask(f.w, f.h, rect), e.rows, kit, { outline }).sprite);
  }
  return frames === row.frames ? rows : replaceAt(rows, ri, { ...row, frames });
}

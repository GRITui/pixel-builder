// Pixel-art reference import: find the pixel grid of an upscaled (and possibly JPEG-noisy)
// pixel-art image, recover the 1:1 image, clean it up (background, crop, sheet splitting) and
// map its colours onto the kit palette. Pure and UI-free; shared by the import_image tool and
// the web import dialog.
import { colorIndex, flattenPalette, hexToRgb, MATERIALS, RAMP_LEN, rgbToOklab, type Material, type Ramps, type RGB } from "./palette";
import { createSprite } from "./sprite";
import type { Sprite } from "./types";

export interface PixelImage {
  width: number;
  height: number;
  /** width * height * 4 bytes, straight alpha. */
  rgba: Uint8Array | Uint8ClampedArray;
}

export interface GridInfo {
  /** Source pixels per art pixel (1 = not upscaled). */
  scale: number;
  /** x / y of the first grid line, 0 <= offset < scale. */
  offsetX: number;
  offsetY: number;
  /** 0..1. Below ~0.5 the image is probably not upscaled pixel art. */
  confidence: number;
}

export const DEFAULT_TOLERANCE = 24;

function dist(a: Uint8Array | Uint8ClampedArray, i: number, j: number): number {
  const ta = a[i + 3] < 128, tb = a[j + 3] < 128;
  if (ta || tb) return ta && tb ? 0 : 1e3;
  return Math.hypot(a[i] - a[j], a[i + 1] - a[j + 1], a[i + 2] - a[j + 2]);
}

/**
 * Find the pixel grid. Colour edges (neighbour distance > tolerance) of an upscaled image only
 * occur on cell borders, so we take the largest scale whose grid lines carry (almost) all edge
 * energy; JPEG noise stays below the tolerance or is a small share of the energy.
 */
export function detectGrid(img: PixelImage, opts: { tolerance?: number; maxScale?: number } = {}): GridInfo {
  if (opts.tolerance !== undefined) return detectAt(img, opts.tolerance, opts.maxScale);
  // heavier noise (strong JPEG blocks) needs a looser edge threshold: retry before giving up
  let g = detectAt(img, DEFAULT_TOLERANCE, opts.maxScale);
  for (const t of [40, 64]) {
    if (g.scale > 1 && g.confidence >= 0.5) break;
    const r = detectAt(img, t, opts.maxScale);
    if (r.scale > 1 && r.confidence >= 0.5) g = r;
  }
  return g;
}

function detectAt(img: PixelImage, tol: number, maxScale = 64): GridInfo {
  const { width: w, height: h, rgba } = img;
  const colE = new Float64Array(w + 1), rowE = new Float64Array(h + 1);
  for (let y = 0; y < h; y++)
    for (let x = 1; x < w; x++) {
      const i = (y * w + x) * 4;
      if (dist(rgba, i - 4, i) > tol) colE[x] += 1 / h;
    }
  for (let y = 1; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (dist(rgba, i - w * 4, i) > tol) rowE[y] += 1 / w;
    }
  let total = 0;
  for (const v of colE) total += v;
  for (const v of rowE) total += v;
  const flat: GridInfo = { scale: 1, offsetX: 0, offsetY: 0, confidence: 0 };
  if (total <= 0) return flat;

  const best = (e: Float64Array, n: number, s: number) => {
    let bo = 0, bv = -1;
    for (let o = 0; o < s; o++) {
      let v = 0;
      for (let x = o === 0 ? s : o; x < n; x += s) v += e[x];
      if (v > bv + 1e-12) { bv = v; bo = o; }
    }
    return { o: bo, v: bv };
  };
  const maxS = Math.max(1, Math.min(maxScale, Math.floor(Math.min(w, h) / 3)));
  for (let s = maxS; s >= 2; s--) {
    const bx = best(colE, w, s), by = best(rowE, h, s);
    const leak = 1 - (bx.v + by.v) / total;
    if (leak > 0.08) continue;
    let lines = 0;
    for (let x = bx.o === 0 ? s : bx.o; x < w; x += s) if (colE[x] > 0.05) lines++;
    for (let y = by.o === 0 ? s : by.o; y < h; y += s) if (rowE[y] > 0.05) lines++;
    const confidence = Math.max(0, Math.min(1, (1 - leak * 6) * Math.min(1, lines / 6)));
    return { scale: s, offsetX: bx.o, offsetY: by.o, confidence };
  }
  return flat;
}

/** Most common colour of a block (5-bit buckets), averaged over the members; null when mostly transparent. */
function cellColour(img: PixelImage, x0: number, y0: number, x1: number, y1: number): [number, number, number, number] {
  const { width: w, rgba } = img;
  const counts = new Map<number, number>();
  let opaque = 0, total = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      total++;
      if (rgba[i + 3] < 128) continue;
      opaque++;
      const key = ((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  if (opaque * 2 < total || opaque === 0) return [0, 0, 0, 0];
  let bk = 0, bc = -1;
  for (const [k, c] of counts) if (c > bc || (c === bc && k < bk)) { bc = c; bk = k; }
  // average every pixel near the winning bucket so zero-mean noise cancels instead of flipping the shade
  const mr = ((bk >> 10) & 31) * 8 + 4, mg = ((bk >> 5) & 31) * 8 + 4, mb = (bk & 31) * 8 + 4;
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      if (rgba[i + 3] < 128 || Math.hypot(rgba[i] - mr, rgba[i + 1] - mg, rgba[i + 2] - mb) > 40) continue;
      r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; n++;
    }
  if (n === 0) return [mr, mg, mb, 255];
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n), 255];
}

/**
 * Recover the 1:1 image: one pixel per grid cell, chosen by majority vote over the cell's inner
 * pixels (the outermost ring is skipped for scale >= 4 so JPEG ringing at cell borders is ignored).
 * Partial cells at the image edge are kept when at least half a cell is visible.
 */
export function downscaleGrid(img: PixelImage, grid: Pick<GridInfo, "scale" | "offsetX" | "offsetY">): PixelImage {
  const s = Math.max(1, Math.round(grid.scale));
  if (s === 1) return { width: img.width, height: img.height, rgba: new Uint8Array(img.rgba) };
  const cells = (n: number, o: number) => {
    const out: [number, number][] = [];
    for (let k = o > 0 ? -1 : 0; ; k++) {
      const a = o + k * s;
      if (a >= n) break;
      const lo = Math.max(0, a), hi = Math.min(n, a + s);
      if (hi - lo >= Math.ceil(s / 2)) out.push([lo, hi]);
    }
    return out;
  };
  const xs = cells(img.width, grid.offsetX % s), ys = cells(img.height, grid.offsetY % s);
  const ring = s >= 4 ? 1 : 0;
  const out = new Uint8Array(xs.length * ys.length * 4);
  ys.forEach(([ya, yb], cy) =>
    xs.forEach(([xa, xb], cx) => {
      const full = xb - xa === s && yb - ya === s;
      const m = full ? ring : 0;
      out.set(cellColour(img, xa + m, ya + m, xb - m, yb - m), (cy * xs.length + cx) * 4);
    }),
  );
  return { width: xs.length, height: ys.length, rgba: out };
}

// ---------- cleanup ----------

/** Make the background transparent: flood fill from the border using an explicit key colour or the commonest border colour. */
export function removeBackgroundFlood(img: PixelImage, opts: { tolerance?: number; key?: RGB } = {}): PixelImage {
  const tol = opts.tolerance ?? 28;
  const { width: w, height: h } = img;
  const out = new Uint8Array(img.rgba);
  let key = opts.key;
  if (!key) {
    const counts = new Map<number, number>();
    const add = (x: number, y: number) => {
      const i = (y * w + x) * 4;
      if (out[i + 3] < 128) return;
      const k = ((out[i] >> 3) << 10) | ((out[i + 1] >> 3) << 5) | (out[i + 2] >> 3);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    };
    for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
    for (let y = 0; y < h; y++) { add(0, y); add(w - 1, y); }
    let bk = -1, bc = 0;
    for (const [k, c] of counts) if (c > bc || (c === bc && k < bk)) { bc = c; bk = k; }
    if (bk < 0) return { width: w, height: h, rgba: out };
    key = [((bk >> 10) & 31) * 8 + 4, ((bk >> 5) & 31) * 8 + 4, (bk & 31) * 8 + 4];
  }
  const k = key;
  const near = (i: number) => out[i + 3] > 0 && Math.hypot(out[i] - k[0], out[i + 1] - k[1], out[i + 2] - k[2]) <= tol;
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < w && y < h && near((y * w + x) * 4)) {
      out[(y * w + x) * 4 + 3] = 0;
      stack.push(x, y);
    }
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const y = stack.pop()!, x = stack.pop()!;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  return { width: w, height: h, rgba: out };
}

export function contentBounds(img: PixelImage): { x: number; y: number; w: number; h: number } | null {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (img.rgba[(y * img.width + x) * 4 + 3] >= 128) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function cropImage(img: PixelImage, x: number, y: number, w: number, h: number): PixelImage {
  const out = new Uint8Array(w * h * 4);
  for (let yy = 0; yy < h; yy++) {
    const sy = y + yy;
    if (sy < 0 || sy >= img.height) continue;
    const a = Math.max(0, x), b = Math.min(img.width, x + w);
    if (b > a) out.set(img.rgba.subarray((sy * img.width + a) * 4, (sy * img.width + b) * 4), (yy * w + (a - x)) * 4);
  }
  return { width: w, height: h, rgba: out };
}

/** Crop to the non-transparent content (returns the input when there is none). */
export function cropToContentImage(img: PixelImage): PixelImage {
  const b = contentBounds(img);
  return b ? cropImage(img, b.x, b.y, b.w, b.h) : img;
}

export interface SheetFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  image: PixelImage;
}

export interface SheetSplit {
  /** "grid": a regular lattice of equal cells (frames share one size); "islands": separate content blobs. */
  layout: "grid" | "islands";
  cols?: number;
  rows?: number;
  frames: SheetFrame[];
}

interface Box { x0: number; y0: number; x1: number; y1: number; n: number }

function islands(img: PixelImage, gap: number): Box[] {
  const { width: w, height: h, rgba } = img;
  const seen = new Uint8Array(w * h);
  const boxes: Box[] = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s] || rgba[s * 4 + 3] < 128) continue;
    const b: Box = { x0: w, y0: h, x1: -1, y1: -1, n: 0 };
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!, x = p % w, y = (p - x) / w;
      b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y); b.n++;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (!seen[q] && rgba[q * 4 + 3] >= 128) { seen[q] = 1; stack.push(q); }
        }
    }
    boxes.push(b);
  }
  // merge boxes closer than `gap` (detached details of one sprite)
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], c = boxes[j];
        if (a.x0 - gap - 1 <= c.x1 && c.x0 - gap - 1 <= a.x1 && a.y0 - gap - 1 <= c.y1 && c.y0 - gap - 1 <= a.y1) {
          a.x0 = Math.min(a.x0, c.x0); a.y0 = Math.min(a.y0, c.y0); a.x1 = Math.max(a.x1, c.x1); a.y1 = Math.max(a.y1, c.y1); a.n += c.n;
          boxes.splice(j, 1);
          merged = true;
          break outer;
        }
      }
  }
  return boxes;
}

const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)];

/**
 * Split a sheet (transparent background) into frames. Explicit `cellW`/`cellH` cut a uniform grid
 * (empty cells skipped). Otherwise content islands are found; when they sit on a regular lattice
 * the frames become equal-sized lattice cells (so animation frames do not jitter), else each
 * island's bounding box is a frame. Order is reading order (rows top to bottom, left to right).
 */
export function splitSheet(img: PixelImage, opts: { cellW?: number; cellH?: number; gap?: number; minPixels?: number } = {}): SheetSplit {
  const frame = (x: number, y: number, fw: number, fh: number): SheetFrame => ({ x, y, width: fw, height: fh, image: cropImage(img, x, y, fw, fh) });
  if (opts.cellW && opts.cellH) {
    const frames: SheetFrame[] = [];
    const cols = Math.floor(img.width / opts.cellW), rows = Math.floor(img.height / opts.cellH);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const f = frame(c * opts.cellW, r * opts.cellH, opts.cellW, opts.cellH);
        if (contentBounds(f.image)) frames.push(f);
      }
    return { layout: "grid", cols, rows, frames };
  }
  const boxes = islands(img, opts.gap ?? 1).filter((b) => b.n >= (opts.minPixels ?? 1));
  if (!boxes.length) return { layout: "islands", frames: [] };
  const mh = median(boxes.map((b) => b.y1 - b.y0 + 1));
  boxes.sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1) || a.x0 - b.x0);
  const rowsOf: Box[][] = [];
  let ref = -Infinity;
  for (const b of boxes) {
    const cy = (b.y0 + b.y1) / 2;
    if (!rowsOf.length || cy - ref > mh * 0.5) { rowsOf.push([]); ref = cy; }
    rowsOf[rowsOf.length - 1].push(b);
  }
  for (const r of rowsOf) r.sort((a, b) => a.x0 - b.x0);
  const ordered = rowsOf.flat();

  // regular lattice? every row has the same count and the centre spacing is constant
  const cols = rowsOf[0].length;
  if (boxes.length > 1 && rowsOf.every((r) => r.length === cols)) {
    const cx = (b: Box) => (b.x0 + b.x1 + 1) / 2, cy = (b: Box) => (b.y0 + b.y1 + 1) / 2;
    const dxs: number[] = [], dys: number[] = [];
    for (const r of rowsOf) for (let i = 1; i < r.length; i++) dxs.push(cx(r[i]) - cx(r[i - 1]));
    for (let i = 1; i < rowsOf.length; i++) for (let j = 0; j < cols; j++) dys.push(cy(rowsOf[i][j]) - cy(rowsOf[i - 1][j]));
    const px = dxs.length ? Math.round(median(dxs)) : 0, py = dys.length ? Math.round(median(dys)) : 0;
    const okX = !dxs.length || dxs.every((d) => Math.abs(d - px) <= 2), okY = !dys.length || dys.every((d) => Math.abs(d - py) <= 2);
    const cw = dxs.length ? px : Math.max(...boxes.map((b) => b.x1 - b.x0 + 1)), chh = dys.length ? py : Math.max(...boxes.map((b) => b.y1 - b.y0 + 1));
    if (okX && okY && cw > 0 && chh > 0) {
      const x0 = Math.round(median(rowsOf.flatMap((r) => r.map((b, c) => cx(b) - c * cw - cw / 2))));
      const y0 = Math.round(median(rowsOf.flatMap((r, ri) => r.map((b) => cy(b) - ri * chh - chh / 2))));
      const fits = rowsOf.every((r, ri) => r.every((b, c) => b.x0 >= x0 + c * cw && b.x1 < x0 + (c + 1) * cw && b.y0 >= y0 + ri * chh && b.y1 < y0 + (ri + 1) * chh));
      if (fits) {
        const frames: SheetFrame[] = [];
        rowsOf.forEach((_, ri) => { for (let c = 0; c < cols; c++) frames.push(frame(x0 + c * cw, y0 + ri * chh, cw, chh)); });
        return { layout: "grid", cols, rows: rowsOf.length, frames };
      }
    }
  }
  return { layout: "islands", frames: ordered.map((b) => frame(b.x0, b.y0, b.x1 - b.x0 + 1, b.y1 - b.y0 + 1)) };
}

/** Paste frames onto a common canvas (bottom-centre anchored) so a split sheet becomes equal-sized sprite frames. */
export function padToCommon(images: PixelImage[], anchor: "bottom" | "center" = "bottom"): PixelImage[] {
  const w = Math.max(...images.map((i) => i.width)), h = Math.max(...images.map((i) => i.height));
  return images.map((img) => {
    const out = new Uint8Array(w * h * 4);
    const ox = Math.floor((w - img.width) / 2), oy = anchor === "bottom" ? h - img.height : Math.floor((h - img.height) / 2);
    for (let y = 0; y < img.height; y++) out.set(img.rgba.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((oy + y) * w + ox) * 4);
    return { width: w, height: h, rgba: out };
  });
}

/** Does the opaque silhouette's rim look like an outline (mostly dark pixels)? */
export function hasOutline(img: PixelImage): boolean {
  const { width: w, height: h, rgba } = img;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && rgba[(y * w + x) * 4 + 3] >= 128;
  let rim = 0, dark = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!solid(x, y) || (solid(x - 1, y) && solid(x + 1, y) && solid(x, y - 1) && solid(x, y + 1))) continue;
      rim++;
      const i = (y * w + x) * 4;
      if (rgbToOklab([rgba[i], rgba[i + 1], rgba[i + 2]])[0] < 0.4) dark++;
    }
  return rim > 0 && dark / rim >= 0.6;
}

// ---------- palette mapping ----------

type Quantize = (rgb: RGB) => number;

/**
 * "Keep ramp structure": cluster the source colours by hue, give each cluster one material ramp
 * (distinct ramps where possible) and map the cluster's lightness range onto that ramp's levels, so
 * a shaded source stays shaded after snapping.
 */
export function makeRampMapper(images: PixelImage[], ramps: Ramps, allowed?: Material[]): Quantize {
  const flat = flattenPalette(ramps);
  const mats = (allowed ?? [...MATERIALS]).filter((m) => flat[colorIndex(m, 0)]);
  const matLab = new Map<Material, { a: number; b: number; L: number[] }>();
  for (const m of mats) {
    const labs = Array.from({ length: RAMP_LEN }, (_, l) => rgbToOklab(hexToRgb(flat[colorIndex(m, l)]!)));
    matLab.set(m, { a: labs.reduce((s, v) => s + v[1], 0) / RAMP_LEN, b: labs.reduce((s, v) => s + v[2], 0) / RAMP_LEN, L: labs.map((v) => v[0]) });
  }
  // unique colours with counts
  const uniq = new Map<number, number>();
  for (const img of images)
    for (let i = 0; i < img.width * img.height; i++) {
      if (img.rgba[i * 4 + 3] < 128) continue;
      const k = (img.rgba[i * 4] << 16) | (img.rgba[i * 4 + 1] << 8) | img.rgba[i * 4 + 2];
      uniq.set(k, (uniq.get(k) ?? 0) + 1);
    }
  const cols = [...uniq].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([k, n]) => {
    const rgb: RGB = [k >> 16, (k >> 8) & 255, k & 255];
    const [L, a, b] = rgbToOklab(rgb);
    return { k, n, L, a, b, C: Math.hypot(a, b) };
  });
  // greedy hue clustering in the (a, b) plane; near-greys form a neutral cluster
  const NEUTRAL = 0.035, HUE = 0.5; // radians between a colour's hue and the cluster's mean hue
  interface Cluster { a: number; b: number; w: number; ux: number; uy: number; members: typeof cols; neutral: boolean; mat?: Material }
  const clusters: Cluster[] = [];
  for (const c of cols) {
    const neutral = c.C < NEUTRAL;
    const ang = Math.atan2(c.b, c.a);
    let hit = clusters.find((cl) => cl.neutral === neutral && (neutral || Math.cos(Math.atan2(cl.uy, cl.ux) - ang) > Math.cos(HUE)));
    if (!hit) { hit = { a: 0, b: 0, w: 0, ux: 0, uy: 0, members: [], neutral }; clusters.push(hit); }
    hit.a += c.a * c.n; hit.b += c.b * c.n; hit.w += c.n; hit.members.push(c);
    hit.ux += Math.cos(ang) * c.n; hit.uy += Math.sin(ang) * c.n;
  }
  const taken = new Set<Material>();
  const byWeight = [...clusters].sort((x, y) => y.w - x.w);
  for (const cl of byWeight) {
    const ca = cl.neutral ? 0 : cl.a / cl.w, cb = cl.neutral ? 0 : cl.b / cl.w;
    const ranked = mats.map((m) => { const v = matLab.get(m)!; return { m, d: Math.hypot(v.a - ca, v.b - cb) }; }).sort((x, y) => x.d - y.d);
    cl.mat = (ranked.find((r) => !taken.has(r.m)) ?? ranked[0]).m;
    taken.add(cl.mat);
  }
  const table = new Map<number, number>();
  for (const cl of clusters) {
    const Ls = cl.members.map((m) => m.L).sort((a, b) => a - b);
    const lo = Ls[Math.floor(Ls.length * 0.02)], hi = Ls[Math.min(Ls.length - 1, Math.ceil(Ls.length * 0.98) - 1)];
    const rampL = matLab.get(cl.mat!)!.L;
    const nearest = (L: number) => rampL.reduce((bi, v, i) => (Math.abs(v - L) < Math.abs(rampL[bi] - L) ? i : bi), 0);
    let l0 = nearest(lo), l1 = nearest(hi);
    if (hi - lo > 0.1 && l1 === l0) { if (l1 < RAMP_LEN - 1) l1++; else l0--; }
    for (const m of cl.members) {
      const lvl = hi - lo > 0.1 ? Math.round(l0 + Math.max(0, Math.min(1, (m.L - lo) / (hi - lo))) * (l1 - l0)) : nearest(m.L);
      table.set(m.k, colorIndex(cl.mat!, Math.max(0, Math.min(RAMP_LEN - 1, lvl))));
    }
  }
  const fallback = colorIndex(mats[0], 0);
  return (rgb) => table.get((rgb[0] << 16) | (rgb[1] << 8) | rgb[2]) ?? fallback;
}

/** Image -> sprite of palette indices with an arbitrary colour mapper (alpha < 128 stays transparent). */
export function imageToSprite(img: PixelImage, q: Quantize): Sprite {
  const s = createSprite(img.width, img.height);
  for (let i = 0; i < img.width * img.height; i++) {
    if (img.rgba[i * 4 + 3] < 128) continue;
    s.data[i] = q([img.rgba[i * 4], img.rgba[i * 4 + 1], img.rgba[i * 4 + 2]]);
  }
  return s;
}

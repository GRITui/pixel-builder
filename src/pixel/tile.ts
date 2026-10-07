// Tile mode (#106): make a texture seamless (half-offset cross-fade), pixelize with one shared palette,
// repair single-pixel seams after quantisation, and build a 3x3 preview sheet.
import { hexToRgb, labDist2, rgbToOklab, type Vec3 } from "../color/oklab";
import { resizeLanczos } from "../io/resize";
import { pixelize } from "./pipeline";
import type { PixelOptions, PixelResult, Rgba } from "./types";

const lab = (d: Uint8ClampedArray, i: number) => rgbToOklab(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);

/** Centre-crop to a square. */
export function cropSquare(img: Rgba): Rgba {
  const s = Math.min(img.w, img.h), ox = (img.w - s) >> 1, oy = (img.h - s) >> 1;
  const data = new Uint8ClampedArray(s * s * 4);
  for (let y = 0; y < s; y++) data.set(img.data.subarray(((y + oy) * img.w + ox) * 4, ((y + oy) * img.w + ox + s) * 4), y * s * 4);
  return { w: s, h: s, data };
}

const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };

/**
 * Seamless via half-offset blend: T = w*I + (1-w)*shift(I, half). w is 0 on the edges (where the shifted copy
 * wraps continuously) and 1 in the centre; the ramp band is `band` of the size.
 */
export function makeSeamless(img: Rgba, band = 0.3): Rgba {
  const sq = img.w === img.h ? img : cropSquare(img);
  const n = sq.w, half = n >> 1, out = new Uint8ClampedArray(n * n * 4);
  const ramp = (p: number) => smooth(Math.min(p, n - 1 - p) / (band * n));
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const wgt = ramp(x) * ramp(y);
    const a = (y * n + x) * 4, b = (((y + half) % n) * n + ((x + half) % n)) * 4;
    for (let k = 0; k < 3; k++) out[a + k] = sq.data[a + k] * wgt + sq.data[b + k] * (1 - wgt);
    out[a + 3] = 255;
  }
  return { w: n, h: n, data: out };
}

/** Mean OKLab step across the wrap seam divided by the mean step between interior neighbours (~1 = seamless). */
export function wrapError(img: Rgba): number {
  const { w, h, data } = img;
  let seam = 0, inner = 0, ns = 0, ni = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = lab(data, y * w + x);
    const e1 = Math.sqrt(labDist2(a, lab(data, y * w + ((x + 1) % w))));
    const e2 = Math.sqrt(labDist2(a, lab(data, ((y + 1) % h) * w + x)));
    if (x === w - 1) { seam += e1; ns++; } else { inner += e1; ni++; }
    if (y === h - 1) { seam += e2; ns++; } else { inner += e2; ni++; }
  }
  return seam / ns / Math.max(1e-6, inner / ni);
}

/** After quantisation, snap seam pixels whose wrap step is an outlier to the palette colour nearest their neighbours' mean. */
export function fixSeams(img: Rgba, palette: string[]): number {
  const { w, h, data } = img;
  if (!palette.length) return 0;
  const pal = palette.map((p) => hexToRgb(p)), palLab = pal.map((c) => rgbToOklab(...c));
  const step = (a: number, b: number) => Math.sqrt(labDist2(lab(data, a), lab(data, b)));
  let sum = 0, n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w - 1; x++) { sum += step(y * w + x, y * w + x + 1); n++; }
  const limit = Math.max(0.08, (sum / n) * 2.5);
  const pick = (p: Vec3) => { let b = 0, bd = Infinity; palLab.forEach((q, j) => { const d = labDist2(p, q); if (d < bd) { bd = d; b = j; } }); return pal[b]; };
  const avg = (is: number[]): Vec3 => [0, 1, 2].map((k) => is.reduce((s, i) => s + lab(data, i)[k], 0) / is.length) as Vec3;
  let fixed = 0;
  for (let y = 0; y < h; y++) {
    const L = y * w + w - 1, R = y * w;
    if (step(L, R) > limit) { data.set(pick(avg([L - 1, L, R + 1])), R * 4); fixed++; }
  }
  for (let x = 0; x < w; x++) {
    const B = (h - 1) * w + x, T = x;
    if (step(B, T) > limit) { data.set(pick(avg([B - w, B, T + w])), T * 4); fixed++; }
  }
  return fixed;
}

export function tileSheet(tile: Rgba, n = 3): Rgba {
  const W = tile.w * n, out = new Uint8ClampedArray(W * tile.h * n * 4);
  for (let ty = 0; ty < n; ty++) for (let tx = 0; tx < n; tx++) for (let y = 0; y < tile.h; y++)
    out.set(tile.data.subarray(y * tile.w * 4, (y + 1) * tile.w * 4), ((ty * tile.h + y) * W + tx * tile.w) * 4);
  return { w: W, h: tile.h * n, data: out };
}

export function pixelizeTile(img: Rgba, opts: PixelOptions = {}): PixelResult & { sheet: Rgba; wrapBefore: number; wrapAfter: number } {
  const S = Math.max(8, Math.round(opts.width ?? 32));
  const square = cropSquare(img);
  const probe = square.w > 256 ? resizeLanczos(square, 256, 256) : square;
  const before = wrapError(probe);
  // work at a few times the tile size so the cross-fade keeps detail, capped for speed
  const work = Math.min(square.w, Math.max(S, Math.min(512, S * 8)));
  const seamless = makeSeamless(resizeLanczos(square, work, work));
  const r = pixelize(seamless, { ...opts, mode: "scene", width: S, height: S, outline: false });
  const fixed = fixSeams(r.native, r.palette);
  for (let i = 0; i < S * S; i++) r.native.data[i * 4 + 3] = 255;
  const after = wrapError(r.native);
  return {
    ...r,
    sheet: tileSheet(r.native),
    wrapBefore: before,
    wrapAfter: after,
    meta: { ...r.meta, mode: "tile", width: S, height: S, seamFixed: fixed, wrapBefore: +before.toFixed(2), wrapAfter: +after.toFixed(2) },
  };
}

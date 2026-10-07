// Palette-index view of a pixelized still. Effects only ever move a pixel to another entry of the
// result palette, so every frame stays palette-only by construction.
import { hexToRgb, labDist2, rgbToHex, rgbToOklab, type Vec3 } from "../../color/oklab";
import type { PixelResult } from "../types";

export interface IndexedImage {
  w: number;
  h: number;
  /** Palette index per pixel; -1 = transparent. */
  idx: Int16Array;
  palette: string[];
  rgb: Vec3[];
  lab: Vec3[];
  /** One step lighter / darker along a similar hue; self when there is none. */
  lighter: Int16Array;
  darker: Int16Array;
}

/**
 * Lightness neighbour of entry i: the closest entry that is at least `minDL` lighter (dir=1) or darker
 * (dir=-1), scoring hue/chroma drift 3x worse than the lightness gap so ramps stay on-hue.
 */
function neighbour(lab: Vec3[], i: number, dir: 1 | -1, minDL = 0.025): number {
  let best = i, bs = Infinity;
  for (let j = 0; j < lab.length; j++) {
    const dL = (lab[j][0] - lab[i][0]) * dir;
    if (dL < minDL) continue;
    const s = dL + 3 * Math.hypot(lab[j][1] - lab[i][1], lab[j][2] - lab[i][2]);
    if (s < bs) { bs = s; best = j; }
  }
  return best;
}

export function toIndexed(result: PixelResult): IndexedImage {
  const { w, h, data } = result.native;
  const palette = result.palette.map((p) => p.toLowerCase());
  const key = new Map<string, number>(palette.map((p, i) => [p, i]));
  const idx = new Int16Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3] < 128) { idx[i] = -1; continue; }
    const hex = rgbToHex(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
    let p = key.get(hex);
    // A pixel outside the declared palette would be a pipeline bug; adopting it keeps "only colours of
    // the still" true without inventing anything.
    if (p === undefined) { p = palette.length; palette.push(hex); key.set(hex, p); }
    idx[i] = p;
  }
  const rgb = palette.map(hexToRgb);
  const lab = rgb.map((c) => rgbToOklab(c[0], c[1], c[2]));
  const lighter = Int16Array.from(lab, (_, i) => neighbour(lab, i, 1));
  const darker = Int16Array.from(lab, (_, i) => neighbour(lab, i, -1));
  return { w, h, idx, palette, rgb, lab, lighter, darker };
}

/** Nearest palette entry to an sRGB colour (OKLab distance). */
export function nearestEntry(img: IndexedImage, c: Vec3): number {
  const q = rgbToOklab(c[0], c[1], c[2]);
  let best = 0, bd = Infinity;
  for (let j = 0; j < img.lab.length; j++) {
    const d = labDist2(q, img.lab[j]);
    if (d < bd) { bd = d; best = j; }
  }
  return best;
}

/** Step entry i by n lightness steps (positive = lighter). */
export function step(img: IndexedImage, i: number, n: number): number {
  for (; n > 0; n--) i = img.lighter[i];
  for (; n < 0; n++) i = img.darker[i];
  return i;
}

/**
 * Entry for a translucent overlay (rain, snow, splash) over entry `under`: nearest palette colour to
 * the mix, forced at least one step lighter so the particle is never invisible.
 */
export function tintEntry(img: IndexedImage, under: number, tint: Vec3, amount: number): number {
  const u = img.rgb[under];
  const mix: Vec3 = [u[0] + (tint[0] - u[0]) * amount, u[1] + (tint[1] - u[1]) * amount, u[2] + (tint[2] - u[2]) * amount];
  const e = nearestEntry(img, mix);
  return img.lab[e][0] > img.lab[under][0] + 0.02 ? e : img.lighter[under];
}

export function toRgba(img: IndexedImage, idx: Int16Array): { w: number; h: number; data: Uint8ClampedArray } {
  const data = new Uint8ClampedArray(img.w * img.h * 4);
  for (let i = 0; i < idx.length; i++) {
    const p = idx[i];
    if (p < 0) continue;
    const c = img.rgb[p];
    data[i * 4] = c[0]; data[i * 4 + 1] = c[1]; data[i * 4 + 2] = c[2]; data[i * 4 + 3] = 255;
  }
  return { w: img.w, h: img.h, data };
}

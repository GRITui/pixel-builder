// Ordered Bayer dither, only in calm areas (skies, water) so detail stays crisp.
import type { Dither } from "./types";

export const DITHER_STRENGTH: Record<Dither, number> = { off: 0, low: 0.4, med: 0.7 };
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.5);

/** Perturb lightness (lab[i*3]) by the Bayer threshold where the local gradient is small. lab is modified in place. */
export function ditherCalm(lab: Float64Array, w: number, h: number, paletteL: number[], level: Dither, valid?: Uint8Array): void {
  const k = DITHER_STRENGTH[level];
  if (!k || paletteL.length < 2) return;
  const sorted = [...paletteL].sort((a, b) => a - b), diffs: number[] = [];
  for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] > 1e-4) diffs.push(sorted[i] - sorted[i - 1]);
  if (!diffs.length) return;
  diffs.sort((a, b) => a - b);
  const step = diffs[diffs.length >> 1];
  const L = (x: number, y: number) => lab[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 3];
  const shift = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (valid && !valid[y * w + x]) continue;
    const gx = (L(x + 1, y) - L(x - 1, y)) / 2, gy = (L(x, y + 1) - L(x, y - 1)) / 2;
    if (Math.hypot(gx, gy) < 0.02) shift[y * w + x] = BAYER4[(y & 3) * 4 + (x & 3)] * step * k * 2;
  }
  for (let i = 0; i < w * h; i++) lab[i * 3] += shift[i];
}

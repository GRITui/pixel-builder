// Bloom in linear light, applied BEFORE palette quantisation so glow becomes real palette steps.
import { linearToSrgb, srgbToLinear } from "../color/oklab";
import type { Bloom } from "./types";

export const BLOOM_STRENGTH: Record<Bloom, number> = { off: 0, low: 0.3, med: 0.6, high: 1 };

const LUT = new Float32Array(256).map((_, i) => srgbToLinear(i));
const lin = (v: number) => LUT[Math.min(255, Math.max(0, Math.round(v)))];

function blurPass(src: Float32Array, w: number, h: number, kernel: Float32Array, horiz: boolean): Float32Array {
  const out = new Float32Array(src.length), rad = (kernel.length - 1) >> 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let t = -rad; t <= rad; t++) {
      const sx = horiz ? Math.min(w - 1, Math.max(0, x + t)) : x, sy = horiz ? y : Math.min(h - 1, Math.max(0, y + t));
      const o = (sy * w + sx) * 3, k = kernel[t + rad];
      r += src[o] * k; g += src[o + 1] * k; b += src[o + 2] * k;
    }
    const o = (y * w + x) * 3;
    out[o] = r; out[o + 1] = g; out[o + 2] = b;
  }
  return out;
}

/** Add a soft glow around bright pixels. rgb is float sRGB 0..255 (3/px), modified in place. */
export function bloom(rgb: Float32Array, w: number, h: number, level: Bloom): void {
  const k = BLOOM_STRENGTH[level];
  if (!k) return;
  const n = w * h, bright = new Float32Array(n * 3), threshold = 0.5;
  for (let i = 0; i < n; i++) {
    const r = lin(rgb[i * 3]), g = lin(rgb[i * 3 + 1]), b = lin(rgb[i * 3 + 2]);
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b, f = y > threshold ? (y - threshold) / (1 - threshold) : 0;
    bright[i * 3] = r * f; bright[i * 3 + 1] = g * f; bright[i * 3 + 2] = b * f;
  }
  const sigma = Math.max(1.2, w * 0.012), rad = Math.ceil(sigma * 3);
  const kernel = new Float32Array(rad * 2 + 1);
  let s = 0;
  for (let t = -rad; t <= rad; t++) s += (kernel[t + rad] = Math.exp(-(t * t) / (2 * sigma * sigma)));
  for (let t = 0; t < kernel.length; t++) kernel[t] /= s;
  const blurred = blurPass(blurPass(bright, w, h, kernel, true), w, h, kernel, false);
  const gain = k * 2.2;
  for (let i = 0; i < n * 3; i++) rgb[i] = linearToSrgb(Math.min(1, lin(rgb[i]) + blurred[i] * gain));
}

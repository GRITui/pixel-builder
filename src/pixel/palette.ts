// Palette selection and nearest-colour lookup. All distances are OKLab with a chroma weight on a/b.
import { hexToRgb, oklabToRgb, rgbToHex, rgbToOklab } from "../color/oklab";
import { NES } from "../color/palettes";
import { snap555 } from "../color/rgb555";
import { rng } from "./rng";
import type { EraSpec } from "./types";

export type Rgb = [number, number, number];

/** Era chroma weight: the 8-bit hardware palette needs hue fidelity over lightness fidelity. */
export const chromaWeight = (palette: EraSpec["palette"]): number => (palette === "hardware-nes" ? 3 : 1.3);

/** Float RGB (3/px) -> weighted OKLab (3/px). */
export function toLab(rgb: ArrayLike<number>, n: number, cw: number): Float64Array {
  const out = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const [L, a, b] = rgbToOklab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
    out[i * 3] = L; out[i * 3 + 1] = a * cw; out[i * 3 + 2] = b * cw;
  }
  return out;
}

export const rgbListToLab = (list: Rgb[], cw: number): Float64Array => toLab(list.flat(), list.length, cw);

/** Evenly strided sample of at most `max` points (deterministic, seed shifts the phase). */
export function sampleIdx(n: number, max: number, seed: number): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  const rand = rng(seed ^ 0x9e3779b9), out: number[] = [];
  const stride = n / max, off = rand() * stride;
  for (let i = 0; i < max; i++) out.push(Math.min(n - 1, Math.floor(off + i * stride)));
  return out;
}

/** k-means++ over flat 3-vectors. Returns centroids (flat) and the assignment of every input point. */
export function kmeansLab(pts: Float64Array, k: number, seed: number, iters = 14): Float64Array {
  const n = pts.length / 3, rand = rng(seed);
  k = Math.max(1, Math.min(k, n));
  const c = new Float64Array(k * 3), d = new Float64Array(n).fill(Infinity);
  const first = Math.floor(rand() * n);
  c.set(pts.subarray(first * 3, first * 3 + 3), 0);
  for (let j = 1; j < k; j++) {
    let sum = 0;
    const o = (j - 1) * 3;
    for (let i = 0; i < n; i++) {
      const dd = (pts[i * 3] - c[o]) ** 2 + (pts[i * 3 + 1] - c[o + 1]) ** 2 + (pts[i * 3 + 2] - c[o + 2]) ** 2;
      if (dd < d[i]) d[i] = dd;
      sum += d[i];
    }
    let r = rand() * sum, pick = 0;
    for (; pick < n - 1; pick++) { r -= d[pick]; if (r <= 0) break; }
    c.set(pts.subarray(pick * 3, pick * 3 + 3), j * 3);
  }
  const acc = new Float64Array(k * 4);
  for (let it = 0; it < iters; it++) {
    acc.fill(0);
    for (let i = 0; i < n; i++) {
      const j = nearestOf(c, k, pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2]);
      acc[j * 4] += pts[i * 3]; acc[j * 4 + 1] += pts[i * 3 + 1]; acc[j * 4 + 2] += pts[i * 3 + 2]; acc[j * 4 + 3]++;
    }
    for (let j = 0; j < k; j++) if (acc[j * 4 + 3]) { c[j * 3] = acc[j * 4] / acc[j * 4 + 3]; c[j * 3 + 1] = acc[j * 4 + 1] / acc[j * 4 + 3]; c[j * 3 + 2] = acc[j * 4 + 2] / acc[j * 4 + 3]; }
  }
  return c;
}

function nearestOf(pal: Float64Array, k: number, L: number, a: number, b: number): number {
  let best = 0, bd = Infinity;
  for (let j = 0; j < k; j++) {
    const dd = (L - pal[j * 3]) ** 2 + (a - pal[j * 3 + 1]) ** 2 + (b - pal[j * 3 + 2]) ** 2;
    if (dd < bd) { bd = dd; best = j; }
  }
  return best;
}

/** Greedy pick of `count` colours from a fixed palette: each pick is the one that most cuts total error. */
export function greedyPick(sampleLab: Float64Array, hw: Rgb[], count: number, cw: number): Rgb[] {
  const n = sampleLab.length / 3, hl = rgbListToLab(hw, cw), m = hw.length;
  const d = new Float64Array(n * m);
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) d[i * m + j] = (sampleLab[i * 3] - hl[j * 3]) ** 2 + (sampleLab[i * 3 + 1] - hl[j * 3 + 1]) ** 2 + (sampleLab[i * 3 + 2] - hl[j * 3 + 2]) ** 2;
  const best = new Float64Array(n).fill(Infinity), chosen: number[] = [];
  for (let p = 0; p < Math.min(count, m); p++) {
    let bj = -1, bg = Infinity;
    for (let j = 0; j < m; j++) {
      if (chosen.includes(j)) continue;
      let g = 0;
      for (let i = 0; i < n; i++) g += Math.min(d[i * m + j], best[i]);
      if (g < bg) { bg = g; bj = j; }
    }
    chosen.push(bj);
    for (let i = 0; i < n; i++) best[i] = Math.min(best[i], d[i * m + bj]);
  }
  return chosen.sort((a, b) => a - b).map((j) => hw[j]);
}

export interface PaletteRequest {
  /** Float RGB (3/px) of the (graded) opaque pixels. */
  rgb: Float32Array;
  count: number;
  rule: EraSpec["palette"];
  seed: number;
}

/** Choose a palette (sRGB ints) for the pixels per the era rule. */
export function buildPalette(req: PaletteRequest): Rgb[] {
  const n = req.rgb.length / 3, cw = chromaWeight(req.rule);
  const picks = sampleIdx(n, 12000, req.seed), sample = new Float32Array(picks.length * 3);
  picks.forEach((p, i) => sample.set(req.rgb.subarray(p * 3, p * 3 + 3), i * 3));
  if (req.rule === "rgb555") for (let i = 0; i < sample.length; i++) sample[i] = snap555(sample[i]);
  const lab = toLab(sample, picks.length, cw);
  if (req.rule === "hardware-nes") return greedyPick(lab, NES.map(hexToRgb), req.count, cw);
  const cent = kmeansLab(lab, req.count, req.seed), k = cent.length / 3;
  const sum = new Float64Array(k * 4);
  for (let i = 0; i < picks.length; i++) {
    const j = nearestOf(cent, k, lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2]);
    sum[j * 4] += sample[i * 3]; sum[j * 4 + 1] += sample[i * 3 + 1]; sum[j * 4 + 2] += sample[i * 3 + 2]; sum[j * 4 + 3]++;
  }
  const seen = new Set<number>(), out: Rgb[] = [];
  for (let j = 0; j < k; j++) {
    let rgb: Rgb;
    if (sum[j * 4 + 3]) rgb = [sum[j * 4] / sum[j * 4 + 3], sum[j * 4 + 1] / sum[j * 4 + 3], sum[j * 4 + 2] / sum[j * 4 + 3]];
    else rgb = oklabToRgb(cent[j * 3], cent[j * 3 + 1] / cw, cent[j * 3 + 2] / cw);
    const q = rgb.map((v) => (req.rule === "rgb555" ? snap555(v) : Math.round(Math.min(255, Math.max(0, v))))) as Rgb;
    const key = (q[0] << 16) | (q[1] << 8) | q[2];
    if (!seen.has(key)) { seen.add(key); out.push(q); }
  }
  return out;
}

/** Nearest palette index for each opaque pixel; exact-colour lookups are cached. `lab` is weighted OKLab. */
export class Nearest {
  private pal: Float64Array;
  private cache = new Map<number, number>();
  constructor(palette: Rgb[], private cw: number) { this.pal = rgbListToLab(palette, cw); }
  get paletteL(): number[] { return Array.from({ length: this.pal.length / 3 }, (_, j) => this.pal[j * 3]); }
  lab(j: number): [number, number, number] { return [this.pal[j * 3], this.pal[j * 3 + 1], this.pal[j * 3 + 2]]; }
  /** Looks up by pre-rounded rgb key when the lab is unperturbed, otherwise by lab. */
  byRgb(r: number, g: number, b: number): number {
    const key = (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
    let v = this.cache.get(key);
    if (v === undefined) {
      const [L, a, bb] = rgbToOklab(Math.round(r), Math.round(g), Math.round(b));
      v = nearestOf(this.pal, this.pal.length / 3, L, a * this.cw, bb * this.cw);
      this.cache.set(key, v);
    }
    return v;
  }
  byLab(L: number, a: number, b: number): number { return nearestOf(this.pal, this.pal.length / 3, L, a, b); }
}

export const paletteHex = (p: Rgb[]): string[] => p.map((c) => rgbToHex(c[0], c[1], c[2]));

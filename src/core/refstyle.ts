// Offline style extraction: read a reference image (screenshot, concept art, pixel art) and guess the
// Style Kit settings that would make the generators look like it: dominant colours, per-material ramps,
// outline mode, light direction, shade steps, dither and detail. Pure and deterministic (no Math.random).
import { MATERIALS, PALETTES, RAMP_LEN, hexToRgb, luma, rgbToHex, rgbToOklab, type Material, type Ramps, type RGB } from "./palette";
import type { LightDir, OutlineMode, StyleKit } from "./types";

export interface RefImage {
  w: number;
  h: number;
  /** w * h * 4 RGBA bytes. */
  data: ArrayLike<number>;
}

type Lab = [number, number, number];

export interface RefPaletteEntry {
  hex: string;
  /** Share of the analysed (solid) pixels, 0..1. */
  weight: number;
}

export interface RefAnalysis {
  size: { w: number; h: number };
  /** Detected integer upscale of pixel art (1 = none). Analysis runs on the reduced image. */
  pixelScale: number;
  solidPixels: number;
  /** Dominant colours, most common first. */
  palette: RefPaletteEntry[];
  /** True when the image uses so few tones that every material should share them (handheld style). */
  limited: boolean;
  /** Ramps for materials whose colour family occurs in the reference; others keep the base palette. */
  rampOverrides: Partial<Ramps>;
  /** For the unmatched materials: the base ramp with saturation pulled toward the reference. */
  harmonized: Partial<Ramps>;
  matches: Partial<Record<Material, { weight: number; colors: string[] }>>;
  outline: { mode: OutlineMode; darkRatio: number; contourPixels: number };
  light: { dir: LightDir; lx: number; ly: number };
  shadeSteps: number;
  dither: { enabled: boolean; checker: number };
  suggest: { detail: "standard" | "rich"; rampDepth: 5 | 7 | 9; distinctColors: number };
}

export interface AnalyzeOptions {
  /** Dominant colours to extract, 8..32 (default 16). */
  paletteSize?: number;
  /** Ramps that unmatched materials fall back to (default: the Hearthwood palette). */
  baseRamps?: Ramps;
}

// ---------- colour helpers ----------

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return v * 255;
}

function rawOklabToRgb([L, a, b]: Lab): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** OKLab -> hex; out-of-gamut colours lose chroma (not lightness) until they fit. */
export function oklabToHex(lab: Lab): string {
  const inGamut = (c: Lab) => rawOklabToRgb(c).every((v) => v >= -0.5 && v <= 255.5);
  let k = 1;
  if (!inGamut(lab)) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 14; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut([lab[0], lab[1] * mid, lab[2] * mid])) lo = mid;
      else hi = mid;
    }
    k = lo;
  }
  return rgbToHex(rawOklabToRgb([lab[0], lab[1] * k, lab[2] * k]));
}

const labOf = (hex: string): Lab => rgbToOklab(hexToRgb(hex));
const chromaOf = (l: Lab) => Math.hypot(l[1], l[2]);
const hueOf = (l: Lab) => Math.atan2(l[2], l[1]);

/** Strictly increasing luma, nudging lighter where a colour would break the order (ramps stay dark -> light). */
export function repairRamp(ramp: string[]): string[] {
  const out = [...ramp];
  for (let i = 1; i < out.length; i++) {
    let guard = 0;
    while (luma(out[i]) <= luma(out[i - 1]) + 1 && guard++ < 80) {
      const [r, g, b] = hexToRgb(out[i]);
      out[i] = rgbToHex([r + (255 - r) * 0.05 + 1, g + (255 - g) * 0.05 + 1, b + (255 - b) * 0.05 + 1]);
    }
  }
  return out;
}

/** Lerp two ramps in OKLab (strength 0 = base, 1 = derived). */
export function blendRamp(base: string[], derived: string[], strength: number): string[] {
  const s = clamp(strength, 0, 1);
  if (s >= 1) return derived;
  if (s <= 0) return base;
  return repairRamp(
    base.map((b, i) => {
      const x = labOf(b), y = labOf(derived[i]);
      return oklabToHex([x[0] + (y[0] - x[0]) * s, x[1] + (y[1] - x[1]) * s, x[2] + (y[2] - x[2]) * s]);
    }),
  );
}

// ---------- pixel scale ----------

/**
 * Cheap guess at an integer nearest-neighbour upscale (1 = none): the largest k in 2..16 for which
 * almost no neighbouring pixels differ inside a k-block while block borders do change. The exact grid
 * detection (offsets, noisy scans) belongs to core/pixelgrid.ts; this one only drives the analysis.
 */
export function estimatePixelScaleFast(img: RefImage): number {
  const { w, h, data } = img;
  const same = (i: number, j: number) => data[i] === data[j] && data[i + 1] === data[j + 1] && data[i + 2] === data[j + 2] && data[i + 3] === data[j + 3];
  for (let k = 16; k >= 2; k--) {
    if (w < k * 4 || h < k * 4) continue;
    let inside = 0, insideEq = 0, edge = 0, edgeEq = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w - 1; x++) {
        const eq = same((y * w + x) * 4, (y * w + x + 1) * 4);
        if (x % k === k - 1) { edge++; if (eq) edgeEq++; }
        else { inside++; if (eq) insideEq++; }
      }
    for (let y = 0; y < h - 1; y++)
      for (let x = 0; x < w; x++) {
        const eq = same((y * w + x) * 4, ((y + 1) * w + x) * 4);
        if (y % k === k - 1) { edge++; if (eq) edgeEq++; }
        else { inside++; if (eq) insideEq++; }
      }
    if (insideEq / inside >= 0.995 && 1 - edgeEq / edge >= 0.08) return k;
  }
  return 1;
}

function reduceByScale(img: RefImage, k: number): RefImage {
  if (k <= 1) return img;
  const w = Math.floor(img.w / k), h = Math.floor(img.h / k);
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const so = ((y * k + (k >> 1)) * img.w + x * k + (k >> 1)) * 4;
      for (let c = 0; c < 4; c++) data[(y * w + x) * 4 + c] = img.data[so + c];
    }
  return { w, h, data };
}

// ---------- palette (median cut + k-means in OKLab) ----------

interface Entry { lab: Lab; rgb: RGB; w: number }

function uniqueColors(img: RefImage, solid: Uint8Array): Entry[] {
  const map = new Map<number, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i < img.w * img.h; i++) {
    if (!solid[i]) continue;
    const r = img.data[i * 4], g = img.data[i * 4 + 1], b = img.data[i * 4 + 2];
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    const e = map.get(key);
    if (e) { e.r += r; e.g += g; e.b += b; e.n++; }
    else map.set(key, { r, g, b, n: 1 });
  }
  return [...map.values()].map((e) => {
    const rgb: RGB = [e.r / e.n, e.g / e.n, e.b / e.n];
    return { lab: rgbToOklab(rgb), rgb, w: e.n };
  });
}

function medianCut(entries: Entry[], n: number): Lab[] {
  let boxes: Entry[][] = [entries];
  while (boxes.length < n) {
    let bi = -1, best = 0, axis = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let a = 0; a < 3; a++) {
        let lo = Infinity, hi = -Infinity;
        for (const e of b) { lo = Math.min(lo, e.lab[a]); hi = Math.max(hi, e.lab[a]); }
        const wgt = (a === 0 ? 1.4 : 1) * (hi - lo) * Math.sqrt(b.reduce((s, e) => s + e.w, 0));
        if (wgt > best) { best = wgt; bi = i; axis = a; }
      }
    });
    if (bi < 0) break;
    const b = [...boxes[bi]].sort((p, q) => p.lab[axis] - q.lab[axis] || p.lab[0] - q.lab[0] || p.lab[1] - q.lab[1] || p.lab[2] - q.lab[2]);
    const total = b.reduce((s, e) => s + e.w, 0);
    let acc = 0, cut = 1;
    for (let i = 0; i < b.length - 1; i++) { acc += b[i].w; cut = i + 1; if (acc >= total / 2) break; }
    boxes.splice(bi, 1, b.slice(0, cut), b.slice(cut));
  }
  return boxes.map((b) => {
    const t = b.reduce((s, e) => s + e.w, 0);
    return [0, 1, 2].map((a) => b.reduce((s, e) => s + e.lab[a] * e.w, 0) / t) as Lab;
  });
}

function kmeans(entries: Entry[], seeds: Lab[], iters = 4): { lab: Lab; w: number }[] {
  let cs = seeds;
  let ws: number[] = [];
  for (let it = 0; it < iters; it++) {
    const sum = cs.map(() => [0, 0, 0, 0]);
    for (const e of entries) {
      let bi = 0, bd = Infinity;
      cs.forEach((c, i) => {
        const d = (c[0] - e.lab[0]) ** 2 + (c[1] - e.lab[1]) ** 2 + (c[2] - e.lab[2]) ** 2;
        if (d < bd) { bd = d; bi = i; }
      });
      sum[bi][0] += e.lab[0] * e.w; sum[bi][1] += e.lab[1] * e.w; sum[bi][2] += e.lab[2] * e.w; sum[bi][3] += e.w;
    }
    ws = sum.map((s) => s[3]);
    cs = cs.map((c, i) => (sum[i][3] > 0 ? ([sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] as Lab) : c));
  }
  return cs.map((lab, i) => ({ lab, w: ws[i] })).filter((c) => c.w > 0);
}

// ---------- material families -> ramps ----------

const BASE_LABS = (ramps: Ramps) => Object.fromEntries(MATERIALS.map((m) => [m, ramps[m].map(labOf)])) as Record<Material, Lab[]>;

/** Hue/chroma-weighted distance (lightness counts little: a family spans a whole ramp). */
function familyDistance(lab: Lab, ramp: Lab[]): number {
  let best = Infinity;
  for (const r of ramp) best = Math.min(best, Math.hypot(0.35 * (lab[0] - r[0]), lab[1] - r[1], lab[2] - r[2]));
  return best;
}

function mergeAnchors(anchors: { lab: Lab; w: number }[]): { lab: Lab; w: number }[] {
  const sorted = [...anchors].sort((a, b) => a.lab[0] - b.lab[0]);
  const out: { lab: Lab; w: number }[] = [];
  for (const a of sorted) {
    const last = out[out.length - 1];
    if (last && a.lab[0] - last.lab[0] < 0.03) {
      const t = last.w + a.w;
      last.lab = [0, 1, 2].map((k) => (last.lab[k] * last.w + a.lab[k] * a.w) / t) as Lab;
      last.w = t;
    } else out.push({ lab: [...a.lab] as Lab, w: a.w });
  }
  return out;
}

function buildRamp(members: { lab: Lab; w: number }[], base: Lab[]): string[] {
  const anchors = mergeAnchors(members);
  const baseSpan = base[RAMP_LEN - 1][0] - base[0][0];
  const lo0 = anchors[0].lab[0], hi0 = anchors[anchors.length - 1].lab[0];
  const want = clamp(Math.max(hi0 - lo0, baseSpan * 0.7), 0.3, 0.88);
  let lo = (lo0 + hi0) / 2 - want / 2, hi = lo + want;
  if (lo < 0.1) { hi += 0.1 - lo; lo = 0.1; }
  if (hi > 0.97) { lo -= hi - 0.97; hi = 0.97; }
  lo = Math.max(0.05, lo);
  const mid = base[2];
  const out: Lab[] = [];
  for (let i = 0; i < RAMP_LEN; i++) {
    const L = lo + (hi - lo) * ((base[i][0] - base[0][0]) / baseSpan);
    let ab: [number, number];
    if (anchors.length === 1) ab = [anchors[0].lab[1] + (base[i][1] - mid[1]) * 0.6, anchors[0].lab[2] + (base[i][2] - mid[2]) * 0.6];
    else if (L <= anchors[0].lab[0]) ab = [anchors[0].lab[1], anchors[0].lab[2]];
    else if (L >= anchors[anchors.length - 1].lab[0]) ab = [anchors[anchors.length - 1].lab[1], anchors[anchors.length - 1].lab[2]];
    else {
      let k = 0;
      while (anchors[k + 1].lab[0] < L) k++;
      const a = anchors[k].lab, b = anchors[k + 1].lab;
      const t = (L - a[0]) / (b[0] - a[0]);
      ab = [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }
    out.push([i > 0 ? Math.max(L, out[i - 1][0] + 0.03) : L, ab[0], ab[1]]);
  }
  return repairRamp(out.map(oklabToHex));
}

// ---------- the analysis ----------

const MIN_MATCH_WEIGHT = 0.012;

export function analyzeReference(input: RefImage, opts: AnalyzeOptions = {}): RefAnalysis {
  const paletteSize = clamp(Math.round(opts.paletteSize ?? 16), 8, 32);
  const baseRamps = opts.baseRamps ?? PALETTES[0].ramps;
  const pixelScale = estimatePixelScaleFast(input);
  const img = reduceByScale(input, pixelScale);
  const { w, h, data } = img;
  const n = w * h;

  const lab = new Float32Array(n * 3);
  const packed = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const l = rgbToOklab([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
    lab[i * 3] = l[0]; lab[i * 3 + 1] = l[1]; lab[i * 3 + 2] = l[2];
    packed[i] = (data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2];
  }

  // empty = transparent or flood-filled flat background reached from the border
  const empty = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (data[i * 4 + 3] < 128) empty[i] = 1;
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  const counts = new Map<number, number>();
  for (const i of border) if (!empty[i]) counts.set(packed[i], (counts.get(packed[i]) ?? 0) + 1);
  let bgKey = -1, bgN = 0;
  for (const [k, c] of counts) if (c > bgN || (c === bgN && k < bgKey)) { bgN = c; bgKey = k; }
  if (bgKey >= 0 && bgN >= 0.6 * border.length) {
    const bg = rgbToOklab([(bgKey >> 16) & 255, (bgKey >> 8) & 255, bgKey & 255]);
    const near = (i: number) => Math.hypot(lab[i * 3] - bg[0], lab[i * 3 + 1] - bg[1], lab[i * 3 + 2] - bg[2]) < 0.025;
    const stack = border.filter((i) => !empty[i] && near(i));
    for (const i of stack) empty[i] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % w, y = (i / w) | 0;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1])
        if (j >= 0 && !empty[j] && near(j)) { empty[j] = 1; stack.push(j); }
    }
  }
  const solid = new Uint8Array(n);
  let solidPixels = 0;
  for (let i = 0; i < n; i++) if (!empty[i]) { solid[i] = 1; solidPixels++; }
  const base = BASE_LABS(baseRamps);
  const blank: RefAnalysis = {
    size: { w: input.w, h: input.h }, pixelScale, solidPixels, palette: [], limited: false, rampOverrides: {}, harmonized: {}, matches: {},
    outline: { mode: "none", darkRatio: 0, contourPixels: 0 }, light: { dir: "top-left", lx: 0, ly: 0 }, shadeSteps: 4,
    dither: { enabled: false, checker: 0 }, suggest: { detail: "standard", rampDepth: 5, distinctColors: 0 },
  };
  if (solidPixels === 0) return blank;

  // ---- palette
  const entries = uniqueColors(img, solid);
  const distinct = new Set<number>();
  for (let i = 0; i < n; i++) if (solid[i]) distinct.add(packed[i]);
  const limited = distinct.size <= 6;
  const k = limited ? distinct.size : Math.min(paletteSize, entries.length);
  const clusters = kmeans(entries, medianCut(entries, k))
    .map((c) => ({ ...c, hex: oklabToHex(c.lab), weight: c.w / solidPixels }))
    .sort((a, b) => b.weight - a.weight || (a.hex < b.hex ? -1 : 1));
  const palette: RefPaletteEntry[] = clusters.map((c) => ({ hex: c.hex, weight: c.weight }));

  // ---- ramps
  const rampOverrides: Partial<Ramps> = {};
  const harmonized: Partial<Ramps> = {};
  const matches: RefAnalysis["matches"] = {};
  if (limited) {
    const tones = [...clusters].sort((a, b) => a.lab[0] - b.lab[0]).map((c) => c.hex);
    const ramp = [0, 1, 2, 3, 4].map((i) => tones[Math.round(clamp((i - 1) / 3, 0, 1) * (tones.length - 1))]);
    for (const m of MATERIALS) { rampOverrides[m] = [...ramp]; matches[m] = { weight: 1, colors: tones }; }
  } else {
    const members = new Map<Material, { lab: Lab; w: number }[]>();
    for (const c of clusters) {
      const d = MATERIALS.map((m) => familyDistance(c.lab, base[m]));
      const best = Math.min(...d);
      MATERIALS.forEach((m, i) => {
        if (d[i] <= Math.min(0.055, best + 0.02) && best <= 0.055) members.set(m, [...(members.get(m) ?? []), { lab: c.lab, w: c.weight }]);
      });
    }
    for (const m of MATERIALS) {
      const ms = members.get(m);
      if (!ms || ms.reduce((s, e) => s + e.w, 0) < MIN_MATCH_WEIGHT) continue;
      rampOverrides[m] = buildRamp(ms, base[m]);
      matches[m] = { weight: ms.reduce((s, e) => s + e.w, 0), colors: ms.map((e) => oklabToHex(e.lab)) };
    }
    const meanChroma = (ls: Lab[], ws?: number[]) => { const t = ws ? ws.reduce((s, v) => s + v, 0) : ls.length; return ls.reduce((s, l, i) => s + chromaOf(l) * (ws ? ws[i] : 1), 0) / t; };
    const ref = meanChroma(clusters.map((c) => c.lab), clusters.map((c) => c.weight));
    const baseC = meanChroma(MATERIALS.flatMap((m) => base[m]));
    const scale = clamp(ref / baseC, 0.3, 1.2);
    for (const m of MATERIALS) {
      if (rampOverrides[m]) continue;
      harmonized[m] = repairRamp(base[m].map((l) => oklabToHex([l[0], l[1] * scale, l[2] * scale])));
    }
  }

  // ---- outline: how dark are the pixels on the silhouette (or strongest edges)?
  const L = (i: number) => lab[i * 3];
  const nb = (i: number): number[] => {
    const x = i % w, y = (i / w) | 0;
    const r: number[] = [];
    if (x > 0) r.push(i - 1);
    if (x < w - 1) r.push(i + 1);
    if (y > 0) r.push(i - w);
    if (y < h - 1) r.push(i + w);
    return r;
  };
  let contour: number[] = [];
  for (let i = 0; i < n; i++) if (solid[i] && nb(i).some((j) => !solid[j])) contour.push(i);
  if (contour.length < 12) {
    contour = [];
    for (let i = 0; i < n; i++) if (solid[i] && nb(i).some((j) => solid[j] && L(j) - L(i) > 0.12)) contour.push(i);
  }
  const sortedL = [];
  for (let i = 0; i < n; i++) if (solid[i]) sortedL.push(L(i));
  sortedL.sort((a, b) => a - b);
  const medL = sortedL[sortedL.length >> 1];
  const darkThr = Math.min(0.36, medL - 0.1);
  const dark = contour.filter((i) => L(i) < darkThr);
  const darkRatio = contour.length ? dark.length / contour.length : 0;
  let mode: OutlineMode = "none";
  if (contour.length >= 12 && contour.length / solidPixels >= 0.015 && darkRatio >= 0.3) {
    if (darkRatio < 0.7) mode = "selective";
    else {
      const chroma = dark.reduce((s, i) => s + Math.hypot(lab[i * 3 + 1], lab[i * 3 + 2]), 0) / dark.length;
      let cx = 0, cy = 0;
      for (const i of dark) { const hh = Math.atan2(lab[i * 3 + 2], lab[i * 3 + 1]); cx += Math.cos(hh); cy += Math.sin(hh); }
      const spread = 1 - Math.hypot(cx, cy) / dark.length;
      mode = chroma >= 0.015 && spread > 0.35 ? "colored" : "black";
    }
  }

  // ---- light: which way do small lightness steps (shading, not object edges) point?
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) {
    if (!solid[i]) continue;
    const x = i % w;
    if (x < w - 1 && solid[i + 1]) { const d = L(i + 1) - L(i); if (Math.abs(d) >= 0.004 && Math.abs(d) <= 0.14) sx += d; }
    if (i + w < n && solid[i + w]) { const d = L(i + w) - L(i); if (Math.abs(d) >= 0.004 && Math.abs(d) <= 0.14) sy += d; }
  }
  const lx = -sx, ly = -sy, mag = Math.abs(lx) + Math.abs(ly);
  const frac = mag > 1e-6 ? lx / mag : 0;
  const lightDir: LightDir = frac > 0.28 || mag < 1e-6 ? "top-left" : frac < -0.28 ? "top-right" : "top";

  // ---- shade steps (tones per hue) and dither (checkerboard pixels)
  const buckets = new Map<number, { w: number; n: number }>();
  for (const c of clusters) {
    const key = chromaOf(c.lab) < 0.03 ? 12 : Math.floor(((hueOf(c.lab) + Math.PI) / (2 * Math.PI)) * 12) % 12;
    const b = buckets.get(key) ?? { w: 0, n: 0 };
    b.w += c.weight; b.n++;
    buckets.set(key, b);
  }
  const counts2 = [...buckets.values()].filter((b) => b.w >= 0.05).map((b) => b.n).sort((a, b) => a - b);
  const median = counts2.length ? counts2[counts2.length >> 1] : 3;
  const shadeSteps = limited ? clamp(distinct.size - 1, 2, 5) : clamp(median, 2, 5);
  let checker = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, p = packed[i];
      if (!solid[i] || p === packed[i - 1] || p === packed[i + 1] || p === packed[i - w] || p === packed[i + w]) continue;
      if (p === packed[i - w - 1] && p === packed[i - w + 1] && p === packed[i + w - 1] && p === packed[i + w + 1]) checker++;
    }
  const checkerRatio = checker / solidPixels;

  const detail = distinct.size > 24 ? "rich" : "standard";
  const rampDepth = distinct.size > 200 ? 9 : distinct.size > 60 ? 7 : 5;
  return {
    ...blank, palette, limited, rampOverrides, harmonized, matches,
    outline: { mode, darkRatio, contourPixels: contour.length },
    light: { dir: lightDir, lx, ly },
    shadeSteps,
    dither: { enabled: checkerRatio > 0.02, checker: checkerRatio },
    suggest: { detail, rampDepth, distinctColors: distinct.size },
  };
}

/**
 * Kit fields derived from an analysis: ramp overrides (blended toward the reference by `strength`) and,
 * with apply "all", outline / light / shade steps / dither / vibe. `detail` and `rampDepth` stay suggestions
 * because both hue-shift the ramps again.
 */
export function kitChangesFromAnalysis(
  a: RefAnalysis,
  baseRamps: Ramps,
  o: { apply?: "palette" | "all"; strength?: number; label?: string } = {},
): Partial<StyleKit> {
  const apply = o.apply ?? "all", strength = o.strength ?? 1;
  const rampOverrides: Partial<Ramps> = {};
  for (const m of MATERIALS) {
    const derived = a.rampOverrides[m] ?? (apply === "all" ? a.harmonized[m] : undefined);
    if (derived) rampOverrides[m] = blendRamp(baseRamps[m], derived, strength);
  }
  if (apply === "palette") return { rampOverrides };
  return {
    rampOverrides, outline: a.outline.mode, lightDir: a.light.dir, shadeSteps: a.shadeSteps, dither: a.dither.enabled,
    vibe: `Matched to reference${o.label ? ` '${o.label}'` : ""}: ${a.outline.mode} outlines, light from ${a.light.dir}, ${a.shadeSteps} shades per colour${a.dither.enabled ? ", dithered" : ""}.`,
  };
}

// ===== BEGIN style distance (#67): how close is an asset to a reference? =====

export interface StyleDistanceComponents {
  /** Dominant-colour match in OKLab (weighted nearest-colour distance both ways), 0..1. */
  palette: number;
  /** Tones per hue (shade count) agreement, 0..1. */
  shades: number;
  /** Outline mode match (none / black / colored / selective), 0..1. */
  outline: number;
  /** Light direction agreement, 0..1. */
  light: number;
  /** Edge density per area, 0..1. */
  detail: number;
  /** Aspect ratio and fill of the opaque bounding box, 0..1. */
  silhouette: number;
}
export interface StyleDistance {
  components: StyleDistanceComponents;
  /** 0..100, 100 = same style. */
  score: number;
  notes: string[];
}

const SD_WEIGHTS: Record<keyof StyleDistanceComponents, number> = { palette: 0.35, shades: 0.1, outline: 0.1, light: 0.1, detail: 0.2, silhouette: 0.15 };

/** Edge density (share of neighbouring solid pixel pairs that differ clearly in OKLab) plus the opaque bounding box. */
function sdShape(img: RefImage): { edge: number; aspect: number; fill: number; empty: boolean } {
  const { w, h, data } = img;
  const solid = (i: number) => data[i * 4 + 3] >= 128;
  const lab = (i: number) => rgbToOklab([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
  let x0 = w, y0 = h, x1 = -1, y1 = -1, count = 0, pairs = 0, edges = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!solid(i)) continue;
      count++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const a = lab(i);
      for (const j of [x + 1 < w ? i + 1 : -1, y + 1 < h ? i + w : -1]) {
        if (j < 0 || !solid(j)) continue;
        pairs++;
        const b = lab(j);
        if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 0.05) edges++;
      }
    }
  if (!count) return { edge: 0, aspect: 1, fill: 0, empty: true };
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  return { edge: pairs ? edges / pairs : 0, aspect: bw / bh, fill: count / (bw * bh), empty: false };
}

const sdRatio = (a: number, b: number, eps = 0.01) => (Math.min(a, b) + eps) / (Math.max(a, b) + eps);
const sdLab = (p: RefPaletteEntry) => rgbToOklab(hexToRgb(p.hex));

/** Weighted nearest-colour distance from `from` to `to` (OKLab: hue and lightness both count). */
function sdChamfer(from: RefPaletteEntry[], to: RefPaletteEntry[]): number {
  const tl = to.map(sdLab);
  let sum = 0, wsum = 0;
  for (const p of from) {
    const a = sdLab(p);
    let best = Infinity;
    for (const b of tl) best = Math.min(best, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    sum += best * p.weight;
    wsum += p.weight;
  }
  return wsum ? sum / wsum : 0;
}

/**
 * Compare an asset render with a reference image: six components 0..1, a 0..100 score and actionable
 * notes. Pure and deterministic. Identical images score 100; palette shift and blur only lower it.
 * Pixel-art upscales are reduced first, so a 4x reference and a 1x asset compare fairly.
 */
export function styleDistance(assetImg: RefImage, refImg: RefImage): StyleDistance {
  const A = reduceByScale(assetImg, estimatePixelScaleFast(assetImg)), R = reduceByScale(refImg, estimatePixelScaleFast(refImg));
  const aa = analyzeReference(A, { paletteSize: 16 }), ra = analyzeReference(R, { paletteSize: 16 });
  const as = sdShape(A), rs = sdShape(R);
  const notes: string[] = [];

  const d = (sdChamfer(aa.palette, ra.palette) + sdChamfer(ra.palette, aa.palette)) / 2;
  const palette = Math.exp(-d / 0.07);
  const shades = sdRatio(aa.shadeSteps, ra.shadeSteps, 0);
  const outline = aa.outline.mode === ra.outline.mode ? 1 : (aa.outline.mode === "none") !== (ra.outline.mode === "none") ? 0 : 0.5;
  const ma = Math.hypot(aa.light.lx, aa.light.ly), mr = Math.hypot(ra.light.lx, ra.light.ly);
  const light = ma < 1e-6 || mr < 1e-6 ? (ma < 1e-6 && mr < 1e-6 ? 1 : 0.5) : (1 + (aa.light.lx * ra.light.lx + aa.light.ly * ra.light.ly) / (ma * mr)) / 2;
  const detail = sdRatio(as.edge, rs.edge);
  const silhouette = as.empty || rs.empty ? 0 : (sdRatio(as.aspect, rs.aspect, 0) + (1 - Math.abs(as.fill - rs.fill))) / 2;

  const components: StyleDistanceComponents = { palette, shades, outline, light, detail, silhouette };
  let score = 0;
  for (const k of Object.keys(SD_WEIGHTS) as (keyof StyleDistanceComponents)[]) score += components[k] * SD_WEIGHTS[k];
  score = Math.round(score * 1000) / 10;

  if (palette < 0.75) {
    const mean = (p: RefPaletteEntry[]) => p.reduce((s, e) => s + sdLab(e)[0] * e.weight, 0) / (p.reduce((s, e) => s + e.weight, 0) || 1);
    const lA = mean(aa.palette), lR = mean(ra.palette);
    notes.push(`Palette is off (${Math.round(palette * 100)}% match)${Math.abs(lA - lR) > 0.06 ? `; the asset is ${lA > lR ? "lighter" : "darker"} than the reference` : ""}: run kit_from_reference on this reference and regenerate with that kit.`);
  }
  if (shades < 0.75) {
    const more = ra.shadeSteps > aa.shadeSteps;
    notes.push(`Reference uses ~${ra.shadeSteps} shades per hue, you use ${aa.shadeSteps}: ${more ? "try kit-hd-deep (deeper ramps) or detail rich" : "use ramp depth 5 and detail standard (flatter shading)"}.`);
  }
  if (outline < 1) notes.push(`Reference outline is '${ra.outline.mode}', the asset's is '${aa.outline.mode}': set the kit outline to '${ra.outline.mode}'.`);
  if (light < 0.7) notes.push(`Light comes from ${ra.light.dir} in the reference but ${aa.light.dir} in the asset: set the kit lightDir to '${ra.light.dir}'.`);
  if (detail < 0.7) {
    const smooth = as.edge < rs.edge;
    notes.push(`The asset is ${smooth ? "smoother" : "busier"} than the reference (edge density ${(as.edge * 100).toFixed(0)}% vs ${(rs.edge * 100).toFixed(0)}%): ${smooth ? "use detail rich, or add texture and dither" : "use detail standard and fewer decorations"}.`);
  }
  if (silhouette < 0.7) notes.push(`Silhouette differs (aspect ${as.aspect.toFixed(2)} vs ${rs.aspect.toFixed(2)}, fill ${Math.round(as.fill * 100)}% vs ${Math.round(rs.fill * 100)}%): compare proportions or crop the reference to the subject.`);
  if (!notes.length) notes.push("Close match: palette, shading and detail agree with the reference.");
  return { components, score, notes };
}

// ===== END style distance (#67) =====

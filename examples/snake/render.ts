// Procedural "realistic" source renderer for the Snake showcase: shaded 3D-ish objects at high resolution.
// Everything is code (no stock photos). Objects sit on flat #00FF00 so sprite mode keys them out.
import { rng } from "../../src/pixel/rng";
import type { Rgba } from "../../src/pixel/types";

export type C = [number, number, number];
export const KEY: C = [0, 1, 0];
export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const mix = (a: C, b: C, t: number): C => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const mul = (a: C, k: number): C => [a[0] * k, a[1] * k, a[2] * k];
export const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const hex = (h: string): C => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

export class Canvas {
  d: Float32Array;
  constructor(public w: number, public h: number, bg: C) {
    this.d = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) this.d.set(bg, i * 3);
  }
  /** Paint where sdf<0 (pixel units, antialiased) using shade(x,y,sdf). */
  shape(sdf: (x: number, y: number) => number, shade: (x: number, y: number, d: number) => C | null, box?: [number, number, number, number]) {
    const [x0, y0, x1, y1] = box ?? [0, 0, this.w, this.h];
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(this.h, Math.ceil(y1)); y++)
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(this.w, Math.ceil(x1)); x++) {
        const d = sdf(x + 0.5, y + 0.5);
        if (d > 0.7) continue;
        const cov = clamp(0.5 - d / 1.4);
        const c = shade(x + 0.5, y + 0.5, d);
        if (!c) continue;
        const i = (y * this.w + x) * 3;
        for (let k = 0; k < 3; k++) this.d[i + k] += (c[k] - this.d[i + k]) * cov;
      }
  }
  /** Per-pixel fill. */
  fill(f: (x: number, y: number) => C, box?: [number, number, number, number]) {
    const [x0, y0, x1, y1] = box ?? [0, 0, this.w, this.h];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.d.set(f(x + 0.5, y + 0.5), (y * this.w + x) * 3);
  }
  rgba(): Rgba {
    const data = new Uint8ClampedArray(this.w * this.h * 4);
    for (let i = 0; i < this.w * this.h; i++) {
      data[i * 4] = Math.round(clamp(this.d[i * 3]) * 255);
      data[i * 4 + 1] = Math.round(clamp(this.d[i * 3 + 1]) * 255);
      data[i * 4 + 2] = Math.round(clamp(this.d[i * 3 + 2]) * 255);
      data[i * 4 + 3] = 255;
    }
    return { w: this.w, h: this.h, data };
  }
}

// ---- noise (optionally periodic with integer lattice period) ----
export const hash = (x: number, y: number, s: number) => {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
export function vnoise(x: number, y: number, seed: number, period = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const w = (v: number) => (period ? ((v % period) + period) % period : v);
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(w(xi), w(yi), seed), b = hash(w(xi + 1), w(yi), seed), c = hash(w(xi), w(yi + 1), seed), d = hash(w(xi + 1), w(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x: number, y: number, seed: number, oct = 4, period = 0): number {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let o = 0; o < oct; o++) { s += a * vnoise(x * f, y * f, seed + o * 17, period ? period * f : 0); n += a; a /= 2; f *= 2; }
  return s / n;
}

// ---- snake skin ----
const SKIN_DARK = hex("#0c3f2c"), SKIN_MID = hex("#1f8f58"), SKIN_LIGHT = hex("#70d890");
const BELLY = hex("#e6e8a0"), BLOTCH = hex("#082a22");

/** n: -1 (top/back) .. +1 (belly side), s: distance along the body in px, cell: px per native pixel. */
export function skin(n: number, s: number, cell: number): C {
  // top-down light: symmetric about the body axis so every rotation of a part matches
  const nz = Math.sqrt(Math.max(0, 1 - n * n));
  const diffuse = clamp(0.2 + 0.8 * nz);
  let base = mix(SKIN_DARK, SKIN_MID, smooth(0.15, 0.7, diffuse));
  base = mix(base, SKIN_LIGHT, smooth(0.8, 1.0, diffuse) * 0.7);
  // diamond scale lattice
  const P = cell * 1.5, u = s / P, v = (n * cell * 4) / P;
  const f = Math.abs((((u + v) % 1) + 1) % 1 - 0.5) + Math.abs((((u - v) % 1) + 1) % 1 - 0.5);
  base = mul(base, 0.88 + 0.16 * smooth(0.25, 0.7, f));
  // dorsal blotches
  const along = Math.cos((2 * Math.PI * s) / (cell * 4));
  base = mix(base, mul(BLOTCH, 0.7 + 0.5 * diffuse), smooth(0.15, 0.5, along) * smooth(0.6, 0.3, Math.abs(n)) * 0.75);
  // lighter belly-coloured flanks
  base = mix(base, mul(BELLY, 0.85 + 0.15 * diffuse), smooth(0.58, 0.68, Math.abs(n)) * 0.9);
  return mix(base, hex("#0a2a14"), smooth(0.84, 0.9, Math.abs(n)));
}

const rrSdf = (cx: number, cy: number, hx: number, hy: number, r: number) => (x: number, y: number) => {
  const qx = Math.abs(x - cx) - hx + r, qy = Math.abs(y - cy) - hy + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

export type SnakePart = "head" | "body" | "corner" | "tail";
/** Body half width in native pixels (the band is rows 3..12). */
export const BAND_HALF = 5;
/** Registration rectangles [x, y, w, h] in cells; kept clear of the part and erased after pixelizing. */
export const REGS: Record<SnakePart, [number, number, number, number][]> = {
  head: [[1, 1, 5, 1], [1, 14, 5, 1]],
  body: [[10, 1, 5, 1], [1, 14, 5, 1]],
  tail: [[10, 1, 5, 1], [1, 14, 5, 1]],
  corner: [[1, 1, 5, 1], [10, 1, 5, 1]],
};
/**
 * One snake tile source on a 16-cell grid (size = 16*cell). The band is rows 4..11 (centre 8, half width 4).
 * With `regs` the drawing is clipped to cells 1..14 and two registration blocks pin the sprite bbox to those
 * cells, so pixelizeSprite lands every cell exactly on a native pixel (edge columns are then copied by the maker).
 */
export function snakePart(part: SnakePart, cell: number, bg: C, regs: boolean): Canvas {
  const S = cell * 16, cv = new Canvas(S, S, bg);
  const lo = regs ? cell : -1e9, hi = regs ? 15 * cell : 1e9, cy = 8 * cell, hw = BAND_HALF * cell;
  const clip = (d: (x: number, y: number) => number) => (x: number, y: number) => Math.max(d(x, y), lo - x, x - hi, lo - y, y - hi);
  if (regs) for (const [x0, y0, w, h] of REGS[part]) cv.fill(() => [0.15, 0.15, 0.2], [x0 * cell, y0 * cell, (x0 + w) * cell, (y0 + h) * cell]);
  if (part === "body") cv.shape(clip((_x, y) => Math.abs(y - cy) - hw), (x, y) => skin((y - cy) / hw, x, cell));
  if (part === "tail") {
    const prof = (x: number) => Math.max(0.5, hw * Math.pow(clamp((x - 1.2 * cell) / (13.8 * cell)), 0.8));
    cv.shape(clip((x, y) => Math.abs(y - cy) - prof(x)), (x, y) => skin((y - cy) / prof(x), x, cell));
  }
  if (part === "corner") {
    // quarter ring centred on the bottom-left corner of the cell: joins the left edge and the bottom edge
    const rc = 8 * cell, ccy = 16 * cell;
    cv.shape(clip((x, y) => Math.abs(Math.hypot(x, y - ccy) - rc) - hw), (x, y) => skin((Math.hypot(x, y - ccy) - rc) / hw, Math.atan2(ccy - y, x) * rc, cell));
  }
  if (part === "head") {
    // top-down head: the neck band runs into a rounded oval, snout to the right
    const hx = 9.4 * cell, ha = 6.2 * cell, hb = 6.9 * cell;
    const oval = (x: number, y: number) => (Math.hypot((x - hx) / ha, (y - cy) / hb) - 1) * hb;
    const sdf = clip((x, y) => Math.min(Math.max(Math.abs(y - cy) - hw, x - hx), oval(x, y)));
    cv.shape(sdf, (x, y) => {
      const hh = Math.max(x < hx ? hw : 0, Math.abs(x - hx) < ha ? hb * Math.sqrt(1 - ((x - hx) / ha) ** 2) : 0);
      return mix(skin(clamp((y - cy) / Math.max(hh, cell), -1, 1), x, cell), hex("#70d890"), 0.15);
    });
    for (const sgn of [-1, 1]) {
      const ex = 10 * cell, ey = cy + sgn * 3.6 * cell;
      cv.shape((x, y) => Math.hypot(x - ex, y - ey) - 1.8 * cell, () => [0.98, 0.96, 0.75]);
      cv.shape((x, y) => Math.hypot(x - ex - 0.45 * cell, y - ey) - 1.1 * cell, () => [0.04, 0.03, 0.03]);
      cv.shape((x, y) => Math.hypot(x - 14 * cell, y - (cy + sgn * 1.2 * cell)) - 0.35 * cell, () => [0.05, 0.2, 0.1]);
    }
  }
  return cv;
}

// ---- fruit ----
export type Fruit = "apple" | "gold";
export function fruit(kind: Fruit, S: number, bg: C, sparkles = true): Canvas {
  const cv = new Canvas(S, S, bg), cx = S * 0.5, cy = S * 0.57, R = S * 0.33;
  const gold = kind === "gold";
  const body = (x: number, y: number) => {
    const dx = (x - cx) / (R * 1.06), dy = (y - cy) / R;
    const dent = 0.2 * Math.exp(-((dx * dx) / 0.05)) * smooth(-0.2, -0.95, dy);
    const taper = 1 - 0.12 * smooth(0.2, 1, dy);
    return (Math.hypot(dx / taper, dy + dent) - 1) * R;
  };
  const cols = gold
    ? { dark: hex("#a86a0c"), mid: hex("#f5cc22"), light: hex("#fff8b8"), rim: hex("#d8a010") }
    : { dark: hex("#6e0a14"), mid: hex("#d6232c"), light: hex("#ff7a62"), rim: hex("#a8121f") };
  const sx = cx + R * 0.06;
  cv.shape((x, y) => Math.max(Math.abs(x - (sx + (cy - R * 0.8 - y) * 0.15)) - R * 0.075, y - (cy - R * 0.6), cy - R * 1.28 - y), (x) => mix(hex("#4a2c12"), hex("#9a6a34"), smooth(sx - R * 0.07, sx + R * 0.07, x)));
  cv.shape(body, (x, y) => {
    const nx = (x - cx) / R, ny = (y - cy) / R, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    const L = clamp(0.35 + 0.75 * (nz * 0.55 - nx * 0.45 - ny * 0.55));
    let c = mix(cols.dark, cols.mid, smooth(0.15, 0.62, L));
    c = mix(c, cols.light, smooth(0.72, 1.0, L) * 0.7);
    if (!gold) c = mix(c, hex("#f0a030"), 0.18 * smooth(0.4, 1, ny) * (0.6 + 0.4 * fbm(x / 30, y / 30, 3, 3)));
    c = mul(c, 0.94 + 0.12 * fbm(x / 14, y / 14, 5, 3));
    c = mix(c, cols.rim, 0.5 * smooth(0.82, 1.05, Math.hypot(nx, ny)));
    const sp = Math.hypot((nx + 0.38) / 0.22, (ny + 0.42) / 0.14);
    return mix(c, [1, 1, 1], 0.95 * smooth(1, 0.35, sp));
  }, [cx - R * 1.3, cy - R * 1.3, cx + R * 1.3, cy + R * 1.3]);
  // leaf: a lens from the stem tip, angled up-right
  const lx = sx + R * 0.05, ly = cy - R * 1.0, ang = -0.5, ca = Math.cos(ang), sa = Math.sin(ang), LL = R * 0.75;
  const leaf = (x: number, y: number) => {
    const u = (x - lx) * ca + (y - ly) * sa, v = -(x - lx) * sa + (y - ly) * ca;
    const w = R * 0.2 * Math.sin(Math.PI * clamp(u / LL));
    return Math.max(Math.abs(v) - w, -u, u - LL);
  };
  cv.shape(leaf, (x, y) => mix(hex("#1f6a22"), hex("#5fb83a"), smooth(-R * 0.3, R * 0.3, -(y - ly) + (x - lx) * 0.2)), [lx - R, ly - R, lx + R, ly + R]);
  if (gold && sparkles) {
    const star = (sx0: number, sy0: number, r: number) =>
      cv.shape((x, y) => (Math.pow(Math.abs(x - sx0) / r, 0.55) + Math.pow(Math.abs(y - sy0) / r, 0.55) - 1) * r * 0.5, () => [1, 1, 0.92], [sx0 - r, sy0 - r, sx0 + r, sy0 + r]);
    star(cx + R * 0.78, cy - R * 0.55, R * 0.62);
    star(cx - R * 0.8, cy + R * 0.4, R * 0.36);
  }
  return cv;
}

// ---- textures (periodic, S px square) ----
export function grassTex(S: number, seed: number, blades: number): Canvas {
  const cv = new Canvas(S, S, [0.3, 0.65, 0.25]), per = 4;
  cv.fill((x, y) => {
    const n = fbm((x / S) * per, (y / S) * per, seed, 3, per);
    const m = fbm((x / S) * 16, (y / S) * 16, seed + 9, 2, 16);
    return mix(hex("#4aa83a"), hex("#68c446"), clamp(0.5 + (n - 0.5) * 1.4 + (m - 0.5) * 0.4));
  });
  const r = rng(seed * 101 + 7);
  for (let i = 0; i < blades; i++) {
    const bx = r() * S, by = r() * S, len = S * (0.1 + 0.1 * r()), ang = -Math.PI / 2 + (r() - 0.5) * 0.9, lean = (r() - 0.5) * 0.9, tone = r();
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      const px = bx + ox, py = by + oy;
      if (px < -len || px > S + len || py < -len || py > S + len) continue;
      for (let k = 0; k <= 24; k++) {
        const t = k / 24, qx = px + Math.cos(ang) * len * t + lean * len * t * t, qy = py + Math.sin(ang) * len * t, w = (S / 90) * (1 - t) + 0.3;
        const col = mix(hex("#2f8a34"), tone > 0.5 ? hex("#8ae05a") : hex("#74cc4c"), t);
        cv.shape((x, y) => Math.hypot(x - qx, y - qy) - w, () => col, [qx - w - 2, qy - w - 2, qx + w + 2, qy + w + 2]);
      }
    }
  }
  return cv;
}

/** Staggered stone wall; period 16 native px (cell px each). */
export function wallTex(cell: number): Canvas {
  const S = cell * 16, cv = new Canvas(S, S, hex("#4a443c"));
  for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
    const id = row * 2 + col, off = row % 2 ? 4 : 0;
    const x0 = (col * 8 + off) * cell, y0 = row * 8 * cell + 0.5 * cell, w = 7.5 * cell, h = 7 * cell;
    const tone = 0.9 + 0.2 * hash(id, 3, 5);
    for (const ox of [-S, 0, S]) {
      const cx = x0 + w / 2 + ox, cyy = y0 + h / 2;
      cv.shape(rrSdf(cx, cyy, w / 2, h / 2, cell * 1.4), (x, y, d) => {
        const nx = (x - cx) / (w / 2), ny = (y - cyy) / (h / 2);
        const bevel = smooth(-cell * 1.6, 0, d);
        const light = 1 - 0.35 * (nx + ny) * 0.5 * bevel;
        const g = fbm(x / (cell * 1.5) + id * 7, y / (cell * 1.5), 21 + id, 3);
        const base = mix(hex("#9a9284"), hex("#c4bba8"), g);
        return mul(mix(base, hex("#6e675c"), 1 - bevel * 0.9), light * tone);
      }, [cx - w, cyy - h, cx + w, cyy + h]);
    }
  }
  return cv;
}

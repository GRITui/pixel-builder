// Effect loops on top of a pixelized still (#107). Every frame uses only entries of the still's palette:
// effects move a pixel one lightness step along the palette, or paint a particle with the nearest
// palette entry to a translucent tint. Every animated quantity is a function of t with period N
// (particles live exactly N frames, bands travel whole periods, pulses run whole cycles), so frame N
// is frame 0 and the loop is seamless.
import { rng } from "../pipeline";
import type { Effect, PixelResult, Rgba } from "../types";
import { EFFECTS } from "../types";
import { validate } from "../validate";
import { brightDistance, emitterMask, groundSites, waterMask, type Region } from "./masks";
import { step, tintEntry, toIndexed, toRgba, type IndexedImage } from "./palette";

export interface AnimateOptions {
  /** Frames in the loop (2..64). Default 12. */
  frames?: number;
  seed?: number;
  /** Particle density multiplier, 0.1..3. Default 1. */
  density?: number;
  /** Horizontal drift of rain per pixel fallen (negative = leftwards). Default 0.5. */
  wind?: number;
  /** Restrict shimmer to this native-pixel rectangle instead of detecting water. */
  shimmerRegion?: Region;
}

export interface Animation {
  frames: Rgba[];
  /** #rrggbb entries; every opaque pixel of every frame is one of these. */
  palette: string[];
  effects: Effect[];
  /** Pixels each effect touches (masks / particle counts), for reporting. */
  stats: Record<string, number>;
}

const TAU = Math.PI * 2;
const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Stateless hash of integers to [0,1). */
function hash(a: number, b = 0, c = 0): number {
  let x = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

interface Drop { x0: number; y0: number; v: number; phase: number; len: number }
interface Flake { x0: number; y0: number; v: number; phase: number; amp: number; wob: number; big: boolean }
interface Splash { i: number; phase: number }

export interface Prepared {
  img: IndexedImage;
  n: number;
  seed: number;
  effects: Effect[];
  wind: number;
  drops: Drop[];
  splashes: Splash[];
  flakes: Flake[];
  water?: Uint8Array;
  rowOffset: Float64Array;
  bandPeriod: number;
  emit?: Uint8Array;
  halo?: Uint8Array;
  bloom?: Uint8Array;
  bloomR: number;
}

const RAIN: [number, number, number] = [205, 218, 236];
const SNOW: [number, number, number] = [248, 250, 255];

export function prepare(result: PixelResult, effects: Effect[], opts: AnimateOptions = {}): Prepared {
  for (const e of effects) if (!EFFECTS.includes(e)) throw new Error(`Unknown effect '${e}'. Effects: ${EFFECTS.join(", ")}`);
  const n = Math.round(opts.frames ?? 12);
  if (!(n >= 2 && n <= 64)) throw new Error(`frames must be 2..64, got ${opts.frames}`);
  const img = toIndexed(result);
  if (!img.palette.length) throw new Error("The still has no opaque pixels to animate");
  const { w, h } = img;
  const seed = opts.seed ?? 1;
  const density = Math.min(3, Math.max(0.1, opts.density ?? 1));
  const rand = rng(seed * 7919 + 17);
  const area = w * h;
  const p: Prepared = {
    img, n, seed, effects: [...new Set(effects)], wind: opts.wind ?? 0.5,
    drops: [], splashes: [], flakes: [], rowOffset: new Float64Array(h), bandPeriod: 0, bloomR: 0,
  };
  if (effects.includes("rain")) {
    const count = Math.round(area * 0.004 * density);
    for (let k = 0; k < count; k++) {
      const v = 3 + Math.floor(rand() * 4);
      const travel = v * n;
      // Spawn far enough up/upwind that drops cover the frame uniformly at every phase.
      p.drops.push({ x0: rand() * (w + Math.abs(p.wind) * travel) - (p.wind < 0 ? 0 : p.wind * travel), y0: rand() * (h + travel) - travel, v, phase: Math.floor(rand() * n), len: 2 + Math.floor(rand() * 3) });
    }
    const sites = groundSites(img);
    const sc = Math.min(sites.length, Math.round(count * 0.35));
    for (let k = 0; k < sc; k++) p.splashes.push({ i: sites[Math.floor(rand() * sites.length)], phase: Math.floor(rand() * n) });
  }
  if (effects.includes("snow")) {
    const count = Math.round(area * 0.003 * density);
    for (let k = 0; k < count; k++) {
      const v = 0.5 + rand() * 0.9;
      p.flakes.push({ x0: rand() * w, y0: rand() * (h + v * n) - v * n, v, phase: Math.floor(rand() * n), amp: 0.6 + rand() * 1.2, wob: rand() * TAU, big: rand() < 0.12 });
    }
  }
  if (effects.includes("shimmer")) {
    p.water = waterMask(img, opts.shimmerRegion);
    p.bandPeriod = Math.max(6, Math.min(16, Math.round(w / 24)));
    // Rows come in pairs so highlights read as short dashes, not noise.
    for (let y = 0; y < h; y++) p.rowOffset[y] = hash(y >> 1, seed, 11) * p.bandPeriod;
  }
  if (effects.includes("flicker")) {
    p.emit = emitterMask(img);
    p.halo = new Uint8Array(area);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (p.emit[y * w + x]) continue;
      for (let dy = -1; dy <= 1 && !p.halo[y * w + x]; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && p.emit[yy * w + xx]) { p.halo[y * w + x] = 1; break; }
      }
    }
  }
  if (effects.includes("bloom_pulse")) {
    p.bloomR = Math.max(2, Math.min(4, Math.round(w / 140)));
    p.bloom = brightDistance(img, p.bloomR);
  }
  return p;
}

/** Flicker step (-1, 0, +1) for the 4x4 emitter cell around (x, y) at frame t. */
function flickerStep(p: Prepared, x: number, y: number, t: number): number {
  const cx = x >> 2, cy = y >> 2;
  const phase = hash(cx, cy, p.seed), cycles = 1 + Math.floor(hash(cy, cx, p.seed + 1) * 2);
  const jitter = hash(cx * 31 + cy, mod(t, p.n), p.seed + 2) - 0.5;
  const v = Math.sin(TAU * ((cycles * t) / p.n + phase)) + jitter * 0.9;
  return v > 0.55 ? 1 : v < -0.6 ? -1 : 0;
}

/** Palette-index buffer for frame t (any integer; period N). */
export function renderFrame(p: Prepared, t: number): Int16Array {
  const { img, n } = p;
  const { w, h } = img;
  const base = img.idx;
  const out = Int16Array.from(base);
  if (p.water) {
    const P = p.bandPeriod, m = Math.max(1, Math.round(n / P));
    for (let i = 0; i < w * h; i++) {
      if (!p.water[i] || base[i] < 0) continue;
      const x = i % w, y = (i - x) / w;
      const band = mod((x + p.rowOffset[y]) / P - (m * t) / n, 1);
      if (band < 0.2) out[i] = step(img, out[i], 1);
      else if (band >= 0.55 && band < 0.65) out[i] = step(img, out[i], -1);
    }
  }
  if (p.bloom) {
    const s = Math.sin((TAU * t) / n);
    for (let i = 0; i < w * h; i++) {
      const d = p.bloom[i];
      if (base[i] < 0 || d > p.bloomR) continue;
      if (s > 0 && d >= 1 && d <= s * (p.bloomR + 0.5)) out[i] = step(img, out[i], 1);
      else if (s < -0.6 && d === 0) out[i] = step(img, out[i], -1);
    }
  }
  if (p.emit && p.halo) {
    for (let i = 0; i < w * h; i++) {
      if (base[i] < 0 || !(p.emit[i] || p.halo[i])) continue;
      const x = i % w, st = flickerStep(p, x, (i - x) / w, t);
      if (p.emit[i] && st) out[i] = step(img, out[i], st);
      else if (p.halo[i] && st > 0) out[i] = step(img, out[i], 1);
    }
  }
  const paint = (x: number, y: number, tint: [number, number, number], amount: number) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (base[i] < 0) return;
    out[i] = tintEntry(img, base[i], tint, amount);
  };
  for (const s of p.splashes) {
    const local = mod(t + s.phase, n), x = s.i % w, y = (s.i - x) / w;
    if (local === 0) paint(x, y, RAIN, 0.7);
    else if (local === 1) { paint(x - 1, y - 1, RAIN, 0.5); paint(x + 1, y - 1, RAIN, 0.5); }
  }
  for (const d of p.drops) {
    const s = mod(t + d.phase, n), y = d.y0 + d.v * s, x = d.x0 + p.wind * d.v * s;
    // Head is brightest; the tail trails up-wind one pixel per row.
    for (let k = 0; k < d.len; k++) paint(x - p.wind * k, y - k, RAIN, k === 0 ? 0.75 : 0.5);
  }
  for (const f of p.flakes) {
    const s = mod(t + f.phase, n), y = f.y0 + f.v * s, x = f.x0 + f.amp * Math.sin((TAU * s) / n + f.wob);
    paint(x, y, SNOW, 0.85);
    if (f.big) { paint(x + 1, y, SNOW, 0.85); paint(x, y + 1, SNOW, 0.7); paint(x + 1, y + 1, SNOW, 0.7); }
  }
  return out;
}

/** Problems with a set of frames: partial alpha, size mismatch, colours outside `palette`. */
export function checkFrames(frames: Rgba[], palette: string[]): string[] {
  const allowed = new Set(palette.map((c) => parseInt(c.slice(1), 16)));
  const issues: string[] = [];
  frames.forEach((f, k) => {
    if (f.w !== frames[0].w || f.h !== frames[0].h) issues.push(`frame ${k} is ${f.w}x${f.h}, expected ${frames[0].w}x${frames[0].h}`);
    for (const msg of validate(f).issues) issues.push(`frame ${k}: ${msg}`);
    let off = 0;
    for (let i = 0; i < f.w * f.h; i++) {
      if (f.data[i * 4 + 3] !== 255) continue;
      if (!allowed.has((f.data[i * 4] << 16) | (f.data[i * 4 + 1] << 8) | f.data[i * 4 + 2])) off++;
    }
    if (off) issues.push(`frame ${k}: ${off} pixels use colours outside the palette`);
  });
  return issues;
}

/** Animate a pixelized still with looping effects. Throws if a frame would break the palette rules. */
export function animate(result: PixelResult, effects: Effect[], opts: AnimateOptions = {}): Animation {
  const p = prepare(result, effects, opts);
  const frames = Array.from({ length: p.n }, (_, t) => toRgba(p.img, renderFrame(p, t)));
  const issues = checkFrames(frames, p.img.palette);
  if (issues.length) throw new Error(`Effect frames failed validation: ${issues.slice(0, 3).join("; ")}`);
  const count = (m?: Uint8Array) => (m ? m.reduce((a, b) => a + b, 0) : 0);
  const stats: Record<string, number> = {};
  if (effects.includes("rain")) { stats.rain_drops = p.drops.length; stats.rain_splashes = p.splashes.length; }
  if (effects.includes("snow")) stats.snow_flakes = p.flakes.length;
  if (p.water) stats.shimmer_pixels = count(p.water);
  if (p.emit) stats.flicker_pixels = count(p.emit);
  if (p.bloom) stats.bloom_core_pixels = p.bloom.reduce((a, d) => a + (d === 0 ? 1 : 0), 0);
  return { frames, palette: p.img.palette, effects: p.effects, stats };
}

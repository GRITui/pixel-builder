// Light-buffer renderer (fx: "rich"): night is CALCULATED from sources instead of index-swapped.
// The image is decoded to linear RGB, multiplied by a time-of-day ambient (every object keeps its hue, only
// cooler and darker), each light adds its own colour with a banded smooth falloff, emitters are
// self-illuminated, bloom is blurred around them, wet ground gets vertical streak reflections, and the result
// is quantised back to the kit palette (+ fx ramps) by nearest OKLab. Output is palette indices only.
import { decodeIndex, flattenPaletteFx, hexToRgb, rgbToOklab, type Material } from "./palette";
import { resolveRamps } from "./kit";
import { cloneSprite } from "./sprite";
import type { Light, LightKind, LitObject, TimeOfDay } from "./lighting";
import type { WetField } from "./wet";
import type { Sprite, StyleKit } from "./types";

type V3 = [number, number, number];

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const enc = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const hexLin = (hex: string): V3 => { const [r, g, b] = hexToRgb(hex); return [lin(r / 255), lin(g / 255), lin(b / 255)]; };
const srgbLin = (r: number, g: number, b: number): V3 => [lin(r), lin(g), lin(b)];

interface KindSpec { color: V3; reach: number; gain: number; ground: boolean; emit: number }
/** Colour (linear), glow radius as a multiple of `r`, intensity, whether it pools on the ground, self-illum radius. */
const KINDS: Record<LightKind, KindSpec> = {
  point: { color: srgbLin(1, 0.85, 0.6), reach: 2, gain: 2.6, ground: false, emit: 0 },
  lamp: { color: srgbLin(0.8, 0.88, 1), reach: 1.7, gain: 1.15, ground: true, emit: 2.6 },
  window: { color: srgbLin(1, 0.76, 0.4), reach: 1, gain: 1.5, ground: false, emit: 0 },
  lantern: { color: srgbLin(1, 0.33, 0.18), reach: 2, gain: 2, ground: true, emit: 2.4 },
  vending: { color: srgbLin(0.6, 0.9, 1), reach: 2.3, gain: 2.6, ground: true, emit: 0 },
  fire: { color: srgbLin(1, 0.5, 0.14), reach: 2, gain: 2.2, ground: true, emit: 3 },
  magic: { color: srgbLin(0.3, 0.95, 0.9), reach: 2.2, gain: 2.8, ground: true, emit: 2.4 },
  moon: { color: srgbLin(0.5, 0.62, 1), reach: 1, gain: 0.5, ground: false, emit: 0 },
  sign: { color: srgbLin(1, 0.3, 0.75), reach: 1.8, gain: 2.4, ground: true, emit: 2.4 },
};

interface Ambient { mul: V3; floor: V3; desat: number; lights: number }
const AMBIENT: Partial<Record<TimeOfDay, Ambient>> = {
  night: { mul: [0.08, 0.11, 0.24], floor: [0.002, 0.004, 0.012], desat: 0.08, lights: 1 },
  dusk: { mul: [0.46, 0.34, 0.52], floor: [0.004, 0.003, 0.008], desat: 0.1, lights: 0.55 },
  dawn: { mul: [0.55, 0.5, 0.66], floor: [0.006, 0.005, 0.01], desat: 0.1, lights: 0.3 },
};

const NAME_KINDS: [RegExp, LightKind][] = [
  [/vending|machine|konbini/, "vending"],
  [/lantern/, "lantern"],
  [/torch|campfire|fire|brazier|forge/, "fire"],
  [/lamp|streetlight|street-light/, "lamp"],
  [/window/, "window"],
  [/crystal|magic|rune/, "magic"],
];
const kindOfName = (n: string): LightKind | null => NAME_KINDS.find(([re]) => re.test(n))?.[1] ?? null;

/** A light with its resolved kind and ground line (where its pool and wet reflections sit). */
export interface RichLight extends Light { kind: LightKind; base: number }

/**
 * Every emitter in a scene: explicit `object.lights` (kind from the light, else the object's name, else window),
 * name-rule emitters (lamp, lantern, fire, vending machine, crystal, window) and `extra` lights in image pixels.
 */
export function richLights(objects: LitObject[], extra: Light[] = []): RichLight[] {
  const out: RichLight[] = [];
  for (const o of objects) {
    const base = o.y + o.sprite.h - 1, nk = kindOfName(o.name);
    if (o.lights) {
      for (const l of o.lights) out.push({ ...l, x: o.x + l.x, y: o.y + l.y, kind: l.kind ?? nk ?? "window", base });
      continue;
    }
    if (!nk) continue;
    // a post lamp's head is at the top, not mid-sprite
    const top = nk === "lamp" ? 0.18 : nk === "lantern" ? 0.35 : 0.5;
    out.push({ x: o.x + o.sprite.w / 2, y: o.y + o.sprite.h * top, r: Math.max(nk === "vending" ? 8 : 12, o.sprite.w * (nk === "lamp" ? 1.4 : 1.6)), kind: nk, base });
  }
  for (const l of extra) out.push({ ...l, kind: l.kind ?? "point", base: l.base ?? Math.round(l.y) + 6 });
  return out;
}

const GROUND = new Set<Material>(["grass", "dirt", "sand", "stone", "wood"]);
const hash = (x: number, y: number, s: number): number => {
  let h = Math.imul(x + 0x3f1d, 0x85ebca6b) ^ Math.imul(y + 0x61c3, 0xc2b2ae35) ^ Math.imul(s + 7, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
};

/** A light's own colour: [r,g,b] 0-255 or "#rrggbb". */
function lightRgb(c: [number, number, number] | string): V3 {
  const [r, g, b] = typeof c === "string" ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : c;
  return srgbLin(r / 255, g / 255, b / 255);
}

/** Colour of a vending machine: the most saturated lit pixels around its light point. */
function sampledColor(img: Sprite, pal: V3[], l: Light): V3 {
  let best: V3 | null = null, bs = 0;
  const R = Math.max(3, Math.round((l.r ?? 8) * 0.5));
  for (let y = Math.round(l.y) - R; y <= Math.round(l.y) + R; y++)
    for (let x = Math.round(l.x) - R; x <= Math.round(l.x) + R; x++) {
      if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
      const c = pal[img.data[y * img.w + x]];
      if (!c) continue;
      const mx = Math.max(...c), mn = Math.min(...c), s = (mx - mn) * (0.3 + mx);
      if (s > bs) { bs = s; best = c; }
    }
  if (!best) return KINDS.vending.color;
  const m = Math.max(...best) || 1;
  return [best[0] / m, best[1] / m, best[2] / m];
}

/** Weight of chroma vs lightness when matching colours: dark hues must not collapse to grey. */
const CHROMA = 2.4;
const band = (f: number, steps: number) => Math.round(f * steps) / steps;

/** Smooth falloff with a soft knee: 1 at the source, 0 at u = 1. */
const falloff = (u: number) => (u >= 1 ? 0 : ((1 - u * u) * (1 - u * u)) / (1 + 2.5 * u * u));

function blur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length);
  const n = 2 * r + 1;
  // horizontal then vertical box blur, twice (approximates a gaussian)
  let a = src;
  for (let it = 0; it < 2; it++) {
    for (let y = 0; y < h; y++)
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let x = -r; x <= r; x++) acc += a[(y * w + Math.max(0, Math.min(w - 1, x))) * 3 + c];
        for (let x = 0; x < w; x++) {
          tmp[(y * w + x) * 3 + c] = acc / n;
          acc += a[(y * w + Math.min(w - 1, x + r + 1)) * 3 + c] - a[(y * w + Math.max(0, x - r)) * 3 + c];
        }
      }
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let y = -r; y <= r; y++) acc += tmp[(Math.max(0, Math.min(h - 1, y)) * w + x) * 3 + c];
        for (let y = 0; y < h; y++) {
          out[(y * w + x) * 3 + c] = acc / n;
          acc += tmp[(Math.min(h - 1, y + r + 1) * w + x) * 3 + c] - tmp[(Math.max(0, y - r) * w + x) * 3 + c];
        }
      }
    a = out;
  }
  return out;
}

export interface LightSceneOptions {
  time: TimeOfDay;
  /** extra emitters in image pixels (carried lanterns, a campfire not on the map) */
  lights?: Light[];
  seed?: number;
  /** wet ground from `wetField`: adds streak reflections of every light */
  field?: WetField | null;
}

/** The kit's palette incl. fx ramps as linear RGB + OKLab, shared by decode and quantise. */
function paletteTables(kit: StyleKit) {
  const flat = flattenPaletteFx(resolveRamps(kit));
  const rgb: V3[] = [], lab: V3[] = [], ids: number[] = [];
  flat.forEach((hex, i) => {
    if (!hex || i === 0) { rgb.push([0, 0, 0]); lab.push([0, 0, 0]); return; }
    rgb.push(hexLin(hex));
    lab.push(rgbToOklab(hexToRgb(hex)));
    ids.push(i);
  });
  return { rgb, lab, ids };
}

/**
 * Render a lit scene: `img` is the finished, un-graded map image; `objects` supply the emitters.
 * Returns a new sprite of palette indices (transparent stays transparent).
 */
export function lightScene(img: Sprite, objects: LitObject[], kit: StyleKit, opts: LightSceneOptions): Sprite {
  const base = AMBIENT[opts.time];
  if (!base) return img;
  // a handheld palette has no room for dark navy: lift the ambient so shapes survive
  const handheld = new Set(Object.values(resolveRamps(kit)).flat()).size <= 6;
  const amb: Ambient = handheld ? { ...base, mul: base.mul.map((v) => Math.min(1, v * 3.2)) as V3 } : base;
  const { w, h } = img, seed = opts.seed ?? 0, tile = Math.max(8, kit.sizes.tile);
  const { rgb: pal, lab: palLab, ids } = paletteTables(kit);
  const lights = richLights(objects, opts.lights);
  const N = w * h;

  const alb = new Float32Array(N * 3), buf = new Float32Array(N * 3);
  const ground = new Uint8Array(N), lvl = new Uint8Array(N), ink = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const idx = img.data[i];
    if (!idx) continue;
    const c = pal[idx];
    const d = decodeIndex(idx);
    if (d) { ground[i] = GROUND.has(d.mat) ? 1 : 0; lvl[i] = d.level; ink[i] = d.mat === "ink" ? 1 : 0; }
    else lvl[i] = 3;
    const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    // greens sink to deep blue-green so the lights carry the scene
    const green = d && (d.mat === "grass" || d.mat === "foliage") && opts.time === "night";
    const dim = green ? 0.85 : 1, ds = green ? amb.desat + 0.12 : amb.desat;
    for (let k = 0; k < 3; k++) {
      // mild desaturation so very saturated materials do not scream at night, hue identity survives
      const a = c[k] + (y - c[k]) * ds;
      alb[i * 3 + k] = c[k] + (y - c[k]) * 0.25;
      buf[i * 3 + k] = a * amb.mul[k] * dim + amb.floor[k];
    }
  }

  const emis = new Float32Array(N * 3), emitted = new Uint8Array(N), lit = new Float32Array(N);
  const STEPS = 6;
  for (const l of lights) {
    const spec = KINDS[l.kind];
    const color = l.color ? lightRgb(l.color) : l.kind === "vending" ? sampledColor(img, pal, l) : spec.color;
    const R = Math.max(6, (l.r ?? 12) * spec.reach), gain = spec.gain * (l.intensity ?? 1) * amb.lights;
    const gy = spec.ground ? l.base - 1 : l.y;
    const hw = l.w ? l.w / 2 : Math.max(1, (l.r ?? 8) * 0.35), hh = l.h ? l.h / 2 : Math.max(1, (l.r ?? 8) * 0.28);
    const area = l.kind === "window";
    const x0 = Math.max(0, Math.floor(l.x - R - hw)), x1 = Math.min(w - 1, Math.ceil(l.x + R + hw));
    const y0 = Math.max(0, Math.floor(Math.min(l.y, gy) - R)), y1 = Math.min(h - 1, Math.ceil(Math.max(l.y, gy) + R));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x;
        if (!img.data[i]) continue;
        let d: number;
        const onGround = ground[i] === 1 && y >= l.y + 2;
        // pools are flattened ellipses centred between the lamp head and its foot; one shape for ground and walls
        let Re = R;
        if (spec.ground) d = Math.hypot(x - l.x, (y - (l.y + gy) / 2) * 1.5);
        else if (area && onGround) { d = Math.hypot(x - l.x, (y - (l.base + 2)) * 2.2); Re = Math.max(10, (l.r ?? 8) * 2.4); }
        else if (area) d = Math.hypot(Math.max(0, Math.abs(x - l.x) - hw), Math.max(0, Math.abs(y - l.y) - hh) * (y > l.y ? 1.3 : 2.2));
        else d = Math.hypot(x - l.x, (y - l.y) * 1.2);
        // the outer band is cut so the pool fades into the ambient instead of ending in a ring
        const f = band(Math.max(0, Math.pow(falloff(d / Re), 1.25) - 0.14) / 0.86, STEPS);
        if (f <= 0) continue;
        // cheap normal: surfaces that are lighter on their ramp face up; light from above favours them
        const up = lvl[i] / 4, above = y > l.y;
        const facing = onGround ? 1 : above ? 0.62 + 0.38 * up : 0.62 + 0.38 * (1 - up);
        const k = f * facing * gain * (ink[i] ? 0.5 : 1);
        for (let c = 0; c < 3; c++) buf[i * 3 + c] += (alb[i * 3 + c] * 0.8 + 0.03) * color[c] * k;
        lit[i] += f;
      }
    // self-illumination: the lamp head / lantern / pane glows in its own colour
    const er = spec.emit ? Math.max(1.5, Math.min(4, (l.r ?? 8) * 0.22 * (spec.emit / 2.4))) : 0;
    const ex0 = Math.floor(l.x - (area ? hw : er)), ex1 = Math.ceil(l.x + (area ? hw : er));
    const ey0 = Math.floor(l.y - (area ? hh : er)), ey1 = Math.ceil(l.y + (area ? hh : er));
    if (area || er > 0)
      for (let y = Math.max(0, ey0); y <= Math.min(h - 1, ey1); y++)
        for (let x = Math.max(0, ex0); x <= Math.min(w - 1, ex1); x++) {
          const i = y * w + x;
          if (!img.data[i] || ink[i]) continue;
          if (!area && Math.hypot(x - l.x, y - l.y) > er) continue;
          if (area && lvl[i] < 2 && !(alb[i * 3 + 0] > 0.3)) continue;
          // brightest in the middle, tinted toward white
          const core = 1 - Math.min(1, Math.hypot((x - l.x) / (area ? hw + 1 : er + 1), (y - l.y) / (area ? hh + 1 : er + 1))) * 0.5;
          for (let c = 0; c < 3; c++) {
            const v = Math.min(1.4, color[c] * (0.8 + 0.5 * core) + 0.15 * core);
            buf[i * 3 + c] = v;
            emis[i * 3 + c] = v;
          }
          emitted[i] = 1;
          lit[i] += 1;
        }
  }

  // wet ground: long vertical streaks of every light, strongest in puddles
  const f = opts.field;
  if (f) {
    const streakLen = Math.round(tile * 4);
    for (const l of lights) {
      const spec = KINDS[l.kind];
      if (l.kind === "moon" || !spec.ground) continue; // wall windows do not reflect onto the road
      const color = l.color ? lightRgb(l.color) : l.kind === "vending" ? sampledColor(img, pal, l) : spec.color;
      const gain = (l.intensity ?? 1) * amb.lights;
      const drop = Math.min(10, Math.max(0, l.base - l.y) * 0.3);
      const y0 = Math.round(l.base + 1 + drop), ph = hash(Math.round(l.x), Math.round(l.y), seed) * 6.28;
      const ripple = Math.round(ph * 3);
      for (let t = 0; t < streakLen * 1.4; t++) {
        const y = y0 + t;
        if (y >= h) break;
        const fade = band(Math.exp(-t / (streakLen * 0.5)), 5);
        // +-1 px jitter that changes every few rows, never a wave
        const jit = Math.round(hash(Math.floor((t + ripple) / 4), Math.round(l.x), seed + 3) * 2 - 1);
        const cx = Math.round(l.x) + jit;
        const width = t < streakLen * 0.35 && (l.r ?? 8) >= 10 ? 2 : 1;
        for (let x = cx; x < cx + width; x++) {
          if (x < 0 || x >= w) continue;
          const i = y * w + x;
          if (!f.wet[i]) continue;
          const inP = f.puddle[i] > 0;
          if (!inP && t > streakLen) continue;
          // dashes of 1-3 px with a 1 px gap
          const seg = Math.floor((t + ripple) / 4), dash = 1 + Math.floor(hash(seg, Math.round(l.x), seed + 5) * 3);
          if ((t + ripple) % 4 >= dash + (inP ? 0 : 0)) continue;
          const sv = fade * gain * (inP ? 1.4 : 0.9);
          if (sv < 0.12) continue;
          for (let c = 0; c < 3; c++) buf[i * 3 + c] += color[c] * sv * 1.3;
          lit[i] += 0.5;
        }
      }
    }
  }

  // bloom: blur the emitters, add back softly
  if (emitted.some((v) => v)) {
    const r = Math.max(2, Math.min(6, Math.round(tile / 6)));
    const bl = blur(emis, w, h, r);
    for (let i = 0; i < N; i++) if (img.data[i]) for (let c = 0; c < 3; c++) buf[i * 3 + c] += bl[i * 3 + c] * 0.9;
  }

  // quantise: soft-clip, nearest kit colour in OKLab (cached)
  const out = cloneSprite(img);
  const cache = new Map<number, number>();
  for (let i = 0; i < N; i++) {
    if (!img.data[i]) continue;
    let key = 0;
    const q: number[] = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const v = buf[i * 3 + c], tm = v / (1 + 0.18 * v);
      const e = Math.max(0, Math.min(255, Math.round(enc(Math.max(0, Math.min(1, tm))) * 255)));
      q[c] = e;
      key = key * 64 + (e >> 2);
    }
    let best = cache.get(key);
    if (best === undefined) {
      const lab = rgbToOklab([(q[0] >> 2 << 2) + 2, (q[1] >> 2 << 2) + 2, (q[2] >> 2 << 2) + 2]);
      let bd = Infinity;
      best = ids[0];
      for (const id of ids) {
        const p = palLab[id], d = (p[0] - lab[0]) ** 2 + ((p[1] - lab[1]) ** 2 + (p[2] - lab[2]) ** 2) * CHROMA;
        if (d < bd) { bd = d; best = id; }
      }
      cache.set(key, best);
    }
    out.data[i] = best;
  }

  // cleanup: lone pixels inside lit regions take the majority of their neighbours
  const src = out.data.slice();
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (lit[i] <= 0 || emitted[i] || !src[i]) continue;
      let same = 0, top = 0, topN = 0;
      const seen: Record<number, number> = {};
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const v = src[i + dy * w + dx];
          if (v === src[i]) same++;
          const n = (seen[v] = (seen[v] ?? 0) + 1);
          if (n > topN) { topN = n; top = v; }
        }
      if (same === 0 && topN >= 4 && top) out.data[i] = top;
    }
  return out;
}

// Lighting & atmosphere: a palette-locked post pass over a rendered map image.
// It only ever re-picks palette indices (shifting ramp levels, or swapping to a neighbouring
// material at the same level), so the output is still 100% kit colours.
import { colorIndexFine, decodeIndex, normalizeDepth, type Material, type RampDepth } from "./palette";
import { cloneSprite } from "./sprite";
import type { LightDir, Sprite, StyleKit, TileMap } from "./types";

export const TIMES = ["day", "dawn", "dusk", "night"] as const;
export type TimeOfDay = (typeof TIMES)[number];

/** An object standing on the map: its sprite's top-left in image pixels and its name. */
export interface LitObject {
  sprite: Sprite;
  x: number;
  y: number;
  name: string;
  /** Emitters inside the sprite (sprite px, e.g. a building's lit windows from `meta.lights`); used instead of the name rule. */
  lights?: Light[];
}

export interface Light {
  x: number;
  y: number;
  r: number;
}

export interface LightingOptions {
  time?: TimeOfDay;
  shadows?: boolean;
  dapple?: boolean;
  reflections?: boolean;
  seed?: number;
  /** extra light sources in image pixels (lanterns carried by characters, a campfire not in the map) */
  lights?: Light[];
}

const BASE_POS: Record<RampDepth, number[]> = { 5: [0, 1, 2, 3, 4], 7: [0, 1, 3, 5, 6], 9: [0, 2, 4, 6, 8] };
const GROUND = new Set<Material>(["grass", "dirt", "sand", "stone", "wood"]);
const NO_CAST = /flower|tuft|tall-grass|lily|reed|pebble|petal|crack/;
// scenery only: characters keep their own hues
const TINTED = new Set<Material>(["grass", "foliage", "stone", "cloth2", "accent"]);
const EMITTER = /lantern|torch|campfire|fire|lamp|window|crystal/;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const hash = (x: number, y: number, s: number): number => {
  let h = Math.imul(x + 0x9e37, 0x85ebca6b) ^ Math.imul(y + 0x7f4a, 0xc2b2ae35) ^ Math.imul(s + 1, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
};

/** Position of an index on its material's ramp in the kit's own step grid. */
function posOf(idx: number, depth: RampDepth): { mat: Material; pos: number } | null {
  const d = decodeIndex(idx);
  if (!d) return null;
  const base = BASE_POS[depth];
  return { mat: d.mat, pos: d.fine !== undefined ? base[d.fine] + 1 : base[d.level] };
}

/** Move an index `levels` classic levels along its ramp (negative = darker). Fractions snap to the kit's shades. */
export function shiftIndex(idx: number, levels: number, depth: RampDepth = 5, mat?: Material): number {
  const p = posOf(idx, depth);
  if (!p) return idx;
  const top = depth - 1;
  const pos = Math.max(0, Math.min(top, p.pos + Math.round((levels * top) / 4)));
  if (pos === p.pos && !mat) return idx;
  return colorIndexFine(mat ?? p.mat, pos / top, depth);
}

/** Light travels along lightDir, so shadows fall the other way: ground-plane step per pixel of height. */
function shadowVec(dir: LightDir): [number, number] {
  return dir === "top-left" ? [0.7, 0.38] : dir === "top-right" ? [-0.7, 0.38] : [0, 0.55];
}

const isTree = (n: string) => n.startsWith("tree-") || /oak|pine|palm|willow|maple|birch/.test(n);

function coverMask(img: Sprite, objects: LitObject[]): Uint8Array {
  const m = new Uint8Array(img.w * img.h);
  for (const o of objects)
    for (let y = 0; y < o.sprite.h; y++)
      for (let x = 0; x < o.sprite.w; x++) {
        const X = o.x + x, Y = o.y + y;
        if (o.sprite.data[y * o.sprite.w + x] && X >= 0 && Y >= 0 && X < img.w && Y < img.h) m[Y * img.w + X] = 1;
      }
  return m;
}

/** Shadows, dappled light and water reflections. Returns a new image; `img` is untouched. */
export function castLight(img: Sprite, objects: LitObject[], kit: StyleKit, opts: LightingOptions = {}): Sprite {
  const out = cloneSprite(img);
  const depth = normalizeDepth(kit.rampDepth);
  const { w, h } = img;
  const seed = opts.seed ?? 0;
  const covered = coverMask(img, objects);
  const mat = (x: number, y: number) => decodeIndex(img.data[y * w + x])?.mat;

  if (opts.shadows !== false) {
    const [vx, vy] = shadowVec(kit.lightDir);
    const shadow = new Uint8Array(w * h), canopy = new Uint8Array(w * h);
    for (const o of objects) {
      if (NO_CAST.test(o.name)) continue;
      const base = o.y + o.sprite.h - 1, cx = o.x + o.sprite.w / 2;
      const tree = isTree(o.name);
      for (let y = 0; y < o.sprite.h; y++) {
        const ht = base - (o.y + y);
        // a tree's shadow comes from its crown; the trunk's own base is hidden by it anyway
        const len = (tree ? 0.6 : 0.8) * ht;
        for (let x = 0; x < o.sprite.w; x++) {
          if (!o.sprite.data[y * o.sprite.w + x]) continue;
          const dx = o.x + x - cx;
          // sprites are viewed from the front: width stays, height becomes ground depth
          const gx = o.x + x + vx * len, gy = base + vy * len * 1.0;
          for (let s = 0; s < 2; s++) {
            const X = Math.round(gx - vx * s * 0.5), Y = Math.round(gy - vy * s * 0.5 - (tree ? 0 : 0));
            if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
            shadow[Y * w + X] = 1;
            if (tree && Math.abs(dx) < o.sprite.w * 0.45) canopy[Y * w + X] = 1;
          }
        }
      }
    }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!shadow[i] || covered[i]) continue;
        const m = mat(x, y);
        if (!m || !GROUND.has(m)) continue;
        const edge = !shadow[i - 1] || !shadow[i + 1] || (y > 0 && !shadow[i - w]) || !shadow[i + w];
        if (edge && (x + y) % 2) continue;
        if (opts.dapple !== false && canopy[i] && hash(x, y, seed) < 0.1) {
          out.data[i] = shiftIndex(img.data[i], 1, depth);
          continue;
        }
        out.data[i] = shiftIndex(img.data[i], -1, depth);
      }
  }

  if (opts.reflections !== false) {
    const water = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mat(x, y) === "water" && !covered[y * w + x];
    for (const o of objects) {
      if (NO_CAST.test(o.name)) continue;
      const base = o.y + o.sprite.h - 1;
      // only things that stand at the water: water within a few pixels below the base line
      let touch = false;
      for (let x = o.x; x < o.x + o.sprite.w && !touch; x += 2) for (let d = 1; d <= 5; d++) if (water(x, base + d)) { touch = true; break; }
      if (!touch) continue;
      const maxH = Math.min(o.sprite.h, 30);
      for (let y = 0; y < o.sprite.h; y++) {
        const ht = o.sprite.h - 1 - y;
        if (ht >= maxH) continue;
        for (let x = 0; x < o.sprite.w; x++) {
          if (!o.sprite.data[y * o.sprite.w + x]) continue;
          const ry = base + 1 + ht;
          // ripple: rows wobble sideways; fading rows drop out
          const rx = o.x + x + Math.round(Math.sin(ht * 0.9 + o.x) * (1 + ht / 14));
          if (ht > 8 && (ry + Math.floor(ht / 6)) % 2) continue;
          if (!water(rx, ry)) continue;
          const i = ry * w + rx;
          out.data[i] = shiftIndex(img.data[i], ht > maxH * 0.6 ? -1 : -2, depth);
        }
      }
    }
  }
  return out;
}

/** Light sources found by object name (lanterns, campfires, windows, crystals) plus explicit ones. */
export function findLights(objects: LitObject[], extra: Light[] = []): Light[] {
  const out = [...extra];
  for (const o of objects) {
    if (o.lights) {
      for (const l of o.lights) out.push({ x: o.x + l.x, y: o.y + l.y, r: l.r });
      continue;
    }
    if (!EMITTER.test(o.name)) continue;
    out.push({ x: o.x + o.sprite.w / 2, y: o.y + o.sprite.h * 0.55, r: Math.max(14, o.sprite.w * 1.6) });
  }
  return out;
}

interface Grade {
  /** level shift for everything */
  shift: number;
  /** extra shift for the lightest levels (flattens highlights) */
  hi: number;
  /** share of pixels that swap to the tint material, and which */
  tint: Material | null;
  tintAmt: number;
  /** warm materials swapped in a fraction of highlights (dusk/dawn light) */
  warm: number;
}

const GRADES: Record<TimeOfDay, Grade> = {
  day: { shift: 0, hi: 0, tint: null, tintAmt: 0, warm: 0 },
  dawn: { shift: -0.5, hi: 0, tint: "water", tintAmt: 0.14, warm: 0.2 },
  dusk: { shift: -1, hi: 0, tint: "water", tintAmt: 0.06, warm: 0.3 },
  night: { shift: -1.5, hi: -0.5, tint: "water", tintAmt: 0.22, warm: 0 },
};

/** Time-of-day colour grade over the whole image; at night the lights glow. */
export function grade(img: Sprite, kit: StyleKit, time: TimeOfDay, lights: Light[] = [], seed = 0, keepHue?: Uint8Array): Sprite {
  if (time === "day") return img;
  const g = GRADES[time];
  const depth = normalizeDepth(kit.rampDepth);
  const out = cloneSprite(img);
  const { w, h } = img;
  const emissive = time === "night" || time === "dusk";
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const d = decodeIndex(img.data[i]);
      if (!d) continue;
      // glow strength 0..1
      let glow = 0;
      if (emissive) for (const l of lights) glow = Math.max(glow, 1 - Math.hypot(x - l.x, (y - l.y) * 1.3) / l.r);
      glow = glow > 0 ? Math.max(0, glow * (time === "night" ? 1 : 0.5)) : 0;
      const bayer = (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
      const lit = glow > 0 && glow > bayer * 0.9;
      const keep = !!keepHue?.[i];
      const ink = d.mat === "ink" || d.mat === "ui";
      let shift = ink || keep ? g.shift * (keep ? 0.7 : 0.5) : g.shift + (d.level >= 3 ? g.hi : 0);
      let mat: Material | undefined;
      if (!ink && !lit && !keep) {
        const r = hash(x, y, seed + 17);
        if (g.tint && d.mat !== "water" && TINTED.has(d.mat) && d.mat !== g.tint && bayer < g.tintAmt * Math.max(0, 1.3 - d.level / 3) && r < 0.85) mat = g.tint;
        else if (g.warm && d.level >= 3 && (d.mat === "grass" || d.mat === "foliage") && bayer < g.warm) mat = d.mat === "grass" ? "sand" : "grass";
      }
      if (lit) shift = Math.min(2, shift + 4.5 * glow + 1);
      out.data[i] = shiftIndex(img.data[i], shift, depth, mat);
    }
  return out;
}

/** Everything in one call: shadows, dapple, reflections, then the time-of-day grade. */
export function applyLighting(img: Sprite, objects: LitObject[], kit: StyleKit, opts: LightingOptions = {}): Sprite {
  const cast = castLight(img, objects, kit, opts);
  return grade(cast, kit, opts.time ?? "day", findLights(objects, opts.lights), opts.seed ?? 0);
}

/** The objects of a tile map placed in image pixels. */
export function mapLitObjects(tm: TileMap): LitObject[] {
  const out: LitObject[] = [];
  tm.deco.forEach((t, i) => {
    const tile = tm.tiles[t];
    if (t < 0 || !tile) return;
    const bx = (i % tm.cols) * tm.tile + tm.tile / 2, by = (Math.floor(i / tm.cols) + 1) * tm.tile;
    out.push({ sprite: tile.sprite, x: Math.round(bx - tile.sprite.w / 2), y: by - tile.sprite.h, name: tile.name });
  });
  return out.sort((a, b) => a.y + a.sprite.h - (b.y + b.sprite.h) || a.x - b.x);
}

/** Light a rendered tile-map image (what the `map` generator's `lighting` param calls). */
export function lightMap(img: Sprite, tm: TileMap, kit: StyleKit, opts: LightingOptions = {}): Sprite {
  return applyLighting(img, mapLitObjects(tm), kit, opts);
}

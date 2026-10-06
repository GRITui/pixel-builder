// Wet ground: a palette-locked post pass for rain-soaked streets. Stone / dirt / path pixels get a darker,
// glinting look, seeded puddles collect, and lamps, lit windows and building silhouettes are mirrored onto
// the wet ground below their base line. Only palette indices are ever picked, never colours.
//
// Two stages so the reflections survive the time-of-day grade: `wetGround` runs BEFORE `grade`
// (the ground darkens with the rest of the scene), `wetGlow` runs AFTER it (emitter reflections stay bright
// at night, like the emitters themselves). `applyWet` runs both back to back for un-graded images.
import { colorIndexFine, decodeIndex, normalizeDepth, type Material, type RampDepth } from "./palette";
import { rng } from "./rng";
import { cloneSprite } from "./sprite";
import { findLights, shiftIndex, type Light, type LitObject, type TimeOfDay } from "./lighting";
import type { Sprite, StyleKit } from "./types";

export const WET_MODES = ["dry", "damp", "rain"] as const;
export type Wet = (typeof WET_MODES)[number];

export interface WetOptions {
  wet: Exclude<Wet, "dry">;
  seed?: number;
  /** extra emitters in image pixels not belonging to an object (carried lanterns); they reflect a few px below */
  lights?: Light[];
  /** grade applied to the scene; emitter reflections are dimmer by day (default day) */
  time?: TimeOfDay;
}

export interface WetField {
  w: number;
  h: number;
  /** ground that can be wet (stone / dirt, not covered by an object) */
  wet: Uint8Array;
  /** 1 = puddle interior, 2 = puddle rim */
  puddle: Uint8Array;
  emitters: Emitter[];
  silhouettes: LitObject[];
  depth: RampDepth;
  tile: number;
  mode: Exclude<Wet, "dry">;
  seed: number;
}

interface Emitter { x: number; y: number; r: number; base: number }

const WETABLE = new Set<Material>(["stone", "dirt"]);
const NO_MIRROR = /flower|tuft|tall-grass|lily|reed|pebble|petal|crack|fence|path|sign|waterfall/;
const EMITTER = /lantern|torch|campfire|fire|lamp|window|crystal/;
const GLOW_BY_TIME: Record<TimeOfDay, number> = { night: 1, dusk: 0.8, dawn: 0.5, day: 0.35 };

const hash = (x: number, y: number, s: number): number => {
  let h = Math.imul(x + 0x51ed, 0x85ebca6b) ^ Math.imul(y + 0x2f1b, 0xc2b2ae35) ^ Math.imul(s + 3, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
};

export type ReflectionKind = "emitter" | "silhouette" | "puddle" | "rain" | "splash";

/**
 * The palette index a reflection of `kind` takes at brightness `t` (0..1). Kept in one place so the warm
 * `lamplight` / cool `night` ramps can replace the stand-in materials later without touching the pass.
 * `src` is the source pixel for silhouettes (the mirrored object keeps its own hue, just darker).
 */
export function reflectionColor(kind: ReflectionKind, t: number, depth: RampDepth = 5, src = 0): number {
  const lv = Math.max(0, Math.min(1, t));
  switch (kind) {
    case "emitter": return colorIndexFine("gold", 0.5 + lv * 0.5, depth);
    case "puddle": return colorIndexFine("water", 0.3 + lv * 0.4, depth);
    case "rain": return colorIndexFine("water", 0.6 + lv * 0.4, depth);
    case "splash": return colorIndexFine("water", 0.8 + lv * 0.2, depth);
    case "silhouette": return shiftIndex(src, lv > 0.5 ? -1 : -2, depth);
  }
}

/** Where the water lies: wet-able ground, seeded puddles, and the emitters / objects that reflect. */
export function wetField(img: Sprite, objects: LitObject[], kit: StyleKit, opts: WetOptions): WetField {
  const { w, h } = img;
  const depth = normalizeDepth(kit.rampDepth);
  const seed = opts.seed ?? 0;
  const covered = new Uint8Array(w * h);
  for (const o of objects)
    for (let y = 0; y < o.sprite.h; y++)
      for (let x = 0; x < o.sprite.w; x++) {
        const X = o.x + x, Y = o.y + y;
        if (o.sprite.data[y * o.sprite.w + x] && X >= 0 && Y >= 0 && X < w && Y < h) covered[Y * w + X] = 1;
      }
  const wet = new Uint8Array(w * h);
  let area = 0;
  for (let i = 0; i < w * h; i++) {
    const d = decodeIndex(img.data[i]);
    if (d && !covered[i] && WETABLE.has(d.mat)) { wet[i] = 1; area++; }
  }

  // puddles: organic blobs that sit mostly on wet ground
  const puddle = new Uint8Array(w * h);
  const r = rng((seed >>> 0) ^ 0x9e11);
  const unit = Math.max(1, kit.sizes.tile / 16);
  const want = Math.floor(area / (opts.wet === "rain" ? 1100 : 2800) / (unit * unit));
  const wetPts: number[] = [];
  for (let i = 0; i < w * h; i++) if (wet[i]) wetPts.push(i);
  let made = 0;
  for (let tries = 0; tries < want * 12 && made < want && wetPts.length; tries++) {
    const c = wetPts[Math.floor(r.next() * wetPts.length)];
    const cx = c % w, cy = Math.floor(c / w);
    const rx = (3 + r.next() * 4.5) * unit * (opts.wet === "rain" ? 1.6 : 1.3), ry = rx * (0.4 + r.next() * 0.2);
    const ph = r.next() * 6.28, ph2 = r.next() * 6.28;
    const cells: number[] = [];
    let on = 0, tot = 0;
    for (let y = Math.floor(cy - ry - 2); y <= Math.ceil(cy + ry + 2); y++)
      for (let x = Math.floor(cx - rx - 2); x <= Math.ceil(cx + rx + 2); x++) {
        const a = Math.atan2((y - cy) / ry, (x - cx) / rx);
        const wob = 1 + 0.22 * Math.sin(a * 2 + ph) + 0.14 * Math.sin(a * 3 + ph2);
        if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > wob * wob) continue;
        tot++;
        if (x >= 0 && y >= 0 && x < w && y < h && wet[y * w + x]) { on++; cells.push(y * w + x); }
      }
    if (tot < 6 || on < tot * 0.85) continue;
    for (const i of cells) puddle[i] = 1;
    made++;
  }
  // rim = puddle pixel touching non-puddle ground
  const rim: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (puddle[i] !== 1) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !puddle[i - 1] || !puddle[i + 1] || !puddle[i - w] || !puddle[i + w]) rim.push(i);
    }
  for (const i of rim) puddle[i] = 2;

  // emitters grouped by the object that carries them (their base line is the object's foot)
  const emitters: Emitter[] = [];
  for (const o of objects) {
    const base = o.y + o.sprite.h - 1;
    const ls = o.lights ? o.lights.map((l) => ({ x: o.x + l.x, y: o.y + l.y, r: l.r })) : EMITTER.test(o.name) ? findLights([o]) : [];
    for (const l of ls) emitters.push({ ...l, base });
  }
  for (const l of opts.lights ?? []) emitters.push({ ...l, base: Math.round(l.y) + 6 });
  const silhouettes = objects.filter((o) => !NO_MIRROR.test(o.name));
  return { w, h, wet, puddle, emitters, silhouettes, depth, tile: kit.sizes.tile, mode: opts.wet, seed };
}

/** Stage 1 (before the grade): darker wet ground, glints, puddles and the silhouette reflections. */
export function wetGround(img: Sprite, f: WetField): Sprite {
  const out = cloneSprite(img);
  const { w, h, depth } = f;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!f.wet[i]) continue;
      const src = img.data[i];
      if (f.puddle[i] === 1) out.data[i] = shiftIndex(src, -2, depth);
      else if (f.puddle[i] === 2) {
        // thin lighter rim on the sides away from the light (bottom / right), a rare cool pixel on the others
        const away = !f.puddle[i + w] || !f.puddle[i + 1];
        out.data[i] = away ? shiftIndex(src, 2, depth) : hash(x, y, f.seed + 9) < 0.18 ? reflectionColor("puddle", 0, depth) : shiftIndex(src, -2, depth);
      }
      else out.data[i] = shiftIndex(src, -1, depth);
    }
  // glints: 2-3px dashes of sky light, only on dry-ish wet ground
  const dens = f.mode === "rain" ? 0.006 : 0.004;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (hash(x, y, f.seed + 5) >= dens) continue;
      const len = 2 + (hash(x, y, f.seed + 6) < 0.4 ? 1 : 0);
      for (let k = 0; k < len; k++) {
        const X = x + k, i = y * w + X;
        if (X >= w || !f.wet[i] || f.puddle[i]) continue;
        out.data[i] = shiftIndex(img.data[i], k === 1 ? 2 : 1, depth);
      }
    }
  // object silhouettes mirrored below the base line, darker; strong in puddles, broken up elsewhere
  for (const o of f.silhouettes) {
    const base = o.y + o.sprite.h - 1;
    const maxH = Math.min(o.sprite.h, 26);
    for (let y = 0; y < o.sprite.h; y++) {
      const ht = o.sprite.h - 1 - y;
      if (ht >= maxH) continue;
      for (let x = 0; x < o.sprite.w; x++) {
        const sv = o.sprite.data[y * o.sprite.w + x];
        if (!sv) continue;
        const ry = base + 1 + Math.round(ht * 0.8);
        const rx = o.x + x + Math.round(Math.sin(ht * 0.8 + o.x) * (0.6 + ht / 14));
        if (rx < 0 || ry < 0 || rx >= w || ry >= h) continue;
        const i = ry * w + rx;
        if (!f.wet[i]) continue;
        const inP = f.puddle[i] > 0, t = 1 - ht / maxH;
        if (!inP && (ht > 12 || (ry + rx) % 2 || (ry >> 1) % 2)) continue;
        if (inP && ht > 6 && (ry + Math.floor(ht / 4)) % 2) continue;
        out.data[i] = reflectionColor("silhouette", inP ? t : t - 0.4, depth, f.puddle[i] === 1 ? sv : out.data[i]);
      }
    }
  }
  return out;
}

/** Stage 2 (after the grade): lights as bright, rippling, dashed vertical streaks; strongest in puddles. */
export function wetGlow(img: Sprite, f: WetField, time: TimeOfDay = "day"): Sprite {
  const out = cloneSprite(img);
  const { w, h, depth } = f;
  const gain = GLOW_BY_TIME[time], kitTile = Math.max(8, f.tile);
  f.emitters.forEach((e, n) => {
    const drop = Math.min(10, Math.max(0, e.base - e.y) * 0.3);
    const y0 = Math.round(e.base + 1 + drop);
    const len = Math.round(kitTile * (e.r >= 20 ? 2.6 : 2.2) * (0.5 + gain * 0.5));
    const ph = hash(Math.round(e.x), Math.round(e.y), f.seed) * 6.28;
    for (let k = 0; k < len; k++) {
      const y = y0 + k;
      if (y < 0 || y >= h) continue;
      const fade = 1 - k / len;
      if (fade <= 0 || k % 3 === 2) continue;
      const cx = Math.round(e.x + Math.sin(k * 1.3 + ph) * (0.6 + k / 6));
      const wide = Math.min(2, (e.r >= 8 ? 1 : 0) + Math.floor(k / 14));
      for (let dx = -wide; dx <= wide; dx++) {
        const x = cx + dx;
        if (x < 0 || x >= w) continue;
        const i = y * w + x;
        if (!f.wet[i]) continue;
        const inP = f.puddle[i] > 0;
        // outside puddles only the brighter part of the streak catches the cobbles
        if (!inP && (fade * gain < 0.08 || (x + y + n) % 4 === 0)) continue;
        if (dx !== 0 && k % 2) continue;
        out.data[i] = reflectionColor("emitter", Math.min(1, 0.35 + fade * gain * (inP ? 1.2 : 0.9)), depth);
      }
    }
  });
  return out;
}

/** Wet ground + reflections in one call (for images that are not graded). */
export function applyWet(img: Sprite, objects: LitObject[], kit: StyleKit, opts: WetOptions): Sprite {
  const f = wetField(img, objects, kit, opts);
  return wetGlow(wetGround(img, f), f, opts.time ?? "day");
}

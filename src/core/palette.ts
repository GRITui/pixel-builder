// Palettes are organised as named *ramps* (dark -> light). Sprites never store
// raw colours: every pixel is an index into the flattened ramp table, so the
// same sprite re-colours itself when the style kit's palette changes. This is
// the backbone of cross-asset consistency.

export const RAMP_LEN = 5;

export const MATERIALS = [
  "ink",
  "skin",
  "hair",
  "cloth",
  "cloth2",
  "leather",
  "metal",
  "gold",
  "wood",
  "stone",
  "roof",
  "foliage",
  "grass",
  "dirt",
  "sand",
  "water",
  "accent",
  "ui",
] as const;

export type Material = (typeof MATERIALS)[number];

export type Ramps = Record<Material, string[]>;

export interface PaletteDef {
  id: string;
  name: string;
  ramps: Ramps;
}

const hearthwood: Ramps = {
  ink: ["#0e0a14", "#1c1626", "#2e2638", "#4a4058", "#6e6280"],
  skin: ["#4a2a24", "#7a4535", "#b86f50", "#e4a672", "#f6d7b0"],
  hair: ["#21130f", "#3f2418", "#6b3d22", "#9c6232", "#c99050"],
  cloth: ["#141a33", "#20305e", "#2f5596", "#4c88c8", "#8cc4e8"],
  cloth2: ["#2a0f1a", "#5c1a26", "#9c2a32", "#d24a3c", "#f08a5c"],
  leather: ["#24150f", "#3f2618", "#633c22", "#8a5a32", "#b0814e"],
  metal: ["#1b1d26", "#3a3f4f", "#646d80", "#9aa5b4", "#d6dee6"],
  gold: ["#3a2108", "#7a4a10", "#c08420", "#f0c040", "#fff0a0"],
  wood: ["#2a1a10", "#4e3020", "#7a4c2c", "#a8703e", "#d0a060"],
  stone: ["#1e1e26", "#3c3c4a", "#5e6070", "#8a8e9c", "#bcc0c8"],
  roof: ["#2a0f14", "#5a1c22", "#8e2e2e", "#c04a3c", "#e07a58"],
  foliage: ["#0f1e14", "#1d3a22", "#2e6030", "#4e8c3a", "#8cc050"],
  grass: ["#1a2e14", "#2e4c1e", "#4a7a2a", "#72a83a", "#a8d060"],
  dirt: ["#2a1810", "#4a2e1c", "#6e4a2c", "#94683e", "#b88e5a"],
  sand: ["#5a4028", "#8e6a40", "#c09a5a", "#e0c080", "#f4e4b0"],
  water: ["#0c1a3a", "#14306a", "#1e5aa0", "#3a8ccc", "#8ad0f0"],
  accent: ["#1e0f2e", "#3e1a5a", "#6a2e8e", "#a050c0", "#e090f0"],
  ui: ["#14101c", "#2a2236", "#4a3e5a", "#8a7a9a", "#e8e0f0"],
};

function mapRamps(base: Ramps, fn: (hex: string, mat: Material, level: number) => string): Ramps {
  const out = {} as Ramps;
  for (const m of MATERIALS) out[m] = base[m].map((c, i) => fn(c, m, i));
  return out;
}

const GB = ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"];
const gameboy = mapRamps(hearthwood, (_c, _m, i) => GB[Math.min(3, Math.max(0, i - 1))]);

export const PALETTES: PaletteDef[] = [
  { id: "hearthwood", name: "Hearthwood (fantasy)", ramps: hearthwood },
  {
    id: "neon-dusk",
    name: "Neon Dusk",
    ramps: mapRamps(hearthwood, (c, m, i) =>
      adjustColor(c, { hue: m === "ink" ? 0 : 40, saturation: 1.25, contrast: 1.1, warmShadows: i < 2 ? -20 : 0 }),
    ),
  },
  {
    id: "ashen",
    name: "Ashen (muted)",
    ramps: mapRamps(hearthwood, (c) => adjustColor(c, { saturation: 0.45, contrast: 0.95 })),
  },
  { id: "gameboy", name: "Handheld 4-tone", ramps: gameboy },
];

// ---------- colour math ----------

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb([h, s, l]: [number, number, number]): RGB {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const t = (x: number) => {
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [t(h + 1 / 3) * 255, t(h) * 255, t(h - 1 / 3) * 255];
}

export interface ColorAdjust {
  hue?: number; // degrees
  saturation?: number; // multiplier
  contrast?: number; // multiplier around mid lightness
  brightness?: number; // added to lightness (-1..1)
  warmShadows?: number; // hue shift applied (caller decides where)
}

export function adjustColor(hex: string, a: ColorAdjust): string {
  let [h, s, l] = rgbToHsl(hexToRgb(hex));
  h += (a.hue ?? 0) + (a.warmShadows ?? 0);
  s = Math.min(1, s * (a.saturation ?? 1));
  l = 0.5 + (l - 0.5) * (a.contrast ?? 1) + (a.brightness ?? 0);
  l = Math.min(1, Math.max(0, l));
  return rgbToHex(hslToRgb([h, s, l]));
}

// ---------- rich ramps ----------

/** Perceptual-ish luma used to keep ramps ordered after hue shifting. */
export function luma(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// Per level: [target hue, strength 0..1 toward it]. Shadows cool toward violet-blue,
// highlights warm toward yellow; the middle level keeps the authored colour.
const HUE_SHIFT: [number, number][] = [[268, 0.3], [252, 0.16], [0, 0], [56, 0.14], [50, 0.26]];

/**
 * Hue-shift one ramp (dark -> light): the classic pixel-art "richer colour" trick. Luma order is
 * preserved (repaired if a shift would break it). A ramp that is not strictly ordered, such as a
 * 4-tone handheld palette, is returned untouched.
 */
export function hueShiftRamp(ramp: string[]): string[] {
  const lum = ramp.map(luma);
  for (let i = 1; i < lum.length; i++) if (lum[i] <= lum[i - 1]) return ramp;
  const out = ramp.map((hex, i) => {
    const [target, k] = HUE_SHIFT[Math.min(i, HUE_SHIFT.length - 1)];
    if (!k) return hex;
    let [h, s, l] = rgbToHsl(hexToRgb(hex));
    const d = ((((target - h) % 360) + 540) % 360) - 180;
    const far = 1 - 0.75 * (Math.abs(d) / 180); // blue -> yellow would pass through green: keep it small
    const cap = ([34, 18, 0, 14, 22][i] ?? 12) * (i > 2 ? far : 1);
    h += Math.max(-cap, Math.min(cap, d * k));
    s = Math.min(1, Math.max(s, 0.2 * (k / 0.3)));
    return rgbToHex(hslToRgb([h, s, l]));
  });
  for (let i = 1; i < out.length; i++) {
    let guard = 0;
    while (luma(out[i]) <= luma(out[i - 1]) + 1 && guard++ < 60) {
      const [r, g, b] = hexToRgb(out[i]);
      out[i] = rgbToHex([r + (255 - r) * 0.04 + 1, g + (255 - g) * 0.04 + 1, b + (255 - b) * 0.04 + 1]);
    }
  }
  return out;
}

export function hueShiftRamps(ramps: Ramps): Ramps {
  const out = {} as Ramps;
  for (const m of MATERIALS) out[m] = hueShiftRamp(ramps[m]);
  return out;
}

// OKLab gives perceptually sane nearest-colour matching for quantisation.
function srgbToLinear(c: number) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function rgbToOklab([r, g, b]: RGB): [number, number, number] {
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

// ---------- deep ramps (rampDepth 7 | 9) ----------

export type RampDepth = 5 | 7 | 9;

/** Position inside a deep ramp of each of the five classic levels (the contract for colorIndex). */
const BASE_POS: Record<RampDepth, number[]> = { 5: [0, 1, 2, 3, 4], 7: [0, 1, 3, 5, 6], 9: [0, 2, 4, 6, 8] };

export const normalizeDepth = (d: number | undefined): RampDepth => (d === 7 || d === 9 ? d : 5);

function lerpHex(a: string, b: string, t: number): string {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/**
 * Grow a 5-shade ramp into 7 or 9 shades. The five anchors stay exactly where they are (so every
 * existing level keeps its colour); new shades are interpolated between neighbours and, because the
 * anchors are hue-shifted, they continue the cool-shadow / warm-light drift. Luma stays ordered.
 */
export function deepenRamp(ramp: string[], depth: RampDepth): string[] {
  if (depth === 5 || ramp.length !== 5) return ramp;
  const out: string[] = new Array(depth);
  const base = BASE_POS[depth];
  base.forEach((p, i) => (out[p] = ramp[i]));
  for (let i = 0; i < 4; i++) {
    for (let p = base[i] + 1; p < base[i + 1]; p++) out[p] = lerpHex(ramp[i], ramp[i + 1], (p - base[i]) / (base[i + 1] - base[i]));
  }
  return out;
}

// ---------- flattened index table ----------
// index 0 = transparent; ramp r level l -> 1 + r * RAMP_LEN + l   (the 5 classic levels, any kit)
// index 91 + r * FINE_SLOTS + k = the extra shade between level k and k+1 (deep kits only)

export const FINE_SLOTS = RAMP_LEN - 1;
export const FINE_START = 1 + MATERIALS.length * RAMP_LEN;

export function colorIndex(mat: Material, level: number): number {
  const r = MATERIALS.indexOf(mat);
  const l = Math.max(0, Math.min(RAMP_LEN - 1, Math.round(level)));
  return 1 + r * RAMP_LEN + l;
}

/** Index of the extra shade between classic level k and k+1 (k 0..3). */
export function fineSlotIndex(mat: Material, k: number): number {
  return FINE_START + MATERIALS.indexOf(mat) * FINE_SLOTS + Math.max(0, Math.min(FINE_SLOTS - 1, k));
}

/**
 * Index for a position t in [0,1] along the material's ramp (0 = darkest, 1 = lightest) in a kit of
 * the given depth. Depth 5 (or omitted) is the classic ramp; deeper depths snap t to one of
 * `depth` shades, using the extra fine indices where the shade is not one of the five levels.
 */
export function colorIndexFine(mat: Material, t: number, depth: RampDepth = 9): number {
  const p = Math.round(Math.max(0, Math.min(1, t)) * (depth - 1));
  const base = BASE_POS[depth];
  const bi = base.indexOf(p);
  if (bi >= 0) return colorIndex(mat, bi);
  let k = 0;
  while (k < 3 && base[k + 1] < p) k++;
  return fineSlotIndex(mat, k);
}

export function decodeIndex(idx: number): { mat: Material; level: number; fine?: number } | null {
  if (idx <= 0) return null;
  if (idx >= FINE_START) {
    const f = idx - FINE_START;
    const r = Math.floor(f / FINE_SLOTS);
    if (r >= MATERIALS.length) return null;
    // level = the next classic level up, so a fine shade is never mistaken for outline level 0
    return { mat: MATERIALS[r], level: (f % FINE_SLOTS) + 1, fine: f % FINE_SLOTS };
  }
  const r = Math.floor((idx - 1) / RAMP_LEN);
  if (r >= MATERIALS.length) return null;
  return { mat: MATERIALS[r], level: (idx - 1) % RAMP_LEN };
}

export const OUTLINE_INDEX = colorIndex("ink", 0);
/** Classic palette size (every kit). Deep kits use up to PALETTE_SIZE. */
export const PALETTE_SIZE_CLASSIC = 1 + MATERIALS.length * RAMP_LEN;
export const PALETTE_SIZE = FINE_START + MATERIALS.length * FINE_SLOTS;

/**
 * Flatten ramps to a lookup table aligned with sprite indices (entry 0 = transparent). Ramps longer
 * than 5 (deep kits) append the extra shades after the classic 90 entries, so classic indices never move.
 */
export function flattenRamps(ramps: Ramps): (string | null)[] {
  const deep = MATERIALS.some((m) => ramps[m].length > RAMP_LEN);
  const out: (string | null)[] = [null];
  const at = (m: Material, p: number) => ramps[m][p] ?? ramps[m][ramps[m].length - 1];
  const basePos = (m: Material) => BASE_POS[ramps[m].length === 7 ? 7 : ramps[m].length === 9 ? 9 : 5];
  for (const m of MATERIALS) for (let i = 0; i < RAMP_LEN; i++) out.push(at(m, basePos(m)[i]));
  if (deep)
    for (const m of MATERIALS) {
      const b = basePos(m);
      for (let k = 0; k < FINE_SLOTS; k++) out.push(b[k + 1] - b[k] > 1 ? at(m, b[k] + 1) : at(m, b[k]));
    }
  return out;
}

/** Nearest palette index for an RGB colour (OKLab distance). */
export function makeQuantizer(ramps: Ramps, allowed?: Material[]) {
  const flat = flattenRamps(ramps);
  const entries: { idx: number; lab: [number, number, number] }[] = [];
  flat.forEach((hex, idx) => {
    if (!hex) return;
    const d = decodeIndex(idx)!;
    if (allowed && !allowed.includes(d.mat)) return;
    entries.push({ idx, lab: rgbToOklab(hexToRgb(hex)) });
  });
  return (rgb: RGB): number => {
    const lab = rgbToOklab(rgb);
    let best = entries[0].idx, bd = Infinity;
    for (const e of entries) {
      const d = (e.lab[0] - lab[0]) ** 2 + (e.lab[1] - lab[1]) ** 2 + (e.lab[2] - lab[2]) ** 2;
      if (d < bd) { bd = d; best = e.idx; }
    }
    return best;
  };
}

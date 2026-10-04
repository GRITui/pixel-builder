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

// ---------- hue-shifted ramps (rich detail) ----------

/**
 * Rich shading splits a ramp by temperature instead of moving every shadow to
 * one darker step of the same hue: shadows swing cool (toward blue), midtones
 * keep their hue and highlights swing warm (toward yellow).
 *
 * Degrees are small on purpose — enough to read as "lit" next to the unshifted
 * ramp, not enough to leave the kit's palette.
 *
 * A ramp is only shifted when a hue shift would actually mean something, which
 * keeps a kit's colour count honest. Two kinds are skipped:
 *   - achromatic ramps (grey, or any override with no saturation), where a hue
 *     rotation is a no-op;
 *   - ramps whose steps are already duplicates of each other, like gameboy's
 *     four greens repeated across five levels. Shifting those would split one
 *     shared colour into three and quietly turn a 4-tone kit into a 6-tone one,
 *     which breaks the identity the kit exists to provide.
 */
const COOL_SHIFT = -13;
const WARM_SHIFT = 11;
const HUE_RICH_MATERIALS = new Set<Material>([
  "skin", "hair", "cloth", "cloth2", "leather", "wood", "stone", "roof", "foliage", "grass", "dirt", "sand", "water", "accent",
]);

/** True when shifting this ramp's hue would add a colour rather than move one. */
function shiftable(ramp: string[]): boolean {
  // a duplicated ramp (levels 1 and 2 are the same hex) has no distinct steps to
  // separate, so shifting it only inflates the palette
  if (new Set(ramp).size < ramp.length) return false;
  // an achromatic ramp cannot express hue at all
  return ramp.some((hex) => rgbToHsl(hexToRgb(hex))[1] > 0.05);
}

export function hueShiftedRamps(base: Ramps): Ramps {
  const out = {} as Ramps;
  for (const m of MATERIALS) {
    const ramp = base[m];
    out[m] = HUE_RICH_MATERIALS.has(m) && shiftable(ramp) ? ramp.map((hex, level) => (level === 0 || level === 4 ? hex : adjustColor(hex, { hue: level === 1 ? COOL_SHIFT : level === 2 ? 0 : WARM_SHIFT }))) : ramp;
  }
  return out;
}

// ---------- flattened index table ----------
// index 0 = transparent; ramp r level l -> 1 + r * RAMP_LEN + l

export function colorIndex(mat: Material, level: number): number {
  const r = MATERIALS.indexOf(mat);
  const l = Math.max(0, Math.min(RAMP_LEN - 1, Math.round(level)));
  return 1 + r * RAMP_LEN + l;
}

export function decodeIndex(idx: number): { mat: Material; level: number } | null {
  if (idx <= 0) return null;
  const r = Math.floor((idx - 1) / RAMP_LEN);
  if (r >= MATERIALS.length) return null;
  return { mat: MATERIALS[r], level: (idx - 1) % RAMP_LEN };
}

export const OUTLINE_INDEX = colorIndex("ink", 0);
export const PALETTE_SIZE = 1 + MATERIALS.length * RAMP_LEN;

/** Flatten ramps to a lookup table aligned with sprite indices (entry 0 = transparent). */
export function flattenRamps(ramps: Ramps): (string | null)[] {
  const out: (string | null)[] = [null];
  for (const m of MATERIALS) for (let i = 0; i < RAMP_LEN; i++) out.push(ramps[m][i] ?? ramps[m][ramps[m].length - 1]);
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

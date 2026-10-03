// Palette legend: one printable ASCII char per palette index so a language
// model (or CLI / MCP client) can "paint" with text rows. Index 0 (transparent)
// is '.'; the other 90 indices get a fixed char each (5 consecutive chars per
// material, dark -> light). The alphabet depends on neither the kit nor the
// materials filter, so art written against one legend decodes with any other
// (only the hex colours shown in the table come from the kit).
// No quotes or backslash (they would need JSON escaping) and no space.
import { MATERIALS, PALETTE_SIZE, RAMP_LEN, decodeIndex, flattenRamps, type Material } from "./palette";
import { resolveRamps } from "./kit";
import type { Sprite, StyleKit } from "./types";

export interface LegendEntry {
  char: string;
  index: number;
  material: Material;
  level: number;
  hex: string;
}

export interface Legend {
  /** Listed entries (excluding transparent), in palette order. */
  entries: LegendEntry[];
  /** char -> palette index; always contains '.' -> 0. */
  byChar: Map<string, number>;
  /** palette index -> char; always contains 0 -> '.'. */
  byIndex: Map<number, string>;
}

const TRANSPARENT = ".";

const ALPHABET =
  "abcdefghijklmnopqrstuvwxyz" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ" + "0123456789" + "!#$%&()*+,-/:;<=>?@[]^_`{|}~";

/** Index -> char for the whole palette (index 0 = '.'). */
const CHARS: string[] = [TRANSPARENT, ...ALPHABET];
if (CHARS.length !== PALETTE_SIZE || new Set(CHARS).size !== PALETTE_SIZE) {
  throw new Error(`legend alphabet must have exactly ${PALETTE_SIZE} unique chars`);
}

/**
 * Build the legend for a kit. `materials` limits which ramps are listed
 * (omit for all); '.' is always included. A material's chars never change.
 */
export function buildLegend(kit: StyleKit, materials?: Material[]): Legend {
  const flat = flattenRamps(resolveRamps(kit));
  const listed = materials ? MATERIALS.filter((m) => materials.includes(m)) : MATERIALS;
  const entries: LegendEntry[] = [];
  const byChar = new Map<string, number>([[TRANSPARENT, 0]]);
  const byIndex = new Map<number, string>([[0, TRANSPARENT]]);
  for (const material of listed) {
    const r = MATERIALS.indexOf(material);
    for (let level = 0; level < RAMP_LEN; level++) {
      const index = 1 + r * RAMP_LEN + level;
      const char = CHARS[index];
      entries.push({ char, index, material, level, hex: flat[index] ?? "#000000" });
      byChar.set(char, index);
      byIndex.set(index, char);
    }
  }
  return { entries, byChar, byIndex };
}

/** Readable table for prompts: `<char> = <material> level <n> (<hex>)`, level 0 = darkest. */
export function legendText(legend: Legend): string {
  return [`${TRANSPARENT} = transparent`, ...legend.entries.map((e) => `${e.char} = ${e.material} level ${e.level} (${e.hex})`)].join("\n");
}

function charFor(index: number, legend: Legend): string {
  const direct = legend.byIndex.get(index);
  if (direct !== undefined) return direct;
  const d = decodeIndex(index);
  if (!d) return TRANSPARENT;
  // Not listed: nearest level of the same material, else transparent.
  let best: LegendEntry | undefined;
  for (const e of legend.entries) {
    if (e.material !== d.mat) continue;
    if (!best || Math.abs(e.level - d.level) < Math.abs(best.level - d.level)) best = e;
  }
  return best ? best.char : TRANSPARENT;
}

/** Sprite -> one string of chars per row. */
export function encodeSprite(sprite: Sprite, legend: Legend): string[] {
  const rows: string[] = [];
  for (let y = 0; y < sprite.h; y++) {
    let row = "";
    for (let x = 0; x < sprite.w; x++) row += charFor(sprite.data[y * sprite.w + x], legend);
    rows.push(row);
  }
  return rows;
}

/**
 * Rows of chars -> sprite of exactly w x h. Short/missing rows are padded and
 * long ones cropped with transparent pixels; unknown chars (or non-string rows)
 * become transparent. Safe on untrusted input.
 */
export function decodeRows(rows: string[], w: number, h: number, legend: Legend): Sprite {
  const list: unknown[] = Array.isArray(rows) ? rows : [];
  const data = new Array<number>(w * h).fill(0);
  for (let y = 0; y < h; y++) {
    const row = list[y];
    if (typeof row !== "string") continue;
    const chars = Array.from(row); // code points, so a stray emoji counts as one char
    for (let x = 0; x < w && x < chars.length; x++) data[y * w + x] = legend.byChar.get(chars[x]) ?? 0;
  }
  return { w, h, data };
}

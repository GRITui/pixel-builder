// Fabric patterns (issue #38): plaid, stripes, polka, gingham.
//
// A pattern is a post-pass on a finished sprite: pixels of ONE material (the costume slot's ramp)
// inside a vertical band (torso to hem) are moved up or down the same ramp, so a pattern never
// introduces a colour, keeps the lighting gradient (shifts are relative) and clips to the garment
// automatically. Silhouette-edge pixels are skipped so sel-out and the outline stay intact.
//
// Attachment form for rigged recipes: an attachment with no parts whose id is
// `pattern-<kind>` or `pattern-<kind>:<slot>` (default slot "top"), e.g. `pattern-plaid`,
// `pattern-gingham:accent`. `patternsOf` resolves them against the recipe's slot map; the renderer
// of a rigged recipe then calls `applyPattern` on each finished frame.
import { colorIndex, decodeIndex, MATERIALS, type Material } from "../palette";
import type { Attachment } from "../rig";
import type { Sprite, StyleKit } from "../types";
import { kitLevels, PATTERNS, type Pattern } from "./shapes";

export interface PatternOpts {
  pattern: Pattern;
  /** The ramp to pattern (the costume slot's material). */
  mat: Material;
  kit: StyleKit;
  /** Rows [yMin, yMax) that can hold the garment (neck to hem); head and legs are left alone. */
  yMin: number;
  yMax: number;
}

/** Marker attachment for rigged recipes (no parts; see header). */
export const patternAttachment = (pattern: Exclude<Pattern, "none">, slot = "top"): Attachment => ({
  id: slot === "top" ? `pattern-${pattern}` : `pattern-${pattern}:${slot}`,
  name: `Pattern (${pattern}${slot === "top" ? "" : ` on ${slot}`})`,
  parts: [],
});

export const PATTERN_ATTACHMENTS: Attachment[] = PATTERNS.filter((p): p is Exclude<Pattern, "none"> => p !== "none").map((p) => patternAttachment(p));

/** Patterns requested by attachments, with their slot resolved to a material through `slots`. */
export function patternsOf(attachments: Attachment[], slots: Record<string, Material>): { pattern: Exclude<Pattern, "none">; mat: Material }[] {
  const out: { pattern: Exclude<Pattern, "none">; mat: Material }[] = [];
  for (const a of attachments) {
    const m = /^pattern-(plaid|stripes|polka|gingham)(?::(\w+))?$/.exec(a.id);
    if (!m) continue;
    const slot = m[2] ?? "top";
    const mat = (slots[slot] ?? slot) as Material;
    if ((MATERIALS as readonly string[]).includes(mat)) out.push({ pattern: m[1] as Exclude<Pattern, "none">, mat });
  }
  return out;
}

/** Level shift for one pixel; (xm, ys) are mirror-symmetric x and garment-relative y. */
function delta(pattern: Pattern, xm: number, ys: number, size: number, level: number, max: number): number {
  const u = Math.max(2, Math.round(size / 8)); // 4 at 32px, 6 at 48px
  switch (pattern) {
    case "stripes": {
      const band = Math.max(1, Math.round(u / 2)); // 2px bands at 32px, 3px at 48px
      return Math.floor(ys / band) % 2 ? -1 : 1;
    }
    case "gingham": {
      const c = Math.max(1, Math.round(u / 2));
      return 1 - ((Math.floor(ys / c) % 2) + (Math.floor(xm / c) % 2));
    }
    case "polka": {
      const dot = size >= 40 ? 2 : 1, row = Math.floor(ys / u);
      const hit = ys % u < dot && (xm + (row % 2 ? Math.round(u / 2) : 0)) % u < dot;
      return hit ? (level >= max - 1 ? -2 : 2) : 0;
    }
    case "plaid": {
      const p = Math.round(u * 1.5), w = Math.max(1, Math.round(p / 3)), line = w + 1;
      const f = (v: number) => (v % p < w ? -1 : v % p === line ? 1 : 0);
      return f(xm) + f(ys);
    }
    default:
      return 0;
  }
}

/** A copy of `sprite` with the pattern applied (the input is not mutated). */
export function applyPattern(sprite: Sprite, o: PatternOpts): Sprite {
  if (o.pattern === "none") return sprite;
  const { w, h } = sprite;
  const out = { w, h, data: sprite.data.slice() };
  const L = kitLevels(o.kit), lo = L[0], hi = L[L.length - 1];
  const inBand = (y: number) => y >= o.yMin && y < o.yMax;
  const isMat = (v: number) => {
    const d = v ? decodeIndex(v) : null;
    return !!d && d.mat === o.mat;
  };
  // anchor to the garment's top row near the centre line so the pattern rides the walk bob
  let top = o.yMin;
  const cx = w >> 1;
  search: for (let y = o.yMin; y < Math.min(h, o.yMax); y++) for (let x = cx - 3; x <= cx + 3; x++) if (isMat(sprite.data[y * w + x])) { top = y; break search; }
  for (let y = o.yMin; y < Math.min(h, o.yMax); y++)
    for (let x = 0; x < w; x++) {
      const v = sprite.data[y * w + x];
      if (!isMat(v) || !inBand(y)) continue;
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const nx = x + dx, ny = y + dy;
        return nx < 0 || ny < 0 || nx >= w || ny >= h || !sprite.data[ny * w + nx];
      });
      if (nb) continue;
      const d = decodeIndex(v)!;
      const xm = Math.floor(Math.abs(x + 0.5 - w / 2));
      const s = delta(o.pattern, xm, y - top, w, d.level, hi);
      if (!s) continue;
      out.data[y * w + x] = colorIndex(o.mat, Math.max(Math.min(lo, d.level), Math.min(hi, d.level + s)));
    }
  return out;
}

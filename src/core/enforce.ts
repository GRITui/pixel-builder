import { colorIndex, decodeIndex, makeQuantizer, MATERIALS, OUTLINE_INDEX, PALETTE_SIZE, type Material, type RGB } from "./palette";
import { isRich, lightVector, resolveRamps } from "./kit";
import { richDetail } from "./rigs/detail";
import { cloneSprite, createSprite, getPx } from "./sprite";
import type { Sprite, StyleKit } from "./types";

const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Remove any existing outer outline so re-outlining is idempotent. */
export function stripOutline(s: Sprite): Sprite {
  const out = cloneSprite(s);
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++) {
      const v = getPx(s, x, y);
      if (!v) continue;
      const d = decodeIndex(v);
      if (!d || d.level > 0) continue;
      if (N4.some(([dx, dy]) => getPx(s, x + dx, y + dy) === 0)) out.data[y * s.w + x] = 0;
    }
  return out;
}

/**
 * Add a 1px outline around the silhouette following the kit's outline mode.
 * - black: classic ink outline
 * - colored: darkest shade of the touching material
 * - selective ("selout"): dark ink on the shadow side, a darkened material
 *   colour on the side facing the light.
 */
export function applyOutline(s: Sprite, kit: StyleKit): Sprite {
  if (kit.outline === "none") return s;
  const out = cloneSprite(s);
  const L = lightVector(kit.lightDir);
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++) {
      if (getPx(s, x, y)) continue;
      let neighbour = 0;
      let towardLight = false;
      for (const [dx, dy] of N4) {
        const v = getPx(s, x + dx, y + dy);
        if (!v) continue;
        neighbour = v;
        // The empty pixel sits on the lit side if moving from it into the shape goes against the light.
        if (-dx * L[0] - dy * L[1] > 0.3) towardLight = true;
      }
      if (!neighbour) continue;
      const d = decodeIndex(neighbour);
      let idx = OUTLINE_INDEX;
      if (d && kit.outline === "colored") idx = colorIndex(d.mat, 0);
      if (d && kit.outline === "selective" && towardLight) idx = colorIndex(d.mat, Math.max(0, Math.min(1, d.level - 2)));
      out.data[y * s.w + x] = idx;
    }
  return out;
}

/** Drop stray single pixels that touch nothing (common AI / downscale noise). */
export function removeOrphans(s: Sprite): Sprite {
  const out = cloneSprite(s);
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++) {
      if (!getPx(s, x, y)) continue;
      let any = false;
      for (let dy = -1; dy <= 1 && !any; dy++)
        for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && getPx(s, x + dx, y + dy)) { any = true; break; }
      if (!any) out.data[y * s.w + x] = 0;
    }
  return out;
}

/** Clamp any out-of-range values to valid palette indices. */
export function sanitize(s: Sprite): Sprite {
  return { w: s.w, h: s.h, data: s.data.map((v) => (Number.isInteger(v) && v > 0 && v < PALETTE_SIZE ? v : 0)) };
}

/**
 * The standard finishing pass every asset goes through.
 *
 * On a `detail: "rich"` kit the one-ink outline is replaced by the #36 passes
 * (per-material sel-out, curved-edge anti-aliasing, rim light). The rich pass
 * draws its own outline, so `applyOutline` is skipped rather than run twice.
 */
export function finalize(s: Sprite, kit: StyleKit, opts: { outline?: boolean; cleanup?: boolean } = {}): Sprite {
  let out = sanitize(s);
  if (opts.cleanup) out = removeOrphans(out);
  if (isRich(kit)) return richDetail(out, kit, lightVector(kit.lightDir));
  if (opts.outline !== false) out = applyOutline(out, kit);
  return out;
}

/**
 * Convert arbitrary RGBA pixels (an imported image, already at target size)
 * into kit palette indices. Alpha < 128 becomes transparent.
 */
export function quantizeRGBA(rgba: Uint8ClampedArray | number[], w: number, h: number, kit: StyleKit, allowed?: Material[]): Sprite {
  const q = makeQuantizer(resolveRamps(kit), allowed);
  const s = createSprite(w, h);
  const cache = new Map<number, number>();
  for (let i = 0; i < w * h; i++) {
    if (rgba[i * 4 + 3] < 128) continue;
    const key = (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2];
    let v = cache.get(key);
    if (v === undefined) {
      v = q([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]] as RGB);
      cache.set(key, v);
    }
    s.data[i] = v;
  }
  return s;
}

/**
 * Box-filter downscale of an RGBA image to (w, h). Uses the dominant colour of
 * each block rather than the average so edges stay crisp instead of muddy.
 */
export function downscaleRGBA(src: Uint8ClampedArray, sw: number, sh: number, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * sw) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / w));
      const y0 = Math.floor((y * sh) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / h));
      const counts = new Map<number, number>();
      let opaque = 0, total = 0;
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * sw + xx) * 4;
          total++;
          if (src[i + 3] < 128) continue;
          opaque++;
          // bucket to 5 bits per channel so near-identical colours vote together
          const key = ((src[i] >> 3) << 10) | ((src[i + 1] >> 3) << 5) | (src[i + 2] >> 3);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      const o = (y * w + x) * 4;
      if (opaque * 2 < total) continue;
      let best = 0, bc = -1;
      for (const [k, c] of counts) if (c > bc) { bc = c; best = k; }
      out[o] = ((best >> 10) & 31) * 8 + 4;
      out[o + 1] = ((best >> 5) & 31) * 8 + 4;
      out[o + 2] = (best & 31) * 8 + 4;
      out[o + 3] = 255;
    }
  return out;
}

/** Materials a sprite actually uses, in palette order. */
export function materialsUsed(s: Sprite): Material[] {
  const set = new Set<Material>();
  for (const v of s.data) {
    const d = decodeIndex(v);
    if (d) set.add(d.mat);
  }
  return MATERIALS.filter((m) => set.has(m));
}

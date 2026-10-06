// Region heuristics over an indexed still: where water shimmers, what glows, where rain splashes.
import type { IndexedImage } from "./palette";

export interface Region { x: number; y: number; w: number; h: number }

const lightness = (img: IndexedImage, i: number) => (img.idx[i] < 0 ? -1 : img.lab[img.idx[i]][0]);
const chroma = (img: IndexedImage, e: number) => Math.hypot(img.lab[e][1], img.lab[e][2]);
const hueDeg = (img: IndexedImage, e: number) => ((Math.atan2(img.lab[e][2], img.lab[e][1]) * 180) / Math.PI + 360) % 360;

/** q-quantile (0..1) of opaque-pixel lightness, optionally restricted to rows >= y0. */
export function lightnessQuantile(img: IndexedImage, q: number, y0 = 0): number {
  const ls: number[] = [];
  for (let i = y0 * img.w; i < img.w * img.h; i++) if (img.idx[i] >= 0) ls.push(lightness(img, i));
  if (!ls.length) return 1;
  ls.sort((a, b) => a - b);
  return ls[Math.min(ls.length - 1, Math.floor(q * ls.length))];
}

/** Keep mask pixels whose (2r+1)^2 neighbourhood is at least `frac` mask: drops speckle, keeps areas. */
function densify(mask: Uint8Array, w: number, h: number, r: number, frac: number): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    let n = 0, tot = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      tot++;
      n += mask[yy * w + xx];
    }
    if (n >= frac * tot) out[y * w + x] = 1;
  }
  return out;
}

/** Keep 8-connected components whose bounding box is at least `minW` wide. */
function keepWide(mask: Uint8Array, w: number, h: number, minW: number): Uint8Array {
  const out = new Uint8Array(mask.length), seen = new Uint8Array(mask.length);
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    const comp = [s];
    seen[s] = 1;
    let x0 = w, x1 = -1;
    for (let k = 0; k < comp.length; k++) {
      const i = comp[k], x = i % w, y = (i - x) / w;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy, j = yy * w + xx;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && mask[j] && !seen[j]) { seen[j] = 1; comp.push(j); }
      }
    }
    if (x1 - x0 + 1 >= minW) for (const i of comp) out[i] = 1;
  }
  return out;
}

/** Summed-area table of a 0/1 grid, for O(1) window counts. */
function integral(g: Uint8Array, w: number, h: number): Uint32Array {
  const s = new Uint32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) for (let x = 0, row = 0; x < w; x++) {
    row += g[y * w + x];
    s[(y + 1) * (w + 1) + x + 1] = s[y * (w + 1) + x + 1] + row;
  }
  return s;
}
function windowSum(s: Uint32Array, w: number, h: number, x: number, y: number, r: number): number {
  const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(w, x + r + 1), y1 = Math.min(h, y + r + 1);
  const W = w + 1;
  return s[y1 * W + x1] - s[y0 * W + x1] - s[y1 * W + x0] + s[y0 * W + x0];
}

/**
 * Water-ish pixels. Water reads as horizontal streaks: inside a 9x9 window colour changes run mostly
 * row to row and rarely along a row. Blue/cyan pixels need less of that texture. Sky strata look the
 * same locally, so streaks only count in the lower part of the frame and a water area must span at
 * least 12% of the width; walls and clouds mostly fail one of those. A user region replaces all this.
 */
export function waterMask(img: IndexedImage, region?: Region): Uint8Array {
  const { w, h, idx } = img;
  const m = new Uint8Array(w * h);
  if (region) {
    for (let y = Math.max(0, region.y); y < Math.min(h, region.y + region.h); y++)
      for (let x = Math.max(0, region.x); x < Math.min(w, region.x + region.w); x++) if (idx[y * w + x] >= 0) m[y * w + x] = 1;
    return m;
  }
  const hc = new Uint8Array(w * h), vc = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (x + 1 < w && idx[i] !== idx[i + 1]) hc[i] = 1;
    if (y + 1 < h && idx[i] !== idx[i + w]) vc[i] = 1;
  }
  const H = integral(hc, w, h), V = integral(vc, w, h);
  for (let y = Math.floor(h * 0.3); y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, e = idx[i];
    if (e < 0) continue;
    const L = img.lab[e][0], hue = hueDeg(img, e);
    const hn = windowSum(H, w, h, x, y, 4), vn = windowSum(V, w, h, x, y, 4);
    const blue = chroma(img, e) > 0.03 && hue >= 175 && hue <= 285 && L < 0.95;
    const streaky = vn >= 2.2 * hn + 4;
    // Water mirrors the sky, so near-black texture (window grids, foliage in shade) is never water.
    if (L < 0.3) continue;
    if ((blue && vn >= 8 && vn >= 1.3 * hn) || (streaky && vn >= 14 && y >= h * 0.4)) m[i] = 1;
  }
  return keepWide(densify(m, w, h, 2, 0.5), w, h, Math.max(8, Math.round(w * 0.12)));
}

/**
 * Bright emitters (lamps, signs, lit windows): connected bright pixels that are either small or clearly
 * brighter than the ring around them. Large bright areas without that contrast (sunset sky, sand) are
 * lit surfaces, not light sources.
 */
export function emitterMask(img: IndexedImage): Uint8Array {
  const { w, h, idx } = img;
  const cut = Math.max(0.68, lightnessQuantile(img, 0.95));
  const bright = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const e = idx[i];
    if (e >= 0 && img.lab[e][0] >= cut && (chroma(img, e) > 0.05 || img.lab[e][0] > 0.9)) bright[i] = 1;
  }
  const m = new Uint8Array(w * h), seen = new Uint8Array(w * h), ring = new Int32Array(w * h);
  const small = Math.max(6, Math.round(w * h * 0.0006)), large = Math.round(w * h * 0.02);
  let stamp = 0;
  for (let s = 0; s < w * h; s++) {
    if (!bright[s] || seen[s]) continue;
    const comp: number[] = [s];
    seen[s] = 1;
    for (let k = 0; k < comp.length; k++) {
      const i = comp[k], x = i % w, y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy, j = yy * w + xx;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && bright[j] && !seen[j]) { seen[j] = 1; comp.push(j); }
      }
    }
    if (comp.length > large) continue;
    let keep = comp.length <= small;
    if (!keep) {
      stamp++;
      let inL = 0, outL = 0, outN = 0;
      for (const i of comp) {
        inL += img.lab[idx[i]][0];
        const x = i % w, y = (i - x) / w;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx, yy = y + dy, j = yy * w + xx;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h || bright[j] || idx[j] < 0 || ring[j] === stamp) continue;
          ring[j] = stamp;
          outL += img.lab[idx[j]][0];
          outN++;
        }
      }
      keep = outN > 0 && inL / comp.length - outL / outN >= 0.2;
    }
    if (keep) for (const i of comp) m[i] = 1;
  }
  return m;
}

/** Chebyshev distance (capped at r+1) from the brightest pixels; 0 = core. */
export function brightDistance(img: IndexedImage, r: number): Uint8Array {
  const { w, h, idx } = img;
  const cut = Math.max(0.7, lightnessQuantile(img, 0.975));
  const d = new Uint8Array(w * h).fill(r + 1);
  let frontier: number[] = [];
  for (let i = 0; i < w * h; i++) if (idx[i] >= 0 && img.lab[idx[i]][0] >= cut) { d[i] = 0; frontier.push(i); }
  for (let k = 1; k <= r; k++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % w, y = (i - x) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (d[j] > k) { d[j] = k; next.push(j); }
      }
    }
    frontier = next;
  }
  return d;
}

/** Splash sites: lower half, darker than most of it (ground, roofs, puddles). */
export function groundSites(img: IndexedImage): number[] {
  const { w, h, idx } = img;
  const y0 = Math.floor(h * 0.5);
  const cut = lightnessQuantile(img, 0.6, y0);
  const out: number[] = [];
  for (let i = y0 * w; i < w * h; i++) if (idx[i] >= 0 && img.lab[idx[i]][0] <= cut) out.push(i);
  return out;
}

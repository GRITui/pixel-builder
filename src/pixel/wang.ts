// Wang auto-tile engine: 8-neighbour bitmask -> the 47-tile blob set, built from
// base texture swatches. Implements the owner's `generate-autotile` spec.
//
// Bitmask per the Game Asset Design Guide:
//   N=1 NE=2 E=4 SE=8 S=16 SW=32 W=64 NW=128
// A diagonal neighbour is only VISIBLE when both its adjacent sides are the same terrain,
// which folds the 256 raw masks into exactly 47 distinct tiles.
import type { Rgba } from "./types";

export const BIT = { N: 1, NE: 2, E: 4, SE: 8, S: 16, SW: 32, W: 64, NW: 128 } as const;
const DIRS: [string, number, number, number][] = [
  ["N", 0, -1, BIT.N], ["NE", 1, -1, BIT.NE], ["E", 1, 0, BIT.E], ["SE", 1, 1, BIT.SE],
  ["S", 0, 1, BIT.S], ["SW", -1, 1, BIT.SW], ["W", -1, 0, BIT.W], ["NW", -1, -1, BIT.NW],
];

/** Normalise a raw 8-bit mask to its canonical render: a diagonal bit survives only when
 *  BOTH adjacent sides carry the land terrain (the guide's blob-47 rule — verified to
 *  collapse 256 masks into exactly 47 renders). */
export function canonicalMask(mask: number): number {
  const has = (b: number) => (mask & b) !== 0;
  let m = 0;
  for (const [d, , , bit] of DIRS) {
    if (d.length === 1) { if (has(bit)) m |= bit; continue; }
    const b1 = BIT[d[0] as "N"], b2 = BIT[d[1] as "N"];
    if (has(b1) && has(b2) && has(bit)) m |= bit;
  }
  return m;
}

/** The 47 canonical masks, ascending. */
export function canonicalMasks(): number[] {
  const seen = new Set<number>();
  for (let m = 0; m < 256; m++) seen.add(canonicalMask(m));
  return [...seen].sort((a, b) => a - b);
}

export interface Swatch { name: string; img: Rgba }

/** Mean colour of opaque pixels of a swatch, as [r,g,b]. */
export function swatchMean(s: Rgba): [number, number, number] {
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < s.w * s.h; i++) {
    if (s.data[i * 4 + 3] < 128) continue;
    r += s.data[i * 4]; g += s.data[i * 4 + 1]; b += s.data[i * 4 + 2]; n++;
  }
  if (!n) throw new Error(`swatch '${"?"}' has no opaque pixels`);
  return [r / n, g / n, b / n];
}

/** Ramp from land colour to water colour: n steps, inclusive, in sRGB. */
export function ramp(land: [number, number, number], water: [number, number, number], steps: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    out.push([
      Math.round(land[0] + (water[0] - land[0]) * t),
      Math.round(land[1] + (water[1] - land[1]) * t),
      Math.round(land[2] + (water[2] - land[2]) * t),
    ]);
  }
  return out;
}

export interface WangOptions {
  /** 16 or 32 px tiles. */
  tileSize: number;
  /** Terrain ramp: [land, ...mid, water] as rgb triplets (from swatches). */
  ramp: [number, number, number][];
  /** Band thickness of the transition (px) inside a tile, per side. */
  band: number;
  /** Dither cell size (>=2) for clustered texture inside each band. */
  cluster: number;
  seed: number;
}

/**
 * Build one 16px-corner tile for a canonical mask: fill with the LAND-side tone (index 0),
 * then paint the WATER-side transition bands on every edge whose bit is set, with
 * quarter-circle corners for diagonal-only and full-corner cases.
 */
export function wangTile(mask: number, o: WangOptions): Rgba {
  const T = o.tileSize;
  const img: Rgba = { w: T, h: T, data: new Uint8ClampedArray(T * T * 4) };
  const rnd = rngFor(o.seed, mask);
  // base: land tone with clustered value texture (2 tones, 1 cluster in 3 differs)
  const landT = o.ramp[0], midT = o.ramp[Math.floor(o.ramp.length / 2)];
  for (let by = 0; by < T; by += o.cluster) {
    for (let bx = 0; bx < T; bx += o.cluster) {
      const t = rnd() < 0.72 ? landT : midT;
      for (let y = by; y < Math.min(T, by + o.cluster); y++)
        for (let x = bx; x < Math.min(T, bx + o.cluster); x++)
          put(img, x, y, t);
    }
  }
  // water-side transition bands: ramp steps mapped onto distances from each set edge
  const waterSteps = o.ramp.slice(1); // tones toward water
  const perSide = Math.max(1, Math.round(o.band / Math.max(1, waterSteps.length)));
  const sideBands = () => waterSteps.map((c) => [c, perSide] as [[number, number, number], number]);
  for (const [d, , , bit] of DIRS) {
    if (!(mask & bit)) continue;
    if (d.length === 1) {
      const bands = sideBands();
      taper(img, d as "N" | "S" | "W" | "E", bands);
    } else {
      const s1 = d[0] as "N" | "S", s2 = d[1] as "W" | "E";
      const both = (mask & BIT[s1]) && (mask & BIT[s2]);
      if (both) {
        // full corner: the diagonal is water with land on both adjacent sides — paint the
        // water quarter-circle reaching into this tile's corner
        const cx = d.includes("E") ? T - 1 : 0;
        const cy = d.includes("S") ? T - 1 : 0;
        const bands = sideBands();
        let acc = 0;
        for (const [c, bw] of bands) {
          for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
            const dd = Math.hypot(x - cx, y - cy);
            if (dd >= acc && dd < acc + bw) put(img, x, y, c);
          }
          acc += bw;
        }
      }
      // diagonal without both sides = already dropped by canonicalMask; nothing to render
    }
  }
  return img;
}

function taper(img: Rgba, edge: "N" | "S" | "W" | "E", bands: [[number, number, number], number][]): void {
  const T = img.w;
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    const dist = edge === "N" ? y : edge === "S" ? T - 1 - y : edge === "W" ? x : T - 1 - x;
    let acc = 0;
    for (const [c, bw] of bands) {
      acc += bw;
      if (dist < acc) { put(img, x, y, c); break; }
    }
  }
}

function put(img: Rgba, x: number, y: number, c: [number, number, number]): void {
  const i = (y * img.w + x) * 4;
  img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
}

/** Deterministic RNG keyed by (seed, mask) so the same mask always renders identically. */
function rngFor(seed: number, mask: number): () => number {
  let s = (seed ^ (mask * 0x9e3779b9)) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** The full 47-tile sheet: tiles laid out row-major, 8 columns. */
export function wangSheet(o: WangOptions): { sheet: Rgba; masks: number[]; tilePositions: Map<number, [number, number]> } {
  const masks = canonicalMasks();
  const cols = 8, rows = Math.ceil(masks.length / cols);
  const sheet: Rgba = { w: cols * o.tileSize, h: rows * o.tileSize, data: new Uint8ClampedArray(cols * o.tileSize * rows * o.tileSize * 4) };
  const positions = new Map<number, [number, number]>();
  masks.forEach((m, i) => {
    const t = wangTile(m, o);
    const px = (i % cols) * o.tileSize, py = Math.floor(i / cols) * o.tileSize;
    for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
      const s = ((py + y) * sheet.w + px + x) * 4, d = (y * t.w + x) * 4;
      sheet.data[s] = t.data[d]; sheet.data[s + 1] = t.data[d + 1]; sheet.data[s + 2] = t.data[d + 2]; sheet.data[s + 3] = t.data[d + 3];
    }
    positions.set(m, [px, py]);
  });
  return { sheet, masks, tilePositions: positions };
}

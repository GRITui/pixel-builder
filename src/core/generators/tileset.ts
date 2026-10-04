import { colorIndex, decodeIndex } from "../palette";
import { createSprite } from "../sprite";
import type { Sprite, StyleKit } from "../types";
import { SOIL_TILE_KINDS, TILE_KINDS, environmentGenerator } from "./environment";
import { defaults, num, str, type GenResult, type Generator, type Params } from "./types";

/**
 * Autotile sets: one atlas of transition tiles between a `lower` and an `upper` terrain.
 *
 * wang16  2-corner Wang set. Index = NE*1 + SE*2 + SW*4 + NW*8, a corner bit set meaning
 *         that corner is `upper` (Tiled's corner wangset order; 0 = all lower, 15 = all upper).
 *         Atlas 4x4, row-major.
 * blob47  47-tile blob set (the tile's own cell is `upper`; bits mark `upper` neighbours).
 *         Mask bits N=1 NE=2 E=4 SE=8 S=16 SW=32 W=64 NW=128, a corner counting only when
 *         both of its edges are set. Tile i is the i-th valid mask in ascending order.
 *         Atlas 8x6 row-major; slot 47 holds a plain `lower` tile so the atlas has no hole.
 *
 * Tiles are opaque, un-outlined and seamless. Where the lower terrain is water it spreads in
 * with the same foam rim as map shores.
 */
export const TERRAINS = [...TILE_KINDS, ...SOIL_TILE_KINDS].map((k) => k.replace(/-tile$/, ""));
export const TILESET_LAYOUTS = ["wang16", "blob47"] as const;
export type TilesetLayout = (typeof TILESET_LAYOUTS)[number];

export interface TilesetTile {
  index: number;
  col: number;
  row: number;
  x: number;
  y: number;
  /** wang16: the corner bits; blob47: the neighbour bits (see above). */
  mask: number;
  /** Which corners (wang16) or neighbours (blob47) are `upper`. */
  upper: string[];
}

export const WANG_CORNERS = ["NE", "SE", "SW", "NW"] as const;
export const BLOB_DIRS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
/** Blob bit index at each cell of a 3x3 block (row-major; the centre is unused). */
const BLOB_DIR_AT = [7, 0, 1, 6, -1, 2, 5, 4, 3];
/** How much blurred upper coverage a pixel needs to stay upper (above 0.5 erodes the blob by ~1px). */
const UPPER_LEVEL = 0.74;

/** Canonical form: a corner only counts when both of its edges are set. */
export function blobCanon(m: number): number {
  const has = (b: number) => (m & (1 << b)) !== 0;
  let out = m & 0b01010101; // edges N E S W are bits 0,2,4,6
  for (const [c, a, b] of [[1, 0, 2], [3, 2, 4], [5, 4, 6], [7, 6, 0]] as const) if (has(c) && has(a) && has(b)) out |= 1 << c;
  return out;
}
export const BLOB47_MASKS: number[] = [...new Set(Array.from({ length: 256 }, (_, m) => blobCanon(m)))].sort((a, b) => a - b);

function terrainSprite(terrain: string, variant: number, kit: StyleKit, seed: number): Sprite {
  const kind = `${terrain}-tile`;
  return environmentGenerator.generate({ ...defaults(environmentGenerator), kind, variant: terrain === "water" ? 0 : variant }, kit, seed).rows[0].frames[0];
}

/** Rounded `lower` region of a wang tile (1 = lower); edge pixels depend only on the two corners of that edge. */
export function wangLower(T: number, corners: number): Uint8Array {
  const h = T / 2;
  const up = [corners & 1, corners & 2, corners & 4, corners & 8].map(Boolean); // NE SE SW NW
  const src = new Float64Array(T * T);
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const east = x >= h, south = y >= h;
      const isUp = south ? (east ? up[1] : up[2]) : east ? up[0] : up[3];
      src[y * T + x] = isUp ? 0 : 1;
    }
  const sigma = Math.max(1.2, T * 0.14);
  // stay inside a quadrant so an edge pixel never sees past the tile centre line
  const rad = Math.max(1, Math.min(Math.ceil(sigma * 2.5), Math.floor(h) - 1));
  const k: number[] = [];
  for (let i = -rad; i <= rad; i++) k.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const ks = k.reduce((a, b) => a + b, 0);
  const mirror = (i: number) => (i < 0 ? -i - 1 : i >= T ? 2 * T - 1 - i : i);
  const pass = (a: Float64Array, horizontal: boolean) => {
    const o = new Float64Array(T * T);
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) {
        let s = 0;
        for (let i = -rad; i <= rad; i++) s += k[i + rad] * (horizontal ? a[y * T + mirror(x + i)] : a[mirror(y + i) * T + x]);
        o[y * T + x] = s / ks;
      }
    return o;
  };
  const b = pass(pass(src, true), false);
  return ring(T, (x, y) => (b[Math.max(0, Math.min(T - 1, y)) * T + Math.max(0, Math.min(T - 1, x))] > 0.5 ? 1 : 0));
}

/** Rounded `lower` region of a blob tile from the 3x3 world around it: the upper blob, eroded a little so lower terrain (and its foam) shows at the tile edges too. */
export function blobLower(T: number, mask: number): Uint8Array {
  const W = 3 * T;
  const world = new Float64Array(W * W);
  const upCell = (cx: number, cy: number) => {
    if (cx === 1 && cy === 1) return true;
    const dir = BLOB_DIR_AT[cy * 3 + cx];
    return (mask & (1 << dir)) !== 0;
  };
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) world[y * W + x] = upCell(Math.floor(x / T), Math.floor(y / T)) ? 1 : 0;
  const sigma = Math.max(1.2, T * 0.3);
  const rad = Math.min(Math.ceil(sigma * 2.5), T - 2);
  const k: number[] = [];
  for (let i = -rad; i <= rad; i++) k.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const ks = k.reduce((a, b) => a + b, 0);
  const cl = (i: number) => Math.max(0, Math.min(W - 1, i));
  const pass = (a: Float64Array, horizontal: boolean) => {
    const o = new Float64Array(W * W);
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) {
        let s = 0;
        for (let i = -rad; i <= rad; i++) s += k[i + rad] * (horizontal ? a[y * W + cl(x + i)] : a[cl(y + i) * W + x]);
        o[y * W + x] = s / ks;
      }
    return o;
  };
  const b = pass(pass(world, true), false);
  return ring(T, (x, y) => (b[(y + T) * W + x + T] > UPPER_LEVEL ? 0 : 1));
}

/** (T+2)^2 mask with a 1px ring around the tile, so rims can look across the tile edge. */
function ring(T: number, f: (x: number, y: number) => number): Uint8Array {
  const out = new Uint8Array((T + 2) * (T + 2));
  for (let y = -1; y <= T; y++) for (let x = -1; x <= T; x++) out[(y + 1) * (T + 2) + x + 1] = f(x, y);
  return out;
}

/** Upper base with `lower` laid over the pixels flagged in `lowerMask` (lips and foam as in blendTile). */
function composeWang(upper: Sprite, lower: Sprite, lowerMask: Uint8Array, foam: boolean): Sprite {
  const T = upper.w;
  const out = createSprite(T, T);
  const at = (x: number, y: number) => lowerMask[(y + 1) * (T + 2) + x + 1];
  for (let i = 0; i < out.data.length; i++) out.data[i] = at(i % T, Math.floor(i / T)) ? lower.data[i] : upper.data[i];
  const foamIdx = colorIndex("water", 4);
  const next = out.data.slice();
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const own = at(x, y);
      const edge = [at(x, y - 1), at(x - 1, y), at(x + 1, y), at(x, y + 1)].some((n) => n !== own);
      if (!edge) continue;
      if (own && foam) next[y * T + x] = foamIdx;
      else if (!own) {
        const d = decodeIndex(out.data[y * T + x]);
        if (d) next[y * T + x] = colorIndex(d.mat, Math.max(0, d.level - 1));
      }
    }
  out.data = next;
  return out;
}

export function tilesetTiles(layout: TilesetLayout, T = 0): { cols: number; rows: number; tiles: TilesetTile[] } {
  const masks = layout === "wang16" ? Array.from({ length: 16 }, (_, i) => i) : BLOB47_MASKS;
  const cols = layout === "wang16" ? 4 : 8, rows = layout === "wang16" ? 4 : 6;
  const tiles = masks.map((mask, index) => ({
    index, col: index % cols, row: Math.floor(index / cols), x: (index % cols) * T, y: Math.floor(index / cols) * T, mask,
    upper: (layout === "wang16" ? WANG_CORNERS : BLOB_DIRS).filter((_, b) => mask & (1 << b)),
  })) as TilesetTile[];
  return { cols, rows, tiles };
}

export const tilesetGenerator: Generator = {
  id: "tileset",
  category: "environment",
  label: "Autotile tileset",
  description:
    "Autotile atlas between two ground terrains (lower, upper): 'wang16' = 2-corner Wang set (16 tiles), 'blob47' = 47-tile blob set. Seamless, opaque, kit palette; water gets the map foam rim. meta.tileset lists every tile's mask; export_asset formats tiled-tileset / godot / unity / atlas write engine files.",
  params: [
    { key: "lower", label: "Lower terrain", type: "select", options: TERRAINS, default: "dirt" },
    { key: "upper", label: "Upper terrain", type: "select", options: TERRAINS, default: "grass" },
    { key: "layout", label: "Layout", type: "select", options: [...TILESET_LAYOUTS], default: "wang16" },
    { key: "variant", label: "Variant", type: "number", min: 0, max: 9, step: 1, default: 0 },
  ],
  generate: (p, kit, seed) => generateTileset(p, kit, seed),
};

function generateTileset(p: Params, kit: StyleKit, seed: number): GenResult {
  const pick = (k: string, d: string) => (TERRAINS.includes(str(p, k)) ? str(p, k) : d);
  const lowerName = pick("lower", "dirt"), upperName = pick("upper", "grass");
  const layout = (TILESET_LAYOUTS as readonly string[]).includes(str(p, "layout")) ? (str(p, "layout") as TilesetLayout) : "wang16";
  const variant = Math.max(0, Math.min(9, Math.round(num(p, "variant") || 0)));
  const T = kit.sizes.tile;
  const upper = terrainSprite(upperName, variant, kit, seed);
  const lower = terrainSprite(lowerName, variant, kit, seed);
  const foam = lowerName === "water" && upperName !== "water";
  const { cols, rows, tiles } = tilesetTiles(layout, T);
  const atlas = createSprite(cols * T, rows * T);
  const put = (i: number, s: Sprite) => {
    const ox = (i % cols) * T, oy = Math.floor(i / cols) * T;
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) atlas.data[(oy + y) * atlas.w + ox + x] = s.data[y * T + x];
  };
  for (const t of tiles) {
    const sp =
      layout === "wang16"
        ? t.mask === 15 ? upper : t.mask === 0 ? lower : composeWang(upper, lower, wangLower(T, t.mask), foam)
        : composeWang(upper, lower, blobLower(T, t.mask), foam);
    put(t.index, sp);
  }
  if (layout === "blob47") put(47, lower);
  const meta = {
    tileset: {
      layout, tileSize: T, cols, rows, upper: upperName, lower: lowerName, count: tiles.length, tiles,
      ...(layout === "blob47" ? { extra: [{ index: 47, col: 7, row: 5, x: 7 * T, y: 5 * T, note: "plain lower tile (filler)" }] } : {}),
      ordering:
        layout === "wang16"
          ? "index = NE*1 + SE*2 + SW*4 + NW*8; a set bit means that corner is upper. 0 = all lower, 15 = all upper."
          : "tile cell is upper; mask bits N=1 NE=2 E=4 SE=8 S=16 SW=32 W=64 NW=128 mark upper neighbours (corner bit only with both edges); tiles are the 47 valid masks ascending.",
    },
  };
  return { rows: [{ name: "atlas", frames: [atlas] }], fps: 1, meta };
}

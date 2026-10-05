import { rng, valueNoise } from "../rng";
import { Painter } from "../painter";
import { colorIndex, decodeIndex, normalizeDepth, type Material } from "../palette";
import { shiftIndex } from "../lighting";
import { ensureTile } from "../tilemap";
import type { Sprite, StyleKit, TileMap } from "../types";
import { edgeShape } from "./map";

/**
 * Multi-height terrain for top-down maps (`terrain: "hills"`).
 *
 * `tm.heights` holds a level 0..2 per cell (top-down maps only; isometric maps store pixel raises in
 * the same field). A cell whose neighbour is higher gets that neighbour's top surface spilling in
 * along the same closing shape the ground blends use (`edgeShape`), so plateau corners are rounded
 * both ways and a grass overhang hangs over the edge. Under the south edge of the higher ground a
 * cliff face is drawn (lit with the kit's light, stone strata, shadow at its foot), the other edges
 * get a rock rim and a cast shadow on the lower ground. Everything is painted into the lower cell's
 * own ground tile, so deco, y-sorting and the renderers need no special case.
 *
 * Walkability is in the tiles: cliff faces and the rim cells of a plateau are `solid`, ramps and
 * stairs (tile names `ramp-*`) are not, and a step between two heights is only legal across a ramp
 * (`terrainWalkable`).
 */

export const TERRAINS = ["flat", "hills"] as const;
export type Terrain = (typeof TERRAINS)[number];
export const MAX_LEVEL = 2;

export interface Ramp {
  /** Cell of the ramp: the cell directly below (south of) the higher ground it climbs. */
  x: number;
  y: number;
  /** Level at the foot and at the top. */
  from: number;
  to: number;
  material: "wood" | "stone";
}

export interface TerrainLayout {
  /** Level per cell. */
  heights: number[];
  ramps: Ramp[];
  /** Bounding boxes (cells, inclusive) of every raised area, for metadata. */
  plateaus: { x0: number; y0: number; x1: number; y1: number; level: number }[];
}

export interface TerrainOptions {
  /** Cliff material. */
  cliff?: "stone" | "dirt";
  /** Ramp material, "stone" or "wood". */
  ramp?: "stone" | "wood";
  /** Also clear props from the cells in front of each ramp (generic maps). */
  clearFront?: boolean;
}

export interface TerrainInfo {
  /** Cells holding a cliff face (solid). */
  hosts: number[];
  /** Cells holding a waterfall. */
  waterfalls: { x: number; y: number }[];
  ramps: Ramp[];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const hash = (a: number, b: number, s: number): number => {
  let h = Math.imul(a + 0x9e37, 0x85ebca6b) ^ Math.imul(b + 0x7f4a, 0xc2b2ae35) ^ Math.imul(s + 1, 0x27d4eb2f);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
};
// N, E, S, W, NW, NE, SE, SW (the same bit order as the ground blends)
const NB: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0], [-1, -1], [1, -1], [1, 1], [-1, 1]];

// ---------- layouts (pure data) ----------

/**
 * A full-width raised band along the top of the map whose south edge wanders by a row (runs of 3+
 * cells), kept straight where the river leaves the plateau so the waterfall is a clean rectangle.
 * `water(x, y)` says where the river is.
 */
export function bandLayout(cols: number, rows: number, seed: number, water: (x: number, y: number) => boolean): { heights: number[]; edge: number[]; top: number } {
  const P = clamp(Math.round(rows * 0.32), 3, 7);
  const nz = valueNoise((seed ^ 0x7e11) >>> 0, 16);
  const edge = Array.from({ length: cols }, (_, x) => P + (nz(x / 2.6, 0.5) > 0.52 ? 1 : 0));
  const forced = new Array(cols).fill(false);
  for (let x = 0; x < cols; x++) for (let y = 0; y <= P + 2; y++) if (water(x, y)) for (let d = -1; d <= 1; d++) if (x + d >= 0 && x + d < cols) forced[x + d] = true;
  for (let x = 0; x < cols; x++) if (forced[x]) edge[x] = P;
  // runs shorter than 3 take the longer neighbour's value (never a 1-cell notch)
  for (let pass = 0; pass < 6; pass++) {
    let x = 0;
    while (x < cols) {
      let e = x;
      while (e + 1 < cols && edge[e + 1] === edge[x]) e++;
      if (e - x + 1 < 3 && !forced.slice(x, e + 1).some(Boolean)) {
        const left = x > 0 ? edge[x - 1] : edge[e + 1], right = e + 1 < cols ? edge[e + 1] : edge[x - 1];
        for (let k = x; k <= e; k++) edge[k] = pass % 2 ? right : left;
      }
      x = e + 1;
    }
  }
  const heights = new Array(cols * rows).fill(0);
  for (let x = 0; x < cols; x++) for (let y = 0; y < Math.min(rows, edge[x]); y++) heights[y * cols + x] = 1;
  return { heights, edge, top: P };
}

/** Columns on which a ramp fits under a band: the edge is flat across three cells. */
export function bandRampColumns(edge: number[], skip: (x: number) => boolean): number[] {
  const out: number[] = [];
  for (let x = 1; x < edge.length - 1; x++) if (edge[x - 1] === edge[x] && edge[x] === edge[x + 1] && !skip(x - 1) && !skip(x) && !skip(x + 1)) out.push(x);
  return out;
}

/**
 * One or two rectangular plateaus (corner notches make inner and outer corners) with a ramp on the
 * south side, and a level-2 summit with stairs inside a big one. `avoid` cells (water, path) and a
 * 1-cell border around them stay flat; null when nothing fits.
 */
export function hillsLayout(cols: number, rows: number, seed: number, avoid: Set<number>, ramp: "wood" | "stone"): TerrainLayout | null {
  const r = rng((seed ^ 0x611d5) >>> 0);
  const heights = new Array(cols * rows).fill(0);
  const ramps: Ramp[] = [];
  const plateaus: TerrainLayout["plateaus"] = [];
  const at = (x: number, y: number) => y * cols + x;
  const taken = new Set<number>();
  const count = cols * rows >= 600 ? 2 : 1;
  for (let n = 0; n < count; n++) {
    for (let t = 0; t < 80; t++) {
      const big = n === 0 && cols * rows >= 900;
      const w = big ? r.int(9, Math.min(12, cols - 4)) : r.int(6, Math.min(11, cols - 4)), h = big ? r.int(6, Math.min(8, rows - 5)) : r.int(4, Math.min(7, rows - 5));
      const x0 = r.int(1, cols - w - 1), y0 = r.int(0, rows - h - 4);
      const x1 = x0 + w - 1, y1 = y0 + h - 1;
      // the plateau, a border ring, the cliff row under it and two cells in front of the ramp
      let ok = true;
      for (let y = y0 - 1; y <= y1 + 3 && ok; y++) for (let x = x0 - 1; x <= x1 + 1 && ok; x++) if (x >= 0 && y >= 0 && x < cols && y < rows && (avoid.has(at(x, y)) || taken.has(at(x, y)))) ok = false;
      if (!ok) continue;
      const cut = new Set<number>();
      if (!big && w >= 7 && h >= 5) {
        for (const [cx, cy] of [[x0, y0], [x1 - 1, y0], [x0, y1 - 1], [x1 - 1, y1 - 1]]) if (r.next() < 0.45 && !(cy + 1 === y1)) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) cut.add(at(cx + dx, cy + dy));
      }
      const inside = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && !cut.has(at(x, y));
      const cols1: number[] = [];
      for (let x = x0 + 1; x < x1; x++) if (inside(x - 1, y1) && inside(x, y1) && inside(x + 1, y1) && y1 + 2 < rows) cols1.push(x);
      if (!cols1.length || y1 + 2 >= rows) continue;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inside(x, y)) heights[at(x, y)] = 1;
      const rx = cols1[r.int(0, cols1.length - 1)];
      ramps.push({ x: rx, y: y1 + 1, from: 0, to: 1, material: ramp });
      plateaus.push({ x0, y0, x1, y1, level: 1 });
      for (let y = y0 - 1; y <= y1 + 3; y++) for (let x = x0 - 1; x <= x1 + 1; x++) if (x >= 0 && y >= 0 && x < cols && y < rows) taken.add(at(x, y));
      // summit: two cells in from every edge so there is a walkable ledge around it
      if (w >= 9 && h >= 6 && cut.size === 0) {
        const sw = r.int(3, Math.min(4, w - 5)), sh = 2;
        const sx = r.int(x0 + 2, x1 - 1 - sw), sy = y0 + 1;
        if (sy + sh + 1 <= y1 - 0 && sx + sw - 1 <= x1 - 2) {
          for (let y = sy; y < sy + sh; y++) for (let x = sx; x < sx + sw; x++) heights[at(x, y)] = 2;
          ramps.push({ x: sx + Math.floor(sw / 2), y: sy + sh, from: 1, to: 2, material: ramp });
          plateaus.push({ x0: sx, y0: sy, x1: sx + sw - 1, y1: sy + sh - 1, level: 2 });
        }
      }
      break;
    }
  }
  return plateaus.length ? { heights, ramps, plateaus } : null;
}

// ---------- tile painting ----------

/** Cliff texture, one strip as wide as the map: stone strata cut into staggered segments, lit like every volume. */
function faceStrip(kit: StyleKit, W: number, Fh: number, mat: Material, seed: number): Sprite {
  const P = new Painter(W, Fh, kit);
  const band = Math.max(4, Math.round(Fh / 2.6));
  let x = 0, n = 0;
  while (x < W) {
    const w = Math.min(W - x, 6 + Math.floor(hash(n, 1, seed) * 7));
    const off = Math.floor(hash(n, 2, seed) * band);
    const nx = (hash(n, 3, seed) - 0.5) * 0.5;
    for (let y = -off, k = 0; y < Fh; y += band, k++) {
      const y0 = Math.max(0, y), y1 = Math.min(Fh, y + band);
      if (y1 <= y0) continue;
      P.box(x, y0, w, y1 - y0, mat, [nx, 0.35, 0.94], { tone: (k + n) % 3 === 0 ? -1 : 0 });
      if (y >= 1) P.rect(x, y, w, 1, mat, 1);
      if (hash(n, k + 9, seed) < 0.3) P.px(x, y0 + 1, mat, 3);
    }
    // a hairline crack at the segment's edge
    if (hash(n, 4, seed) < 0.55) P.rect(x + w - 1, Math.floor(hash(n, 5, seed) * Fh * 0.5), 1, Math.max(2, Math.round(Fh * 0.3)), mat, 1);
    x += w; n++;
  }
  P.shade(0, 0, W, 2, -1);
  P.shade(0, Fh - 2, W, 2, -1);
  return P.toSprite();
}

/** Steps cut into a cliff: lit treads, dark risers, a dark edge on both sides. */
function stairsTile(kit: StyleKit, T: number, mat: Material, seed: number): Sprite {
  const P = new Painter(T, T, kit);
  const x0 = Math.round(T * 0.17), x1 = T - x0, n = Math.max(3, Math.round(T / 5));
  for (let i = 0; i < n; i++) {
    const y0 = Math.round((i * T) / n), y1 = Math.round(((i + 1) * T) / n), th = Math.max(1, Math.round((y1 - y0) * 0.62));
    P.box(x0, y0, x1 - x0, th, mat, [0, -0.5, 0.85]);
    P.box(x0, y0 + th, x1 - x0, y1 - y0 - th, mat, [0, 0.8, 0.3], { tone: -1 });
    if (mat === "wood") for (let x = x0 + 4; x < x1 - 1; x += 5) P.rect(x + (i % 2 ? 2 : 0), y0, 1, th, mat, 1);
    else if (hash(i, 6, seed) < 0.5) P.px(x0 + 2 + Math.floor(hash(i, 7, seed) * (x1 - x0 - 4)), y0, mat, 4);
  }
  P.rect(x0, 0, 1, T, mat, 0);
  P.rect(x1 - 1, 0, 1, T, mat, 0);
  P.shade(x0, 0, x1 - x0, 2, -1);
  return P.toSprite();
}

const WF_PERIOD = 8;
/** Water level (1..4) of falling water at tile column X (global) and row y in frame f. */
export function waterfallLevel(X: number, y: number, f: number): number {
  const base = [2, 3, 3, 3][Math.floor(hash(X, 11, 0) * 4)];
  const ph = Math.floor(hash(X, 7, 0) * WF_PERIOD);
  const u = (((y - 2 * f + ph) % WF_PERIOD) + WF_PERIOD) % WF_PERIOD;
  return u < 3 ? Math.min(4, base + 1) : u === 5 ? Math.max(1, base - 1) : base;
}
export const WATERFALL_FOAM_ROWS = 3;

/** Animated frame of a waterfall tile (name `waterfall-<col>-<r0>-<r1>-<hash>`) from its first frame. */
export function waterfallFrame(base: Sprite, name: string, f: number): Sprite {
  const m = /^waterfall-(\d+)-(\d+)-(\d+)-/.exec(name);
  if (!m) return base;
  const col = Number(m[1]), r0 = Number(m[2]), r1 = Number(m[3]), T = base.w;
  const out: Sprite = { ...base, data: base.data.slice() };
  for (let y = r0; y < r1 - WATERFALL_FOAM_ROWS; y++)
    for (let x = 0; x < T; x++) {
      const d = decodeIndex(base.data[y * T + x]);
      if (d && d.mat === "water") out.data[y * T + x] = colorIndex("water", waterfallLevel(col * T + x, y, f));
    }
  return out;
}

const fnv = (data: ArrayLike<number>): string => {
  let h = 2166136261;
  for (let i = 0; i < data.length; i++) h = Math.imul(h ^ (data[i] & 0xffff), 16777619);
  return (h >>> 0).toString(36);
};

// ---------- the pass ----------

/**
 * Turn the height field into tiles: cliffs, rims, shadows, ramps and waterfalls are painted into
 * the ground tiles of the cells they touch. `tm.heights` is set; flat cells keep their tile.
 * Props on cliff faces and ramps are removed. Returns what was built.
 */
export function applyTerrain(tm: TileMap, kit: StyleKit, layout: TerrainLayout, seed: number, opts: TerrainOptions = {}): TerrainInfo {
  const { cols, rows, tile: T } = tm;
  const H = layout.heights;
  tm.heights = H.slice();
  const Wd = cols * T, Hd = rows * T;
  const depth = normalizeDepth(kit.rampDepth);
  const cliffMat: Material = opts.cliff === "dirt" ? "dirt" : "stone";
  const orig = tm.ground.slice();
  const rampAt = new Map<number, Ramp>();
  for (const rp of layout.ramps) rampAt.set(rp.y * cols + rp.x, rp);
  const Fh = Math.round(T * 0.8);
  const maxL = Math.min(MAX_LEVEL, Math.max(0, ...H));
  const strip = faceStrip(kit, Wd, Fh, cliffMat, seed);
  const lightX = kit.lightDir === "top-left" ? 1 : kit.lightDir === "top-right" ? -1 : 0;

  // --- per-level masks over the whole map image ---
  const top: Uint8Array[] = [], face: Uint8Array[] = [], rim: Uint8Array[] = [];
  const spill: Int32Array[] = [];
  for (let k = 1; k <= maxL; k++) {
    const T_ = new Uint8Array(Wd * Hd), SP = new Int32Array(Wd * Hd).fill(-1);
    for (let cy = 0; cy < rows; cy++)
      for (let cx = 0; cx < cols; cx++) {
        const own = H[cy * cols + cx];
        let mask = 0;
        NB.forEach(([dx, dy], b) => { if (cx + dx >= 0 && cy + dy >= 0 && cx + dx < cols && cy + dy < rows && H[(cy + dy) * cols + cx + dx] >= k) mask |= 1 << b; });
        const shape = own < k && mask ? edgeShape(T, mask) : null;
        let src = -1;
        if (shape) for (let b = 0; b < 8 && src < 0; b++) if (mask & (1 << b)) src = (cy + NB[b][1]) * cols + cx + NB[b][0];
        for (let y = 0; y < T; y++)
          for (let x = 0; x < T; x++) {
            const i = (cy * T + y) * Wd + cx * T + x;
            if (own >= k) T_[i] = 1;
            else if (shape && shape[(y + 1) * (T + 2) + x + 1]) { T_[i] = 1; SP[i] = src; }
          }
      }
    const F = new Uint8Array(Wd * Hd), R = new Uint8Array(Wd * Hd);
    for (let x = 0; x < Wd; x++)
      for (let y = 0; y < Hd; y++) {
        const i = y * Wd + x;
        if (T_[i]) continue;
        for (let dy = 1; dy <= Fh && y - dy >= 0; dy++) if (T_[(y - dy) * Wd + x]) { F[i] = dy; break; }
      }
    for (let y = 0; y < Hd; y++)
      for (let x = 0; x < Wd; x++) {
        const i = y * Wd + x;
        if (T_[i] || F[i]) continue;
        if ((y > 0 && T_[i - Wd]) || (x > 0 && T_[i - 1]) || (x < Wd - 1 && T_[i + 1])) R[i] = 1;
      }
    top.push(T_); face.push(F); rim.push(R); spill.push(SP);
  }

  const water = (c: number) => (tm.tiles[orig[c]]?.name ?? "").startsWith("water");
  const info: TerrainInfo = { hosts: [], waterfalls: [], ramps: layout.ramps };
  const solidCell = new Set<number>();
  const newGround = tm.ground.slice();
  const stairs = new Map<string, Sprite>();
  const stairsFor = (mat: "wood" | "stone") => { let s = stairs.get(mat); if (!s) stairs.set(mat, (s = stairsTile(kit, T, mat, seed))); return s; };

  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      const c = cy * cols + cx;
      const base = tm.tiles[orig[c]]?.sprite;
      if (!base) continue;
      const out = base.data.slice();
      const ramp = rampAt.get(c);
      const wfall = water(c) && cy > 0 && water(c - cols) && H[c - cols] > H[c];
      // face extent in this cell (for the waterfall's rows)
      let fy0 = T, fy1 = -1, hasFace = false;
      for (let k = 1; k <= maxL; k++)
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (face[k - 1][(cy * T + y) * Wd + cx * T + x]) { hasFace = true; fy0 = Math.min(fy0, y); fy1 = Math.max(fy1, y); }
      for (let k = 1; k <= maxL; k++) {
        const TP = top[k - 1], F = face[k - 1], R = rim[k - 1], SP = spill[k - 1];
        if (H[c] >= k) continue;
        for (let y = 0; y < T; y++)
          for (let x = 0; x < T; x++) {
            const gx = cx * T + x, gy = cy * T + y, i = gy * Wd + gx, p = y * T + x;
            if (TP[i]) {
              const s = tm.tiles[orig[SP[i]]]?.sprite ?? base;
              let v = s.data[p] || base.data[p];
              // a lit lip on the overhang's lower edge
              if (gy + 1 >= Hd || !TP[i + Wd]) { const dd = decodeIndex(v); if (dd && dd.mat !== "water") v = shiftIndex(v, 1, depth); }
              out[p] = v;
            } else if (F[i]) {
              const v = F[i] - 1;
              if (wfall && k === 1) {
                const foam = y >= fy1 + 1 - WATERFALL_FOAM_ROWS;
                out[p] = colorIndex("water", foam ? (hash(gx, gy, seed) < 0.6 ? 4 : 3) : waterfallLevel(gx, y, 0));
                if (x === 0 || x === T - 1) out[p] = colorIndex("water", foam ? 3 : 2);
              } else {
                let px = strip.data[v * Wd + gx];
                if (v === 0) {
                  // grass blades hang over the first row of the face
                  if (hash(gx, 3, seed) < 0.4 && !water(c - cols)) px = colorIndex("grass", 2);
                  else px = shiftIndex(px, -1, depth);
                }
                if (v === Fh - 1) px = shiftIndex(px, -1, depth);
                out[p] = px;
              }
            } else if (R[i]) {
              const dd = decodeIndex(out[p]);
              if (dd && dd.mat !== "water") out[p] = colorIndex(cliffMat, 1);
            } else {
              // cast shadow of the higher ground on the lower ground
              const dd = decodeIndex(out[p]);
              if (!dd || dd.mat === "water" || dd.mat === "wood") continue;
              for (let t = 1; t <= 4; t++) {
                const sx = gx - Math.round(0.75 * lightX * t), sy = gy - t;
                if (sx < 0 || sx >= Wd || sy < 0) break;
                const j = sy * Wd + sx;
                if (TP[j] || F[j] || R[j]) { out[p] = shiftIndex(out[p], -1, depth); break; }
              }
            }
          }
      }
      if (ramp) {
        const s = stairsFor(opts.ramp ?? ramp.material);
        const x0 = Math.round(T * 0.17), x1 = T - x0;
        for (let y = 0; y < T; y++) for (let x = x0; x < x1; x++) if (s.data[y * T + x]) out[y * T + x] = s.data[y * T + x];
      }
      if (out.some((v, i) => v !== base.data[i])) {
        const sp: Sprite = { w: T, h: T, data: out };
        let name: string, solid: boolean;
        if (ramp) { name = `ramp-${opts.ramp ?? ramp.material}-${fnv(out)}`; solid = false; }
        else if (wfall) { name = `waterfall-${cx}-${fy0}-${fy1 + 1}-${fnv(out)}`; solid = true; info.waterfalls.push({ x: cx, y: cy }); }
        else if (hasFace) { name = `cliff-${fnv(out)}`; solid = true; }
        else { name = `${tm.tiles[orig[c]].name}-lip-${fnv(out)}`; solid = tm.tiles[orig[c]].solid ?? false; }
        if (hasFace && !ramp) { info.hosts.push(c); solidCell.add(c); }
        newGround[c] = ensureTile(tm, name, sp, solid);
      }
    }
  // plateau cells with a lower neighbour to the north, west or east are the rim: solid, so a game
  // that only knows `solid` cannot walk off the edge (the south side is a face or a ramp)
  for (let cy = 0; cy < rows; cy++)
    for (let cx = 0; cx < cols; cx++) {
      const c = cy * cols + cx, h = H[c];
      if (h < 1) continue;
      const edge = [[0, -1], [-1, 0], [1, 0]].some(([dx, dy]) => cx + dx >= 0 && cy + dy >= 0 && cx + dx < cols && cy + dy < rows && H[(cy + dy) * cols + cx + dx] < h);
      const t = tm.tiles[newGround[c]];
      if (edge && t && !t.solid) newGround[c] = ensureTile(tm, `${t.name}-rim`, t.sprite, true);
    }
  tm.ground = newGround;
  // nothing stands on a cliff face or a ramp (and, optionally, in front of a ramp)
  const clearCells = new Set<number>([...info.hosts, ...layout.ramps.map((r) => r.y * cols + r.x)]);
  if (opts.clearFront) for (const r of layout.ramps) for (let dy = 1; dy <= 2; dy++) if (r.y + dy < rows) clearCells.add((r.y + dy) * cols + r.x);
  for (const c of clearCells) tm.deco[c] = -1;
  return info;
}

// ---------- queries ----------

/** Per cell: can something stand here (ground tile and prop not solid). */
export function terrainWalkable(tm: TileMap): boolean[] {
  return tm.ground.map((g, i) => !!tm.tiles[g] && !tm.tiles[g].solid && !(tm.deco[i] >= 0 && tm.tiles[tm.deco[i]]?.solid));
}

export const isRampTile = (tm: TileMap, i: number) => (tm.tiles[tm.ground[i]]?.name ?? "").startsWith("ramp-");

/** Cells reachable from `start` on foot: 4-connected over walkable cells, changing level only across a ramp. */
export function terrainReach(tm: TileMap, start: { x: number; y: number }): Set<number> {
  const ok = terrainWalkable(tm), H = tm.heights;
  const seen = new Set<number>();
  const s = start.y * tm.cols + start.x;
  if (!ok[s]) return seen;
  const q = [s];
  seen.add(s);
  while (q.length) {
    const c = q.pop()!;
    const x = c % tm.cols, y = Math.floor(c / tm.cols);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx, ny = y + dy, n = ny * tm.cols + nx;
      if (nx < 0 || ny < 0 || nx >= tm.cols || ny >= tm.rows || seen.has(n) || !ok[n]) continue;
      if (H && H[n] !== H[c] && !isRampTile(tm, n) && !isRampTile(tm, c)) continue;
      seen.add(n);
      q.push(n);
    }
  }
  return seen;
}

/** Level per cell (0 when the map has no height field). */
export const levelAt = (tm: TileMap, x: number, y: number): number => tm.heights?.[y * tm.cols + x] ?? 0;

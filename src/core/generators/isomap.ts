// Isometric map generator for the `kit-iso` camera: a diamond-grid TileMap with water, sand banks,
// a dirt path, optional hills (raised 1-2 levels) and y-sorted props (trees, rocks, bushes, a fenced
// house). `tilemap.orientation` is "isometric", so the Tiled export writes an isometric map with a
// ground tile layer and an object layer for props. `ground` holds terrain, `deco` holds props
// (anchored on the cell centre, the house on its footprint's bottom cell), `heights` the raise in px.
import { blit, createSprite } from "../sprite";
import { rng, valueNoise } from "../rng";
import { emptyTileMap, ensureTile } from "../tilemap";
import type { Sprite, StyleKit, TileMap } from "../types";
import { isoBuilding, isoCell, isoProp, isoTile, isoTileW, ISO_PROP_MARGIN, type IsoPropKind, type IsoTileKind } from "./iso";
import { bool, num, type Generator, type Params } from "./types";

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Screen offset of a prop sprite's top-left corner for the cell it stands on (before any preview padding). */
export function isoPropOrigin(tm: TileMap, c: number, r: number, sprite: Sprite): [number, number] {
  const { cx, bottom } = isoCell(c, r, tm.rows, tm.tile);
  const raise = tm.heights?.[r * tm.cols + c] ?? 0;
  return [Math.round(cx - sprite.w / 2), Math.round(bottom + ISO_PROP_MARGIN - raise - sprite.h)];
}

/** Draw the map back to front (ground, then the prop of each cell) into one sprite. */
export function renderIsoMap(tm: TileMap): Sprite {
  const T = tm.tile, TH = T / 2;
  const cells: { c: number; r: number }[] = [];
  for (let r = 0; r < tm.rows; r++) for (let c = 0; c < tm.cols; c++) cells.push({ c, r });
  cells.sort((a, b) => a.c + a.r - (b.c + b.r) || a.c - b.c);
  const at = (c: number, r: number) => {
    const i = r * tm.cols + c, g = tm.tiles[tm.ground[i]], d = tm.tiles[tm.deco[i]];
    const { cx, bottom } = isoCell(c, r, tm.rows, T);
    const [dx, dy] = d ? isoPropOrigin(tm, c, r, d.sprite) : [0, 0];
    return { g, d, gx: cx - T / 2, gy: bottom - (g?.sprite.h ?? 0), dx, dy };
  };
  let minX = 0, minY = 0, maxX = (tm.cols + tm.rows) * (T / 2), maxY = ((tm.cols + tm.rows) * TH) / 2 + TH;
  for (const { c, r } of cells) {
    const a = at(c, r);
    if (a.d) { minX = Math.min(minX, a.dx); minY = Math.min(minY, a.dy); maxX = Math.max(maxX, a.dx + a.d.sprite.w); }
    if (a.g) minY = Math.min(minY, a.gy);
  }
  const out = createSprite(Math.ceil(maxX - minX), Math.ceil(maxY - minY));
  for (const { c, r } of cells) {
    const a = at(c, r);
    if (a.g) blit(out, a.g.sprite, a.gx - minX, a.gy - minY);
    if (a.d) blit(out, a.d.sprite, a.dx - minX, a.dy - minY);
  }
  return out;
}

export interface IsoPlan {
  cols: number;
  rows: number;
  kind: IsoTileKind[];
  level: number[];
  path: boolean[];
  house?: { c: number; r: number; size: number };
  spawn: [number, number];
}

export function planIsoMap(cols: number, rows: number, seed: number, water: number, hills: boolean, house: number): IsoPlan {
  const r = rng(seed);
  const n = valueNoise(seed + 11, 8), n2 = valueNoise(seed + 29, 8);
  const kind: IsoTileKind[] = new Array(cols * rows).fill("grass");
  const level: number[] = new Array(cols * rows).fill(0);
  const path: boolean[] = new Array(cols * rows).fill(false);
  const I = (c: number, rr: number) => rr * cols + c;
  const clamp = (c: number, rr: number) => I(Math.max(0, Math.min(cols - 1, c)), Math.max(0, Math.min(rows - 1, rr)));
  const edge = (c: number, rr: number) => c < 1 || rr < 1 || c >= cols - 1 || rr >= rows - 1;
  for (let rr = 0; rr < rows; rr++)
    for (let c = 0; c < cols; c++) {
      const v = n(c * 0.3, rr * 0.3), h = n2(c * 0.3 + 3, rr * 0.3 + 5);
      if (v < water && !edge(c, rr)) kind[I(c, rr)] = "water";
      else if (hills && h > 0.66) level[I(c, rr)] = h > 0.8 ? 2 : 1;
    }
  // a level-2 cell needs raised neighbours so the walls step down
  for (let rr = 1; rr < rows - 1; rr++)
    for (let c = 1; c < cols - 1; c++)
      if (level[I(c, rr)] === 2 && NEIGHBOURS.some(([dx, dy]) => level[I(c + dx, rr + dy)] === 0)) level[I(c, rr)] = 1;
  // dirt path wandering across the map from the west edge (flat, fords water)
  let pr = Math.round(rows / 2) + r.int(-1, 1);
  const spawn: [number, number] = [0, pr];
  const lay = (c: number, rr: number) => { path[I(c, rr)] = true; kind[I(c, rr)] = "dirt"; level[I(c, rr)] = 0; };
  for (let c = 0; c < cols; c++) {
    lay(c, pr);
    if (r.chance(0.35)) {
      const to = Math.max(2, Math.min(rows - 3, pr + (r.chance(0.5) ? 1 : -1)));
      for (let q = Math.min(pr, to); q <= Math.max(pr, to); q++) lay(c, q);
      pr = to;
    }
  }
  // sand banks next to water
  for (let rr = 0; rr < rows; rr++)
    for (let c = 0; c < cols; c++)
      if (kind[I(c, rr)] === "grass" && level[I(c, rr)] === 0 && NEIGHBOURS.some(([dx, dy]) => kind[clamp(c + dx, rr + dy)] === "water")) kind[I(c, rr)] = "sand";
  // house lot: flat grass n x n with a ring of margin, away from the edge
  let lot: IsoPlan["house"];
  if (house > 0) {
    const ok = (c: number, rr: number) => {
      for (let j = -1; j <= house; j++) for (let i = -1; i <= house; i++) if (edge(c + i, rr + j)) return false;
      for (let j = 0; j < house; j++) for (let i = 0; i < house; i++) { const k = I(c + i, rr + j); if (kind[k] !== "grass" || level[k] !== 0 || path[k]) return false; }
      return true;
    };
    let best = Infinity;
    for (let rr = 1; rr < rows - 1; rr++)
      for (let c = 1; c < cols - 1; c++)
        if (ok(c, rr)) {
          const d = Math.abs(c - cols * 0.58) + Math.abs(rr + house - rows * 0.3) + r.next() * 0.5;
          if (d < best) { best = d; lot = { c, r: rr, size: house }; }
        }
  }
  return { cols, rows, kind, level, path, house: lot, spawn };
}

export const isoMapGenerator: Generator = {
  id: "isomap",
  category: "map",
  label: "Iso map",
  description: "Isometric (2:1 dimetric) map for the 'kit-iso' camera: diamond grid with a dirt path, ponds with sand banks, optional hills (raised blocks), trees, rocks, bushes and a fenced house. Exports to Tiled as an isometric map: a ground tile layer plus a y-sorted object layer for props; meta has the spawn cell, house lot and per-cell heights.",
  params: [
    { key: "cols", label: "Width (cells)", type: "number", min: 6, max: 40, step: 1, default: 14 },
    { key: "rows", label: "Height (cells)", type: "number", min: 6, max: 40, step: 1, default: 14 },
    { key: "water", label: "Water amount (0-0.5)", type: "number", min: 0, max: 0.5, step: 0.05, default: 0.3 },
    { key: "hills", label: "Raised hills", type: "bool", default: true },
    { key: "house", label: "House footprint (cells, 0 = none)", type: "number", min: 0, max: 3, step: 1, default: 2 },
    { key: "props", label: "Trees, rocks and bushes (0-1)", type: "number", min: 0, max: 1, step: 0.1, default: 0.5 },
    { key: "fence", label: "Fence around the house", type: "bool", default: true },
  ],
  generate(p: Params, kit: StyleKit, seed: number) {
    const cols = num(p, "cols"), rows = num(p, "rows"), T = isoTileW(kit), TH = T / 2;
    const plan = planIsoMap(cols, rows, seed, num(p, "water"), bool(p, "hills"), Math.round(num(p, "house")));
    const tm = emptyTileMap(cols, rows, T);
    tm.orientation = "isometric";
    const heights: number[] = new Array(cols * rows).fill(0);
    tm.heights = heights;
    const R = rng(seed + 7);
    const lvl = Math.round(T / 4);
    const canvasH = TH + 2 * lvl;
    const padded = (s: Sprite): Sprite => { const o = createSprite(T, canvasH); blit(o, s, 0, canvasH - s.h); return o; };
    const I = (c: number, r: number) => r * cols + c;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const i = I(c, r), kind = plan.kind[i], h = plan.level[i], v = (c * 7 + r * 13 + (c ^ r)) % 4;
        const name = `${kind}${h ? `-h${h}` : ""}-${v}`;
        const idx = tm.tiles.findIndex((t) => t.name === name);
        tm.ground[i] = idx >= 0 ? idx : ensureTile(tm, name, padded(isoTile(kit, kind, seed, v, h)), kind === "water");
        heights[i] = kind === "water" ? 0 : h * lvl;
      }
    const free = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && tm.deco[I(c, r)] < 0 && plan.level[I(c, r)] === 0 && plan.kind[I(c, r)] === "grass" && !plan.path[I(c, r)];
    const prop = (kind: IsoPropKind, v: number) => ensureTile(tm, `${kind}-${v}`, isoProp(kit, kind, seed, v, { leaf: "foliage", wood: "wood", stone: "stone" }), true);
    const reserved = new Set<number>();
    const lot = plan.house;
    if (lot) {
      for (let j = -1; j <= lot.size; j++) for (let i = -1; i <= lot.size; i++) reserved.add(I(lot.c + i, lot.r + j));
      tm.deco[I(lot.c + lot.size - 1, lot.r + lot.size - 1)] = ensureTile(tm, "house", isoBuilding(kit, lot.size, seed, "sand", "roof", "wood", true, true), true);
      if (bool(p, "fence")) {
        // a yard along the south-east and south-west sides of the house, with a gap in front of the door
        const { c, r, size } = lot;
        for (let i = 0; i <= size; i++) if (i !== Math.floor(size / 2) && free(c + i, r + size)) tm.deco[I(c + i, r + size)] = prop("fence-se", 0);
        for (let j = 0; j < size; j++) if (free(c + size, r + j)) tm.deco[I(c + size, r + j)] = prop("fence-sw", 0);
        if (free(c + size, r + size)) tm.deco[I(c + size, r + size)] = prop("post", 0);
      }
    }
    const density = num(p, "props") * 0.28;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const roll = R.next(), pick = R.next(), v = R.int(0, 3);
        if (!free(c, r) || reserved.has(I(c, r)) || roll > density) continue;
        tm.deco[I(c, r)] = prop(pick < 0.4 ? "tree" : pick < 0.55 ? "pine" : pick < 0.75 ? "bush" : "rock", v);
      }
    return { rows: [{ name: "map", frames: [renderIsoMap(tm)] }], fps: 1, tilemap: tm, meta: { camera: "iso", spawn: plan.spawn, ...(lot ? { house: lot } : {}) } };
  },
};

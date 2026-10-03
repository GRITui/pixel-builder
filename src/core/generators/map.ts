import { rng, valueNoise, type Rng } from "../rng";
import { emptyTileMap, ensureTile, renderTileMap } from "../tilemap";
import type { StyleKit, TileMap } from "../types";
import { environmentGenerator } from "./environment";
import { bool, defaults, num, str, type Generator } from "./types";

export const BIOMES = ["meadow", "forest", "island", "desert", "winter"] as const;
type Biome = (typeof BIOMES)[number];
type Ground = "grass" | "dirt" | "sand" | "water" | "stone-path" | "snow";

const SOLID_PROPS = new Set(["oak", "pine", "palm", "dead-tree", "rock", "boulder", "crystal", "stump"]);
/** Props taller/wider than a tile that shouldn't be clipped by the map edge or stacked side by side. */
const BIG_PROPS = new Set(["oak", "pine", "palm", "dead-tree", "boulder"]);

type Weights = Partial<Record<Ground, Record<string, number>>>;

/** Which props each biome scatters, weighted, per ground type (no entry = nothing grows there). */
const PROPS: Record<Biome, Weights> = {
  meadow: {
    grass: { oak: 3, bush: 3, flowers: 5, "tall-grass": 4, rock: 1.5, mushroom: 0.6, stump: 0.5 },
    sand: { rock: 1 },
    dirt: { rock: 1 },
  },
  forest: {
    grass: { oak: 5, pine: 4, bush: 3, mushroom: 2, stump: 1.5, "tall-grass": 2, rock: 1, flowers: 0.5 },
    sand: { rock: 1 },
    dirt: { rock: 1, stump: 1 },
  },
  island: {
    grass: { palm: 3, bush: 2, flowers: 1.5, "tall-grass": 1.5, rock: 1, oak: 1 },
    sand: { palm: 3, rock: 1.5, "tall-grass": 0.6 },
    dirt: { rock: 1 },
  },
  desert: {
    sand: { "dead-tree": 2, rock: 3, boulder: 1.5, "tall-grass": 0.5, crystal: 0.3 },
    grass: { palm: 3, bush: 2, "tall-grass": 2, flowers: 1 },
    dirt: { rock: 1.5, boulder: 0.5 },
  },
  winter: {
    snow: { pine: 5, "dead-tree": 1.5, rock: 2, boulder: 1.5, crystal: 0.8, bush: 1 },
    grass: { pine: 3, bush: 2 },
    dirt: { rock: 1.5 },
  },
};

/** Chance (before density and clumping) that a free cell gets a prop. */
const BASE_CHANCE: Record<Biome, number> = { meadow: 0.22, forest: 0.55, island: 0.3, desert: 0.14, winter: 0.3 };
const BASE_GROUND: Record<Biome, Ground> = { meadow: "grass", forest: "grass", island: "grass", desert: "sand", winter: "snow" };
const PATH_GROUND: Record<Biome, Ground> = { meadow: "dirt", forest: "dirt", island: "dirt", desert: "dirt", winter: "stone-path" };
const VARIANTS = 3;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A winding 2-cell-wide path from the left edge to the right edge (4-connected). */
function carvePath(cols: number, rows: number, r: Rng, lo: number, hi: number): Set<number> {
  const cells = new Set<number>();
  let y = rows * (lo + (hi - lo) * r.next());
  let vy = 0;
  let prev = Math.round(y);
  for (let x = 0; x < cols; x++) {
    vy = clamp(vy * 0.8 + (r.next() - 0.5) * 0.9, -0.8, 0.8);
    y = clamp(y + vy, Math.max(1, rows * lo - 2), Math.min(rows - 3, rows * hi + 2));
    const cy = Math.round(y);
    const [a, b] = cy >= prev ? [prev, cy] : [cy, prev];
    for (let yy = a; yy <= b; yy++) {
      cells.add(yy * cols + x);
      cells.add((yy + 1) * cols + x);
    }
    prev = cy;
  }
  return cells;
}

function dilate(cells: Set<number>, cols: number, rows: number): Set<number> {
  const out = new Set<number>();
  for (const i of cells) {
    const x = i % cols, y = Math.floor(i / cols);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < cols && yy < rows) out.add(yy * cols + xx);
      }
  }
  return out;
}

function buildGround(biome: Biome, cols: number, rows: number, seed: number, r: Rng, wantPath: boolean): { ground: Ground[]; path: Set<number> } {
  const ground: Ground[] = new Array(cols * rows).fill(BASE_GROUND[biome]);
  const at = (x: number, y: number) => y * cols + x;
  const n1 = valueNoise(seed ^ 0x9e37, 16), n2 = valueNoise(seed ^ 0x51ed, 16);
  const path = wantPath ? carvePath(cols, rows, r, biome === "island" ? 0.38 : 0.25, biome === "island" ? 0.62 : 0.75) : new Set<number>();
  const clear = dilate(path, cols, rows); // keep water away from the path so it never gets cut

  if (biome === "island") {
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const nx = (x + 0.5 - cols / 2) / (cols / 2), ny = (y + 0.5 - rows / 2) / (rows / 2);
        const e = 1 - Math.hypot(nx, ny) * 1.15 + (n1(x / 4, y / 4) - 0.5) * 0.6;
        ground[at(x, y)] = e < 0.08 ? "water" : e < 0.2 ? "sand" : "grass";
      }
  } else if (biome === "desert") {
    // an oasis on the side of the map away from the path
    const midY = wantPath ? [...path].reduce((a, i) => a + Math.floor(i / cols), 0) / path.size : rows / 2;
    const scale = Math.min(cols, rows) / 24;
    const ox = cols * (0.25 + 0.5 * r.next()), oy = midY < rows / 2 ? rows * 0.74 : rows * 0.26;
    const rad = (2 + 1.5 * r.next()) * Math.max(0.7, scale);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const d = Math.hypot(x + 0.5 - ox, y + 0.5 - oy) + (n1(x / 3, y / 3) - 0.5) * 1.4;
        if (d < rad) ground[at(x, y)] = clear.has(at(x, y)) ? "grass" : "water";
        else if (d < rad + 1.8) ground[at(x, y)] = "grass";
        else if (n2(x / 4, y / 4) > 0.8) ground[at(x, y)] = "dirt";
      }
  } else {
    const threshold = biome === "forest" ? 0.8 : 0.74;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        if (n1(x / 4.5, y / 4.5) > threshold && !clear.has(at(x, y))) ground[at(x, y)] = "water";
        else if (biome === "winter" && n2(x / 4, y / 4) > 0.82) ground[at(x, y)] = "grass";
      }
    if (biome !== "winter")
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          if (ground[at(x, y)] === "water") continue;
          const wet = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => ground[at(x + dx, y + dy)] === "water" && x + dx >= 0 && x + dx < cols && y + dy >= 0 && y + dy < rows);
          if (wet) ground[at(x, y)] = "sand";
        }
  }

  for (const i of path) if (ground[i] !== "water") ground[i] = PATH_GROUND[biome];
  return { ground, path };
}

function pickWeighted(table: Record<string, number>, r: Rng): string {
  const entries = Object.entries(table);
  let t = r.next() * entries.reduce((a, [, w]) => a + w, 0);
  for (const [k, w] of entries) {
    t -= w;
    if (t <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

export const mapGenerator: Generator = {
  id: "map",
  category: "map",
  label: "Map",
  description: "Procedural top-down tile map (meadow, forest, island, desert, winter) built from the kit's ground tiles and props.",
  params: [
    { key: "biome", label: "Biome", type: "select", options: [...BIOMES], default: "meadow" },
    { key: "cols", label: "Columns", type: "number", min: 12, max: 48, step: 1, default: 24 },
    { key: "rows", label: "Rows", type: "number", min: 12, max: 48, step: 1, default: 20 },
    { key: "density", label: "Prop density", type: "number", min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: "path", label: "Winding path", type: "bool", default: true },
  ],
  generate(p, kit: StyleKit, seed) {
    const biome = ((BIOMES as readonly string[]).includes(str(p, "biome")) ? str(p, "biome") : "meadow") as Biome;
    const cols = clamp(Math.round(num(p, "cols")) || 24, 12, 48);
    const rows = clamp(Math.round(num(p, "rows")) || 20, 12, 48);
    const density = clamp(Number.isFinite(num(p, "density")) ? num(p, "density") : 0.5, 0, 1);
    const wantPath = bool(p, "path");
    const T = kit.sizes.tile;
    const r = rng(seed >>> 0);
    const envDefaults = defaults(environmentGenerator);

    const tm: TileMap = emptyTileMap(cols, rows, T);
    const { ground, path } = buildGround(biome, cols, rows, seed >>> 0, r, wantPath);

    // --- ground layer: a few texture variants per kind so it doesn't read as a grid ---
    const tileCache = new Map<string, number>();
    const groundTile = (g: Ground, v: number): number => {
      const name = v === 0 || g === "water" ? g : `${g}-${v + 1}`;
      let idx = tileCache.get(name);
      if (idx === undefined) {
        const kind = `${g}-tile`;
        const sprite = environmentGenerator.generate({ ...envDefaults, kind, variant: g === "water" ? 0 : v }, kit, seed).rows[0].frames[0];
        idx = ensureTile(tm, name, sprite, g === "water");
        tileCache.set(name, idx);
      }
      return idx;
    };
    for (let i = 0; i < ground.length; i++) {
      const g = ground[i];
      const v = r.chance(0.7) ? 0 : r.int(1, VARIANTS - 1);
      tm.ground[i] = groundTile(g, v);
    }

    // --- deco layer ---
    const propCache = new Map<string, number>();
    const propTile = (kind: string, v: number): number => {
      const name = `${kind}-${v}`;
      let idx = propCache.get(name);
      if (idx === undefined) {
        const sprite = environmentGenerator.generate({ ...envDefaults, kind, variant: v * 3 + (kind.length % 3) }, kit, seed).rows[0].frames[0];
        idx = ensureTile(tm, name, sprite, SOLID_PROPS.has(kind));
        propCache.set(name, idx);
      }
      return idx;
    };
    const clump = valueNoise((seed ^ 0xabc1) >>> 0, 16);
    const chance0 = BASE_CHANCE[biome] * density;
    const tall = kit.sizes.environment > T;
    const bigRows = tall ? Math.ceil(kit.sizes.environment / T) - 1 : 0;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const g = ground[i];
        // Always consume the same randomness per cell so edits to one rule don't reshuffle the whole map.
        const roll = r.next(), pickRoll = r.next(), vRoll = r.int(0, VARIANTS - 1);
        if (g === "water" || path.has(i) || chance0 <= 0) continue;
        const table = PROPS[biome][g];
        if (!table) continue;
        if (roll >= chance0 * (0.35 + 1.3 * clump(x / 3, y / 3))) continue;
        const entries = Object.entries(table);
        let t = pickRoll * entries.reduce((a, [, w]) => a + w, 0);
        let kind = entries[entries.length - 1][0];
        for (const [k, w] of entries) {
          t -= w;
          if (t <= 0) { kind = k; break; }
        }
        if (BIG_PROPS.has(kind)) {
          if (y < bigRows || (tall && (x < 1 || x > cols - 2))) continue;
          if (biome !== "forest" && x > 0 && BIG_PROPS.has(tmKind(tm, tm.deco[i - 1]))) continue;
        }
        tm.deco[i] = propTile(kind, vRoll);
      }
    void pickWeighted;
    return { rows: [{ name: "map", frames: [renderTileMap(tm)] }], fps: 1, tilemap: tm };
  },
};

/** Prop kind of a deco tile index ("oak-1" -> "oak"); "" for empty. */
function tmKind(tm: TileMap, idx: number): string {
  const t = tm.tiles[idx];
  return t ? t.name.replace(/-\d+$/, "") : "";
}

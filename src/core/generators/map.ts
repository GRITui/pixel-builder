import { rng, valueNoise, type Rng } from "../rng";
import { emptyTileMap, ensureTile, renderTileMap } from "../tilemap";
import type { StyleKit, TileMap } from "../types";
import { animalGenerator } from "./animal";
import { buildingGenerator } from "./building";
import { environmentGenerator, environmentIdle, treeHeight } from "./environment";
import { colorIndex, decodeIndex } from "../palette";
import { createSprite } from "../sprite";
import type { Sprite } from "../types";
import { bool, defaults, num, str, type Generator } from "./types";

// Rendering a building or a full animal sheet costs far more than the rest of a map,
// so village deco sprites are memoised per kit object (kits are replaced, not mutated).
const HOUSE_VARIANTS = 4;
const spriteCache = new WeakMap<StyleKit, Map<string, Sprite>>();
function cachedSprite(kit: StyleKit, key: string, make: () => Sprite): Sprite {
  let m = spriteCache.get(kit);
  if (!m) spriteCache.set(kit, (m = new Map()));
  let sp = m.get(key);
  if (!sp) m.set(key, (sp = make()));
  return { ...sp, data: sp.data.slice() };
}

export const BIOMES = ["meadow", "forest", "island", "desert", "winter", "rice-village"] as const;
type Biome = (typeof BIOMES)[number];
export type Ground = "grass" | "dirt" | "sand" | "water" | "stone-path" | "snow" | "paddy";

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
  // paddies stay clear of props; dry grass gets palms, bushes and tall grass
  "rice-village": {
    grass: { palm: 4, bush: 4, "tall-grass": 3, flowers: 0.8, rock: 0.12 },
  },
};

/** Chance (before density and clumping) that a free cell gets a prop. */
const BASE_CHANCE: Record<Biome, number> = { meadow: 0.22, forest: 0.55, island: 0.3, desert: 0.14, winter: 0.3, "rice-village": 0.2 };
const BASE_GROUND: Record<Biome, Ground> = { meadow: "grass", forest: "grass", island: "grass", desert: "sand", winter: "snow", "rice-village": "grass" };
const PATH_GROUND: Record<Biome, Ground> = { meadow: "dirt", forest: "dirt", island: "dirt", desert: "dirt", winter: "stone-path", "rice-village": "dirt" };
const VARIANTS = 6;
/** Which ground spreads over which at a seam (higher wins); water uses shoreTile instead. */
const BLEND_PRIORITY: Record<Ground, number> = { water: -1, paddy: 0, dirt: 1, "stone-path": 1, sand: 2, grass: 3, snow: 4 };
const BLEND_ORDER = (Object.keys(BLEND_PRIORITY) as Ground[]).filter((g) => g !== "water").sort((a, b) => BLEND_PRIORITY[a] - BLEND_PRIORITY[b]);
/** 8-neighbour offsets; bit k of a blend mask = NEIGHBOURS[k]. */
const NEIGHBOURS: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0], [-1, -1], [1, -1], [1, 1], [-1, 1]];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A winding path (2+ cells wide, 4-connected, no pinholes) from the left edge to the right edge. */
function carvePath(cols: number, rows: number, r: Rng, lo: number, hi: number): Set<number> {
  const centre: number[] = [];
  let y = rows * (lo + (hi - lo) * r.next());
  let vy = 0;
  for (let x = 0; x < cols; x++) {
    vy = clamp(vy * 0.8 + (r.next() - 0.5) * 0.9, -0.8, 0.8);
    y = clamp(y + vy, Math.max(1, rows * lo - 2), Math.min(rows - 3, rows * hi + 2));
    centre.push(Math.round(y));
  }
  const cells = new Set<number>();
  for (let x = 0; x < cols; x++) {
    const near = [centre[Math.max(0, x - 1)], centre[x], centre[Math.min(cols - 1, x + 1)]];
    for (let yy = Math.min(...near); yy <= Math.max(...near) + 1; yy++) cells.add(yy * cols + x);
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
  } else if (biome === "rice-village") {
    // 2-3 irregular paddies (noisy rounded rectangles), each ringed by a 1-tile dirt bund
    const taken = new Set(clear);
    const want = cols * rows >= 500 ? 3 : 2;
    const edge = valueNoise(seed ^ 0x2b1d, 16);
    for (let a = 0, made = 0; a < 80 && made < want; a++) {
      const w = r.int(6, Math.max(6, Math.round(cols / 2.5))), h = r.int(4, Math.max(4, Math.round(rows / 2.5)));
      const x0 = r.int(2, Math.max(2, cols - w - 3)), y0 = r.int(2, Math.max(2, rows - h - 3));
      const cells: number[] = [];
      for (let y = y0; y < y0 + h; y++)
        for (let x = x0; x < x0 + w; x++) {
          const cx = (x + 0.5 - x0) / w * 2 - 1, cy = (y + 0.5 - y0) / h * 2 - 1;
          const d = Math.pow(Math.abs(cx), 4) + Math.pow(Math.abs(cy), 4) + (edge(x / 2, y / 2) - 0.5) * 0.7;
          if (d < 0.8) cells.push(at(x, y));
        }
      if (cells.length < 12) continue;
      let ok = true;
      for (const i of cells) {
        const x = i % cols, y = Math.floor(i / cols);
        for (let dy = -1; ok && dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (taken.has(at(Math.max(0, Math.min(cols - 1, x + dx)), Math.max(0, Math.min(rows - 1, y + dy))))) { ok = false; break; }
      }
      if (!ok) continue;
      made++;
      for (const i of cells) { taken.add(i); ground[i] = "paddy"; }
      for (const i of dilate(new Set(cells), cols, rows)) {
        taken.add(i);
        const x = i % cols, y = Math.floor(i / cols);
        // bunds are 4-connected rings, no diagonal-only dirt
        if (ground[i] !== "paddy" && (cells.includes(at(x, y - 1)) || cells.includes(at(x, y + 1)) || cells.includes(at(x - 1, y)) || cells.includes(at(x + 1, y)))) ground[i] = "dirt";
      }
    }
  } else {
    const threshold = biome === "forest" ? 0.84 : biome === "winter" ? 0.78 : 0.8;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        if (n1(x / 4.5, y / 4.5) > threshold && !clear.has(at(x, y))) ground[at(x, y)] = "water";
      }
    if (biome !== "winter")
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          if (ground[at(x, y)] === "water") continue;
          let wet = false;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx, yy = y + dy;
              if ((dx || dy) && xx >= 0 && yy >= 0 && xx < cols && yy < rows && ground[at(xx, yy)] === "water") wet = true;
            }
          if (wet) ground[at(x, y)] = "sand";
        }
  }

  for (const i of path) if (ground[i] !== "water") ground[i] = PATH_GROUND[biome];
  return { ground, path };
}

function pickWeighted(table: Record<string, number>, roll: number): string {
  const entries = Object.entries(table);
  let t = roll * entries.reduce((a, [, w]) => a + w, 0);
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
  description: "Procedural top-down tile map (meadow, forest, island, desert, winter, rice-village with flooded paddies) built from the kit's ground tiles and props.",
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

    paintGround(tm, ground, kit, seed, r);

    // --- deco layer ---
    const propCache = new Map<string, number>();
    const propTile = (kind: string, v: number): number => {
      const name = `${kind}-${v}`;
      let idx = propCache.get(name);
      if (idx === undefined) {
        const sprite = environmentIdle({ ...envDefaults, kind, variant: v * 3 + (kind.length % 3) }, kit, seed);
        idx = ensureTile(tm, name, sprite, SOLID_PROPS.has(kind));
        propCache.set(name, idx);
      }
      return idx;
    };
    const clump = valueNoise((seed ^ 0xabc1) >>> 0, 16);
    const chance0 = BASE_CHANCE[biome] * density;
    const wide = kit.sizes.environment > T;
    // rice-village: stilt houses beside the path (own rng so prop placement stays stable) and a few animals
    const reserved = new Set<number>();
    if (biome === "rice-village" && chance0 > 0) {
      const hr = rng(((seed >>> 0) ^ 0x51a7) >>> 0);
      const spots: number[] = [];
      for (let y = 2; y < rows; y++) for (let x = 1; x < cols - 1; x++) {
        const i = y * cols + x;
        if (ground[i] === "grass" && !path.has(i)) spots.push(i);
      }
      // prefer cells one step off the path
      const near1 = dilate(path, cols, rows);
      const cand = spots.filter((i) => near1.has(i));
      for (let k = cand.length - 1; k > 0; k--) { const j = hr.int(0, k); [cand[k], cand[j]] = [cand[j], cand[k]]; }
      const nHouse = Math.max(2, Math.min(4, Math.round(cols / 8)));
      const hv = ["", "-b"];
      // mostly stilt houses; every third is a wider two-storey half-brick house
      const houseSprite = (n: number) => {
        const style = n % 3 === 1 ? "half-brick" : "stilt-house";
        const access = n % 2 ? "ladder" : "stairs";
        const variant = ((seed + n * 7) >>> 0) % HOUSE_VARIANTS;
        return { style, sp: cachedSprite(kit, `house:${style}:${access}:${variant}`, () => buildingGenerator.generate({ ...defaults(buildingGenerator), style, access }, kit, variant).rows[0].frames[0]) };
      };
      // sprites are bottom-centred on their cell: keep the whole footprint on the map and clear of paddies
      const houses: { i: number; e: number }[] = [];
      for (const i of cand) {
        if (houses.length >= nHouse) break;
        const { sp } = houseSprite(houses.length);
        const e = Math.ceil((sp.w / 2 - T / 2) / T), up = Math.ceil(sp.h / T) - 1;
        const x = i % cols, y = Math.floor(i / cols);
        if (x - e < 0 || x + e >= cols || y < up) continue;
        if (houses.some((h) => Math.abs((h.i % cols) - x) < h.e + e + 2 && Math.abs(Math.floor(h.i / cols) - y) < 7)) continue;
        let clear = true;
        for (let d = 0; clear && d <= up; d++) for (let dx = -e; dx <= e; dx++) { const j = (y - d) * cols + x + dx; const g = ground[j]; if (g === "paddy" || g === "water" || (g === "dirt" && !path.has(j))) clear = false; }
        if (!clear) continue;
        houses.push({ i, e });
      }
      houses.forEach(({ i, e }, n) => {
        const { style, sp } = houseSprite(n);
        tm.deco[i] = ensureTile(tm, `${style}-${n}${hv[n % 2]}`, sp, true);
        // the footprint and three rows in front stay free so tall props (palms) do not hide the doors
        for (let dy = 0; dy <= 3; dy++) for (let dx = -e; dx <= e; dx++) if (i + dy * cols + dx < cols * rows) reserved.add(i + dy * cols + dx);
        reserved.add(i - cols);
      });
      const animals = ["water-buffalo", "chicken", "chicken"];
      const free = [...Array(cols * rows).keys()].filter((i) => ground[i] === "grass" && !reserved.has(i) && !path.has(i));
      for (let n = 0; n < animals.length && free.length; n++) {
        const i = free.splice(hr.int(0, free.length - 1), 1)[0];
        const sp = cachedSprite(kit, `animal:${animals[n]}`, () => {
          const ar = animalGenerator.generate({ ...defaults(animalGenerator), species: animals[n] }, kit, 0).rows;
          return (ar.find((x) => x.name === "idle-down") ?? ar[0]).frames[0];
        });
        tm.deco[i] = ensureTile(tm, `${animals[n]}-${n}`, sp, false);
        reserved.add(i);
      }
    }
    const bigRowsOf = (kind: string) => Math.ceil(treeHeight(kit, kind) / T) - 1;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        const g = ground[i];
        // Always consume the same randomness per cell so edits to one rule don't reshuffle the whole map.
        const roll = r.next(), pickRoll = r.next(), vRoll = r.int(0, VARIANTS - 1);
        if (g === "water" || path.has(i) || reserved.has(i) || chance0 <= 0) continue;
        const table = PROPS[biome][g];
        if (!table) continue;
        if (roll >= chance0 * (0.35 + 1.3 * clump(x / 3, y / 3))) continue;
        const kind = pickWeighted(table, pickRoll);
        if (BIG_PROPS.has(kind)) {
          if (y < bigRowsOf(kind) || (wide && (x < 1 || x > cols - 2))) continue;
          if (biome === "rice-village" && [1, 2].some((d) => y >= d && BIG_PROPS.has(tmKind(tm, tm.deco[i - d * cols])))) continue;
          if (biome === "rice-village" && [0, 1, 2].some((d) => y >= d && [-1, 0, 1].some((dx) => ground[(y - d) * cols + Math.max(0, Math.min(cols - 1, x + dx))] === "paddy"))) continue;
          if (biome !== "forest" && x > 0 && BIG_PROPS.has(tmKind(tm, tm.deco[i - 1]))) continue;
        }
        tm.deco[i] = propTile(kind, vRoll);
      }
    return { rows: [{ name: "map", frames: [renderTileMap(tm)] }], fps: 1, tilemap: tm };
  },
};

/**
 * Fill `tm.ground` from a ground-type grid: textured kit tiles with blended edges between
 * grounds and foam-rimmed shores. Exported so hand-laid scenes get the same transitions as maps.
 */
export function paintGround(tm: TileMap, ground: Ground[], kit: StyleKit, seed: number, r: Rng = rng(seed >>> 0)): void {
  const { cols, rows } = tm;
  const envDefaults = defaults(environmentGenerator);
  // --- ground layer: a few texture variants per kind so it doesn't read as a grid ---
  const tileCache = new Map<string, number>();
  const spriteCache = new Map<string, Sprite>();
  const baseSprite = (g: Ground, v: number): Sprite => {
    const name = v === 0 || g === "water" ? g : `${g}-${v + 1}`;
    let sp = spriteCache.get(name);
    if (!sp) {
      sp = environmentGenerator.generate({ ...envDefaults, kind: `${g}-tile`, variant: g === "water" ? 0 : v }, kit, seed).rows[0].frames[0];
      spriteCache.set(name, sp);
    }
    return sp;
  };
  const groundTile = (g: Ground, v: number): number => {
    const name = v === 0 || g === "water" ? g : `${g}-${v + 1}`;
    let idx = tileCache.get(name);
    if (idx === undefined) {
      idx = ensureTile(tm, name, baseSprite(g, v), g === "water");
      tileCache.set(name, idx);
    }
    return idx;
  };
  const isWater = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && ground[y * cols + x] === "water";
  // Seeded value noise picks the texture variant so repeats form no visible lattice.
  const vNoise = valueNoise((seed ^ 0x7f31) >>> 0, 16);
  for (let i = 0; i < ground.length; i++) {
    const g = ground[i];
    const x = i % cols, y = Math.floor(i / cols);
    const rr = r.next(), rv = r.int(1, VARIANTS - 1);
    const v = rr < 0.4 ? 0 : (rv + Math.floor(vNoise(x / 2, y / 2) * VARIANTS)) % VARIANTS;
    if (g === "water") { tm.ground[i] = groundTile(g, 0); continue; }
    // higher-priority neighbours spread into this cell along a smooth curve (see blendTile)
    const layers: { g: Ground; mask: number }[] = [];
    for (const h of BLEND_ORDER) {
      if (BLEND_PRIORITY[h] <= BLEND_PRIORITY[g]) continue;
      let m = 0;
      NEIGHBOURS.forEach(([dx, dy], k) => {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < cols && yy < rows && ground[yy * cols + xx] === h) m |= 1 << k;
      });
      if (m) layers.push({ g: h, mask: m });
    }
    const edgeKey = layers.map((l) => `${l.mask}${l.g}`).join("-");
    let wmask = 0;
    NEIGHBOURS.forEach(([dx, dy], k) => { if (isWater(x + dx, y + dy)) wmask |= 1 << k; });
    if (!wmask && !edgeKey) { tm.ground[i] = groundTile(g, v); continue; }
    const sv = v % 2; // two texture variants per transition is plenty
    const name = `${g}${wmask ? `-shore-${wmask}` : ""}${edgeKey ? `-edge-${edgeKey}` : ""}${sv ? "b" : ""}`;
    let idx = tileCache.get(name);
    if (idx === undefined) {
      // water spreads last, with a foam rim, so shores round off the same way as land seams
      const all = [...layers.map((l) => ({ sprite: baseSprite(l.g, sv), mask: l.mask })), ...(wmask ? [{ sprite: baseSprite("water", 0), mask: wmask, foam: true }] : [])];
      const sp = blendTile(baseSprite(g, sv), all);
      idx = ensureTile(tm, name, sp, false);
      tileCache.set(name, idx);
    }
    tm.ground[i] = idx;
  }
}

/** Prop kind of a deco tile index ("oak-1" -> "oak"); "" for empty. */
function tmKind(tm: TileMap, idx: number): string {
  const t = tm.tiles[idx];
  return t ? t.name.replace(/-\d+$/, "") : "";
}

/**
 * Pixels of a T-sized tile (plus a 1px ring, for rims) covered by higher ground in the cells set
 * in `mask`: the closing of those cells (radius rc) grown by d, so straight runs stay straight and
 * corners round both ways. Depends only on (T, mask), so it is computed once per process.
 */
const edgeShapes = new Map<string, Uint8Array>();
function edgeShape(T: number, mask: number): Uint8Array {
  const key = `${T}:${mask}`;
  const hit = edgeShapes.get(key);
  if (hit) return hit;
  // closing of the higher ground (radius rc) grown by d: straight runs stay straight, and both
  // convex and concave corners get a real radius instead of stair-steps
  const rc = Math.max(3, T * 0.75), d = Math.max(1, T * 0.18), rho = rc - d;
  const n = Math.ceil(rho), M = n + 1, G = T + 2 * M;
  // distance from each pixel centre (tile coords -M .. T+M-1) to the higher cells
  const g = new Float64Array(G * G);
  for (let gy = 0; gy < G; gy++)
    for (let gx = 0; gx < G; gx++) {
      const qx = gx - M + 0.5, qy = gy - M + 0.5;
      let m = Infinity;
      NEIGHBOURS.forEach(([dx, dy], k) => {
        if (!(mask & (1 << k))) return;
        const ex = Math.max(dx * T - qx, 0, qx - (dx * T + T)), ey = Math.max(dy * T - qy, 0, qy - (dy * T + T));
        m = Math.min(m, Math.hypot(ex, ey));
      });
      g[gy * G + gx] = m;
    }
  const disc: [number, number][] = [];
  for (let oy = -n; oy <= n; oy++) for (let ox = -n; ox <= n; ox++) if (ox * ox + oy * oy <= rho * rho) disc.push([ox, oy]);
  const inside = (x: number, y: number) => {
    const at = (xx: number, yy: number) => {
      const gx = xx + M, gy = yy + M;
      return gx < 0 || gy < 0 || gx >= G || gy >= G ? Infinity : g[gy * G + gx];
    };
    const d0 = at(x, y);
    if (d0 < d) return true;
    if (d0 >= rc + rho) return false;
    // inside iff the whole disc of radius rho around p lies within rc of the higher ground
    for (const [ox, oy] of disc) if (at(x + ox, y + oy) >= rc) return false;
    return true;
  };
  const W = T + 2, out = new Uint8Array(W * W);
  for (let y = -1; y <= T; y++) for (let x = -1; x <= T; x++) out[(y + 1) * W + x + 1] = inside(x, y) ? 1 : 0;
  edgeShapes.set(key, out);
  return out;
}

/**
 * Ground tile with higher-priority neighbours spreading into it (mask bits follow NEIGHBOURS).
 * The neighbour ground is the morphological closing of those cells grown by a couple of pixels:
 * clean straight edges, rounded corners both ways (Kenney-style). The shape depends only on
 * cells within a tile's reach, so adjacent transition tiles line up. A 1px darker rim marks
 * land lips; water layers get a foam rim instead.
 */
function blendTile(base: Sprite, layers: { sprite: Sprite; mask: number; foam?: boolean }[]): Sprite {
  const T = base.w;
  const out = createSprite(T, T);
  for (let i = 0; i < base.data.length; i++) out.data[i] = base.data[i];
    const taken = (x: number, y: number, mask: number) => edgeShape(T, mask)[(y + 1) * (T + 2) + x + 1] === 1;
  // which layer owns each pixel (-1 = this tile's own ground); later layers win
  const owner = new Array(T * T).fill(-1);
  layers.forEach(({ sprite, mask }, li) => {
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++)
        if (taken(x, y, mask)) { out.data[y * T + x] = sprite.data[y * T + x]; owner[y * T + x] = li; }
  });
  const ownerAt = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < T && y < T) return owner[y * T + x];
    for (let li = layers.length - 1; li >= 0; li--) if (taken(x, y, layers[li].mask)) return li;
    return -1;
  };
  const foamy = (li: number) => li >= 0 && !!layers[li].foam;
  const foam = colorIndex("water", 4);
  const next = out.data.slice();
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const o = owner[y * T + x];
      const nbs = [ownerAt(x, y - 1), ownerAt(x - 1, y), ownerAt(x + 1, y), ownerAt(x, y + 1)];
      if (foamy(o)) {
        if (nbs.some((n) => !foamy(n))) next[y * T + x] = foam;
      } else if (o === -1 && nbs.some((n) => n !== -1)) {
        // 1px darker lip on this ground where a neighbour spreads over it (the wet line at shores)
        const d = decodeIndex(out.data[y * T + x]);
        if (d) next[y * T + x] = colorIndex(d.mat, Math.max(0, d.level - 1));
      }
    }
  out.data = next;
  return out;
}

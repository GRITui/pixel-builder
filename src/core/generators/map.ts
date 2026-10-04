import { rng, valueNoise, type Rng } from "../rng";
import { emptyTileMap, ensureTile, renderTileMap } from "../tilemap";
import type { StyleKit, TileMap } from "../types";
import { animalGenerator } from "./animal";
import { buildingGenerator } from "./building";
import { environmentGenerator, treeHeight } from "./environment";
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
type Ground = "grass" | "dirt" | "sand" | "water" | "stone-path" | "snow" | "paddy";

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
      if (path.has(i) && g === PATH_GROUND[biome]) {
        // path cell: ragged border of the neighbouring ground on sides that touch non-path land
        const nb = (dx: number, dy: number): Ground | null => {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) return null;
          const j = yy * cols + xx;
          return path.has(j) || ground[j] === "water" ? null : ground[j];
        };
        const sides = [nb(0, -1), nb(1, 0), nb(0, 1), nb(-1, 0)];
        let emask = 0;
        let nground: Ground | null = null;
        sides.forEach((sg, k) => { if (sg) { emask |= 1 << k; nground ??= sg; } });
        const diag: [number, number, number][] = [[-1, -1, 16], [1, -1, 32], [1, 1, 64], [-1, 1, 128]];
        const covered = [(1 | 8), (1 | 2), (4 | 2), (4 | 8)];
        diag.forEach(([dx, dy, bit], k) => {
          if (emask & covered[k]) return;
          const dg = nb(dx, dy);
          if (dg && !path.has((y + dy) * cols + x) ) { emask |= bit; nground ??= dg; }
        });
        if (emask) {
          const sv = v % 2;
          const name = `${g}-edge-${emask}-${nground}${sv ? "b" : ""}`;
          let idx = tileCache.get(name);
          if (idx === undefined) {
            idx = ensureTile(tm, name, pathEdgeTile(baseSprite(g, sv), baseSprite(nground!, sv), emask), false);
            tileCache.set(name, idx);
          }
          tm.ground[i] = idx;
          continue;
        }
      }
      // 4-neighbour water mask (N,E,S,W) plus diagonal notches for corners not already covered
      let mask = (isWater(x, y - 1) ? 1 : 0) | (isWater(x + 1, y) ? 2 : 0) | (isWater(x, y + 1) ? 4 : 0) | (isWater(x - 1, y) ? 8 : 0);
      if (!(mask & 1) && !(mask & 8) && isWater(x - 1, y - 1)) mask |= 16;
      if (!(mask & 1) && !(mask & 2) && isWater(x + 1, y - 1)) mask |= 32;
      if (!(mask & 4) && !(mask & 2) && isWater(x + 1, y + 1)) mask |= 64;
      if (!(mask & 4) && !(mask & 8) && isWater(x - 1, y + 1)) mask |= 128;
      if (mask === 0) { tm.ground[i] = groundTile(g, v); continue; }
      const sv = v % 2; // two shore texture variants per mask is plenty
      const name = `${g}-shore-${mask}${sv ? "b" : ""}`;
      let idx = tileCache.get(name);
      if (idx === undefined) {
        idx = ensureTile(tm, name, shoreTile(baseSprite(g, sv), baseSprite("water", 0), mask), false);
        tileCache.set(name, idx);
      }
      tm.ground[i] = idx;
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
      const houses: number[] = [];
      const nHouse = Math.max(2, Math.min(4, Math.round(cols / 8)));
      const hv = ["", "-b"];
      for (const i of cand) {
        if (houses.length >= nHouse) break;
        const x = i % cols, y = Math.floor(i / cols);
        if (houses.some((h) => Math.abs((h % cols) - x) < 7 && Math.abs(Math.floor(h / cols) - y) < 7)) continue;
        let clearUp = y >= 5;
        for (let d = 1; clearUp && d <= 5; d++) for (let dx = -2; dx <= 2; dx++) { const g = ground[(y - d) * cols + Math.max(0, Math.min(cols - 1, x + dx))]; if (g === "paddy" || (g === "dirt" && !path.has((y - d) * cols + x + dx))) clearUp = false; }
        if (!clearUp) continue;
        houses.push(i);
      }
      houses.forEach((i, n) => {
        const access = n % 2 ? "ladder" : "stairs";
        const variant = ((seed + n * 7) >>> 0) % HOUSE_VARIANTS;
        const sp = cachedSprite(kit, `house:${access}:${variant}`, () => buildingGenerator.generate({ ...defaults(buildingGenerator), style: "stilt-house", access }, kit, variant).rows[0].frames[0]);
        tm.deco[i] = ensureTile(tm, `stilt-house-${n}${hv[n % 2]}`, sp, true);
        for (let dx = -1; dx <= 1; dx++) reserved.add(i + dx);
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

/** Prop kind of a deco tile index ("oak-1" -> "oak"); "" for empty. */
function tmKind(tm: TileMap, idx: number): string {
  const t = tm.tiles[idx];
  return t ? t.name.replace(/-\d+$/, "") : "";
}

/**
 * Land tile touching water: a foam line on the water-facing edges, a darker wet line behind it,
 * and rounded corners where two water sides meet (or a notch for a diagonal-only water cell).
 * mask bits: 1=N 2=E 4=S 8=W water neighbours; 16=NW 32=NE 64=SE 128=SW diagonal-only.
 */
function shoreTile(land: Sprite, water: Sprite, mask: number): Sprite {
  const T = land.w;
  const out = createSprite(T, T);
  for (let i = 0; i < land.data.length; i++) out.data[i] = land.data[i];
  const dark = (v: number) => {
    const d = decodeIndex(v);
    return d ? colorIndex(d.mat, Math.max(0, d.level - 1)) : v;
  };
  const foam = colorIndex("water", 4);
  const set = (x: number, y: number, v: number) => { if (x >= 0 && y >= 0 && x < T && y < T) out.data[y * T + x] = v; };
  const N = mask & 1, E = mask & 2, S = mask & 4, W = mask & 8;
  // wet line first, then foam on top
  for (let i = 0; i < T; i++) {
    if (N) set(i, 1, dark(land.data[T + i]));
    if (S) set(i, T - 2, dark(land.data[(T - 2) * T + i]));
    if (W) set(1, i, dark(land.data[i * T + 1]));
    if (E) set(T - 2, i, dark(land.data[i * T + T - 2]));
  }
  for (let i = 0; i < T; i++) {
    if (N) set(i, 0, foam);
    if (S) set(i, T - 1, foam);
    if (W) set(0, i, foam);
    if (E) set(T - 1, i, foam);
  }
  const wv = (x: number, y: number) => water.data[y * T + x];
  const corner = (cx: number, cy: number, sx: number, sy: number) => {
    // water-filled rounded corner (cut radius 3), foam on its rim
    for (let dy = 0; dy < 4; dy++)
      for (let dx = 0; dx < 4; dx++) {
        const d = dx + dy;
        const x = cx + sx * dx, y = cy + sy * dy;
        if (d <= 2) set(x, y, wv(x, y));
        else if (d === 3 && dx < 3 && dy < 3) set(x, y, foam);
      }
  };
  if (N && W) corner(0, 0, 1, 1);
  if (N && E) corner(T - 1, 0, -1, 1);
  if (S && E) corner(T - 1, T - 1, -1, -1);
  if (S && W) corner(0, T - 1, 1, -1);
  const notch = (cx: number, cy: number, sx: number, sy: number) => {
    set(cx, cy, foam);
    set(cx + sx, cy, foam);
    set(cx, cy + sy, foam);
  };
  if (mask & 16) notch(0, 0, 1, 1);
  if (mask & 32) notch(T - 1, 0, -1, 1);
  if (mask & 64) notch(T - 1, T - 1, -1, -1);
  if (mask & 128) notch(0, T - 1, 1, -1);
  return out;
}

/**
 * Path tile whose non-path sides fray into the neighbouring ground: a ragged 1-2px border
 * (depth depends only on the position along the edge so adjacent edge tiles line up),
 * rounded outer corners where two sides meet and a small notch for diagonal-only neighbours.
 * mask bits as shoreTile.
 */
function pathEdgeTile(pathSp: Sprite, ground: Sprite, mask: number): Sprite {
  const T = pathSp.w;
  const out = createSprite(T, T);
  for (let i = 0; i < pathSp.data.length; i++) out.data[i] = pathSp.data[i];
  const set = (x: number, y: number) => { if (x >= 0 && y >= 0 && x < T && y < T) out.data[y * T + x] = ground.data[y * T + x]; };
  const depth = (i: number, side: number) => {
    const h = Math.imul(i + 1 + side * 31, 2654435761) >>> 0;
    return 1 + ((h >>> 13) % 5 < 2 ? 1 : 0) + (T >= 24 && (h >>> 7) % 7 === 0 ? 1 : 0);
  };
  const N = mask & 1, E = mask & 2, S = mask & 4, W = mask & 8;
  for (let i = 0; i < T; i++) {
    if (N) for (let d = 0; d < depth(i, 0); d++) set(i, d);
    if (S) for (let d = 0; d < depth(i, 2); d++) set(i, T - 1 - d);
    if (W) for (let d = 0; d < depth(i, 3); d++) set(d, i);
    if (E) for (let d = 0; d < depth(i, 1); d++) set(T - 1 - d, i);
  }
  const corner = (cx: number, cy: number, sx: number, sy: number) => {
    for (let dy = 0; dy < 4; dy++)
      for (let dx = 0; dx < 4; dx++) if (dx + dy <= 3 - (T < 12 ? 1 : 0)) set(cx + sx * dx, cy + sy * dy);
  };
  if (N && W) corner(0, 0, 1, 1);
  if (N && E) corner(T - 1, 0, -1, 1);
  if (S && E) corner(T - 1, T - 1, -1, -1);
  if (S && W) corner(0, T - 1, 1, -1);
  const notch = (cx: number, cy: number, sx: number, sy: number) => {
    set(cx, cy); set(cx + sx, cy); set(cx, cy + sy);
  };
  if (mask & 16) notch(0, 0, 1, 1);
  if (mask & 32) notch(T - 1, 0, -1, 1);
  if (mask & 64) notch(T - 1, T - 1, -1, -1);
  if (mask & 128) notch(0, T - 1, 1, -1);
  return out;
}

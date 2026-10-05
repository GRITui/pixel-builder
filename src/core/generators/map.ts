import { rng, valueNoise, type Rng } from "../rng";
import { emptyTileMap, ensureTile, renderTileMap } from "../tilemap";
import type { StyleKit, TileMap } from "../types";
import { animalGenerator, FARM_SETS } from "./animal";
import { buildingGenerator } from "./building";
import { environmentGenerator, environmentIdle, treeHeight } from "./environment";
import { colorIndex, decodeIndex } from "../palette";
import { Painter } from "../painter";
import { finalize } from "../enforce";
import { blit, createSprite } from "../sprite";
import { foliageGenerator } from "./foliage";
import { applyGroundDetail, DETAIL_LEVELS } from "./map-detail";
import { FOREST_SEASONS, forestMmoPlan } from "./map-forest";
import type { Sprite } from "../types";
import { bool, defaults, num, str, type Generator, type GenResult, type Params } from "./types";
import { lightMap, TIMES } from "../lighting";

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

export const BIOMES = ["meadow", "forest", "island", "desert", "winter", "rice-village", "farm", "forest-mmo"] as const;
type Biome = (typeof BIOMES)[number];
export type Ground = "grass" | "dirt" | "sand" | "water" | "stone-path" | "snow" | "paddy" | "tilled-soil" | "watered-soil";

const SOLID_PROPS = new Set(["oak", "pine", "palm", "dead-tree", "rock", "boulder", "crystal", "stump", "old-oak"]);
/** Props taller/wider than a tile that shouldn't be clipped by the map edge or stacked side by side. */
const BIG_PROPS = new Set(["oak", "pine", "palm", "dead-tree", "boulder", "old-oak"]);

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
  // fields, pen and yard are reserved, so these only grow in the margins
  farm: {
    grass: { oak: 3, pine: 1.5, bush: 3, flowers: 4, "tall-grass": 3, rock: 1, mushroom: 0.3 },
    sand: { rock: 1 },
  },
  // laid out by forestMmoPlan (HD foliage trees and grouped props), not scattered
  "forest-mmo": {},
};
const FARM_SEA_PROPS: Weights = {
  grass: { palm: 4, bush: 3, flowers: 3, "tall-grass": 4, rock: 1 },
  sand: { palm: 2, rock: 1 },
};

/** Chance (before density and clumping) that a free cell gets a prop. */
const BASE_CHANCE: Record<Biome, number> = { meadow: 0.22, forest: 0.55, island: 0.3, desert: 0.14, winter: 0.3, "rice-village": 0.2, farm: 0.22, "forest-mmo": 0.5 };
const BASE_GROUND: Record<Biome, Ground> = { meadow: "grass", forest: "grass", island: "grass", desert: "sand", winter: "snow", "rice-village": "grass", farm: "grass", "forest-mmo": "grass" };
const PATH_GROUND: Record<Biome, Ground> = { meadow: "dirt", forest: "dirt", island: "dirt", desert: "dirt", winter: "stone-path", "rice-village": "dirt", farm: "dirt", "forest-mmo": "dirt" };
const VARIANTS = 6;
/** Which ground spreads over which at a seam (higher wins); water uses shoreTile instead. */
const BLEND_PRIORITY: Record<Ground, number> = { water: -1, paddy: 0, "tilled-soil": 0.5, "watered-soil": 0.5, dirt: 1, "stone-path": 1, sand: 2, grass: 3, snow: 4 };
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

// ---------------------------------------------------------------- farm biome

type FarmAnimal = { i: number; species: string; age: "adult" | "baby"; dir: string };
type FarmPlan = {
  ground: Ground[];
  path: Set<number>;
  /** Cells nothing random may grow on: buildings, yards, fields, pen, pond. */
  reserved: Set<number>;
  buildings: { i: number; style: string; sp: Sprite }[];
  /** Fence cells; value true = gate (walkable). */
  fences: Map<number, boolean>;
  animals: FarmAnimal[];
  oak: number;
};

function animalSprite(kit: StyleKit, species: string, age: string, dir: string): Sprite {
  return cachedSprite(kit, `animal:${species}:${age}:${dir}`, () => {
    const ar = animalGenerator.generate({ ...defaults(animalGenerator), species, age }, kit, 0).rows;
    return (ar.find((x) => x.name === `idle-${dir}`) ?? ar[0]).frames[0];
  });
}

/** Fence piece for a cell from which of its four neighbours are fence. */
function fencePiece(has: (dx: number, dy: number) => boolean): string {
  const n = has(0, -1), e = has(1, 0), s = has(0, 1), w = has(-1, 0);
  const c = +n + +e + +s + +w;
  if (c === 4) return "cross";
  if (c === 3) return !s ? "t-n" : !w ? "t-e" : !n ? "t-s" : "t-w";
  if (c === 2) return n && s ? "v" : e && w ? "h" : `corner-${n ? "n" : "s"}${e ? "e" : "w"}`;
  if (c === 1) return n || s ? "v" : "h";
  return "post";
}

/**
 * Farmstead layout: buildings in a row along the top (placed by real sprite footprint), a dirt
 * yard below them, then lots side by side: fenced crop fields, a fenced animal pen and a pond.
 * Uses its own rng so prop scatter stays independent of layout edits.
 */
function farmPlan(cols: number, rows: number, seed: number, sea: boolean, wantPath: boolean, kit: StyleKit): FarmPlan {
  const T = kit.sizes.tile;
  const fr = rng((seed ^ 0xfa12) >>> 0);
  const at = (x: number, y: number) => y * cols + x;
  const ground: Ground[] = new Array(cols * rows).fill("grass");
  const path = new Set<number>(), reserved = new Set<number>(), fences = new Map<number, boolean>();
  const buildings: FarmPlan["buildings"] = [];
  const animals: FarmAnimal[] = [];
  const area = cols * rows;
  const variant = (seed >>> 0) % HOUSE_VARIANTS;
  const sprite = (style: string, extra: Record<string, string | number | boolean>) =>
    cachedSprite(kit, `farm:${style}:${JSON.stringify(extra)}:${variant}`, () => buildingGenerator.generate({ ...defaults(buildingGenerator), style, ...extra }, kit, variant).rows[0].frames[0]);
  const ext = (sp: Sprite) => ({ e: Math.ceil((sp.w / 2 - T / 2) / T), up: Math.ceil(sp.h / T) - 1 });

  // --- buildings ---
  const houseSize = area < 500 ? "small" : area < 1000 ? "medium" : "large";
  const big = area >= 600;
  const barnExtra = { ...(sea ? { wall: "wood", trim: "wood", roof: "metal", roof_style: "corrugated" } : { wall: "cloth2", trim: "sand" }), size: big ? "large" : "small" };
  const houseStyle = sea ? (cols >= 30 ? "half-brick" : "stilt-house") : "farmhouse";
  const houseExtra: Record<string, string> = sea ? (houseStyle === "stilt-house" ? { access: "stairs" } : {}) : { size: houseSize };
  let items = [
    { style: houseStyle, sp: sprite(houseStyle, houseExtra) },
    { style: "barn", sp: sprite("barn", barnExtra) },
    { style: "coop", sp: sprite("coop", { size: big ? "large" : "small" }) },
  ];
  const span = (l: typeof items) => l.reduce((a, b) => a + 2 * ext(b.sp).e + 1, 0) + 2 * (l.length - 1);
  while (items.length > 1 && span(items) > cols - 2) items = items.slice(0, -1);
  if (span(items) > cols - 2) items = [{ style: "stilt-house", sp: sprite("stilt-house", { access: "stairs" }) }];
  for (let k = items.length - 1; k > 0; k--) { const j = fr.int(0, k); [items[k], items[j]] = [items[j], items[k]]; }
  const yb0 = Math.max(...items.map((b) => ext(b.sp).up)) + 1;
  let cx = 1 + Math.floor(fr.next() * (cols - 2 - span(items) + 1));
  const doors: { x: number; y: number }[] = [];
  let maxYb = 0;
  for (const b of items) {
    const { e, up } = ext(b.sp);
    cx += e;
    const yb = Math.min(rows - 4, b.style === "coop" ? yb0 + 1 : yb0);
    buildings.push({ i: at(cx, yb), style: b.style, sp: b.sp });
    for (let y = yb - up; y <= yb; y++) for (let x = cx - e; x <= cx + e; x++) if (y >= 0) reserved.add(at(x, y));
    doors.push({ x: cx, y: yb });
    maxYb = Math.max(maxYb, yb);
    cx += e + 3;
  }

  // --- lots: fields, pen, pond ---
  const sy = Math.min(rows - 3, maxYb + 2);
  const lots: { kind: string; x0: number; x1: number; y0: number; y1: number; gx: number }[] = [];
  const dirt = (x: number, y: number) => { if (x < 0 || y < 0 || x >= cols || y >= rows) return; ground[at(x, y)] = "dirt"; path.add(at(x, y)); };
  const ytMin = sy + 2, H = rows - 1 - ytMin;
  const KINDS = ["field", "pen", "pond", "field", "field"];
  const MIN: Record<string, number> = { field: 6, pen: 7, pond: 4 }, CAP: Record<string, number> = { field: 11, pen: 10, pond: 9 };
  let n = 0, need = 0;
  while (H >= 5 && n < KINDS.length) {
    const w = MIN[KINDS[n]] + (n ? 2 : 0);
    if (need + w > cols - 2) break;
    need += w; n++;
  }
  const order = KINDS.slice(0, n);
  for (let k = order.length - 1; k > 0; k--) { const j = fr.int(0, k); [order[k], order[j]] = [order[j], order[k]]; }
  const widths = order.map((k) => MIN[k]);
  let spare = cols - 2 - need;
  for (let grew = true; grew && spare > 0; ) {
    grew = false;
    for (let k = 0; k < widths.length && spare > 0; k++) if (widths[k] < CAP[order[k]]) { widths[k]++; spare--; grew = true; }
  }
  let lx = 1 + Math.floor(fr.next() * (spare + 1));
  order.forEach((kind, k) => {
    const w = widths[k];
    const yt = ytMin + (kind !== "pond" && H >= 6 ? fr.int(0, 1) * 2 : 0);
    const h = Math.min(rows - 1 - yt, fr.int(5, 9));
    lots.push({ kind, x0: lx, x1: lx + w - 1, y0: yt, y1: yt + h - 1, gx: lx + 1 + fr.int(0, w - 3) });
    lx += w + 2;
  });

  // --- yard strip and connectors ---
  const xs = [...doors.map((d) => d.x), ...lots.filter((l) => l.kind !== "pond").map((l) => l.gx)];
  const sx0 = wantPath ? 0 : Math.min(...xs), sx1 = wantPath ? cols - 1 : Math.max(...xs);
  for (let x = sx0; x <= sx1; x++) { dirt(x, sy); dirt(x, sy + 1); }
  for (const d of doors) for (let y = d.y + 1; y < sy; y++) dirt(d.x, y);
  // the fronts of the buildings stay clear so props never hide the doors
  for (const d of doors) for (let y = d.y + 1; y <= sy + 1; y++) for (let x = d.x - 2; x <= d.x + 2; x++) if (x >= 1 && x < cols - 1) reserved.add(at(x, y));

  const pondNoise = valueNoise((seed ^ 0x70d1) >>> 0, 16);
  const soilOff = fr.int(0, 1);
  lots.forEach((l, k) => {
    const inner: number[] = [];
    for (let y = l.y0; y <= l.y1; y++) for (let x = l.x0; x <= l.x1; x++) { reserved.add(at(x, y)); if (x > l.x0 && x < l.x1 && y > l.y0 && y < l.y1) inner.push(at(x, y)); }
    if (l.kind === "pond") {
      const w = l.x1 - l.x0 + 1, h = l.y1 - l.y0 + 1;
      const px = (l.x0 + l.x1) / 2 + 0.5, py = (l.y0 + l.y1) / 2 + 0.5;
      const rx = (w - 2) / 2, ry = Math.min((h - 2) / 2, rx * 0.8);
      for (let y = l.y0; y <= l.y1; y++) for (let x = l.x0; x <= l.x1; x++) {
        const d = Math.hypot((x + 0.5 - px) / rx, (y + 0.5 - py) / ry) + (pondNoise(x / 2.5, y / 2.5) - 0.5) * 0.5;
        if (d < 1) ground[at(x, y)] = "water";
      }
      for (let y = l.y0; y <= l.y1; y++) for (let x = l.x0; x <= l.x1; x++) {
        if (ground[at(x, y)] !== "grass") continue;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (ground[at(x + dx, y + dy)] === "water") ground[at(x, y)] = "sand";
      }
      return;
    }
    for (let y = l.y0; y <= l.y1; y++) for (let x = l.x0; x <= l.x1; x++)
      if (x === l.x0 || x === l.x1 || y === l.y0 || y === l.y1) fences.set(at(x, y), false);
    fences.set(at(l.gx, l.y0), true);
    for (let y = sy + 2; y < l.y0; y++) dirt(l.gx, y);
    if (l.kind === "field") {
      const watered = k % 2 === 0;
      for (const i of inner) {
        const y = Math.floor(i / cols);
        ground[i] = watered && (((y - l.y0 + soilOff) >> 1) & 1) ? "watered-soil" : "tilled-soil";
      }
      return;
    }
    // pen: animals from the setting's list (never the pets, hens or fish), a baby or two among them
    const set = FARM_SETS[sea ? "sea" : "normal"] as readonly string[];
    const stock = set.filter((s) => !["dog", "cat", "chicken", "fish"].includes(s));
    const seq: [string, "adult" | "baby"][] = [[stock[0], "adult"], [stock[1], "adult"], [stock[0], "baby"], [stock[0], "adult"], [stock[1], "baby"], [stock[1], "adult"]];
    const cand = inner.filter((i) => Math.floor(i / cols) >= l.y0 + 2 || l.y1 - l.y0 < 4);
    for (const [species, age] of seq) {
      if (!cand.length) break;
      for (let tries = 0; tries < 12; tries++) {
        const i = cand[fr.int(0, cand.length - 1)];
        const x = i % cols, y = Math.floor(i / cols);
        const dist = species === "cow" || species === "water-buffalo" ? 3 : 2;
        if (animals.some((a) => Math.abs((a.i % cols) - x) < dist && Math.abs(Math.floor(a.i / cols) - y) < 2)) continue;
        animals.push({ i, species, age, dir: ["down", "left", "right"][fr.int(0, 2)] });
        break;
      }
    }
  });

  // --- yard animals: hens and a chick by the coop, the dog and cat by the house ---
  const putYard = (b: { i: number; sp: Sprite } | undefined, species: string, age: "adult" | "baby") => {
    if (!b) return;
    const { e } = ext(b.sp), bx = b.i % cols, by = Math.floor(b.i / cols);
    const free: number[] = [];
    for (let y = by + 1; y <= sy + 1; y++) for (let x = bx - e; x <= bx + e; x++) {
      const i = at(x, y);
      if (x >= 1 && x < cols - 1 && x !== bx && !animals.some((a) => Math.abs((a.i % cols) - x) < 2 && Math.floor(a.i / cols) === y)) free.push(i);
    }
    if (free.length) animals.push({ i: free[fr.int(0, free.length - 1)], species, age, dir: ["down", "left", "right"][fr.int(0, 2)] });
  };
  const coopB = buildings.find((b) => b.style === "coop"), houseB = buildings.find((b) => b.style !== "barn" && b.style !== "coop");
  putYard(coopB, "chicken", "adult"); putYard(coopB, "chicken", "adult"); putYard(coopB, "chicken", "baby");
  putYard(houseB, "dog", "adult"); putYard(houseB, "cat", "adult");

  // keep every animal's whole sprite on the map (>= 1 tile from the edge)
  const inland = animals.filter((a) => {
    const sp = animalSprite(kit, a.species, a.age, a.dir);
    const m = Math.max(1, Math.ceil((sp.w / 2 - T / 2) / T));
    const x = a.i % cols, y = Math.floor(a.i / cols);
    return x >= m && x < cols - m && y >= 1 && y < rows - 1;
  });

  // --- landmark old oak: first free spot, away from everything planned ---
  const oakSp = cachedSprite(kit, "farm:old-oak", () => environmentIdle({ ...defaults(environmentGenerator), kind: "old-oak" }, kit, 0));
  const { e: oe, up: ou } = ext(oakSp);
  let oak = -1;
  const spots: number[] = [];
  for (let y = ou; y < rows - 1; y++) for (let x = oe + 1; x < cols - oe - 1; x++) spots.push(at(x, y));
  for (let k = spots.length - 1; k > 0; k--) { const j = fr.int(0, k); [spots[k], spots[j]] = [spots[j], spots[k]]; }
  for (const i of spots) {
    const x = i % cols, y = Math.floor(i / cols);
    let ok = ground[i] === "grass";
    for (let dy = -ou; ok && dy <= 1; dy++) for (let dx = -oe - 1; dx <= oe + 1; dx++) {
      const j = at(x + dx, y + dy);
      if (y + dy >= rows || reserved.has(j) || path.has(j) || ground[j] === "water" || (dy >= 0 && ground[j] !== "grass")) { ok = false; break; }
    }
    if (!ok) continue;
    oak = i;
    for (let dy = -ou; dy <= 0; dy++) for (let dx = -oe; dx <= oe; dx++) reserved.add(at(x + dx, y + dy));
    break;
  }
  for (const a of inland) reserved.add(a.i);
  return { ground, path, reserved, buildings, fences, animals: inland, oak };
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
  description: "Procedural top-down tile map (meadow, forest, island, desert, winter, rice-village with flooded paddies, farm with fenced fields, barn, pen and pond in a normal or sea set) built from the kit's ground tiles and props.",
  params: [
    { key: "biome", label: "Biome", type: "select", options: [...BIOMES], default: "meadow" },
    { key: "cols", label: "Columns", type: "number", min: 12, max: 48, step: 1, default: 24 },
    { key: "rows", label: "Rows", type: "number", min: 12, max: 48, step: 1, default: 20 },
    { key: "density", label: "Prop density", type: "number", min: 0, max: 1, step: 0.05, default: 0.5 },
    { key: "path", label: "Winding path", type: "bool", default: true },
    { key: "set", label: "Farm set (farm biome only)", type: "select", options: ["normal", "sea"], default: "normal" },
    { key: "water_depth", label: "Water depth (smooth shallow-to-abyss gradient, sandy shore banks, lily pads, reeds)", type: "bool", default: false },
    { key: "river", label: "River (a winding river across meadow / forest / winter maps)", type: "bool", default: false },
    { key: "detail", label: "Ground detail (tufts, petals, pebbles, leaf litter, colour variation; any biome)", type: "select", options: [...DETAIL_LEVELS], default: "off" },
    { key: "season", label: "Tree season (forest-mmo only; mixed = oak, maple, birch, willow groves)", type: "select", options: [...FOREST_SEASONS], default: "mixed" },
    { key: "lighting", label: "Lighting (cast shadows, dappled light, water reflections, time-of-day grade; palette-locked)", type: "select", options: ["off", "on"], default: "off" },
    { key: "time", label: "Time of day (needs lighting on)", type: "select", options: [...TIMES], default: "day" },
  ],
  generate(p, kit: StyleKit, seed) {
    const res = generateMap(p, kit, seed);
    if (str(p, "lighting") !== "on" || !res.tilemap) return res;
    const time = (TIMES as readonly string[]).includes(str(p, "time")) ? (str(p, "time") as (typeof TIMES)[number]) : "day";
    const lit = lightMap(res.rows[0].frames[0], res.tilemap, kit, { time, seed: seed >>> 0 });
    return { ...res, rows: [{ name: "map", frames: [lit] }] };
  },
};

function generateMap(p: Params, kit: StyleKit, seed: number): GenResult {
  {
    const biome = ((BIOMES as readonly string[]).includes(str(p, "biome")) ? str(p, "biome") : "meadow") as Biome;
    const cols = clamp(Math.round(num(p, "cols")) || 24, 12, 48);
    const rows = clamp(Math.round(num(p, "rows")) || 20, 12, 48);
    const density = clamp(Number.isFinite(num(p, "density")) ? num(p, "density") : 0.5, 0, 1);
    const wantPath = bool(p, "path");
    const sea = str(p, "set") === "sea";
    const T = kit.sizes.tile;
    const r = rng(seed >>> 0);
    const envDefaults = defaults(environmentGenerator);
    const detail = str(p, "detail") || "off";
    if (biome === "forest-mmo") return forestMmo(cols, rows, density, wantPath, str(p, "season"), detail, kit, seed >>> 0);

    const tm: TileMap = emptyTileMap(cols, rows, T);
    const farm = biome === "farm" ? farmPlan(cols, rows, seed >>> 0, sea, wantPath, kit) : null;
    const { ground, path } = farm ?? buildGround(biome, cols, rows, seed >>> 0, r, wantPath);

    if (bool(p, "river") && (biome === "meadow" || biome === "forest" || biome === "winter")) carveRiver(ground, cols, rows, seed >>> 0, new Set(path), biome === "winter");
    const waterDepth = bool(p, "water_depth");
    paintGround(tm, ground, kit, seed, r, { waterDepth });

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
    const reserved = farm ? farm.reserved : new Set<number>();
    if (farm && chance0 > 0) {
      farm.buildings.forEach((b, n) => { tm.deco[b.i] = ensureTile(tm, `${b.style}-${n}`, b.sp, true); });
      const fenceSprites = new Map<string, Sprite>();
      for (const [i, gate] of farm.fences) {
        const x = i % cols, y = Math.floor(i / cols);
        const piece = gate ? "gate-closed" : fencePiece((dx, dy) => farm.fences.has((y + dy) * cols + x + dx) && x + dx >= 0 && x + dx < cols);
        let sp = fenceSprites.get(piece);
        if (!sp) fenceSprites.set(piece, (sp = environmentIdle({ ...envDefaults, kind: "fence", piece }, kit, seed)));
        tm.deco[i] = ensureTile(tm, `fence-${piece}`, sp, !gate);
      }
      for (const a of farm.animals) tm.deco[a.i] = ensureTile(tm, `${a.species}${a.age === "baby" ? "-baby" : ""}-${a.dir}`, animalSprite(kit, a.species, a.age, a.dir), false);
      if (farm.oak >= 0) tm.deco[farm.oak] = propTile("old-oak", 0);
    }
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
        let i = free.splice(hr.int(0, free.length - 1), 1)[0];
        // never on the map border: swap for a random inland cell (only draws when it was on the edge)
        if (i % cols < 1 || i % cols > cols - 2 || i < cols || i >= cols * (rows - 1)) {
          const inland = free.filter((j) => j % cols >= 1 && j % cols <= cols - 2 && j >= cols && j < cols * (rows - 1));
          if (!inland.length) continue;
          i = inland[hr.int(0, inland.length - 1)];
          free.splice(free.indexOf(i), 1);
        }
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
        const table = (biome === "farm" && sea ? FARM_SEA_PROPS : PROPS[biome])[g];
        if (!table) continue;
        if (roll >= chance0 * (0.35 + 1.3 * clump(x / 3, y / 3))) continue;
        const kind = pickWeighted(table, pickRoll);
        if (BIG_PROPS.has(kind)) {
          if (biome === "farm") {
            // trees frame the farm: mostly near the border, never in front of or over anything planned
            const edge = Math.min(x, y, cols - 1 - x, rows - 1 - y);
            if (edge > 4 && (pickRoll * 53) % 1 > 0.2) continue;
            const up = bigRowsOf(kind);
            let blocked = false;
            for (let d = 0; d <= up + 1 && !blocked; d++) for (let dx = -1; dx <= 1; dx++) {
              const j = (y - d) * cols + x + dx;
              if (y - d >= 0 && x + dx >= 0 && x + dx < cols && (reserved.has(j) || path.has(j))) { blocked = true; break; }
            }
            if (blocked) continue;
          }
          if (y < bigRowsOf(kind) || (wide && (x < 1 || x > cols - 2))) continue;
          if (biome === "rice-village" && [1, 2].some((d) => y >= d && BIG_PROPS.has(tmKind(tm, tm.deco[i - d * cols])))) continue;
          if (biome === "rice-village" && [0, 1, 2].some((d) => y >= d && [-1, 0, 1].some((dx) => ground[(y - d) * cols + Math.max(0, Math.min(cols - 1, x + dx))] === "paddy"))) continue;
          if (biome !== "forest" && x > 0 && BIG_PROPS.has(tmKind(tm, tm.deco[i - 1]))) continue;
        }
        tm.deco[i] = propTile(kind, vRoll);
      }
    if (waterDepth) decorateWater(tm, ground, path, reserved, propTile, seed >>> 0, biome);
    if (detail !== "off") applyGroundDetail(tm, kit, seed >>> 0, detail);
    return { rows: [{ name: "map", frames: [renderTileMap(tm)] }], fps: 1, tilemap: tm };
  }
}

/**
 * Fill `tm.ground` from a ground-type grid: textured kit tiles with blended edges between
 * grounds and foam-rimmed shores. Exported so hand-laid scenes get the same transitions as maps.
 */
export function paintGround(tm: TileMap, ground: Ground[], kit: StyleKit, seed: number, r: Rng = rng(seed >>> 0), opts: { waterDepth?: boolean; smooth?: boolean } = {}): void {
  const { cols, rows } = tm;
  const depthOf = opts.waterDepth ? waterDepthField(ground, cols, rows) : null;
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
  // depth-shaded water (opt-in): one sprite per depth band, bands blended with the land-seam shapes
  const depthSprite = (d: number): Sprite => {
    const name = `water-d${d}`;
    let sp = spriteCache.get(name);
    if (!sp) {
      sp = environmentGenerator.generate({ ...envDefaults, kind: "water-tile", depth: d }, kit, seed).rows[0].frames[0];
      spriteCache.set(name, sp);
    }
    return sp;
  };
  const isWater = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows && ground[y * cols + x] === "water";
  const depthTile = (i: number): number => {
    const x = i % cols, y = Math.floor(i / cols), d = depthOf![i];
    const layers: { sprite: Sprite; mask: number }[] = [];
    for (let h = d + 1; h < WATER_BANDS; h++) {
      let m = 0;
      NEIGHBOURS.forEach(([dx, dy], k) => {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < cols && yy < rows && depthOf![yy * cols + xx] >= h) m |= 1 << k;
      });
      if (m) layers.push({ sprite: depthSprite(h), mask: m });
    }
    const name = `water-d${d}${layers.map((l, n) => `-${d + 1 + n}:${l.mask}`).join("")}`;
    let idx = tileCache.get(name);
    if (idx === undefined) {
      idx = ensureTile(tm, name, layers.length ? blendDepth(depthSprite(d), layers) : depthSprite(d), true);
      tileCache.set(name, idx);
    }
    return idx;
  };
  // smooth depth (opt-in): bands follow the true distance to the shore per pixel, wobble with noise and
  // dither into each other, so the river deepens in curves instead of tile-sized steps
  const warp = valueNoise((seed ^ 0x5b31) >>> 0, 16);
  const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const BAND_AT = [0.7, 1.6, 2.55];
  const smoothWaterTile = (i: number): number => {
    const T = tm.tile, cx = i % cols, cy = Math.floor(i / cols);
    const land: [number, number][] = [];
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const x = cx + dx, y = cy + dy; if (x >= 0 && y >= 0 && x < cols && y < rows && !isWater(x, y)) land.push([x, y]); }
    const sp = createSprite(T, T);
    const used = new Set<number>();
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) {
        const px = cx * T + x + 0.5, py = cy * T + y + 0.5;
        let d = 5 * T;
        for (const [lx, ly] of land) {
          const ex = Math.max(lx * T - px, 0, px - (lx * T + T)), ey = Math.max(ly * T - py, 0, py - (ly * T + T));
          d = Math.min(d, Math.hypot(ex, ey));
        }
        const a = (d + 0.17 * T) / T + (warp(px / (T * 1.4), py / (T * 1.4)) - 0.5) * 0.55 + (BAYER4[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * 0.24;
        const b = BAND_AT.filter((t) => a > t).length;
        used.add(b);
        sp.data[y * T + x] = depthSprite(b).data[y * T + x];
      }
    const only = used.size === 1 ? [...used][0] : -1;
    return ensureTile(tm, only >= 0 ? `water-d${only}` : `water-s${cx}-${cy}`, only >= 0 ? depthSprite(only) : sp, true);
  };
  // Seeded value noise picks the texture variant so repeats form no visible lattice.
  const vNoise = valueNoise((seed ^ 0x7f31) >>> 0, 16);
  for (let i = 0; i < ground.length; i++) {
    const g = ground[i];
    const x = i % cols, y = Math.floor(i / cols);
    const rr = r.next(), rv = r.int(1, VARIANTS - 1);
    const v = rr < 0.4 ? 0 : (rv + Math.floor(vNoise(x / 2, y / 2) * VARIANTS)) % VARIANTS;
    if (g === "water" && depthOf) { tm.ground[i] = opts.smooth ? smoothWaterTile(i) : depthTile(i); continue; }
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
      const all = [...layers.map((l) => ({ sprite: baseSprite(l.g, sv), mask: l.mask })), ...(wmask ? [{ sprite: depthOf ? depthSprite(0) : baseSprite("water", 0), mask: wmask, foam: true }] : [])];
      const sp = blendTile(baseSprite(g, sv), all);
      if (depthOf && wmask) wetBank(sp, wmask);
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
export function edgeShape(T: number, mask: number): Uint8Array {
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
export function blendTile(base: Sprite, layers: { sprite: Sprite; mask: number; foam?: boolean }[]): Sprite {
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

// ---------- water depth (opt-in) ----------

const WATER_BANDS = 4;

/**
 * Depth band 0..3 of every water cell (others 0): distance to the nearest non-water cell, so a
 * shore cell is shallow (0) and the middle of a wide lake is abyss (3). Cells beyond the map
 * edge count as water, so a sea running off the map stays deep. 8-neighbour BFS, O(cells).
 */
export function waterDepthField(ground: Ground[], cols: number, rows: number): Uint8Array {
  const dist = new Int16Array(cols * rows).fill(-1);
  const queue: number[] = [];
  ground.forEach((g, i) => { if (g !== "water") { dist[i] = 0; queue.push(i); } });
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head], x = i % cols, y = Math.floor(i / cols);
    for (const [dx, dy] of NEIGHBOURS) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
      const j = yy * cols + xx;
      if (dist[j] < 0) { dist[j] = dist[i] + 1; queue.push(j); }
    }
  }
  const out = new Uint8Array(cols * rows);
  for (let i = 0; i < out.length; i++) out[i] = ground[i] === "water" ? Math.min(WATER_BANDS - 1, Math.max(0, dist[i] - 1)) : 0;
  return out;
}

/**
 * Paint a ground grid with depth-shaded water: shallow sandy shallows at the shore blending
 * through medium and deep to abyss, foam rims and a wet sand bank on the land side. Same as
 * `paintGround(..., { waterDepth: true })`; exported for hand-laid scenes and biome builders.
 */
export function paintWaterDepth(tm: TileMap, ground: Ground[], kit: StyleKit, seed: number, r: Rng = rng(seed >>> 0)): void {
  paintGround(tm, ground, kit, seed, r, { waterDepth: true });
}

/** `base` with each deeper band spreading in along the land-seam shapes; the seam is dithered (no hard line). */
function blendDepth(base: Sprite, layers: { sprite: Sprite; mask: number }[]): Sprite {
  const T = base.w, W = T + 2;
  const out = createSprite(T, T);
  out.data = base.data.slice();
  for (const { sprite, mask } of layers) {
    const shape = edgeShape(T, mask);
    const taken = (x: number, y: number) => shape[(y + 1) * W + x + 1] === 1;
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) {
        if (!taken(x, y)) continue;
        const rim = !taken(x - 1, y) || !taken(x + 1, y) || !taken(x, y - 1) || !taken(x, y + 1);
        if (rim && (x + y) % 2 === 0) continue;
        out.data[y * T + x] = sprite.data[y * T + x];
      }
  }
  return out;
}

/** Wet sand bank: land pixels within 1-3px of the water become damp sand, dark at the waterline. */
function wetBank(sp: Sprite, wmask: number): void {
  const T = sp.w, W = T + 2, shape = edgeShape(T, wmask);
  const dist = new Int8Array(W * W).fill(9);
  const queue: number[] = [];
  for (let i = 0; i < dist.length; i++) if (shape[i] === 1) { dist[i] = 0; queue.push(i); }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head], x = i % W, y = Math.floor(i / W);
    if (dist[i] >= 3) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= W) continue;
      if (dist[yy * W + xx] > dist[i] + 1) { dist[yy * W + xx] = dist[i] + 1; queue.push(yy * W + xx); }
    }
  }
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const d = dist[(y + 1) * W + x + 1];
      if (d === 0 || d > 3) continue;
      if (d === 3 && (x + y) % 2) continue;
      sp.data[y * T + x] = colorIndex("sand", d === 1 ? 1 : 2);
    }
}

/** A winding river across the whole map (left to right), 2-4 tiles wide; the path stays dry (a ford). */
function carveRiver(ground: Ground[], cols: number, rows: number, seed: number, keep: Set<number>, frozen: boolean): void {
  const n = valueNoise((seed ^ 0x71e5) >>> 0, 16), wn = valueNoise((seed ^ 0x3c1) >>> 0, 16);
  const flip = (seed & 1) === 1;
  for (let x = 0; x < cols; x++) {
    const cy = rows * (flip ? 0.62 : 0.38) + (n(x / 6, 0.5) - 0.5) * rows * 0.5 + Math.sin(x / 4.2) * 1.2;
    const half = (2 + 1.8 * wn(x / 5, 1.5)) / 2;
    for (let y = 0; y < rows; y++) if (Math.abs(y + 0.5 - cy) < half && !keep.has(y * cols + x)) ground[y * cols + x] = "water";
  }
  if (frozen) return;
  const was = ground.slice();
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      if (was[y * cols + x] !== "grass") continue;
      for (const [dx, dy] of NEIGHBOURS) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < cols && yy < rows && was[yy * cols + xx] === "water") { ground[y * cols + x] = "sand"; break; }
      }
    }
}

/** Lily pads on the shallows, reeds / rocks / driftwood on the banks. Own rng: the rest of the map is untouched. */
function decorateWater(tm: TileMap, ground: Ground[], path: Set<number>, reserved: Set<number>, propTile: (kind: string, v: number) => number, seed: number, biome: Biome): void {
  const { cols, rows } = tm;
  const dep = waterDepthField(ground, cols, rows);
  const hr = rng((seed ^ 0xa11e) >>> 0);
  const clump = valueNoise((seed ^ 0x77d1) >>> 0, 16);
  for (let i = 0; i < ground.length; i++) {
    const x = i % cols, y = Math.floor(i / cols);
    const roll = hr.next(), pick = hr.next(), v = hr.int(0, 2);
    if (tm.deco[i] >= 0 || path.has(i) || reserved.has(i)) continue;
    if (ground[i] === "water") {
      if (dep[i] <= 1 && roll < 0.04 + 0.22 * clump(x / 2.5, y / 2.5) ** 2) tm.deco[i] = propTile("lily-pad", v);
      else if (dep[i] === 0 && roll > 0.97) tm.deco[i] = propTile("river-rock", v);
      continue;
    }
    if (ground[i] !== "grass" && ground[i] !== "sand" && ground[i] !== "dirt") continue;
    let wet = false;
    for (const [dx, dy] of NEIGHBOURS) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < cols && yy < rows && ground[yy * cols + xx] === "water") wet = true;
    }
    if (!wet || biome === "winter") continue;
    if (roll < 0.28) tm.deco[i] = propTile(pick < 0.6 ? "reeds" : "cattail", v);
    else if (roll < 0.34) tm.deco[i] = propTile(pick < 0.5 ? "river-rock" : "driftwood", v);
  }
}


// ---------- forest-mmo ----------

export interface MapObject {
  /** index into tm.tiles */
  tile: number;
  name: string;
  /** cell of the base */
  col: number;
  row: number;
  /** pixel x of the base centre and y of the base line (the y-sort key) */
  x: number;
  y: number;
  solid: boolean;
}

/**
 * Deco objects (trees, props) in draw order: sorted by base line, then x. A game draws
 * characters in the same list by their own base y, so they walk behind trunks.
 */
export function mapObjects(tm: TileMap): MapObject[] {
  const out: MapObject[] = [];
  tm.deco.forEach((t, i) => {
    if (t < 0 || !tm.tiles[t]) return;
    const col = i % tm.cols, row = Math.floor(i / tm.cols);
    out.push({ tile: t, name: tm.tiles[t].name, col, row, x: col * tm.tile + tm.tile / 2, y: (row + 1) * tm.tile, solid: !!tm.tiles[t].solid });
  });
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Wooden bridge over the river, painted into the ground tiles of the cells it covers (so walkers are always on top of it). */
function paintBridge(tm: TileMap, b: { x0: number; x1: number; y0: number; y1: number }, kit: StyleKit): void {
  const T = tm.tile, nx = b.x1 - b.x0 + 1, W = nx * T, H = 4 * T;
  const region = createSprite(W, H);
  for (let cy = 0; cy < 4; cy++)
    for (let cx = 0; cx < nx; cx++) {
      const t = tm.tiles[tm.ground[(b.y0 - 1 + cy) * tm.cols + b.x0 + cx]];
      if (t) blit(region, t.sprite, cx * T, cy * T);
    }
  const k = T / 24;
  const R = (n: number) => Math.max(1, Math.round(n * k));
  const top = Math.round(T * 1.1), bot = Math.round(T * 2.9), rail = R(6), x0 = Math.round(T * 0.5), x1 = W - x0;
  // the deck's shadow darkens the water below it (only water pixels)
  for (let y = bot; y < bot + R(4); y++)
    for (let x = x0; x < x1; x++) {
      const d = decodeIndex(region.data[y * W + x]);
      if (d && d.mat === "water") region.data[y * W + x] = colorIndex("water", Math.max(0, d.level - 2));
    }
  const P = new Painter(W, H, kit);
  P.box(x0, top, x1 - x0, bot - top, "wood", [0, -0.15, 1]);
  const pw = Math.max(3, R(6));
  for (let x = x0, n = 0; x < x1; x += pw, n++) {
    if (n % 2) P.box(x, top + rail, Math.min(pw, x1 - x), bot - top - 2 * rail, "wood", [0, -0.15, 1], { tone: -1 });
    if (x > x0) P.rect(x, top + rail, 1, bot - top - 2 * rail, "wood", 0);
  }
  P.box(x0, top, x1 - x0, rail, "wood", [0, -0.6, 0.8], { tone: 1 });
  P.box(x0, bot - rail, x1 - x0, rail, "wood", [0, 0.8, 0.6], { tone: -1 });
  const post = R(5);
  const posts = [x0, x1 - post];
  for (let x = x0 + T * 3; x < x1 - T * 2; x += T * 3) posts.push(x);
  for (const x of posts) {
    P.box(x, top - R(5), post, bot - top + R(7), "wood", [x <= x0 ? -0.5 : 0.5, -0.3, 0.9], { tone: -1 });
    P.px(x + Math.floor(post / 2), top - R(5), "wood", 4);
  }
  blit(region, finalize(P.toSprite(), kit), 0, 0);
  for (let cy = 0; cy < 4; cy++)
    for (let cx = 0; cx < nx; cx++) {
      const i = (b.y0 - 1 + cy) * tm.cols + b.x0 + cx, was = tm.tiles[tm.ground[i]];
      const sp = createSprite(T, T);
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) sp.data[y * T + x] = region.data[(cy * T + y) * W + cx * T + x];
      const deck = cy === 1 || cy === 2;
      if (!deck && was.sprite.data.every((v, k) => v === sp.data[k])) continue;
      // deck rows are walkable; the shadow rows keep the water (or land) they were
      tm.ground[i] = ensureTile(tm, deck ? `bridge-${b.x0 + cx}-${b.y0 - 1 + cy}` : `${was.name}-br${b.x0 + cx}-${b.y0 - 1 + cy}`, sp, deck ? false : was.solid);
    }
}

function forestMmo(cols: number, rows: number, density: number, wantPath: boolean, season: string, detail: string, kit: StyleKit, seed: number) {
  const T = kit.sizes.tile;
  const plan = forestMmoPlan(cols, rows, seed, kit, FOREST_SEASONS.includes(season as never) ? season : "mixed", density, wantPath);
  const tm: TileMap = emptyTileMap(cols, rows, T);
  paintGround(tm, plan.ground, kit, seed, rng(seed), { waterDepth: true, smooth: true });
  if (plan.bridge) paintBridge(tm, plan.bridge, kit);

  const envDefaults = defaults(environmentGenerator);
  const propCache = new Map<string, number>();
  const propTile = (kind: string, v: number): number => {
    const name = `${kind}-${v}`;
    let idx = propCache.get(name);
    if (idx === undefined) {
      const sp = cachedSprite(kit, `prop:${name}:${seed % 7}`, () => environmentIdle({ ...envDefaults, kind, variant: v * 3 + (kind.length % 3) }, kit, seed));
      idx = ensureTile(tm, name, sp, SOLID_PROPS.has(kind));
      propCache.set(name, idx);
    }
    return idx;
  };
  const treeTile = (t: { species: string; size: string; season: string; variant: number }): number => {
    const name = `tree-${t.species}-${t.size}-${t.season}-${t.variant}`;
    const i = tm.tiles.findIndex((x) => x.name === name);
    if (i >= 0) return i;
    const sp = cachedSprite(kit, name, () => foliageGenerator.generate({ ...defaults(foliageGenerator), species: t.species, size: t.size, season: t.season, variant: t.variant }, kit, 1 + t.variant).rows[0].frames[0]);
    return ensureTile(tm, name, sp, true);
  };
  const at = (x: number, y: number) => y * cols + x;
  // props first, trees after (a tree cell is never a prop cell by construction), water props last
  for (const pr of plan.props) tm.deco[at(pr.x, pr.y)] = propTile(pr.kind, pr.v);
  for (const t of plan.trees) tm.deco[at(t.x, t.y)] = treeTile(t);
  const reserved = new Set<number>(plan.canopy);
  for (const s of plan.spawns) reserved.add(at(s.x, s.y));
  for (const c of plan.clearings) for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (Math.hypot((x - c.x) / c.rx, (y - c.y) / c.ry) <= 1) reserved.add(at(x, y));
  if (density > 0) decorateWater(tm, plan.ground, plan.path, reserved, propTile, seed, "forest-mmo");
  if (detail !== "off") {
    const skip = new Set<number>();
    tm.ground.forEach((t, i) => { if (tm.tiles[t]?.name.startsWith("bridge")) skip.add(i); });
    applyGroundDetail(tm, kit, seed, detail, { maples: plan.trees.filter((t) => t.species === "maple-autumn").map((t) => at(t.x, t.y)), skip });
  }
  const objects = mapObjects(tm);
  const meta = {
    biome: "forest-mmo",
    /** monster spawn cells (all walkable) */
    spawns: plan.spawns,
    playerStart: plan.start,
    bridge: plan.bridge,
    /** deco objects in draw order (sort key y = base line); tile index into tm.tiles */
    ysorted: true,
    objects: objects.map((o) => ({ tile: o.tile, name: o.name, col: o.col, row: o.row, x: o.x, y: o.y, solid: o.solid })),
  };
  return { rows: [{ name: "map", frames: [renderTileMap(tm)] }], fps: 1, tilemap: tm, meta };
}

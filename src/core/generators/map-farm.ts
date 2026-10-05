import { finalize } from "../enforce";
import { Painter } from "../painter";
import { rng, valueNoise } from "../rng";
import type { Sprite, StyleKit, TileMap } from "../types";
import { decodeIndex } from "../palette";
import { buildingGenerator } from "./building";
import { CROP_SPECIES, CROP_STAGES, type CropSpecies, type CropStage, cropField } from "./crops";
import { FARM_SETS } from "./animal";
import type { Ground } from "./map";
import { crownOf, treeSizesFor, type PropSpec, type TreeSpec } from "./map-forest";
import { bandLayout, bandRampColumns, type TerrainLayout } from "./map-terrain";
import { defaults } from "./types";

/**
 * Layout of the `farm-mmo` biome: a planned, filled farmstead. Farmhouse, barn and coop in a row with
 * a yard (well, mailbox, garden and flower beds, hay) in the gaps; a dirt road below them that crosses a
 * stream on a bridge; fenced crop fields (rows of mixed growth stages with an irrigation channel), a
 * fenced pen with animals, an orchard and a pond; a woodland edge of HD foliage trees all around.
 * Pure data (no sprites), so it is cheap to test; map.ts paints it.
 */

export const FARM_MMO_VERSION = 1;
export interface FarmBuilding { x: number; y: number; style: string; extra: Record<string, string | number | boolean>; e: number; up: number }
export interface FarmLot { kind: "field" | "pen" | "orchard" | "pond"; x0: number; x1: number; y0: number; y1: number; gx: number }
export interface FarmCrop { x: number; y: number; species: CropSpecies; stage: CropStage; variant: number }
export interface FarmAnimalSpec { x: number; y: number; species: string; age: "adult" | "baby"; dir: string }
export interface FarmNpc { x: number; y: number; role: string; face: "left" | "right" | "up" | "down" }

export interface FarmMmoPlan {
  ground: Ground[];
  /** Dirt road and connectors (including the cells the bridge covers). */
  path: Set<number>;
  bridge: { x0: number; x1: number; y0: number; y1: number } | null;
  buildings: FarmBuilding[];
  lots: FarmLot[];
  /** Fence cells; value true = gate (walkable). */
  fences: Map<number, boolean>;
  animals: FarmAnimalSpec[];
  crops: FarmCrop[];
  trees: TreeSpec[];
  props: PropSpec[];
  /** Where villagers can stand to work: role, cell and the way they face. */
  spawns: FarmNpc[];
  start: { x: number; y: number };
  /** Cells covered by a tree crown (excluding the trunk cell). */
  canopy: Set<number>;
  /** Irrigation channel cells (shallow water inside the fields). */
  channels: Set<number>;
  /** Cells nothing random may be placed on (buildings, yard, lots, road). */
  reserved: Set<number>;
  terrain?: TerrainLayout;
  /** Seed-derived building variant (cache key for the building sprites). */
  variant: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Props this biome draws itself (not from the environment generator). */
export const FARM_PROP_KINDS = ["well", "mailbox", "hay-bale", "scarecrow", "trough"] as const;
/** Props nothing can walk through. */
export const FARM_SOLID = new Set<string>(["well", "hay-bale", "scarecrow", "trough", "mailbox"]);

// ---------------------------------------------------------------- sprites

const cache = new WeakMap<StyleKit, Map<string, Sprite>>();
function memo(kit: StyleKit, key: string, make: () => Sprite): Sprite {
  let m = cache.get(kit);
  if (!m) cache.set(kit, (m = new Map()));
  let s = m.get(key);
  if (!s) m.set(key, (s = make()));
  return { ...s, data: s.data.slice() };
}

export function farmBuildingSprite(kit: StyleKit, style: string, extra: Record<string, string | number | boolean>, variant: number): Sprite {
  return memo(kit, `farm-mmo:${style}:${JSON.stringify(extra)}:${variant}`, () => buildingGenerator.generate({ ...defaults(buildingGenerator), style, ...extra }, kit, variant).rows[0].frames[0]);
}

/** The yard props that no other generator has, painted with the lit Painter so they share the kit's light. */
export function farmPropSprite(kit: StyleKit, kind: string, v = 0): Sprite {
  return memo(kit, `farm-prop:${kind}:${v % 3}`, () => {
    const T = kit.sizes.tile, k = T / 16, R = (n: number) => Math.max(1, Math.round(n * k));
    const W = R(kind === "well" ? 20 : kind === "hay-bale" ? 18 : kind === "trough" ? 18 : 16);
    const H = R(kind === "well" ? 24 : kind === "mailbox" ? 17 : kind === "scarecrow" ? 28 : kind === "hay-bale" ? 14 : 11);
    const P = new Painter(W, H, kit);
    const cx = W / 2;
    if (kind === "well") {
      // stone drum with a dark water mouth, two posts, a small roof and a crank beam
      P.cylinder(R(2), R(13), W - R(4), R(9), "stone", { tone: 0 });
      P.ellipse(cx, R(13), (W - R(4)) / 2, R(3), "stone", { tone: 1, flat: 0.5 });
      P.ellipse(cx, R(13), (W - R(8)) / 2, R(2), "water", { tone: -2, flat: 0.6 });
      for (let x = R(3); x < W - R(3); x += R(4)) P.rect(x, R(17), 1, R(4), "stone", 1);
      P.box(R(3), R(5), R(2), R(9), "wood", [-0.5, 0, 0.9], { tone: -1 });
      P.box(W - R(5), R(5), R(2), R(9), "wood", [0.5, 0, 0.9], { tone: -1 });
      P.box(R(3), R(7), W - R(6), R(1), "wood", [0, -0.3, 0.9], { tone: 1 });
      P.poly([[R(1), R(6)], [cx, R(0.5)], [W - R(1), R(6)]], "roof", [0, -0.6, 0.8]);
      P.poly([[R(1), R(6)], [W - R(1), R(6)], [W - R(2), R(7.5)], [R(2), R(7.5)]], "roof", [0, 0.5, 0.8], { tone: -1 });
      P.rect(Math.round(cx), R(8), 1, R(5), "wood", 0);
      P.box(Math.round(cx) - R(1), R(11), R(2), R(2), "wood", [0, 0, 1], { tone: 1 });
    } else if (kind === "mailbox") {
      P.box(Math.round(cx) - 1, R(7), R(2), R(9), "wood", [0, 0, 1], { tone: -1 });
      P.ellipse(cx, R(5), R(5.5), R(3.2), "cloth2", { flat: 0.3 });
      P.box(Math.round(cx - R(5.5)), R(5), R(11), R(3), "cloth2", [0, 0.4, 0.9], { tone: -1 });
      P.rect(Math.round(cx + R(4)), R(0), 1, R(5), "wood", 2);
      P.rect(Math.round(cx + R(4)) + 1, R(0), R(2), R(2), "cloth", 3);
      P.rect(Math.round(cx - R(2)), R(6), R(3), 1, "ui", 4);
    } else if (kind === "hay-bale") {
      // a round bale lying on its side: golden drum with two straw ties
      P.cylinder(R(1), R(3), W - R(2), R(10), "gold", { tone: v % 2 });
      P.ellipse(R(2.5), R(8), R(2), R(5), "gold", { tone: 1, flat: 0.4 });
      P.ellipse(W - R(2.5), R(8), R(2), R(5), "gold", { tone: -1, flat: 0.4 });
      P.rect(R(6), R(3), 1, R(10), "wood", 2);
      P.rect(W - R(7), R(3), 1, R(10), "wood", 2);
      for (let x = R(4); x < W - R(4); x += R(3)) P.px(x, R(5 + (x % 3)), "sand", 3);
    } else if (kind === "scarecrow") {
      P.box(Math.round(cx) - 1, R(8), R(2), R(19), "wood", [0, 0, 1], { tone: -1 });
      P.box(R(1), R(11), W - R(2), R(2), "wood", [0, -0.3, 0.9]);
      P.box(R(3), R(11), W - R(6), R(7), "cloth", [0, 0, 1], { tone: 0 });
      P.rect(R(3), R(14), W - R(6), 1, "cloth2", 2);
      P.ellipse(cx, R(7), R(3.4), R(3.4), "sand", { tone: 1 });
      P.px(Math.round(cx) - R(1.5), R(7), "ink", 0);
      P.px(Math.round(cx) + R(1), R(7), "ink", 0);
      P.box(Math.round(cx) - R(3.5), R(3.2), R(7), R(1.5), "wood", [0, -0.5, 0.9], { tone: 1 });
      P.poly([[cx - R(2.4), R(3.4)], [cx, R(0)], [cx + R(2.4), R(3.4)]], "wood", [0, -0.5, 0.9]);
      for (const sx of [R(1), W - R(3)]) for (let y = 0; y < 3; y++) P.px(sx + (y % 2), R(13) + y * 1, "gold", 3);
    } else {
      // trough: a wooden box with a water surface
      P.box(R(1), R(4), W - R(2), R(7), "wood", [0, 0.3, 0.95]);
      P.box(R(1), R(4), W - R(2), R(2), "wood", [0, -0.6, 0.8], { tone: 1 });
      P.box(R(3), R(5), W - R(6), R(2), "water", [0, -0.3, 0.9], { tone: -1 });
      P.rect(R(3), R(5), W - R(6), 1, "water", 4);
      P.box(R(2), R(9), R(2), R(2), "wood", [-0.5, 0, 0.9], { tone: -1 });
      P.box(W - R(4), R(9), R(2), R(2), "wood", [0.5, 0, 0.9], { tone: -1 });
    }
    return finalize(P.toSprite(), kit);
  });
}

// ---------------------------------------------------------------- plan

type Extra = Record<string, string | number | boolean>;
const LADDER: [string, string, string][] = [["medium", "large", "large"], ["medium", "small", "large"], ["medium", "small", "small"], ["small", "small", "small"]];
const ext = (sp: Sprite, T: number) => ({ e: Math.ceil((sp.w / 2 - T / 2) / T), up: Math.ceil(sp.h / T) - 1 });
const MIN: Record<string, number> = { field: 7, pen: 6, orchard: 5, pond: 6 };
const CAP: Record<string, number> = { field: 12, pen: 9, orchard: 9, pond: 10 };
const FIELD_CROPS: CropSpecies[][] = [["wheat", "corn", "sunflower"], ["cabbage", "tomato", "pumpkin", "strawberry"], ["carrot", "wheat", "cabbage"]];

export interface FarmOptions { sea: boolean; density: number; wantPath: boolean; terrain: boolean }

export function farmMmoPlan(cols: number, rows: number, seed: number, kit: StyleKit, opts: FarmOptions): FarmMmoPlan {
  const { sea, density, wantPath } = opts;
  const T = kit.sizes.tile;
  const r = rng((seed ^ 0xfa4f1) >>> 0);
  const n = valueNoise((seed ^ 0x71e5) >>> 0, 16), wn = valueNoise((seed ^ 0x3c1) >>> 0, 16), tn = valueNoise((seed ^ 0x6a21) >>> 0, 16), sn = valueNoise((seed ^ 0x2d5) >>> 0, 16), pn = valueNoise((seed ^ 0x70d1) >>> 0, 16);
  const at = (x: number, y: number) => y * cols + x;
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows;
  const ground: Ground[] = new Array(cols * rows).fill("grass");
  const isWater = (x: number, y: number) => inb(x, y) && ground[at(x, y)] === "water";
  const path = new Set<number>(), reserved = new Set<number>(), fences = new Map<number, boolean>(), channels = new Set<number>();
  const variant = (seed >>> 0) % 4;
  const crops: FarmCrop[] = [], animals: FarmAnimalSpec[] = [], lots: FarmLot[] = [], spawns: FarmNpc[] = [];
  const props: PropSpec[] = [];
  const taken = new Set<number>(); // cells a prop / animal / tree trunk stands on
  const reserve = (x0: number, y0: number, x1: number, y1: number) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inb(x, y)) reserved.add(at(x, y)); };

  // --- stream down the east side; the road crosses it on a bridge ---
  const hasStream = cols >= 22;
  const maxHalf = clamp(cols * 0.075, 1.8, 2.5);
  const sx = cols - 1.5 - maxHalf - 1.5;
  const cxAt = (y: number) => clamp(sx + (n(y / 6, 0.5) - 0.5) * 1.6 + Math.sin(y / 3.1 + (seed % 7)) * 0.45, maxHalf + 3, cols - maxHalf - 1.5);
  const halfAt = (y: number) => maxHalf - 0.45 + wn(y / 4, 1.5) * 0.45;
  if (hasStream) for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (Math.abs(x + 0.5 - cxAt(y)) < halfAt(y)) ground[at(x, y)] = "water";
  let streamLeft = cols;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (isWater(x, y)) streamLeft = Math.min(streamLeft, x);
  const westEnd = hasStream ? streamLeft - 3 : cols - 3; // last column of the fenced lots / buildings

  // --- terrain (opt-in): a raised band along the north edge; everything else moves below it ---
  const band0 = opts.terrain && rows >= 30 ? bandLayout(cols, rows, seed, (x, y) => isWater(x, y)) : null;
  const off = band0 ? Math.max(...band0.edge) + 3 : 0;

  // --- buildings ---
  const houseStyle = sea ? (cols >= 34 ? "half-brick" : "stilt-house") : "farmhouse";
  const make = (rung: [string, string, string]) => {
    const barn: Extra = { ...(sea ? { wall: "wood", trim: "wood", roof: "metal", roof_style: "corrugated" } : { wall: "cloth2", trim: "sand" }), size: rung[1] };
    const house: Extra = sea ? (houseStyle === "stilt-house" ? { access: "stairs" } : {}) : { size: rung[0] };
    return [
      { style: houseStyle, extra: house },
      { style: "barn", extra: barn },
      { style: "coop", extra: { size: rung[2] } },
    ].map((b) => ({ ...b, ...ext(farmBuildingSprite(kit, b.style, b.extra, variant), T) }));
  };
  const span = (l: { e: number }[], g = 3) => l.reduce((a, b) => a + 2 * b.e + 1, 0) + g * (l.length - 1);
  const avail = westEnd - 2 + 1;
  let items = make(LADDER[LADDER.length - 1]);
  for (const rung of LADDER) { const m = make(rung); if (span(m) <= avail) { items = m; break; } }
  if (span(items) > avail) for (const rung of LADDER) { const m = make(rung); if (span(m, 2) <= avail) { items = m; break; } }
  while (items.length > 1 && span(items, 2) > avail) items = items.slice(0, -1);
  for (let k = items.length - 1; k > 0; k--) { const j = r.int(0, k); [items[k], items[j]] = [items[j], items[k]]; }
  const upMax = Math.max(...items.map((b) => b.up));
  const yb0 = off ? off + upMax : upMax + 2;
  const free = avail - items.reduce((a, b) => a + 2 * b.e + 1, 0);
  const minGap = span(items) <= avail ? 3 : 2;
  const gap = clamp(Math.floor(free / Math.max(1, items.length)), minGap, 6);
  let cx = 2 + Math.max(0, Math.floor((free - gap * (items.length - 1)) / 2));
  const buildings: FarmBuilding[] = [];
  let maxYb = 0;
  const gaps: { x0: number; x1: number }[] = [];
  items.forEach((b, k) => {
    cx += b.e;
    const yb = Math.min(rows - 6, b.style === "coop" ? yb0 + 1 : yb0);
    buildings.push({ x: cx, y: yb, style: b.style, extra: b.extra, e: b.e, up: b.up });
    reserve(cx - b.e, yb - b.up, cx + b.e, yb);
    maxYb = Math.max(maxYb, yb);
    cx += b.e;
    if (k < items.length - 1) { gaps.push({ x0: cx + 1, x1: cx + gap }); cx += gap + 1; }
    else if (cx + 1 <= westEnd) gaps.push({ x0: cx + 1, x1: Math.min(westEnd, cx + gap) });
  });
  if (buildings[0] && buildings[0].x - buildings[0].e - 1 >= 2) gaps.unshift({ x0: 1, x1: buildings[0].x - buildings[0].e - 1 });

  // --- stream bank, road, connectors ---
  const sy = maxYb + 3;
  const dirt = (x: number, y: number) => { if (!inb(x, y) || isWater(x, y)) return; ground[at(x, y)] = "dirt"; path.add(at(x, y)); };
  const lotsFit = rows - 3 - (sy + 3) >= 5;
  // lots: widths shared out like farmPlan; order shuffled but a field comes first so the yard always has one
  const KINDS = ["field", "pen", "pond", "orchard", "field"] as const;
  const order: (typeof KINDS)[number][] = [];
  let need = 0;
  if (lotsFit) for (const k of KINDS) { const w = MIN[k] + (order.length ? 1 : 0); if (need + w > westEnd - 3 + 1) break; need += w; order.push(k); }
  for (let k = order.length - 1; k > 1; k--) { const j = r.int(1, k); [order[k], order[j]] = [order[j], order[k]]; }
  const widths = order.map((k) => MIN[k]);
  let spare = westEnd - 3 + 1 - need;
  for (let grew = true; grew && spare > 0; ) {
    grew = false;
    // fields first (they are what the farm is for), then the rest
    for (const kinds of [["field"], ["pen", "pond", "orchard"]])
      for (let k = 0; k < widths.length && spare > 0; k++) if (kinds.includes(order[k]) && widths[k] < CAP[order[k]]) { widths[k]++; spare--; grew = true; }
  }
  let lx = 3 + Math.floor(Math.min(spare, 2) * r.next());
  const yt = sy + 3;
  order.forEach((kind, k) => {
    const w = widths[k];
    const h = clamp(rows - 4 - yt + 1, 5, kind === "pond" ? 7 : 9);
    lots.push({ kind, x0: lx, x1: lx + w - 1, y0: yt, y1: Math.min(rows - 4, yt + h - 1), gx: lx + 2 + r.int(0, Math.max(0, w - 4)) });
    lx += w + 1;
  });
  const xs = [...buildings.map((b) => b.x), ...lots.map((l) => Math.round((l.x0 + l.x1) / 2))];
  const rx0 = wantPath ? 0 : Math.min(...xs), rx1 = wantPath ? cols - 1 : Math.max(...xs);
  for (let x = rx0; x <= rx1; x++) { dirt(x, sy); dirt(x, sy + 1); }
  for (const b of buildings) for (let y = b.y + 1; y < sy; y++) for (let dx = -1; dx <= 1; dx++) dirt(b.x + dx, y);
  for (const b of buildings) reserve(b.x - 2, b.y + 1, b.x + 2, sy + 1);
  reserve(0, sy, cols - 1, sy + 1);

  // sandy banks (broken up so grass meets water in places); the road stays dirt
  const was = ground.slice();
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (was[at(x, y)] !== "grass" || path.has(at(x, y))) continue;
    let wet = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inb(x + dx, y + dy) && was[at(x + dx, y + dy)] === "water") wet = true;
    if (wet && sn(x / 2, y / 2) > 0.3) ground[at(x, y)] = "sand";
  }
  let bridge: FarmMmoPlan["bridge"] = null;
  {
    let xa = cols, xb = -1;
    for (let x = 0; x < cols; x++) if (isWater(x, sy) || isWater(x, sy + 1)) { xa = Math.min(xa, x); xb = Math.max(xb, x); }
    if (xb >= 0 && wantPath) {
      bridge = { x0: Math.max(0, xa - 1), x1: Math.min(cols - 1, xb + 1), y0: sy, y1: sy + 1 };
      for (let x = xa; x <= xb; x++) { path.add(at(x, sy)); path.add(at(x, sy + 1)); }
    }
  }
  const bridgeBox = (x: number, y: number) => !!bridge && x >= bridge.x0 - 1 && x <= bridge.x1 + 1 && y >= bridge.y0 - 2 && y <= bridge.y1 + 2;

  // --- lots ---
  const set = FARM_SETS[sea ? "sea" : "normal"] as readonly string[];
  const stock = set.filter((s) => !["dog", "cat", "chicken", "fish"].includes(s));
  const soilOff = r.int(0, 1);
  const put = (x: number, y: number, kind: string, allow = false): boolean => {
    const i = at(x, y);
    if (!inb(x, y) || taken.has(i) || bridgeBox(x, y)) return false;
    const g = ground[i];
    if (g !== "grass" && g !== "dirt" && g !== "sand") return false;
    if (!allow && (reserved.has(i) || path.has(i))) return false;
    props.push({ x, y, kind, v: r.int(0, 5) });
    taken.add(i);
    return true;
  };
  let fieldNo = 0;
  const trees: TreeSpec[] = [];
  const crowns: { cx: number; cy: number; rx: number; ry: number }[] = [];
  const canopy = new Set<number>();
  const trunks = new Set<number>();
  const crownCells = (cr: { cx: number; cy: number; rx: number; ry: number }, shrink = 1) => {
    const out: number[] = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++)
      if (((x * T + T / 2 - cr.cx) / (cr.rx * shrink)) ** 2 + ((y * T + T / 2 - cr.cy) / (cr.ry * shrink)) ** 2 <= 1) out.push(at(x, y));
    return out;
  };
  const sizes = treeSizesFor(kit);
  const sizeOf = (name: "small" | "medium" | "large") => sizes.find((s) => s.size === name) ?? sizes[sizes.length - 1];
  const addTree = (x: number, y: number, species: string, size: "small" | "medium" | "large", season: string) => {
    const sz = sizeOf(size);
    const cr = crownOf(x, y, sz.w, T);
    trees.push({ x, y, species, size: sz.size, season, variant: r.int(0, 2) });
    crowns.push(cr);
    trunks.add(at(x, y)); taken.add(at(x, y));
    for (const c of crownCells(cr, 0.9)) if (c !== at(x, y)) canopy.add(c);
  };

  lots.forEach((l) => {
    for (let y = l.y0; y <= l.y1; y++) for (let x = l.x0; x <= l.x1; x++) reserved.add(at(x, y));
    const gate = (x: number) => { for (let y = sy + 2; y < l.y0; y++) { dirt(x, y); dirt(x + 1, y); } };
    if (l.kind === "pond") {
      const w = l.x1 - l.x0 + 1, h = l.y1 - l.y0 + 1;
      const px = (l.x0 + l.x1) / 2 + 0.5, py = (l.y0 + l.y1) / 2 + 0.5 + 0.3;
      const rx = (w - 1) / 2, ry = Math.min((h - 1) / 2, rx * 0.8);
      for (let y = l.y0; y <= l.y1; y++) for (let x = l.x0; x <= l.x1; x++) {
        const d = Math.hypot((x + 0.5 - px) / rx, (y + 0.5 - py) / ry) + (pn(x / 2.5, y / 2.5) - 0.5) * 0.45;
        if (d < 1) ground[at(x, y)] = "water";
      }
      for (let y = l.y0; y <= l.y1; y++) for (let x = l.x0; x <= l.x1; x++) {
        if (ground[at(x, y)] !== "grass") continue;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (ground[at(x + dx, y + dy)] === "water") ground[at(x, y)] = "sand";
      }
      // a short dirt spur ends at the shore
      for (let y = sy + 2; y <= l.y0 + 1; y++) if (ground[at(Math.round(px), y)] !== "water") dirt(Math.round(px), y);
      return;
    }
    if (l.kind === "orchard") {
      gate(Math.round((l.x0 + l.x1) / 2));
      return;
    }
    for (let y = l.y0; y <= l.y1; y++) for (let x = l.x0; x <= l.x1; x++) if (x === l.x0 || x === l.x1 || y === l.y0 || y === l.y1) fences.set(at(x, y), false);
    fences.set(at(l.gx, l.y0), true);
    gate(l.gx);
    const iw = l.x1 - l.x0 - 1, ih = l.y1 - l.y0 - 1;
    if (l.kind === "field") {
      const no = fieldNo++;
      // the first interior row and every third one is a bare aisle; the others carry crops
      const aisle = (j: number) => j % 3 === 0;
      const cropRows = Array.from({ length: ih }, (_, j) => j).filter((j) => !aisle(j));
      const species = FIELD_CROPS[no % FIELD_CROPS.length].filter((s) => !sea || s !== "pumpkin");
      const cells = cropField({ cols: iw, rows: cropRows.length }, sea ? ["rice"] : species, { seed: seed + no * 17, channel: "left" });
      for (let j = 0; j < ih; j++) for (let i = 0; i < iw; i++) {
        const x = l.x0 + 1 + i, y = l.y0 + 1 + j;
        ground[at(x, y)] = sea ? "paddy" : ((j + soilOff + no) >> 1) & 1 ? "watered-soil" : "tilled-soil";
      }
      for (const c of cells) {
        const x = l.x0 + 1 + c.x, y = l.y0 + 1 + cropRows[c.y];
        if (c.irrigation) { ground[at(x, y)] = "water"; channels.add(at(x, y)); continue; }
        crops.push({ x, y, species: c.species!, stage: c.stage!, variant: c.variant ?? 0 });
      }
      // the channel runs down the whole west edge, aisles included
      for (let j = 0; j < ih; j++) { ground[at(l.x0 + 1, l.y0 + 1 + j)] = "water"; channels.add(at(l.x0 + 1, l.y0 + 1 + j)); }
      const si = crops.findIndex((c) => c.x === l.x0 + 1 + Math.ceil(iw * 0.6) && c.y > l.y0 + 1);
      if (si >= 0 && !sea) { const [c] = crops.splice(si, 1); taken.add(at(c.x, c.y)); props.push({ x: c.x, y: c.y, kind: "scarecrow", v: 0 }); }
      spawns.push({ x: Math.min(l.x1 - 1, l.gx + 1), y: l.y0 + 1, role: no === 0 ? "farmer" : "weeder", face: "down" });
      return;
    }
    // pen: livestock from the setting, a baby or two among them; a trough and hay in the corners
    for (let y = l.y0 + 1; y <= l.y1 - 1; y++) for (let x = l.x0 + 1; x <= l.x1 - 1; x++) ground[at(x, y)] = "grass";
    const seq: [string, "adult" | "baby"][] = [[stock[0], "adult"], [stock[1], "adult"], [stock[0], "baby"], [stock[0], "adult"], [stock[1], "baby"], [stock[1], "adult"]];
    const cand: number[] = [];
    for (let y = l.y0 + 2; y <= l.y1 - 1; y++) for (let x = l.x0 + 2; x <= l.x1 - 1; x++) cand.push(at(x, y));
    for (const [species, age] of seq) {
      for (let t = 0; t < 14 && cand.length; t++) {
        const i = cand[r.int(0, cand.length - 1)], x = i % cols, y = Math.floor(i / cols);
        const dist = species === "cow" || species === "water-buffalo" ? 3 : 2;
        if (animals.some((a) => Math.abs(a.x - x) < dist && Math.abs(a.y - y) < 2)) continue;
        animals.push({ x, y, species, age, dir: ["down", "left", "right"][r.int(0, 2)] });
        taken.add(i);
        break;
      }
    }
    put(l.x1 - 1, l.y1 - 1, "trough", true);
    put(l.x0 + 1, l.y1 - 1, "hay-bale", true);
    spawns.push({ x: l.gx, y: l.y0 + 1, role: "herder", face: "down" });
  });

  // --- yard: hay by the barn first, then well, garden bed, flower beds and mailbox in the gaps between the buildings ---
  const barn0 = buildings.find((b) => b.style === "barn");
  if (barn0) {
    const side = barn0.x + barn0.e + 3 <= westEnd ? 1 : -1;
    for (const [dx, dy] of [[1, 0], [1, 1], [2, 1], [2, 0]]) if (r.next() < 0.85 || dy === 0) put(barn0.x + side * (barn0.e + dx), barn0.y + dy, "hay-bale", true);
    put(barn0.x - side * (barn0.e + 1), barn0.y, "barrel", true);
  }
  // flower beds under the windows (props only: a one-row soil strip would be eaten by the grass blend), door clear
  for (const b of buildings) for (let x = b.x - b.e + (b.style === "coop" ? 1 : 0); x <= b.x + b.e - (b.style === "coop" ? 1 : 0); x++) {
    if (Math.abs(x - b.x) <= 1 || (x + b.x) % 2) continue;
    put(x, b.y + 1, (x + b.x) % 3 ? "flowers-blossom" : "flowers", true);
  }
  const yardRows = [maxYb + 1, maxYb + 2];
  let feature = 0;
  const gardenCrops: CropSpecies[] = ["cabbage", "tomato", "carrot", "strawberry"];
  const wide = [...gaps].filter((g) => g.x1 >= g.x0).sort((a, b) => b.x1 - b.x0 - (a.x1 - a.x0));
  for (const g of wide) {
    const w = g.x1 - g.x0 + 1;
    const mid = Math.floor((g.x0 + g.x1) / 2);
    const kind = ["garden", "well", "mailbox", "flowers"][feature++ % 4];
    if (kind === "garden" && w >= 3) {
      // a tilled bed with rows of vegetables, two cells deep
      const gy = yb0 - 2;
      for (let y = gy; y <= gy + 2; y++) for (let x = g.x0; x <= g.x1; x++) {
        if (taken.has(at(x, y))) continue;
        ground[at(x, y)] = y === gy + 1 ? "watered-soil" : "tilled-soil";
        reserved.add(at(x, y));
        taken.add(at(x, y));
        crops.push({ x, y, species: gardenCrops[(x + y) % gardenCrops.length], stage: CROP_STAGES[1 + ((x + seed) % 3)], variant: (x * 3 + y) % 4 });
      }
      spawns.push({ x: mid, y: gy + 3, role: "gardener", face: "up" });
    } else if (kind === "well" || kind === "mailbox") put(mid, kind === "well" ? maxYb : yardRows[0], kind === "well" ? "well" : "mailbox", true);
    for (const y of [maxYb + 1, maxYb + 2, maxYb])
      for (let x = g.x0; x <= g.x1; x++) if (!taken.has(at(x, y)) && !path.has(at(x, y)) && x >= 1 && r.next() < 0.55) put(x, y, r.next() < 0.5 ? "flowers-blossom" : "flowers", true);
  }
  // the mailbox stands by the road at the house; a sign points down it
  const house = buildings.find((b) => b.style !== "barn" && b.style !== "coop");
  if (house) put(house.x + house.e + 1, sy - 1, "mailbox", true);
  put(2, sy - 1, "sign", true);

  // yard animals: hens and a chick by the coop, dog and cat by the house
  const putYard = (b: FarmBuilding | undefined, species: string, age: "adult" | "baby") => {
    if (!b) return;
    const cell: number[] = [];
    for (let y = b.y + 1; y <= sy - 1; y++) for (let x = b.x - b.e; x <= b.x + b.e; x++) if (x >= 1 && x < cols - 1 && x !== b.x && !taken.has(at(x, y)) && !animals.some((a) => Math.abs(a.x - x) < 2 && a.y === y)) cell.push(at(x, y));
    if (!cell.length) return;
    const i = cell[r.int(0, cell.length - 1)];
    animals.push({ x: i % cols, y: Math.floor(i / cols), species, age, dir: ["down", "left", "right"][r.int(0, 2)] });
    taken.add(i);
  };
  const coop = buildings.find((b) => b.style === "coop");
  putYard(coop, "chicken", "adult"); putYard(coop, "chicken", "adult"); putYard(coop, "chicken", "baby");
  putYard(house, "dog", "adult"); putYard(house, "cat", "adult");
  // crates at the coop
  if (coop) put(coop.x - coop.e - 1, coop.y + 1, "crate", true);

  // stream-bank / pond-side detail uses decorateWater in map.ts; here: orchard trees first (they rank above woodland)
  const keep = new Set<number>([...path, ...reserved, ...fences.keys(), ...channels]);
  for (const l of lots) if (l.kind === "orchard") {
    let row = 0;
    for (let y = l.y0 + 2; y <= l.y1 + 1; y += 3, row++)
      for (let x = l.x0 + 1 + (row % 2); x <= l.x1 - 1; x += 3) {
        const species = (x + row) % 2 ? "sakura" : "fruit-tree", season = species === "sakura" ? "spring" : "summer";
        if (!taken.has(at(x, y)) && !path.has(at(x, y))) addTree(x, y, species, "medium", season);
      }
  }
  // the east bank: a line of blossom and fruit trees along the stream
  if (hasStream) for (let y = 4; y < rows - 3; y += 4) {
    const x = Math.min(cols - 2, Math.round(cxAt(y) + halfAt(y)) + 1);
    if (isWater(x, y) || ground[at(x, y)] === "dirt" || keep.has(at(x, y)) || bridgeBox(x, y)) continue;
    if (!crowns.some((o) => Math.hypot((crownOf(x, y, 64, T).cx - o.cx) / 60, (crownOf(x, y, 64, T).cy - o.cy) / 40) < 0.9)) addTree(x, y, y % 8 ? "sakura" : "fruit-tree", "medium", y % 8 ? "spring" : "summer");
  }

  // --- terrain ramp ---
  let layout: TerrainLayout | undefined;
  const cliffKeep = new Set<number>();
  if (band0) {
    const foot = (x: number) => buildings.some((b) => x >= b.x - b.e && x <= b.x + b.e) || (hasStream && x >= streamLeft - 3);
    let cands = bandRampColumns(band0.edge, foot).filter((x) => x >= 1 && x <= cols - 3);
    if (!cands.length) {
      // flatten the band's edge over the west margin so a ramp always fits
      for (let x = 0; x <= 2; x++) { band0.edge[x] = band0.edge[1]; for (let y = 0; y < rows; y++) band0.heights[y * cols + x] = y < band0.edge[x] ? 1 : 0; }
      cands = bandRampColumns(band0.edge, foot).filter((x) => x >= 1 && x <= cols - 3);
    }
    if (cands.length) {
      const rx = cands[r.int(0, cands.length - 1)], hy = band0.edge[rx];
      for (let y = hy + 1; y <= sy; y++) for (const dx of [0, 1]) if (!foot(rx + dx) || dx === 0) { ground[at(rx + dx, y)] = "dirt"; path.add(at(rx + dx, y)); cliffKeep.add(at(rx + dx, y)); }
      layout = { heights: band0.heights, ramps: [{ x: rx, y: hy, from: 0, to: 1, material: "stone" }], plateaus: [{ x0: 0, y0: 0, x1: cols - 1, y1: Math.max(...band0.edge) - 1, level: 1 }] };
      for (let y = Math.max(0, hy - 3); y < hy; y++) for (let x = rx - 1; x <= rx + 1; x++) cliffKeep.add(at(x, y));
    }
    for (let x = 0; x < cols; x++) for (let y = band0.edge[x]; y <= band0.edge[x] + 2 && y < rows; y++) cliffKeep.add(at(x, y));
  }
  for (const i of cliffKeep) keep.add(i);

  // --- woodland edge: HD foliage groves, thick on the border and thinning inward ---
  const dWater = new Int8Array(cols * rows).fill(9);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++)
    for (let d = 1; d <= 3 && dWater[at(x, y)] === 9; d++)
      for (let dy = -d; dy <= d && dWater[at(x, y)] === 9; dy++) for (let dx = -d; dx <= d; dx++) if ((Math.abs(dx) === d || Math.abs(dy) === d) && isWater(x + dx, y + dy)) { dWater[at(x, y)] = d; break; }
  const speciesAt = (x: number, y: number): { species: string; season: string } => {
    if (dWater[at(x, y)] <= 2 && r.next() < 0.6) return { species: "willow", season: "summer" };
    const g = tn(x / 5, y / 5) + (r.next() - 0.5) * 0.35;
    if (sea) return { species: g < 0.5 ? "palm" : g < 0.8 ? "fruit-tree" : "willow", season: "summer" };
    if (g < 0.22) return { species: "maple-autumn", season: "fall" };
    if (g < 0.58) return { species: "oak", season: "summer" };
    if (g < 0.8) return { species: "birch", season: "summer" };
    return r.next() < 0.5 ? { species: "fruit-tree", season: "summer" } : { species: "sakura", season: "spring" };
  };
  const cand: number[] = [];
  for (let y = 1; y < rows; y++) for (let x = 0; x < cols; x++) cand.push(at(x, y));
  for (let k = cand.length - 1; k > 0; k--) { const j = r.int(0, k); [cand[k], cand[j]] = [cand[j], cand[k]]; }
  const dens = 0.25 + 1.5 * density;
  const pass = (scale: number, inner: boolean) => {
    if (density <= 0) return;
    for (const i of cand) {
      const x = i % cols, y = Math.floor(i / cols), g = ground[i];
      if ((g !== "grass" && g !== "dirt") || keep.has(i) || taken.has(i) || bridgeBox(x, y)) continue;
      const edge = Math.min(x, cols - 1 - x, y, rows - 1 - y);
      const w = (edge <= 1 ? 1 : edge <= 3 ? 0.85 : edge <= 6 ? 0.4 : inner ? 0.28 : 0.1) * (0.35 + tn(x / 3.2, y / 3.2)) * dens * scale;
      if (r.next() >= w) continue;
      const { species, season } = speciesAt(x, y);
      const order = edge <= 3 || sizes.length < 3 ? sizes : [sizes[1], sizes[2], sizes[0]];
      const pick = r.next() < 0.35 && order.length > 1 ? 1 : 0;
      for (const sz of [order[pick], ...order.filter((_, k) => k !== pick)]) {
        const cr = crownOf(x, y, sz.w, T);
        if (crownCells(cr, 0.85).some((c) => keep.has(c) && Math.floor(c / cols) < y)) continue;
        if (crowns.some((o) => Math.hypot((cr.cx - o.cx) / (cr.rx + o.rx), (cr.cy - o.cy) / (cr.ry + o.ry)) < 0.6)) continue;
        if (trees.some((t) => Math.abs(t.x - x) < 1 && Math.abs(t.y - y) < 1)) continue;
        addTree(x, y, species, sz.size, season);
        break;
      }
    }
  };
  pass(1, false);
  pass(0.6, true);
  pass(0.5, true);
  trees.sort((a, b) => a.y - b.y || a.x - b.x);

  // --- props: flowers, bushes, tall grass; thick along the road and fences, thinner in the open ---
  const open = (x: number, y: number) => {
    const i = at(x, y), g = ground[i];
    return inb(x, y) && (g === "grass" || g === "sand") && !taken.has(i) && !canopy.has(i) && !path.has(i) && !reserved.has(i) && !keep.has(i) && !bridgeBox(x, y) && dWater[i] >= 1;
  };
  const adj = (x: number, y: number, f: (i: number) => boolean) => [[0, -1], [0, 1], [1, 0], [-1, 0]].some(([dx, dy]) => inb(x + dx, y + dy) && f(at(x + dx, y + dy)));
  for (const t of trees) {
    const roll = r.next(), dx = r.int(-2, 2);
    if (t.species === "willow" || dWater[at(t.x, t.y)] <= 2) { if (roll < 0.5) tryPut(t.x + dx, t.y + 1, roll < 0.3 ? "rock" : "tall-grass"); }
    else if (roll < 0.4) { tryPut(t.x + dx, t.y + 1, "mushroom"); }
    else if (roll < 0.62) tryPut(t.x + (r.next() < 0.5 ? -2 : 2), t.y, "bush");
    else if (roll < 0.8) tryPut(t.x + dx, t.y + 1, r.next() < 0.5 ? "flowers-blossom" : "flowers");
    else if (roll < 0.9) tryPut(t.x + dx, t.y + 1, "rock");
  }
  function tryPut(x: number, y: number, kind: string) { if (density > 0 && open(x, y)) put(x, y, kind); }
  for (let y = 1; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (!open(x, y)) continue;
    const roll = r.next(), kind = r.next();
    const verge = adj(x, y, (i) => path.has(i));
    const fenced = adj(x, y, (i) => fences.has(i));
    const flower = pn(x / 3.5, y / 3.5) > 0.55;
    const base = (verge ? 0.3 : fenced ? 0.34 : flower ? 0.28 : 0.15) * (0.4 + density * 1.2);
    if (roll >= base) continue;
    tryPut(x, y, flower || verge ? (kind < 0.4 ? "flowers-blossom" : kind < 0.75 ? "flowers" : "tall-grass") : kind < 0.35 ? "bush" : kind < 0.75 ? "tall-grass" : kind < 0.88 ? "flowers" : "rock");
  }

  // --- villagers' places: beside the beds and pen, on the road and by the pond ---
  const walk = (x: number, y: number) => inb(x, y) && ground[at(x, y)] !== "water" && !fences.has(at(x, y)) || (fences.get(at(x, y)) ?? false);
  void walk;
  const pond = lots.find((l) => l.kind === "pond");
  if (pond) {
    const wx = Math.round((pond.x0 + pond.x1) / 2), wy = pond.y0 - 1;
    if (!taken.has(at(wx, wy)) && ground[at(wx, wy)] !== "water") spawns.push({ x: wx, y: wy, role: "fisher", face: "down" });
  }
  spawns.push({ x: clamp(2 + r.int(0, 4), 1, cols - 2), y: sy + 1, role: "walker", face: "right" });
  const start = { x: 2, y: sy };
  const out: FarmMmoPlan = { ground, path, bridge, buildings, lots, fences, animals, crops, trees, props, spawns, start, canopy, channels, reserved, variant, ...(layout ? { terrain: layout } : {}) };
  // a work spot a villager cannot reach is moved to the nearest cell that can be (or dropped)
  const okc = farmWalkable(out, cols, rows), reach = farmReach(okc, cols, rows, start);
  const used = new Set<number>();
  out.spawns = spawns.flatMap((s) => {
    let best: { x: number; y: number } | null = null, bd = 99;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = s.x + dx, y = s.y + dy, i = y * cols + x;
      if (!inb(x, y) || !reach.has(i) || used.has(i) || canopy.has(i) || ground[i] === "water") continue;
      if (Math.hypot(dx, dy) < bd) { bd = Math.hypot(dx, dy); best = { x, y }; }
    }
    if (!best) return [];
    used.add(best.y * cols + best.x);
    return [{ ...s, ...best }];
  });
  return out;
}

// ---------------------------------------------------------------- queries

/** Cells a villager can stand on: dry, not a fence (gates are open), not a building base, trunk or solid prop. */
export function farmWalkable(plan: FarmMmoPlan, cols: number, rows: number, tm?: TileMap): boolean[] {
  const ok = new Array(cols * rows).fill(true);
  const bridge = plan.bridge;
  for (let i = 0; i < ok.length; i++) {
    const x = i % cols, y = Math.floor(i / cols);
    const onBridge = !!bridge && x >= bridge.x0 && x <= bridge.x1 && y >= bridge.y0 && y <= bridge.y1;
    if (plan.ground[i] === "water" && !onBridge) ok[i] = false;
    if (tm && tm.tiles[tm.ground[i]]?.solid && !onBridge) ok[i] = false;
  }
  for (const [i, gate] of plan.fences) if (!gate) ok[i] = false;
  for (const b of plan.buildings) for (let y = b.y - 1; y <= b.y; y++) for (let x = b.x - b.e; x <= b.x + b.e; x++) if (x >= 0 && x < cols && y >= 0 && !(y === b.y && x === b.x)) ok[y * cols + x] = false;
  for (const t of plan.trees) ok[t.y * cols + t.x] = false;
  for (const p of plan.props) if (FARM_SOLID.has(p.kind) || ["rock", "boulder", "stump", "barrel", "crate", "sign"].includes(p.kind)) ok[p.y * cols + p.x] = false;
  for (const a of plan.animals) ok[a.y * cols + a.x] = false;
  return ok;
}

/** Cells reachable from `from` over walkable cells (4-neighbour flood fill). */
export function farmReach(ok: boolean[], cols: number, rows: number, from: { x: number; y: number }): Set<number> {
  const seen = new Set<number>(), q = [from.y * cols + from.x];
  if (!ok[q[0]]) return seen;
  seen.add(q[0]);
  for (let h = 0; h < q.length; h++) {
    const x = q[h] % cols, y = Math.floor(q[h] / cols);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx, ny = y + dy, j = ny * cols + nx;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || seen.has(j) || !ok[j]) continue;
      seen.add(j);
      q.push(j);
    }
  }
  return seen;
}

/**
 * Calm the dirt after the open detail pass: its lighter patches read as blotches on a worn road, so every
 * dirt pixel that got lighter than its undecorated tile goes back (darker ruts, pebbles and straw stay).
 */
export function calmDirt(tm: TileMap, before: { name: string; data: ArrayLike<number> }[]): void {
  const pos = (v: number) => { const d = decodeIndex(v); return d && d.mat === "dirt" ? (d.fine !== undefined ? d.fine * 2 + 1 : d.level * 2) : -1; };
  tm.ground.forEach((t, i) => {
    const was = before[i];
    const sp = tm.tiles[t]?.sprite;
    if (!was || !sp || !(tm.tiles[t].name.startsWith("dirt"))) return;
    const out = sp.data.slice();
    let changed = false;
    for (let k = 0; k < out.length; k++) {
      const a = pos(was.data[k]), b = pos(out[k]);
      if (a >= 0 && b > a) { out[k] = was.data[k]; changed = true; }
    }
    if (changed) tm.tiles[t] = { ...tm.tiles[t], sprite: { ...sp, data: out } };
  });
}

export { CROP_SPECIES };

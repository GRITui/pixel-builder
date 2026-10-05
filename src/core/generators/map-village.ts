// The `village` biome: a main street of rich 3/4 buildings (shops with awnings and signs, inn, blacksmith,
// temple or Thai wat, a windmill at the east edge), a cobbled plaza with a well-house and market stalls,
// a cross lane to a second lane of houses, lamp posts, benches, barrels and foliage trees. Buildings are
// placed by footprint (placeBuilding / canPlace): every door has an entry tile on a path, nothing blocks
// it, and the solid cells are exactly the footprints. Pure data first (`villagePlan`), painted by `villageMap`.
import { finalize } from "../enforce";
import { placeBuilding } from "../footprint";
import { Painter } from "../painter";
import { rng, valueNoise } from "../rng";
import { emptyTileMap, ensureTile, renderTileMap } from "../tilemap";
import type { Sprite, StyleKit, TileMap } from "../types";
import { crownOf, treeSizesFor, type PropSpec, type TreeSpec } from "./map-forest";
import { applyGroundDetail } from "./map-detail";
import { calmDirt, farmReach } from "./map-farm";
import { placedRich, richBuilding, richRect, type Extra, type PlacedRich, type RichBuilding } from "./map-rich";
import { foliageGenerator } from "./foliage";
import { environmentGenerator, environmentIdle } from "./environment";
import { objectGenerator } from "./object";
import { defaults } from "./types";
import type { Ground } from "./map";

export interface VillageBuilding {
  style: string;
  extra: Extra;
  variant: number;
  /** door column and front row of the footprint */
  x: number;
  y: number;
  rect: { x0: number; y0: number; x1: number; y1: number };
  entry: { x: number; y: number };
  up: number;
  left: number;
  right: number;
  row: "north" | "plaza" | "south";
}
export interface VillageNpc { x: number; y: number; role: string; face: "left" | "right" | "up" | "down" }

export interface VillagePlan {
  ground: Ground[];
  path: Set<number>;
  buildings: VillageBuilding[];
  props: PropSpec[];
  trees: TreeSpec[];
  spawns: VillageNpc[];
  start: { x: number; y: number };
  canopy: Set<number>;
  reserved: Set<number>;
  /** footprint cells (building solids) */
  solid: Uint8Array;
  /** street rows (top row y, height) and plaza centre column, for scenes and tests */
  street: { y: number; h: number };
  plaza: { cx: number; y0: number; y1: number } | null;
  variant: number;
}

export const VILLAGE_PROP_KINDS = ["lamp-post", "bench"] as const;
const OBJECT_PROPS = new Set(["barrel", "crate", "sign"]);
export const VILLAGE_SOLID = new Set<string>(["lamp-post", "bench", "barrel", "crate", "sign", "rock"]);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ---------------------------------------------------------------- sprites

const cache = new WeakMap<StyleKit, Map<string, { sprite: Sprite; lights?: { x: number; y: number; r: number }[] }>>();

/** Lamp post and bench, painted with the lit Painter so they share the kit's light. Lamp lights are in sprite px. */
export function villagePropSprite(kit: StyleKit, kind: string): { sprite: Sprite; lights?: { x: number; y: number; r: number }[] } {
  let m = cache.get(kit);
  if (!m) cache.set(kit, (m = new Map()));
  let hit = m.get(kind);
  if (!hit) {
    const T = kit.sizes.tile, k = T / 16, R = (n: number) => Math.max(1, Math.round(n * k));
    if (kind === "lamp-post") {
      const W = R(12), H = Math.round(kit.sizes.character * 1.25);
      const P = new Painter(W, H, kit);
      const cx = Math.floor(W / 2), top = R(2);
      P.box(cx - R(2.5), H - R(4), R(5), R(3), "stone", [0, 0.3, 1], { tone: 0 });
      P.box(cx - R(1.5), H - R(6), R(3), R(3), "stone", [0, 0.2, 1], { tone: 1 });
      P.box(cx - 1, top + R(7), Math.max(2, R(1.4)), H - top - R(12), "metal", [-0.3, 0, 1], { tone: -1 });
      P.box(cx - R(3), top + R(6), R(6), R(1.5), "metal", [0, -0.6, 0.8], { tone: 0 });
      // lantern: gold glass with a warm core, metal cap
      P.box(cx - R(2.5), top + R(1.5), R(5), R(4.5), "gold", [0, 0, 1], { tone: 1 });
      P.rect(cx - R(1), top + R(2.5), Math.max(2, R(2)), R(2.5), "gold", 4);
      P.poly([[cx - R(3.4), top + R(1.8)], [cx, top - R(1.2)], [cx + R(3.4), top + R(1.8)]], "metal", [0, -0.6, 0.8]);
      P.px(cx, top - R(1.2), "metal", 4);
      hit = { sprite: finalize(P.toSprite(), kit), lights: [{ x: cx, y: top + R(4), r: Math.round(T * 2.6) }] };
    } else {
      const W = T - 2, H = Math.round(T * 0.72);
      const P = new Painter(W, H, kit);
      P.box(1, Math.round(H * 0.08), W - 2, Math.round(H * 0.34), "wood", [0, 0.3, 0.95], { tone: -1 }); // backrest
      P.box(0, Math.round(H * 0.42), W, Math.round(H * 0.22), "wood", [0, -0.7, 0.75], { tone: 1 }); // seat
      P.box(0, Math.round(H * 0.64), W, Math.max(1, Math.round(H * 0.08)), "wood", [0, 0.8, 0.6], { tone: -1 });
      for (const lx of [R(1.5), W - R(3)]) P.box(lx, Math.round(H * 0.7), Math.max(2, R(1.5)), H - Math.round(H * 0.7), "metal", [lx < W / 2 ? -0.5 : 0.5, 0, 0.9], { tone: -1 });
      hit = { sprite: finalize(P.toSprite(), kit) };
    }
    m.set(kind, hit);
  }
  return { ...hit, sprite: { ...hit.sprite, data: hit.sprite.data.slice() } };
}

// ---------------------------------------------------------------- plan

interface Item { style: string; extra: Extra; rb: RichBuilding }
export interface VillageOptions { sea: boolean; density: number; wantPath: boolean }

export function villagePlan(cols: number, rows: number, seed: number, kit: StyleKit, opts: VillageOptions): VillagePlan {
  const { sea, density, wantPath } = opts;
  const T = kit.sizes.tile;
  const r = rng((seed ^ 0x71a9e) >>> 0);
  const tn = valueNoise((seed ^ 0x6a21) >>> 0, 16), pn = valueNoise((seed ^ 0x70d1) >>> 0, 16);
  const at = (x: number, y: number) => y * cols + x;
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows;
  const ground: Ground[] = new Array(cols * rows).fill("grass");
  const path = new Set<number>(), reserved = new Set<number>(), taken = new Set<number>();
  const solid = new Uint8Array(cols * rows), occ = new Uint8Array(cols * rows);
  const buildings: VillageBuilding[] = [], props: PropSpec[] = [], trees: TreeSpec[] = [], trunks = new Set<number>();
  const variant = (seed >>> 0) % 4;
  let counter = 0;
  const mk = (style: string, extra: Extra = {}): Item => {
    const v = (variant + counter++ * 3) % 4;
    return { style, extra, rb: richBuilding(kit, style, extra, v) };
  };
  const variantOf = (it: Item) => Number(it.rb.name.split(":")[2]);

  const place = (it: Item, doorX: number, frontY: number, row: VillageBuilding["row"]): VillageBuilding | null => {
    const rb = it.rb, rect = richRect(rb, doorX, frontY), top = frontY - rb.up;
    if (top < 0 || rect.x0 < 1 || rect.x1 > cols - 2 || frontY + 1 >= rows) return null;
    for (let y = top; y <= frontY; y++) for (let x = doorX - rb.left; x <= doorX + rb.right; x++) if (occ[at(x, y)]) return null;
    if (!placeBuilding({ w: cols, h: rows, solid }, rb.fp, { x: rect.x0, y: rect.y0 })) return null;
    for (let y = top; y <= frontY; y++) for (let x = doorX - rb.left; x <= doorX + rb.right; x++) { occ[at(x, y)] = 1; reserved.add(at(x, y)); }
    for (let y = frontY - 1; y <= frontY; y++) for (const x of [rect.x0 - 1, rect.x1 + 1]) if (inb(x, y)) reserved.add(at(x, y));
    const b: VillageBuilding = { style: it.style, extra: it.extra, variant: variantOf(it), x: doorX, y: frontY, rect, entry: { x: doorX, y: frontY + 1 }, up: rb.up, left: rb.left, right: rb.right, row };
    buildings.push(b);
    return b;
  };
  const dirt = (x: number, y: number, g: Ground = "dirt") => {
    if (!inb(x, y) || occ[at(x, y)]) return;
    ground[at(x, y)] = g; path.add(at(x, y)); reserved.add(at(x, y));
  };

  // --- north row: the main street's frontage, tallest first priorities, windmill at the east edge ---
  const thai = { gable: "thai" } as Extra;
  const pool: Item[] = sea
    ? [mk("temple", thai), mk("inn", thai), mk("shop"), mk("blacksmith"), mk("shop", { awning_color: "accent" }), mk("cottage", { flower_boxes: "on" })]
    : [mk("inn"), mk("shop"), mk("blacksmith"), mk("temple"), mk("shop", { awning_color: "foliage" }), mk("cottage", { flower_boxes: "on" })];
  const mill = cols >= 34 ? mk("windmill") : null;
  const gapMin = 2;
  let north: Item[] = [];
  let usedW = mill ? mill.rb.fp.w + gapMin : 0;
  for (const it of pool) {
    const w = it.rb.fp.w;
    if (usedW + w + (north.length ? gapMin : 0) <= cols - 2) { north.push(it); usedW += w + (north.length > 1 ? gapMin : 0); }
  }
  // the street must fit under the tallest building with room left for something south of it
  const fitRows = () => Math.max(0, ...north.concat(mill ? [mill] : []).map((b) => b.rb.up)) + 1;
  while (north.length && fitRows() + 5 > rows - 1) north = north.filter((b) => b !== north.reduce((a, c) => (c.rb.up > a.rb.up ? c : a)));
  const millOk = mill && mill.rb.up + 1 + 5 <= rows - 1 ? mill : null;
  if (!north.length && !millOk) {
    const c = mk("cottage"); // tiny maps: one cottage is all that fits
    north = [c];
  }
  for (let k = north.length - 1; k > 0; k--) { const j = r.int(0, k); [north[k], north[j]] = [north[j], north[k]]; }
  const upMax = Math.max(...north.concat(millOk ? [millOk] : []).map((b) => b.rb.up));
  const fN = Math.min(rows - 6, upMax + 1);
  const sy = fN + 1, sh = Math.max(1, Math.min(3, rows - 1 - sy));
  const total = north.reduce((a, b) => a + b.rb.fp.w, 0);
  const rightLimit = millOk ? cols - 1 - millOk.rb.fp.w - gapMin : cols - 2;
  const free = Math.max(0, rightLimit - total - gapMin * Math.max(0, north.length - 1));
  const gap = clamp(gapMin + Math.floor(free / Math.max(1, north.length)), gapMin, 5);
  let cx = 1 + Math.max(0, Math.floor((free - (gap - gapMin) * Math.max(0, north.length - 1)) / 2));
  for (const it of north) {
    const doorX = cx + it.rb.fp.door;
    if (place(it, doorX, fN, "north")) cx += it.rb.fp.w + gap;
  }
  if (millOk) place(millOk, cols - 1 - millOk.rb.fp.w + millOk.rb.fp.door, fN, "north");

  // --- main street (cobble): every north entry sits on it ---
  const doors = buildings.map((b) => b.x);
  const sx0 = wantPath ? 0 : Math.max(0, Math.min(...doors) - 3), sx1 = wantPath ? cols - 1 : Math.min(cols - 1, Math.max(...doors) + 3);
  for (let y = sy; y < sy + sh; y++) for (let x = sx0; x <= sx1; x++) dirt(x, y, "stone-path");

  // --- plaza, cross lane and the south row ---
  const rem = rows - (sy + sh);
  let plaza: VillagePlan["plaza"] = null;
  let cxm = Math.round(cols / 2);
  const half = cols >= 30 ? 7 : 4;
  if (rem >= 8 && cols >= 18) {
    cxm = clamp(cxm + r.int(-2, 2), half + 1, cols - half - 2);
    const py0 = sy + sh, py1 = py0 + 5;
    for (let y = py0; y <= py1; y++) for (let x = cxm - half; x <= cxm + half; x++) {
      const corner = Math.abs(x - cxm) === half && (y === py0 || y === py1);
      if (!corner) dirt(x, y, "stone-path");
    }
    plaza = { cx: cxm, y0: py0, y1: py1 };
    if (cols >= 30) {
      const frontY = py0 + 3;
      place(mk("well-house"), cxm - half + 1, frontY, "plaza");
      place(mk("market-stall", { awning_color: "cloth2" }), cxm - 2, frontY, "plaza");
      place(mk("market-stall", { awning_color: "foliage" }), cxm + 3, frontY, "plaza");
    }
  }
  // lane + south houses
  const laneY = rows - 4, fS = rows - 5;
  const plazaBottom = plaza ? plaza.y1 : sy + sh - 1;
  const houses: Item[] = sea ? [mk("stilt-house", { access: "stairs", gable: "thai" }), mk("cottage", { flower_boxes: "on" }), mk("stilt-house", { access: "ladder" })] : [mk("cottage", { flower_boxes: "on" }), mk("farmhouse", { tier: 1 }), mk("farmhouse", { tier: 2 }), mk("cottage", { flower_boxes: "on", wall: "sand" })];
  const southRoom = (it: Item) => fS - it.rb.up >= plazaBottom + 2;
  if (rows - plazaBottom >= 14 && fS > plazaBottom) {
    const lx0 = wantPath ? 0 : 1, lx1 = wantPath ? cols - 1 : cols - 2;
    const laneG: Ground = kit.shadeSteps <= 3 ? "stone-path" : "dirt"; // dirt vanishes into grass in 3-shade kits
    for (const y of [laneY, laneY + 1]) for (let x = lx0; x <= lx1; x++) dirt(x, y, laneG);
    if (plaza) for (let y = plaza.y1 + 1; y < laneY; y++) for (let x = cxm - 1; x <= cxm + 1; x++) dirt(x, y, laneG);
    const segs: [number, number][] = plaza ? [[1, cxm - 3], [cxm + 3, cols - 2]] : [[1, cols - 2]];
    for (const [a, b] of segs) {
      let x = a + r.int(0, 1);
      for (let guard = 0; guard < 8 && x <= b; guard++) {
        const fits = houses.filter((h) => x + h.rb.fp.w - 1 <= b && southRoom(h));
        if (!fits.length) break;
        const it = fits[r.int(0, fits.length - 1)];
        const b2 = place(mk(it.style, it.extra), x + it.rb.fp.door, fS, "south");
        x += it.rb.fp.w + (b2 ? 1 + r.int(1, 2) : 1);
      }
    }
  }

  // --- trees need to know where not to stand ---
  const keep = new Set<number>([...path, ...reserved]);
  const open = (x: number, y: number) => {
    const i = at(x, y), g = ground[i];
    return inb(x, y) && g === "grass" && !taken.has(i) && !keep.has(i) && !occ[i] && !solid[i];
  };
  const put = (x: number, y: number, kind: string, allowPath = false): boolean => {
    const i = at(x, y);
    if (!inb(x, y) || taken.has(i) || occ[i] || solid[i] || (!allowPath && (ground[i] !== "grass" && ground[i] !== "dirt"))) return false;
    props.push({ x, y, kind, v: r.int(0, 5) });
    taken.add(i);
    return true;
  };

  // lamp posts, benches, barrels in the gaps of the two rows and around the plaza
  const rowGaps = (list: VillageBuilding[], y: number) => {
    const s = [...list].sort((a, b) => a.rect.x0 - b.rect.x0), out: number[] = [];
    for (let k = 0; k + 1 < s.length; k++) {
      const a = s[k].rect.x1 + 1, b = s[k + 1].rect.x0 - 1;
      if (b >= a) out.push(Math.floor((a + b) / 2));
    }
    void y;
    return out;
  };
  const gapsN = rowGaps(buildings.filter((b) => b.row === "north"), fN);
  gapsN.forEach((gx, k) => { if (k % 2 === 0) put(gx, fN, "lamp-post"); else put(gx, fN, r.next() < 0.5 ? "barrel" : "crate"); });
  const gapsS = rowGaps(buildings.filter((b) => b.row === "south"), fS);
  gapsS.forEach((gx, k) => { put(gx, fS, k % 2 === 0 ? "lamp-post" : r.next() < 0.5 ? "bench" : "barrel"); });
  if (plaza) {
    put(plaza.cx - half, plaza.y1, "lamp-post", true); put(plaza.cx + half, plaza.y1, "lamp-post", true);
    put(plaza.cx - 3, plaza.y1, "bench", true); put(plaza.cx + 4, plaza.y1, "bench", true);
    // street-side lamps on the grass just south of the cobble, clear of the plaza
    for (let x = 3; x < cols - 2; x += 8) if (Math.abs(x - plaza.cx) > half + 1) put(x, sy + sh, "lamp-post");
  } else for (let x = 3; x < cols - 2; x += 8) put(x, sy + sh, "lamp-post");
  // a few crates and barrels by the shop fronts
  for (const b of buildings) if (b.row === "north" && (b.style === "shop" || b.style === "inn" || b.style === "blacksmith") && r.next() < 0.6) put(b.rect.x1 + 1, fN, r.next() < 0.5 ? "barrel" : "crate");
  put(1, sy + sh, "sign");

  // --- foliage: thick on the border, thin inside, never over a path, a door or a roof ---
  const sizes = treeSizesFor(kit);
  const crowns: { cx: number; cy: number; rx: number; ry: number }[] = [];
  const canopy = new Set<number>();
  const crownCells = (cr: { cx: number; cy: number; rx: number; ry: number }, shrink = 1) => {
    const out: number[] = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++)
      if (((x * T + T / 2 - cr.cx) / (cr.rx * shrink)) ** 2 + ((y * T + T / 2 - cr.cy) / (cr.ry * shrink)) ** 2 <= 1) out.push(at(x, y));
    return out;
  };
  const speciesAt = (x: number, y: number): { species: string; season: string } => {
    const g = tn(x / 5, y / 5) + (r.next() - 0.5) * 0.35;
    if (sea) return { species: g < 0.55 ? "palm" : g < 0.85 ? "fruit-tree" : "willow", season: "summer" };
    if (g < 0.2) return { species: "maple-autumn", season: "fall" };
    if (g < 0.58) return { species: "oak", season: "summer" };
    if (g < 0.8) return { species: "birch", season: "summer" };
    return r.next() < 0.5 ? { species: "fruit-tree", season: "summer" } : { species: "sakura", season: "spring" };
  };
  const cand: number[] = [];
  for (let y = 1; y < rows; y++) for (let x = 0; x < cols; x++) cand.push(at(x, y));
  for (let k = cand.length - 1; k > 0; k--) { const j = r.int(0, k); [cand[k], cand[j]] = [cand[j], cand[k]]; }
  const dens = 0.25 + 1.5 * density;
  const tryTree = (x: number, y: number, small: boolean) => {
    const { species, season } = speciesAt(x, y);
    const order = small ? [sizes[sizes.length - 1]] : sizes;
    const pick = r.next() < 0.35 && order.length > 1 ? 1 : 0;
    for (const sz of [order[pick], ...order.filter((_, k) => k !== pick)]) {
      const cr = crownOf(x, y, sz.w, T);
      if (crownCells(cr, 0.85).some((c) => (keep.has(c) || occ[c] || solid[c]) && Math.floor(c / cols) < y)) continue;
      if (crowns.some((o) => Math.hypot((cr.cx - o.cx) / (cr.rx + o.rx), (cr.cy - o.cy) / (cr.ry + o.ry)) < 0.6)) continue;
      trees.push({ x, y, species, size: sz.size, season, variant: r.int(0, 2) });
      crowns.push(cr);
      trunks.add(at(x, y)); taken.add(at(x, y));
      for (const c of crownCells(cr, 0.9)) if (c !== at(x, y)) canopy.add(c);
      return true;
    }
    return false;
  };
  if (plaza && density > 0) for (const dx of [-half, half]) {
    const x = plaza.cx + dx, y = plaza.y0 + 1;
    // the plaza trees stand in the cobble corners the plaza left free
    if (inb(x, y) && !taken.has(at(x, y)) && ground[at(x, y)] === "grass") tryTree(x, y, true);
  }
  const pass = (scale: number, inner: boolean) => {
    if (density <= 0) return;
    for (const i of cand) {
      const x = i % cols, y = Math.floor(i / cols);
      if (!open(x, y)) continue;
      const edge = Math.min(x, cols - 1 - x, y, rows - 1 - y);
      const w = (edge <= 1 ? 1 : edge <= 3 ? 0.8 : edge <= 5 ? 0.3 : inner ? 0.07 : 0.03) * (0.35 + tn(x / 3.2, y / 3.2)) * dens * scale;
      if (r.next() >= w) continue;
      tryTree(x, y, false);
    }
  };
  pass(1, false);
  pass(0.5, true);
  trees.sort((a, b) => a.y - b.y || a.x - b.x);

  // --- flowers, bushes, tall grass: along paths and under the windows, thin elsewhere ---
  const adjPath = (x: number, y: number) => [[0, -1], [0, 1], [1, 0], [-1, 0]].some(([dx, dy]) => inb(x + dx, y + dy) && path.has(at(x + dx, y + dy)));
  const free2 = (x: number, y: number) => open(x, y) && !canopy.has(at(x, y));
  if (density > 0)
    for (let y = 1; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (!free2(x, y)) continue;
      const roll = r.next(), kind = r.next();
      const flower = pn(x / 3.5, y / 3.5) > 0.55, verge = adjPath(x, y);
      const base = (verge ? 0.26 : flower ? 0.26 : 0.1) * (0.4 + density * 1.2);
      if (roll >= base) continue;
      put(x, y, flower || verge ? (kind < 0.4 ? "flowers-blossom" : kind < 0.75 ? "flowers" : "tall-grass") : kind < 0.4 ? "bush" : kind < 0.8 ? "tall-grass" : "flowers");
    }
  // flower beds under the front windows of the south row and the shops (door and entry stay clear)
  if (density > 0) for (const b of buildings) {
    if (b.row === "plaza") continue;
    for (let x = b.rect.x0; x <= b.rect.x1; x++) if (Math.abs(x - b.x) > 1 && (x + b.x) % 2 === 0 && b.row === "south") put(x, b.y + 1, "flowers", false);
  }

  // --- villagers: places on the paths, not on doors, props or the way in ---
  const start = (() => {
    for (let x = 1; x < cols; x++) if (path.has(at(x, sy + Math.min(1, sh - 1)))) return { x, y: sy + Math.min(1, sh - 1) };
    return { x: 1, y: sy };
  })();
  const out: VillagePlan = { ground, path, buildings, props, trees, spawns: [], start, canopy, reserved, solid, street: { y: sy, h: sh }, plaza, variant };
  const ok = villageWalkable(out, cols, rows), reach = farmReach(ok, cols, rows, start);
  const entries = new Set(buildings.map((b) => at(b.entry.x, b.entry.y)));
  const used = new Set<number>();
  const want: [string, "left" | "right" | "up" | "down", number, number][] = [];
  const near = (b: VillageBuilding | undefined, role: string, dx: number, face: "left" | "right" | "up" | "down") => { if (b) want.push([role, face, b.entry.x + dx, b.entry.y]); };
  near(buildings.find((b) => b.style === "blacksmith"), "smith", 2, "left");
  near(buildings.find((b) => b.style === "shop"), "shopkeeper", 2, "left");
  near(buildings.find((b) => b.style === "inn" || b.style === "temple"), "walker", -2, "right");
  const stalls = buildings.filter((b) => b.style === "market-stall");
  stalls.forEach((b) => want.push(["merchant", "down", b.entry.x + 1, b.entry.y]));
  if (plaza) want.push(["child", "right", plaza.cx, plaza.y0 + 3], ["walker", "left", plaza.cx + 2, plaza.y1]);
  want.push(["walker", "right", Math.round(cols * 0.3), sy + sh - 1], ["farmer", "left", Math.round(cols * 0.7), laneY]);
  for (const [role, face, wx, wy] of want) {
    let best: { x: number; y: number } | null = null, bd = 99;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -3; dx <= 3; dx++) {
      const x = wx + dx, y = wy + dy, i = at(x, y);
      if (!inb(x, y) || !reach.has(i) || used.has(i) || entries.has(i) || !path.has(i) || canopy.has(i)) continue;
      if ([...used].some((u) => Math.hypot((u % cols) - x, Math.floor(u / cols) - y) < 3)) continue;
      const d = Math.hypot(dx, dy);
      if (d < bd) { bd = d; best = { x, y }; }
    }
    if (best) { used.add(at(best.x, best.y)); out.spawns.push({ ...best, role, face }); }
  }
  return out;
}

/** Cells a villager can stand on: not a footprint, trunk or solid prop. */
export function villageWalkable(plan: VillagePlan, cols: number, rows: number): boolean[] {
  const ok = new Array(cols * rows).fill(true);
  for (let i = 0; i < ok.length; i++) if (plan.solid[i]) ok[i] = false;
  for (const t of plan.trees) ok[t.y * cols + t.x] = false;
  for (const p of plan.props) if (VILLAGE_SOLID.has(p.kind)) ok[p.y * cols + p.x] = false;
  return ok;
}

// ---------------------------------------------------------------- paint

export interface VillageHelpers {
  paintGround: (tm: TileMap, ground: Ground[], kit: StyleKit, seed: number) => void;
  cachedSprite: (kit: StyleKit, key: string, make: () => Sprite) => Sprite;
  mapObjects: (tm: TileMap) => { tile: number; name: string; col: number; row: number; x: number; y: number; solid: boolean }[];
}
export interface VillageArgs { cols: number; rows: number; density: number; wantPath: boolean; sea: boolean; detail: string; kit: StyleKit; seed: number; helpers: VillageHelpers }

export function villageMap(a: VillageArgs) {
  const { cols, rows, density, wantPath, sea, detail, kit, seed, helpers } = a;
  const T = kit.sizes.tile;
  const plan = villagePlan(cols, rows, seed, kit, { sea, density, wantPath });
  const tm: TileMap = emptyTileMap(cols, rows, T);
  helpers.paintGround(tm, plan.ground, kit, seed);
  const at = (x: number, y: number) => y * cols + x;
  const envDefaults = defaults(environmentGenerator);

  const propCache = new Map<string, number>();
  const propTile = (kind: string, v: number): number => {
    const vv = kind === "lamp-post" || kind === "bench" ? 0 : v;
    const name = `${kind}-${vv}`;
    let idx = propCache.get(name);
    if (idx === undefined) {
      if ((VILLAGE_PROP_KINDS as readonly string[]).includes(kind)) {
        const vp = villagePropSprite(kit, kind);
        idx = ensureTile(tm, name, vp.sprite, true);
        if (vp.lights) tm.tiles[idx].lights = vp.lights;
      } else {
        const sp = helpers.cachedSprite(kit, `vprop:${name}:${seed % 7}`, () => {
          if (OBJECT_PROPS.has(kind)) return objectGenerator.generate({ ...defaults(objectGenerator), kind }, kit, seed).rows[0].frames[0];
          if (kind === "flowers-blossom") return environmentIdle({ ...envDefaults, kind: "flowers", accent: "blossom", variant: vv * 3 }, kit, seed);
          return environmentIdle({ ...envDefaults, kind, variant: vv * 3 + (kind.length % 3) }, kit, seed);
        });
        idx = ensureTile(tm, name, sp, VILLAGE_SOLID.has(kind));
      }
      propCache.set(name, idx);
    }
    return idx;
  };
  const treeTile = (t: TreeSpec): number => {
    if (t.species === "palm") return propTile("palm", t.variant);
    const name = `tree-${t.species}-${t.size}-${t.season}-${t.variant}`;
    const i = tm.tiles.findIndex((x) => x.name === name);
    if (i >= 0) return i;
    const sp = helpers.cachedSprite(kit, name, () => foliageGenerator.generate({ ...defaults(foliageGenerator), species: t.species, size: t.size, season: t.season, variant: t.variant }, kit, 1 + t.variant).rows[0].frames[0]);
    return ensureTile(tm, name, sp, true);
  };

  if (density > 0) { // density 0 = bare ground, like every biome
    for (const pr of plan.props) tm.deco[at(pr.x, pr.y)] = propTile(pr.kind, pr.v);
    for (const b of plan.buildings) {
      const rb = richBuilding(kit, b.style, b.extra, b.variant);
      const ti = ensureTile(tm, rb.name, rb.sprite, true);
      tm.tiles[ti].lights = rb.lights;
      tm.deco[at(b.x, b.y)] = ti;
    }
    for (const t of plan.trees) tm.deco[at(t.x, t.y)] = treeTile(t);
  }
  if (detail !== "off") {
    const before = tm.ground.map((t) => ({ name: tm.tiles[t]?.name ?? "", data: tm.tiles[t] ? tm.tiles[t].sprite.data.slice() : [] }));
    applyGroundDetail(tm, kit, seed, detail, { profile: "open" });
    calmDirt(tm, before);
  }
  const objects = helpers.mapObjects(tm);
  const ok = villageWalkable(plan, cols, rows);
  const placed: (PlacedRich & { row: string })[] = plan.buildings.map((b) => ({ ...placedRich(kit, b.style, b.extra, b.variant, b.x, b.y), row: b.row }));
  const meta = {
    biome: "village",
    set: sea ? "sea" : "normal",
    buildingLook: "rich",
    /** villager spawn points (all walkable, reachable from playerStart): role is smith | shopkeeper | merchant | child | walker | farmer */
    spawns: plan.spawns,
    playerStart: plan.start,
    street: plan.street,
    plaza: plan.plaza,
    buildings: placed,
    /** window / lamp / forge emitters of every placed building in map pixels (lighting reads them from the tiles) */
    lights: placed.flatMap((p) => p.lights),
    /** cells a villager cannot enter: footprints, trunks, benches, lamp posts, barrels */
    blocked: ok.flatMap((w, i) => (w ? [] : [{ x: i % cols, y: Math.floor(i / cols) }])),
    ysorted: true,
    objects: objects.map((o) => ({ tile: o.tile, name: o.name, col: o.col, row: o.row, x: o.x, y: o.y, solid: o.solid })),
  };
  return { rows: [{ name: "map", frames: [renderTileMap(tm)] }], fps: 1, tilemap: tm, meta };
}


import { rng, valueNoise } from "../rng";
import type { StyleKit } from "../types";
import { FOLIAGE_PX } from "./foliage";
import type { Ground } from "./map";

/**
 * Layout of the `forest-mmo` biome: a wide river with a bridge where a worn dirt path crosses it,
 * clearings, dense mixed tree groves, grouped props and monster spawn points. Pure data (no
 * sprites), so it is cheap to test; map.ts paints it.
 */

export const FOREST_SEASONS = ["mixed", "spring", "summer", "fall"] as const;
export type TreeSize = "small" | "medium" | "large";
export interface TreeSpec { x: number; y: number; species: string; size: TreeSize; season: string; variant: number }
export interface PropSpec { x: number; y: number; kind: string; v: number }
export interface Spawn { x: number; y: number; monster: string }
export interface Clearing { x: number; y: number; rx: number; ry: number; camp: boolean }

export interface ForestPlan {
  ground: Ground[];
  /** Dirt path cells, including the ones that run over the bridge. */
  path: Set<number>;
  /** Cells the bridge deck covers (water cells plus a land cell at each end). */
  bridge: { x0: number; x1: number; y0: number; y1: number } | null;
  clearings: Clearing[];
  trees: TreeSpec[];
  props: PropSpec[];
  spawns: Spawn[];
  /** A walkable cell for the player, on the path just before the bridge. */
  start: { x: number; y: number };
  /** Cells covered by a tree crown (excluding the trunk cell): nothing else should be placed there. */
  canopy: Set<number>;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const MONSTERS = ["mushroom-red", "slime-green", "mushroom-brown", "plant", "slime-blue", "mushroom-poison", "wolf", "bat"];

/** Sizes a kit can afford: 96px trees are 2x an HD character but would swamp 32px kits. */
export function treeSizesFor(kit: StyleKit): { size: TreeSize; w: number }[] {
  const big = kit.sizes.character >= 48;
  return (big ? ["large", "medium", "small"] : ["medium", "small"]).map((s) => ({ size: s as TreeSize, w: FOLIAGE_PX[s] }));
}

/** Crown ellipse of a tree of `w` px whose trunk stands in cell (x, y). */
export function crownOf(x: number, y: number, w: number, T: number) {
  const baseY = (y + 1) * T;
  return { cx: x * T + T / 2, cy: baseY - w * 0.62, rx: w * 0.42, ry: w * 0.3 };
}

export function forestMmoPlan(cols: number, rows: number, seed: number, kit: StyleKit, season: string, density: number, wantPath: boolean): ForestPlan {
  const T = kit.sizes.tile;
  const r = rng((seed ^ 0xf0e57) >>> 0);
  const n = valueNoise((seed ^ 0x71e5) >>> 0, 16), wn = valueNoise((seed ^ 0x3c1) >>> 0, 16), tn = valueNoise((seed ^ 0x6a21) >>> 0, 16), sn = valueNoise((seed ^ 0x2d5) >>> 0, 16);
  const at = (x: number, y: number) => y * cols + x;
  const inb = (x: number, y: number) => x >= 0 && y >= 0 && x < cols && y < rows;
  const ground: Ground[] = new Array(cols * rows).fill("grass");
  const isWater = (x: number, y: number) => inb(x, y) && ground[at(x, y)] === "water";

  // --- river: flows top to bottom, 4.4-7 tiles wide so the middle reaches deep water ---
  const maxW = Math.min(7, cols * 0.34), minW = Math.min(4.4, maxW - 0.4);
  const cxBase = cols * (0.38 + 0.24 * r.next()), phase = r.next() * 6;
  const cxAt = (y: number) => clamp(cxBase + (n(y / 6, 0.5) - 0.5) * cols * 0.2 + Math.sin(y / 3.4 + phase) * 0.9, maxW / 2 + 2, cols - maxW / 2 - 2);
  const halfAt = (y: number) => (minW + (maxW - minW) * wn(y / 4, 1.5)) / 2;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (Math.abs(x + 0.5 - cxAt(y)) < halfAt(y)) ground[at(x, y)] = "water";

  // --- path: crosses the river on a straight stretch so the bridge is a clean rectangle ---
  const path = new Set<number>();
  let bridge: ForestPlan["bridge"] = null;
  const yc = clamp(Math.round(rows * (0.46 + 0.12 * r.next())), 3, rows - 6);
  let xa = cols, xb = -1;
  for (let x = 0; x < cols; x++) if (isWater(x, yc) || isWater(x, yc + 1)) { xa = Math.min(xa, x); xb = Math.max(xb, x); }
  if (wantPath && xb >= 0) {
    const c = new Array(cols).fill(yc);
    const walk = (from: number, step: number) => {
      let y = yc, vy = 0;
      for (let x = from; x >= 0 && x < cols; x += step) {
        vy = clamp(vy * 0.8 + (r.next() - 0.5) * 0.9, -0.8, 0.8);
        y = clamp(y + vy, 2, rows - 4);
        if (isWater(x, Math.round(y)) || isWater(x, Math.round(y) + 1) || isWater(x, Math.round(y) + 2)) { y = yc; vy = 0; }
        c[x] = Math.round(y);
      }
    };
    walk(xb + 4, 1);
    walk(xa - 4, -1);
    for (let x = 0; x < cols; x++) {
      const near = [c[Math.max(0, x - 1)], c[x], c[Math.min(cols - 1, x + 1)]];
      for (let y = Math.min(...near); y <= Math.max(...near) + 1; y++) path.add(at(x, y));
    }
    bridge = { x0: Math.max(0, xa - 1), x1: Math.min(cols - 1, xb + 1), y0: yc, y1: yc + 1 };
    // any other water on the path is a ford: dry it (rare, only where the path wanders beside the river)
    for (const i of path) if (ground[i] === "water" && !(i % cols >= xa && i % cols <= xb && Math.floor(i / cols) >= yc && Math.floor(i / cols) <= yc + 1)) ground[i] = "grass";
  }

  // --- sandy banks (broken up, so grass meets water in places) ---
  const was = ground.slice();
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      if (was[at(x, y)] !== "grass") continue;
      let wet = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (inb(x + dx, y + dy) && was[at(x + dx, y + dy)] === "water") wet = true;
      if (wet && sn(x / 2, y / 2) > 0.3) ground[at(x, y)] = "sand";
    }
  for (const i of path) if (ground[i] !== "water") ground[i] = "dirt";

  // --- clearings: a dirt camp on one bank, a flower glade on the other ---
  const clearings: Clearing[] = [];
  const clear = new Set<number>();
  const sides: [number, number][] = [[2, Math.max(2, xa - 5)], [Math.min(cols - 3, xb + 5), cols - 3]];
  sides.forEach(([lo, hi], k) => {
    if (hi < lo || xb < 0) return;
    const above = (k === 0) !== (r.next() < 0.5);
    const rx = 2.2 + r.next() * 0.8, ry = 1.7 + r.next() * 0.5;
    const cx = Math.round(lo + (hi - lo) * r.next()), cy = clamp(above ? yc - 3 - Math.round(ry) : yc + 4 + Math.round(ry), 2, rows - 3);
    const camp = k === 0;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const d = Math.hypot((x - cx) / rx, (y - cy) / ry) + (sn(x / 1.7, y / 1.7) - 0.5) * 0.45;
        if (d > 1 || ground[at(x, y)] === "water" || path.has(at(x, y))) continue;
        clear.add(at(x, y));
        if (camp) ground[at(x, y)] = "dirt";
      }
    if (camp) {
      // a one-tile spur joins the camp to the path
      const down = cy < yc;
      for (let y = down ? cy : yc + 2; y <= (down ? yc - 1 : cy); y++) if (ground[at(cx, y)] !== "water") { ground[at(cx, y)] = "dirt"; clear.add(at(cx, y)); }
    }
    clearings.push({ x: cx, y: cy, rx, ry, camp });
  });

  // --- trees ---
  const keep = new Set<number>([...path, ...clear]);
  if (bridge) for (let y = bridge.y0 - 1; y <= bridge.y1 + 1; y++) for (let x = bridge.x0; x <= bridge.x1; x++) keep.add(at(x, y));
  const dWater = new Int8Array(cols * rows).fill(9);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      for (let d = 1; d <= 4 && dWater[at(x, y)] === 9; d++)
        for (let dy = -d; dy <= d && dWater[at(x, y)] === 9; dy++)
          for (let dx = -d; dx <= d; dx++) if ((Math.abs(dx) === d || Math.abs(dy) === d) && isWater(x + dx, y + dy)) { dWater[at(x, y)] = d; break; }
  const sizes = treeSizesFor(kit);
  const trees: TreeSpec[] = [];
  const crowns: { cx: number; cy: number; rx: number; ry: number }[] = [];
  const trunks = new Set<number>();
  const canopy = new Set<number>();
  const cand: number[] = [];
  for (let y = 1; y < rows; y++) for (let x = 0; x < cols; x++) cand.push(at(x, y));
  for (let k = cand.length - 1; k > 0; k--) { const j = r.int(0, k); [cand[k], cand[j]] = [cand[j], cand[k]]; }
  const crownCells = (cr: { cx: number; cy: number; rx: number; ry: number }, shrink = 1) => {
    const out: number[] = [];
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++)
        if (((x * T + T / 2 - cr.cx) / (cr.rx * shrink)) ** 2 + ((y * T + T / 2 - cr.cy) / (cr.ry * shrink)) ** 2 <= 1) out.push(at(x, y));
    return out;
  };
  const speciesAt = (x: number, y: number): { species: string; season: string } => {
    if (dWater[at(x, y)] <= 3 && r.next() < 0.7) return { species: "willow", season: season === "mixed" ? "summer" : season };
    const g = tn(x / 5, y / 5) + (r.next() - 0.5) * 0.35;
    const s = season === "mixed" ? null : season;
    if (g < 0.3) return { species: "maple-autumn", season: "fall" };
    if (g < 0.62) return { species: "oak", season: s ?? (r.next() < 0.3 ? "fall" : "summer") };
    if (g < 0.82) return { species: "birch", season: s ?? "summer" };
    return { species: r.next() < 0.5 ? "fruit-tree" : "oak", season: s ?? "summer" };
  };
  const grow = density > 0; // density 0 = an empty (but still riverside) map, like the other biomes
  const pass = (scale: number) => {
    if (!grow) return;
    for (const i of cand) {
      const x = i % cols, y = Math.floor(i / cols);
      const g = ground[i];
      if ((g !== "grass" && g !== "dirt") || keep.has(i) || trunks.has(i)) continue;
      const edge = Math.min(x, cols - 1 - x, y, rows - 1 - y);
      const w = (edge <= 1 ? 1 : edge <= 3 ? 0.8 : edge <= 6 ? 0.45 : 0.2) * (0.3 + 1.0 * tn(x / 3.2, y / 3.2)) * (0.25 + 1.5 * density) * scale;
      if (r.next() >= w) continue;
      const { species, season: sea } = speciesAt(x, y);
      const order = edge <= 3 || sizes.length < 3 ? sizes : [sizes[1], sizes[2], sizes[0]];
      const pick = r.next() < 0.35 && order.length > 1 ? 1 : 0;
      for (const sz of [order[pick], ...order.filter((_, k) => k !== pick)]) {
        const cr = crownOf(x, y, sz.w, T);
        // the crown may not cover the path, a clearing or the bridge
        if (crownCells(cr, 0.85).some((c) => keep.has(c) && Math.floor(c / cols) < y)) continue;
        // and may overlap neighbours only a little (the one in front hides part of the one behind)
        if (crowns.some((o) => Math.hypot((cr.cx - o.cx) / (cr.rx + o.rx), (cr.cy - o.cy) / (cr.ry + o.ry)) < 0.6)) continue;
        if (trees.some((t) => Math.abs(t.x - x) < 1 && Math.abs(t.y - y) < 1)) continue;
        trees.push({ x, y, species, size: sz.size, season: sea, variant: r.int(0, 2) });
        crowns.push(cr);
        trunks.add(i);
        for (const c of crownCells(cr, 0.9)) if (c !== i) canopy.add(c);
        break;
      }
    }
  };
  pass(1);
  pass(0.6);
  trees.sort((a, b) => a.y - b.y || a.x - b.x);

  // --- spawn points: open grass, preferably in the clearings ---
  const taken = new Set<number>([...trunks]);
  const open = (x: number, y: number) => {
    const i = at(x, y);
    return inb(x, y) && (ground[i] === "grass" || ground[i] === "dirt") && !path.has(i) && !canopy.has(i) && !taken.has(i) && dWater[i] >= 2 && x >= 1 && x < cols - 1 && y >= 1 && y < rows - 1;
  };
  const spawns: Spawn[] = [];
  const spaced = (x: number, y: number, d: number) => spawns.every((s) => Math.hypot(s.x - x, s.y - y) >= d);
  let mk = 0;
  const addSpawn = (x: number, y: number) => { spawns.push({ x, y, monster: MONSTERS[mk++ % MONSTERS.length] }); taken.add(at(x, y)); };
  for (const c of clearings) {
    const spots = [...clear].filter((i) => Math.hypot((i % cols) - c.x, Math.floor(i / cols) - c.y) <= Math.max(c.rx, c.ry) * 0.8);
    for (let t = 0; t < 12 && spots.length; t++) {
      const i = spots[r.int(0, spots.length - 1)];
      if (open(i % cols, Math.floor(i / cols)) && spaced(i % cols, Math.floor(i / cols), 2)) { addSpawn(i % cols, Math.floor(i / cols)); if (spawns.length % 3 === 0) break; }
    }
  }
  for (let t = 0; t < 400 && spawns.length < Math.max(4, Math.round((cols * rows) / 70)); t++) {
    const x = r.int(1, cols - 2), y = r.int(1, rows - 2);
    if (open(x, y) && spaced(x, y, 4)) addSpawn(x, y);
  }

  // --- props, grouped: mushrooms / rocks / bushes at tree feet, flowers in the glade, stumps at the camp ---
  const props: PropSpec[] = [];
  const free = (x: number, y: number, allowClear = false) => {
    const i = at(x, y);
    return inb(x, y) && (ground[i] === "grass" || ground[i] === "dirt" || ground[i] === "sand") && !path.has(i) && (allowClear || !clear.has(i)) && !canopy.has(i) && !taken.has(i) && !(bridge && x >= bridge.x0 && x <= bridge.x1 && Math.abs(y - yc) <= 2);
  };
  const put = (x: number, y: number, kind: string, allowClear = false) => {
    if (!grow || !free(x, y, allowClear)) return false;
    props.push({ x, y, kind, v: r.int(0, 5) });
    taken.add(at(x, y));
    return true;
  };
  const wetSide = (x: number, y: number) => dWater[at(x, y)] <= 2;
  for (const t of trees) {
    const roll = r.next();
    const dx = r.int(-2, 2);
    if (t.species === "willow" || wetSide(t.x, t.y)) {
      if (roll < 0.5) put(t.x + dx, t.y + 1, "rock");
      else if (roll < 0.75) put(t.x + dx, t.y + 1, "tall-grass");
    } else if (roll < 0.5) {
      put(t.x + dx, t.y + 1, "mushroom"); put(t.x + dx + (r.next() < 0.5 ? -1 : 1), t.y + 1, "mushroom");
    } else if (roll < 0.68) put(t.x + dx, t.y + 1, "rock");
    else if (roll < 0.85) put(t.x + (r.next() < 0.5 ? -2 : 2), t.y, "bush");
    else put(t.x + dx, t.y + 1, "flowers");
  }
  for (const c of clearings) {
    for (let t = 0; t < 60 && props.length < 400; t++) {
      const x = Math.round(c.x + (r.next() - 0.5) * 2 * c.rx), y = Math.round(c.y + (r.next() - 0.5) * 2 * c.ry);
      if (!clear.has(at(clamp(x, 0, cols - 1), clamp(y, 0, rows - 1)))) continue;
      const k = t % 9;
      if (c.camp) put(x, y, k < 3 ? "stump" : k < 5 ? "rock" : k < 6 ? "boulder" : "tall-grass", true);
      else put(x, y, k < 5 ? "flowers" : k < 7 ? "mushroom" : "tall-grass", true);
      if (props.filter((p) => clear.has(at(p.x, p.y)) && Math.hypot(p.x - c.x, p.y - c.y) <= Math.max(c.rx, c.ry)).length >= 5 + (t > 30 ? 2 : 0)) break;
    }
  }
  // scatter: grass tufts and flowers along the path, a few bushes and flowers in the open
  for (let y = 1; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = at(x, y);
      let nearPath = false;
      for (const [dx, dy] of [[0, -1], [0, 1], [1, 0], [-1, 0]]) if (path.has(at(clamp(x + dx, 0, cols - 1), clamp(y + dy, 0, rows - 1)))) nearPath = true;
      const roll = r.next();
      if (!free(x, y) || dWater[i] <= 1) continue;
      if (nearPath && roll < 0.14) put(x, y, roll < 0.05 ? "bush" : roll < 0.1 ? "tall-grass" : "flowers");
      else if (!nearPath && roll > 0.97 - 0.05 * density) put(x, y, roll > 0.99 ? "bush" : "flowers");
    }

  const start = bridge ? { x: Math.max(1, bridge.x0 - 3), y: yc } : { x: Math.floor(cols / 2), y: Math.floor(rows / 2) };
  return { ground, path, bridge, clearings, trees, props, spawns, start, canopy };
}

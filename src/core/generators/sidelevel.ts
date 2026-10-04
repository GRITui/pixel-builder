// Side-view level: ground runs, gaps, steps/slopes, one-way platforms and ladders as a TileMap.
// `ground` holds solid terrain and platforms, `deco` holds ladders and scenery, so the existing
// Tiled export (ground + deco layers, per-tile "name"/"solid" properties) works unchanged.
// meta.spawn / meta.goal are tile coordinates of the start and the end of the level.
import { rng } from "../rng";
import { emptyTileMap, ensureTile, renderTileMap } from "../tilemap";
import type { Sprite, StyleKit } from "../types";
import { environmentGenerator, environmentIdle } from "./environment";
import { sideviewGenerator } from "./sideview";
import { bool, defaults, mat, num, type Generator, type Params } from "./types";

type Cell = "air" | "solid" | "slope-up" | "slope-down" | "platform";

export interface SideLevelPlan {
  cols: number;
  rows: number;
  cells: Cell[];
  ladders: [number, number][];
  spawn: [number, number];
  goal: [number, number];
}

/** Pure layout: heights per column (top solid row, `rows` = gap), then platforms and ladders. */
export function planSideLevel(cols: number, rows: number, seed: number, difficulty: number, slopes: boolean, withLadders: boolean): SideLevelPlan {
  const r = rng(seed);
  const cells: Cell[] = new Array(cols * rows).fill("air");
  const base = rows - 4;
  const top: number[] = new Array(cols).fill(base);
  let x = 5, level = base;
  const slopeAt = new Map<number, Cell>();
  while (x < cols - 6) {
    const roll = r.next();
    const run = r.int(3, 7);
    if (roll < 0.3 + 0.08 * difficulty) {
      const gap = r.int(2, Math.min(4, 2 + Math.floor(difficulty / 2)));
      for (let i = 0; i < gap && x + i < cols - 5; i++) top[x + i] = rows;
      x += gap;
    } else if (roll < 0.7 && x > 6) {
      const up = level > base - 3 && (level >= base || r.chance(0.5));
      const next = up ? level - 1 : Math.min(base, level + 1);
      if (next !== level) {
        // the step column: a slope tile at the new surface row, or a plain block edge
        if (slopes) slopeAt.set(x, up ? "slope-up" : "slope-down");
        top[x] = slopes ? (up ? next : level) : next;
        level = next;
        x++;
      }
    }
    for (let i = 0; i < run && x < cols - 5; i++, x++) top[x] = level;
    if (x < cols && top[x] === base) level = base;
  }
  // after a gap the ground continues at the previous level; the last columns return to base
  for (let i = cols - 6; i < cols; i++) top[i] = base;
  for (let c = 0; c < cols; c++) {
    if (top[c] >= rows) continue;
    const sl = slopeAt.get(c);
    for (let y = top[c]; y < rows; y++) cells[y * cols + c] = y === top[c] && sl ? sl : "solid";
  }
  // slope-down sits at the old (higher) surface row of a column that drops to the right: its neighbours decide the look
  const ladders: [number, number][] = [];
  const taken = new Set<number>();
  let px = 8;
  while (px < cols - 8) {
    const len = r.int(2, 4);
    const surf = Math.min(...top.slice(px, px + len + 1));
    const py = surf - r.int(3, 4);
    if (py >= 2 && top.slice(px, px + len).every((t) => t >= py + 3) && r.chance(0.55 + 0.05 * difficulty)) {
      for (let i = 0; i < len; i++) { cells[py * cols + px + i] = "platform"; taken.add(py * cols + px + i); }
      if (withLadders && top[px - 1] < rows && top[px - 1] <= py + 4) {
        const lx = px - 1;
        for (let y = py; y < top[lx]; y++) ladders.push([lx, y]);
      }
    }
    px += len + r.int(3, 6);
  }
  const spawnY = top[1] - 1, goalY = top[cols - 2] - 1;
  return { cols, rows, cells, ladders, spawn: [1, spawnY], goal: [cols - 2, goalY] };
}

export const sideLevelGenerator: Generator = {
  id: "sidelevel",
  category: "map",
  label: "Side-view level",
  description: "Platformer level map for the 'kit-side' camera: ground runs, gaps, steps or 45-degree slopes, one-way platforms and ladders. Exports to Tiled with ground (solid terrain + platforms) and deco (ladders, scenery) layers; meta has spawn and goal tiles.",
  params: [
    { key: "cols", label: "Length (tiles)", type: "number", min: 16, max: 96, step: 1, default: 40 },
    { key: "rows", label: "Height (tiles)", type: "number", min: 10, max: 24, step: 1, default: 14 },
    { key: "difficulty", label: "Gaps and platforms (1-5)", type: "number", min: 1, max: 5, step: 1, default: 2 },
    { key: "slopes", label: "45 degree slopes for steps", type: "bool", default: true },
    { key: "ladders", label: "Ladders to platforms", type: "bool", default: true },
    { key: "scenery", label: "Bushes, rocks and flowers", type: "bool", default: true },
    { key: "ground", label: "Grass / cap", type: "material", options: ["grass", "foliage", "sand", "stone", "dirt"], default: "grass" },
    { key: "soil", label: "Soil", type: "material", options: ["dirt", "stone", "sand", "wood"], default: "dirt" },
  ],
  generate(p: Params, kit: StyleKit, seed: number) {
    const cols = num(p, "cols"), rows = num(p, "rows");
    const plan = planSideLevel(cols, rows, seed, num(p, "difficulty"), bool(p, "slopes"), bool(p, "ladders"));
    const T = kit.sizes.tile;
    const tm = emptyTileMap(cols, rows, T);
    const sv = defaults(sideviewGenerator);
    const cache = new Map<string, Sprite>();
    const piece = (kind: string, extra: Params = {}): Sprite => {
      const key = kind + JSON.stringify(extra);
      let s = cache.get(key);
      if (!s) cache.set(key, (s = sideviewGenerator.generate({ ...sv, ground: mat(p, "ground"), soil: mat(p, "soil"), ...extra, kind }, kit, seed).rows[0].frames[0]));
      return s;
    };
    const at = (x: number, y: number): Cell => (x < 0 || x >= cols || y < 0 ? "solid" : y >= rows ? "solid" : plan.cells[y * cols + x]);
    const solid = (c: Cell) => c === "solid";
    // an air cell next to ground at the map edge counts as ground, so edges stay closed
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const c = plan.cells[y * cols + x], i = y * cols + x;
        if (c === "air") continue;
        if (c === "platform") { tm.ground[i] = ensureTile(tm, "platform", piece("platform", { cols: 1 }), true); continue; }
        if (c === "slope-up" || c === "slope-down") { tm.ground[i] = ensureTile(tm, c, piece(c), true); continue; }
        const n = at(x, y - 1) === "air" || at(x, y - 1) === "platform", w = at(x - 1, y) === "air" || at(x - 1, y) === "platform", e = at(x + 1, y) === "air" || at(x + 1, y) === "platform";
        const nw = at(x - 1, y - 1) === "air", ne = at(x + 1, y - 1) === "air";
        const sw = !solid(at(x - 1, y)) && at(x - 1, y) !== "air" && at(x - 1, y) !== "platform"; // slope to the west
        let kind = "ground-fill";
        if (n) kind = w && !e ? "ground-edge-left" : e && !w ? "ground-edge-right" : "ground-top";
        else if (w && !sw) kind = "ground-wall-left";
        else if (e && at(x + 1, y) === "air") kind = "ground-wall-right";
        else if (nw && !w) kind = "ground-inner-left";
        else if (ne && !e) kind = "ground-inner-right";
        // plain soil gets three looks so the level does not read as one stamped tile
        const v = kind === "ground-fill" ? (x * 7 + y * 13) % 3 : 0;
        tm.ground[i] = ensureTile(tm, v ? `${kind}-${v + 1}` : kind, piece(kind, v ? { variant: v } : {}), true);
      }
    for (const [x, y] of plan.ladders) tm.deco[y * cols + x] = ensureTile(tm, "ladder", piece("ladder", { rows: 1 }), false);
    if (bool(p, "scenery")) {
      const r = rng(seed + 99);
      for (let x = 2; x < cols - 2; x++) {
        const row = Array.from({ length: rows }, (_, y) => y).find((y) => plan.cells[y * cols + x] !== "air");
        const rr = r.next(), kind = r.pick(["bush", "rock", "flowers", "tall-grass"]);
        if (row === undefined || row < 1 || plan.cells[row * cols + x] !== "solid" || tm.deco[(row - 1) * cols + x] >= 0 || rr > 0.16) continue;
        if (at(x - 1, row) !== "solid" || at(x + 1, row) !== "solid" || at(x, row - 1) !== "air") continue;
        const sp = environmentIdle({ ...defaults(environmentGenerator), kind, cuttable: false }, kit, seed);
        tm.deco[(row - 1) * cols + x] = ensureTile(tm, kind, sp, false);
      }
    }
    return { rows: [{ name: "map", frames: [renderTileMap(tm)] }], fps: 1, tilemap: tm, meta: { camera: "side", spawn: plan.spawn, goal: plan.goal } };
  },
};

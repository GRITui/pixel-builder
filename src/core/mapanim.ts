// Living maps: compose N frames of a tile map from each tile's / prop's own animation rows.
// Tiles only keep their idle sprite, so the animation is re-derived from the tile *name* by
// regenerating the prop with the same parameters and accepting it only if its idle frame matches
// the stored sprite pixel for pixel (otherwise the tile simply stays still). Deterministic: phases
// come from the cell position, never from Math.random.
import { colorIndex, decodeIndex } from "./palette";
import { blit, createSprite } from "./sprite";
import { environmentGenerator } from "./generators/environment";
import { foliageGenerator } from "./generators/foliage";
import { defaults } from "./generators/types";
import { waterfallFrame } from "./generators/map-terrain";
import type { Sprite, StyleKit, TileMap } from "./types";

export const MAP_FRAMES_DEFAULT = 8;
export const MAP_FPS = 6;

const same = (a: Sprite, b: Sprite) => a.w === b.w && a.h === b.h && a.data.every((v, i) => v === b.data[i]);
// rows that are one-shot actions, not ambient loops
const ACTION_ROWS = new Set(["chop", "fall", "stump", "cut", "break", "idle"]);

function loopOf(rows: { name: string; frames: Sprite[] }[], idle: Sprite): Sprite[] | null {
  if (!rows.length || !same(rows[0].frames[0], idle)) return null;
  const pick = rows.find((r) => r.name === "sway") ?? rows.find((r) => !ACTION_ROWS.has(r.name) && r.frames.length > 1);
  return pick && pick.frames.length > 1 && pick.frames.every((f) => f.w === idle.w && f.h === idle.h) ? pick.frames : null;
}

/** Ambient animation loop for a deco tile, or null when it has none (or its origin cannot be matched). */
function propLoop(name: string, idle: Sprite, kit: StyleKit, seed: number): Sprite[] | null {
  const tree = /^tree-(.+)-(small|medium|large)-([a-z]+)-(\d+)$/.exec(name);
  if (tree) {
    const [, species, size, season, v] = tree;
    const g = foliageGenerator;
    const rows = g.generate({ ...defaults(g), species, size, season, variant: Number(v) }, kit, 1 + Number(v)).rows;
    return loopOf(rows, idle);
  }
  const m = /^(.+)-(\d+)$/.exec(name);
  if (!m) return null;
  const kind = m[1], n = Number(m[2]);
  const env = defaults(environmentGenerator);
  for (const variant of [n * 3 + (kind.length % 3), n]) {
    try {
      const rows = environmentGenerator.generate({ ...env, kind, variant }, kit, seed).rows;
      if (rows[0] && same(rows[0].frames[0], idle)) return loopOf(rows, idle);
    } catch { /* unknown kind: static */ }
  }
  return null;
}

const WATER_LEN = 4;
/** Water pixels shimmer by +-1 shade following the environment generator's own water-tile frames. */
function waterLoop(base: Sprite, ref: Sprite[]): Sprite[] | null {
  const water: number[] = [];
  base.data.forEach((v, i) => { const d = v ? decodeIndex(v) : null; if (d?.mat === "water" && d.level >= 1 && d.level <= 3) water.push(i); });
  if (!water.length || base.w !== ref[0].w || base.h !== ref[0].h) return null;
  return ref.map((rf, f) => {
    const out: Sprite = { ...base, data: base.data.slice() };
    if (f === 0) return out;
    for (const i of water) {
      const a = decodeIndex(rf.data[i])?.level ?? 2, b = decodeIndex(ref[0].data[i])?.level ?? 2;
      const d = Math.sign(a - b), L = decodeIndex(base.data[i])!.level;
      if (d) out.data[i] = colorIndex("water", Math.max(1, Math.min(3, L + d)));
    }
    return out;
  });
}

const hash = (a: number, b: number) => { let h = (a * 374761393 + b * 668265263) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return (h ^ (h >>> 16)) >>> 0; };

export interface MapAnimator {
  /** Ground tile sprite for frame f (water shimmers; everything else is static). */
  ground(tile: number, f: number): Sprite;
  /** Deco sprite for the object at (col,row) in frame f; each object has its own phase. */
  deco(tile: number, col: number, row: number, f: number): Sprite;
}

export function mapAnimator(tm: TileMap, kit: StyleKit, seed = 0): MapAnimator {
  const ref = environmentGenerator.generate({ ...defaults(environmentGenerator), kind: "water-tile" }, kit, seed).rows[0].frames.slice(0, WATER_LEN);
  const groundLoops = new Map<number, Sprite[] | null>();
  const decoLoops = new Map<number, Sprite[] | null>();
  return {
    ground(i, f) {
      if (tm.tiles[i].name.startsWith("waterfall-")) return waterfallFrame(tm.tiles[i].sprite, tm.tiles[i].name, f);
      if (!groundLoops.has(i)) groundLoops.set(i, waterLoop(tm.tiles[i].sprite, ref));
      const lp = groundLoops.get(i);
      return lp ? lp[f % lp.length] : tm.tiles[i].sprite;
    },
    deco(i, col, row, f) {
      if (!decoLoops.has(i)) decoLoops.set(i, propLoop(tm.tiles[i].name, tm.tiles[i].sprite, kit, seed));
      const lp = decoLoops.get(i);
      return lp ? lp[(f + hash(col, row)) % lp.length] : tm.tiles[i].sprite;
    },
  };
}

/**
 * Render `n` frames (2..24) of an orthogonal tile map. Water flows in step across the map (it tiles);
 * every prop gets its own phase offset so a grove does not sway in unison.
 */
export function renderMapFrames(tm: TileMap, kit: StyleKit, n = MAP_FRAMES_DEFAULT, seed = 0): Sprite[] {
  const count = Math.max(2, Math.min(24, Math.round(n)));
  const T = tm.tile, an = mapAnimator(tm, kit, seed);
  const frames: Sprite[] = [];
  for (let f = 0; f < count; f++) {
    const out = createSprite(tm.cols * T, tm.rows * T);
    for (let y = 0; y < tm.rows; y++)
      for (let x = 0; x < tm.cols; x++) {
        const i = tm.ground[y * tm.cols + x];
        if (tm.tiles[i]) blit(out, an.ground(i, f), x * T, y * T);
      }
    for (let y = 0; y < tm.rows; y++)
      for (let x = 0; x < tm.cols; x++) {
        const i = tm.deco[y * tm.cols + x];
        if (!tm.tiles[i]) continue;
        const s = an.deco(i, x, y, f);
        blit(out, s, x * T + Math.floor((T - s.w) / 2), (y + 1) * T - s.h);
      }
    frames.push(out);
  }
  return frames;
}

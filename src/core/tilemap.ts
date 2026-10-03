import { blit, createSprite } from "./sprite";
import type { Sprite, TileMap } from "./types";

export function emptyTileMap(cols: number, rows: number, tile: number): TileMap {
  return { cols, rows, tile, tiles: [], ground: new Array(cols * rows).fill(-1), deco: new Array(cols * rows).fill(-1) };
}

/**
 * Render a tilemap to a single sprite. Ground tiles fill their cell; deco
 * sprites (trees, rocks — often taller than a tile) are anchored bottom-centre
 * on their cell and drawn top-to-bottom so nearer props overlap farther ones.
 */
export function renderTileMap(tm: TileMap): Sprite {
  const out = createSprite(tm.cols * tm.tile, tm.rows * tm.tile);
  for (let y = 0; y < tm.rows; y++)
    for (let x = 0; x < tm.cols; x++) {
      const t = tm.tiles[tm.ground[y * tm.cols + x]];
      if (t) blit(out, t.sprite, x * tm.tile, y * tm.tile);
    }
  for (let y = 0; y < tm.rows; y++)
    for (let x = 0; x < tm.cols; x++) {
      const t = tm.tiles[tm.deco[y * tm.cols + x]];
      if (!t) continue;
      const s = t.sprite;
      blit(out, s, x * tm.tile + Math.floor((tm.tile - s.w) / 2), (y + 1) * tm.tile - s.h);
    }
  return out;
}

/** Add a tile to the set (or reuse an identical-name one) and return its index. */
export function ensureTile(tm: TileMap, name: string, sprite: Sprite, solid = false): number {
  const i = tm.tiles.findIndex((t) => t.name === name);
  if (i >= 0) return i;
  tm.tiles.push({ name, sprite, solid });
  return tm.tiles.length - 1;
}

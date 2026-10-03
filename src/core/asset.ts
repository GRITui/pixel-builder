import { newId } from "./kit";
import type { Asset, Category, FrameSet, StyleKit, TileMap } from "./types";

export function createAsset(a: {
  name: string;
  category: Category;
  kit: StyleKit;
  rows: FrameSet[];
  fps?: number;
  source: Asset["source"];
  tilemap?: TileMap;
  meta?: Record<string, unknown>;
  tags?: string[];
}): Asset {
  const now = Date.now();
  return {
    id: newId("asset"),
    name: a.name,
    category: a.category,
    kitId: a.kit.id,
    rows: a.rows,
    fps: a.fps ?? 6,
    source: a.source,
    tilemap: a.tilemap,
    meta: a.meta,
    tags: a.tags ?? [],
    createdAt: now,
    updatedAt: now,
  };
}

export function frameCount(a: Asset): number {
  return a.rows.reduce((n, r) => n + r.frames.length, 0);
}

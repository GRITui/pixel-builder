import { generatorById } from "../../core/generators";
import { coerceParams } from "../../core/generators/types";
import type { Asset, StyleKit } from "../../core/types";

/** Re-run a procedural asset's generator (stored params + seed) with `kit`. */
export function rerenderAsset(a: Asset, kit: StyleKit): Asset {
  const g = a.source.generator ? generatorById(a.source.generator) : undefined;
  if (!g || a.source.seed === undefined) return a;
  const r = g.generate(coerceParams(g, (a.source.params ?? {}) as Record<string, unknown>), kit, a.source.seed);
  return { ...a, kitId: kit.id, rows: r.rows, fps: r.fps, tilemap: r.tilemap, meta: r.meta ?? a.meta, updatedAt: Date.now() };
}

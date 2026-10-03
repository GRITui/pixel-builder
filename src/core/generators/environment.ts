// STUB — owned by Lane A. Replace the implementation; keep the exported name,
// the `kind` option strings and their meaning (map.ts relies on them).
import { finalize } from "../enforce";
import { Painter } from "../painter";
import type { Generator } from "./types";
import { str } from "./types";

/** Seamless ground tiles (no outline, exactly kit.sizes.tile square, must tile/wrap). */
export const TILE_KINDS = ["grass-tile", "dirt-tile", "sand-tile", "water-tile", "stone-path-tile", "snow-tile"] as const;
/** Free-standing props (outlined, transparent background). */
export const PROP_KINDS = ["oak", "pine", "palm", "dead-tree", "bush", "rock", "boulder", "flowers", "mushroom", "tall-grass", "stump", "crystal"] as const;

export const environmentGenerator: Generator = {
  id: "environment",
  category: "environment",
  label: "Environment",
  description: "Nature props (trees, bushes, rocks, flowers, crystals) and seamless ground tiles (grass, dirt, sand, animated water, stone path, snow).",
  params: [{ key: "kind", label: "Kind", type: "select", options: [...PROP_KINDS, ...TILE_KINDS], default: "oak" }],
  generate(p, kit) {
    const kind = str(p, "kind");
    const tile = (TILE_KINDS as readonly string[]).includes(kind);
    const S = tile ? kit.sizes.tile : kit.sizes.environment;
    const P = new Painter(S, S, kit);
    if (tile) P.box(0, 0, S, S, kind.startsWith("water") ? "water" : kind.startsWith("sand") ? "sand" : kind.startsWith("dirt") ? "dirt" : "grass");
    else P.ellipse(S / 2, S / 2, S / 3, S / 3, "foliage");
    return { rows: [{ name: "idle", frames: [tile ? P.toSprite() : finalize(P.toSprite(), kit)] }], fps: 4 };
  },
};

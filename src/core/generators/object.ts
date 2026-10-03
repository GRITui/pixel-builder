// STUB — owned by Lane B. Replace the implementation; keep the exported name.
import { finalize } from "../enforce";
import { Painter } from "../painter";
import type { Generator } from "./types";

export const objectGenerator: Generator = {
  id: "object",
  category: "object",
  label: "Object / Item",
  description: "Props and items: chest, barrel, crate, potion, sword, coin, key, torch, sign, pot, gem, scroll, heart.",
  params: [{ key: "kind", label: "Kind", type: "select", options: ["chest"], default: "chest" }],
  generate(_p, kit) {
    const S = kit.sizes.object;
    const P = new Painter(S, S, kit);
    P.box(2, 4, S - 4, S - 6, "wood");
    return { rows: [{ name: "idle", frames: [finalize(P.toSprite(), kit)] }], fps: 6 };
  },
};

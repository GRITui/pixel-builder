// STUB — owned by Lane A. Replace the implementation; keep the exported name.
import { createSprite } from "../sprite";
import type { Generator } from "./types";

export const mapGenerator: Generator = {
  id: "map",
  category: "map",
  label: "Map",
  description: "Procedural top-down tile map (meadow, forest, island, desert, winter) built from the kit's ground tiles and props.",
  params: [{ key: "biome", label: "Biome", type: "select", options: ["meadow"], default: "meadow" }],
  generate(_p, kit) {
    const t = kit.sizes.tile;
    return {
      rows: [{ name: "map", frames: [createSprite(t * 8, t * 8)] }],
      fps: 1,
      tilemap: { cols: 8, rows: 8, tile: t, tiles: [], ground: new Array(64).fill(-1), deco: new Array(64).fill(-1) },
    };
  },
};

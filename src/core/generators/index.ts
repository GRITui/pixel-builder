import type { Category } from "../types";
import { animalGenerator } from "./animal";
import { buildingGenerator } from "./building";
import { characterGenerator } from "./character";
import { environmentGenerator } from "./environment";
import { foliageGenerator } from "./foliage";
import { isoBuildingGenerator, isoPropGenerator, isoTileGenerator } from "./iso";
import { isoMapGenerator } from "./isomap";
import { mapGenerator } from "./map";
import { tilesetGenerator } from "./tileset";
import { objectGenerator } from "./object";
import { sideEnemyGenerator } from "./sideenemy";
import { sideLevelGenerator } from "./sidelevel";
import { sideviewGenerator } from "./sideview";
import type { Generator } from "./types";
import { uiGenerator } from "./ui";

export const GENERATORS: Generator[] = [characterGenerator, animalGenerator, buildingGenerator, environmentGenerator, objectGenerator, uiGenerator, mapGenerator, tilesetGenerator, sideviewGenerator, sideEnemyGenerator, sideLevelGenerator, foliageGenerator, isoTileGenerator, isoPropGenerator, isoBuildingGenerator, isoMapGenerator];

/** Primary generator for a category (the first registered; "character" also has "animal"). */
export function generatorFor(category: Category): Generator {
  return GENERATORS.find((g) => g.category === category)!;
}

export function generatorById(id: string): Generator | undefined {
  return GENERATORS.find((g) => g.id === id);
}

export * from "./types";

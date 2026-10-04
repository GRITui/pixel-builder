import type { Category } from "../types";
import { animalGenerator } from "./animal";
import { buildingGenerator } from "./building";
import { characterGenerator } from "./character";
import { environmentGenerator } from "./environment";
import { mapGenerator } from "./map";
import { tilesetGenerator } from "./tileset";
import { objectGenerator } from "./object";
import type { Generator } from "./types";
import { uiGenerator } from "./ui";

export const GENERATORS: Generator[] = [characterGenerator, animalGenerator, buildingGenerator, environmentGenerator, objectGenerator, uiGenerator, mapGenerator, tilesetGenerator];

/** Primary generator for a category (the first registered; "character" also has "animal"). */
export function generatorFor(category: Category): Generator {
  return GENERATORS.find((g) => g.category === category)!;
}

export function generatorById(id: string): Generator | undefined {
  return GENERATORS.find((g) => g.id === id);
}

export * from "./types";

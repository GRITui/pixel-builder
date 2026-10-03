import type { Category } from "../types";
import { buildingGenerator } from "./building";
import { characterGenerator } from "./character";
import { environmentGenerator } from "./environment";
import { mapGenerator } from "./map";
import { objectGenerator } from "./object";
import type { Generator } from "./types";
import { uiGenerator } from "./ui";

export const GENERATORS: Generator[] = [characterGenerator, buildingGenerator, environmentGenerator, objectGenerator, uiGenerator, mapGenerator];

export function generatorFor(category: Category): Generator {
  return GENERATORS.find((g) => g.category === category)!;
}

export function generatorById(id: string): Generator | undefined {
  return GENERATORS.find((g) => g.id === id);
}

export * from "./types";

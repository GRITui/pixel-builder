// STUB (issues #6, #7): rigged animal generator (quadrupeds + birds).
import { createSprite } from "../sprite";
import type { Generator } from "./types";

export const animalGenerator: Generator = {
  id: "animal",
  category: "character",
  label: "Animal",
  description: "Rigged animals with idle/walk/graze animations: water buffalo, dog, cat, horse, pig, chicken, rooster, duck.",
  params: [{ key: "species", label: "Species", type: "select", options: ["water-buffalo"], default: "water-buffalo" }],
  generate(_p, kit) {
    return { rows: [{ name: "idle-down", frames: [createSprite(kit.sizes.character, kit.sizes.character)] }], fps: 4 };
  },
};

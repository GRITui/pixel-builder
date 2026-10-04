// Rigged animals (issues #6, #7): quadrupeds and birds rendered through renderRig.
// Animals are sized against the kit's human figure (proportions(kit).figure), so a
// horse stands taller than a character and a chicken comes up to its knee in every kit.
import { renderRig } from "../rig";
import { BIRD_CLIPS, birdRig } from "../rigs/bird";
import { FISH_CLIPS, fishRig } from "../rigs/fish";
import { QUADRUPED_CLIPS, quadrupedRig } from "../rigs/quadruped";
import { fitRigToWorld } from "../rigs/fit";
import type { Material } from "../palette";
import { mat, PAINT, str, type Generator } from "./types";

export const ANIMAL_SPECIES = ["water-buffalo", "dog", "cat", "horse", "pig", "chicken", "rooster", "duck", "cow", "sheep", "fish", "catfish"];
const BIRDS = ["chicken", "rooster", "duck"];
const FISH = ["fish", "catfish"];
export const ANIMAL_AGES = ["adult", "baby"];

/** The animals a farm game needs, per setting (names are `animal` species ids). */
export const FARM_SETS = {
  normal: ["dog", "cat", "cow", "chicken", "sheep", "fish"],
  sea: ["dog", "cat", "water-buffalo", "chicken", "pig", "fish"],
} as const;

export { ANIMAL_SCALE, BABY_RATIO, MIN_READABLE_BABY_HEIGHT, MIN_READABLE_HEIGHT, animalCanvas, animalTargetHeight } from "../rigs/fit";

export const animalGenerator: Generator = {
  id: "animal",
  category: "character",
  label: "Animal",
  description: "Rigged animals with idle/walk/graze (quadrupeds), idle/walk/peck/flap (birds) or idle/swim (fish, seen from above) animations: water buffalo, dog, cat, horse, pig, cow, sheep, chicken, rooster, duck, fish, catfish. `age: baby` gives the calf/lamb/puppy/chick/fry. Sized against the kit's human figure (buffalo/horse canvases are larger than the character canvas).",
  params: [
    { key: "species", label: "Species", type: "select", options: ANIMAL_SPECIES, default: "water-buffalo" },
    { key: "age", label: "Age", type: "select", options: ANIMAL_AGES, default: "adult" },
    { key: "coat", label: "Coat / feathers", type: "material", options: PAINT, default: "stone" },
    { key: "accent", label: "Horns / comb / markings", type: "material", options: PAINT, default: "sand" },
    { key: "variant", label: "Variant (patches, horn length, tail)", type: "number", min: 0, max: 3, default: 0 },
    { key: "use_species_coat", label: "Use species default coat", type: "bool", default: true },
  ],
  generate(p, kit, _seed) {
    const species = ANIMAL_SPECIES.includes(str(p, "species")) ? str(p, "species") : "water-buffalo";
    const bird = BIRDS.includes(species);
    const fish = FISH.includes(species);
    const age = str(p, "age") === "baby" ? "baby" : "adult";
    const baby = age === "baby";
    const variant = Math.max(0, Math.min(3, Math.round(Number(p.variant) || 0)));
    const base = bird ? birdRig(species, variant, baby) : fish ? fishRig(species === "fish" ? "carp" : species, variant, baby) : quadrupedRig(species, variant, baby);
    const clips = bird ? BIRD_CLIPS : fish ? FISH_CLIPS : QUADRUPED_CLIPS;
    const slots: Record<string, Material> = {};
    if (!p.use_species_coat) {
      slots[bird || fish ? "body" : "coat"] = mat(p, "coat");
      slots.accent = mat(p, "accent");
    }
    const fit = fitRigToWorld(base, kit, slots, clips, { family: bird ? "bird" : fish ? "fish" : "quadruped", species, baby })!;
    const rows = renderRig({ rig: fit.rig, kit, slots, size: fit.size }, fit.clips);
    return { rows, fps: 6 };
  },
};

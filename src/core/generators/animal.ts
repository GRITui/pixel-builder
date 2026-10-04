// Rigged animals (issues #6, #7): quadrupeds and birds rendered through renderRig.
import { renderRig, type RigDef } from "../rig";
import { BIRD_CLIPS, BIRD_RIGS } from "../rigs/bird";
import { QUADRUPED_CLIPS, QUADRUPED_RIGS } from "../rigs/quadruped";
import type { Material } from "../palette";
import { rng } from "../rng";
import { mat, PAINT, str, type Generator } from "./types";

const ALL = [...QUADRUPED_RIGS, ...BIRD_RIGS];
const SPECIES = ["water-buffalo", "dog", "cat", "horse", "pig", "chicken", "rooster", "duck"];
const rigFor = (species: string): { rig: RigDef; bird: boolean } => {
  const rig = ALL.find((r) => r.id.endsWith(`-${species}`)) ?? QUADRUPED_RIGS[0];
  return { rig, bird: rig.id.startsWith("bird-") };
};

// Species default coats (the rig's own slot defaults).
export const animalGenerator: Generator = {
  id: "animal",
  category: "character",
  label: "Animal",
  description: "Rigged animals with idle/walk/graze (quadrupeds) or idle/walk/peck/flap (birds) animations: water buffalo, dog, cat, horse, pig, chicken, rooster, duck.",
  params: [
    { key: "species", label: "Species", type: "select", options: SPECIES, default: "water-buffalo" },
    { key: "coat", label: "Coat / feathers", type: "material", options: PAINT, default: "stone" },
    { key: "accent", label: "Horns / comb / markings", type: "material", options: PAINT, default: "sand" },
    { key: "variant", label: "Variant", type: "number", min: 0, max: 3, default: 0 },
    { key: "use_species_coat", label: "Use species default coat", type: "bool", default: true },
  ],
  generate(p, kit, seed) {
    const { rig, bird } = rigFor(str(p, "species"));
    const r = rng(seed);
    const variant = Number(p.variant) || 0;
    const slots: Record<string, Material> = {};
    if (!p.use_species_coat) {
      slots[bird ? "body" : "coat"] = mat(p, "coat");
      slots.accent = mat(p, "accent");
    }
    // variant 1..3: darker/lighter markings via tone are not available per slot, so swap the secondary parts
    if (variant === 1 && !bird) slots.hoof = "wood";
    void r;
    const rows = renderRig({ rig, kit, slots }, bird ? BIRD_CLIPS : QUADRUPED_CLIPS);
    return { rows, fps: 6 };
  },
};

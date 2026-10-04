// Rigged animals (issues #6, #7): quadrupeds and birds rendered through renderRig.
// Animals are sized against the kit's human figure (proportions(kit).figure), so a
// horse stands taller than a character and a chicken comes up to its knee in every kit.
import { proportions } from "../kit";
import { renderRig, renderRigFrame, type Clip, type PartDef, type RigDef } from "../rig";
import { BIRD_CLIPS, birdRig } from "../rigs/bird";
import { FISH_CLIPS, fishRig } from "../rigs/fish";
import { QUADRUPED_CLIPS, quadrupedRig } from "../rigs/quadruped";
import type { Material } from "../palette";
import type { StyleKit } from "../types";
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

/** Standing height as a multiple of the human figure, and the canvas as a multiple of the character canvas. */
export const ANIMAL_SCALE: Record<string, { height: number; canvas: number }> = {
  "water-buffalo": { height: 1.1, canvas: 1.5 },
  horse: { height: 1.3, canvas: 1.5 },
  dog: { height: 0.55, canvas: 1 },
  pig: { height: 0.55, canvas: 1 },
  cat: { height: 0.4, canvas: 1 },
  chicken: { height: 0.35, canvas: 1 },
  duck: { height: 0.35, canvas: 1 },
  rooster: { height: 0.45, canvas: 1 },
  cow: { height: 1.1, canvas: 1.5 },
  sheep: { height: 0.75, canvas: 1 },
  // fish are seen from above: "height" is the body length (they have no ground to stand on)
  fish: { height: 0.7, canvas: 1 },
  catfish: { height: 0.8, canvas: 1 },
};

/** Babies are about this fraction of the adult, but never below their own (smaller) readable floor. */
export const BABY_RATIO = 0.55;
export const MIN_READABLE_BABY_HEIGHT = 7;

/** Smallest height (px) at which a creature still reads at 1x; tiny species are clamped up to it on small kits. */
export const MIN_READABLE_HEIGHT = 9;
export const animalTargetHeight = (species: string, kit: StyleKit, age: string = "adult") => {
  const raw = proportions(kit).figure * (ANIMAL_SCALE[species]?.height ?? 1);
  if (age === "baby") return Math.max(Math.min(MIN_READABLE_BABY_HEIGHT, kit.sizes.character - 2), raw * BABY_RATIO);
  return Math.max(Math.min(MIN_READABLE_HEIGHT, kit.sizes.character - 2), raw);
};
/** Babies fit the plain character canvas; adult buffalo, cow and horse need the wide one. */
export const animalCanvas = (species: string, kit: StyleKit, age: string = "adult") =>
  Math.round(kit.sizes.character * (age === "baby" ? 1 : ANIMAL_SCALE[species]?.canvas ?? 1));

type Affine = { k: number; ox: number; oy: number };

/** Re-express a rig on a 1:1 pixel grid, scaled by k and shifted by (ox, oy) pixels (poses scale with it). */
function fitRig(rig: RigDef, size: number, a: Affine): RigDef {
  const g = rig.grid, f = (size / g) * a.k;
  const pt = (v: [number, number]): [number, number] => [v[0] * f + a.ox, v[1] * f + a.oy];
  const joints = rig.joints.map((j) => {
    const r = j.rest as unknown;
    const perView = r !== null && typeof r === "object" && !Array.isArray(r);
    const rest = perView
      ? Object.fromEntries(Object.entries(r as Record<string, [number, number]>).map(([v, p]) => [v, pt(p)]))
      : pt(r as [number, number]);
    return { ...j, rest: rest as typeof j.rest };
  });
  const parts = rig.parts.map((p): PartDef => {
    switch (p.kind) {
      case "ellipse": return { ...p, rx: p.rx * f, ry: p.ry * f, dx: (p.dx ?? 0) * f, dy: (p.dy ?? 0) * f };
      case "box": return { ...p, w: p.w * f, h: p.h * f, dx: (p.dx ?? 0) * f, dy: (p.dy ?? 0) * f };
      case "limb": return { ...p, r: p.r * f };
      default: return p;
    }
  });
  return { ...rig, grid: size, joints, parts };
}

const fitClips = (clips: Clip[], size: number, rig: RigDef, a: Affine): Clip[] => {
  const f = (size / rig.grid) * a.k;
  const sc = (poses: Clip["frames"] extends infer T ? T : never) => {
    const one = (ps: Record<string, [number, number]>[]) => ps.map((p) => Object.fromEntries(Object.entries(p).map(([j, v]) => [j, [v[0] * f, v[1] * f] as [number, number]])));
    return Array.isArray(poses) ? one(poses) : Object.fromEntries(Object.entries(poses).map(([v, ps]) => [v, one(ps as never)]));
  };
  return clips.map((c) => ({ ...c, frames: sc(c.frames) as Clip["frames"] }));
};

interface Box { minx: number; maxx: number; maxy: number; miny: number }
/** Bounding box of the idle side pose, measured on a roomy scratch canvas so nothing clips. */
function measure(rig: RigDef, kit: StyleKit, slots: Record<string, Material>, size: number, k: number): Box {
  const M = size * 6;
  const fitted = fitRig(rig, size, { k, ox: size * 2, oy: size * 4 });
  const s = renderRigFrame({ rig: { ...fitted, grid: M }, kit, slots, size: M }, "right", {});
  const b: Box = { minx: M, maxx: -1, maxy: -1, miny: M };
  for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) if (s.data[y * M + x]) {
    b.minx = Math.min(b.minx, x); b.maxx = Math.max(b.maxx, x); b.miny = Math.min(b.miny, y); b.maxy = Math.max(b.maxy, y);
  }
  return b;
}

const cache = new Map<string, Affine>();
/** Find the scale that gives the target opaque height, then centre and ground-align on the canvas. */
function fit(rig: RigDef, kit: StyleKit, slots: Record<string, Material>, size: number, target: number, swimmer = false): Affine {
  const key = `${swimmer}|${rig.id}|${size}|${target}|${kit.id}|${kit.outline}|${JSON.stringify(slots)}|${rig.parts.length}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let lo = 0.15, hi = 3, best = 1, bestErr = Infinity;
  for (let i = 0; i < 16; i++) {
    const k = (lo + hi) / 2;
    const b = measure(rig, kit, slots, size, k);
    const h = swimmer ? b.maxx - b.minx + 1 : b.maxy - b.miny + 1;
    const err = Math.abs(h - target);
    if (err < bestErr - 1e-9 || (err === bestErr && Math.abs(k - 1) < Math.abs(best - 1))) { bestErr = err; best = k; }
    if (h < target) lo = k; else hi = k;
  }
  const b = measure(rig, kit, slots, size, best);
  const out = {
    k: best,
    ox: size * 2 + Math.round(size / 2 - (b.minx + b.maxx + 1) / 2),
    // swimmers float: centred both ways instead of standing on the ground line
    oy: size * 4 + (swimmer ? Math.round(size / 2 - (b.miny + b.maxy + 1) / 2) : size - 2 - b.maxy),
  };
  cache.set(key, out);
  return out;
}

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
    const size = animalCanvas(species, kit, age);
    const a = fit(base, kit, slots, size, Math.max(3, Math.round(animalTargetHeight(species, kit, age))), fish);
    const rig = fitRig(base, size, a);
    const rows = renderRig({ rig, kit, slots, size }, fitClips(clips, size, base, a));
    return { rows, fps: 6 };
  },
};

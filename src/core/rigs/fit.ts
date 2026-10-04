// One world scale for rigged animals (issue #24). The `animal` generator, generate_rigged, project
// re-render and the Rigged workspace all fit quadruped/bird/fish rigs through here, so a buffalo is the
// same size on every path. Species and age come from the rig id (`quadruped-cow-baby`, `fish-carp`).
import { proportions } from "../kit";
import { renderRigFrame, type Clip, type PartDef, type RigDef } from "../rig";
import type { Material } from "../palette";
import type { StyleKit } from "../types";

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

export type Affine = { k: number; ox: number; oy: number };

/** Re-express a rig on a 1:1 pixel grid, scaled by k and shifted by (ox, oy) pixels (poses scale with it). */
export function fitRig(rig: RigDef, size: number, a: Affine): RigDef {
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

export const fitClips = (clips: Clip[], size: number, rig: RigDef, a: Affine): Clip[] => {
  const f = (size / rig.grid) * a.k;
  const sc = (poses: Clip["frames"] extends infer T ? T : never) => {
    const one = (ps: Record<string, [number, number]>[]) => ps.map((p) => Object.fromEntries(Object.entries(p).map(([j, v]) => [j, [v[0] * f, v[1] * f] as [number, number]])));
    return Array.isArray(poses) ? one(poses) : Object.fromEntries(Object.entries(poses).map(([v, ps]) => [v, one(ps as never)]));
  };
  return clips.map((c) => ({ ...c, frames: sc(c.frames) as Clip["frames"] }));
};

interface Box { minx: number; maxx: number; maxy: number; miny: number }
/** Opaque bounds of the idle side pose with the rig placed at (ox, oy) on an M x M scratch canvas. */
function bounds(rig: RigDef, kit: StyleKit, slots: Record<string, Material>, size: number, k: number, M: number, ox: number, oy: number): Box {
  const fitted = fitRig(rig, size, { k, ox, oy });
  const s = renderRigFrame({ rig: { ...fitted, grid: M }, kit, slots, size: M }, "right", {});
  const b: Box = { minx: M, maxx: -1, maxy: -1, miny: M };
  for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) if (s.data[y * M + x]) {
    b.minx = Math.min(b.minx, x); b.maxx = Math.max(b.maxx, x); b.miny = Math.min(b.miny, y); b.maxy = Math.max(b.maxy, y);
  }
  return b;
}
/**
 * Bounding box of the idle side pose in the roomy frame (canvas 6x, origin 2x/4x) so nothing clips.
 * Most poses fit a cheaper 4x canvas; if the shape touches its edge we re-measure on the roomy one.
 */
function measure(rig: RigDef, kit: StyleKit, slots: Record<string, Material>, size: number, k: number): Box {
  const M = size * 4;
  const b = bounds(rig, kit, slots, size, k, M, size, size);
  if (b.maxx >= 0 && b.minx > 0 && b.miny > 0 && b.maxx < M - 1 && b.maxy < M - 1)
    return { minx: b.minx + size, maxx: b.maxx + size, miny: b.miny + size * 3, maxy: b.maxy + size * 3 };
  return bounds(rig, kit, slots, size, k, size * 6, size * 2, size * 4);
}

const cache = new Map<string, Affine>();
/** Find the scale that gives the target opaque height, then centre and ground-align on the canvas. */
export function fitWorldAffine(rig: RigDef, kit: StyleKit, slots: Record<string, Material>, size: number, target: number, swimmer = false): Affine {
  // slots only recolour, they never change the silhouette, so the key (and the measuring) ignores them
  const key = `${swimmer}|${rig.id}|${size}|${target}|${kit.id}|${kit.outline}|${rig.parts.length}`;
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

export type AnimalFamily = "quadruped" | "bird" | "fish";
export interface AnimalInfo { family: AnimalFamily; species: string; baby: boolean }

/** `quadruped-cow-baby` -> cow, baby. Fish ids use the generator's species names (`fish-carp` is "fish"). */
export function animalInfo(rigId: string): AnimalInfo | undefined {
  const m = /^(quadruped|bird|fish)-([a-z-]+?)(-baby)?$/.exec(rigId);
  if (!m) return undefined;
  const family = m[1] as AnimalFamily;
  const species = family === "fish" && m[2] === "carp" ? "fish" : m[2];
  return ANIMAL_SCALE[species] ? { family, species, baby: !!m[3] } : undefined;
}

export interface WorldFit { rig: RigDef; clips: Clip[]; size: number }

/** Fit a rig to world scale. `info` defaults to what the rig id says; undefined for humanoid/custom rigs. */
export function fitRigToWorld(rig: RigDef, kit: StyleKit, slots: Record<string, Material>, clips: Clip[], info = animalInfo(rig.id)): WorldFit | undefined {
  if (!info) return undefined;
  const age = info.baby ? "baby" : "adult";
  const size = animalCanvas(info.species, kit, age);
  const a = fitWorldAffine(rig, kit, slots, size, Math.max(3, Math.round(animalTargetHeight(info.species, kit, age))), info.family === "fish");
  return { rig: fitRig(rig, size, a), clips: fitClips(clips, size, rig, a), size };
}

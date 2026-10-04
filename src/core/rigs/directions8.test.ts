import { describe, expect, it } from "vitest";
import { KIT_PRESETS } from "../kit";
import { renderRig, renderRigFrame, solvePose, clipFrames, DIRS, DIRS8, type Clip, type RigDef } from "../rig";
import { HUMANOID_RIGS } from "./humanoid";
import { QUADRUPED_CLIPS, QUADRUPED_RIGS } from "./quadruped";
import { WALK } from "./example";
import { characterGenerator } from "../generators/character";
import { animalGenerator } from "../generators/animal";
import { defaults } from "../generators/types";
import type { Sprite } from "../types";

const kit = KIT_PRESETS[0];
const rig = HUMANOID_RIGS[1];
const ORDER = ["down", "down-right", "right", "up-right", "up", "up-left", "left", "down-left"];

const bbox = (s: Sprite) => {
  let top = s.h, bot = -1;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.data[y * s.w + x]) { top = Math.min(top, y); bot = Math.max(bot, y); }
  return [top, bot];
};

describe("8-direction rigs", () => {
  it("names rows in document order and keeps 4 as default", () => {
    const r8 = renderRig({ rig, kit }, [WALK], { directions: 8 });
    expect(r8.map((r) => r.name)).toEqual(ORDER.map((d) => `walk-${d}`));
    expect(DIRS8).toEqual(ORDER);
    const r4 = renderRig({ rig, kit }, [WALK]);
    expect(r4.map((r) => r.name)).toEqual(DIRS.map((d) => `walk-${d}`));
    expect(renderRig({ rig, kit }, [WALK], { directions: 4 })).toEqual(r4);
  });

  it("left diagonals mirror the right ones with lighting re-lit", () => {
    const a = renderRigFrame({ rig, kit }, "down-right");
    const b = renderRigFrame({ rig, kit }, "down-left");
    expect(a.w).toBe(b.w);
    const filled = (s: Sprite) => Array.from({ length: s.w * s.h }, (_, i) => (s.data[i] ? 1 : 0));
    const mirrored = Array.from({ length: a.w * a.h }, (_, i) => filled(a)[Math.floor(i / a.w) * a.w + (a.w - 1 - (i % a.w))]);
    expect(filled(b)).toEqual(mirrored);
    expect(Array.from(b.data)).not.toEqual(Array.from(a.data)); // shading differs from a plain flip
  });

  it("interpolates diagonal joints when no rest pose is given", () => {
    const tiny: RigDef = {
      id: "t", name: "t", grid: 32, slots: {}, parts: [],
      joints: [{ id: "a", parent: null, rest: { down: [10, 10], side: [20, 14], up: [10, 10] } }],
    };
    expect(solvePose(tiny, "down-side").a).toEqual([15, 12]);
    expect(solvePose(tiny, "up-side").a).toEqual([15, 12]);
  });

  it("borrows side frames (x foreshortened) for diagonal clips", () => {
    const clip: Clip = { id: "c", fps: 1, frames: { side: [{ a: [4, 2] }], down: [{}] } };
    expect(clipFrames(clip, "down-side")).toEqual([{ a: [3, 2] }]);
  });

  it("keeps a consistent silhouette height across the 8 directions", () => {
    const rows = renderRig({ rig, kit }, [WALK], { directions: 8 });
    const heights = rows.map((r) => { const [t, b] = bbox(r.frames[0]); return b - t; });
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(3);
    const q = QUADRUPED_RIGS[0];
    const qs = renderRig({ rig: q, kit }, [QUADRUPED_CLIPS[0]], { directions: 8 });
    const bots = qs.map((r) => bbox(r.frames[0])[1]);
    expect(Math.max(...bots) - Math.min(...bots)).toBeLessThanOrEqual(1);
  });

  it("generators take a directions param and 4 stays the default", () => {
    const c8 = characterGenerator.generate({ ...defaults(characterGenerator), directions: "8" }, kit, 1);
    expect(c8.rows.map((r) => r.name)).toEqual(ORDER.map((d) => `walk-${d}`));
    expect(characterGenerator.generate(defaults(characterGenerator), kit, 1).rows).toHaveLength(4);
    const a8 = animalGenerator.generate({ ...defaults(animalGenerator), directions: "8" }, kit, 1);
    expect(a8.rows.length % 8).toBe(0);
    expect(animalGenerator.generate(defaults(animalGenerator), kit, 1).rows.length % 4).toBe(0);
  });
});

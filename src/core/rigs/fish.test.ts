import { describe, expect, it } from "vitest";
import { KIT_PRESETS } from "../kit";
import { PALETTE_SIZE } from "../palette";
import { renderRig, validateRig } from "../rig";
import { FISH_CLIPS, FISH_JOINTS, FISH_RIGS, fishRig } from "./fish";
import { clipById, rigById } from "./index";

describe("fish rigs", () => {
  it("has carp, catfish and their fry, with idle and swim", () => {
    expect(FISH_RIGS.map((r) => r.id)).toEqual(["fish-carp", "fish-catfish", "fish-carp-baby", "fish-catfish-baby"]);
    expect(FISH_CLIPS.map((c) => c.id)).toEqual(["idle", "swim"]);
    expect(rigById("fish-carp")?.family).toBe("fish");
    expect(clipById("swim", "fish")).toBeDefined();
  });
  for (const rig of FISH_RIGS) {
    it(`${rig.id} is valid and matches the joint contract`, () => {
      expect(validateRig(rig)).toEqual([]);
      expect(rig.joints.map((j) => j.id).sort()).toEqual([...FISH_JOINTS].sort());
    });
  }
  it("renders every clip in 4 directions, deterministic and in range", () => {
    for (const kit of KIT_PRESETS) for (const rig of [fishRig("carp"), fishRig("catfish", 2, true)]) {
      const rows = renderRig({ rig, kit }, FISH_CLIPS);
      expect(rows).toHaveLength(8);
      expect(rows.find((r) => r.name === "swim-right")!.frames).toHaveLength(4);
      for (const r of rows) for (const f of r.frames) {
        expect(f.w).toBe(kit.sizes.character);
        expect(f.data.every((i) => i >= 0 && i < PALETTE_SIZE)).toBe(true);
        expect(f.data.some((i) => i !== 0)).toBe(true);
      }
      expect(renderRig({ rig, kit }, FISH_CLIPS)).toEqual(rows);
    }
  });
  it("swim moves the tail", () => {
    const rows = renderRig({ rig: fishRig("carp"), kit: KIT_PRESETS[0] }, FISH_CLIPS);
    const f = rows.find((r) => r.name === "swim-right")!.frames;
    expect(f[0]).not.toEqual(f[2]);
  });
});

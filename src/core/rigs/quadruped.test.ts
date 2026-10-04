import { describe, expect, it } from "vitest";
import { KIT_PRESETS } from "../kit";
import { PALETTE_SIZE } from "../palette";
import { renderRig, validateRig } from "../rig";
import { QUADRUPED_CLIPS, QUADRUPED_RIGS } from "./quadruped";
import { QUADRUPED_JOINTS } from "./joints";

describe("quadruped rigs", () => {
  it("has the five species and three clips", () => {
    expect(QUADRUPED_RIGS.map((r) => r.id)).toEqual(["water-buffalo", "dog", "cat", "horse", "pig"].map((s) => `quadruped-${s}`));
    expect(QUADRUPED_CLIPS.map((c) => c.id)).toEqual(["idle", "walk", "graze"]);
  });
  for (const rig of QUADRUPED_RIGS) {
    it(`${rig.id} is valid and matches the joint contract`, () => {
      expect(validateRig(rig)).toEqual([]);
      expect(rig.joints.map((j) => j.id).sort()).toEqual([...QUADRUPED_JOINTS].sort());
    });
  }
  it("renders deterministic, in-range frames; walk has 4 frames", () => {
    for (const kit of KIT_PRESETS) {
      const n = kit.sizes.character;
      const rows = renderRig({ rig: QUADRUPED_RIGS[0], kit }, QUADRUPED_CLIPS);
      expect(rows).toHaveLength(12);
      expect(rows.find((r) => r.name === "walk-right")!.frames).toHaveLength(4);
      for (const r of rows) for (const f of r.frames) {
        expect([f.w, f.h]).toEqual([n, n]);
        expect(f.data.every((i) => i >= 0 && i < PALETTE_SIZE)).toBe(true);
      }
      expect(renderRig({ rig: QUADRUPED_RIGS[0], kit }, QUADRUPED_CLIPS)).toEqual(rows);
    }
  });
});

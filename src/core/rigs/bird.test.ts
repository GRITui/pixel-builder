import { describe, expect, it } from "vitest";
import { KIT_PRESETS } from "../kit";
import { PALETTE_SIZE } from "../palette";
import { renderRig, validateRig } from "../rig";
import { BIRD_CLIPS, BIRD_RIGS } from "./bird";
import { BIRD_JOINTS } from "./joints";

describe("bird rigs", () => {
  it("has the species (+ chick) and four clips", () => {
    expect(BIRD_RIGS.map((r) => r.id)).toEqual(["chicken", "rooster", "duck", "chicken-baby"].map((s) => `bird-${s}`));
    expect(BIRD_CLIPS.map((c) => c.id)).toEqual(["idle", "walk", "peck", "flap"]);
  });
  for (const rig of BIRD_RIGS) {
    it(`${rig.id} is valid and matches the joint contract`, () => {
      expect(validateRig(rig)).toEqual([]);
      expect(rig.joints.map((j) => j.id).sort()).toEqual([...BIRD_JOINTS].sort());
    });
  }
  it("renders deterministic, in-range frames; walk has 4 frames", () => {
    for (const kit of KIT_PRESETS) {
      const n = kit.sizes.character;
      const rows = renderRig({ rig: BIRD_RIGS[0], kit }, BIRD_CLIPS);
      expect(rows).toHaveLength(16);
      expect(rows.find((r) => r.name === "walk-right")!.frames).toHaveLength(4);
      for (const r of rows) for (const f of r.frames) {
        expect([f.w, f.h]).toEqual([n, n]);
        expect(f.data.every((i) => i >= 0 && i < PALETTE_SIZE)).toBe(true);
      }
      expect(renderRig({ rig: BIRD_RIGS[0], kit }, BIRD_CLIPS)).toEqual(rows);
    }
  });
});

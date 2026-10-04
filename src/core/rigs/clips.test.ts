import { describe, expect, it } from "vitest";
import { clipFrames, DIRS, renderRig, viewOf, type RigDef } from "../rig";
import { KIT_PRESETS } from "../kit";
import { HUMANOID_CLIPS } from "./clips";
import { EXAMPLE_RIG } from "./example";
import { HUMANOID_RIGS } from "./humanoid";
import { HUMANOID_JOINTS } from "./joints";

const COUNTS: Record<string, [number, number]> = {
  idle: [2, 4], walk: [4, 4], run: [6, 6], attack: [4, 4], farm: [4, 4], carry: [4, 4], sit: [1, 2], chop: [5, 5], water: [5, 5], mine: [6, 6], fish: [6, 6],
};
const TOOL_JOINTS = ["toolTip", "pole", "rodLine"];
const rigs: RigDef[] = [EXAMPLE_RIG, ...HUMANOID_RIGS];

describe("humanoid clips", () => {
  it("has every spec clip", () => {
    expect(HUMANOID_CLIPS.map((c) => c.id).sort()).toEqual(Object.keys(COUNTS).sort());
  });
  it("only references HUMANOID_JOINTS, small offsets, frame counts match", () => {
    for (const c of HUMANOID_CLIPS)
      for (const v of ["down", "side", "up"] as const) {
        const frames = clipFrames(c, v);
        const [lo, hi] = COUNTS[c.id];
        expect(frames.length).toBeGreaterThanOrEqual(lo);
        expect(frames.length).toBeLessThanOrEqual(hi);
        for (const f of frames)
          for (const [j, o] of Object.entries(f)) {
            // attachment joints (tool tips, pole) swing further than body joints
            const lim = TOOL_JOINTS.includes(j) ? 20 : 6;
            if (!TOOL_JOINTS.includes(j)) expect(HUMANOID_JOINTS as readonly string[]).toContain(j);
            expect(Math.abs(o[0])).toBeLessThanOrEqual(lim);
            expect(Math.abs(o[1])).toBeLessThanOrEqual(lim);
          }
      }
  });
  for (const rig of rigs)
    for (const kit of KIT_PRESETS) {
      it(`renders ${rig.id} in ${kit.id}, 4 dirs, deterministic`, () => {
        const a = renderRig({ rig, kit }, HUMANOID_CLIPS);
        const b = renderRig({ rig, kit }, HUMANOID_CLIPS);
        expect(a.length).toBe(HUMANOID_CLIPS.length * DIRS.length);
        for (const row of a) {
          const [clip, dir] = row.name.split("-");
          const c = HUMANOID_CLIPS.find((x) => x.id === clip)!;
          expect(row.frames.length).toBe(clipFrames(c, viewOf(dir as never)).length);
          for (const f of row.frames) expect(f.w).toBe(kit.sizes.character);
        }
        expect(a).toEqual(b);
      });
    }
});

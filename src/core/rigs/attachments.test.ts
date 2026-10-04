import { describe, expect, it } from "vitest";
import { KIT_PRESETS } from "../kit";
import { clipFrames, renderRigFrame, validateRig, viewOf, type Dir } from "../rig";
import { HUMANOID_JOINTS } from "./joints";
import { EXAMPLE_RIG, WALK } from "./example";
import { HUMANOID_ATTACHMENTS } from "./attachments";
import { HUMANOID_RIGS } from "./humanoid";

const IDS = ["ngob-hat", "straw-hat", "helmet", "hood", "wizard-hat", "crown", "hoe", "sickle", "sword", "staff", "bow", "fishing-rod", "shield", "basket", "shoulder-pole", "rice-sack"];
const kit = KIT_PRESETS[0];
const sum = (s: unknown) => JSON.stringify(s);

describe("humanoid attachments", () => {
  it("has unique, complete ids", () => {
    const ids = HUMANOID_ATTACHMENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...IDS].sort());
  });
  it("part ids are unique within each attachment and use humanoid joints", () => {
    for (const a of HUMANOID_ATTACHMENTS) {
      const pids = a.parts.map((p) => p.id);
      expect(new Set(pids).size).toBe(pids.length);
      for (const p of a.parts) for (const j of p.kind === "limb" ? [p.from, p.to] : [p.joint]) expect(HUMANOID_JOINTS as readonly string[]).toContain(j);
    }
  });
  const rigs = [EXAMPLE_RIG, ...HUMANOID_RIGS];
  for (const rig of rigs)
    for (const a of HUMANOID_ATTACHMENTS)
      it(`${a.id} validates and renders on ${rig.id} over a walk`, () => {
        expect(validateRig(rig, [a])).toEqual([]);
        for (const dir of ["down", "left", "right", "up"] as Dir[]) {
          const frames = clipFrames(WALK, viewOf(dir));
          const out = frames.map((p) => renderRigFrame({ rig, kit, attachments: [a] }, dir, p));
          const base = renderRigFrame({ rig, kit }, dir, frames[0]);
          expect(out[0].w).toBe(base.w);
          expect(sum(out[0])).not.toBe(sum(base));
          expect(sum(out[0])).toBe(sum(renderRigFrame({ rig, kit, attachments: [a] }, dir, frames[0])));
        }
      });
});

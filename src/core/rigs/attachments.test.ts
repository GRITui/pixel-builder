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
      const own = (a.joints ?? []).map((j) => j.id);
      for (const p of a.parts) for (const j of p.kind === "limb" ? [p.from, p.to] : [p.joint]) expect([...HUMANOID_JOINTS, ...own] as string[]).toContain(j);
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

  it("hats stay on the canvas and the ngob hat is not umbrella-wide", () => {
    for (const rig of HUMANOID_RIGS)
      for (const id of ["ngob-hat", "straw-hat", "wizard-hat"]) {
        const a = HUMANOID_ATTACHMENTS.find((x) => x.id === id)!;
        for (const dir of ["down", "side", "up"] as Dir[]) {
          const s = renderRigFrame({ rig, kit, attachments: [a] }, dir);
          const rows = Array.from({ length: s.h }, (_, y) => s.data.slice(y * s.w, (y + 1) * s.w).filter(Boolean).length);
          expect(rows[0]).toBe(0);
          if (id === "ngob-hat" && dir === "down") expect(Math.max(...rows.slice(0, 12))).toBeLessThanOrEqual(21);
        }
      }
  });

  it("held tools rotate with their tip joint and sit behind the body in the up view", () => {
    for (const id of ["hoe", "sickle", "sword", "staff", "bow", "fishing-rod"]) {
      const a = HUMANOID_ATTACHMENTS.find((x) => x.id === id)!;
      expect(a.joints?.some((j) => j.id === "toolTip")).toBe(true);
      const rig = HUMANOID_RIGS[1];
      for (const dir of ["down", "side", "up"] as Dir[]) {
        const r = { rig, kit, attachments: [a] };
        expect(sum(renderRigFrame(r, dir, { toolTip: [-6, 8] }))).not.toBe(sum(renderRigFrame(r, dir, {})));
      }
    }
  });

  it("shoulder pole bobs with its own joint", () => {
    const a = HUMANOID_ATTACHMENTS.find((x) => x.id === "shoulder-pole")!;
    expect(a.joints?.[0].id).toBe("pole");
    const r = { rig: HUMANOID_RIGS[1], kit, attachments: [a] };
    expect(sum(renderRigFrame(r, "down", { pole: [0, 1] }))).not.toBe(sum(renderRigFrame(r, "down", {})));
  });
});

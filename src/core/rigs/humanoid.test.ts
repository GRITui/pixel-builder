import { describe, expect, it } from "vitest";
import { characterGenerator } from "../generators/character";
import { defaults } from "../generators/types";
import { KIT_PRESETS, proportions } from "../kit";
import { colorIndex } from "../palette";
import { renderRig, validateRig } from "../rig";
import { attachmentById, clipById, rigById, withHumanoidDefaults } from "./index";
import { HAIR_STYLES, HUMANOID_RIGS, hairAttachment } from "./humanoid";
import { HUMANOID_JOINTS } from "./joints";

const gen = (p: object, kit = KIT_PRESETS[0], seed = 1) => characterGenerator.generate({ ...defaults(characterGenerator), ...p }, kit, seed);

describe("humanoid rigs", () => {
  it("define every contract joint and validate", () => {
    expect(HUMANOID_RIGS.map((r) => r.id)).toEqual(["humanoid-slim", "humanoid-normal", "humanoid-stocky"]);
    for (const r of HUMANOID_RIGS) {
      expect(r.grid).toBe(32);
      for (const j of HUMANOID_JOINTS) expect(r.joints.some((x) => x.id === j)).toBe(true);
      for (const h of HAIR_STYLES) expect(validateRig(r, [hairAttachment(h)])).toEqual([]);
    }
  });

  it("fills about 84% of the canvas height", () => {
    for (const kit of KIT_PRESETS) {
      const f = gen({ hair_style: "short" }, kit).rows[0].frames[0];
      const rows = [...Array(f.h).keys()].filter((y) => f.data.slice(y * f.w, (y + 1) * f.w).some(Boolean));
      const h = rows[rows.length - 1] - rows[0] + 1;
      expect(Math.abs(h - proportions(kit).figure)).toBeLessThanOrEqual(3);
    }
  });

  it("every build keeps figure height within 3px in all kits", () => {
    for (const kit of KIT_PRESETS) for (const build of ["slim", "normal", "stocky"]) {
      const f = gen({ build }, kit).rows[0].frames[0];
      const rows = [...Array(f.h).keys()].filter((y) => f.data.slice(y * f.w, (y + 1) * f.w).some(Boolean));
      expect(Math.abs(rows[rows.length - 1] - rows[0] + 1 - proportions(kit).figure)).toBeLessThanOrEqual(3);
    }
  });

  it("is deterministic per seed and every build/hair renders", () => {
    expect(gen({}, KIT_PRESETS[0], 4)).toEqual(gen({}, KIT_PRESETS[0], 4));
    for (const build of ["slim", "normal", "stocky"]) for (const hair_style of HAIR_STYLES) expect(gen({ build, hair_style }).rows).toHaveLength(4);
  });

  it("helmet uses the accent material, metal by default (#11)", () => {
    const has = (p: object, m: "metal" | "gold") => gen(p).rows.flatMap((r) => r.frames).some((f) => f.data.some((i) => i >= colorIndex(m, 0) && i <= colorIndex(m, 4)));
    expect(has({ headwear: "helmet" }, "metal")).toBe(true);
    expect(has({ headwear: "helmet", accent_mat: "gold" }, "gold")).toBe(true);
    expect(has({ headwear: "helmet", accent_mat: "gold" }, "metal")).toBe(false);
  });
});

describe("withHumanoidDefaults", () => {
  const rig = HUMANOID_RIGS[1];
  const ids = (a: { id: string }[]) => a.map((x) => x.id);
  it("gives bare humanoid rigs short hair and a face", () => {
    expect(ids(withHumanoidDefaults(rig, []))).toEqual(["hair-short", "face"]);
  });
  it("keeps a chosen hair style and honours no-face", () => {
    const long = attachmentById("hair-long")!.attachment, none = attachmentById("no-face")!.attachment;
    expect(ids(withHumanoidDefaults(rig, [long, none]))).toEqual(["hair-long", "no-face"]);
  });
  it("leaves non-humanoid rigs and rigs with their own face alone", () => {
    expect(withHumanoidDefaults(rigById("quadruped-dog")!.rig, [])).toEqual([]);
    expect(withHumanoidDefaults(rigById("example-biped")!.rig, [])).toEqual([]);
  });
  it("draws eyes on a rigged humanoid's front view", () => {
    const kit = KIT_PRESETS[0];
    const bare = renderRig({ rig, kit }, [clipById("idle")!.clip])[0].frames[0];
    const faced = renderRig({ rig, kit, attachments: withHumanoidDefaults(rig, []) }, [clipById("idle")!.clip])[0].frames[0];
    expect(faced.data).not.toEqual(bare.data);
  });
});

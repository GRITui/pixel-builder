import { describe, expect, it } from "vitest";
import { KIT_PRESETS } from "../kit";
import { PALETTE_SIZE } from "../palette";
import { rng } from "../rng";
import { buildingGenerator } from "./building";
import { characterGenerator } from "./character";
import { coerceParams, defaults, randomParams } from "./types";

const validIndices = (data: number[]) => data.every((v) => Number.isInteger(v) && v >= 0 && v < PALETTE_SIZE);

describe("character generator", () => {
  it("produces 4 directions x 4 walk frames at the kit size", () => {
    for (const kit of KIT_PRESETS) {
      const r = characterGenerator.generate(defaults(characterGenerator), kit, 1);
      expect(r.rows.map((x) => x.name)).toEqual(["walk-down", "walk-left", "walk-right", "walk-up"]);
      for (const row of r.rows) {
        expect(row.frames).toHaveLength(4);
        for (const f of row.frames) {
          expect([f.w, f.h]).toEqual([kit.sizes.character, kit.sizes.character]);
          expect(validIndices(f.data)).toBe(true);
          expect(f.data.some(Boolean)).toBe(true);
        }
      }
    }
  });

  it("survives random params for many seeds", () => {
    const r = rng(3);
    for (let i = 0; i < 40; i++) {
      const p = randomParams(characterGenerator, r);
      expect(() => characterGenerator.generate(p, KIT_PRESETS[i % KIT_PRESETS.length], i)).not.toThrow();
    }
  });
});

describe("building generator", () => {
  it("is deterministic per seed and fits the kit size", () => {
    const kit = KIT_PRESETS[0];
    const p = { ...defaults(buildingGenerator), style: "keep", floors: 3 };
    const a = buildingGenerator.generate(p, kit, 9).rows[0].frames[0];
    expect(buildingGenerator.generate(p, kit, 9).rows[0].frames[0]).toEqual(a);
    // width is the kit size; height grows with floors so the door stays at character scale
    expect(a.w).toBe(kit.sizes.building);
    expect(a.h).toBeGreaterThanOrEqual(kit.sizes.building);
    expect(validIndices(a.data)).toBe(true);
  });

  it("handles every style x roof combination", () => {
    for (const style of ["cottage", "shop", "tower", "keep", "barn"])
      for (const roof_style of ["gable", "hip", "flat", "dome", "spire"])
        for (const kit of KIT_PRESETS)
          expect(() => buildingGenerator.generate({ ...defaults(buildingGenerator), style, roof_style }, kit, 1)).not.toThrow();
  });
});

describe("world scale contract", () => {
  it("makes doors slightly taller than the character in every kit", async () => {
    const { proportions } = await import("../kit");
    for (const kit of KIT_PRESETS) {
      const pr = proportions(kit);
      expect(pr.door).toBeGreaterThan(pr.figure);
      expect(pr.tree).toBeGreaterThan(pr.figure * 2 - 4);
    }
  });

  it("gives characters seed-driven variety", () => {
    const kit = KIT_PRESETS[0];
    const frames = new Set([1, 2, 3, 4, 5, 6].map((s) => JSON.stringify(characterGenerator.generate(defaults(characterGenerator), kit, s).rows[0].frames[0].data)));
    expect(frames.size).toBeGreaterThan(1);
  });
});

describe("coerceParams", () => {
  it("drops invalid AI values and clamps numbers", () => {
    const p = coerceParams(buildingGenerator, { style: "spaceship", floors: 99, wall: "stone", chimney: "yes" });
    expect(p.style).toBe("cottage");
    expect(p.floors).toBe(3);
    expect(p.wall).toBe("stone");
    expect(p.chimney).toBe(true);
  });
});

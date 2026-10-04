import { describe, expect, it } from "vitest";
import { KIT_PRESETS } from "../kit";
import { PALETTE_SIZE } from "../palette";
import { animalCanvas, animalGenerator, animalTargetHeight } from "./animal";
import { defaults } from "./types";

const SPECIES = ["water-buffalo", "dog", "cat", "horse", "pig", "chicken", "rooster", "duck"];
describe("animal generator", () => {
  it("renders every species at kit size, deterministically", () => {
    for (const kit of KIT_PRESETS) for (const species of SPECIES) {
      const p = { ...defaults(animalGenerator), species };
      const a = animalGenerator.generate(p, kit, 3);
      expect(animalGenerator.generate(p, kit, 3)).toEqual(a);
      expect(a.rows.length).toBeGreaterThanOrEqual(12);
      expect(a.rows.some((r) => r.name === "idle-down")).toBe(true);
      for (const r of a.rows) for (const f of r.frames) {
        expect(f.w).toBe(animalCanvas(species, kit));
        expect(f.data.every((i) => i >= 0 && i < PALETTE_SIZE)).toBe(true);
        expect(f.data.some((i) => i !== 0)).toBe(true);
      }
    }
  });

  it("sizes animals against the kit figure (within 15%) in all kits", () => {
    for (const kit of KIT_PRESETS) for (const species of SPECIES) {
      const f = animalGenerator.generate({ ...defaults(animalGenerator), species }, kit, 1).rows.find((r) => r.name === "idle-right")!.frames[0];
      const ys = [...f.data.keys()].filter((i) => f.data[i]).map((i) => Math.floor(i / f.w));
      const h = Math.max(...ys) - Math.min(...ys) + 1;
      const t = animalTargetHeight(species, kit);
      expect(Math.abs(h - t) / t, `${kit.id} ${species} h=${h} t=${t}`).toBeLessThanOrEqual(0.16);
    }
  });

  it("variant changes the sprite", () => {
    const g = (variant: number) => animalGenerator.generate({ ...defaults(animalGenerator), variant }, KIT_PRESETS[0], 1);
    expect(g(1)).not.toEqual(g(0));
  });
});

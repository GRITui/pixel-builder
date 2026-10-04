import { describe, expect, it } from "vitest";
import { KIT_PRESETS } from "../kit";
import { PALETTE_SIZE } from "../palette";
import { animalGenerator } from "./animal";
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
        expect(f.w).toBe(kit.sizes.character);
        expect(f.data.every((i) => i >= 0 && i < PALETTE_SIZE)).toBe(true);
        expect(f.data.some((i) => i !== 0)).toBe(true);
      }
    }
  });
});

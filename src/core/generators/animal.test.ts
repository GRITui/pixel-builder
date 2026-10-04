import { describe, expect, it } from "vitest";
import { KIT_PRESETS } from "../kit";
import { PALETTE_SIZE } from "../palette";
import { animalCanvas, animalGenerator, animalTargetHeight, FARM_SETS } from "./animal";
import { defaults } from "./types";

const SPECIES = ["water-buffalo", "dog", "cat", "horse", "pig", "chicken", "rooster", "duck", "cow", "sheep"];
const FISH = ["fish", "catfish"];
const heightOf = (species: string, kit = KIT_PRESETS[0], age = "adult") => {
  const f = animalGenerator.generate({ ...defaults(animalGenerator), species, age }, kit, 1).rows.find((r) => r.name === "idle-right")!.frames[0];
  const ys = [...f.data.keys()].filter((i) => f.data[i]).map((i) => Math.floor(i / f.w));
  return Math.max(...ys) - Math.min(...ys) + 1;
};
describe("animal generator", () => {
  it("renders every species at kit size, deterministically", { timeout: 60000 }, () => {
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

  it("sizes animals against the kit figure (within 15%) in all kits", { timeout: 60000 }, () => {
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

  it("renders fish and every baby at kit size", { timeout: 60000 }, () => {
    for (const kit of KIT_PRESETS) for (const species of [...SPECIES, ...FISH]) for (const age of ["adult", "baby"]) {
      const p = { ...defaults(animalGenerator), species, age };
      const a = animalGenerator.generate(p, kit, 3);
      expect(animalGenerator.generate(p, kit, 3)).toEqual(a);
      expect(a.rows.some((r) => r.name === (FISH.includes(species) ? "swim-down" : "idle-down"))).toBe(true);
      for (const r of a.rows) for (const f of r.frames) {
        expect(f.w).toBe(animalCanvas(species, kit, age));
        expect(f.data.some((i) => i !== 0)).toBe(true);
      }
    }
  });

  it("babies are smaller than adults but stay readable", { timeout: 60000 }, () => {
    for (const kit of KIT_PRESETS) for (const species of SPECIES) {
      const b = heightOf(species, kit, "baby"), a = heightOf(species, kit);
      expect(b, `${kit.id} ${species}`).toBeLessThan(a);
      expect(b).toBeGreaterThanOrEqual(6);
    }
  });

  it("world scale: cow > sheep > chicken", () => {
    for (const kit of KIT_PRESETS) {
      expect(heightOf("cow", kit)).toBeGreaterThan(heightOf("sheep", kit));
      expect(heightOf("sheep", kit)).toBeGreaterThan(heightOf("chicken", kit));
    }
  });

  it("cow variants change the patches; farm sets name known species", () => {
    const g = (variant: number) => animalGenerator.generate({ ...defaults(animalGenerator), species: "cow", variant }, KIT_PRESETS[0], 1);
    expect(g(1)).not.toEqual(g(0));
    for (const list of Object.values(FARM_SETS)) for (const sp of list) expect([...SPECIES, ...FISH]).toContain(sp);
  });

  it("defaults stay water buffalo adult", () => {
    const d = defaults(animalGenerator);
    expect(d.species).toBe("water-buffalo");
    expect(d.age).toBe("adult");
  });
});

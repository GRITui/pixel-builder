import { describe, expect, it } from "vitest";
import { KIT_PRESETS } from "../kit";
import { CROP_SPECIES, CROP_STAGES, cropField, cropIsTall, cropsGenerator as g } from "./crops";
import { generatorById } from "./index";
import { defaults } from "./types";

const kit = (id: string) => KIT_PRESETS.find((k) => k.id === id)!;
const gen = (o: Record<string, unknown>, id = "kit-default", seed = 2) => g.generate({ ...defaults(g), ...o } as never, kit(id), seed);

describe("crop generator", () => {
  it("is registered as an environment generator", () => {
    expect(generatorById("crop")?.category).toBe("environment");
    expect(CROP_SPECIES.length).toBeGreaterThanOrEqual(6);
  });

  it("renders every species x stage with a tile-wide canvas and a clear margin", () => {
    for (const id of ["kit-default", "kit-gameboy"]) {
      const T = kit(id).sizes.tile;
      for (const species of CROP_SPECIES)
        for (const stage of CROP_STAGES) {
          const r = gen({ species, stage }, id);
          expect(r.rows.map((x) => x.name)).toEqual(["idle", "sway"]);
          expect(r.rows[1].frames.length).toBe(4);
          const H = cropIsTall(species, stage) ? Math.round(T * 1.5) : T;
          for (const f of r.rows.flatMap((x) => x.frames)) {
            expect([f.w, f.h]).toEqual([T, H]);
            expect(f.data.some((v) => v)).toBe(true);
            for (let i = 0; i < f.w; i++) { expect(f.data[i]).toBe(0); expect(f.data[(f.h - 1) * f.w + i]).toBe(0); }
            for (let j = 0; j < f.h; j++) { expect(f.data[j * f.w]).toBe(0); expect(f.data[j * f.w + f.w - 1]).toBe(0); }
          }
        }
    }
  });

  it("is deterministic per seed", () => {
    expect(JSON.stringify(gen({ species: "wheat" }, "kit-default", 5))).toBe(JSON.stringify(gen({ species: "wheat" }, "kit-default", 5)));
  });

  it("sway frames differ once the plant is up", () => {
    for (const species of CROP_SPECIES) {
      const f = gen({ species, stage: "ready" }).rows[1].frames;
      expect(new Set(f.map((s) => s.data.join())).size).toBeGreaterThan(1);
    }
  });

  it("stages and species look different", () => {
    for (const species of CROP_SPECIES) {
      const imgs = CROP_STAGES.map((stage) => gen({ species, stage }).rows[0].frames[0].data.join());
      expect(new Set(imgs).size).toBe(CROP_STAGES.length);
    }
    expect(gen({ species: "carrot" }).rows[0].frames[0].data.join()).not.toBe(gen({ species: "cabbage" }).rows[0].frames[0].data.join());
  });
});

describe("cropField", () => {
  it("is deterministic and laid out in rows", () => {
    const a = cropField({ cols: 6, rows: 4 }, ["wheat", "carrot"], { seed: 3 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(cropField({ cols: 6, rows: 4 }, ["wheat", "carrot"], { seed: 3 })));
    expect(a.length).toBe(24);
    for (let y = 0; y < 4; y++) {
      const row = a.filter((c) => c.y === y);
      expect(row.length).toBe(6);
      expect(new Set(row.map((c) => c.species))).toEqual(new Set([y % 2 ? "carrot" : "wheat"]));
      // one base stage per row: neighbours are within a stage or so of each other
      const st = row.map((c) => CROP_STAGES.indexOf(c.stage!));
      expect(Math.max(...st) - Math.min(...st)).toBeLessThanOrEqual(2);
    }
  });

  it("marks an irrigation channel along one edge and accepts a count", () => {
    const f = cropField({ cols: 5, rows: 3 }, "corn", { channel: "bottom" });
    expect(f.filter((c) => c.irrigation).map((c) => c.y)).toEqual([2, 2, 2, 2, 2]);
    expect(f.filter((c) => c.irrigation).every((c) => c.species === undefined)).toBe(true);
    expect(cropField(10, "rice", { cols: 5 }).length).toBe(10);
  });
});

import { describe, expect, it } from "vitest";
import { KIT_PRESETS } from "../kit";
import { FINE_START } from "../palette";
import { FOLIAGE_PX, FOLIAGE_SEASONS, FOLIAGE_SIZES, FOLIAGE_SPECIES, foliageGenerator as g } from "./foliage";
import { defaults } from "./types";

const kit = (id: string) => KIT_PRESETS.find((k) => k.id === id)!;
const gen = (o: Record<string, unknown>, id = "kit-default", seed = 2) => g.generate({ ...defaults(g), ...o } as never, kit(id), seed);

describe("foliage generator", () => {
  it("renders every species x size x season with the right size and a clear margin", { timeout: 60000 }, () => {
    for (const species of FOLIAGE_SPECIES)
      for (const size of FOLIAGE_SIZES)
        for (const season of FOLIAGE_SEASONS) {
          const r = gen({ species, size, season });
          expect(r.rows.map((x) => x.name)).toEqual(["idle", "sway"]);
          expect(r.rows[1].frames.length).toBe(4);
          for (const f of r.rows.flatMap((x) => x.frames)) {
            expect([f.w, f.h]).toEqual([FOLIAGE_PX[size], FOLIAGE_PX[size]]);
            expect(f.data.some((v) => v)).toBe(true);
            for (let i = 0; i < f.w; i++) {
              expect(f.data[i]).toBe(0);
              expect(f.data[(f.h - 1) * f.w + i]).toBe(0);
              expect(f.data[i * f.w]).toBe(0);
              expect(f.data[i * f.w + f.w - 1]).toBe(0);
            }
          }
        }
  });

  it("is deterministic per seed and varies across seeds", () => {
    expect(JSON.stringify(gen({}, "kit-default", 5))).toBe(JSON.stringify(gen({}, "kit-default", 5)));
    expect(JSON.stringify(gen({}, "kit-default", 5).rows[0])).not.toBe(JSON.stringify(gen({}, "kit-default", 6).rows[0]));
  });

  it("sway frames differ and species look different", () => {
    for (const species of FOLIAGE_SPECIES) {
      const f = gen({ species }).rows[1].frames;
      expect(new Set(f.map((s) => s.data.join())).size).toBeGreaterThan(1);
    }
    expect(gen({ species: "oak" }).rows[0].frames[0].data.join()).not.toBe(gen({ species: "pine-hd" }).rows[0].frames[0].data.join());
  });

  it("uses fine shades on kit-hd-deep only", () => {
    const deep = gen({ size: "large" }, "kit-hd-deep").rows[0].frames[0];
    expect(deep.data.some((v) => v >= FINE_START)).toBe(true);
    const classic = gen({ size: "large" }, "kit-default").rows[0].frames[0];
    expect(classic.data.some((v) => v >= FINE_START)).toBe(false);
  });
});

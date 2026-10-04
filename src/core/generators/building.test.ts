import { describe, expect, it } from "vitest";
import { KIT_PRESETS, proportions } from "../kit";
import { bounds, getPx } from "../sprite";
import { buildingGenerator } from "./building";
import { coerceParams, defaults } from "./types";

const gen = (extra: Record<string, string | number | boolean>, kitIdx = 0, seed = 1) =>
  buildingGenerator.generate({ ...defaults(buildingGenerator), ...extra }, KIT_PRESETS[kitIdx], seed);

describe("building generator: stilt-house and corrugated roofs", () => {
  it("keeps old option strings and adds the new ones", () => {
    const style = buildingGenerator.params.find((p) => p.key === "style");
    const roof = buildingGenerator.params.find((p) => p.key === "roof_style");
    for (const o of ["cottage", "shop", "tower", "keep", "barn", "stilt-house"]) expect(style && style.type === "select" && style.options).toContain(o);
    for (const o of ["gable", "hip", "flat", "dome", "spire", "corrugated"]) expect(roof && roof.type === "select" && roof.options).toContain(o);
    expect(coerceParams(buildingGenerator, { style: "stilt-house", roof_style: "corrugated" })).toMatchObject({ style: "stilt-house", roof_style: "corrugated" });
  });

  describe.each(KIT_PRESETS.map((k, i) => [k.id, i] as const))("%s", (_id, kitIdx) => {
    const kit = KIT_PRESETS[kitIdx];
    const combos: Record<string, string>[] = [
      { roof_style: "gable", access: "stairs" },
      { roof_style: "hip", access: "ladder" },
      { roof_style: "corrugated", access: "stairs", width: "wide" },
    ];

    it.each(combos)("stilt-house %o is kit-width, taller than a plain cottage, with a 1px margin", (c) => {
      const s = gen({ style: "stilt-house", ...c }, kitIdx).rows[0].frames[0];
      expect(s.w).toBe(kit.sizes.building);
      expect(s.h).toBeGreaterThan(gen({ style: "cottage" }, kitIdx).rows[0].frames[0].h - 6);
      const b = bounds(s)!;
      expect(b.y1 - b.y0 + 1).toBeGreaterThan(proportions(kit).door * 2);
      // finalize's outline needs room, but nothing may be clipped by the canvas edge
      for (let x = 0; x < s.w; x++) expect(getPx(s, x, 0)).toBe(0);
      for (let y = 0; y < s.h; y++) {
        expect(getPx(s, 0, y)).toBe(0);
        expect(getPx(s, s.w - 1, y)).toBe(0);
      }
    });

    it("is open underneath: a character-tall gap between the posts", () => {
      const s = gen({ style: "stilt-house" }, kitIdx).rows[0].frames[0];
      const door = proportions(kit).door;
      // count columns that are transparent for the whole height of the ground floor (above the footing)
      let clear = 0;
      for (let x = 0; x < s.w; x++) {
        let all = true;
        for (let y = s.h - 2 - door; y < s.h - 4; y++) if (getPx(s, x, y) !== 0) all = false;
        if (all) clear++;
      }
      expect(clear).toBeGreaterThan(0);
    });

    it("is deterministic per seed", () => {
      expect(gen({ style: "stilt-house" }, kitIdx, 5).rows[0].frames[0].data).toEqual(gen({ style: "stilt-house" }, kitIdx, 5).rows[0].frames[0].data);
    });

    it("corrugated roof differs from gable on a regular cottage and stays kit-sized", () => {
      const a = gen({ roof_style: "corrugated" }, kitIdx).rows[0].frames[0];
      const b = gen({ roof_style: "gable" }, kitIdx).rows[0].frames[0];
      expect(a.w).toBe(kit.sizes.building);
      expect(a.data).not.toEqual(b.data);
    });
  });
});

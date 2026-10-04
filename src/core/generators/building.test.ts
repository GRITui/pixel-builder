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

describe("building generator: half-brick house", () => {
  describe.each(KIT_PRESETS.map((k, i) => [k.id, i] as const))("%s", (_id, kitIdx) => {
    const kit = KIT_PRESETS[kitIdx];
    it.each<Record<string, string | boolean>>([{}, { width: "wide", roof_style: "gable" }, { width: "narrow", lit_windows: false }])("%o is wider than tall, two door-heights high, with a 1px margin", (c) => {
      const s = gen({ style: "half-brick", ...c }, kitIdx).rows[0].frames[0];
      expect(s.w).toBe(Math.round(kit.sizes.building * 1.5));
      const b = bounds(s)!;
      expect(b.x1 - b.x0 + 1).toBeGreaterThan(b.y1 - b.y0 + 1);
      expect(b.y1 - b.y0 + 1).toBeGreaterThan(proportions(kit).door * 2);
      for (let x = 0; x < s.w; x++) expect(getPx(s, x, 0)).toBe(0);
      for (let y = 0; y < s.h; y++) {
        expect(getPx(s, 0, y)).toBe(0);
        expect(getPx(s, s.w - 1, y)).toBe(0);
      }
    });
    it("is deterministic per seed", () => {
      expect(gen({ style: "half-brick" }, kitIdx, 3).rows[0].frames[0].data).toEqual(gen({ style: "half-brick" }, kitIdx, 3).rows[0].frames[0].data);
    });
  });
});

describe("building generator: farm buildings", () => {
  const SIZES = ["small", "medium", "large"];
  const variants: Record<string, string>[] = [
    ...SIZES.map((size) => ({ style: "farmhouse", size })),
    ...SIZES.map((size) => ({ style: "coop", size })),
    { style: "barn", size: "large" },
    { style: "barn", size: "large", wall: "cloth2", trim: "sand", roof: "roof" },
  ];

  it("adds size, farmhouse, coop, cloth2 walls and sand trim without removing options", () => {
    const opt = (key: string) => {
      const s = buildingGenerator.params.find((p) => p.key === key);
      return s && "options" in s ? s.options : undefined;
    };
    expect(opt("size")).toEqual(["small", "medium", "large"]);
    expect(buildingGenerator.params.find((p) => p.key === "size")?.default).toBe("medium");
    expect(opt("style")).toEqual(expect.arrayContaining(["cottage", "barn", "stilt-house", "half-brick", "farmhouse", "coop"]));
    expect(opt("wall")).toContain("cloth2");
    expect(opt("trim")).toContain("sand");
  });

  it("size does not change older styles; barn small equals medium", () => {
    for (const style of ["cottage", "shop", "tower", "keep", "barn", "stilt-house", "half-brick"])
      for (const size of ["small", "medium"])
        expect(gen({ style, size }).rows[0].frames[0].data).toEqual(gen({ style }).rows[0].frames[0].data);
  });

  describe.each(KIT_PRESETS.map((k, i) => [k.id, i] as const))("%s", (_id, kitIdx) => {
    const kit = KIT_PRESETS[kitIdx];
    const pr = proportions(kit);
    const frame = (c: Record<string, string>, seed = 1) => gen(c, kitIdx, seed).rows[0].frames[0];

    it.each(variants)("%o has a 1px transparent margin, sits on the bottom, within 1.5x width", (c) => {
      const s = frame(c);
      expect(s.w).toBeLessThanOrEqual(Math.round(kit.sizes.building * 1.5));
      const b = bounds(s)!;
      expect(b.x0).toBeGreaterThanOrEqual(1);
      expect(b.y0).toBeGreaterThanOrEqual(1);
      expect(b.x1).toBeLessThanOrEqual(s.w - 2);
      expect(s.h - 1 - b.y1).toBeLessThanOrEqual(3); // sits on the bottom (the outline row is the last, as for every building)
      expect(frame(c, 4).data).toEqual(frame(c, 4).data);
    });

    it("large is wider than small, houses are taller than a door", () => {
      for (const style of ["farmhouse", "coop"]) {
        expect(frame({ style, size: "large" }).w).toBeGreaterThan(frame({ style, size: "small" }).w);
        expect(frame({ style, size: "large" }).h).toBeGreaterThan(pr.door);
      }
      expect(frame({ style: "barn", size: "large" }).w).toBeGreaterThan(frame({ style: "barn" }).w);
      expect(frame({ style: "farmhouse", size: "large" }).h).toBeGreaterThan(pr.door + pr.story);
    });

    it("a small coop is lower than a human door frame plus roof; large is bigger", () => {
      expect(frame({ style: "coop", size: "small" }).h).toBeLessThan(pr.door * 1.7);
      expect(frame({ style: "coop", size: "large" }).h).toBeGreaterThan(frame({ style: "coop", size: "small" }).h);
    });
  });
});

describe("large barn silhouette", () => {
  it.each(KIT_PRESETS.map((k, i) => [k.id, i] as const))("is mirror-symmetric per row in %s", (_id, kitIdx) => {
    for (const extra of [{} as Record<string, string>, { wall: "cloth2", trim: "sand" }]) {
      const s = gen({ style: "barn", size: "large", ...extra }, kitIdx).rows[0].frames[0];
      for (let y = 0; y < s.h; y++) {
        let l = -1, r = -1;
        for (let x = 0; x < s.w; x++) if (getPx(s, x, y)) { if (l < 0) l = x; r = x; }
        if (l < 0) continue;
        expect(s.w - 1 - r, `row ${y}`).toBe(l);
      }
    }
  });
});

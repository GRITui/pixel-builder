import { describe, expect, it } from "vitest";
import { KIT_PRESETS } from "./kit";
import { GENERATORS, defaults } from "./generators";
import { castLight, grade, lightMap, shiftIndex, type LitObject } from "./lighting";
import { colorIndex, decodeIndex, PALETTE_SIZE } from "./palette";
import { createSprite } from "./sprite";
import type { Sprite, StyleKit } from "./types";

const kitOf = (id: string) => KIT_PRESETS.find((k) => k.id === id)!;
const map = (kit: StyleKit, p: object, seed = 7): Sprite => {
  const g = GENERATORS.find((x) => x.id === "map")!;
  return g.generate({ ...defaults(g), biome: "forest-mmo", cols: 16, rows: 12, detail: "high", ...p } as never, kit, seed).rows[0].frames[0];
};
const meanLevel = (s: Sprite) => {
  let sum = 0, n = 0;
  for (const v of s.data) {
    const d = decodeIndex(v);
    if (d) { sum += d.level; n++; }
  }
  return sum / n;
};

describe("lighting", () => {
  for (const id of ["kit-hd-rich", "kit-hd-deep", "kit-gameboy"]) {
    const kit = kitOf(id);
    it(`${id}: off is byte-identical and deterministic when on`, () => {
      const base = map(kit, {});
      expect(map(kit, { lighting: "off", time: "night" }).data).toEqual(base.data);
      const a = map(kit, { lighting: "on", time: "dusk" }), b = map(kit, { lighting: "on", time: "dusk" });
      expect(a.data).toEqual(b.data);
      expect(a.data).not.toEqual(base.data);
    }, 30000);
    it(`${id}: only valid palette indices, transparency unchanged`, () => {
      const g = GENERATORS.find((x) => x.id === "map")!;
      const res = g.generate({ ...defaults(g), biome: "forest-mmo", cols: 16, rows: 12, detail: "high" } as never, kit, 7);
      const base = res.rows[0].frames[0];
      const classic = !kit.rampDepth || kit.rampDepth === 5;
      for (const time of ["day", "dawn", "dusk", "night"] as const) {
        const lit = lightMap(base, res.tilemap!, kit, { time });
        let bad = 0;
        lit.data.forEach((v, i) => { if ((v === 0) !== (base.data[i] === 0) || v >= PALETTE_SIZE || (classic && v >= 91)) bad++; });
        expect(bad).toBe(0);
      }
    }, 30000);
    it(`${id}: night is darker than day`, () => {
      expect(meanLevel(map(kit, { lighting: "on", time: "night" }))).toBeLessThan(meanLevel(map(kit, { lighting: "on", time: "day" })));
    }, 30000);
  }

  it("shadows fall opposite the light", () => {
    const grassI = colorIndex("grass", 3);
    const img = createSprite(48, 32);
    img.data.fill(grassI);
    const post = createSprite(4, 12);
    post.data.fill(colorIndex("wood", 2));
    const obj: LitObject = { sprite: post, x: 22, y: 10, name: "rock" };
    for (const [lightDir, sign] of [["top-left", 1], ["top-right", -1]] as const) {
      const out = castLight(img, [obj], { ...kitOf("kit-hd-rich"), lightDir }, { reflections: false });
      let sx = 0, n = 0;
      out.data.forEach((v, i) => { if (v !== grassI) { sx += (i % 48) - 24; n++; } });
      expect(n).toBeGreaterThan(0);
      expect(Math.sign(sx / n)).toBe(sign);
    }
  });

  it("shiftIndex moves along the ramp and clamps", () => {
    expect(shiftIndex(colorIndex("grass", 2), -1)).toBe(colorIndex("grass", 1));
    expect(shiftIndex(colorIndex("grass", 0), -1)).toBe(colorIndex("grass", 0));
    expect(shiftIndex(0, 1)).toBe(0);
  });

  it("night lights glow", () => {
    const img = createSprite(40, 40);
    img.data.fill(colorIndex("grass", 2));
    const kit = kitOf("kit-hd-rich");
    const dark = grade(img, kit, "night");
    const lit = grade(img, kit, "night", [{ x: 20, y: 20, r: 12 }]);
    expect(decodeIndex(lit.data[20 * 40 + 20])!.level).toBeGreaterThan(decodeIndex(dark.data[20 * 40 + 20])!.level);
  });
});

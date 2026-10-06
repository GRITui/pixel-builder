import { describe, expect, it } from "vitest";
import { KIT_PRESETS, resolveRamps } from "./kit";
import { GENERATORS, defaults } from "./generators";
import { grade, lightMap } from "./lighting";
import { FX_START, PALETTE_SIZE_ALL, PALETTE_SIZE_FX, flattenPalette, flattenPaletteFx, fxRamps, hexToRgb, isFxIndex, lampIndex, nightIndex } from "./palette";
import type { Sprite, StyleKit } from "./types";

const kitOf = (id: string) => KIT_PRESETS.find((k) => k.id === id)!;
const build = (kit: StyleKit) => {
  const g = GENERATORS.find((x) => x.id === "map")!;
  const res = g.generate({ ...defaults(g), biome: "village", cols: 20, rows: 16, detail: "medium" } as never, kit, 3);
  return { img: res.rows[0].frames[0], tm: res.tilemap! };
};
const stats = (s: Sprite, flat: (string | null)[]) => {
  let blue = 0, sat = 0, n = 0;
  for (const v of s.data) {
    const hex = v ? flat[v] : null;
    if (!hex) continue;
    const [r, g, b] = hexToRgb(hex), mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    blue += b - (r + g) / 2;
    sat += mx ? (mx - mn) / mx : 0;
    n++;
  }
  return { blue: blue / n, sat: sat / n };
};

describe("night fx ramps and rich grade", () => {
  it("fx block is appended after every existing index", () => {
    expect(PALETTE_SIZE_ALL).toBe(172);
    expect(FX_START).toBe(172);
    expect(PALETTE_SIZE_FX).toBe(182);
    expect(nightIndex(0)).toBe(172);
    expect(lampIndex(4)).toBe(181);
    expect(isFxIndex(171)).toBe(false);
    for (const kit of KIT_PRESETS) {
      const ramps = resolveRamps(kit);
      const base = flattenPalette(ramps), fx = flattenPaletteFx(ramps);
      expect(fx).toHaveLength(PALETTE_SIZE_FX);
      expect(fx.slice(0, PALETTE_SIZE_ALL)).toEqual(base);
      const r = fxRamps(ramps);
      expect(r.night).toHaveLength(5);
      expect(r.lamplight).toHaveLength(5);
    }
  });

  it("classic grade is unchanged by the fx plumbing", () => {
    const kit = kitOf("kit-hd-rich");
    const { img } = build(kit);
    expect(grade(img, kit, "night", [], 1, undefined, "classic").data).toEqual(grade(img, kit, "night", [], 1).data);
  });

  it("rich night is bluer and less saturated than classic, deterministic", () => {
    const kit = kitOf("kit-hd-rich");
    const { img, tm } = build(kit);
    const flat = flattenPaletteFx(resolveRamps(kit));
    const classic = lightMap(img, tm, kit, { time: "night", seed: 3 });
    const rich = lightMap(img, tm, kit, { time: "night", seed: 3, fx: "rich" });
    expect(lightMap(img, tm, kit, { time: "night", seed: 3, fx: "rich" }).data).toEqual(rich.data);
    const c = stats(classic, flat), r = stats(rich, flat);
    expect(r.blue).toBeGreaterThan(c.blue + 10);
    expect(r.sat).toBeLessThan(c.sat);
    expect(rich.data.every((v, i) => (v === 0) === (img.data[i] === 0))).toBe(true);
    expect(rich.data.some(isFxIndex)).toBe(true);
  }, 30000);

  it("works on every kit preset", () => {
    for (const kit of KIT_PRESETS) {
      const { img, tm } = build(kit);
      for (const time of ["dawn", "dusk", "night"] as const) {
        const out = lightMap(img, tm, kit, { time, fx: "rich" });
        expect(out.data.every((v) => v < PALETTE_SIZE_FX)).toBe(true);
      }
    }
  }, 60000);
});

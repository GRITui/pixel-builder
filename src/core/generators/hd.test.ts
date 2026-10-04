import { describe, expect, it } from "vitest";
import { DEFAULT_KIT, KIT_PRESETS, proportions } from "../kit";
import { GENERATORS, defaults } from "./index";
import { SOIL_TILE_KINDS, TILE_KINDS } from "./environment";
import type { Sprite } from "../types";

const HD = KIT_PRESETS.find((k) => k.id === "kit-hd")!;
const HD_RICH = KIT_PRESETS.find((k) => k.id === "kit-hd-rich")!;

describe("HD kit presets", () => {
  it("scale every default size by 1.5", () => {
    for (const kit of [HD, HD_RICH]) {
      for (const k of Object.keys(DEFAULT_KIT.sizes) as (keyof typeof DEFAULT_KIT.sizes)[]) expect(kit.sizes[k]).toBe(DEFAULT_KIT.sizes[k] * 1.5);
      expect(kit.paletteId).toBe(DEFAULT_KIT.paletteId);
    }
    expect(HD.detail).toBeUndefined();
    expect(HD_RICH.detail).toBe("rich");
    expect(Math.abs(proportions(HD).figure - proportions(DEFAULT_KIT).figure * 1.5)).toBeLessThanOrEqual(1);
  });

  it("every generator renders at HD sizes, deterministically", () => {
    for (const kit of [HD, HD_RICH])
      for (const g of GENERATORS) {
        const a = g.generate(defaults(g), kit, 3);
        const b = g.generate(defaults(g), kit, 3);
        expect(JSON.stringify(a.rows)).toBe(JSON.stringify(b.rows));
        const f = a.rows[0].frames[0];
        if (g.id === "character") expect([f.w, f.h]).toEqual([48, 48]);
        if (g.id === "tileset") expect(f.w % 24).toBe(0);
        for (const row of a.rows) for (const fr of row.frames) expect(fr.data.length).toBe(fr.w * fr.h);
      }
  });

  it("ground tiles are 24px, opaque and wrap without a seam", () => {
    const env = GENERATORS.find((g) => g.id === "environment")!;
    for (const kind of [...TILE_KINDS, ...SOIL_TILE_KINDS]) {
      for (const seed of [1, 2, 3]) {
        const s: Sprite = env.generate({ ...defaults(env), kind }, HD, seed).rows[0].frames[0];
        expect([s.w, s.h]).toEqual([24, 24]);
        expect(s.data.every((v) => v !== 0)).toBe(true);
        const diff = (a: [number, number], b: [number, number]) => (s.data[a[1] * 24 + a[0]] !== s.data[b[1] * 24 + b[0]] ? 1 : 0);
        let seam = 0, inner = 0;
        for (let i = 0; i < 24; i++) {
          seam += diff([23, i], [0, i]) + diff([i, 23], [i, 0]);
          for (let j = 0; j < 23; j++) inner += diff([j, i], [j + 1, i]) + diff([i, j], [i, j + 1]);
        }
        // the wrap seam must look like any other neighbouring pair of columns/rows
        if (kind === "stone-path-tile" || (SOIL_TILE_KINDS as readonly string[]).includes(kind)) continue; // soil: covered by environment.test.ts (furrow phase) // cobble joints are high-contrast by design; checked by eye in the 3x3 wrap sheet
        expect(seam / 48, `${kind}/${seed}`).toBeLessThanOrEqual((inner / (48 * 23)) * 1.25 + 0.12);
      }
    }
  });

  it("existing presets keep their sizes", () => {
    expect(KIT_PRESETS.slice(0, 3).map((k) => k.sizes.character)).toEqual([32, 16, 32]);
    expect(KIT_PRESETS.slice(0, 3).map((k) => k.sizes.tile)).toEqual([16, 16, 16]);
  });
});

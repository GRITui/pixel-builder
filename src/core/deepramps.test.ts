import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { writeAseprite, materialLayers } from "./aseprite";
import { finalize } from "./enforce";
import { DEFAULT_KIT, HD_DEEP_KIT, HD_RICH_KIT, KIT_PRESETS, resolveRamps } from "./kit";
import { MATERIALS, PALETTE_SIZE, PALETTE_SIZE_CLASSIC, FINE_START, colorIndex, colorIndexFine, decodeIndex, deepenRamp, flattenRamps, luma } from "./palette";
import { generatorById, defaults } from "./generators/index";
import { zlibStored } from "./aseprite";

describe("deep ramps", () => {
  it("deepenRamp keeps the five anchors and stays luma-ordered", () => {
    const base = resolveRamps(HD_RICH_KIT);
    for (const m of MATERIALS) {
      for (const depth of [7, 9] as const) {
        const d = deepenRamp(base[m], depth);
        expect(d).toHaveLength(depth);
        for (let i = 1; i < d.length; i++) expect(luma(d[i])).toBeGreaterThan(luma(d[i - 1]) - 0.5);
      }
      expect(deepenRamp(base[m], 9).filter((_, i) => i % 2 === 0)).toEqual(base[m]);
    }
  });

  it("resolveRamps gives depth shades; classic kits are untouched", () => {
    expect(resolveRamps(HD_DEEP_KIT).wood).toHaveLength(9);
    expect(resolveRamps({ ...HD_DEEP_KIT, rampDepth: 7 }).wood).toHaveLength(7);
    expect(resolveRamps(DEFAULT_KIT).wood).toHaveLength(5);
  });

  it("classic levels keep their colours in a deep kit (colorIndex contract)", () => {
    const rich = flattenRamps(resolveRamps(HD_RICH_KIT));
    const deep = flattenRamps(resolveRamps(HD_DEEP_KIT));
    expect(deep.slice(0, PALETTE_SIZE_CLASSIC)).toEqual(rich);
    expect(deep).toHaveLength(PALETTE_SIZE);
    expect(PALETTE_SIZE).toBeLessThanOrEqual(256);
  });

  it("colorIndexFine maps t onto classic and fine indices in order", () => {
    expect(colorIndexFine("wood", 0, 9)).toBe(colorIndex("wood", 0));
    expect(colorIndexFine("wood", 1, 9)).toBe(colorIndex("wood", 4));
    expect(colorIndexFine("wood", 0.5, 9)).toBe(colorIndex("wood", 2));
    const f = colorIndexFine("wood", 0.125, 9);
    expect(f).toBeGreaterThanOrEqual(FINE_START);
    expect(decodeIndex(f)).toMatchObject({ mat: "wood", fine: 0 });
    expect(colorIndexFine("wood", 1 / 6, 7)).toBe(colorIndex("wood", 1)); // 7-ramp: positions 0,1,3,5,6
    const luminance = (i: number) => luma(flattenRamps(resolveRamps(HD_DEEP_KIT))[i]!);
    const ts = Array.from({ length: 9 }, (_, i) => luminance(colorIndexFine("skin", i / 8, 9)));
    for (let i = 1; i < ts.length; i++) expect(ts[i]).toBeGreaterThan(ts[i - 1] - 0.5);
  });

  it("the painter uses fine shades in deep kits only, and finalize keeps them", () => {
    const g = generatorById("environment")!;
    const p = { ...defaults(g), kind: "oak" } as never;
    const deep = g.generate(p, HD_DEEP_KIT, 1).rows[0].frames[0];
    const rich = g.generate(p, HD_RICH_KIT, 1).rows[0].frames[0];
    expect(deep.data.some((v) => v >= FINE_START)).toBe(true);
    expect(rich.data.every((v) => v < PALETTE_SIZE_CLASSIC)).toBe(true);
    expect(deep.data.every((v) => v < PALETTE_SIZE)).toBe(true);
    expect(finalize(deep, HD_DEEP_KIT, { outline: false }).data).toEqual(deep.data);
    // a classic kit folds fine shades back to classic levels
    expect(finalize(deep, DEFAULT_KIT, { outline: false }).data.every((v) => v < PALETTE_SIZE_CLASSIC)).toBe(true);
  });

  it("aseprite palette holds every deep shade within 256 entries", () => {
    const palette = flattenRamps(resolveRamps(HD_DEEP_KIT));
    const rows = [{ name: "idle", frames: [{ w: 2, h: 1, data: [FINE_START, colorIndex("wood", 1)] }] }];
    const { layers, layerOf } = materialLayers(rows as never);
    const bytes = writeAseprite({ rows: rows as never, palette, fps: 8, deflate: zlibStored, layers, layerOf });
    expect(bytes.length).toBeGreaterThan(0);
    expect(palette.length).toBeLessThanOrEqual(256);
  });
});

// Classic kits must stay byte-identical (hashes recorded at the commit before rampDepth existed).
const SNAP: Record<string, string[]> = {
  "kit-default": ["e480459e", "91558cda", "57a2b366", "9fa2752c", "98552ad8", "a1fea5c3", "adeb109e", "d7476314", "d9c0b1bd"],
  "kit-gameboy": ["43282578", "f868e6de", "bd773661", "b0c46465", "98552ad8", "fd337127", "83f92d0e", "1515ca03", "d9c0b1bd"],
  "kit-neon": ["b4527f57", "5dffd37f", "0665ed10", "3b07ffa5", "98552ad8", "8c5439d7", "adeb109e", "78d522f3", "18814497"],
  "kit-hd": ["93e51961", "224afcb0", "f1003cec", "01719a44", "5ff0db8a", "3c045bf4", "7b3eee49", "c05a5618", "ed671283"],
  "kit-hd-rich": ["4361c505", "a5f09c2d", "5fc9b397", "0d33b76e", "5ff0db8a", "c2b68190", "7b3eee49", "ecaba280", "ed671283"],
};
const CASES: [string, Record<string, string>][] = [
  ["character", {}], ["animal", { species: "dog" }], ["building", { style: "farmhouse" }],
  ["environment", { kind: "oak" }], ["environment", { kind: "water-tile" }], ["map", {}], ["tileset", {}], ["object", {}], ["ui", {}],
];

describe("classic kits are byte-identical", () => {
  it.each(Object.keys(SNAP))("%s", { timeout: 120000 }, (id) => {
    const kit = KIT_PRESETS.find((k) => k.id === id)!;
    const got = CASES.map(([gid, p]) => {
      const g = generatorById(gid)!;
      const h = createHash("sha1");
      for (const row of g.generate({ ...defaults(g), ...p } as never, kit, 1).rows) for (const f of row.frames) h.update(`${f.w}x${f.h}:${f.data.join(",")}`);
      return h.digest("hex").slice(0, 8);
    });
    expect(got).toEqual(SNAP[id]);
  });
});

import { describe, expect, it } from "vitest";
import { ALL_KIT_PRESETS, HD_DEEP_KIT, DEFAULT_KIT, resolveRamps } from "./kit";
import { MATERIALS, PALETTE_SIZE, PALETTE_SIZE_ALL, FINE_START, colorIndex, decodeIndex, fineSlotIndex, flattenPalette, flattenRamps, luma } from "./palette";
import { buildLegend, decodeRows, encodeSprite } from "./legend";
import { finalize } from "./enforce";
import { generatorById, defaults } from "./generators/index";
import { materialLayers, writeAseprite, zlibStored } from "./aseprite";

const ORIGINAL = ["ink", "skin", "hair", "cloth", "cloth2", "leather", "metal", "gold", "wood", "stone", "roof", "foliage", "grass", "dirt", "sand", "water", "accent", "ui"] as const;
const BLOSSOM = [163, 164, 165, 166, 167];

describe("blossom index stability", () => {
  it("every original material/level/fine index is where it always was", () => {
    ORIGINAL.forEach((m, r) => {
      for (let l = 0; l < 5; l++) expect(colorIndex(m, l)).toBe(1 + r * 5 + l);
      for (let k = 0; k < 4; k++) expect(fineSlotIndex(m, k)).toBe(91 + r * 4 + k);
    });
    expect(MATERIALS.slice(0, 18)).toEqual([...ORIGINAL]);
    expect(FINE_START).toBe(91);
    expect(PALETTE_SIZE).toBe(163);
  });

  it("blossom is appended: 163..167 classic, 168..171 fine, and decodes back", () => {
    expect([0, 1, 2, 3, 4].map((l) => colorIndex("blossom", l))).toEqual(BLOSSOM);
    expect([0, 1, 2, 3].map((k) => fineSlotIndex("blossom", k))).toEqual([168, 169, 170, 171]);
    expect(PALETTE_SIZE_ALL).toBe(172);
    expect(PALETTE_SIZE_ALL).toBeLessThanOrEqual(256);
    for (let i = 1; i < PALETTE_SIZE_ALL; i++) {
      const d = decodeIndex(i)!;
      expect(d).not.toBeNull();
      expect(d.fine === undefined ? colorIndex(d.mat, d.level) : fineSlotIndex(d.mat, d.fine)).toBe(i);
    }
    expect(decodeIndex(172)).toBeNull();
  });
});

describe("blossom in every kit", () => {
  it("has a luma-ordered ramp and valid palette entries; the old tables are a prefix", () => {
    for (const kit of ALL_KIT_PRESETS) {
      const ramp = resolveRamps(kit).blossom;
      expect(ramp.length).toBe(kit.rampDepth ?? 5);
      const flat = flattenPalette(resolveRamps(kit));
      expect(flat).toHaveLength(PALETTE_SIZE_ALL);
      for (const i of BLOSSOM) expect(flat[i]).toMatch(/^#[0-9a-f]{6}$/i);
      const lum = BLOSSOM.map((i) => luma(flat[i]!));
      if (kit.paletteId !== "gameboy") for (let i = 1; i < 5; i++) expect(lum[i]).toBeGreaterThan(lum[i - 1]);
      const old = flattenRamps(resolveRamps(kit));
      expect(flat.slice(0, old.length)).toEqual(old);
    }
  });

  it("finalize keeps blossom and folds its fine shades in classic kits", () => {
    const s = { w: 3, h: 1, data: [163, 167, 169] };
    expect(finalize(s, DEFAULT_KIT, { outline: false }).data).toEqual([163, 167, colorIndex("blossom", 2)]);
    expect(finalize(s, HD_DEEP_KIT, { outline: false }).data).toEqual([163, 167, 169]);
  });
});

describe("blossom legend", () => {
  it("lists blossom with non-ASCII chars, leaves older chars alone and round-trips", () => {
    const full = buildLegend(DEFAULT_KIT);
    const deep = buildLegend(HD_DEEP_KIT);
    const entries = full.entries.filter((e) => e.material === "blossom");
    expect(entries.map((e) => e.index)).toEqual(BLOSSOM);
    for (const e of entries) expect(e.char).not.toMatch(/^[\x20-\x7e]$/);
    expect(deep.entries.filter((e) => e.material === "blossom")).toHaveLength(9);
    for (const e of full.entries) expect(deep.byIndex.get(e.index)).toBe(e.char);
    expect(full.byIndex.get(1)).toBe("a");
    expect(full.byIndex.get(90)).toBe("~");
    const s = { w: 5, h: 1, data: BLOSSOM };
    expect(decodeRows(encodeSprite(s, full), 5, 1, full)).toEqual(s);
    const all = { w: 9, h: 1, data: [...BLOSSOM, 168, 169, 170, 171] };
    expect(decodeRows(encodeSprite(all, deep), 9, 1, deep)).toEqual(all);
  });
});

describe("blossom export", () => {
  it("aseprite palette stays within 256 and writes blossom pixels", () => {
    const palette = flattenPalette(resolveRamps(HD_DEEP_KIT));
    expect(palette.length).toBeLessThanOrEqual(256);
    const rows = [{ name: "idle", frames: [{ w: 2, h: 1, data: [167, 171] }] }];
    const { layers, layerOf } = materialLayers(rows as never);
    expect(layers).toEqual(["blossom"]);
    expect(writeAseprite({ rows: rows as never, palette, fps: 8, deflate: zlibStored, layers, layerOf }).length).toBeGreaterThan(0);
  });
});

describe("blossom usage", () => {
  it("sakura (spring) paints with blossom, deterministically", () => {
    const g = generatorById("foliage")!;
    const p = { ...defaults(g), species: "sakura", season: "spring" } as never;
    const a = g.generate(p, DEFAULT_KIT, 5).rows[0].frames[0];
    expect(a.data.filter((v) => BLOSSOM.includes(v)).length).toBeGreaterThan(a.data.filter((v) => v > 0).length * 0.4);
    expect(g.generate(p, DEFAULT_KIT, 5).rows[0].frames[0].data).toEqual(a.data);
  });

  it("flowers accept accent blossom", () => {
    const g = generatorById("environment")!;
    const s = g.generate({ ...defaults(g), kind: "flowers", accent: "blossom" } as never, DEFAULT_KIT, 2).rows[0].frames[0];
    expect(s.data.some((v) => BLOSSOM.includes(v))).toBe(true);
  });
});

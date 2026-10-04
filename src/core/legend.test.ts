import { describe, expect, it } from "vitest";
import { FINE_START, MATERIALS, PALETTE_SIZE, PALETTE_SIZE_CLASSIC, RAMP_LEN, colorIndex } from "./palette";
import { DEFAULT_KIT, HD_DEEP_KIT } from "./kit";
import { buildLegend, decodeRows, encodeSprite, legendText } from "./legend";

const full = buildLegend(DEFAULT_KIT);

describe("legend alphabet", () => {
  it("has one unique printable char per palette index, 0 = '.'", () => {
    expect(full.entries).toHaveLength(PALETTE_SIZE_CLASSIC - 1);
    expect(full.byChar.size).toBe(PALETTE_SIZE_CLASSIC);
    expect(full.byIndex.size).toBe(PALETTE_SIZE_CLASSIC);
    expect(full.byChar.get(".")).toBe(0);
    expect(full.byIndex.get(0)).toBe(".");
    for (const [c] of full.byChar) {
      expect(c).toMatch(/^[\x21-\x7e]$/);
      expect(['"', "'", "\\"]).not.toContain(c);
    }
  });

  it("round-trips every palette index and records material/level/hex", () => {
    for (const e of full.entries) {
      expect(full.byChar.get(e.char)).toBe(e.index);
      expect(full.byIndex.get(e.index)).toBe(e.char);
      expect(e.index).toBe(colorIndex(e.material, e.level));
      expect(e.hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("is deterministic and independent of kit and of the materials filter", () => {
    const other = buildLegend({ ...DEFAULT_KIT, paletteId: "gameboy", rampOverrides: { skin: ["#000001", "#000002", "#000003", "#000004", "#000005"] } });
    const subset = buildLegend(DEFAULT_KIT, ["cloth", "skin"]);
    for (const e of full.entries) expect(other.byIndex.get(e.index)).toBe(e.char);
    for (const e of subset.entries) expect(full.byIndex.get(e.index)).toBe(e.char);
    expect(subset.entries).toHaveLength(2 * RAMP_LEN);
    expect(subset.byChar.get(".")).toBe(0);
    expect(subset.entries.map((e) => e.material)).toEqual(MATERIALS.filter((m) => m === "skin" || m === "cloth").flatMap((m) => Array(RAMP_LEN).fill(m)));
  });

  it("uses kit colours (ramp overrides) for hex", () => {
    const l = buildLegend({ ...DEFAULT_KIT, rampOverrides: { skin: ["#000001", "#000002", "#000003", "#000004", "#000005"] } });
    expect(l.entries.find((e) => e.material === "skin" && e.level === 2)!.hex).toBe("#000003");
  });
});

describe("legendText", () => {
  it("has one line per entry in `<char> = <material> level <n> (<hex>)` form", () => {
    const text = legendText(buildLegend(DEFAULT_KIT, ["skin"]));
    const lines = text.split("\n");
    expect(lines).toHaveLength(1 + RAMP_LEN);
    expect(lines[0]).toBe(". = transparent");
    expect(lines[1]).toMatch(/^\S = skin level 0 \(#[0-9a-f]{6}\)$/i);
    expect(text).not.toContain("metal");
    expect(legendText(full).split("\n")).toHaveLength(PALETTE_SIZE_CLASSIC);
  });
});

describe("encode / decode", () => {
  it("round-trips a sprite", () => {
    const data = Array.from({ length: 12 * 9 }, (_, i) => i % PALETTE_SIZE_CLASSIC);
    const s = { w: 12, h: 9, data };
    expect(decodeRows(encodeSprite(s, full), 12, 9, full)).toEqual(s);
  });

  it("art written against a subset legend decodes with the full legend", () => {
    const subset = buildLegend(DEFAULT_KIT, ["wood"]);
    const s = { w: 5, h: 1, data: [0, ...Array.from({ length: 4 }, (_, i) => colorIndex("wood", i))] };
    expect(decodeRows(encodeSprite(s, subset), 5, 1, full)).toEqual(s);
  });

  it("maps indices missing from the legend to the nearest same-material level, else '.'", () => {
    const l = buildLegend(DEFAULT_KIT, ["skin"]);
    const s = { w: 3, h: 1, data: [colorIndex("metal", 2), colorIndex("skin", 2), 9999] };
    const rows = encodeSprite(s, l);
    expect(rows[0][0]).toBe(".");
    expect(l.byChar.get(rows[0][1])).toBe(colorIndex("skin", 2));
    expect(rows[0][2]).toBe(".");
    // partial ramp: only two levels listed -> nearest level
    const partial: typeof l = { ...l, entries: l.entries.filter((e) => e.level === 0 || e.level === 4), byIndex: new Map([[0, "."]]) };
    const e0 = partial.entries.find((e) => e.level === 0)!;
    partial.byIndex.set(e0.index, e0.char);
    expect(encodeSprite({ w: 1, h: 1, data: [colorIndex("skin", 1)] }, partial)[0]).toBe(e0.char);
  });

  it("pads short/missing rows and crops long ones to exactly w x h", () => {
    const a = full.byChar.get("a")!, b = full.byChar.get("b")!;
    const s = decodeRows(["ab", "abcdefghijkl", 7 as any, null as any], 4, 6, full);
    expect(s.w).toBe(4);
    expect(s.h).toBe(6);
    expect(s.data).toHaveLength(24);
    expect(s.data.slice(0, 4)).toEqual([a, b, 0, 0]);
    expect(s.data.slice(4, 8)).toEqual(["a", "b", "c", "d"].map((c) => full.byChar.get(c)));
    expect(s.data.slice(8)).toEqual(new Array(16).fill(0));
  });

  it("maps unknown chars to transparent and tolerates garbage", () => {
    const s = decodeRows(['a \"b😀'], 5, 1, full);
    expect(s.data).toEqual([full.byChar.get("a"), 0, 0, full.byChar.get("b"), 0]);
    expect(decodeRows(undefined as any, 8, 8, full).data).toEqual(new Array(64).fill(0));
    expect(decodeRows("not rows" as any, 8, 8, full).data).toHaveLength(64);
    // chars outside a filtered legend are unknown -> 0
    const subset = buildLegend(DEFAULT_KIT, ["skin"]);
    expect(decodeRows(["a"], 1, 1, subset).data).toEqual([0]);
  });
});

describe("deep kits", () => {
  const deep = buildLegend(HD_DEEP_KIT);

  it("keeps classic chars stable and adds unique non-ASCII chars for the extra shades", () => {
    expect(deep.entries).toHaveLength(PALETTE_SIZE - 1);
    expect(deep.byChar.size).toBe(PALETTE_SIZE);
    for (const e of full.entries) expect(deep.byIndex.get(e.index)).toBe(e.char);
    const fine = deep.entries.filter((e) => e.index >= FINE_START);
    expect(fine).toHaveLength(MATERIALS.length * 4);
    for (const e of fine) {
      expect(e.char).not.toMatch(/^[\x20-\x7e]$/);
      expect(e.level % 1).toBe(0.5);
      expect(deep.byChar.get(e.char)).toBe(e.index);
    }
  });

  it("round-trips a sprite that uses fine shades", () => {
    const s = { w: 13, h: 11, data: Array.from({ length: 13 * 11 }, (_, i) => i % PALETTE_SIZE) };
    expect(decodeRows(encodeSprite(s, deep), 13, 11, deep)).toEqual(s);
  });

  it("a classic legend folds a fine shade onto a neighbouring classic char", () => {
    const idx = FINE_START + 2 * 4 + 1; // hair, between level 1 and 2
    const ch = encodeSprite({ w: 1, h: 1, data: [idx] }, full)[0];
    expect([full.byIndex.get(colorIndex("hair", 1)), full.byIndex.get(colorIndex("hair", 2))]).toContain(ch);
  });
});

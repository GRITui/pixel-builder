import { describe, expect, it } from "vitest";
import { applyOutline } from "./enforce";
import { applyRegionEdit, cellsMask, checkRegionRows, maskBounds, rectMask, regionContext } from "./inpaint";
import { DEFAULT_KIT } from "./kit";
import { buildLegend } from "./legend";
import { colorIndex, OUTLINE_INDEX } from "./palette";
import { createSprite } from "./sprite";
import type { StyleKit } from "./types";

const kit: StyleKit = { ...DEFAULT_KIT, outline: "black" };
const legend = buildLegend(kit);
const ch = (m: Parameters<typeof colorIndex>[0], l: number) => legend.byIndex.get(colorIndex(m, l))!;

/** 16x16 sprite: a 6x6 cloth block at (5,5) with its outline. */
function base() {
  const s = createSprite(16, 16);
  for (let y = 5; y < 11; y++) for (let x = 5; x < 11; x++) s.data[y * 16 + x] = colorIndex("cloth", 2);
  return applyOutline(s, kit);
}

describe("masks", () => {
  it("bounds a cell list", () => {
    expect(maskBounds(cellsMask(8, 8, [[2, 3], [5, 4]]), 8)).toEqual({ x: 2, y: 3, w: 4, h: 2 });
    expect(maskBounds(rectMask(8, 8, { x: 20, y: 20, w: 2, h: 2 }), 8)).toBeNull();
  });
  it("regionContext returns the sprite's legend rows for a rect", () => {
    const rows = regionContext(base(), { x: 4, y: 4, w: 3, h: 2 }, legend);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(3);
    expect(rows[1][0]).not.toBe(".");
  });
});

describe("applyRegionEdit", () => {
  const rect = { x: 5, y: 5, w: 3, h: 2 };
  const rows = [ch("cloth2", 3).repeat(3), ch("cloth2", 1).repeat(3)];
  it("changes only masked cells (outline off)", () => {
    const s = base();
    const mask = rectMask(16, 16, rect);
    const { sprite } = applyRegionEdit(s, mask, rows, kit, { outline: false, cleanup: false });
    for (let i = 0; i < s.data.length; i++) if (!mask[i]) expect(sprite.data[i]).toBe(s.data[i]);
    expect(sprite.data[5 * 16 + 5]).toBe(legend.byChar.get(rows[0][0]));
    expect(sprite.data[6 * 16 + 7]).toBe(legend.byChar.get(rows[1][0]));
  });
  it("respects a cell mask exactly: chars outside the mask are ignored", () => {
    const s = base();
    const mask = cellsMask(16, 16, [[5, 5], [7, 6]]);
    const { sprite } = applyRegionEdit(s, mask, rows, kit, { outline: false, cleanup: false });
    const diff = s.data.map((v, i) => (v !== sprite.data[i] ? i : -1)).filter((i) => i >= 0);
    expect(diff).toEqual([5 * 16 + 5, 6 * 16 + 7]);
  });
  it("rejects non-legend chars, wrong sizes and empty masks", () => {
    const mask = rectMask(16, 16, rect);
    expect(() => applyRegionEdit(base(), mask, ['a"a', "aaa"], kit)).toThrow(/not a legend char/);
    expect(() => applyRegionEdit(base(), mask, ["aaa"], kit)).toThrow(/expected 2 rows/);
    expect(() => applyRegionEdit(base(), mask, ["aaaa", "aaa"], kit)).toThrow(/4 chars/);
    expect(() => applyRegionEdit(base(), new Uint8Array(256), rows, kit)).toThrow(/empty/);
    // an illegal char outside a cells mask is ignored
    expect(checkRegionRows(['"a', "aa"], { x: 0, y: 0, w: 2, h: 2 }, legend, cellsMask(2, 2, [[1, 0], [0, 1], [1, 1]]), 2)).toEqual([]);
  });
  it("outlines only around changed pixels", () => {
    // Two far-apart blocks; editing one must leave the other's outline pixels untouched.
    const s = createSprite(32, 16);
    for (const ox of [4, 22]) for (let y = 5; y < 10; y++) for (let x = ox; x < ox + 5; x++) s.data[y * 32 + x] = colorIndex("cloth", 2);
    const outlined = applyOutline(s, kit);
    // Grow block A to the right by 2 columns.
    const mask = rectMask(32, 16, { x: 9, y: 5, w: 2, h: 5 });
    const r = applyRegionEdit(outlined, mask, new Array(5).fill(ch("cloth", 2).repeat(2)), kit);
    for (let y = 0; y < 16; y++) for (let x = 14; x < 32; x++) expect(r.sprite.data[y * 32 + x]).toBe(outlined.data[y * 32 + x]);
    expect(r.sprite.data[7 * 32 + 11]).toBe(OUTLINE_INDEX);
    expect(r.sprite.data[4 * 32 + 10]).toBe(OUTLINE_INDEX);
    expect(r.sprite.data[7 * 32 + 9]).toBe(colorIndex("cloth", 2));
  });
  it("clears stale outline when the shape is erased", () => {
    const mask = rectMask(16, 16, { x: 4, y: 4, w: 8, h: 8 });
    const r = applyRegionEdit(base(), mask, new Array(8).fill("........"), kit);
    expect(r.sprite.data.every((v) => v === 0)).toBe(true);
  });
  it("stays on the kit palette", () => {
    const r = applyRegionEdit(base(), rectMask(16, 16, rect), rows, kit);
    for (const v of r.sprite.data) expect(Number.isInteger(v) && v >= 0 && v <= 90).toBe(true);
  });
  it("is a no-op when the rows match", () => {
    const s = base();
    const same = regionContext(s, rect, legend);
    expect(applyRegionEdit(s, rectMask(16, 16, rect), same, kit).changed).toBe(0);
  });
});

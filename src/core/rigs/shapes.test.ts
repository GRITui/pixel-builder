import { describe, expect, it } from "vitest";
import { characterGenerator } from "../generators/character";
import { defaults } from "../generators/types";
import { DEFAULT_KIT, RICH_KIT } from "../kit";
import { decodeIndex } from "../palette";
import type { Sprite, StyleKit } from "../types";
import { applyPattern, patternsOf, patternAttachment } from "./shapes-pattern";
import { shapesOn } from "./shapes";

const kit48: StyleKit = { ...RICH_KIT, sizes: { ...RICH_KIT.sizes, character: 48 } };
const std48: StyleKit = { ...DEFAULT_KIT, sizes: { ...DEFAULT_KIT.sizes, character: 48 } };
const gen = (p: Record<string, unknown>, kit: StyleKit, seed = 1) =>
  characterGenerator.generate({ ...defaults(characterGenerator), ...p } as never, kit, seed).rows;
const same = (a: Sprite, b: Sprite) => a.data.length === b.data.length && a.data.every((v, i) => v === b.data[i]);
const first = (p: Record<string, unknown>, kit: StyleKit, name = "walk-down") => gen(p, kit).find((r) => r.name === name)!.frames[0];

describe("richer character shapes (#38)", () => {
  it("gates: rich kits and 48px canvases only", () => {
    expect(shapesOn(DEFAULT_KIT, 32)).toBe(false);
    expect(shapesOn(RICH_KIT, 32)).toBe(true);
    expect(shapesOn(std48, 48)).toBe(true);
  });

  it("new params default to none/neutral and leave 32px standard output untouched", () => {
    const base = first({}, DEFAULT_KIT);
    expect(same(first({ pattern: "none", expression: "neutral" }, DEFAULT_KIT), base)).toBe(true);
    expect(same(first({ pattern: "plaid" }, DEFAULT_KIT), base)).toBe(false);
    expect(same(first({ expression: "happy" }, DEFAULT_KIT), base)).toBe(false);
  });

  it("is deterministic per seed and sized to the kit", () => {
    const a = first({ hair_style: "bun" }, kit48), b = first({ hair_style: "bun" }, kit48);
    expect(a.w).toBe(48);
    expect(same(a, b)).toBe(true);
  });

  it("shapes change pixels on rich and 48px kits", () => {
    expect(same(first({}, std48), first({}, { ...std48, sizes: { ...std48.sizes, character: 47 } }))).toBe(false);
    for (const e of ["happy", "surprised", "tired"]) expect(same(first({ expression: e }, kit48), first({}, kit48))).toBe(false);
  });

  it("hands and hair exist in every view at 48 incl. diagonals", () => {
    const rows = gen({ directions: "8", hair_style: "long" }, kit48);
    expect(rows).toHaveLength(8);
    for (const r of rows) {
      const f = r.frames[0];
      const mats = new Set(f.data.filter(Boolean).map((v) => decodeIndex(v)!.mat));
      expect(mats.has("hair")).toBe(true);
      expect(mats.has("skin")).toBe(true);
      expect(r.frames).toHaveLength(4);
    }
  });

  it("patterns only move pixels along the garment's own ramp", () => {
    const plain = first({ top: "cloth" }, kit48);
    for (const pattern of ["plaid", "stripes", "polka", "gingham"]) {
      const s = first({ top: "cloth", pattern }, kit48);
      expect(same(s, plain)).toBe(false);
      s.data.forEach((v, i) => {
        if (v === plain.data[i]) return;
        expect(decodeIndex(v)!.mat).toBe("cloth");
        expect(decodeIndex(plain.data[i])!.mat).toBe("cloth");
      });
    }
  });

  it("applyPattern leaves the input alone and attachment ids resolve to slots", () => {
    const s = first({}, kit48);
    const copy = { ...s, data: s.data.slice() };
    applyPattern(s, { pattern: "plaid", mat: "cloth", kit: kit48, yMin: 16, yMax: 40 });
    expect(same(s, copy)).toBe(true);
    expect(patternsOf([patternAttachment("plaid"), patternAttachment("polka", "accent")], { top: "grass", accent: "roof" } as never)).toEqual([
      { pattern: "plaid", mat: "grass" },
      { pattern: "polka", mat: "roof" },
    ]);
  });
});

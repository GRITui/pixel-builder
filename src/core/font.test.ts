import { describe, expect, it } from "vitest";
import { colorIndex } from "./palette";
import { createSprite } from "./sprite";
import { drawText, FONT_CHARS, glyph, textWidth } from "./font";

describe("pixel font", () => {
  it("covers 0-9, A-Z and punctuation with 3x5 glyphs", () => {
    for (const ch of "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ:/-. ") {
      expect(FONT_CHARS).toContain(ch);
      const g = glyph(ch);
      expect(g).toHaveLength(5);
      for (const row of g) expect(row).toHaveLength(3);
    }
    for (const ch of "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ") expect(glyph(ch).flat().some(Boolean)).toBe(true);
  });
  it("textWidth is 4 per glyph minus the trailing gap", () => {
    expect(textWidth("")).toBe(0);
    expect(textWidth("1")).toBe(3);
    expect(textWidth("12:34")).toBe(19);
  });
  it("draws into a sprite with the chosen palette level", () => {
    const s = createSprite(20, 7);
    expect(drawText(s, 1, 1, "A1", "gold", 3)).toBe(7);
    expect([...new Set(s.data.filter(Boolean))]).toEqual([colorIndex("gold", 3)]);
  });
});

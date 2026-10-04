import { describe, expect, it } from "vitest";
import { DEFAULT_KIT } from "./kit";
import { colorIndex } from "./palette";
import { spriteSheetToSvg, svgToSprites } from "./svg";
import type { Sprite } from "./types";

const sprite = (): Sprite => {
  const data = new Array(16).fill(0);
  data[5] = colorIndex("roof", 2);
  data[6] = colorIndex("roof", 2);
  data[9] = colorIndex("ink", 0);
  return { w: 4, h: 4, data };
};

describe("svg", () => {
  it("roundtrips, merging runs and separating material layers", () => {
    const svg = spriteSheetToSvg({ name: "t", category: "object", kit: DEFAULT_KIT, rows: [{ name: "idle", frames: [sprite(), sprite()] }] });
    expect(svg).toContain('inkscape:label="roof"');
    expect(svg).toContain('inkscape:label="outline"');
    expect(svg).toContain('width="2" height="1"');
    const back = svgToSprites(svg, DEFAULT_KIT);
    expect(back.rows[0].frames.map((f) => f.data)).toEqual([sprite().data, sprite().data]);
  });

  it("snaps edited fills to the kit and skips hidden layers and guides", () => {
    const svg = `<svg viewBox="0 0 4 4"><g id="guides"><rect x="0" y="0" width="4" height="4" fill="#ff0000"/></g>
      <g style="display:none"><rect x="0" y="0" width="1" height="1" fill="#00ff00"/></g>
      <g><rect x="1" y="1" width="2" height="1" fill="#ffffff"/></g></svg>`;
    const f = svgToSprites(svg, DEFAULT_KIT).rows[0].frames[0];
    expect(f.data.filter((v) => v > 0)).toHaveLength(2);
    expect(f.data[0]).toBe(0);
  });
});

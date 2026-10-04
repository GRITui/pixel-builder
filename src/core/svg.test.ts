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
    expect(svg).toContain("M1 1h2v1h-2z"); // the two roof pixels are one merged rectangle
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

  it("merges equal pixels into 2D rectangles and round-trips a noisy sprite byte-identically", () => {
    const data = new Array(64).fill(0);
    for (let y = 1; y < 7; y++) for (let x = 1; x < 5; x++) data[y * 8 + x] = colorIndex("wood", 2);
    data[7 * 8 + 7] = colorIndex("wood", 1);
    data[0] = colorIndex("wood", 3);
    const sp: Sprite = { w: 8, h: 8, data };
    const svg = spriteSheetToSvg({ name: "t", category: "object", kit: DEFAULT_KIT, rows: [{ name: "idle", frames: [sp] }] });
    expect(svg).toContain("M1 1h4v6h-4z");
    expect(svgToSprites(svg, DEFAULT_KIT).rows[0].frames[0].data).toEqual(data);
  });

  it("reads inherited fill/material from groups, and rectangle paths", () => {
    const svg = `<svg viewBox="0 0 4 4"><g data-material="roof"><g data-level="2"><rect x="0" y="0" width="1" height="1"/></g></g>
      <g fill="#ffffff"><path d="M2 2h2v1h-2zM0 3H1V4H0z"/></g></svg>`;
    const f = svgToSprites(svg, DEFAULT_KIT).rows[0].frames[0];
    expect(f.data[0]).toBe(colorIndex("roof", 2));
    expect(f.data.filter((v) => v > 0)).toHaveLength(4);
  });

  it("reuses repeated map tiles through symbol/use and reads them back", () => {
    const tile = DEFAULT_KIT.sizes.tile;
    const W = tile * 4;
    const data = new Array(W * tile).fill(0);
    for (let c = 0; c < 4; c++) for (let y = 0; y < tile; y += 2) for (let x = (y / 2) % 3; x < tile; x += 3) data[y * W + c * tile + x] = colorIndex("grass", 1 + ((x + y) % 3));
    const sp: Sprite = { w: W, h: tile, data };
    const svg = spriteSheetToSvg({ name: "m", category: "map", kit: DEFAULT_KIT, rows: [{ name: "map", frames: [sp] }], tilemap: { cols: 4, rows: 1, tile, layers: [], tileset: [] } as never });
    expect(svg).toContain("<symbol id=\"pb-s0\"");
    expect(svg).toContain("<use href=\"#pb-s0\"");
    expect(svgToSprites(svg, DEFAULT_KIT).rows[0].frames[0].data).toEqual(data);
  });
});

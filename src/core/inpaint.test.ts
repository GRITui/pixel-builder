// Acceptance tests for the inpaint core (issue #18). These prove, with a
// mocked model sprite (no model call, no API key), the three guarantees:
//   1. the mask is respected (masked cells come from the model),
//   2. only legend chars survive (off-legend chars are dropped, not corrupting),
//   3. unmasked pixels come back byte-identical to the original.
import { describe, expect, it } from "vitest";
import { finalize } from "./enforce";
import { DEFAULT_KIT } from "./kit";
import { buildLegend, encodeSprite } from "./legend";
import { PALETTE_SIZE } from "./palette";
import { createSprite } from "./sprite";
import {
  buildInpaintPrompt,
  decodeModelRows,
  inpaint,
  inpaintFrame,
  maskHasPixels,
  offLegendChars,
  rectMask,
  renderMask,
  toMaskGrid,
} from "./inpaint";

const W = 6;
const H = 6;
const legend = buildLegend(DEFAULT_KIT);

/** A 6x6 sprite: left half (x<3) = index 2, right half (x>=3) = index 7. */
function baseSprite(): ReturnType<typeof createSprite> {
  const s = createSprite(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) s.data[y * W + x] = x < 3 ? 2 : 7;
  return s;
}

describe("mask math", () => {
  it("rectMask builds a clamped per-cell grid", () => {
    const m = rectMask(W, H, { x: 1, y: 1, w: 2, h: 2 });
    expect(m).toHaveLength(H);
    expect(m[1][1]).toBe(true);
    expect(m[1][2]).toBe(true);
    expect(m[2][2]).toBe(true);
    expect(m[0][0]).toBe(false);
    expect(m[3][3]).toBe(false);
  });

  it("rectMask clamps to the frame", () => {
    const m = rectMask(W, H, { x: 4, y: 4, w: 9, h: 9 });
    expect(m[4][4]).toBe(true);
    expect(m[5][5]).toBe(true);
    expect(m[5][4]).toBe(true);
    // nothing outside the frame is set
    expect(m.every((row) => row.every((v) => (v ? true : true)))).toBe(true);
    let count = 0;
    for (const row of m) for (const v of row) if (v) count++;
    expect(count).toBe(4); // only (4,4),(5,4),(4,5),(5,5)
  });

  it("toMaskGrid normalises a lasso grid and a rect alike", () => {
    const lasso: boolean[][] = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => x === 0 && y === 0));
    expect(toMaskGrid(W, H, lasso)[0][0]).toBe(true);
    expect(toMaskGrid(W, H, lasso)[1][0]).toBe(false);
    expect(toMaskGrid(W, H, { x: 0, y: 0, w: 1, h: 1 })[0][0]).toBe(true);
  });

  it("maskHasPixels reports empty masks", () => {
    expect(maskHasPixels(rectMask(W, H, { x: 0, y: 0, w: 0, h: 0 }))).toBe(false);
    expect(maskHasPixels(rectMask(W, H, { x: 0, y: 0, w: 1, h: 1 }))).toBe(true);
  });

  it("renderMask renders # for editable cells", () => {
    const rows = renderMask(rectMask(W, H, { x: 0, y: 0, w: 2, h: 1 }));
    expect(rows[0]).toBe("##....");
    expect(rows[1]).toBe("......");
  });
});

describe("inpaint guarantees", () => {
  it("respects the mask: with a full mask the output is exactly finalize(model)", () => {
    // A solid 4x4 block of index 3 in the centre, transparent border.
    const model = createSprite(W, H);
    for (let y = 1; y <= 4; y++) for (let x = 1; x <= 4; x++) model.data[y * W + x] = 3;
    const original = baseSprite();
    const mask = toMaskGrid(W, H, { x: 0, y: 0, w: W, h: H }); // every cell editable
    const out = inpaintFrame(original, model, mask, DEFAULT_KIT);
    const expected = finalize(model, DEFAULT_KIT, { cleanup: true });
    expect(out.data).toEqual(expected.data);
    // and it is clearly the model's content, not the original's
    expect(out.data).not.toEqual(original.data);
  });

  it("keeps unmasked pixels byte-identical to the original", () => {
    const original = baseSprite();
    const model = createSprite(W, H, 12); // a totally different fill
    const mask = toMaskGrid(W, H, { x: 0, y: 0, w: 3, h: H }); // left half only
    const out = inpaintFrame(original, model, mask, DEFAULT_KIT);
    // Every unmasked (right-half) cell must be byte-identical to the original.
    for (let y = 0; y < H; y++) for (let x = 3; x < W; x++) expect(out.data[y * W + x]).toBe(original.data[y * W + x]);
    // The masked (left-half) cells carry the model's content.
    for (let y = 0; y < H; y++) for (let x = 0; x < 3; x++) expect(out.data[y * W + x]).toBe(12);
  });

  it("restores unmasked pixels even when finalize would draw an outline into them", () => {
    // Original: a 2x2 block in the top-left, everything else transparent.
    // The mask covers only the block. The model paints the block a different
    // colour AND extends it, so finalize's outline would reach into unmasked
    // space — but those unmasked pixels must still come back unchanged.
    const original = createSprite(W, H);
    original.data[0 * W + 0] = 2;
    original.data[0 * W + 1] = 2;
    original.data[1 * W + 0] = 2;
    original.data[1 * W + 1] = 2;
    const model = createSprite(W, H, 4); // model fills the whole frame
    const mask = toMaskGrid(W, H, { x: 0, y: 0, w: 2, h: 2 });
    const out = inpaintFrame(original, model, mask, DEFAULT_KIT);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!mask[y][x]) expect(out.data[y * W + x]).toBe(original.data[y * W + x]);
      }
  });

  it("returns the original unchanged when the mask is empty", () => {
    const original = baseSprite();
    const model = createSprite(W, H, 12);
    const out = inpaint({ frame: original, model, region: { x: 0, y: 0, w: 0, h: 0 }, kit: DEFAULT_KIT });
    expect(out.data).toEqual(original.data);
  });
});

describe("only legend chars survive", () => {
  it("offLegendChars reports chars outside the legend", () => {
    expect(offLegendChars(["...."], legend)).toEqual([]);
    expect(offLegendChars(["a b"], legend)).toEqual([" "]);
    expect(offLegendChars(["a'b"], legend)).toEqual(["'"]);
  });

  it("decodeModelRows drops off-legend chars to transparent", () => {
    const sp = decodeModelRows(["a b"], 3, 1, legend);
    expect(sp.data).toEqual([legend.byChar.get("a"), 0, legend.byChar.get("b")]);
    expect(sp.data[1]).toBe(0);
  });

  it("an inpaint result only ever contains valid palette indices", () => {
    const original = baseSprite();
    const model = decodeModelRows(
      Array.from({ length: H }, (_, y) => (y % 2 ? "aXbXcX" : "XaXbXc")),
      W,
      H,
      legend,
    );
    const out = inpaintFrame(original, model, toMaskGrid(W, H, { x: 0, y: 0, w: W, h: H }), DEFAULT_KIT);
    for (const v of out.data) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(PALETTE_SIZE);
    }
  });
});

describe("prompt", () => {
  it("buildInpaintPrompt carries the legend, the frame, the region and the request", () => {
    const frame = baseSprite();
    const p = buildInpaintPrompt({ frame, region: { x: 0, y: 0, w: 3, h: H }, prompt: "make it red", kit: DEFAULT_KIT });
    expect(p).toContain("PALETTE LEGEND");
    expect(p).toContain("REGION TO EDIT");
    expect(p).toContain("make it red");
    expect(p).toContain("RETURN".toLowerCase());
    // The region grid has one row per frame row, # for the masked left half.
    const regionRows = p.split("\n").filter((l) => /^[#.]{6}$/.test(l));
    expect(regionRows).toHaveLength(H);
    expect(regionRows[0]).toBe("###...");
    // The current sprite is shown as legend rows (the frame's own encoding).
    const rows = encodeSprite(frame, legend);
    expect(p).toContain(rows[0]);
  });
});

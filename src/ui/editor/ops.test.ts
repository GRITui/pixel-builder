import { describe, expect, it } from "vitest";
import { colorIndex, RAMP_LEN } from "../../core/palette";
import { createSprite, getPx, setPx } from "../../core/sprite";
import { DEFAULT_KIT } from "../../core/kit";
import {
  canRedo, canUndo, createHistory, cropToContent, floodFill, floodFillGrid, linePoints, moveItem, paintPoints,
  pushHistory, rectPoints, redo, removeBackground, resizeGrid, resizeSprite, selectionRect, applyRegionToRow, shadePixel, shadePoints, undo, withMirror,
} from "./ops";
import { buildImportSprite } from "./importPipeline";

const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;

describe("region selection and apply", () => {
  it("normalizes and clamps a drag rectangle", () => {
    expect(selectionRect({ x: 5, y: 7 }, { x: 2, y: 3 }, 16, 16)).toEqual({ x: 2, y: 3, w: 4, h: 5 });
    expect(selectionRect({ x: -4, y: -2 }, { x: 40, y: 3 }, 16, 16)).toEqual({ x: 0, y: 0, w: 16, h: 4 });
    expect(selectionRect({ x: 20, y: 0 }, { x: 30, y: 4 }, 16, 16)).toBeNull();
  });

  it("applies to chosen frames only, immutably, and undo restores the earlier rows", () => {
    const kit = { ...DEFAULT_KIT, outline: "none" as const };
    const mk = () => createSprite(8, 8);
    const rows = [{ name: "idle", frames: [mk(), mk(), mk()] }];
    const edits = [0, 2].map((fi) => ({ fi, rows: ["tt", "tt"] }));
    const next = applyRegionToRow(rows, 0, edits, { x: 1, y: 1, w: 2, h: 2 }, kit, false);
    expect(next).not.toBe(rows);
    expect(rows[0].frames[0].data.some(Boolean)).toBe(false);
    expect(getPx(next[0].frames[0], 1, 1)).toBeGreaterThan(0);
    expect(next[0].frames[1]).toBe(rows[0].frames[1]);
    expect(getPx(next[0].frames[2], 2, 2)).toBeGreaterThan(0);
    expect(getPx(next[0].frames[0], 0, 0)).toBe(0);
    const h = pushHistory(createHistory(rows), next);
    expect(undo(h).present).toBe(rows);
    expect(redo(undo(h)).present).toBe(next);
  });

  it("throws on invalid rows so the editor can show the error", () => {
    const rows = [{ name: "idle", frames: [createSprite(8, 8)] }];
    expect(() => applyRegionToRow(rows, 0, [{ fi: 0, rows: ['"x', "tt"] }], { x: 0, y: 0, w: 2, h: 2 }, DEFAULT_KIT)).toThrow(/legend/);
  });
});

describe("linePoints", () => {
  it("covers a single point", () => expect(linePoints(2, 3, 2, 3)).toEqual([{ x: 2, y: 3 }]));
  it("draws a horizontal line inclusive", () => {
    expect(linePoints(0, 1, 3, 1).map(key)).toEqual(["0,1", "1,1", "2,1", "3,1"]);
  });
  it("draws a perfect diagonal", () => {
    expect(linePoints(0, 0, 3, 3).map(key)).toEqual(["0,0", "1,1", "2,2", "3,3"]);
  });
  it("is gap-free in any direction (8-connected)", () => {
    for (const [x1, y1] of [[7, 2], [-5, 9], [-6, -1], [2, -8], [0, 5]]) {
      const pts = linePoints(1, 1, x1, y1);
      expect(pts[0]).toEqual({ x: 1, y: 1 });
      expect(pts[pts.length - 1]).toEqual({ x: x1, y: y1 });
      for (let i = 1; i < pts.length; i++) {
        expect(Math.abs(pts[i].x - pts[i - 1].x)).toBeLessThanOrEqual(1);
        expect(Math.abs(pts[i].y - pts[i - 1].y)).toBeLessThanOrEqual(1);
      }
      expect(pts.length).toBe(Math.max(Math.abs(x1 - 1), Math.abs(y1 - 1)) + 1);
    }
  });
});

describe("rectPoints", () => {
  it("outlines a rectangle without the interior", () => {
    const pts = rectPoints(0, 0, 3, 2).map(key);
    expect(pts).toHaveLength(10);
    expect(pts).not.toContain("1,1");
    expect(pts).toContain("3,2");
  });
  it("accepts corners in any order and can fill", () => {
    expect(rectPoints(3, 2, 0, 0, true)).toHaveLength(12);
  });
  it("is a single point for a 1x1", () => expect(rectPoints(2, 2, 2, 2)).toEqual([{ x: 2, y: 2 }]));
});

describe("paint + mirror", () => {
  it("withMirror adds mirrored twins but not duplicates at the centre", () => {
    expect(withMirror([{ x: 0, y: 0 }, { x: 2, y: 1 }], 5).map(key)).toEqual(["0,0", "4,0", "2,1"]);
  });
  it("paintPoints clips and mirrors", () => {
    const s = createSprite(4, 2);
    paintPoints(s, [{ x: 0, y: 0 }, { x: -1, y: 0 }, { x: 9, y: 9 }], 7, true);
    expect(s.data).toEqual([7, 0, 0, 7, 0, 0, 0, 0]);
  });
});

describe("floodFill", () => {
  it("fills a 4-connected region only", () => {
    const s = createSprite(3, 3);
    // diagonal wall: 1s at (1,0) (1,1) (0,2) leaves (0,0),(0,1) enclosed on the left
    setPx(s, 1, 0, 1); setPx(s, 1, 1, 1); setPx(s, 1, 2, 1);
    const f = floodFill(s, 0, 0, 5);
    expect(f.data).toEqual([5, 1, 0, 5, 1, 0, 5, 1, 0]);
    expect(s.data[0]).toBe(0); // original untouched
  });
  it("does not leak through diagonals", () => {
    const s = createSprite(2, 2);
    setPx(s, 1, 0, 1); setPx(s, 0, 1, 1);
    const f = floodFill(s, 0, 0, 9);
    expect(getPx(f, 1, 1)).toBe(0);
    expect(getPx(f, 0, 0)).toBe(9);
  });
  it("returns the same sprite when the colour already matches or the click is outside", () => {
    const s = createSprite(2, 2, 3);
    expect(floodFill(s, 0, 0, 3)).toBe(s);
    expect(floodFill(s, 5, 5, 1)).toBe(s);
  });
  it("floodFillGrid works for map layers with -1", () => {
    expect(floodFillGrid([-1, -1, 2, -1], 2, 2, 0, 0, 4)).toEqual([4, 4, 2, 4]);
  });
});

describe("shade", () => {
  const mid = colorIndex("wood", 2);
  it("walks along the ramp and clamps", () => {
    expect(shadePixel(mid, 1)).toBe(colorIndex("wood", 3));
    expect(shadePixel(mid, -1)).toBe(colorIndex("wood", 1));
    expect(shadePixel(colorIndex("wood", RAMP_LEN - 1), 1)).toBe(colorIndex("wood", RAMP_LEN - 1));
    expect(shadePixel(colorIndex("wood", 0), -1)).toBe(colorIndex("wood", 0));
  });
  it("leaves transparent alone", () => expect(shadePixel(0, 1)).toBe(0));
  it("shades each pixel once per stroke", () => {
    const s = createSprite(2, 1, mid);
    const touched = new Set<number>();
    shadePoints(s, [{ x: 0, y: 0 }], 1, false, touched);
    shadePoints(s, [{ x: 0, y: 0 }], 1, false, touched);
    expect(s.data).toEqual([colorIndex("wood", 3), mid]);
  });
  it("mirrors", () => {
    const s = createSprite(3, 1, mid);
    shadePoints(s, [{ x: 0, y: 0 }], -1, true, new Set());
    expect(s.data).toEqual([colorIndex("wood", 1), mid, colorIndex("wood", 1)]);
  });
});

describe("resize", () => {
  it("resizeSprite anchors", () => {
    const s = createSprite(2, 2, 1);
    expect(resizeSprite(s, 4, 4, "top-left").data.slice(0, 4)).toEqual([1, 1, 0, 0]);
    expect(resizeSprite(s, 4, 4, "bottom").data.slice(12, 16)).toEqual([0, 1, 1, 0]);
    expect(resizeSprite(s, 4, 4, "center").data.slice(4, 8)).toEqual([0, 1, 1, 0]);
  });
  it("resizeGrid keeps the overlap and pads with -1", () => {
    expect(resizeGrid([1, 2, 3, 4], 2, 2, 3, 2)).toEqual([1, 2, -1, 3, 4, -1]);
    expect(resizeGrid([1, 2, 3, 4], 2, 2, 1, 1)).toEqual([1]);
  });
  it("moveItem reorders", () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    const l = [1, 2];
    expect(moveItem(l, 0, -1)).toBe(l);
  });
});

describe("history", () => {
  it("push, undo and redo", () => {
    let h = createHistory(0);
    h = pushHistory(h, 1);
    h = pushHistory(h, 2);
    expect(h.present).toBe(2);
    h = undo(h);
    expect(h.present).toBe(1);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(2);
    expect(canRedo(h)).toBe(false);
  });
  it("a new push clears the redo stack", () => {
    let h = pushHistory(pushHistory(createHistory(0), 1), 2);
    h = undo(undo(h));
    expect(h.present).toBe(0);
    h = pushHistory(h, 9);
    expect(canRedo(h)).toBe(false);
    expect(undo(h).present).toBe(0);
  });
  it("caps the undo depth, dropping the oldest", () => {
    let h = createHistory(0, 3);
    for (let i = 1; i <= 6; i++) h = pushHistory(h, i);
    expect(h.past).toEqual([3, 4, 5]);
    let n = 0;
    while (canUndo(h)) { h = undo(h); n++; }
    expect(n).toBe(3);
    expect(h.present).toBe(3);
  });
  it("undo/redo at the ends are no-ops and pushing the same value is ignored", () => {
    const h = createHistory("a");
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
    expect(pushHistory(h, "a")).toBe(h);
  });
});

function rgba(w: number, h: number, fn: (x: number, y: number) => [number, number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(fn(x, y), (y * w + x) * 4);
  return { data, w, h };
}

describe("image helpers", () => {
  const img = rgba(6, 6, (x, y) => (x >= 2 && x <= 3 && y >= 2 && y <= 3 ? [200, 30, 30, 255] : [250, 250, 250, 255]));
  it("removeBackground clears the border-connected corner colour only", () => {
    const out = removeBackground(img, 10);
    expect(out.data[3]).toBe(0);
    expect(out.data[(2 * 6 + 2) * 4 + 3]).toBe(255);
  });
  it("removeBackground keeps enclosed pockets of the background colour", () => {
    const ring = rgba(5, 5, (x, y) => {
      if (x === 2 && y === 2) return [250, 250, 250, 255];
      if (x >= 1 && x <= 3 && y >= 1 && y <= 3) return [10, 10, 10, 255];
      return [250, 250, 250, 255];
    });
    const out = removeBackground(ring, 10);
    expect(out.data[(2 * 5 + 2) * 4 + 3]).toBe(255);
    expect(out.data[3]).toBe(0);
  });
  it("cropToContent trims transparent margins", () => {
    const cropped = cropToContent(removeBackground(img, 10));
    expect([cropped.w, cropped.h]).toEqual([2, 2]);
  });
  it("cropToContent leaves a fully transparent image alone", () => {
    const empty = rgba(3, 3, () => [0, 0, 0, 0]);
    expect(cropToContent(empty)).toBe(empty);
  });
});

describe("buildImportSprite", () => {
  const src = rgba(40, 40, (x, y) => (x >= 10 && x < 30 && y >= 5 && y < 35 ? [200, 60, 50, 255] : [255, 255, 255, 255]));
  const base = { width: 16, height: 16, crop: true, removeBg: true, bgTolerance: 20, outline: true, cleanup: false, pad: true, anchor: "bottom" as const };
  it("produces an exact-size, palette-clean sprite with an outline", () => {
    const s = buildImportSprite(src, base, DEFAULT_KIT);
    expect([s.w, s.h]).toEqual([16, 16]);
    expect(s.data.every((v) => Number.isInteger(v) && v >= 0)).toBe(true);
    expect(s.data.some((v) => v > 0)).toBe(true);
    // 1px transparent frame is consumed by the outline, bottom row is outline or empty
    expect(s.data.slice(0, 16).every((v) => v === 0)).toBe(false);
  });
  it("without padding the canvas hugs the picture", () => {
    const s = buildImportSprite(src, { ...base, pad: false, outline: false }, DEFAULT_KIT);
    expect(s.w).toBeLessThan(16);
    expect(s.h).toBe(16);
  });
  it("without background removal everything is opaque", () => {
    const s = buildImportSprite(src, { ...base, removeBg: false, crop: false, outline: false }, DEFAULT_KIT);
    expect(s.data.every((v) => v > 0)).toBe(true);
  });
});

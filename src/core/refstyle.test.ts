import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodePng } from "../node/png";
import { luma, MATERIALS, hexToRgb, rgbToOklab } from "./palette";
import { analyzeReference, blendRamp, estimatePixelScaleFast, type RefImage } from "./refstyle";

const load = (name: string): RefImage => {
  const p = decodePng(readFileSync(`test/fixtures/refs/${name}.png`));
  return { w: p.width, h: p.height, data: p.rgba };
};
const FIXTURES = ["gameboy-4tone", "outline-black", "outline-none", "light-top-left", "light-top-right", "neon-dither", "upscaled-x4", "painting-gradient", "mmo-crop"];

/** Mean OKLab distance from the image's pixels to the nearest extracted palette colour. */
function paletteError(img: RefImage, hexes: string[]): number {
  const pal = hexes.map((h) => rgbToOklab(hexToRgb(h)));
  let sum = 0, n = 0;
  const px = (i: number) => [img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]].join();
  const corners = [0, img.w - 1, (img.h - 1) * img.w, img.h * img.w - 1].map(px);
  const bg = corners.every((c) => c === corners[0]) ? corners[0] : null; // a flat background is not part of the style
  for (let i = 0; i < img.w * img.h; i += 3) {
    if (img.data[i * 4 + 3] < 128 || px(i) === bg) continue;
    const l = rgbToOklab([img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]]);
    sum += Math.min(...pal.map((p) => Math.hypot(p[0] - l[0], p[1] - l[1], p[2] - l[2])));
    n++;
  }
  return sum / n;
}

describe("analyzeReference", () => {
  it("extracts a palette close to the image colours", () => {
    for (const f of FIXTURES) {
      const img = load(f);
      const a = analyzeReference(img);
      expect(a.palette.length).toBeGreaterThanOrEqual(f === "gameboy-4tone" || f === "upscaled-x4" ? 3 : 8);
      expect(a.palette.length).toBeLessThanOrEqual(32);
      expect(paletteError(img, a.palette.map((p) => p.hex)), f).toBeLessThan(0.05);
      expect(a.palette.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1, 3);
    }
  });

  it("guesses the outline mode of labelled fixtures", () => {
    expect(analyzeReference(load("outline-black")).outline.mode).toBe("black");
    expect(analyzeReference(load("outline-none")).outline.mode).toBe("none");
    expect(analyzeReference(load("gameboy-4tone")).outline.mode).toBe("black");
    expect(analyzeReference(load("neon-dither")).outline.mode).toBe("colored");
    expect(analyzeReference(load("painting-gradient")).outline.mode).toBe("none");
  });

  it("guesses the light direction of labelled fixtures", () => {
    expect(analyzeReference(load("light-top-left")).light.dir).toBe("top-left");
    expect(analyzeReference(load("light-top-right")).light.dir).toBe("top-right");
    expect(analyzeReference(load("painting-gradient")).light.dir).toBe("top");
  });

  it("detects a 4-tone handheld image and an integer upscale", () => {
    const gb = analyzeReference(load("gameboy-4tone"));
    expect(gb.limited).toBe(true);
    expect(gb.palette).toHaveLength(4);
    expect(gb.shadeSteps).toBe(3);
    const up = analyzeReference(load("upscaled-x4"));
    expect(up.pixelScale).toBe(4);
    expect(up.palette.map((p) => p.hex)).toEqual(gb.palette.map((p) => p.hex));
    expect(estimatePixelScaleFast(load("gameboy-4tone"))).toBe(1);
    expect(estimatePixelScaleFast(load("painting-gradient"))).toBe(1);
  });

  it("detects checkerboard dithering", () => {
    const w = 32, h = 32, data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const on = ((i % w) + ((i / w) | 0)) % 2 === 0;
      data.set(on ? [200, 90, 60, 255] : [90, 40, 30, 255], i * 4);
    }
    expect(analyzeReference({ w, h, data }).dither.enabled).toBe(true);
    expect(analyzeReference(load("outline-none")).dither.enabled).toBe(false);
  });

  it("suggests richer detail for painted references", () => {
    expect(analyzeReference(load("painting-gradient")).suggest.rampDepth).toBe(9);
    expect(analyzeReference(load("gameboy-4tone")).suggest.detail).toBe("standard");
  });

  it("builds ramps that are ordered dark to light, only for matched materials", () => {
    for (const f of FIXTURES) {
      const a = analyzeReference(load(f));
      expect(Object.keys(a.rampOverrides).length, f).toBeGreaterThan(0);
      for (const m of MATERIALS) {
        const r = a.rampOverrides[m] ?? a.harmonized[m];
        expect(r, `${f} ${m}`).toHaveLength(5);
        if (!a.limited) for (let i = 1; i < 5; i++) expect(luma(r![i]), `${f} ${m} level ${i}`).toBeGreaterThan(luma(r![i - 1]));
      }
      if (!a.limited) expect(Object.keys(a.rampOverrides).length + Object.keys(a.harmonized).length).toBe(MATERIALS.length);
    }
    // a green-only painting has no red family: roof falls back (harmonised, not overridden)
    expect(analyzeReference(load("painting-gradient")).rampOverrides.roof).toBeUndefined();
    expect(analyzeReference(load("painting-gradient")).rampOverrides.grass).toBeDefined();
  });

  it("is deterministic and respects paletteSize", () => {
    const img = load("mmo-crop");
    expect(analyzeReference(img)).toEqual(analyzeReference(img));
    expect(analyzeReference(img, { paletteSize: 8 }).palette.length).toBeLessThanOrEqual(8);
    expect(analyzeReference(img, { paletteSize: 24 }).palette.length).toBeGreaterThan(analyzeReference(img, { paletteSize: 8 }).palette.length);
  });

  it("handles a fully transparent or tiny image", () => {
    expect(analyzeReference({ w: 4, h: 4, data: new Uint8Array(64) }).palette).toEqual([]);
    expect(() => analyzeReference({ w: 1, h: 1, data: new Uint8Array([10, 20, 30, 255]) })).not.toThrow();
  });
});

describe("blendRamp", () => {
  it("is the base at 0, the derived ramp at 1 and ordered in between", () => {
    const base = ["#101010", "#303030", "#606060", "#a0a0a0", "#e0e0e0"], derived = ["#200a0a", "#502010", "#904030", "#d08060", "#ffd0b0"];
    expect(blendRamp(base, derived, 0)).toEqual(base);
    expect(blendRamp(base, derived, 1)).toEqual(derived);
    const mid = blendRamp(base, derived, 0.5);
    for (let i = 1; i < 5; i++) expect(luma(mid[i])).toBeGreaterThan(luma(mid[i - 1]));
  });
});

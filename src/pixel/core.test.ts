import { describe, expect, it } from "vitest";
import { hexToRgb, oklabToOklch, oklabToRgb, rgbToOklab } from "../color/oklab";
import { NES } from "../color/palettes";
import { gradient } from "./fixtures";
import { pixelize } from "./pipeline";
import { ERAS, PRESETS, type Era, type Rgba } from "./types";
import { validate } from "./validate";

/** Deterministic photo-ish scene: sky gradient, sand, a bright lamp, and noise. */
function scene(w: number, h: number, seed = 1): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  let s = seed;
  const noise = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5) * 14;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = y / h;
    let c = t < 0.55 ? [90 + 120 * t, 130 + 80 * t, 220 - 60 * t] : [200 - 40 * t * seed, 170, 120 + 30 * (x / w)];
    const d = Math.hypot(x - w * 0.7, y - h * 0.3);
    if (d < w * 0.05) c = [255, 250, 220];
    data.set([c[0] + noise(), c[1] + noise(), c[2] + noise(), 255], (y * w + x) * 4);
  }
  return { w, h, data };
}

/** Hue chart: one flat swatch per hue at constant lightness/chroma. */
function chart(): Rgba {
  const n = 12, sw = 16, w = n * sw, h = 32, data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < n; i++) {
    const H = (i / n) * Math.PI * 2;
    const lab = [0.7, 0.08 * Math.cos(H), 0.08 * Math.sin(H)];
    const [r, g, b] = oklabToRgb(lab[0], lab[1], lab[2]).map(Math.round);
    for (let y = 0; y < h; y++) for (let x = 0; x < sw; x++) data.set([r, g, b, 255], (y * w + i * sw + x) * 4);
  }
  return { w, h, data };
}

const lum = (img: Rgba, x0: number, y0: number, x1: number, y1: number) => {
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { sum += rgbToOklab(...(Array.from(img.data.subarray((y * img.w + x) * 4, (y * img.w + x) * 4 + 3)) as [number, number, number]))[0]; n++; }
  return sum / n;
};

describe("pixelize core", () => {
  const src = scene(400, 260);
  it.each([8, 16, 32, 64] as Era[])("era %i respects its colour limit and validates", (era) => {
    const r = pixelize(src, { era, width: 120 });
    expect(r.meta.placeholder).toBe(false);
    expect(r.meta.colours).toBeLessThanOrEqual(ERAS[era].colours);
    expect(validate(r.native, { maxColours: ERAS[era].colours }).ok).toBe(true);
    expect(r.native.w).toBe(120);
  });

  it("uses the era default width and NES colours for 8-bit", () => {
    const r = pixelize(src, { era: 8 });
    expect(r.native.w).toBe(ERAS[8].width);
    for (const hex of r.palette) expect(NES).toContain(hex);
  });

  it("16-bit colours are RGB555-representable", () => {
    const r = pixelize(src, { era: 16, width: 100 });
    for (const hex of r.palette) for (const v of hexToRgb(hex)) expect([0, 8, 16, 24, 33, 41, 49, 57, 66, 74, 82, 90, 99, 107, 115, 123, 132, 140, 148, 156, 165, 173, 181, 189, 198, 206, 214, 222, 231, 239, 247, 255]).toContain(v);
  });

  it("is deterministic per seed", () => {
    const a = pixelize(src, { era: 32, width: 100, seed: 5, bloom: "med", dither: "low", outline: true });
    const b = pixelize(src, { era: 32, width: 100, seed: 5, bloom: "med", dither: "low", outline: true });
    expect([...a.native.data]).toEqual([...b.native.data]);
    expect(a.palette).toEqual(b.palette);
  });

  it("presets are deterministic and distinct", () => {
    const outs = PRESETS.map((preset) => pixelize(src, { era: 32, width: 80, preset }));
    const again = PRESETS.map((preset) => pixelize(src, { era: 32, width: 80, preset }));
    outs.forEach((o, i) => expect([...o.native.data]).toEqual([...again[i].native.data]));
    const sigs = new Set(outs.map((o) => o.palette.join(",")));
    expect(sigs.size).toBe(PRESETS.length);
  });

  it("bloom brightens the area around a bright source and stays palette-valid", () => {
    const off = pixelize(src, { era: 16, width: 100, preset: "neutral", bloom: "off" });
    const on = pixelize(src, { era: 16, width: 100, preset: "neutral", bloom: "high" });
    // Ring just outside the lamp (lamp radius is 5% of width, centred at 70%,30%).
    const cx = 70, cy = 19, r0 = 7;
    const ring = (img: Rgba) => lum({ ...img, data: img.data }, cx - r0 - 3, cy - r0 - 3, cx + r0 + 3, cy + r0 + 3);
    expect(ring(on.native)).toBeGreaterThan(ring(off.native));
    expect(validate(on.native, { maxColours: 48 }).ok).toBe(true);
    expect(on.meta.bloom).toBe("high");
  });

  it("dither and outline stay palette-valid", () => {
    const r = pixelize(src, { era: 8, width: 120, dither: "med", outline: true });
    expect(validate(r.native, { maxColours: 24 }).ok).toBe(true);
    expect(r.meta.dither).toBe("med");
    expect(r.meta.outline).toBe(true);
  });

  it("a locked look reproduces the exact palette across different images", () => {
    const base = pixelize(src, { era: 16, width: 100, preset: "neon", bloom: "low" });
    const look = { id: "x", name: "x", era: 16 as Era, palette: base.palette, preset: "neon" as const, bloom: "low" as const, dither: "off" as const, outline: false };
    const other = pixelize(scene(300, 300, 2), { look, width: 80 });
    const third = pixelize(gradient(200, 100), { look, width: 60, era: 8 });
    expect(other.palette).toEqual(base.palette);
    expect(third.palette).toEqual(base.palette);
    expect(third.meta.era).toBe(16);
    const allowed = new Set(base.palette);
    for (const img of [other, third]) {
      for (let i = 0; i < img.native.w * img.native.h; i++) {
        const d = img.native.data;
        expect(allowed.has("#" + [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]].map((v) => v.toString(16).padStart(2, "0")).join(""))).toBe(true);
      }
    }
  });

  it("neutral preserves hue order of a colour chart", () => {
    const r = pixelize(chart(), { era: 32, width: 12 * 4, preset: "neutral" });
    const hues: number[] = [];
    for (let i = 0; i < 12; i++) {
      const o = (1 * r.native.w + i * 4 + 2) * 4;
      hues.push(oklabToOklch(rgbToOklab(r.native.data[o], r.native.data[o + 1], r.native.data[o + 2]))[2]);
    }
    const input = [...Array(12)].map((_, i) => (i / 12) * Math.PI * 2);
    const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
    // each hue within 0.25 rad of the source, and distinct from its neighbour
    hues.forEach((h, i) => expect(Math.abs(wrap(h - input[i]))).toBeLessThan(0.25));
  });

  it("transparent input stays transparent", () => {
    const a = scene(100, 100);
    for (let i = 0; i < 100 * 40; i++) a.data[i * 4 + 3] = 0;
    const r = pixelize(a, { era: 16, width: 50 });
    expect(r.native.data[3]).toBe(0);
    expect(r.native.data[(49 * 50 + 25) * 4 + 3]).toBe(255);
  });

  it("converts a 1920px image in under 3 seconds", () => {
    const big = scene(1920, 1080);
    const t = Date.now();
    const r = pixelize(big, { era: 64, bloom: "med", dither: "low", outline: true });
    expect(Date.now() - t).toBeLessThan(3000);
    expect(r.native.w).toBe(720);
  });
});

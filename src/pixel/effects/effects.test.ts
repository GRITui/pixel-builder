import { describe, expect, it } from "vitest";
import { decodePng } from "../../io/png";
import { pixelize } from "../pipeline";
import type { Effect, PixelResult, Rgba } from "../types";
import { EFFECTS } from "../types";
import { animate, checkFrames, encodeAnimation, prepare, renderFrame, spritesheet } from "./index";

/** A small "night harbour": dark sky, a lamp, a blue streaky sea, dark ground. Palette-exact. */
function scene(): PixelResult {
  const palette = ["#0b0e1a", "#1c2238", "#2d3b66", "#3f5fa8", "#6a8fd8", "#a8c4f0", "#f0f4ff", "#3a2a1c", "#5c4630", "#ffd36b", "#fff3c4", "#e0e8f8"];
  const rgb = palette.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  const w = 64, h = 48, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let e = y < 12 ? 0 : y < 24 ? 1 : y < 38 ? [2, 3, 4, 3, 2, 5][(y + ((x >> 3) & 1)) % 6] : (x + y) % 5 ? 7 : 8;
    if (x >= 10 && x <= 12 && y >= 6 && y <= 8) e = x === 11 && y === 7 ? 10 : 9; // the lamp
    data.set([...rgb[e], 255], (y * w + x) * 4);
  }
  return { native: { w, h, data }, palette, meta: { era: 16, mode: "scene", width: w, height: h, colours: palette.length, seed: 1, preset: "vivid", bloom: "off", dither: "off", outline: false } };
}

const same = (a: Int16Array, b: Int16Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const diff = (a: Rgba, b: Rgba) => { let n = 0; for (let i = 0; i < a.w * a.h; i++) if (a.data[i * 4] !== b.data[i * 4] || a.data[i * 4 + 1] !== b.data[i * 4 + 1] || a.data[i * 4 + 2] !== b.data[i * 4 + 2]) n++; return n; };

describe("animate", () => {
  for (const fx of EFFECTS) {
    it(`${fx}: loops seamlessly, moves, and stays palette-only`, () => {
      const n = 8;
      const p = prepare(scene(), [fx], { frames: n, seed: 3 });
      for (let t = 0; t < n; t++) expect(same(renderFrame(p, t + n), renderFrame(p, t))).toBe(true);
      expect(same(renderFrame(p, -1), renderFrame(p, n - 1))).toBe(true);
      const a = animate(scene(), [fx], { frames: n, seed: 3 });
      expect(a.frames).toHaveLength(n);
      expect(checkFrames(a.frames, scene().palette)).toEqual([]);
      const changes = a.frames.map((f, k) => diff(f, a.frames[(k + 1) % n]));
      expect(changes.some((c) => c > 0)).toBe(true);
      // The wrap N-1 -> 0 is an ordinary step, not a jump: no larger than the biggest regular step.
      expect(changes[n - 1]).toBeLessThanOrEqual(Math.max(...changes.slice(0, n - 1)) * 1.5 + 4);
    });
  }

  it("finds the scene's regions", () => {
    const a = animate(scene(), ["shimmer", "flicker", "bloom_pulse", "rain"], { frames: 6 });
    expect(a.stats.shimmer_pixels).toBeGreaterThan(100);
    expect(a.stats.flicker_pixels).toBeGreaterThan(0);
    expect(a.stats.flicker_pixels).toBeLessThan(40);
    expect(a.stats.rain_drops).toBeGreaterThan(0);
    // shimmer never touches the dark sky rows
    const still = scene().native;
    for (const f of animate(scene(), ["shimmer"], { frames: 6 }).frames) for (let i = 0; i < 64 * 6; i++) expect(f.data[i * 4]).toBe(still.data[i * 4]);
  });

  it("is deterministic per seed and varies across seeds", () => {
    const fx: Effect[] = ["rain", "snow", "flicker"];
    const a = animate(scene(), fx, { frames: 6, seed: 5 }), b = animate(scene(), fx, { frames: 6, seed: 5 }), c = animate(scene(), fx, { frames: 6, seed: 6 });
    expect(a.frames.map((f) => [...f.data])).toEqual(b.frames.map((f) => [...f.data]));
    expect(a.frames.some((f, k) => diff(f, c.frames[k]) > 0)).toBe(true);
  });

  it("keeps transparency and works on a real pixelize result", () => {
    const r = scene();
    for (let i = 0; i < 64 * 4; i++) r.native.data[i * 4 + 3] = 0;
    const a = animate(r, ["snow", "rain"], { frames: 4, density: 3 });
    for (const f of a.frames) for (let i = 0; i < 64 * 4; i++) expect(f.data[i * 4 + 3]).toBe(0);
    const grad = { w: 40, h: 30, data: new Uint8ClampedArray(40 * 30 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7) % 256)) };
    const px = pixelize(grad, { era: 8, width: 40 });
    const b = animate(px, EFFECTS, { frames: 5 });
    expect(checkFrames(b.frames, px.palette)).toEqual([]);
  });

  it("rejects bad input", () => {
    expect(() => animate(scene(), ["fog" as Effect])).toThrow(/Unknown effect 'fog'/);
    expect(() => animate(scene(), ["rain"], { frames: 1 })).toThrow(/frames/);
  });

  it("honours a user shimmer region", () => {
    const a = animate(scene(), ["shimmer"], { frames: 4, shimmerRegion: { x: 0, y: 0, w: 8, h: 8 } });
    expect(a.stats.shimmer_pixels).toBe(64);
  });
});

describe("animation outputs", () => {
  it("writes a valid looping GIF, a spritesheet and a frames JSON", () => {
    const a = animate(scene(), ["rain", "flicker"], { frames: 6 });
    const files = encodeAnimation(a, { fps: 12, gifScale: 2, sheetName: "x-sheet.png", columns: 4 });
    const g = files.gif;
    expect(g.subarray(0, 6).toString("latin1")).toBe("GIF89a");
    expect(g.readUInt16LE(6)).toBe(128);
    expect(g.readUInt16LE(8)).toBe(96);
    expect(g.includes(Buffer.from("NETSCAPE2.0"))).toBe(true);
    expect(g[g.length - 1]).toBe(0x3b);
    let descriptors = 0;
    for (let i = 0; i + 9 < g.length; i++) if (g[i] === 0x21 && g[i + 1] === 0xf9 && g[i + 2] === 4 && g[i + 7] === 0 && g[i + 8] === 0x2c) descriptors++;
    expect(descriptors).toBe(6);
    const sheet = decodePng(files.sheet);
    expect([sheet.w, sheet.h]).toEqual([64 * 4, 48 * 2]);
    expect(files.json).toMatchObject({ fps: 12, loop: true, columns: 4, rows: 2, width: 64, height: 48, image: "x-sheet.png" });
    expect(files.json.frames[5]).toMatchObject({ index: 5, x: 64, y: 48, w: 64, h: 48, duration_ms: 83 });
    // sheet cell 5 equals frame 5
    const cell = spritesheet(a.frames, 4).image;
    expect([...cell.data.subarray((48 * cell.w + 64) * 4, (48 * cell.w + 64) * 4 + 64 * 4)]).toEqual([...a.frames[5].data.subarray(0, 64 * 4)]);
  });
});

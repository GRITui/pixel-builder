import { describe, expect, it } from "vitest";
import { KIT_PRESETS, resolveRamps } from "./kit";
import { characterGenerator } from "./generators/character";
import { objectGenerator } from "./generators/object";
import { buildingGenerator } from "./generators/building";
import { defaults } from "./generators/types";
import { decodeIndex, flattenPalette, hexToRgb } from "./palette";
import { rng } from "./rng";
import {
  cropToContentImage, detectGrid, downscaleGrid, imageToSprite, makeRampMapper, padToCommon, removeBackgroundFlood, splitSheet, type PixelImage,
} from "./pixelgrid";
import type { Sprite } from "./types";

const kit = KIT_PRESETS[0];
const flat = flattenPalette(resolveRamps(kit));

function spriteImage(s: Sprite): PixelImage {
  const rgba = new Uint8Array(s.w * s.h * 4);
  s.data.forEach((v, i) => {
    if (!v) return;
    const [r, g, b] = hexToRgb(flat[v]!);
    rgba.set([r, g, b, 255], i * 4);
  });
  return { width: s.w, height: s.h, rgba };
}

/** Nearest-neighbour upscale; a left/top pad of (ox, oy) transparent pixels shifts the grid. */
function upscale(img: PixelImage, k: number, ox = 0, oy = 0): PixelImage {
  const w = img.width * k + ox, h = img.height * k + oy;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h - oy; y++)
    for (let x = 0; x < w - ox; x++) {
      const si = (Math.floor(y / k) * img.width + Math.floor(x / k)) * 4;
      rgba.set(img.rgba.subarray(si, si + 4), ((y + oy) * w + x + ox) * 4);
    }
  return { width: w, height: h, rgba };
}

/** Block noise (8x8 blocks, like JPEG) plus per-pixel jitter. */
function noisy(img: PixelImage, amp: number, seed: number): PixelImage {
  const r = rng(seed).next;
  const out = new Uint8Array(img.rgba);
  const blocks = new Map<string, number>();
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const key = `${x >> 3},${y >> 3}`;
      if (!blocks.has(key)) blocks.set(key, (r() - 0.5) * 2 * amp);
      const i = (y * img.width + x) * 4;
      if (out[i + 3] === 0) continue;
      const n = blocks.get(key)! + (r() - 0.5) * amp;
      for (let c = 0; c < 3; c++) out[i + c] = Math.max(0, Math.min(255, Math.round(out[i + c] + n)));
    }
  return { width: img.width, height: img.height, rgba: out };
}

// a pixel is wrong when transparency differs or the colour is more than 30 RGB units off
function errorRate(a: PixelImage, b: PixelImage): number {
  const A = cropToContentImage(a), B = cropToContentImage(b);
  if (A.width !== B.width || A.height !== B.height) return 1;
  let bad = 0;
  for (let i = 0; i < A.width * A.height; i++) {
    const ta = A.rgba[i * 4 + 3] < 128, tb = B.rgba[i * 4 + 3] < 128;
    if (ta !== tb) bad++;
    else if (!ta && Math.hypot(A.rgba[i * 4] - B.rgba[i * 4], A.rgba[i * 4 + 1] - B.rgba[i * 4 + 1], A.rgba[i * 4 + 2] - B.rgba[i * 4 + 2]) > 30) bad++;
  }
  return bad / (A.width * A.height);
}

const sprites: Sprite[] = [
  characterGenerator.generate(defaults(characterGenerator) as never, kit, 3).rows[0].frames[0],
  objectGenerator.generate({ ...defaults(objectGenerator), kind: "chest" } as never, kit, 1).rows[0].frames[0],
  buildingGenerator.generate(defaults(buildingGenerator) as never, kit, 2).rows[0].frames[0],
];

describe("detectGrid + downscaleGrid", () => {
  it("is exact on clean upscales", () => {
    for (const s of sprites)
      for (const k of [2, 3, 4, 5]) {
        const src = spriteImage(s);
        const g = detectGrid(upscale(src, k));
        expect(g.scale).toBe(k);
        expect(errorRate(downscaleGrid(upscale(src, k), g), src)).toBe(0);
      }
  });

  it("recovers the original from noisy offset upscales within 2% error", () => {
    let worst = 0;
    for (const s of sprites)
      for (const [k, ox, oy] of [[2, 0, 0], [3, 1, 0], [4, 1, 3], [4, 0, 1], [5, 2, 2]] as const)
        for (const amp of [0, 6, 12]) {
          const src = spriteImage(s);
          const big = noisy(upscale(src, k, ox, oy), amp, 7 + k);
          const g = detectGrid(big);
          expect(g.scale, `k${k} amp${amp}`).toBe(k);
          expect(g.offsetX).toBe(ox % k);
          expect(g.offsetY).toBe(oy % k);
          expect(g.confidence).toBeGreaterThan(0.5);
          const e = errorRate(downscaleGrid(big, g), src);
          worst = Math.max(worst, e); 
          expect(e, `k${k} o${ox},${oy} amp${amp} sprite${sprites.indexOf(s)}`).toBeLessThanOrEqual(0.02);
        }
    console.log("worst pixel error", worst);
  });

  it("reports no grid for a non-upscaled image", () => {
    const r = rng(5).next;
    const rgba = new Uint8Array(40 * 40 * 4);
    for (let i = 0; i < 1600; i++) rgba.set([r() * 255, r() * 255, r() * 255, 255], i * 4);
    expect(detectGrid({ width: 40, height: 40, rgba }).scale).toBe(1);
    expect(detectGrid(spriteImage(sprites[0])).scale).toBe(1);
  });
});

describe("cleanup", () => {
  it("removes a noisy flat background, keyed or from the border", () => {
    const src = spriteImage(sprites[1]);
    const w = src.width + 4, h = src.height + 4;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set([60, 90, 200, 255], i * 4);
    for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) rgba.set(src.rgba.subarray((y * src.width + x) * 4, (y * src.width + x) * 4 + 4), ((y + 2) * w + x + 2) * 4);
    const noisyBg = noisy({ width: w, height: h, rgba }, 8, 2);
    for (const opts of [{}, { key: [60, 90, 200] as [number, number, number] }]) {
      const out = removeBackgroundFlood(noisyBg, { tolerance: 30, ...opts });
      expect(out.rgba[3]).toBe(0);
      expect(cropToContentImage(out).width).toBeLessThanOrEqual(src.width + 1);
    }
  });
});

describe("splitSheet", () => {
  const frames = [sprites[0], sprites[1], sprites[0], sprites[1]];
  const sheet = (cell: number, gapPx: number): PixelImage => {
    const w = cell * 2 + gapPx, h = cell * 2 + gapPx;
    const rgba = new Uint8Array(w * h * 4);
    frames.forEach((f, i) => {
      const img = spriteImage(f);
      const ox = (i % 2) * (cell + gapPx), oy = Math.floor(i / 2) * (cell + gapPx);
      for (let y = 0; y < Math.min(cell, img.height); y++)
        for (let x = 0; x < Math.min(cell, img.width); x++) rgba.set(img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4), ((oy + y) * w + ox + x) * 4);
    });
    return { width: w, height: h, rgba };
  };

  it("splits a lattice sheet into equal cells, deterministically", () => {
    const a = splitSheet(sheet(sprites[0].w, 3)), b = splitSheet(sheet(sprites[0].w, 3));
    expect(a.frames.length).toBe(4);
    expect(a.layout).toBe("grid");
    expect(new Set(a.frames.map((f) => `${f.width}x${f.height}`)).size).toBe(1);
    expect(a.frames.map((f) => [f.x, f.y])).toEqual(b.frames.map((f) => [f.x, f.y]));
    expect(a.frames[0].image.rgba).toEqual(b.frames[0].image.rgba);
  });

  it("falls back to islands and reading order, and honours explicit cells", () => {
    const img: PixelImage = { width: 30, height: 10, rgba: new Uint8Array(30 * 10 * 4) };
    const dot = (x: number, y: number, w: number, h: number) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) img.rgba.set([200, 0, 0, 255], ((y + j) * 30 + x + i) * 4); };
    dot(20, 1, 3, 4); dot(2, 2, 4, 6); dot(11, 3, 2, 2);
    const r = splitSheet(img);
    expect(r.layout).toBe("islands");
    expect(r.frames.map((f) => f.x)).toEqual([2, 11, 20]);
    expect(padToCommon(r.frames.map((f) => f.image)).every((i) => i.width === 4 && i.height === 6)).toBe(true);
    expect(splitSheet(img, { cellW: 10, cellH: 10 }).frames.length).toBe(3);
  });
});

describe("palette mapping", () => {
  it("ramps mode keeps shading: one hue -> one ramp, lighter stays lighter", () => {
    const img: PixelImage = { width: 4, height: 2, rgba: new Uint8Array(32) };
    const reds = [[90, 20, 20], [140, 30, 30], [200, 50, 50], [240, 110, 100]];
    const greens = [[20, 70, 30], [40, 120, 50], [70, 170, 70], [140, 220, 120]];
    reds.forEach((c, i) => img.rgba.set([...c, 255], i * 4));
    greens.forEach((c, i) => img.rgba.set([...c, 255], (4 + i) * 4));
    const q = makeRampMapper([img], resolveRamps(kit));
    const sp = imageToSprite(img, q);
    const dec = [...sp.data].map((v) => decodeIndex(v)!);
    expect(new Set(dec.slice(0, 4).map((d) => d.mat)).size).toBe(1);
    expect(new Set(dec.slice(4).map((d) => d.mat)).size).toBe(1);
    expect(dec[0].mat).not.toBe(dec[4].mat);
    for (const o of [0, 4]) for (let i = 1; i < 4; i++) expect(dec[o + i].level).toBeGreaterThanOrEqual(dec[o + i - 1].level);
    expect(dec[3].level).toBeGreaterThan(dec[0].level);
  });
});

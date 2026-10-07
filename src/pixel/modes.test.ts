import { describe, expect, it } from "vitest";
import { noiseTexture, shadedSubject } from "./modes.fixtures";
import { keyBackground, pixelizeSprite } from "./sprite";
import { pixelizeTile, wrapError } from "./tile";
import { validate } from "./validate";

const alphaAt = (r: { native: { w: number; data: Uint8ClampedArray } }, x: number, y: number) => r.native.data[(y * r.native.w + x) * 4 + 3];

describe("sprite mode", () => {
  for (const [name, bg] of [["green", [0, 200, 0]], ["white", [255, 255, 255]], ["black", [0, 0, 0]], ["gradient", "gradient"]] as const) {
    it(`keys a ${name} background, exact size, hard alpha, clear margin`, () => {
      for (const size of [16, 32, 48]) {
        const r = pixelizeSprite(shadedSubject(bg as never), { width: size });
        expect([r.native.w, r.native.h]).toEqual([size, size]);
        expect(validate(r.native).ok).toBe(true);
        for (let i = 0; i < size; i++) for (const [x, y] of [[i, 0], [i, size - 1], [0, i], [size - 1, i]]) expect(alphaAt(r, x, y)).toBe(0);
        // centre is subject, corners are keyed out
        expect(alphaAt(r, size >> 1, (size >> 1) + 2)).toBe(255);
      }
    });
  }
  it("key removes the background and keeps the body", () => {
    const k = keyBackground(shadedSubject("gradient"));
    expect(k.mask[0]).toBe(0);
    expect(k.mask[140 * 200 + 100]).toBe(1);
  });
  it("accepts a bg hex and w x h sizes, and adds an outline", () => {
    const r = pixelizeSprite(shadedSubject([0, 200, 0]), { width: 32, height: 24, outline: true }, { bg: "#00c800" });
    expect([r.native.w, r.native.h]).toEqual([32, 24]);
    expect(validate(r.native).ok).toBe(true);
    const plain = pixelizeSprite(shadedSubject([0, 200, 0]), { width: 32, height: 24 });
    const count = (x: typeof r) => x.native.data.reduce((s, v, i) => s + (i % 4 === 3 && v ? 1 : 0), 0);
    expect(count(r)).toBeGreaterThan(count(plain) * 0.9);
  });
  it("is deterministic per seed", () => {
    const a = pixelizeSprite(shadedSubject("gradient"), { width: 32, seed: 4 });
    const b = pixelizeSprite(shadedSubject("gradient"), { width: 32, seed: 4 });
    expect([...a.native.data]).toEqual([...b.native.data]);
  });
});

describe("tile mode", () => {
  it("makes a seamed texture wrap and is square at tile size", () => {
    const src = noiseTexture(128);
    expect(wrapError(src)).toBeGreaterThan(4);
    for (const size of [16, 32]) {
      const r = pixelizeTile(src, { width: size });
      expect([r.native.w, r.native.h]).toEqual([size, size]);
      expect(r.sheet.w).toBe(size * 3);
      expect(validate(r.native).ok).toBe(true);
      expect(r.wrapAfter).toBeLessThan(1.6);
      for (let i = 0; i < size * size; i++) expect(r.native.data[i * 4 + 3]).toBe(255);
    }
  });
  it("is deterministic", () => {
    const a = pixelizeTile(noiseTexture(96), { width: 16, seed: 2 });
    const b = pixelizeTile(noiseTexture(96), { width: 16, seed: 2 });
    expect([...a.native.data]).toEqual([...b.native.data]);
  });
});

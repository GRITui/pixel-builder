import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodePng } from "../../src/io/png";
import { validate } from "../../src/pixel/validate";

const dir = join(__dirname, "assets");
const load = (n: string) => decodePng(readFileSync(join(dir, `${n}.png`)));
const px = (n: string, x: number, y: number) => [...load(n).data.subarray((y * 16 + x) * 4, (y * 16 + x) * 4 + 4)].join();

describe("snake assets", () => {
  for (const n of ["head", "body", "corner", "tail", "apple", "gold", "grass-a", "grass-b", "wall"]) {
    it(`${n} is 16x16 true pixel art`, () => {
      const im = load(n);
      expect([im.w, im.h]).toEqual([16, 16]);
      expect(validate(im, { maxColours: 48 }).ok).toBe(true);
    });
  }
  it("title is 320x240", () => {
    const im = load("title");
    expect([im.w, im.h]).toEqual([320, 240]);
    expect(validate(im, { maxColours: 48 }).ok).toBe(true);
  });
  it("snake parts join the body edges", () => {
    for (let r = 3; r < 13; r++) {
      expect(px("head", 0, r)).toBe(px("body", 0, r));
      expect(px("corner", 0, r)).toBe(px("body", 0, r));
      expect(px("tail", 15, r)).toBe(px("body", 15, r));
    }
  });
  it("grass a/b share their border", () => {
    for (let i = 0; i < 16; i++) for (const [x, y] of [[i, 0], [i, 15], [0, i], [15, i]]) expect(px("grass-a", x, y)).toBe(px("grass-b", x, y));
  });
});

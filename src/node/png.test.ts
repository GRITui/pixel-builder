import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { DEFAULT_KIT } from "../core/kit";
import { colorIndex } from "../core/palette";
import { createSprite } from "../core/sprite";
import { blankImage, contactSheet, decodePng, encodePng, previewScale, scaleImage, sheetImage, spriteImage } from "./png";

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, crc]);
}
/** Hand-build a PNG from already-filtered scanlines. */
function rawPng(w: number, h: number, depth: number, ctype: number, scanlines: number[][], extra: Buffer[] = [], interlace = 0): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = depth;
  ihdr[9] = ctype;
  ihdr[12] = interlace;
  const raw = Buffer.from(scanlines.flat());
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), ...extra, chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

describe("png encode/decode", () => {
  it("round-trips RGBA exactly", () => {
    const img = blankImage(5, 3);
    img.rgba.forEach((_, i) => (img.rgba[i] = (i * 37) & 255));
    const back = decodePng(encodePng(img));
    expect(back.width).toBe(5);
    expect(back.height).toBe(3);
    expect(Array.from(back.rgba)).toEqual(Array.from(img.rgba));
  });

  it("decodes grayscale, RGB, gray+alpha and indexed (with tRNS)", () => {
    expect(Array.from(decodePng(rawPng(2, 1, 8, 0, [[0, 10, 200]])).rgba)).toEqual([10, 10, 10, 255, 200, 200, 200, 255]);
    expect(Array.from(decodePng(rawPng(1, 2, 8, 2, [[0, 1, 2, 3], [0, 4, 5, 6]])).rgba)).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
    expect(Array.from(decodePng(rawPng(1, 1, 8, 4, [[0, 50, 128]])).rgba)).toEqual([50, 50, 50, 128]);
    const plte = chunk("PLTE", Buffer.from([255, 0, 0, 0, 255, 0]));
    const trns = chunk("tRNS", Buffer.from([255, 0]));
    expect(Array.from(decodePng(rawPng(2, 1, 8, 3, [[0, 0, 1]], [plte, trns])).rgba)).toEqual([255, 0, 0, 255, 0, 255, 0, 0]);
  });

  it("applies all five scanline filters", () => {
    // 2x2 RGB image: row0 = (10,20,30),(40,50,60); row1 = (50,70,90),(100,120,140)
    const rows = [
      [1, 10, 20, 30, 30, 30, 30], // Sub
      [2, 40, 50, 60, 60, 70, 80], // Up (adds row above)
    ];
    expect(Array.from(decodePng(rawPng(2, 2, 8, 2, rows)).rgba)).toEqual([10, 20, 30, 255, 40, 50, 60, 255, 50, 70, 90, 255, 100, 120, 140, 255]);
    // Average and Paeth on a 2x2 gray image: (10,20 / 30,40)
    const avg = decodePng(rawPng(2, 2, 8, 0, [[0, 10, 20], [3, 25, 5]])).rgba; // 30 = 25 + floor(10/2); 40 = 5 + floor((30+20)/2)
    expect([avg[0], avg[4], avg[8], avg[12]]).toEqual([10, 20, 30, 40]);
    const paeth = decodePng(rawPng(2, 2, 8, 0, [[0, 10, 20], [4, 20, 10]])).rgba; // 30 = 20 + paeth(0,10,0)=10 ; 40 = 10 + paeth(30,20,10)=30
    expect([paeth[0], paeth[4], paeth[8], paeth[12]]).toEqual([10, 20, 30, 40]);
  });

  it("reads 16-bit RGBA by taking the high byte", () => {
    const out = decodePng(rawPng(1, 1, 16, 6, [[0, 200, 1, 100, 2, 50, 3, 255, 255]])).rgba;
    expect(Array.from(out)).toEqual([200, 100, 50, 255]);
  });

  it("rejects unsupported / broken files with clear errors", () => {
    expect(() => decodePng(Buffer.from("not a png at all"))).toThrow(/Not a PNG/);
    expect(() => decodePng(rawPng(8, 1, 1, 0, [[0, 0xaa]]))).toThrow(/bit depth 1/);
    expect(() => decodePng(rawPng(1, 1, 8, 6, [[0, 1, 2, 3, 4]], [], 1))).toThrow(/Interlaced/);
    const good = encodePng(blankImage(2, 2));
    const bad = Buffer.from(good);
    bad[good.length - 20] ^= 0xff; // flip a byte inside IDAT
    expect(() => decodePng(bad)).toThrow(/CRC|corrupt|inflate|incorrect|invalid/i);
    expect(() => decodePng(good.subarray(0, good.length - 30))).toThrow(/truncated/);
  });
});

describe("sprite rendering helpers", () => {
  const red = colorIndex("roof", 3);
  const sprite = createSprite(4, 4);
  sprite.data[0] = red;
  sprite.data[15] = red;

  it("renders sprites with transparency and integer scale", () => {
    const img = spriteImage(sprite, DEFAULT_KIT, 3);
    expect(img.width).toBe(12);
    expect(img.rgba[3]).toBe(255); // pixel (0,0) is painted
    expect(img.rgba[(5 * 12 + 5) * 4 + 3]).toBe(0); // inside an empty cell
    expect(img.rgba[(11 * 12 + 11) * 4 + 3]).toBe(255);
    const big = scaleImage(img, 2);
    expect(big.width).toBe(24);
    expect(big.rgba[3]).toBe(255);
  });

  it("lays animation rows out as a sheet", () => {
    const sheet = sheetImage([[sprite, sprite, sprite], [sprite]], DEFAULT_KIT, 2);
    expect(sheet.columns).toBe(3);
    expect(sheet.rows).toBe(2);
    expect(sheet.image.width).toBe(3 * 4 * 2);
    expect(sheet.image.height).toBe(2 * 4 * 2);
  });

  it("builds a contact sheet and a >=256px preview scale", () => {
    const sheet = contactSheet([sprite, sprite, sprite, sprite, sprite], DEFAULT_KIT, { columns: 3 });
    expect(sheet.width).toBeGreaterThan(256);
    expect(decodePng(encodePng(sheet)).width).toBe(sheet.width);
    expect(previewScale(16, 16)).toBe(16);
    expect(previewScale(512, 512)).toBe(1);
    expect(previewScale(2, 2) * 2).toBeLessThanOrEqual(1024);
  });
});

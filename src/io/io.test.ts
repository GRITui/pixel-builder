import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { decodeImage } from "./decode";
import { encodeGif } from "./gif";
import { decodePng, encodePng } from "./png";
import { resizeBox, resizeLanczos, upscale } from "./resize";
import { hexToRgb, oklabToRgb, rgbToHex, rgbToOklab } from "../color/oklab";
import { CGA, GAMEBOY, NES, PICO8 } from "../color/palettes";
import { pack555, unpack555 } from "../color/rgb555";
import { gradient } from "../pixel/fixtures";
import type { Rgba } from "../pixel/types";

describe("color", () => {
  it("round-trips sRGB through OKLab", () => {
    for (const c of [[0, 0, 0], [255, 255, 255], [200, 30, 90], [12, 240, 100]]) {
      const back = oklabToRgb(...rgbToOklab(c[0], c[1], c[2]));
      back.forEach((v, i) => expect(Math.abs(v - c[i])).toBeLessThan(0.5));
    }
    expect(hexToRgb(rgbToHex(1, 2, 3))).toEqual([1, 2, 3]);
  });
  it("palette sizes (NES list is the prototype's 55 entries; unique)", () => {
    expect(new Set(NES).size).toBe(NES.length);
    expect([NES.length, GAMEBOY.length, CGA.length, PICO8.length]).toEqual([55, 4, 4, 16]);
  });
  it("rgb555 pack/unpack is stable", () => {
    const [r, g, b] = unpack555(pack555(200, 100, 50));
    expect(unpack555(pack555(r, g, b))).toEqual([r, g, b]);
  });
});

describe("codecs", () => {
  const img = gradient(24, 16);
  it("PNG RGBA round-trip", () => {
    const back = decodePng(encodePng(img));
    expect(back.w).toBe(24);
    expect([...back.data]).toEqual([...img.data]);
  });
  it("PNG indexed round-trip with transparency", () => {
    const small: Rgba = { w: 2, h: 1, data: new Uint8ClampedArray([10, 20, 30, 255, 0, 0, 0, 0]) };
    const png = encodePng(small);
    expect(png[25]).toBe(3); // colour type 3 = indexed
    expect([...decodePng(png).data]).toEqual([...small.data]);
  });
  it("decodes PNG, JPEG, WebP and GIF", async () => {
    const raw = { raw: { width: 24, height: 16, channels: 4 as const } };
    const base = sharp(Buffer.from(img.data), raw);
    for (const buf of [await base.clone().png().toBuffer(), await base.clone().jpeg({ quality: 95 }).toBuffer(), await base.clone().webp({ lossless: true }).toBuffer(), await base.clone().gif().toBuffer()]) {
      const d = await decodeImage(buf);
      expect([d.w, d.h]).toEqual([24, 16]);
    }
    const webp = await decodeImage(await base.clone().webp({ lossless: true }).toBuffer());
    expect(Math.abs(webp.data[4] - img.data[4])).toBeLessThan(2);
  });
  it("rejects non-images", async () => {
    await expect(decodeImage(Buffer.from("hello world, not an image"))).rejects.toThrow(/Unsupported image/);
  });
  it("encodes an animated GIF", () => {
    const a: Rgba = { w: 2, h: 2, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0]) };
    const b: Rgba = { w: 2, h: 2, data: new Uint8ClampedArray([0, 255, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255]) };
    const gif = encodeGif([a, b], { fps: 10, scale: 4 });
    expect(gif.subarray(0, 6).toString()).toBe("GIF89a");
    expect(gif.readUInt16LE(6)).toBe(8);
    expect(gif[gif.length - 1]).toBe(0x3b);
    expect(gif.includes(Buffer.from("NETSCAPE2.0"))).toBe(true);
  });
});

describe("resize", () => {
  it("upscale is nearest, box averages, lanczos keeps size", () => {
    const up = upscale({ w: 1, h: 1, data: new Uint8ClampedArray([9, 8, 7, 255]) }, 3);
    expect([up.w, up.h, up.data[4 * 4]]).toEqual([3, 3, 9]);
    const two: Rgba = { w: 2, h: 1, data: new Uint8ClampedArray([0, 0, 0, 255, 100, 100, 100, 255]) };
    expect(resizeBox(two, 1, 1).data[0]).toBe(50);
    expect(resizeLanczos(gradient(20, 10), 10, 5).w).toBe(10);
  });
});

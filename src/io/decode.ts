// Decode PNG / JPEG / WebP / GIF (first frame) to Rgba. PNG uses our own codec; the rest use sharp
// (prebuilt libvips from the npm registry as @img/sharp-*; also applies EXIF rotation).
import { readFileSync } from "node:fs";
import { decodePng } from "./png";
import type { Rgba } from "../pixel/types";

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_SIDE = 16384;

export type ImageFormat = "png" | "jpeg" | "webp" | "gif";

export function sniffFormat(b: Uint8Array): ImageFormat | undefined {
  if (b.length > 8 && b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71) return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length > 12 && Buffer.from(b.subarray(0, 4)).toString("latin1") === "RIFF" && Buffer.from(b.subarray(8, 12)).toString("latin1") === "WEBP") return "webp";
  if (b.length > 6 && Buffer.from(b.subarray(0, 3)).toString("latin1") === "GIF") return "gif";
  return undefined;
}

export async function decodeImage(buf: Uint8Array): Promise<Rgba> {
  if (buf.length > MAX_IMAGE_BYTES) throw new Error(`Image is ${(buf.length / 1048576).toFixed(1)} MB; the limit is ${MAX_IMAGE_BYTES / 1048576} MB`);
  const fmt = sniffFormat(buf);
  if (!fmt) throw new Error("Unsupported image: expected PNG, JPEG, WebP or GIF");
  if (fmt === "png") return decodePng(buf);
  const { default: sharp } = await import("sharp");
  const { data, info } = await sharp(buf, { pages: 1, limitInputPixels: MAX_IMAGE_SIDE * MAX_IMAGE_SIDE })
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

export async function readImageFile(path: string): Promise<Rgba> {
  return decodeImage(readFileSync(path));
}

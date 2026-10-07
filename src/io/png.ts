// PNG encode/decode on node:zlib only. Encode writes indexed PNG when the image has <=256 colours
// (exact, small), else RGBA. Decode handles 8/16-bit, non-interlaced, colour types 0/2/3/4/6.
import { deflateSync, inflateSync } from "node:zlib";
import type { Rgba } from "../pixel/types";

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  out.set(data, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function encodePng(img: Rgba): Buffer {
  const { w, h, data } = img;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) throw new Error(`Invalid PNG size ${w}x${h}`);
  if (data.length !== w * h * 4) throw new Error(`RGBA buffer is ${data.length} bytes, expected ${w * h * 4}`);
  // try indexed
  const map = new Map<number, number>();
  const idx = new Uint8Array(w * h);
  let indexed = true;
  const pal: number[] = [];
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3];
    const key = a === 0 ? 0 : ((data[i * 4] << 24) | (data[i * 4 + 1] << 16) | (data[i * 4 + 2] << 8) | a) >>> 0 || 1;
    let p = map.get(key);
    if (p === undefined) {
      if (map.size >= 256) { indexed = false; break; }
      p = map.size;
      map.set(key, p);
      pal.push(a === 0 ? 0 : data[i * 4], a === 0 ? 0 : data[i * 4 + 1], a === 0 ? 0 : data[i * 4 + 2], a);
    }
    idx[i] = p;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  const bpp = indexed ? 1 : 4;
  ihdr[9] = indexed ? 3 : 6;
  const raw = Buffer.alloc((w * bpp + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * bpp + 1);
    if (indexed) raw.set(idx.subarray(y * w, (y + 1) * w), row + 1);
    else raw.set(data.subarray(y * w * 4, (y + 1) * w * 4), row + 1);
  }
  const parts = [SIG, chunk("IHDR", ihdr)];
  if (indexed) {
    const n = pal.length / 4;
    parts.push(chunk("PLTE", Uint8Array.from({ length: n * 3 }, (_, i) => pal[Math.floor(i / 3) * 4 + (i % 3)])));
    if (pal.some((_, i) => i % 4 === 3 && pal[i] !== 255)) parts.push(chunk("tRNS", Uint8Array.from({ length: n }, (_, i) => pal[i * 4 + 3])));
  }
  parts.push(chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const paeth = (a: number, b: number, c: number) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

export function decodePng(buf: Uint8Array): Rgba {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.length);
  if (b.length < 8 || !b.subarray(0, 8).equals(SIG)) throw new Error("Not a PNG file (bad signature)");
  let pos = 8, w = 0, h = 0, depth = 0, ctype = -1, interlace = 0;
  let plte: Buffer | null = null, trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (pos + 8 <= b.length) {
    const len = b.readUInt32BE(pos), type = b.toString("ascii", pos + 4, pos + 8), s = pos + 8;
    if (s + len + 4 > b.length) throw new Error(`PNG is truncated inside a ${type} chunk`);
    const d = b.subarray(s, s + len);
    if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ctype = d[9]; interlace = d[12]; }
    else if (type === "PLTE") plte = d;
    else if (type === "tRNS") trns = d;
    else if (type === "IDAT") idat.push(d);
    else if (type === "IEND") break;
    pos = s + len + 4;
  }
  if (!w || !h) throw new Error("PNG has no IHDR chunk");
  if (w > 16384 || h > 16384) throw new Error(`PNG is too large (${w}x${h})`);
  if (!(ctype in CHANNELS)) throw new Error(`Unsupported PNG colour type ${ctype}`);
  if (depth !== 8 && depth !== 16) throw new Error(`Unsupported PNG bit depth ${depth}; re-save as 8-bit`);
  if (interlace) throw new Error("Interlaced PNGs are not supported; re-save without interlacing");
  if (ctype === 3 && !plte) throw new Error("Indexed PNG has no PLTE chunk");
  if (!idat.length) throw new Error("PNG has no image data");
  const bytes = depth / 8, bpp = CHANNELS[ctype] * bytes, stride = w * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < (stride + 1) * h) throw new Error("PNG image data is shorter than its header says");
  const px = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? px[dst + i - bpp] : 0, up = y > 0 ? px[dst - stride + i] : 0, c = y > 0 && i >= bpp ? px[dst - stride + i - bpp] : 0;
      px[dst + i] = (ft === 0 ? x : ft === 1 ? x + a : ft === 2 ? x + up : ft === 3 ? x + ((a + up) >> 1) : ft === 4 ? x + paeth(a, up, c) : NaN) & 255;
      if (ft > 4) throw new Error(`PNG uses unknown filter type ${ft}`);
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  const smp = (i: number, c: number) => px[i * bpp + c * bytes];
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (ctype === 0) { out[o] = out[o + 1] = out[o + 2] = smp(i, 0); out[o + 3] = 255; }
    else if (ctype === 2) { out[o] = smp(i, 0); out[o + 1] = smp(i, 1); out[o + 2] = smp(i, 2); out[o + 3] = 255; }
    else if (ctype === 3) {
      const p = px[i];
      if (p * 3 + 2 >= plte!.length) throw new Error("Indexed PNG refers to a missing palette entry");
      out[o] = plte![p * 3]; out[o + 1] = plte![p * 3 + 1]; out[o + 2] = plte![p * 3 + 2];
      out[o + 3] = trns && p < trns.length ? trns[p] : 255;
    } else if (ctype === 4) { out[o] = out[o + 1] = out[o + 2] = smp(i, 0); out[o + 3] = smp(i, 1); }
    else { out[o] = smp(i, 0); out[o + 1] = smp(i, 1); out[o + 2] = smp(i, 2); out[o + 3] = smp(i, 3); }
  }
  return { w, h, data: out };
}

// Minimal PNG encoder/decoder on node:zlib only, plus sprite -> RGBA helpers
// (scaling, spritesheets, contact sheets). No dependencies.
import { deflateSync, inflateSync } from "node:zlib";
import { flattenRamps, hexToRgb, type RGB } from "../core/palette";
import { resolveRamps } from "../core/kit";
import type { Sprite, StyleKit } from "../core/types";

export interface RgbaImage {
  width: number;
  height: number;
  /** width * height * 4 bytes, straight (non-premultiplied) alpha. */
  rgba: Uint8Array;
}

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// ---------- crc ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  Buffer.from(data.buffer, data.byteOffset, data.length).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

// ---------- encode ----------

/** Encode 8-bit RGBA (colour type 6, non-interlaced). */
export function encodePng(img: RgbaImage): Buffer {
  const { width, height, rgba } = img;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new Error(`Invalid PNG size ${width}x${height}`);
  if (rgba.length !== width * height * 4) throw new Error(`RGBA buffer is ${rgba.length} bytes, expected ${width * height * 4}`);
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height); // filter byte 0 (None) per row
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// ---------- decode ----------

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Decode a PNG into RGBA. Supports 8/16-bit non-interlaced images of colour
 * types 0 (gray), 2 (RGB), 3 (indexed, with tRNS), 4 (gray+alpha) and 6 (RGBA).
 * Anything else throws an error that says how to convert the file.
 */
export function decodePng(buf: Uint8Array): RgbaImage {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.length);
  if (b.length < 8 || !b.subarray(0, 8).equals(SIGNATURE)) throw new Error("Not a PNG file (bad signature)");
  let pos = 8;
  let width = 0, height = 0, depth = 0, ctype = -1, interlace = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  let sawEnd = false;
  while (pos + 8 <= b.length && !sawEnd) {
    const len = b.readUInt32BE(pos);
    const type = b.toString("ascii", pos + 4, pos + 8);
    const start = pos + 8;
    if (start + len + 4 > b.length) throw new Error(`PNG is truncated inside a ${type} chunk`);
    const data = b.subarray(start, start + len);
    if (b.readUInt32BE(start + len) !== crc32(b.subarray(pos + 4, start + len))) throw new Error(`PNG is corrupt (CRC mismatch in ${type} chunk)`);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      ctype = data[9];
      interlace = data[12];
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") sawEnd = true;
    pos = start + len + 4;
  }
  if (!width || !height) throw new Error("PNG has no IHDR chunk");
  if (width > 16384 || height > 16384) throw new Error(`PNG is too large (${width}x${height}; max 16384 per side)`);
  if (!(ctype in CHANNELS)) throw new Error(`Unsupported PNG colour type ${ctype}`);
  if (depth !== 8 && depth !== 16) throw new Error(`Unsupported PNG bit depth ${depth}; re-save the image as 8-bit RGBA (e.g. \`magick in.png -depth 8 PNG32:out.png\`)`);
  if (ctype === 3 && depth !== 8) throw new Error("Unsupported indexed PNG bit depth; re-save the image as 8-bit RGBA");
  if (interlace !== 0) throw new Error("Interlaced PNGs are not supported; re-save the image without interlacing (e.g. `magick in.png -interlace none PNG32:out.png`)");
  if (ctype === 3 && !palette) throw new Error("Indexed PNG has no PLTE chunk");
  if (!idat.length) throw new Error("PNG has no image data");

  const bytes = depth / 8;
  const ch = CHANNELS[ctype];
  const bpp = ch * bytes; // bytes per pixel
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  if (raw.length < (stride + 1) * height) throw new Error("PNG image data is shorter than its header says");

  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? px[dst + i - bpp] : 0;
      const up = y > 0 ? px[dst - stride + i] : 0;
      const c = y > 0 && i >= bpp ? px[dst - stride + i - bpp] : 0;
      let v: number;
      switch (ft) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + up; break;
        case 3: v = x + ((a + up) >> 1); break;
        case 4: v = x + paeth(a, up, c); break;
        default: throw new Error(`PNG uses unknown filter type ${ft}`);
      }
      px[dst + i] = v & 255;
    }
  }

  const out = new Uint8Array(width * height * 4);
  // sample(i, c): 8-bit value of channel c of pixel i (high byte for 16-bit)
  const sample = (i: number, c: number) => px[i * bpp + c * bytes];
  const trnsGray = trns && ctype === 0 && trns.length >= 2 ? trns.readUInt16BE(0) : -1;
  const trnsRgb = trns && ctype === 2 && trns.length >= 6 ? [trns.readUInt16BE(0), trns.readUInt16BE(2), trns.readUInt16BE(4)] : null;
  const full = (i: number, c: number) => (bytes === 2 ? px.readUInt16BE(i * bpp + c * 2) : px[i * bpp + c]);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (ctype === 0) {
      const g = sample(i, 0);
      out[o] = out[o + 1] = out[o + 2] = g;
      out[o + 3] = trnsGray >= 0 && full(i, 0) === trnsGray ? 0 : 255;
    } else if (ctype === 2) {
      out[o] = sample(i, 0); out[o + 1] = sample(i, 1); out[o + 2] = sample(i, 2);
      out[o + 3] = trnsRgb && full(i, 0) === trnsRgb[0] && full(i, 1) === trnsRgb[1] && full(i, 2) === trnsRgb[2] ? 0 : 255;
    } else if (ctype === 3) {
      const p = px[i];
      if (p * 3 + 2 >= palette!.length) throw new Error("Indexed PNG refers to a palette entry that does not exist");
      out[o] = palette![p * 3]; out[o + 1] = palette![p * 3 + 1]; out[o + 2] = palette![p * 3 + 2];
      out[o + 3] = trns && p < trns.length ? trns[p] : 255;
    } else if (ctype === 4) {
      const g = sample(i, 0);
      out[o] = out[o + 1] = out[o + 2] = g;
      out[o + 3] = sample(i, 1);
    } else {
      out[o] = sample(i, 0); out[o + 1] = sample(i, 1); out[o + 2] = sample(i, 2); out[o + 3] = sample(i, 3);
    }
  }
  return { width, height, rgba: out };
}

// ---------- sprites -> pixels ----------

/** Palette index -> [r,g,b] for a kit (index 0 and unknown indices are null = transparent). */
export function kitColors(kit: StyleKit): (RGB | null)[] {
  return flattenRamps(resolveRamps(kit)).map((hex) => (hex ? hexToRgb(hex) : null));
}

export function blankImage(width: number, height: number, fill?: [number, number, number, number]): RgbaImage {
  const rgba = new Uint8Array(width * height * 4);
  if (fill) for (let i = 0; i < width * height; i++) rgba.set(fill, i * 4);
  return { width, height, rgba };
}

/** Draw a sprite onto `img` at (ox, oy), each pixel `scale` x `scale`. Transparent pixels leave the background alone. */
export function drawSprite(img: RgbaImage, sprite: Sprite, colors: (RGB | null)[], ox: number, oy: number, scale = 1): void {
  for (let y = 0; y < sprite.h; y++)
    for (let x = 0; x < sprite.w; x++) {
      const c = colors[sprite.data[y * sprite.w + x]];
      if (!c) continue;
      for (let j = 0; j < scale; j++) {
        const py = oy + y * scale + j;
        if (py < 0 || py >= img.height) continue;
        for (let i = 0; i < scale; i++) {
          const px = ox + x * scale + i;
          if (px < 0 || px >= img.width) continue;
          img.rgba.set([c[0], c[1], c[2], 255], (py * img.width + px) * 4);
        }
      }
    }
}

/** Render one sprite to an image (transparent background unless `background` is given). */
export function spriteImage(sprite: Sprite, kit: StyleKit, scale = 1, background?: "checker"): RgbaImage {
  const img = blankImage(sprite.w * scale, sprite.h * scale);
  if (background) paintChecker(img, Math.max(4, scale * 2));
  drawSprite(img, sprite, kitColors(kit), 0, 0, scale);
  return img;
}

export interface SheetLayout {
  image: RgbaImage;
  cellW: number;
  cellH: number;
  columns: number;
  rows: number;
}

/**
 * Lay animation rows out as a grid: one grid row per animation row, one cell per frame,
 * every cell as large as the biggest frame (sprites sit bottom-left in their cell).
 */
export function sheetImage(grid: Sprite[][], kit: StyleKit, scale = 1, background?: "checker"): SheetLayout {
  const columns = Math.max(1, ...grid.map((r) => r.length));
  const cellW = Math.max(1, ...grid.flat().map((s) => s.w));
  const cellH = Math.max(1, ...grid.flat().map((s) => s.h));
  const image = blankImage(columns * cellW * scale, grid.length * cellH * scale);
  if (background) paintChecker(image, Math.max(4, scale * 2));
  const colors = kitColors(kit);
  grid.forEach((row, ry) => row.forEach((s, cx) => drawSprite(image, s, colors, cx * cellW * scale, (ry * cellH + (cellH - s.h)) * scale, scale)));
  return { image, cellW, cellH, columns, rows: grid.length };
}

function paintChecker(img: RgbaImage, cell = 8): void {
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const v = ((x / cell) | 0) + ((y / cell) | 0);
      img.rgba.set(v % 2 ? [200, 200, 210, 255] : [226, 226, 234, 255], (y * img.width + x) * 4);
    }
}

/** Scale an image up by an integer factor (nearest neighbour). */
export function scaleImage(img: RgbaImage, scale: number): RgbaImage {
  if (scale === 1) return img;
  const out = blankImage(img.width * scale, img.height * scale);
  for (let y = 0; y < out.height; y++) {
    const sy = (y / scale) | 0;
    for (let x = 0; x < out.width; x++) {
      const so = (sy * img.width + ((x / scale) | 0)) * 4;
      out.rgba.set(img.rgba.subarray(so, so + 4), (y * out.width + x) * 4);
    }
  }
  return out;
}

/** Integer scale that makes the largest side of a `w` x `h` sprite at least `target` px, capped at `maxSide`. */
export function previewScale(w: number, h: number, target = 256, maxSide = 1024): number {
  const big = Math.max(w, h);
  let s = Math.max(1, Math.ceil(target / big));
  while (s > 1 && big * s > maxSide) s--;
  return s;
}

// ---------- contact sheet ----------

// 3x5 digit font so contact-sheet cells can be referred to by number.
const DIGITS = [
  "111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001",
  "111100111001111", "111100111101111", "111001001001001", "111101111101111", "111101111001111",
];

function drawNumber(img: RgbaImage, n: number, x0: number, y0: number, scale: number, rgb: [number, number, number]): void {
  let x = x0;
  for (const d of String(n)) {
    const glyph = DIGITS[Number(d)];
    for (let i = 0; i < 15; i++)
      if (glyph[i] === "1")
        for (let j = 0; j < scale; j++)
          for (let k = 0; k < scale; k++) {
            const px = x + (i % 3) * scale + k, py = y0 + Math.floor(i / 3) * scale + j;
            if (px < img.width && py < img.height) img.rgba.set([rgb[0], rgb[1], rgb[2], 255], (py * img.width + px) * 4);
          }
    x += 4 * scale;
  }
}

/**
 * Numbered grid of sprites on a checkerboard (cell 1 = top-left, row-major),
 * for showing variations to a multimodal agent.
 */
export function contactSheet(sprites: Sprite[], kit: StyleKit, opts: { columns?: number; scale?: number; numbers?: boolean } = {}): RgbaImage {
  const n = Math.max(1, sprites.length);
  const columns = Math.min(opts.columns ?? 4, n);
  const rows = Math.ceil(n / columns);
  const cw = Math.max(1, ...sprites.map((s) => s.w));
  const ch = Math.max(1, ...sprites.map((s) => s.h));
  const scale = opts.scale ?? previewScale(cw * columns, ch * rows, 512, 1600);
  const pad = 2, label = opts.numbers === false ? 0 : 7;
  const cellW = (cw + pad * 2) * scale, cellH = (ch + pad * 2) * scale + label * Math.max(1, Math.floor(scale / 2));
  const img = blankImage(columns * cellW, rows * cellH, [40, 38, 52, 255]);
  const colors = kitColors(kit);
  sprites.forEach((s, i) => {
    const cx = (i % columns) * cellW, cy = Math.floor(i / columns) * cellH;
    const labelH = cellH - (ch + pad * 2) * scale;
    const bg: RgbaImage = blankImage((cw + pad * 2) * scale, (ch + pad * 2) * scale);
    paintChecker(bg, Math.max(4, scale * 2));
    for (let y = 0; y < bg.height; y++) img.rgba.set(bg.rgba.subarray(y * bg.width * 4, (y + 1) * bg.width * 4), ((cy + labelH + y) * img.width + cx) * 4);
    drawSprite(img, s, colors, cx + (pad + Math.floor((cw - s.w) / 2)) * scale, cy + labelH + (pad + (ch - s.h)) * scale, scale);
    if (label) drawNumber(img, i + 1, cx + scale, cy + Math.max(1, Math.floor(scale / 2)), Math.max(1, Math.floor(scale / 2)), [240, 230, 255]);
  });
  return img;
}

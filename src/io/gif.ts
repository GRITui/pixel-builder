// Pure-TS GIF89a encoder (ported from v1). Frames are palette-index buffers; index 0 can be transparent.
import type { Rgba } from "../pixel/types";
import { hexToRgb } from "../color/oklab";

/** GIF-flavoured LZW over palette indices. */
export function lzwEncode(pixels: Uint8Array, minCode: number): Uint8Array {
  const clear = 1 << minCode, eoi = clear + 1;
  const out: number[] = [];
  let acc = 0, nbits = 0;
  const emit = (code: number, size: number) => {
    acc |= code << nbits;
    nbits += size;
    while (nbits >= 8) { out.push(acc & 255); acc >>>= 8; nbits -= 8; }
  };
  let size = minCode + 1, next = eoi + 1;
  let dict = new Map<number, number>();
  emit(clear, size);
  let prefix = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i], key = (prefix << 8) | k, hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix, size);
    if (next < 4096) {
      dict.set(key, next++);
      if (next - 1 === (1 << size) && size < 12) size++;
    } else {
      emit(clear, size);
      dict = new Map();
      size = minCode + 1;
      next = eoi + 1;
    }
    prefix = k;
  }
  emit(prefix, size);
  emit(eoi, size);
  if (nbits > 0) out.push(acc & 255);
  return Uint8Array.from(out);
}

const u16 = (n: number) => [n & 255, (n >> 8) & 255];

export interface GifOptions {
  fps: number;
  /** Integer nearest-neighbour upscale (1..16). */
  scale?: number;
  /** 0 = loop forever. */
  loop?: number;
}

/**
 * Encode same-size RGBA frames (true pixel art: <=255 distinct opaque colours across all frames,
 * alpha 0/255) as an animated GIF. Colours are exact; no dithering.
 */
export function encodeGif(frames: Rgba[], opts: GifOptions): Buffer {
  if (!frames.length) throw new Error("encodeGif needs at least one frame");
  const { w, h } = frames[0];
  if (frames.some((f) => f.w !== w || f.h !== h)) throw new Error("GIF frames must all be the same size");
  const k = Math.max(1, Math.min(16, Math.floor(opts.scale ?? 1)));
  const W = w * k, H = h * k;
  if (W > 65535 || H > 65535) throw new Error(`GIF is too large (${W}x${H})`);
  // index 0 reserved for transparent
  const table = new Map<number, number>();
  const colors: number[][] = [[0, 0, 0]];
  let hasAlpha = false;
  const idxFrames = frames.map((f) => {
    const idx = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (f.data[i * 4 + 3] < 128) { hasAlpha = true; continue; }
      const key = (f.data[i * 4] << 16) | (f.data[i * 4 + 1] << 8) | f.data[i * 4 + 2];
      let p = table.get(key);
      if (p === undefined) {
        if (colors.length >= 256) throw new Error("GIF holds at most 255 colours plus transparency; reduce the palette first");
        p = colors.length;
        table.set(key, p);
        colors.push([key >> 16, (key >> 8) & 255, key & 255]);
      }
      idx[i] = p;
    }
    return idx;
  });
  let bits = 1;
  while (1 << bits < colors.length) bits++;
  const minCode = Math.max(2, bits);
  const delay = Math.max(2, Math.round(100 / Math.max(1, opts.fps)));
  const out: number[] = [...Buffer.from("GIF89a"), ...u16(W), ...u16(H), 0x80 | 0x70 | (bits - 1), 0, 0];
  for (let i = 0; i < 1 << bits; i++) out.push(...(colors[i] ?? [0, 0, 0]));
  out.push(0x21, 0xff, 11, ...Buffer.from("NETSCAPE2.0"), 3, 1, ...u16(opts.loop ?? 0), 0);
  for (const idx of idxFrames) {
    let data = idx;
    if (k > 1) {
      data = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data[y * W + x] = idx[Math.floor(y / k) * w + Math.floor(x / k)];
    }
    out.push(0x21, 0xf9, 4, (2 << 2) | (hasAlpha ? 1 : 0), ...u16(delay), 0, 0);
    out.push(0x2c, ...u16(0), ...u16(0), ...u16(W), ...u16(H), 0, minCode);
    const lz = lzwEncode(data, minCode);
    for (let i = 0; i < lz.length; i += 255) {
      const n = Math.min(255, lz.length - i);
      out.push(n);
      for (let j = 0; j < n; j++) out.push(lz[i + j]);
    }
    out.push(0);
  }
  out.push(0x3b);
  return Buffer.from(out);
}

/** Convenience: hex palette helper for callers that want RGB triples. */
export const paletteRgb = (palette: string[]): number[][] => palette.map(hexToRgb);

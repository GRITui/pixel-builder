// Pure-TS GIF89a encoder for sprite frames (palette indices) - no dependencies.
// The kit palette is the global colour table (entry 0 = transparent), so colours are exact.
import type { RGB } from "../core/palette";
import type { Sprite } from "../core/types";

export interface GifOptions {
  /** Palette index -> colour (index 0 / null = transparent). At most 256 entries. */
  colors: (RGB | null)[];
  fps: number;
  /** Integer nearest-neighbour upscale. */
  scale?: number;
  /** Loop count; 0 = forever (default). */
  loop?: number;
}

/** GIF-flavoured LZW over palette indices (variable code size, clear when the 4096-entry table fills). */
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

function subBlocks(data: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 255) {
    const n = Math.min(255, data.length - i);
    out.push(n);
    for (let j = 0; j < n; j++) out.push(data[i + j]);
  }
  out.push(0);
  return out;
}

const u16 = (n: number) => [n & 255, (n >> 8) & 255];

function upscale(s: Sprite, k: number): Uint8Array {
  if (k === 1) return Uint8Array.from(s.data);
  const w = s.w * k, out = new Uint8Array(w * s.h * k);
  for (let y = 0; y < s.h * k; y++) for (let x = 0; x < w; x++) out[y * w + x] = s.data[Math.floor(y / k) * s.w + Math.floor(x / k)];
  return out;
}

/**
 * Encode frames (all the same size) as an animated GIF. When no frame has a transparent pixel, each
 * frame after the first is cropped to what changed (unchanged pixels become transparent over the
 * previous frame), which keeps scene GIFs small.
 */
export function encodeGif(frames: Sprite[], opts: GifOptions): Buffer {
  if (!frames.length) throw new Error("encodeGif needs at least one frame");
  const { w, h } = frames[0];
  if (frames.some((f) => f.w !== w || f.h !== h)) throw new Error("GIF frames must all be the same size");
  const colors = opts.colors;
  if (colors.length > 256) throw new Error(`GIF palettes hold at most 256 colours; this kit has ${colors.length}`);
  const k = Math.max(1, Math.min(16, Math.floor(opts.scale ?? 1)));
  const W = w * k, H = h * k;
  if (W > 65535 || H > 65535) throw new Error(`GIF is too large (${W}x${H})`);
  let bits = 1;
  while (1 << bits < Math.max(2, colors.length)) bits++;
  const minCode = Math.max(2, bits);
  const delay = Math.max(2, Math.round(100 / Math.max(1, opts.fps))); // centiseconds; browsers clamp < 2 anyway

  const out: number[] = [...Buffer.from("GIF89a"), ...u16(W), ...u16(H), 0x80 | 0x70 | (bits - 1), 0, 0];
  for (let i = 0; i < 1 << bits; i++) { const c = colors[i]; out.push(...(c && i > 0 ? c : [0, 0, 0])); }
  out.push(0x21, 0xff, 11, ...Buffer.from("NETSCAPE2.0"), 3, 1, ...u16(opts.loop ?? 0), 0);

  const px = frames.map((f) => upscale(f, k));
  const opaque = px.every((p) => p.every((v) => v !== 0));
  px.forEach((p, n) => {
    let x0 = 0, y0 = 0, fw = W, fh = H, data = p;
    if (opaque && n > 0) {
      const prev = px[n - 1];
      let ax = W, ay = H, bx = -1, by = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (p[y * W + x] !== prev[y * W + x]) { if (x < ax) ax = x; if (x > bx) bx = x; if (y < ay) ay = y; if (y > by) by = y; }
      if (bx < 0) { ax = ay = bx = by = 0; }
      x0 = ax; y0 = ay; fw = bx - ax + 1; fh = by - ay + 1;
      data = new Uint8Array(fw * fh);
      for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
        const v = p[(y0 + y) * W + x0 + x];
        data[y * fw + x] = v === prev[(y0 + y) * W + x0 + x] ? 0 : v;
      }
    }
    // disposal 1 (keep) for diffed frames, 2 (clear to background) for transparent sprites
    const dispose = opaque ? 1 : 2;
    out.push(0x21, 0xf9, 4, (dispose << 2) | 1, ...u16(delay), 0, 0);
    out.push(0x2c, ...u16(x0), ...u16(y0), ...u16(fw), ...u16(fh), 0, minCode);
    for (const b of subBlocks(lzwEncode(data, minCode))) out.push(b); // not spread: frames can be huge
  });
  out.push(0x3b);
  return Buffer.from(out);
}

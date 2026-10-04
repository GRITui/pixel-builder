// .aseprite (Aseprite binary) writer on node:zlib only, no dependencies.
//
// Layout follows Aseprite's own encoder (src/dio/aseprite_encoder.cpp): a
// 128-byte header, then one frame block per frame, each holding chunks. Pixels
// are 8-bit indexed against the kit palette, which is what Aseprite calls
// "indexed" mode; index 0 is transparent here exactly as it is in
// `flattenRamps`, so Aseprite's palette index 0 is our transparent colour.
//
// Cels are written as ASE_FILE_COMPRESSED_CEL: the scanline bytes in one zlib
// stream, which Aseprite inflates with its own zlib.
import { deflateSync } from "node:zlib";
import { hexToRgb, type RGB } from "../core/palette";
import { resolveRamps } from "../core/kit";
import { flattenRamps } from "../core/palette";
import type { RigSvgInfo } from "../core/svg";
import type { FrameSet, Sprite, StyleKit } from "../core/types";

// From src/dio/aseprite_common.h.
const ASE_FILE_MAGIC = 0xa5e0;
const ASE_FILE_FRAME_MAGIC = 0xf1fa;

const ASE_FILE_CHUNK_FLI_COLOR2 = 4;
const ASE_FILE_CHUNK_LAYER = 0x2004;
const ASE_FILE_CHUNK_CEL = 0x2005;
const ASE_FILE_CHUNK_TAGS = 0x2018;

const ASE_FILE_LAYER_IMAGE = 0;
const ASE_FILE_COMPRESSED_CEL = 2;

// Header flags (aseprite_common.h).
const ASE_FILE_FLAG_LAYER_WITH_OPACITY = 1;

// doc/layer.h: `Visible` so the layer is shown on load.
const LAYER_FLAG_VISIBLE = 1;

// doc/blend_mode.h: normal blending.
const BLEND_MODE_NORMAL = 0;

export interface AsepriteExportInput {
  /** Animation rows; their frames are flattened in row order into Aseprite frames. */
  rows: FrameSet[];
  fps: number;
  kit: StyleKit;
  /** Rig part ownership. Present => one layer per rig part; absent => a single layer. */
  rig?: RigSvgInfo;
  /** Integer upscale of every cel's pixel data. 1 = native sprite resolution. */
  scale?: number;
}

/**
 * The kit palette as Aseprite wants it: RGB triples, index 0 first. Index 0 is
 * transparent in pixel-builder (ramp slot 0 is "no colour"), so entry 0 is a
 * placeholder black that never appears in the pixel data.
 */
export function asepritePalette(kit: StyleKit): RGB[] {
  return flattenRamps(resolveRamps(kit)).map((hex, i) => (i === 0 || !hex ? ([0, 0, 0] as RGB) : hexToRgb(hex)));
}

// ---------- little-endian writer ----------

/** A growable little-endian buffer. `patch*` backfills size fields already reserved. */
class Writer {
  private buf: Buffer = Buffer.alloc(256);
  private size = 0;

  get length(): number {
    return this.size;
  }

  private need(n: number): void {
    if (this.size + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.size + n) cap *= 2;
    const next = Buffer.alloc(cap);
    this.buf.copy(next, 0, 0, this.size);
    this.buf = next;
  }

  bytes(b: Buffer): void {
    this.need(b.length);
    b.copy(this.buf, this.size);
    this.size += b.length;
  }

  u8(v: number): void {
    const b = Buffer.allocUnsafe(1);
    b.writeUInt8(v & 0xff, 0);
    this.bytes(b);
  }

  u16(v: number): void {
    const b = Buffer.allocUnsafe(2);
    b.writeUInt16LE(v & 0xffff, 0);
    this.bytes(b);
  }

  i16(v: number): void {
    const b = Buffer.allocUnsafe(2);
    b.writeInt16LE(Math.max(-0x8000, Math.min(0x7fff, v)), 0);
    this.bytes(b);
  }

  u32(v: number): void {
    const b = Buffer.allocUnsafe(4);
    b.writeUInt32LE(v >>> 0, 0);
    this.bytes(b);
  }

  /** Aseprite strings are a u16 length followed by the raw bytes (UTF-8 names). */
  string(s: string): void {
    const b = Buffer.from(s, "utf8");
    this.u16(b.length);
    this.bytes(b);
  }

  padding(n: number): void {
    if (n > 0) this.bytes(Buffer.alloc(n));
  }

  concat(): Buffer {
    return this.buf.subarray(0, this.size);
  }

  /** Backfill a u32 size field written earlier at absolute offset `at`. */
  patchU32(at: number, value: number): void {
    this.buf.writeUInt32LE(value >>> 0, at);
  }
}

/** A chunk is `u32 size` (including those 6 bytes) then `u16 type`, then the body. */
function writeChunk(w: Writer, type: number, body: (w: Writer) => void): number {
  const start = w.length;
  w.u32(0); // size, patched below
  w.u16(type);
  body(w);
  const size = w.length - start;
  w.patchU32(start, size);
  return size;
}

// ---------- indexed pixel helpers ----------

/**
 * A cel's tight bounds around the pixels `pick` selects, cropped to those bounds
 * with every other pixel cleared to 0. Masking matters: a cel that kept another
 * layer's pixels would double-draw them and make the result depend on z-order.
 */
function celBounds(
  sprite: Sprite,
  pick: (p: number) => boolean,
): { x: number; y: number; w: number; h: number; data: number[] } | null {
  let x0 = sprite.w, y0 = sprite.h, x1 = -1, y1 = -1;
  for (let y = 0; y < sprite.h; y++)
    for (let x = 0; x < sprite.w; x++) {
      if (!pick(y * sprite.w + x)) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const data: number[] = new Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const src = (y + y0) * sprite.w + (x + x0);
      data[y * w + x] = pick(src) ? sprite.data[src] : 0;
    }
  return { x: x0, y: y0, w, h, data };
}

/** Nearest-neighbour upscale of indexed pixel data. */
function scaleIndexed(data: number[], w: number, h: number, scale: number): { w: number; h: number; data: number[] } {
  if (scale === 1) return { w, h, data };
  const W = w * scale, H = h * scale;
  const out = new Array<number>(W * H);
  for (let y = 0; y < H; y++) {
    const sy = (y / scale) | 0;
    for (let x = 0; x < W; x++) out[y * W + x] = data[sy * w + ((x / scale) | 0)];
  }
  return { w: W, h: H, data: out };
}

// ---------- encoder ----------

/**
 * Encode an asset as a .aseprite file.
 *
 * Frames are the asset's frames flattened in row order. Each rig part that
 * appears anywhere in the asset gets its own layer, and pixels owned by no
 * visible part fall to "core" -- the same split the SVG export uses.
 */
export function encodeAseprite(input: AsepriteExportInput): Buffer {
  const { rows, kit, fps } = input;
  const scale = Math.max(1, Math.min(16, Math.floor(input.scale ?? 1)));
  const palette = asepritePalette(kit);
  if (!rows.length || !rows[0].frames.length) throw new Error("Asset has no frames to export.");

  // Flatten rows into frames, remembering each frame's row index for tags.
  const frames: Sprite[] = [];
  const rowOf: number[] = [];
  const frameInRow: number[] = [];
  rows.forEach((r, ri) =>
    r.frames.forEach((sprite, fi) => {
      frames.push(sprite);
      rowOf.push(ri);
      frameInRow.push(fi);
    }),
  );

  // Canvas covers the largest frame at the export scale.
  const cellW = Math.max(1, ...frames.map((s) => s.w));
  const cellH = Math.max(1, ...frames.map((s) => s.h));
  const canvasW = cellW * scale;
  const canvasH = cellH * scale;

  // Layers: one per rig part that actually appears, else one "core" layer.
  const rig = input.rig;
  const layers: string[] =
    rig && rig.parts.length
      ? rig.parts.filter((p) => frames.some((_, f) => rig.owners[rowOf[f]]?.[frameInRow[f]]?.some((o) => o === p)))
      : [];
  if (!layers.length) layers.push("core");

  // Which layer a pixel belongs to; unowned pixels go to "core" (mirrors svg.ts).
  const ownerAt = (f: number, p: number): string => {
    const o = rig?.owners[rowOf[f]]?.[frameInRow[f]]?.[p];
    return o && layers.includes(o) ? o : "core";
  };

  // ---- header ----
  const head = new Writer();
  head.u32(0); // file size, patched at the end
  head.u16(ASE_FILE_MAGIC);
  head.u16(frames.length);
  head.u16(canvasW);
  head.u16(canvasH);
  head.u16(8); // depth: 8 bits per pixel (indexed)
  head.u32(ASE_FILE_FLAG_LAYER_WITH_OPACITY);
  head.u16(1000 / frameDuration(fps)); // legacy speed field (deprecated)
  head.u32(0); // next
  head.u32(0); // "frit" (frame passed count)
  head.u8(0); // transparent index
  head.padding(3);
  head.u16(palette.length);
  head.u8(1); // pixel width
  head.u8(1); // pixel height
  head.i16(0); // grid x
  head.i16(0); // grid y
  head.u16(0); // grid width
  head.u16(0); // grid height
  // The written fields stop at 44 bytes but Aseprite reads a fixed 128-byte
  // header, so the remainder is reserved padding.
  head.padding(128 - head.length);
  if (head.length !== 128) throw new Error(`Internal error: header is ${head.length} bytes, expected 128`);

  const duration = frameDuration(fps);
  const w = new Writer();
  const fileStart = w.length;
  w.bytes(head.concat());

  for (let f = 0; f < frames.length; f++) {
    const fw = new Writer();
    let chunks = 0;

    // The palette rides in the first frame only.
    if (f === 0) {
      writeChunk(fw, ASE_FILE_CHUNK_FLI_COLOR2, (cw) => {
        cw.u16(1); // one packet
        cw.u8(0); // skip 0 entries
        cw.u8(palette.length === 256 ? 0 : palette.length); // 0 means 256
        for (const c of palette) {
          cw.u8(c[0]);
          cw.u8(c[1]);
          cw.u8(c[2]);
        }
      });
      chunks++;

      // Layers are declared once, in the first frame; later frames index them.
      // File layer 0 is the TOP layer, so write back-to-front: "core" last.
      for (let li = layers.length - 1; li >= 0; li--) {
        writeChunk(fw, ASE_FILE_CHUNK_LAYER, (lw) => {
          lw.u16(LAYER_FLAG_VISIBLE);
          lw.u16(ASE_FILE_LAYER_IMAGE);
          lw.u16(0); // child level
          lw.u16(0); // default width
          lw.u16(0); // default height
          lw.u16(BLEND_MODE_NORMAL);
          lw.u8(255); // opacity
          lw.padding(3);
          lw.string(layers[li]);
        });
        chunks++;
      }

      chunks += writeTags(fw, rows, rowOf);
    }

    // Cels, bottom layer first so the paint order matches the source frames.
    layers.forEach((part, li) => {
      const b = celBounds(frames[f], (p) => ownerAt(f, p) === part);
      if (!b) return;
      const s = scaleIndexed(b.data, b.w, b.h, scale);
      const raw = Buffer.alloc(s.w * s.h);
      for (let i = 0; i < s.data.length; i++) raw[i] = s.data[i];
      // Layer index in the file counts from the top; our loop counts from the bottom.
      const fileLayer = layers.length - 1 - li;
      writeChunk(fw, ASE_FILE_CHUNK_CEL, (cw) => {
        cw.u16(fileLayer);
        cw.i16(b.x * scale);
        cw.i16(b.y * scale);
        cw.u8(255); // opacity
        cw.u16(ASE_FILE_COMPRESSED_CEL);
        cw.u16(0); // z-index
        cw.padding(5);
        cw.u16(s.w);
        cw.u16(s.h);
        cw.bytes(deflateSync(raw, { level: 9 }));
      });
      chunks++;
    });

    const body = fw.concat();
    const frameSize = 16 + body.length;
    const fh = new Writer();
    fh.u32(frameSize);
    fh.u16(ASE_FILE_FRAME_MAGIC);
    fh.u16(Math.min(chunks, 0xffff)); // chunk count (u16, clamped)
    fh.u16(duration);
    fh.padding(2);
    fh.u32(chunks);
    if (fh.length !== 16) throw new Error(`Internal error: frame header is ${fh.length} bytes, expected 16`);
    w.bytes(fh.concat());
    w.bytes(body);
  }

  // Patch the file size into the header's first u32.
  w.patchU32(fileStart, w.length);
  return w.concat();
}

/** Frame duration in milliseconds from the asset's fps (100 when unset). */
function frameDuration(fps: number): number {
  const f = fps > 0 ? fps : 10;
  return Math.max(1, Math.round(1000 / f));
}

/** One tag per animation row, spanning that row's frames. Returns the chunk count (1). */
function writeTags(w: Writer, rows: FrameSet[], rowOf: number[]): number {
  const ranges: { from: number; to: number; name: string }[] = [];
  rows.forEach((r, ri) => {
    let from = -1, to = -1;
    for (let f = 0; f < rowOf.length; f++)
      if (rowOf[f] === ri) {
        if (from < 0) from = f;
        to = f;
      }
    if (from >= 0) ranges.push({ from, to, name: r.name });
  });

  writeChunk(w, ASE_FILE_CHUNK_TAGS, (tw) => {
    tw.u16(ranges.length);
    tw.u32(0); // 8 reserved bytes
    tw.u32(0);
    for (const r of ranges) {
      tw.u16(r.from);
      tw.u16(r.to);
      tw.u8(0); // animation direction: forward
      tw.u16(0); // repeat
      tw.u16(0); // 6 reserved bytes
      tw.u32(0);
      tw.u8(0); // tag colour
      tw.u8(0);
      tw.u8(0);
      tw.u8(0); // skipped by Aseprite
      tw.string(r.name);
    }
  });
  return 1;
}
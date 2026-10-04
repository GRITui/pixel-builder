// Aseprite (.aseprite) writer. Pure: no node/DOM APIs, so the web app and the CLI share it.
// Spec: https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md
//
// INDEXED colour mode: the file's palette is the kit's flattened ramps, entry i = sprite
// palette index i (0 = transparent), so the palette stays locked to the kit and pixels
// round-trip 1:1. Frames of all animation rows are laid out consecutively; every row
// becomes a tag. Cels are zlib streams: STORED blocks by default (valid for any inflater,
// no dependency), or pass `deflate` (e.g. node:zlib) for smaller files.
import { MATERIALS, decodeIndex, hexToRgb, type Material } from "./palette";
import type { FrameSet } from "./types";

export interface AsepriteInput {
  rows: FrameSet[];
  /** Flattened kit palette (entry 0 = null/transparent), see flattenRamps. */
  palette: (string | null)[];
  fps?: number;
  /** Layer names bottom -> top (default: a single "sprite" layer). */
  layers?: string[];
  /** Layer index owning a pixel of frame (row, frame); out of range falls back to layer 0. Default: layer 0. */
  layerOf?: (row: number, frame: number, pixel: number) => number;
  deflate?: (data: Uint8Array) => Uint8Array;
}

class Out {
  private buf = new Uint8Array(1024);
  len = 0;
  private ensure(n: number) {
    if (this.len + n <= this.buf.length) return;
    const b = new Uint8Array(Math.max(this.buf.length * 2, this.len + n));
    b.set(this.buf);
    this.buf = b;
  }
  byte(v: number) { this.ensure(1); this.buf[this.len++] = v & 255; return this; }
  word(v: number) { return this.byte(v).byte(v >> 8); }
  short(v: number) { return this.word(v); }
  dword(v: number) { return this.word(v).word(v >>> 16); }
  zeros(n: number) { for (let i = 0; i < n; i++) this.byte(0); return this; }
  bytes(b: Uint8Array) { this.ensure(b.length); this.buf.set(b, this.len); this.len += b.length; return this; }
  str(s: string) { const b = new TextEncoder().encode(s); return this.word(b.length).bytes(b); }
  patch32(at: number, v: number) { this.buf[at] = v & 255; this.buf[at + 1] = (v >> 8) & 255; this.buf[at + 2] = (v >> 16) & 255; this.buf[at + 3] = (v >>> 24) & 255; }
  result() { return this.buf.slice(0, this.len); }
}

function adler32(d: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < d.length; i++) {
    a = (a + d[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** zlib stream made of STORED deflate blocks (no compression, universally readable). */
export function zlibStored(data: Uint8Array): Uint8Array {
  const o = new Out();
  o.byte(0x78).byte(0x01);
  if (!data.length) o.byte(1).word(0).word(0xffff);
  for (let i = 0; i < data.length; i += 65535) {
    const n = Math.min(65535, data.length - i);
    o.byte(i + n >= data.length ? 1 : 0).word(n).word(~n & 0xffff).bytes(data.subarray(i, i + n));
  }
  const ad = adler32(data);
  o.byte(ad >>> 24).byte(ad >>> 16).byte(ad >>> 8).byte(ad);
  return o.result();
}

const chunk = (o: Out, type: number, body: (c: Out) => void) => {
  const at = o.len;
  o.dword(0).word(type);
  body(o);
  o.patch32(at, o.len - at);
};

/** Default layer split for non-rigged assets: one layer per material present (bottom -> top in palette order). */
export function materialLayers(rows: FrameSet[]): { layers: string[]; layerOf: (r: number, f: number, p: number) => number } {
  const used = new Set<Material>();
  rows.forEach((r) => r.frames.forEach((s) => s.data.forEach((v) => { const d = decodeIndex(v); if (d) used.add(d.mat); })));
  const mats = MATERIALS.filter((m) => used.has(m));
  const pos = new Map<Material, number>(mats.map((m, i) => [m, i]));
  return {
    layers: mats.map((m) => (m === "ink" ? "outline" : m)),
    layerOf: (r, f, p) => pos.get(decodeIndex(rows[r].frames[f].data[p])?.mat as Material) ?? 0,
  };
}

export function writeAseprite(input: AsepriteInput): Uint8Array {
  const { rows } = input;
  const frames = rows.flatMap((r, ri) => r.frames.map((s, fi) => ({ s, ri, fi })));
  if (!frames.length) throw new Error("Asset has no frames to export.");
  const W = Math.max(...frames.map((f) => f.s.w)), H = Math.max(...frames.map((f) => f.s.h));
  if (W > 65535 || H > 65535) throw new Error("Sprite too large for .aseprite (max 65535 px).");
  const layers = input.layers?.length ? input.layers : ["sprite"];
  const deflate = input.deflate ?? zlibStored;
  const duration = Math.max(1, Math.min(65535, Math.round(1000 / Math.max(1, input.fps ?? 6))));
  const pal = input.palette;

  const o = new Out();
  // header (128 bytes)
  o.dword(0).word(0xa5e0).word(frames.length).word(W).word(H).word(8).dword(1).word(duration).dword(0).dword(0);
  o.byte(0).zeros(3).word(pal.length).byte(1).byte(1).short(0).short(0).word(0).word(0).zeros(84);

  frames.forEach(({ s, ri, fi }, n) => {
    const at = o.len;
    const cels: { layer: number; px: Uint8Array; x0: number; y0: number; w: number; h: number }[] = [];
    const owner = new Int32Array(s.data.length).fill(-1);
    for (let p = 0; p < s.data.length; p++) {
      if (!s.data[p]) continue;
      const l = input.layerOf ? input.layerOf(ri, fi, p) : 0;
      owner[p] = l >= 0 && l < layers.length ? l : 0;
    }
    layers.forEach((_, li) => {
      let x0 = s.w, y0 = s.h, x1 = -1, y1 = -1;
      for (let p = 0; p < owner.length; p++) {
        if (owner[p] !== li) continue;
        const x = p % s.w, y = (p / s.w) | 0;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      if (x1 < 0) return; // no cel = empty layer on this frame
      const w = x1 - x0 + 1, h = y1 - y0 + 1, px = new Uint8Array(w * h);
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const p = (y + y0) * s.w + x + x0;
          if (owner[p] === li) px[y * w + x] = s.data[p];
        }
      cels.push({ layer: li, px, x0, y0, w, h });
    });
    const nChunks = cels.length + (n === 0 ? 2 + layers.length : 0);
    o.dword(0).word(0xf1fa).word(Math.min(nChunks, 0xfffe)).word(duration).zeros(2).dword(nChunks);
    if (n === 0) {
      chunk(o, 0x2019, (c) => {
        c.dword(pal.length).dword(0).dword(pal.length - 1).zeros(8);
        pal.forEach((hex) => {
          const [r, g, b] = hex ? hexToRgb(hex) : [0, 0, 0];
          c.word(0).byte(r).byte(g).byte(b).byte(hex ? 255 : 0);
        });
      });
      layers.forEach((name) => chunk(o, 0x2004, (c) => { c.word(3).word(0).word(0).word(0).word(0).word(0).byte(255).zeros(3).str(name); }));
      // tags: one per animation row, rows are consecutive frame ranges
      chunk(o, 0x2018, (c) => {
        c.word(rows.filter((r) => r.frames.length).length).zeros(8);
        let from = 0;
        for (const r of rows) {
          if (!r.frames.length) continue;
          const to = from + r.frames.length - 1;
          c.word(from).word(to).byte(0).word(0).zeros(6).byte(0).byte(0).byte(0).byte(0).str(r.name);
          from = to + 1;
        }
      });
    }
    for (const c of cels)
      chunk(o, 0x2005, (k) => {
        k.word(c.layer).short(c.x0).short(c.y0).byte(255).word(2).short(0).zeros(5).word(c.w).word(c.h).bytes(deflate(c.px));
      });
    o.patch32(at, o.len - at);
  });
  o.patch32(0, o.len);
  return o.result();
}

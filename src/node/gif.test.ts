import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GENERATORS, defaults } from "../core/generators";
import { KIT_PRESETS } from "../core/kit";
import { renderMapFrames } from "../core/mapanim";
import type { Sprite } from "../core/types";
import { encodeGif } from "./gif";
import { kitColors } from "./png";
import { callTool } from "./tools";
import { Workspace } from "./workspace";

/** Minimal GIF decoder: header, global palette, frames composed on a canvas (index 0 = transparent / keep). */
function decodeGif(buf: Buffer) {
  expect(buf.subarray(0, 6).toString()).toBe("GIF89a");
  const w = buf.readUInt16LE(6), h = buf.readUInt16LE(8), flags = buf[10];
  const ncol = 1 << ((flags & 7) + 1);
  let p = 13 + ncol * 3;
  const palette = Array.from({ length: ncol }, (_, i) => [buf[13 + i * 3], buf[14 + i * 3], buf[15 + i * 3]]);
  const frames: number[][] = [];
  const canvas = new Array(w * h).fill(0);
  let loop = -1, delay = 0;
  while (buf[p] !== 0x3b) {
    if (buf[p] === 0x21) {
      const label = buf[p + 1];
      if (label === 0xff) loop = buf.readUInt16LE(p + 16);
      if (label === 0xf9) delay = buf.readUInt16LE(p + 4);
      p += 2;
      while (buf[p]) p += buf[p] + 1;
      p++;
    } else {
      const x0 = buf.readUInt16LE(p + 1), y0 = buf.readUInt16LE(p + 3), fw = buf.readUInt16LE(p + 5), fh = buf.readUInt16LE(p + 7);
      const minCode = buf[p + 10];
      p += 11;
      const bytes: number[] = [];
      while (buf[p]) { for (let i = 0; i < buf[p]; i++) bytes.push(buf[p + 1 + i]); p += buf[p] + 1; }
      p++;
      const px = lzwDecode(bytes, minCode, fw * fh);
      for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) { const v = px[y * fw + x]; if (v) canvas[(y0 + y) * w + x0 + x] = v; }
      frames.push(canvas.slice());
    }
  }
  return { w, h, palette, frames, loop, delay };
}

function lzwDecode(bytes: number[], minCode: number, count: number): number[] {
  const clear = 1 << minCode, eoi = clear + 1;
  let size = minCode + 1, acc = 0, nb = 0, bi = 0;
  let table: number[][] = [];
  const reset = () => { table = Array.from({ length: eoi + 1 }, (_, i) => (i < clear ? [i] : [])); size = minCode + 1; };
  reset();
  const out: number[] = [];
  let prev: number[] | null = null;
  while (out.length < count) {
    while (nb < size) { acc |= bytes[bi++] << nb; nb += 8; }
    const code = acc & ((1 << size) - 1);
    acc >>>= size; nb -= size;
    if (code === clear) { reset(); prev = null; continue; }
    if (code === eoi) break;
    const entry: number[] = code < table.length ? table[code] : [...prev!, prev![0]];
    out.push(...entry);
    if (prev) table.push([...prev, entry[0]]);
    prev = entry;
    if (table.length === 1 << size && size < 12) size++;
  }
  return out;
}

const kit = KIT_PRESETS.find((k) => k.id === "kit-hd-rich")!;
const sp = (w: number, h: number, f: (x: number, y: number) => number): Sprite => ({ w, h, data: Array.from({ length: w * h }, (_, i) => f(i % w, Math.floor(i / w))) });

describe("gif encoder", () => {
  const colors = kitColors(kit);
  it("round-trips transparent frames with palette, loop and delay", () => {
    const frames = [0, 1, 2].map((n) => sp(7, 5, (x, y) => ((x + y + n) % 3 === 0 ? 0 : 1 + ((x * 7 + y * 3 + n * 11) % 80))));
    const g = decodeGif(encodeGif(frames, { colors, fps: 10 }));
    expect([g.w, g.h, g.frames.length, g.loop, g.delay]).toEqual([7, 5, 3, 0, 10]);
    expect(g.palette.length).toBeGreaterThanOrEqual(colors.length > 128 ? 256 : 128);
    const c5 = colors[5]!;
    expect(g.palette[5]).toEqual([...c5]);
    // transparent frames are disposed to background, so each decoded canvas equals its source only for the last composed; check frame 0
    expect(g.frames[0]).toEqual(frames[0].data);
  });

  it("scales and handles big noisy frames (code table resets)", () => {
    const f = sp(120, 90, (x, y) => 1 + ((x * 31 + y * 17 + ((x * y) % 13)) % 90));
    const g = decodeGif(encodeGif([f, f], { colors, fps: 8, scale: 2 }));
    expect([g.w, g.h]).toEqual([240, 180]);
    expect(g.frames[0][181 * 240 + 7]).toBe(f.data[90 * 120 + 3]);
    expect(g.frames[1]).toEqual(g.frames[0]);
  });

  it("opaque frames are diffed and still reconstruct exactly", () => {
    const a = sp(16, 16, (x, y) => 1 + ((x + y) % 5));
    const b = sp(16, 16, (x, y) => (x > 8 && y < 4 ? 40 : 1 + ((x + y) % 5)));
    const g = decodeGif(encodeGif([a, b, a], { colors, fps: 4 }));
    expect(g.frames.map((x) => x.join())).toEqual([a, b, a].map((x) => x.data.join()));
  });
});

describe("living maps", () => {
  const map = (extra: object = {}) => {
    const g = GENERATORS.find((x) => x.id === "map")!;
    return g.generate({ ...defaults(g), biome: "forest-mmo", cols: 14, rows: 12, detail: "off", ...extra } as never, kit, 5);
  };
  it("default output is untouched; animate adds deterministic frames", () => {
    const plain = map();
    expect(plain.rows[0].frames).toHaveLength(1);
    expect(plain.fps).toBe(1);
    const a = map({ animate: true, frames: 4 }), b = map({ animate: true, frames: 4 });
    expect(a.rows[0].frames).toHaveLength(4);
    expect(a.rows[0].frames.map((f) => f.data)).toEqual(b.rows[0].frames.map((f) => f.data));
    expect(a.rows[0].frames[0].data).not.toEqual(a.rows[0].frames[2].data);
    expect(renderMapFrames(a.tilemap!, kit, 4, 5).map((f) => f.data)).toEqual(a.rows[0].frames.map((f) => f.data));
  }, 60000);
});

describe("export_asset gif", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "pb-gif-")); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  it("writes one gif per animated row, or the chosen row; refuses static assets", () => {
    const ws = new Workspace(join(dir, "ws"));
    const ch = callTool(ws, "generate_asset", { generator: "character", name: "hero" }).data as any;
    const r = callTool(ws, "export_asset", { id: ch.asset.id, format: "gif", scale: 2 }).data as any;
    expect(r.files.length).toBeGreaterThan(1);
    expect(r.files[0].path).toMatch(/hero\.walk-down\.gif$/);
    const one = callTool(ws, "export_asset", { id: ch.asset.id, format: "gif", row: "walk-left" }).data as any;
    expect(one.files).toHaveLength(1);
    expect(decodeGif(readFileSync(one.files[0].path)).frames).toHaveLength(4);
    const m = callTool(ws, "generate_asset", { generator: "map", name: "meadow", params: { animate: true, frames: 4, cols: 12, rows: 12 } }).data as any;
    const mg = callTool(ws, "export_asset", { id: m.asset.id, format: "gif" }).data as any;
    expect(mg.files[0].path).toMatch(/meadow\.gif$/);
    expect(decodeGif(readFileSync(mg.files[0].path)).frames).toHaveLength(4);
    const still = callTool(ws, "generate_asset", { generator: "map", name: "still", params: { cols: 12, rows: 12 } }).data as any;
    expect(() => callTool(ws, "export_asset", { id: still.asset.id, format: "gif" })).toThrow(/animate/);
    callTool(ws, "delete_asset", { id: ch.asset.id });
    expect(existsSync(r.files[0].path)).toBe(false);
  }, 60000);
});

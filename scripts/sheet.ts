// PNG contact-sheet writer shared by the preview scripts (node:zlib only).
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { flattenPaletteFx, hexToRgb } from "../src/core/palette";
import { resolveRamps } from "../src/core/kit";
import type { Sprite, StyleKit } from "../src/core/types";

function crc32(buf: Buffer) {
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    let c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function savePng(path: string, sheet: Sprite[][], kit: StyleKit, scale = 4) {
  const flat = flattenPaletteFx(resolveRamps(kit));
  const cw = Math.max(...sheet.map((r) => r.reduce((a, s) => a + s.w + 2, 0)));
  const ch = sheet.reduce((a, r) => a + Math.max(...r.map((s) => s.h)) + 2, 0);
  const W = cw * scale, H = ch * scale;
  const raw = Buffer.alloc((W * 4 + 1) * H);
  const set = (x: number, y: number, rgb: number[]) => {
    const o = y * (W * 4 + 1) + 1 + x * 4;
    raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2]; raw[o + 3] = 255;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, ((x >> 3) + (y >> 3)) % 2 ? [200, 200, 210] : [230, 230, 236]);
  let oy = 0;
  for (const row of sheet) {
    let ox = 0;
    for (const s of row) {
      for (let y = 0; y < s.h; y++)
        for (let x = 0; x < s.w; x++) {
          const v = s.data[y * s.w + x];
          if (!v || !flat[v]) continue;
          const rgb = hexToRgb(flat[v]!);
          for (let j = 0; j < scale; j++) for (let i = 0; i < scale; i++) set((ox + x) * scale + i, (oy + y) * scale + j, rgb);
        }
      ox += s.w + 2;
    }
    oy += Math.max(...row.map((s) => s.h)) + 2;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  writeFileSync(path, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

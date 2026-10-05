/**
 * Side-by-side of kit-hd-rich (left) and kit-hd-deep (right) for the same assets, written to a PNG.
 *
 *   npx tsx scripts/deep-compare.ts docs/img/deep-ramps.png [scale]
 */
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { KIT_PRESETS, resolveRamps } from "../src/core/kit";
import { flattenPalette, hexToRgb } from "../src/core/palette";
import { defaults } from "../src/core/generators/types";
import { generatorById } from "../src/core/generators";
import type { Sprite, StyleKit } from "../src/core/types";

const out = process.argv[2] ?? "docs/img/deep-ramps.png";
const scale = Number(process.argv[3] ?? 3);
const rich = KIT_PRESETS.find((k) => k.id === "kit-hd-rich")!;
const deep = KIT_PRESETS.find((k) => k.id === "kit-hd-deep")!;

const SUBJECTS: [string, Record<string, unknown>][] = [
  ["character", {}],
  ["environment", { kind: "oak" }],
  ["building", { style: "farmhouse" }],
  ["environment", { kind: "water-tile" }],
  ["map", {}],
];

function first(id: string, params: Record<string, unknown>, kit: StyleKit): Sprite {
  const g = generatorById(id)!;
  const s = g.generate({ ...defaults(g), ...params } as never, kit, 1).rows[0].frames[0];
  if (s.w <= 160 && s.h <= 160) return s;
  const c = 128, data = new Array<number>(c * c);
  for (let y = 0; y < c; y++) for (let x = 0; x < c; x++) data[y * c + x] = s.data[(y + 200) * s.w + x + 200];
  return { w: c, h: c, data };
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

const pairs = SUBJECTS.map(([id, p]) => [first(id, p, rich), first(id, p, deep)] as const);
const flats = [rich, deep].map((k) => flattenPalette(resolveRamps(k)));
const gap = 4;
const colW = pairs.map(([a]) => a.w);
const rowH = Math.max(...pairs.map(([a]) => a.h));
const cw = 2 * colW.reduce((a, b) => a + b, 0) + gap * (2 * colW.length + 1);
const ch = rowH + 2 * gap;
const W = cw * scale, H = ch * scale;
const raw = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const o = y * (W * 4 + 1) + 1 + x * 4;
  const c = ((x >> 3) + (y >> 3)) % 2 ? 200 : 230;
  raw[o] = c; raw[o + 1] = c; raw[o + 2] = c + 6; raw[o + 3] = 255;
}
let ox = gap;
for (const [a, b] of pairs) {
  [a, b].forEach((s, k) => {
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      const hex = flats[k][s.data[y * s.w + x]];
      if (!hex) continue;
      const rgb = hexToRgb(hex);
      for (let j = 0; j < scale; j++) for (let i = 0; i < scale; i++) {
        const o = ((gap + y) * scale + j) * (W * 4 + 1) + 1 + ((ox + x) * scale + i) * 4;
        raw[o] = rgb[0]; raw[o + 1] = rgb[1]; raw[o + 2] = rgb[2];
      }
    }
    ox += s.w + gap;
  });
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
console.log(`wrote ${out} (${W}x${H})`);

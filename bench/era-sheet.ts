// Era contact sheet: the SAME subject at every era, side by side, plus a greyscale row.
// Built for visual review (AGENTS.md "look at the PNG") of the S3 value-structure claim.
// The mask is constant across eras by construction: one subject, one source image, one
// sprite-mode run per era, so nothing but the era ceiling changes between columns.
//   npx tsx bench/era-sheet.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "../src/io/png";
import { pixelizeSprite } from "../src/pixel/sprite";
import { shadedSubject } from "../src/pixel/modes.fixtures";
import { ERAS, type Era, type Rgba } from "../src/pixel/types";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "pixel-out");
const ERAS_RUN: Era[] = [8, 16, 32, 64];

/** Copy src onto dst at (ox,oy), clipping at the edges. Source and dest are separate buffers. */
const blit = (dst: Rgba, src: Rgba, ox: number, oy: number) => {
  for (let y = 0; y < src.h; y++) {
    const dy = oy + y;
    if (dy < 0 || dy >= dst.h) continue;
    for (let x = 0; x < src.w; x++) {
      const dx = ox + x;
      if (dx < 0 || dx >= dst.w) continue;
      const s = (y * src.w + x) * 4;
      const d = (dy * dst.w + dx) * 4;
      dst.data.set([src.data[s], src.data[s + 1], src.data[s + 2], 255], d);
    }
  }
};

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Desaturate in place. This is the 1x/greyscale gate: a flat image is the failure. */
const grey = (img: Rgba): Rgba => {
  const out: Rgba = { w: img.w, h: img.h, data: new Uint8ClampedArray(img.data) };
  for (let i = 0; i < out.data.length; i += 4) {
    const v = luma(out.data[i], out.data[i + 1], out.data[i + 2]);
    out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
  }
  return out;
};

/** Composite the greyscaled result over a mid grey so transparent subject pixels are visible. */
const overMid = (img: Rgba): Rgba => {
  const out: Rgba = { w: img.w, h: img.h, data: new Uint8ClampedArray(img.data) };
  for (let i = 0; i < out.data.length; i += 4) if (out.data[i + 3] === 0) out.data[i] = out.data[i + 1] = out.data[i + 2] = 128;
  return out;
};

// Nearest-neighbour upscale. A 32px sprite must be viewed at an integer multiple or the
// pixels lie to you; 12x puts each era column at 384px wide so a vision model can read it.
const SCALE = 12;
const cell = 32, pad = 10, label = 12;
const w = ERAS_RUN.length * (cell * SCALE + pad) + pad;
const h = cell * SCALE * 2 + pad * 3 + label;
const sheet: Rgba = { w, h, data: new Uint8ClampedArray(w * h * 4) };
for (let i = 0; i < sheet.data.length; i += 4) { sheet.data[i] = 24; sheet.data[i + 1] = 24; sheet.data[i + 2] = 28; sheet.data[i + 3] = 255; }

const stats: string[] = [];
for (const era of ERAS_RUN) {
  const src = shadedSubject("gradient", 200, 240);
  const r = pixelizeSprite(src, { era, width: cell, seed: 1 });
  const nat = r.native;
  const up: Rgba = { w: nat.w * SCALE, h: nat.h * SCALE, data: new Uint8ClampedArray(nat.w * SCALE * nat.h * SCALE * 4) };
  for (let y = 0; y < nat.h; y++) for (let x = 0; x < nat.w; x++) {
    const s = (y * nat.w + x) * 4;
    // Fill transparent source pixels with mid grey HERE, during the upscale. Upscaling first
    // and masking after does not work: every upscale write sets alpha 255, which turns the
    // keyed-out background into opaque black and hides the art entirely.
    const px = nat.data[s + 3] === 0
      ? [128, 128, 128, 255]
      : [nat.data[s], nat.data[s + 1], nat.data[s + 2], 255];
    for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) {
      const d = ((y * SCALE + dy) * up.w + x * SCALE + dx) * 4;
      up.data.set(px, d);
    }
  }
  const ox = pad + ERAS_RUN.indexOf(era) * (cell * SCALE + pad);
  // Both rows composite over the SAME mid grey. The sprite result has alpha 0 outside the
  // keyed subject; blitting that raw paints black, which hides the art and reads as
  // "nothing rendered" — so fill transparent pixels before compositing.
  blit(sheet, overMid(up), ox, pad + label);
  blit(sheet, overMid(grey(up)), ox, pad + label + cell * SCALE + pad);

  // Subject-only luma spread (alpha > 0), the numeric half of the gate.
  const ls: number[] = [];
  for (let i = 0; i < nat.data.length; i += 4) if (nat.data[i + 3] > 0) ls.push(luma(nat.data[i], nat.data[i + 1], nat.data[i + 2]));
  ls.sort((a, b) => a - b);
  const q = (p: number) => Math.round(ls[Math.floor((ls.length - 1) * p)] ?? 0);
  stats.push(`era ${era} (limit ${ERAS[era].colours}): subject px ${ls.length}, luma p5 ${q(0.05)} p50 ${q(0.5)} p95 ${q(0.95)} spread ${q(0.95) - q(0.05)}`);
}

mkdirSync(OUT, { recursive: true });
const file = join(OUT, "era-sheet.png");
writeFileSync(file, encodePng(sheet));
console.log(`${file}  ${w}x${h}`);
for (const s of stats) console.log("  " + s);
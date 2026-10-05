// Procedurally draws the reference image used by the "match a reference" task:
// a 32x32 pixel-art treasure chest (warm wood, gold bands, black outline).
// Run: npx tsx bench/agents/fixtures/make-fixtures.ts
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { blankImage, encodePng } from "../../../src/node/png";

type RGB = [number, number, number];
const WOOD: RGB[] = [[74, 44, 28], [112, 68, 40], [150, 94, 54], [184, 124, 72]];
const GOLD: RGB[] = [[150, 108, 24], [214, 164, 44], [246, 212, 96]];
const INK: RGB = [24, 16, 20];

const img = blankImage(32, 32);
const set = (x: number, y: number, c: RGB) => {
  const i = (y * 32 + x) * 4;
  img.rgba[i] = c[0];
  img.rgba[i + 1] = c[1];
  img.rgba[i + 2] = c[2];
  img.rgba[i + 3] = 255;
};
const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < 32 && y < 32 && img.rgba[(y * 32 + x) * 4 + 3] > 0;

// body (x 4..27, y 14..27) and rounded lid (y 7..14), lit from the top-left
for (let y = 7; y <= 27; y++) {
  for (let x = 4; x <= 27; x++) {
    const lid = y <= 14;
    if (lid && (y === 7 || y === 8) && (x < 6 || x > 25)) continue;
    let shade = lid ? 2 : 1;
    if (y === 9 || y === 15) shade += 1;
    if (x < 7) shade += 1;
    if (x > 24 || y > 25) shade -= 1;
    if (y === 14) shade = 0;
    set(x, y, WOOD[Math.max(0, Math.min(3, shade))]);
  }
}
// gold bands and clasp
for (const bx of [8, 22])
  for (let y = 8; y <= 27; y++) {
    set(bx, y, GOLD[1]);
    set(bx + 1, y, GOLD[0]);
  }
for (let y = 12; y <= 18; y++) for (let x = 14; x <= 17; x++) set(x, y, y === 12 || x === 14 ? GOLD[2] : GOLD[1]);
set(15, 15, INK);
set(16, 15, INK);
set(15, 16, INK);
// outline
const ring: [number, number][] = [];
for (let y = 0; y < 32; y++)
  for (let x = 0; x < 32; x++)
    if (!opaque(x, y) && (opaque(x + 1, y) || opaque(x - 1, y) || opaque(x, y + 1) || opaque(x, y - 1))) ring.push([x, y]);
for (const [x, y] of ring) set(x, y, INK);

const out = join(dirname(fileURLToPath(import.meta.url)), "ref-chest.png");
writeFileSync(out, encodePng(img));
console.log("wrote", out);

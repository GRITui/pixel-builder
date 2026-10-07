// Writes simple placeholder sprites for any asset that does not exist yet (never overwrites real art).
// Run: npx tsx examples/snake/placeholder-assets.ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "../../src/io/png";
import type { Rgba } from "../../src/pixel/types";

const dir = join(dirname(fileURLToPath(import.meta.url)), "assets");
const PAL = ["#14101f", "#2a2140", "#3b6b2f", "#4f8f3a", "#7bc74d", "#e8e0c8", "#d63a3a", "#f2c230", "#8a5a3a", "#5a5a7a", "#8a8aa8", "#ffffff"];
const [INK, , G1, G2, G3, CREAM, RED, GOLD, BROWN, STONE1, STONE2] = PAL;

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const make = (w: number, h: number): Rgba => ({ w, h, data: new Uint8ClampedArray(w * h * 4) });
function px(im: Rgba, x: number, y: number, c: string) {
  if (x < 0 || y < 0 || x >= im.w || y >= im.h) return;
  const o = (y * im.w + x) * 4;
  const [r, g, b] = rgb(c);
  im.data.set([r, g, b, 255], o);
}
const rect = (im: Rgba, x: number, y: number, w: number, h: number, c: string) => {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) px(im, x + i, y + j, c);
};
const tile = (c: string, f?: (im: Rgba) => void) => { const im = make(16, 16); rect(im, 0, 0, 16, 16, c); f?.(im); return im; };

const sprites: Record<string, () => Rgba> = {
  "head.png": () => { // faces right
    const im = make(16, 16);
    rect(im, 0, 2, 14, 12, INK); rect(im, 1, 3, 12, 10, G2); rect(im, 2, 4, 10, 3, G3);
    rect(im, 14, 4, 2, 8, INK); rect(im, 9, 4, 3, 3, CREAM); rect(im, 9, 9, 3, 3, CREAM);
    px(im, 11, 5, INK); px(im, 11, 10, INK);
    return im;
  },
  "body.png": () => { // horizontal
    const im = make(16, 16);
    rect(im, 0, 2, 16, 12, INK); rect(im, 0, 3, 16, 10, G2); rect(im, 0, 4, 16, 3, G3);
    for (let x = 2; x < 16; x += 6) rect(im, x, 8, 3, 3, G1);
    return im;
  },
  "corner.png": () => { // connects LEFT and BOTTOM
    const im = make(16, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const leftArm = x <= 13 && y >= 2 && y <= 13;
      const botArm = x >= 2 && x <= 13 && y >= 2;
      if (leftArm || botArm) px(im, x, y, G2);
    }
    // outline
    const out = make(16, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const solid = (x0: number, y0: number) => x0 >= 0 && y0 >= 0 && x0 < 16 && y0 < 16 && im.data[(y0 * 16 + x0) * 4 + 3] === 255;
      if (solid(x, y)) {
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const nx = x + dx, ny = y + dy;
          return nx >= 0 && ny >= 0 && nx < 16 && ny < 16 && !solid(nx, ny);
        });
        px(out, x, y, edge ? INK : (x + y) % 5 === 0 ? G3 : G2);
      }
    }
    return out;
  },
  "tail.png": () => { // tip points LEFT, connects on RIGHT edge
    const im = make(16, 16);
    for (let x = 0; x < 16; x++) {
      const half = Math.min(5, 1 + Math.floor(x / 2));
      rect(im, x, 8 - half - 1, 1, half * 2 + 2, INK);
      rect(im, x, 8 - half, 1, half * 2, G2);
      if (half > 1) px(im, x, 8 - half, G3);
    }
    return im;
  },
  "apple.png": () => {
    const im = make(16, 16);
    rect(im, 4, 4, 8, 10, INK); rect(im, 3, 6, 10, 6, INK);
    rect(im, 4, 5, 8, 8, RED); rect(im, 3 + 1, 7, 8, 4, RED); rect(im, 5, 6, 2, 2, "#ff8a8a");
    rect(im, 8, 1, 2, 4, BROWN); rect(im, 10, 2, 3, 2, G3);
    return im;
  },
  "gold.png": () => {
    const im = make(16, 16);
    rect(im, 4, 4, 8, 10, INK); rect(im, 3, 6, 10, 6, INK);
    rect(im, 4, 5, 8, 8, GOLD); rect(im, 5, 6, 2, 2, "#fff6b0"); rect(im, 9, 10, 2, 2, "#c88a10");
    rect(im, 8, 1, 2, 4, BROWN); rect(im, 10, 2, 3, 2, G3);
    return im;
  },
  "grass-a.png": () => tile(G1, (im) => { px(im, 3, 4, G2); px(im, 11, 9, G2); px(im, 7, 13, G2); }),
  "grass-b.png": () => tile(G2, (im) => { px(im, 5, 3, G1); px(im, 12, 6, G1); px(im, 2, 11, G1); }),
  "wall.png": () => tile(STONE1, (im) => {
    rect(im, 0, 0, 16, 1, STONE2); rect(im, 0, 7, 16, 1, INK); rect(im, 0, 15, 16, 1, INK);
    rect(im, 7, 0, 1, 8, INK); rect(im, 3, 8, 1, 8, INK); rect(im, 11, 8, 1, 8, INK);
  }),
  "title.png": () => {
    const im = make(320, 240);
    for (let y = 0; y < 240; y += 16) for (let x = 0; x < 320; x += 16) rect(im, x, y, 16, 16, (x + y) / 16 % 2 ? "#1c1830" : "#231d3a");
    rect(im, 0, 0, 320, 16, STONE1); rect(im, 0, 224, 320, 16, STONE1);
    return im;
  },
};

mkdirSync(dir, { recursive: true });
for (const [name, make_] of Object.entries(sprites)) {
  const p = join(dir, name);
  if (existsSync(p)) continue;
  writeFileSync(p, encodePng(make_()));
  console.log("wrote", name);
}
const pj = join(dir, "palette.json");
if (!existsSync(pj)) { writeFileSync(pj, JSON.stringify({ look: "placeholder", palette: PAL }, null, 2) + "\n"); console.log("wrote palette.json"); }

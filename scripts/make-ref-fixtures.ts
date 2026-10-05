/**
 * Writes the small synthetic reference images used by src/core/refstyle.test.ts to test/fixtures/refs/.
 *   npx tsx scripts/make-ref-fixtures.ts
 * Sprites come from the generators under kits with known outline / light settings so the tests can check the
 * analysis against a label; the painting is a smooth gradient with soft blobs; mmo-crop is cut from docs/img.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { generatorById } from "../src/core/generators";
import { coerceParams } from "../src/core/generators/types";
import { ALL_KIT_PRESETS } from "../src/core/kit";
import type { StyleKit } from "../src/core/types";
import { blankImage, drawSprite, decodePng, encodePng, kitColors, scaleImage, type RgbaImage } from "../src/node/png";

const OUT = "test/fixtures/refs";
mkdirSync(OUT, { recursive: true });
const preset = (id: string) => ALL_KIT_PRESETS.find((k) => k.id === id)!;

function scene(kit: StyleKit, bg: [number, number, number]): RgbaImage {
  const parts: [string, Record<string, unknown>][] = [["character", {}], ["environment", { kind: "oak" }], ["building", {}], ["environment", { kind: "rock" }]];
  const sprites = parts.map(([id, p], i) => {
    const g = generatorById(id)!;
    return g.generate(coerceParams(g, p), kit, 7 + i).rows[0].frames[0];
  });
  const W = sprites.reduce((a, s) => a + s.w + 6, 6), H = Math.max(...sprites.map((s) => s.h)) + 12;
  const img = blankImage(W, H, [...bg, 255]);
  const colors = kitColors(kit);
  let x = 6;
  for (const s of sprites) { drawSprite(img, s, colors, x, H - 6 - s.h, 1); x += s.w + 6; }
  return img;
}

const save = (name: string, img: RgbaImage) => writeFileSync(`${OUT}/${name}.png`, encodePng(img));
const bg: [number, number, number] = [196, 214, 168];

save("gameboy-4tone", scene(preset("kit-gameboy"), [0x9b, 0xbc, 0x0f]));
save("outline-black", scene({ ...preset("kit-default"), outline: "black" }, bg));
save("outline-none", scene({ ...preset("kit-default"), outline: "none" }, bg));
save("light-top-right", scene({ ...preset("kit-default"), lightDir: "top-right", outline: "none" }, bg));
save("light-top-left", scene({ ...preset("kit-default"), lightDir: "top-left", outline: "none" }, bg));
save("neon-dither", scene(preset("kit-neon"), [40, 30, 70]));
save("upscaled-x4", scaleImage(scene(preset("kit-gameboy"), [0x9b, 0xbc, 0x0f]), 4));

// smooth "painting": sky-to-meadow gradient with soft light blobs, no outlines, thousands of colours
const P = blankImage(128, 96);
for (let y = 0; y < 96; y++)
  for (let x = 0; x < 128; x++) {
    const t = y / 95;
    let r = 120 + 80 * (1 - t) - 60 * t, g = 160 + 30 * (1 - t) + 20 * t, b = 230 * (1 - t) + 70 * t;
    for (const [cx, cy, rad, col] of [[40, 60, 30, [60, 120, 40]], [96, 66, 24, [190, 150, 80]]] as const) {
      const d = Math.hypot(x - cx, y - cy) / rad;
      if (d < 1) { const k = (1 - d * d) * 0.8; r += (col[0] - r) * k; g += (col[1] - g) * k; b += (col[2] - b) * k; }
    }
    P.rgba.set([r, g, b, 255], (y * 128 + x) * 4);
  }
save("painting-gradient", P);

// realistic crop of the MMO scene (the village green)
const scenePng = decodePng(readFileSync("docs/img/mmo-scene.png"));
const [cx, cy, cw, ch] = [300, 200, 320, 240];
const crop = blankImage(cw, ch);
for (let y = 0; y < ch; y++) crop.rgba.set(scenePng.rgba.subarray(((cy + y) * scenePng.width + cx) * 4, ((cy + y) * scenePng.width + cx + cw) * 4), y * cw * 4);
save("mmo-crop", crop);
console.log("fixtures written to", OUT);

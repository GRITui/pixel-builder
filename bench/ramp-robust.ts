// Robustness pass for bench/ramp-materials.ts BEFORE any of its findings enter docs.
// The S3 lesson: re-measure a clean-looking finding against a second fixture. Three claims:
//   A "dark-chroma collapse"  — fabric family at hues 350/15/30: does era16 always drop
//                               dark-quintile chroma vs source?
//   B "green over-rotation"   — foliage family at hues 120/140/160: is era16's rotation
//                               always ~2x the source's?
//   C "hue is noise below chroma ~0.05" — metal at chroma 0.02/0.04/0.08/0.12, THREE SEEDS
//                               each. If seeds agree at 0.08+ but scatter at 0.02-0.04,
//                               the -96 deg "flip" is hue noise, not a defect.
//   npx tsx bench/ramp-robust.ts
import { fileURLToPath } from "node:url";
import { oklabToRgb } from "../src/color/oklab";
import { pixelizeSprite } from "../src/pixel/sprite";
import type { Rgba } from "../src/pixel/types";

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
// oklab = [L, a, b]; hue = atan2(b, a), chroma = hypot(a, b)
const hueOf = (r: number, g: number, b: number) => { const [, a, bb] = rgbToOklabRaw(r, g, b); return (Math.atan2(bb, a) * 180 / Math.PI + 360) % 360; };
const chromaOf = (r: number, g: number, b: number) => { const [, a, bb] = rgbToOklabRaw(r, g, b); return Math.hypot(a, bb); };
// local oklab (same math as src/color/oklab, verified identical to 4 decimals in ramp-divergence.ts)
function rgbToOklabRaw(r: number, g: number, b: number): [number, number, number] {
  const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const l = 0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B;
  const m = 0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B;
  const s = 0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return [0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
          1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
          0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_];
}
const hueGap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const signed = (x: number) => (x > 180 ? x - 360 : x);

/** Shaded sphere filled with the standard's ramp (degrees converted ONCE — see ramp-materials.ts). */
export function sphere(hueDeg: number, chroma: number, w = 200, h = 240): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x - 100, dy = y - 140, r = Math.hypot(dx, dy);
    if (r >= 70) { data.set([0, 0, 0, 0], (y * w + x) * 4); continue; }
    const l = Math.max(0, Math.min(1, 0.5 - (dx * 0.5 + dy * 0.6) / 140 + (r / 70) * -0.1));
    const L = 0.30 + l * 0.58, H = (hueDeg + (-20 + l * 40)) * (Math.PI / 180);
    const C = chroma * (l < 0.5 ? 1 + 0.10 * (0.5 - l) * 2 : 1 - 0.18 * (l - 0.5) * 2);
    const [rr, gg, bb] = oklabToRgb(L, C * Math.cos(H), C * Math.sin(H));
    data.set([Math.round(Math.max(0, Math.min(255, rr))), Math.round(Math.max(0, Math.min(255, gg))), Math.round(Math.max(0, Math.min(255, bb))), 255], (y * w + x) * 4);
  }
  return { w, h, data };
}

export function stats(img: Rgba) {
  const px: { l: number; h: number; c: number }[] = [];
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue;
    const [r, g, b] = [img.data[i], img.data[i + 1], img.data[i + 2]];
    px.push({ l: luma(r, g, b), h: hueOf(r, g, b), c: chromaOf(r, g, b) });
  }
  px.sort((a, b) => a.l - b.l);
  const n = px.length;
  const meanHue = (rows: typeof px) => {
    let sx = 0, sy = 0;
    for (const p of rows) { sx += Math.cos(p.h * Math.PI / 180); sy += Math.sin(p.h * Math.PI / 180); }
    return (Math.atan2(sy, sx) * 180 / Math.PI + 360) % 360;
  };
  const dark = px.slice(0, Math.floor(n * 0.2)), light = px.slice(-Math.floor(n * 0.2));
  const hd = meanHue(dark), hl = meanHue(light);
  let rot = hueGap(hd, hl);
  if (Math.cos((hl - hd) * Math.PI / 180) < 0) rot = 360 - rot;
  return { rot, darkC: dark.reduce((a, p) => a + p.c, 0) / dark.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log("=== A: dark-chroma collapse, fabric family (era 16 darkC ratio vs source) ===");
  for (const hue of [350, 15, 30]) {
    const src = stats(sphere(hue, 0.16));
    const r16 = stats(pixelizeSprite(sphere(hue, 0.16), { era: 16, width: 32, seed: 1 }).native);
    console.log(`  hue ${String(hue).padStart(3)}  src darkC ${src.darkC.toFixed(3)} -> era16 ${r16.darkC.toFixed(3)}  ratio ${(r16.darkC / src.darkC).toFixed(2)}`);
  }

  console.log("\n=== B: green over-rotation (era 16 rotation vs source, foliage family) ===");
  for (const hue of [120, 140, 160]) {
    const src = stats(sphere(hue, 0.11));
    const r16 = stats(pixelizeSprite(sphere(hue, 0.11), { era: 16, width: 32, seed: 1 }).native);
    console.log(`  hue ${String(hue).padStart(3)}  src rot ${signed(src.rot).toFixed(0)}  era16 rot ${signed(r16.rot).toFixed(0)}  ratio ${(signed(r16.rot) / signed(src.rot)).toFixed(2)}`);
  }

  console.log("\n=== C: is hue meaningful at low chroma? rotation across 3 seeds ===");
  for (const c of [0.02, 0.04, 0.08, 0.12]) {
    const rots: number[] = [];
    for (const seed of [1, 7, 13]) rots.push(signed(stats(pixelizeSprite(sphere(265, c), { era: 16, width: 32, seed }).native).rot));
    const spread = Math.max(...rots.map(Math.abs)) - Math.min(...rots.map(Math.abs));
    console.log(`  chroma ${c.toFixed(2)}  rot per seed [${rots.map((r) => r.toFixed(0)).join(", ")}]  spread ${spread.toFixed(0)} deg  ${spread < 25 ? "STABLE" : "NOISE"}`);
  }
}

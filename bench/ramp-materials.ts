// Sprint 4a / Track 2 — per-MATERIAL ramp integrity: does the pixelizer preserve the
// standard's hue rotation and saturation curve?
//
// The fixture ENCODES the standard (PIXEL-ART-HEAD-OF-DESIGN.md §1) into a shaded sphere
// per material:
//   - value ladder: L from 30% (core shadow) to 88% (highlight) — the 5-zone ladder's span
//   - hue rotation: darks lean COOL (-20 deg), lights lean WARM (+20 deg) — the Slynyrd ~20
//   - saturation: +10% in shadow, -18% at the highlight (peaks mid-ramp, falls at both ends)
// so the source's ramp is the ideal by construction. The bench then measures, per material
// and era, how much of that ramp survives:
//
//   ROTATION  — signed hue rotation from the darkest quintile to the lightest quintile
//               (pixel-weighted circular means), compared against the SOURCE's own rotation
//               measured the same way. Positive = warm-at-top (the standard's convention).
//   SAT CURVE — chroma at dark/mid/light terciles; the standard wants peak-mid with the
//               highlight NOTABLY lower than mid.
//   RAMP SIZE — distinct colours serving the material.
//
// Same harness discipline as quality-gate.ts: mask constant (the sphere IS the mask),
// source measured identically, era comparison only against that source. No cross-era verdict.
//
//   npx tsx bench/ramp-materials.ts
import { fileURLToPath } from "node:url";
import { oklabToOklch, oklabToRgb, rgbToOklab } from "../src/color/oklab";
import { pixelizeSprite } from "../src/pixel/sprite";
import type { Rgba } from "../src/pixel/types";
import type { Era } from "../src/pixel/types";

const ERAS_RUN: Era[] = [8, 16, 32, 64];
const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const hueOf = (r: number, g: number, b: number) => { const [, , H] = oklabToOklch(rgbToOklab(r, g, b)); return (((H * 180) / Math.PI) + 360) % 360; };
const chromaOf = (r: number, g: number, b: number) => oklabToOklch(rgbToOklab(r, g, b))[1];
const hueGap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

// --- the standard, encoded as a ramp ----------------------------------------
export interface Material { name: string; hue: number; chroma: number }

// Base hues per material family; chroma chosen so sRGB conversion stays in gamut.
export const MATERIALS: Material[] = [
  { name: "fabric(red)", hue: 15, chroma: 0.16 },
  { name: "skin(tan)", hue: 60, chroma: 0.09 },
  { name: "metal(steel)", hue: 265, chroma: 0.04 },
  { name: "foliage(green)", hue: 140, chroma: 0.11 },
];

/** The standard's ramp: L 30->88%, hue -20->+20 deg around base, chroma +10% shadow / -18% light. */
function standardPixel(l: number, m: Material): [number, number, number] {
  const L = 0.30 + l * 0.58;
  // DEGREES, converted once: (base + rotation) * pi/180. The first draft passed
  // `m.hue + rotation*(pi/180)` to cos() — base hue 15 then meant 15 RADIANS (~139 deg,
  // green), which manufactured the entire first run's findings. See ramp-divergence.ts.
  const H = (m.hue + (-20 + l * 40)) * (Math.PI / 180);
  const C = m.chroma * (l < 0.5 ? 1 + 0.10 * (0.5 - l) * 2 : 1 - 0.18 * (l - 0.5) * 2);
  const [r, g, b] = oklabToRgb(L, C * Math.cos(H), C * Math.sin(H));
  return [Math.round(Math.max(0, Math.min(255, r))), Math.round(Math.max(0, Math.min(255, g))), Math.round(Math.max(0, Math.min(255, b)))];
}

/** Shaded sphere (same geometry as modes.fixtures.shadedSubject) filled from ONE material ramp. */
export function materialSphere(m: Material, w = 200, h = 240): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x - 100, dy = y - 140;
    const r = Math.hypot(dx, dy);
    if (r >= 70) { data.set([0, 0, 0, 0], (y * w + x) * 4); continue; }
    const l = Math.max(0, Math.min(1, 0.5 - (dx * 0.5 + dy * 0.6) / 140 + (r / 70) * -0.1));
    data.set([...standardPixel(l, m), 255], (y * w + x) * 4);
  }
  return { w, h, data };
}

interface Ramp { rotation: number; darkC: number; midC: number; lightC: number; peakMid: boolean; colours: number }

/** Rotation + chroma curve over the opaque pixels, pixel-weighted. */
export function rampOf(img: Rgba): Ramp {
  const px: { l: number; h: number; c: number }[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] === 0) continue;
    const [r, g, b] = [img.data[i], img.data[i + 1], img.data[i + 2]];
    seen.add((r << 16) | (g << 8) | b);
    px.push({ l: luma(r, g, b), h: hueOf(r, g, b), c: chromaOf(r, g, b) });
  }
  px.sort((a, b) => a.l - b.l);
  const n = px.length;
  const meanHue = (rows: typeof px) => {
    let sx = 0, sy = 0;
    for (const p of rows) { sx += Math.cos((p.h * Math.PI) / 180); sy += Math.sin((p.h * Math.PI) / 180); }
    return ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
  };
  const dark = px.slice(0, Math.max(1, Math.floor(n * 0.2))), light = px.slice(-Math.max(1, Math.floor(n * 0.2))), mid = px.slice(Math.floor(n * 0.4), Math.floor(n * 0.6));
  const hd = meanHue(dark), hl = meanHue(light);
  // signed rotation dark->light along the short arc, sign chosen so warm-at-top reads positive
  let rot = hueGap(hd, hl);
  const cross = Math.cos(((hl - hd) * Math.PI) / 180);
  if (cross < 0) rot = 360 - rot; // long way round = the rotation went the "cold" direction
  const cd = dark.reduce((a, p) => a + p.c, 0) / dark.length;
  const cm = mid.reduce((a, p) => a + p.c, 0) / mid.length;
  const cl = light.reduce((a, p) => a + p.c, 0) / light.length;
  return { rotation: Math.round(rot), darkC: cd, midC: cm, lightC: cl, peakMid: cm >= cd && cm >= cl, colours: seen.size };
}

/** Run the pixelizer with the grade OFF — measures the QUANTIZER, not the vivid look. */
function plainPixelize(src: Rgba, era: Era) {
  return pixelizeSprite(src, { era, width: 32, seed: 1, preset: "neutral" }).native;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log("=== per-material ramp integrity (fixture = the standard's ramp, source-relative) ===\n");
  const rows: { mat: string; era: string; rot: number; src: number; retained: string; curve: string; colours: number }[] = [];
  for (const m of MATERIALS) {
    const src = materialSphere(m);
    const s = rampOf(src);
    console.log(`${m.name}  source: rotation dark->light ${s.rotation >= 180 ? s.rotation - 360 : s.rotation} deg  chroma dark ${s.darkC.toFixed(3)} / mid ${s.midC.toFixed(3)} / light ${s.lightC.toFixed(3)}  peak-mid ${s.peakMid ? "yes" : "NO"}`);
    for (const era of ERAS_RUN) {
      const r = rampOf(plainPixelize(src, era));
      let retained = (r.rotation >= 180 ? r.rotation - 360 : r.rotation) / (s.rotation >= 180 ? s.rotation - 360 : s.rotation);
      const row = {
        mat: m.name, era: String(era), rot: r.rotation >= 180 ? r.rotation - 360 : r.rotation, src: s.rotation >= 180 ? s.rotation - 360 : s.rotation,
        retained: (retained * 100).toFixed(0) + "%",
        curve: `dark ${r.darkC.toFixed(3)} / mid ${r.midC.toFixed(3)} / light ${r.lightC.toFixed(3)}${r.peakMid ? "" : "  (no mid peak)"}`,
        colours: r.colours,
      };
      rows.push(row);
      console.log(`  era ${String(era).padStart(2)}: rotation ${String(row.rot).padStart(4)} deg (src ${row.src})  retained ${row.retained}  chroma ${row.curve}  colours ${r.colours}`);
    }
    console.log();
  }

  console.log("=== verdict: rotation retained by era (avg over materials) ===");
  for (const era of ERAS_RUN) {
    const rs = rows.filter((r) => r.era === String(era));
    const ret = rs.reduce((a, r) => a + parseFloat(r.retained), 0) / rs.length;
    const peak = rs.filter((r) => r.curve.includes("no mid peak")).length;
    console.log(`  era ${String(era).padStart(2)}: rotation retained ${ret.toFixed(0)}%  peak-mid preserved ${rs.length - peak}/${rs.length}`);
  }
}

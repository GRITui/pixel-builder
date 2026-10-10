// Hue integrity across eras, mask held constant. Sprint 3 measured VALUE (luma spread) only;
// the first real visual pass (bench/era-sheet.png + bench/look.sh) reported that the era 8
// shadow breaks hue — "dark teal/cyan" and "stray magenta" on a red sphere. Numbers either
// confirm that or it gets thrown out, exactly as the S3 lesson requires.
//   npx tsx bench/hue-recheck.ts
import { oklabToOklch, rgbToOklab } from "../src/color/oklab";
import { pixelizeSprite } from "../src/pixel/sprite";
import { shadedSubject, type Bg } from "../src/pixel/modes.fixtures";
import { ERAS, type Era } from "../src/pixel/types";

const ERAS_RUN: Era[] = [8, 16, 32, 64];

/** Shortest angular distance between two hues, in degrees (0-180). */
const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

interface Cell { bg: string; era: Era; px: number; colours: number; mean: number; sd: number; outliers: number; worst: number }

/**
 * Chroma + hue stats over the keyed subject. hueOutliers counts pixels further than
 * OUTLIER_DEG from the pixel population's mean hue — hue integrity, not value.
 */
const OUTLIER_DEG = 60;
function measure(bg: string, src: ReturnType<typeof shadedSubject>, era: Era): Cell {
  const nat = pixelizeSprite(src, { era, width: 32, seed: 1 }).native;
  const hues: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < nat.data.length; i += 4) {
    if (nat.data[i + 3] === 0) continue;
    seen.add((nat.data[i] << 16) | (nat.data[i + 1] << 8) | nat.data[i + 2]);
    const [, , H] = oklabToOklch(rgbToOklab(nat.data[i], nat.data[i + 1], nat.data[i + 2]));
    // Near-grey pixels have unstable hue; skip them so achromatic shadow doesn't fake an outlier.
    const chroma = oklabToOklch(rgbToOklab(nat.data[i], nat.data[i + 1], nat.data[i + 2]))[1];
    if (chroma < 0.02) continue;
    hues.push((((H * 180) / Math.PI) + 360) % 360);
  }
  // Circular mean — averaging degrees naively breaks across the 0/360 seam.
  const sx = hues.reduce((a, h) => a + Math.cos((h * Math.PI) / 180), 0);
  const sy = hues.reduce((a, h) => a + Math.sin((h * Math.PI) / 180), 0);
  const mean = ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
  const gaps = hues.map((h) => hueGap(h, mean));
  const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - gaps.reduce((x, y) => x + y, 0) / gaps.length) ** 2, 0) / gaps.length);
  return { bg, era, px: hues.length, colours: seen.size, mean: Math.round(mean), sd: Math.round(sd), outliers: gaps.filter((g) => g > OUTLIER_DEG).length, worst: Math.round(Math.max(...gaps)) };
}

const BGS: [string, Bg][] = [["dark", [20, 22, 30]], ["mid", [128, 128, 128]], ["light", [230, 230, 235]], ["gradient", "gradient"]];
const rows: Cell[] = [];

console.log(`Hue integrity (mask constant, outlier = >${OUTLIER_DEG} deg from the subject's mean hue)\n`);
for (const [name, bg] of BGS) {
  const src = shadedSubject(bg, 200, 240);
  for (const era of ERAS_RUN) {
    const c = measure(name, src, era);
    rows.push(c);
    console.log(`bg=${name.padEnd(8)} era ${String(era).padStart(2)} limit ${String(ERAS[era].colours).padStart(3)}  px ${String(c.px).padStart(4)}  colours ${String(c.colours).padStart(3)}  meanHue ${String(c.mean).padStart(3)}  hueSD ${String(c.sd).padStart(3)}  outliers ${String(c.outliers).padStart(3)} (${((c.outliers / c.px) * 100).toFixed(0)}%)  worst ${c.worst} deg`);
  }
  console.log();
}

const at = (bg: string, era: Era) => rows.find((r) => r.bg === bg && r.era === era)!;

console.log("=== does the hue break worsen as the palette narrows? ===");
for (const [name] of BGS) {
  const line = ERAS_RUN.map((e) => {
    const c = at(name, e);
    return `era${e}=${((c.outliers / c.px) * 100).toFixed(0)}%`;
  });
  const pct = ERAS_RUN.map((e) => (at(name, e).outliers / at(name, e).px) * 100);
  const narrows = pct[0] > pct[pct.length - 1];
  console.log(`bg=${name.padEnd(8)} ${line.join("  ")}   ${narrows ? "worse at era 8 than era 64" : "no clear narrowing penalty"}`);
}

console.log("\n=== verdict ===");
const e8 = rows.filter((r) => r.era === 8);
const e64 = rows.filter((r) => r.era === 64);
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const o8 = avg(e8.map((r) => (r.outliers / r.px) * 100));
const o64 = avg(e64.map((r) => (r.outliers / r.px) * 100));
const w8 = avg(e8.map((r) => r.worst));
const w64 = avg(e64.map((r) => r.worst));
console.log(`mean hue outliers  era 8: ${o8.toFixed(1)}%   era 64: ${o64.toFixed(1)}%`);
console.log(`mean worst gap     era 8: ${w8.toFixed(0)} deg   era 64: ${w64.toFixed(0)} deg`);
console.log(o8 > o64 * 2 && w8 > w64 * 1.5
  ? "\nCONFIRMED: the era 8 hue break the visual pass reported is real and measurable."
  : "\nNOT CONFIRMED at this threshold - re-measure before writing it into docs.");
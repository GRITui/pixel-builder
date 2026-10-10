// Sprint 3b.5 — instrument the NES pick's ASSIGNMENT stage.
//
// The open root cause from audit/S3b-value-gate.md: era 8 is the only era on the
// `hardware-nes` greedy path. Selection is proven balanced (12 below / 12 above the
// median BY COUNT — bench/nes-budget.ts), the NES value axis has the same holes as era 16
// (bench/nes-hole.ts), and chromaWeight does not track the skew (bench/chroma-weight-proof.ts).
// So the skew must live in the ASSIGNMENT: which of the 24 chosen colours ends up serving
// which pixels. This script answers that directly:
//
//   1. The NES 55-set's own luma profile — how many colours sit in each 16-luma band.
//      (If the set is thin in the midtone band, midtone pixels have nowhere to land.)
//   2. For each era: the selected palette sorted by luma, and the pixel share each colour
//      actually serves on the keyed subject (same fixture/seed as quality-gate.ts).
//   3. The cumulative pixel share below luma 50/60/70/80 for source vs each era.
//      (If the source's midtone mass lands below luma 50 at era 8, the snap is the cause.)
//
//   npx tsx bench/nes-assignment.ts
import { NES } from "../src/color/palettes";
import { hexToRgb } from "../src/color/oklab";
import { keyBackground, pixelizeSprite } from "../src/pixel/sprite";
import { shadedSubject, type Bg } from "../src/pixel/modes.fixtures";
import type { Era } from "../src/pixel/types";

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const ERAS_RUN: Era[] = [8, 16];
const BANDS = 16; // 16-luma bands, 0..255
const bandOf = (l: number) => Math.min(BANDS - 1, Math.floor(l / (256 / BANDS)));

// --- 1. the NES set's luma profile -------------------------------------------
console.log("=== NES 55-set luma profile (how many colours per 16-luma band) ===");
const nesL = NES.map((h) => { const [r, g, b] = hexToRgb(h); return luma(r, g, b); }).sort((a, b) => a - b);
const nesBands = new Array(BANDS).fill(0);
for (const l of nesL) nesBands[bandOf(l)]++;
for (let b = 0; b < BANDS; b++) {
  const lo = Math.round(b * (256 / BANDS)), hi = Math.round((b + 1) * (256 / BANDS));
  console.log(`luma ${String(lo).padStart(3)}-${String(hi).padStart(3)}  ${"#".repeat(nesBands[b]).padEnd(16, ".")} ${nesBands[b]}`);
}
const midBand = nesL.filter((l) => l >= 40 && l <= 90).length;
console.log(`\nes colours with luma 40-90 (the midtone band the subject lives in): ${midBand} of ${NES.length}\n`);

// --- 2 + 3. assignment per era -----------------------------------------------
const BGS: [string, Bg][] = [["dark", [20, 22, 30]], ["mid", [128, 128, 128]], ["light", [230, 230, 235]], ["gradient", "gradient"]];

const below = (ls: number[], t: number) => (ls.filter((l) => l < t).length / ls.length) * 100;

for (const [name, bg] of BGS) {
  const src = shadedSubject(bg, 200, 240);
  const { mask } = keyBackground(src, {});
  const { w, h } = src;
  const srcL: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!mask[y * w + x]) continue;
    const i = (y * w + x) * 4;
    srcL.push(luma(src.data[i], src.data[i + 1], src.data[i + 2]));
  }
  console.log(`bg=${name}  source subject: ${srcL.length} px, <50 ${below(srcL, 50).toFixed(0)}%  <60 ${below(srcL, 60).toFixed(0)}%  <70 ${below(srcL, 70).toFixed(0)}%  <80 ${below(srcL, 80).toFixed(0)}%`);

  for (const era of ERAS_RUN) {
    const res = pixelizeSprite(src, { era, width: 32, seed: 1 });
    const counts = new Map<string, number>();
    for (let i = 0; i < res.native.data.length; i += 4) {
      if (res.native.data[i + 3] === 0) continue;
      const key = (res.native.data[i] << 16) | (res.native.data[i + 1] << 8) | res.native.data[i + 2];
      counts.set(key.toString(16).padStart(6, "0"), (counts.get(key.toString(16).padStart(6, "0")) ?? 0) + 1);
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const outL: number[] = [];
    const rows = [...counts.entries()].map(([hex, n]) => {
      const [r, g, b] = hexToRgb("#" + hex);
      const l = luma(r, g, b);
      outL.push(...Array(n).fill(l));
      return { hex, l: Math.round(l), n, pct: (n / total) * 100 };
    }).sort((a, b) => a.l - b.l);

    console.log(`  era ${era} (${res.palette.length} colours): <50 ${below(outL, 50).toFixed(0)}%  <60 ${below(outL, 60).toFixed(0)}%  <70 ${below(outL, 70).toFixed(0)}%  <80 ${below(outL, 80).toFixed(0)}%`);
    console.log("    luma  share  colours (hex, luma, %px)");
    for (let b = 0; b < BANDS; b++) {
      const inBand = rows.filter((r) => bandOf(r.l) === b);
      if (!inBand.length) continue;
      const share = inBand.reduce((a, r) => a + r.pct, 0);
      console.log(`    ${String(Math.round(b * (256 / BANDS))).padStart(3)}-  ${String(share.toFixed(0)).padStart(4)}%   ${inBand.map((r) => `${r.hex}(${r.l},${r.pct.toFixed(0)}%)`).join(" ")}`);
    }
  }
  console.log();
}

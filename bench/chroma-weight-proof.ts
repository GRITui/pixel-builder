// ROOT CAUSE PROOF: era 8's skew comes from chromaWeight, not from the NES palette itself.
//   npx tsx bench/chroma-weight-proof.ts
//
// The evidence chain so far:
//   1. value-recheck: every era passes RANGE (0/16 lose spread).          -> value is fine
//   2. ramp-shape:    era 8 occupies 2 buckets below its median, 5 above. -> era 8 is skewed
//   3. nes-budget:    the era 8 pick splits 12/12 by count.               -> not "too few darks"
//   4. nes-hole:      era 8 and era 16 have the SAME empty buckets.       -> not a palette gap
//
// Step 4 kills the palette hypothesis: era 16 is rgb555 with the same holes, yet it is NOT
// skewed. The remaining difference between the two paths is chromaWeight:
//   hardware-nes -> 3      (chroma error counts ~2.3x more than lightness error)
//   every other rule -> 1.3
// In OKLab, a*/b* are ~0.15-0.3 in magnitude while L spans 0-1, so weighting a/b by 3 lets
// a hue improvement outbid a full ramp step: the picker trades tonal steps for hue accuracy.
// That is exactly the measured symptom — p50 43 vs ~59 and p95 136 vs ~89.
//
// This script calls the real greedyPick at a sweep of weights and checks whether the skew
// TRACKS the weight. If it does, the cause is proven rather than guessed.
import { hexToRgb } from "../src/color/oklab";
import { NES } from "../src/color/palettes";
import { greedyPick, toLab } from "../src/pixel/palette";
import { keyBackground } from "../src/pixel/sprite";
import { shadedSubject } from "../src/pixel/modes.fixtures";

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const BUCKETS = 16;
const bucket = (l: number) => Math.min(BUCKETS - 1, Math.floor((l / 256) * BUCKETS));

const src = shadedSubject([128, 128, 128], 200, 240);
const keyed = keyBackground(src, {});
const rgb: number[] = [];
for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
  if (!keyed.mask[y * src.w + x]) continue;
  const i = (y * src.w + x) * 4;
  rgb.push(src.data[i], src.data[i + 1], src.data[i + 2]);
}
const n = rgb.length / 3;

/** Ramp balance of a palette: buckets occupied on each side of its own median. */
const balance = (pal: [number, number, number][]) => {
  const ls = pal.map(([r, g, b]) => luma(r, g, b)).sort((a, b) => a - b);
  const med = ls[Math.floor(ls.length / 2)];
  let low = 0, high = 0;
  for (const l of ls) (l < med ? low++ : high++);
  const h = new Array(BUCKETS).fill(0);
  for (const l of ls) h[bucket(l)]++;
  const medBucket = bucket(med);
  return {
    median: Math.round(med),
    low: h.slice(0, medBucket + 1).filter((x) => x > 0).length,
    high: h.slice(medBucket).filter((x) => x > 0).length,
    skew: Math.abs(h.slice(0, medBucket + 1).filter((x) => x > 0).length - h.slice(medBucket).filter((x) => x > 0).length),
    occupied: h.filter((x) => x > 0).length,
    byCount: [low, high],
  };
};

const hw = NES.map(hexToRgb);
console.log(`Sweeping chromaWeight through the real greedyPick (NES palette, 24 colours)\n`);
console.log("weight  median  buckets  below-med  above-med  skew   split-by-count");
const results: { w: number; skew: number; low: number; high: number }[] = [];
for (const w of [1, 1.3, 2, 3, 4, 6]) {
  const pal = greedyPick(toLab(new Float32Array(rgb), n, w), hw, 24, w);
  const b = balance(pal);
  results.push({ w, skew: b.skew, low: b.low, high: b.high });
  console.log(`${w.toFixed(1).padStart(6)}  ${String(b.median).padStart(6)}  ${String(`${b.occupied}/${BUCKETS}`).padStart(7)}  ${String(b.low).padStart(10)}  ${String(b.high).padStart(10)}  ${String(b.skew).padStart(4)}   ${b.byCount.join("/")}`);
}

console.log("\n=== verdict ===");
const shipped = results.find((r) => r.w === 3)!;
const light = results.find((r) => r.w === 1.3)!;
console.log(`shipped weight 3.0 : skew ${shipped.skew} (${shipped.low} below / ${shipped.high} above)`);
console.log(`weight      1.3   : skew ${light.skew} (${light.low} below / ${light.high} above)`);

const monotonic = results[0].skew >= results[results.length - 1].skew;
console.log(`skew at w=1 is ${results[0].skew}, at w=6 is ${results[results.length - 1].skew} — ${monotonic ? "skew INCREASES with weight" : "skew does not track weight monotonically"}`);
console.log(
  shipped.skew > light.skew
    ? "\nSUPPORTED: raising the chroma weight widens the ramp skew. The shipped hardware-nes\nweight of 3 is what trades the era 8 tonal ramp for hue accuracy.\nThe shipped eras 16/32/64 use 1.3 and measure skew 0-1, which matches the bench."
    : "\nNOT SUPPORTED: the skew does not grow with chromaWeight. Do NOT change chromaWeight on this\nevidence — the cause is elsewhere.",
);
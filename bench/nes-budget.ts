// Root cause for the era 8 balance failure: era 8 is the ONLY era with palette rule
// "hardware-nes", which greedy-picks from the fixed NES set instead of running k-means.
// Does that pick allocate the NES budget by lightness?
//   npx tsx bench/nes-budget.ts
import { hexToRgb } from "../src/color/oklab";
import { NES } from "../src/color/palettes";
import { buildPalette } from "../src/pixel/palette";
import { keyBackground } from "../src/pixel/sprite";
import { shadedSubject } from "../src/pixel/modes.fixtures";

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const BUCKETS = 16;

const show = (hist: number[]) => hist.map((n, i) => `${i}:${n}`).join(" ");

console.log(`NES hardware palette: ${NES.length} colours\n`);

const nesL = NES.map((h) => { const [r, g, b] = hexToRgb(h); return luma(r, g, b); });
const hist = new Array(BUCKETS).fill(0);
for (const l of nesL) hist[Math.min(BUCKETS - 1, Math.floor((l / 256) * BUCKETS))]++;
const nesMed = [...nesL].sort((a, b) => a - b)[Math.floor(NES.length / 2)];
console.log(`NES luma spread: ${Math.round(Math.min(...nesL))} to ${Math.round(Math.max(...nesL))}, median ${Math.round(nesMed)}`);
console.log(`NES lightness histogram: ${show(hist)}`);
console.log(`Is the NES set itself light-weighted? ${nesMed > 128 ? "YES" : "no"}`);

// What does the era 8 pick actually choose? Build it from the real subject.
const src = shadedSubject([128, 128, 128], 200, 240);
const keyed = keyBackground(src, {});
const rgb: number[] = [];
for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
  if (!keyed.mask[y * src.w + x]) continue;
  const i = (y * src.w + x) * 4;
  rgb.push(src.data[i], src.data[i + 1], src.data[i + 2]);
}

const pick = buildPalette({ rgb: new Float32Array(rgb), count: 24, rule: "hardware-nes", seed: 1 });
const pickL = pick.map(([r, g, b]) => luma(r, g, b)).sort((a, b) => a - b);
const phist = new Array(BUCKETS).fill(0);
for (const l of pickL) phist[Math.min(BUCKETS - 1, Math.floor((l / 256) * BUCKETS))]++;
const pickMed = pickL[Math.floor(pickL.length / 2)];
const below = pickL.filter((l) => l < pickMed).length;
console.log(`\nEra 8 pick: ${pick.length} colours, luma ${Math.round(pickL[0])} to ${Math.round(pickL[pickL.length - 1])}, median ${Math.round(pickMed)}`);
console.log(`pick lightness histogram: ${show(phist)}`);
console.log(`pick split: ${below} below median, ${pick.length - below} above`);

// The subject's own value distribution inside the mask — if the skew matches it, it is honest.
const subj: number[] = [];
for (let i = 0; i < rgb.length; i += 3) subj.push(luma(rgb[i], rgb[i + 1], rgb[i + 2]));
const shist = new Array(BUCKETS).fill(0);
for (const l of subj) shist[Math.min(BUCKETS - 1, Math.floor((l / 256) * BUCKETS))]++;
const subjMed = subj.slice().sort((a, b) => a - b)[Math.floor(subj.length / 2)];
const subjBelow = subj.filter((l) => l < subjMed).length;
console.log(`\nSubject inside the mask: ${shist.reduce((a, b) => a + b, 0)} px, median ${Math.round(subjMed)}`);
console.log(`subject lightness histogram: ${show(shist)}`);
console.log(`subject split: ${subjBelow} below median, ${subj.length - subjBelow} above`);

console.log("\n=== per-era palette rule (src/pixel/types.ts) ===");
console.log("  era  8: hardware-nes  <- greedy pick from the fixed NES set (no k-means)");
console.log("  era 16: rgb555        <- k-means, then snap to 5 bits per channel");
console.log("  era 32: free          <- k-means");
console.log("  era 64: free          <- k-means");
console.log(`\nPick median ${Math.round(pickMed)} vs subject median ${Math.round(subjMed)} — ${Math.abs(pickMed - subjMed) > 15 ? "the pick skews away from the subject's own distribution" : "the pick tracks the subject's distribution"}.`);
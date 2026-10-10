// Why era 8 skews: the NES pick is balanced by COUNT but leaves a HOLE in the value axis.
//   npx tsx bench/nes-hole.ts
//
// bench/nes-budget.ts showed the era 8 pick splits 12 below / 12 above its own median —
// so "greedy pick ignores balance" is WRONG. The real defect is spatial: greedy minimises
// total squared error, so it spends colours where PIXELS ARE DENSE. The subject's lit area
// is small, so it buys very few highlight colours — one colour serving a wide luma band.
// Result: midtones collapse (p50 43) and the highlight is a single blown step (p95 136).
import { buildPalette } from "../src/pixel/palette";
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

// Subject pixel mass per bucket: this is what greedy error minimization is chasing.
const mass = new Array(BUCKETS).fill(0);
for (let i = 0; i < rgb.length; i += 3) mass[bucket(luma(rgb[i], rgb[i + 1], rgb[i + 2]))]++;

// Where each rule actually spends its budget.
const pick = (rule: "hardware-nes" | "free", count: number) =>
  buildPalette({ rgb: new Float32Array(rgb), count, rule, seed: 1 });

const spend = (label: string, pal: [number, number, number][]) => {
  const h = new Array(BUCKETS).fill(0);
  for (const [r, g, b] of pal) h[bucket(luma(r, g, b))]++;
  console.log(`\n${label} (${pal.length} colours)`);
  console.log(`  spent per bucket : ${h.map((n, i) => `${i}:${n}`).join(" ")}`);
  console.log(`  empty buckets    : ${h.filter((n) => n === 0).length}/${BUCKETS}  [${h.map((n, i) => (n === 0 ? i : null)).filter((v): v is number => v !== null).join(",")}]`);
  // A bucket holding >5% of subject mass but zero colours is where the ramp will band.
  const starved = h.map((n, i) => (n === 0 && mass[i] / mass.reduce((a, b) => a + b) > 0.02 ? i : null)).filter((v): v is number => v !== null);
  console.log(`  starved buckets  : ${starved.length ? starved.join(",") + "  <- >2% of subject mass, 0 colours" : "none"}`);
};

console.log(`subject pixel mass per bucket (what greedy minimizes error against):`);
console.log(`  ${mass.map((n, i) => `${i}:${(n / mass.reduce((a, b) => a + b) * 100).toFixed(0)}%`).join(" ")}`);

spend("era  8  hardware-nes, 24", pick("hardware-nes", 24));
spend("era 16  free k-means,  48", pick("free", 48));
spend("era 32  free k-means, 128", pick("free", 128));

console.log("\n=== the mechanism ===");
const total = mass.reduce((a, b) => a + b);
const dense = mass.map((n, i) => ({ i, share: n / total })).filter((m) => m.share > 0.02).map((m) => m.i);
console.log(`Buckets holding >2% of subject mass: ${dense.join(",")}`);
const nesSpend = new Array(BUCKETS).fill(0);
for (const [r, g, b] of pick("hardware-nes", 24)) nesSpend[bucket(luma(r, g, b))]++;
const starved = dense.filter((b) => nesSpend[b] === 0);
console.log(`Of those, era 8 spends ZERO colours on: ${starved.length ? starved.join(",") : "none"}`);
console.log(starved.length
  ? `\nCONFIRMED: era 8 buys no colours for ${starved.length} value bands that carry real pixel mass.\nEvery pixel in those bands snaps to the same nearby colour, so the ramp breaks into slabs\n(highlight blown to one step, midtones crushed) while total colour count still looks healthy.`
  : `\nNOT CONFIRMED at the 2% mass threshold.`);
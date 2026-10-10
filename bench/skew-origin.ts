// Is the era 8 skew created by PALETTE SELECTION, or already present in the IMAGE?
//   npx tsx bench/skew-origin.ts
//
// Rejected so far, each by measurement:
//   - "too few dark colours in the pick"      -> pick is 12/12 by count        (nes-budget)
//   - "a hole in the NES value axis"          -> era 16 has the same holes      (nes-hole)
//   - "chromaWeight 3 starves the ramp"       -> skew identical at w=1 and w=6  (chroma-weight-proof)
//
// The NES palette's own pick is skewed 4-below/7-above at EVERY weight. So either the
// source image really is top-heavy, or something upstream (grade/bloom/dither/resize)
// shifts the histogram before pixels are mapped. This measures the histogram at each
// stage of the real pipeline, so the skew gets attributed to an actual stage.
import { pixelizeSprite } from "../src/pixel/sprite";
import { shadedSubject } from "../src/pixel/modes.fixtures";
import type { Era } from "../src/pixel/types";

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const BUCKETS = 16;
const bucket = (l: number) => Math.min(BUCKETS - 1, Math.floor((l / 256) * BUCKETS));

interface Hist { label: string; hist: number[]; median: number; low: number; high: number; skew: number; occupied: number }

function shape(label: string, ls: number[]): Hist {
  const h = new Array(BUCKETS).fill(0);
  for (const l of ls) h[bucket(l)]++;
  const sorted = [...ls].sort((a, b) => a - b);
  const median = sorted[Math.floor((sorted.length - 1) / 2)] ?? 0;
  const mb = bucket(median);
  const low = h.slice(0, mb + 1).filter((x) => x > 0).length;
  const high = h.slice(mb).filter((x) => x > 0).length;
  return { label, hist: h, median: Math.round(median), low, high, skew: Math.abs(low - high), occupied: h.filter((x) => x > 0).length };
}

const show = (s: Hist) =>
  `${s.label.padEnd(26)} median ${String(s.median).padStart(3)}  ${s.hist.map((n) => (n ? "#" : ".")).join("").padEnd(BUCKETS)}  occ ${String(s.occupied).padStart(2)}/${BUCKETS}  low ${s.low} high ${s.high}  skew ${s.skew}`;

// STAGE 1: the source subject, before any pixelizer code runs.
const src = shadedSubject([128, 128, 128], 200, 240);
const srcLs: number[] = [];
for (let i = 0; i < src.data.length; i += 4) srcLs.push(luma(src.data[i], src.data[i + 1], src.data[i + 2]));
const stages: Hist[] = [shape("source (pre-pixelize)", srcLs)];

// STAGE 2+: the actual sprite output per era, and the same subject through the scene path.
const ERAS_RUN: Era[] = [8, 16, 32, 64];
for (const era of ERAS_RUN) {
  const nat = pixelizeSprite(src, { era, width: 32, seed: 1 }).native;
  const ls: number[] = [];
  for (let i = 0; i < nat.data.length; i += 4) if (nat.data[i + 3] > 0) ls.push(luma(nat.data[i], nat.data[i + 1], nat.data[i + 2]));
  stages.push(shape(`sprite era ${era}`, ls));
}

// Controls: does era 8 skew on a subject that is NOT top-heavy? Same shading, shifted down.
const dim = shadedSubject([128, 128, 128], 200, 240);
for (let i = 0; i < dim.data.length; i += 4) {
  dim.data[i] = Math.max(0, dim.data[i] - 55);
  dim.data[i + 1] = Math.max(0, dim.data[i + 1] - 55);
  dim.data[i + 2] = Math.max(0, dim.data[i + 2] - 55);
}
const dimLs: number[] = [];
for (let i = 0; i < dim.data.length; i += 4) dimLs.push(luma(dim.data[i], dim.data[i + 1], dim.data[i + 2]));
stages.push(shape("source dimmed (-55)", dimLs));
for (const era of [8, 16] as Era[]) {
  const nat = pixelizeSprite(dim, { era, width: 32, seed: 1 }).native;
  const ls: number[] = [];
  for (let i = 0; i < nat.data.length; i += 4) if (nat.data[i + 3] > 0) ls.push(luma(nat.data[i], nat.data[i + 1], nat.data[i + 2]));
  stages.push(shape(`dimmed -> sprite era ${era}`, ls));
}

for (const s of stages) console.log(show(s));

console.log("\n=== verdict ===");
const s8 = stages.find((s) => s.label === "sprite era 8")!;
const s16 = stages.find((s) => s.label === "sprite era 16")!;
const srcS = stages[0];
console.log(`source skew ${srcS.skew} (${srcS.low} low / ${srcS.high} high), era 8 skew ${s8.skew}, era 16 skew ${s16.skew}`);
console.log(s8.skew > s16.skew
  ? `Era 8 is skewed relative to era 16 on the SAME input, so the skew is introduced by the era 8 path,\nnot inherited from the source (source skew ${srcS.skew}).`
  : `Era 8 is not skewed relative to era 16 — the earlier skew reading came from a different mask,\nso re-derive the gate before acting on it.`);
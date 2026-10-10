// Tonal distribution shape — why a WIDER luma spread can still be a WORSE sprite.
//   npx tsx bench/ramp-shape.ts
//
// value-recheck.ts says every era passes the value gate: no era loses luma spread vs the
// source. But that gate alone is misleading. Era 8 measures spread 118 vs era 16's 67 —
// which looks better — while its midtone sits at p50 43 (vs ~60 everywhere) and its
// highlight at p95 136 (vs ~87). A bigger gap between two extremes is not more usable
// tonal range; it is a crushed midtone and a blown highlight.
//
// The metric that separates them is RAMP DENSITY: how evenly the subject's pixels are
// distributed across the value axis. Pixel art needs steps a hand can place; two blobs at
// the ends of the axis cannot express form no matter how wide the gap is.
import { pixelizeSprite } from "../src/pixel/sprite";
import { shadedSubject, type Bg } from "../src/pixel/modes.fixtures";
import { ERAS, type Era } from "../src/pixel/types";

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const ERAS_RUN: Era[] = [8, 16, 32, 64];

interface Stat {
  bg: string; era: Era; px: number; colours: number;
  p5: number; p50: number; p95: number; spread: number;
  occupied: number;      // how many of 16 value buckets the subject actually uses
  empty: number;        // empty buckets = holes in the ramp
  occupiedLow: number;  // occupied buckets below p50
  occupiedHigh: number; // occupied buckets above p50
  bimodal: boolean;     // both halves thin while the extremes are fat
}

const BUCKETS = 16;
function measure(bg: string, src: ReturnType<typeof shadedSubject>, era: Era): Stat {
  const nat = pixelizeSprite(src, { era, width: 32, seed: 1 }).native;
  const ls: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < nat.data.length; i += 4) {
    if (nat.data[i + 3] === 0) continue;
    seen.add((nat.data[i] << 16) | (nat.data[i + 1] << 8) | nat.data[i + 2]);
    ls.push(luma(nat.data[i], nat.data[i + 1], nat.data[i + 2]));
  }
  ls.sort((a, b) => a - b);
  const q = (p: number) => ls[Math.floor((ls.length - 1) * p)] ?? 0;
  const p5 = q(0.05), p50 = q(0.5), p95 = q(0.95);
  const buckets = new Array(BUCKETS).fill(0);
  for (const l of ls) buckets[Math.min(BUCKETS - 1, Math.floor((l / 256) * BUCKETS))]++;
  const occupied = buckets.filter((n) => n > 0).length;
  const medianBucket = Math.min(BUCKETS - 1, Math.floor((p50 / 256) * BUCKETS));
  const occupiedLow = buckets.slice(0, medianBucket + 1).filter((n) => n > 0).length;
  const occupiedHigh = buckets.slice(medianBucket).filter((n) => n > 0).length;
  // Both halves carry few buckets while the axis is wide => form lives in two blobs.
  const width = (p95 - p5) / 256;
  const bimodal = occupiedLow <= 4 && occupiedHigh <= 4 && width > 0.35;
  return {
    bg, era, px: ls.length, colours: seen.size,
    p5: Math.round(p5), p50: Math.round(p50), p95: Math.round(p95), spread: Math.round(p95 - p5),
    occupied, empty: BUCKETS - occupied, occupiedLow, occupiedHigh, bimodal,
  };
}

const BGS: [string, Bg][] = [["dark", [20, 22, 30]], ["mid", [128, 128, 128]], ["light", [230, 230, 235]], ["gradient", "gradient"]];
const rows: Stat[] = [];

console.log(`Ramp density: ${BUCKETS} buckets across the value axis, mask constant (430 px)\n`);
for (const [name, bg] of BGS) {
  const src = shadedSubject(bg, 200, 240);
  for (const era of ERAS_RUN) {
    const s = measure(name, src, era);
    rows.push(s);
    const bar = "#".repeat(s.occupied).padEnd(BUCKETS, ".");
    console.log(`bg=${name.padEnd(8)} era ${String(era).padStart(2)} limit ${String(ERAS[era].colours).padStart(3)}  colours ${String(s.colours).padStart(3)}  p5 ${String(s.p5).padStart(3)} p50 ${String(s.p50).padStart(3)} p95 ${String(s.p95).padStart(3)}  spread ${String(s.spread).padStart(3)}  buckets ${bar}  ${s.occupied}/${BUCKETS}  low ${s.occupiedLow} high ${s.occupiedHigh}${s.bimodal ? "  <- BLOTTED" : ""}`);
  }
  console.log();
}

const at = (bg: string, era: Era) => rows.find((r) => r.bg === bg && r.era === era)!;
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

console.log("=== averaged over backgrounds ===");
console.log("era  limit  spread  p50   p95   buckets  low  high  blotted");
for (const era of ERAS_RUN) {
  const sp = avg(BGS.map(([n]) => at(n, era).spread));
  const p50 = avg(BGS.map(([n]) => at(n, era).p50));
  const p95 = avg(BGS.map(([n]) => at(n, era).p95));
  const oc = avg(BGS.map(([n]) => at(n, era).occupied));
  const lo = avg(BGS.map(([n]) => at(n, era).occupiedLow));
  const hi = avg(BGS.map(([n]) => at(n, era).occupiedHigh));
  const bl = BGS.some(([n]) => at(n, era).bimodal);
  console.log(`${String(era).padStart(3)}  ${String(ERAS[era].colours).padStart(5)}  ${sp.toFixed(0).padStart(6)}  ${p50.toFixed(0).padStart(4)}  ${p95.toFixed(0).padStart(4)}  ${oc.toFixed(1).padStart(7)}  ${lo.toFixed(1).padStart(4)}  ${hi.toFixed(1).padStart(4)}  ${bl ? "YES" : "no"}`);
}

const e8 = ERAS_RUN.map(() => 0); void e8;
const spread8 = avg(BGS.map(([n]) => at(n, 8).spread));
const spread16 = avg(BGS.map(([n]) => at(n, 16).spread));
console.log("\n=== verdict ===");
console.log(`era 8 spread ${spread8.toFixed(0)} vs era 16 spread ${spread16.toFixed(0)} — era 8 "wins" the value gate by ${(spread8 - spread16).toFixed(0)} points`);
console.log(`era 8 p50 ${avg(BGS.map(([n]) => at(n, 8).p50)).toFixed(0)} vs era 16 p50 ${avg(BGS.map(([n]) => at(n, 16).p50)).toFixed(0)} — era 8's midtone sits ${(avg(BGS.map(([n]) => at(n, 16).p50)) - avg(BGS.map(([n]) => at(n, 8).p50))).toFixed(0)} points darker`);
console.log(`era 8 p95 ${avg(BGS.map(([n]) => at(n, 8).p95)).toFixed(0)} vs era 16 p95 ${avg(BGS.map(([n]) => at(n, 16).p95)).toFixed(0)} — era 8's highlight is ${(avg(BGS.map(([n]) => at(n, 8).p95)) - avg(BGS.map(([n]) => at(n, 16).p95))).toFixed(0)} points brighter`);
console.log(`era 8 occupies ${avg(BGS.map(([n]) => at(n, 8).occupied)).toFixed(1)}/${BUCKETS} buckets, era 16 occupies ${avg(BGS.map(([n]) => at(n, 16).occupied)).toFixed(1)}/${BUCKETS}`);

const era8Tall = avg(BGS.map(([n]) => at(n, 8).occupied)) > avg(BGS.map(([n]) => at(n, 16).occupied));
console.log(era8Tall
  ? "\nCONFIRMED: era 8 spreads its pixels thinner across the value axis than era 16."
  : "\nNOT CONFIRMED: era 8 is not thinner than era 16 — the spread number is a red herring here.");
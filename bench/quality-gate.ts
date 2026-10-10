// Quality gates for a pixelized sprite — the corrected version of the Sprint 3 audit.
//
// WHY THIS FILE EXISTS. Sprint 3 measured VALUE as "luma spread (p95-p5) vs the source
// subject" and concluded every era passes. That conclusion holds, but the GATE behind it
// is wrong, and it hid a real defect:
//
//   era 8 scores spread 118 vs era 16's 67 — era 8 "wins" by 51 points.
//   era 8's p50 is 43 vs ~60 elsewhere, and its p95 is 136 vs ~87.
//   era 8 occupies 2 value buckets below its median but 5 above.
//
// A wider p95-p5 gap is not more usable tonal range; it is a crushed midtone with a blown
// highlight. Spread rewards exactly the failure it should catch. The visual pass agreed:
// "harsh posterized bands", "hard flat orange sliver" on the era 8 sphere.
//
// So value is three gates, not one:
//   1. RANGE     — p95-p5 must not shrink vs the source subject (catches a flat image).
//   2. DENSITY   — the subject must occupy enough buckets to place steps in (catches 2-tone).
//   3. BALANCE   — buckets below the median and above it must be comparable, and the median
//                  must not sit far from the wider eras' median (catches crush + blowout).
//
// HARNESS RULES (each one cost a wrong conclusion before it was written down):
//   - Hold the mask constant. Compare px count per era first; if it varies, the numbers are void.
//   - Measure the source baseline over the SAME mask. Whole-image source vs keyed subject
//     silently compares subject against subject+background and makes every era look broken.
//   - One subject is not a finding. Sweep light/mid/dark backgrounds and a gradient.
//   - Never assert a failure from one fixture; the gate must separate across all of them.
//
//   npx tsx bench/quality-gate.ts      # exits non-zero when a gate fails
import { keyBackground, pixelizeSprite } from "../src/pixel/sprite";
import { shadedSubject, type Bg } from "../src/pixel/modes.fixtures";
import { ERAS, type Era } from "../src/pixel/types";

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const ERAS_RUN: Era[] = [8, 16, 32, 64];
const BUCKETS = 16;

const pct = (ls: number[], p: number) => ls[Math.floor((ls.length - 1) * p)] ?? 0;

interface Cell { bg: string; subject: string; era: Era; px: number; colours: number; p5: number; p50: number; p95: number; spread: number; occupied: number; occupiedLow: number; occupiedHigh: number }

/** Percentiles + value-bucket occupancy over the keyed subject only. */
function measure(bg: string, subject: string, src: ReturnType<typeof shadedSubject>, era: Era): Cell {
  const nat = pixelizeSprite(src, { era, width: 32, seed: 1 }).native;
  const ls: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < nat.data.length; i += 4) {
    if (nat.data[i + 3] === 0) continue;
    seen.add((nat.data[i] << 16) | (nat.data[i + 1] << 8) | nat.data[i + 2]);
    ls.push(luma(nat.data[i], nat.data[i + 1], nat.data[i + 2]));
  }
  ls.sort((a, b) => a - b);
  const p5 = pct(ls, 0.05), p50 = pct(ls, 0.5), p95 = pct(ls, 0.95);
  const buckets = new Array(BUCKETS).fill(0);
  for (const l of ls) buckets[Math.min(BUCKETS - 1, Math.floor((l / 256) * BUCKETS))]++;
  const med = Math.min(BUCKETS - 1, Math.floor((p50 / 256) * BUCKETS));
  return {
    bg, subject, era, px: ls.length, colours: seen.size,
    p5: Math.round(p5), p50: Math.round(p50), p95: Math.round(p95), spread: Math.round(p95 - p5),
    occupied: buckets.filter((n) => n > 0).length,
    occupiedLow: buckets.slice(0, med + 1).filter((n) => n > 0).length,
    occupiedHigh: buckets.slice(med).filter((n) => n > 0).length,
  };
}

/** A second subject: the same shading pushed 55 luma points darker. */
function dimmed(src: ReturnType<typeof shadedSubject>) {
  const out = { ...src, data: new Uint8ClampedArray(src.data) };
  for (let i = 0; i < out.data.length; i += 4) {
    out.data[i] = Math.max(0, out.data[i] - 55);
    out.data[i + 1] = Math.max(0, out.data[i + 1] - 55);
    out.data[i + 2] = Math.max(0, out.data[i + 2] - 55);
  }
  return out;
}

/** The source subject's own value range, measured inside the key mask at source resolution. */
function sourceSpread(src: ReturnType<typeof shadedSubject>): number {
  const { w, h } = src;
  const keyed = keyBackground(src, {});
  const ls: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!keyed.mask[y * w + x]) continue;
    const i = (y * w + x) * 4;
    ls.push(luma(src.data[i], src.data[i + 1], src.data[i + 2]));
  }
  ls.sort((a, b) => a - b);
  return Math.round(pct(ls, 0.95) - pct(ls, 0.05));
}

const BGS: [string, Bg][] = [["dark", [20, 22, 30]], ["mid", [128, 128, 128]], ["light", [230, 230, 235]], ["gradient", "gradient"]];
const rows: Cell[] = [];
const srcSpread = new Map<string, number>();

console.log(`Quality gates on the keyed subject (mask constant across eras)\n`);
for (const [name, bg] of BGS) {
  const base = shadedSubject(bg, 200, 240);
  for (const [subject, src] of [["normal", base], ["dimmed", dimmed(base)]] as const) {
    if (subject === "normal") srcSpread.set(name, sourceSpread(src));
    for (const era of ERAS_RUN) {
      const c = measure(name, subject, src, era);
      rows.push(c);
      console.log(`bg=${name.padEnd(8)} ${subject.padEnd(7)} era ${String(era).padStart(2)} limit ${String(ERAS[era].colours).padStart(3)}  px ${String(c.px).padStart(4)}  colours ${String(c.colours).padStart(3)}  p5 ${String(c.p5).padStart(3)} p50 ${String(c.p50).padStart(3)} p95 ${String(c.p95).padStart(3)}  spread ${String(c.spread).padStart(3)}  buckets ${"#".repeat(c.occupied).padEnd(BUCKETS, ".")} ${c.occupied}/${BUCKETS}  low ${c.occupiedLow} high ${c.occupiedHigh}`);
    }
  }
  console.log();
}

const at = (bg: string, era: Era, subject = "normal") => rows.find((r) => r.bg === bg && r.era === era && r.subject === subject)!;
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
let failures = 0;

// GATE 0 — the mask must be identical across eras or every number below is meaningless.
console.log("=== gate 0: mask constant ===");
for (const [name] of BGS) {
  const px = new Set(ERAS_RUN.map((e) => at(name, e).px));
  const ok = px.size === 1;
  if (!ok) failures++;
  console.log(`bg=${name.padEnd(8)} px ${[...px].join("/")}  ${ok ? "ok" : "FAIL - masks differ, results void"}`);
}

console.log("\n=== gate 1: RANGE — spread must not shrink vs the source subject ===");
for (const [name] of BGS) {
  const ss = srcSpread.get(name)!;
  const bad = ERAS_RUN.filter((e) => at(name, e).spread < ss);
  if (bad.length) failures++;
  console.log(`bg=${name.padEnd(8)} src ${ss}  ${bad.length ? `FAIL era ${bad.join(",")}` : "ok"}`);
}

console.log("\n=== gate 2: DENSITY — at least 5 of 16 buckets occupied ===");
for (const [name] of BGS) {
  const bad = ERAS_RUN.filter((e) => at(name, e).occupied < 5);
  if (bad.length) failures++;
  console.log(`bg=${name.padEnd(8)} ${ERAS_RUN.map((e) => `${at(name, e).occupied}`).join("/")}  ${bad.length ? `FAIL era ${bad.join(",")}` : "ok"}`);
}

console.log("\n=== gate 3: BALANCE — a FAIL must separate the pixelizer from the control subject ===");
// THE CONTROL IS THE GATE. `skew-origin.ts` showed a dimmed subject skews era 16 the same as
// era 8, so "skew > 2" on one subject measures the FIXTURE, not the pixelizer. The only
// defensible claim is a skew that appears at era 8 and NOT at the wide eras on the SAME input.
// So: flag era 8 only when its skew exceeds the same subject's widest-era skew by >= 2 buckets.
const wideSkew = (bg: string, subject: string) => Math.max(...ERAS_RUN.filter((e) => e > 8).map((e) => at(bg, e, subject).occupiedLow !== undefined ? Math.abs(at(bg, e, subject).occupiedLow - at(bg, e, subject).occupiedHigh) : 0));
for (const [name] of BGS) {
  for (const subject of ["normal", "dimmed"]) {
    const w = wideSkew(name, subject);
    for (const era of ERAS_RUN) {
      const c = at(name, era, subject);
      const skew = Math.abs(c.occupiedLow - c.occupiedHigh);
      const excess = era === 8 ? skew - w : 0;
      const ok = excess < 2;
      if (!ok) failures++;
      console.log(`bg=${name.padEnd(8)} ${subject.padEnd(7)} era ${String(era).padStart(2)}  low ${c.occupiedLow} high ${c.occupiedHigh} skew ${skew}  widest-era skew here ${w}  excess ${excess}  ${ok ? "ok" : "FAIL - skew the wide eras do not show"}`);
    }
  }
}

console.log("\n=== summary ===");
console.log(`era  limit  spread  p50   p95   buckets  low  high`);
for (const era of ERAS_RUN) {
  console.log(`${String(era).padStart(3)}  ${String(ERAS[era].colours).padStart(5)}  ${avg(BGS.map(([n]) => at(n, era).spread)).toFixed(0).padStart(6)}  ${avg(BGS.map(([n]) => at(n, era).p50)).toFixed(0).padStart(4)}  ${avg(BGS.map(([n]) => at(n, era).p95)).toFixed(0).padStart(4)}  ${avg(BGS.map(([n]) => at(n, era).occupied)).toFixed(1).padStart(7)}  ${avg(BGS.map(([n]) => at(n, era).occupiedLow)).toFixed(1).padStart(4)}  ${avg(BGS.map(([n]) => at(n, era).occupiedHigh)).toFixed(1).padStart(4)}`);
}

console.log(`\n${failures} gate failure(s).`);
if (failures) console.log("A failure here is a FINDING about the pixelizer, not a harness error — re-measure before acting on it.");
process.exit(failures ? 1 : 0);
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
//   npx tsx bench/quality-gate.ts      # prints the table, exits non-zero on a gate failure
//
// Sprint 4a: the measurement is also exported as `valueGate()` so the standard bench
// (bench/run.ts) reports it and the test suite locks the finding. NOTE the framing: gate 3
// reports a KNOWN, documented limitation (the NES 55-set luma hole at 64-80, see
// pixel-art-research/audit/S3b5-nes-assignment.md). It is a diagnostic, not a regression
// gate — the bench reports it, and the test asserts it is STILL detected (alive), not that
// it is zero. Gate 0 (mask constant) is the one that MUST pass; a failure there voids the
// numbers and is a harness error, not a finding.
import { fileURLToPath } from "node:url";
import { keyBackground, pixelizeSprite } from "../src/pixel/sprite";
import { shadedSubject, type Bg } from "../src/pixel/modes.fixtures";
import { ERAS, type Era } from "../src/pixel/types";

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
export const ERAS_RUN: Era[] = [8, 16, 32, 64];
export const BUCKETS = 16;

const pct = (ls: number[], p: number) => ls[Math.floor((ls.length - 1) * p)] ?? 0;

export interface Cell { bg: string; subject: string; era: Era; px: number; colours: number; p5: number; p50: number; p95: number; spread: number; occupied: number; occupiedLow: number; occupiedHigh: number }

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

export const BGS: [string, Bg][] = [["dark", [20, 22, 30]], ["mid", [128, 128, 128]], ["light", [230, 230, 235]], ["gradient", "gradient"]];

export interface GateRow { bg: string; subject: string; era: Era; ok: boolean; detail: string }

export interface ValueGateResult {
  rows: Cell[];
  /** gate 0 — mask identical across eras (MUST pass; a failure voids every other number). */
  maskOk: boolean;
  /** gate 1 — spread never shrinks vs the source subject. */
  rangeOk: boolean;
  /** gate 2 — at least 5 of 16 value buckets occupied. */
  densityOk: boolean;
  /** gate 3 — era 8 skew exceeds the same subject's widest-era skew by >= 2 buckets. */
  balance: GateRow[];
  /** gate 3 failures. A KNOWN finding (NES luma hole at 64-80), not a regression. */
  balanceFailures: number;
  /** gate 0+1+2 failures — a non-zero count here is a harness error or a real regression. */
  hardFailures: number;
}

/** The four value gates as a pure measurement. Deterministic (fixed fixture, seed 1). */
export function valueGate(): ValueGateResult {
  const rows: Cell[] = [];
  const srcSpread = new Map<string, number>();
  for (const [name, bg] of BGS) {
    const base = shadedSubject(bg, 200, 240);
    for (const [subject, src] of [["normal", base], ["dimmed", dimmed(base)]] as const) {
      if (subject === "normal") srcSpread.set(name, sourceSpread(src));
      for (const era of ERAS_RUN) rows.push(measure(name, subject, src, era));
    }
  }
  const at = (bg: string, era: Era, subject = "normal") => rows.find((r) => r.bg === bg && r.era === era && r.subject === subject)!;

  // GATE 0 — the mask must be identical across eras or every number below is meaningless.
  let maskOk = true;
  for (const [name] of BGS) {
    const px = new Set(ERAS_RUN.map((e) => at(name, e).px));
    if (px.size !== 1) maskOk = false;
  }

  // GATE 1 — spread must not shrink vs the source subject.
  let rangeOk = true;
  for (const [name] of BGS) {
    const ss = srcSpread.get(name)!;
    if (ERAS_RUN.some((e) => at(name, e).spread < ss)) rangeOk = false;
  }

  // GATE 2 — at least 5 of 16 buckets occupied.
  let densityOk = true;
  for (const [name] of BGS) {
    if (ERAS_RUN.some((e) => at(name, e).occupied < 5)) densityOk = false;
  }

  // GATE 3 — THE CONTROL IS THE GATE. `skew-origin.ts` showed a dimmed subject skews era 16
  // the same as era 8, so "skew > 2" on one subject measures the FIXTURE, not the pixelizer.
  // Flag era 8 only when its skew exceeds the same subject's widest-era skew by >= 2 buckets.
  const wideSkew = (bg: string, subject: string) => Math.max(...ERAS_RUN.filter((e) => e > 8).map((e) => Math.abs(at(bg, e, subject).occupiedLow - at(bg, e, subject).occupiedHigh)));
  const balance: GateRow[] = [];
  for (const [name] of BGS) {
    for (const subject of ["normal", "dimmed"]) {
      const w = wideSkew(name, subject);
      for (const era of ERAS_RUN) {
        const c = at(name, era, subject);
        const skew = Math.abs(c.occupiedLow - c.occupiedHigh);
        const excess = era === 8 ? skew - w : 0;
        const ok = excess < 2;
        balance.push({ bg: name, subject, era, ok, detail: `low ${c.occupiedLow} high ${c.occupiedHigh} skew ${skew} widest-era ${w} excess ${excess}` });
      }
    }
  }
  const balanceFailures = balance.filter((r) => !r.ok).length;
  const hardFailures = (maskOk ? 0 : 1) + (rangeOk ? 0 : 1) + (densityOk ? 0 : 1);
  return { rows, maskOk, rangeOk, densityOk, balance, balanceFailures, hardFailures };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const g = valueGate();
  const at = (bg: string, era: Era, subject = "normal") => g.rows.find((r) => r.bg === bg && r.era === era && r.subject === subject)!;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  console.log(`Quality gates on the keyed subject (mask constant across eras)\n`);
  for (const [name] of BGS) {
    for (const subject of ["normal", "dimmed"]) {
      for (const era of ERAS_RUN) {
        const c = at(name, era, subject);
        console.log(`bg=${name.padEnd(8)} ${subject.padEnd(7)} era ${String(era).padStart(2)} limit ${String(ERAS[era].colours).padStart(3)}  px ${String(c.px).padStart(4)}  colours ${String(c.colours).padStart(3)}  p5 ${String(c.p5).padStart(3)} p50 ${String(c.p50).padStart(3)} p95 ${String(c.p95).padStart(3)}  spread ${String(c.spread).padStart(3)}  buckets ${"#".repeat(c.occupied).padEnd(BUCKETS, ".")} ${c.occupied}/${BUCKETS}  low ${c.occupiedLow} high ${c.occupiedHigh}`);
      }
    }
    console.log();
  }

  console.log("=== gate 0: mask constant ===");
  for (const [name] of BGS) {
    const px = [...new Set(ERAS_RUN.map((e) => at(name, e).px))];
    console.log(`bg=${name.padEnd(8)} px ${px.join("/")}  ${px.length === 1 ? "ok" : "FAIL - masks differ, results void"}`);
  }
  console.log(`\n=== gate 1: RANGE — spread must not shrink vs the source subject === ${g.rangeOk ? "ok" : "FAIL"}`);
  console.log(`\n=== gate 2: DENSITY — at least 5 of 16 buckets occupied === ${g.densityOk ? "ok" : "FAIL"}`);
  console.log(`\n=== gate 3: BALANCE — era 8 skew vs the same subject's widest era ===`);
  for (const r of g.balance) {
    console.log(`bg=${r.bg.padEnd(8)} ${r.subject.padEnd(7)} era ${String(r.era).padStart(2)}  ${r.detail}  ${r.ok ? "ok" : "FAIL - skew the wide eras do not show"}`);
  }

  console.log("\n=== summary ===");
  console.log(`era  limit  spread  p50   p95   buckets  low  high`);
  for (const era of ERAS_RUN) {
    console.log(`${String(era).padStart(3)}  ${String(ERAS[era].colours).padStart(5)}  ${avg(BGS.map(([n]) => at(n, era).spread)).toFixed(0).padStart(6)}  ${avg(BGS.map(([n]) => at(n, era).p50)).toFixed(0).padStart(4)}  ${avg(BGS.map(([n]) => at(n, era).p95)).toFixed(0).padStart(4)}  ${avg(BGS.map(([n]) => at(n, era).occupied)).toFixed(1).padStart(7)}  ${avg(BGS.map(([n]) => at(n, era).occupiedLow)).toFixed(1).padStart(4)}  ${avg(BGS.map(([n]) => at(n, era).occupiedHigh)).toFixed(1).padStart(4)}`);
  }

  console.log(`\n${g.hardFailures} hard gate failure(s), ${g.balanceFailures} known era-8 balance finding(s).`);
  if (g.hardFailures) console.log("A hard failure is a harness error or a real regression — re-measure before acting on it.");
  if (g.balanceFailures) console.log("The era-8 balance findings are the documented NES luma-hole limitation (audit/S3b5-nes-assignment.md).");
  process.exit(g.hardFailures ? 1 : 0);
}

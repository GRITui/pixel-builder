import { describe, expect, it } from "vitest";
import { bench } from "./run";
import { valueGate } from "./quality-gate";
import { samples } from "./samples";

describe("bench (reduced)", () => {
  it("has 8 synthetic samples", () => expect(samples()).toHaveLength(8));
  it("every run validates within its era limit; looks lock palettes", () => {
    const r = bench({ full: false });
    expect(r.rows.filter((x) => !x.ok || x.colours > x.limit)).toEqual([]);
    expect(r.lock.every((x) => x.identical)).toBe(true);
    expect(r.fx.ok).toBe(true);
  }, 180_000);
});

describe("value gates (full-matrix scoring, S3b + S3b.5)", () => {
  // The documented finding, locked as a regression net for the HARNESS (not the defect):
  //  - gate 0 (mask constant), gate 1 (range), gate 2 (density) must PASS — a failure there
  //    is a harness error or a real pipeline regression, and the audit's numbers are void.
  //  - gate 3 (balance) must keep DETECTING the era-8 skew — the NES 55-set has one colour
  //    in the luma 64-80 band (audit/S3b5-nes-assignment.md), so the finding is alive by
  //    design. If this expectation fails, either the fixture changed or the defect is gone;
  //    both need a human look before updating these numbers.
  it("hard gates pass: mask constant, range never shrinks, density >= 5 buckets", () => {
    const g = valueGate();
    expect(g.maskOk).toBe(true);
    expect(g.rangeOk).toBe(true);
    expect(g.densityOk).toBe(true);
    expect(g.hardFailures).toBe(0);
  }, 300_000);

  it("gate 3 keeps detecting the era-8 balance skew (known NES luma-hole finding)", () => {
    const g = valueGate();
    const era8 = g.balance.filter((r) => r.era === 8 && r.subject === "normal");
    expect(era8.length).toBe(4); // one per background: dark/mid/light/gradient
    expect(era8.every((r) => !r.ok)).toBe(true); // all four still flagged
    // the dimmed CONTROL still passes — the finding belongs to the pixelizer, not the fixture
    const dimmedEra8 = g.balance.filter((r) => r.era === 8 && r.subject === "dimmed");
    expect(dimmedEra8.every((r) => r.ok)).toBe(true);
    expect(g.balanceFailures).toBe(4);
  }, 300_000);

  it("era 8 summary matches the audit numbers (spread 118, p50 43, p95 136)", () => {
    const g = valueGate();
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const e8 = [8].map((era) => ({
      spread: avg(g.rows.filter((r) => r.era === era && r.subject === "normal").map((r) => r.spread)),
      p50: avg(g.rows.filter((r) => r.era === era && r.subject === "normal").map((r) => r.p50)),
      p95: avg(g.rows.filter((r) => r.era === era && r.subject === "normal").map((r) => r.p95)),
    }))[0];
    expect(Math.round(e8.spread)).toBe(118);
    expect(Math.round(e8.p50)).toBe(43);
    expect(Math.round(e8.p95)).toBe(136);
  }, 300_000);
});

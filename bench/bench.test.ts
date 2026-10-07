import { describe, expect, it } from "vitest";
import { bench } from "./run";
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

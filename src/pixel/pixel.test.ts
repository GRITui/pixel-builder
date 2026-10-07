import { describe, expect, it } from "vitest";
import { gradient } from "./fixtures";
import { upscale } from "../io/resize";
import { pixelize } from "./pipeline";
import { validate } from "./validate";

describe("validate", () => {
  it("passes true pixel art and its upscale", () => {
    const r = pixelize(gradient(64, 48), { era: 8, width: 32 });
    expect(validate(r.native, { maxColours: 24 }).ok).toBe(true);
    expect(validate(upscale(r.native, 4), { scale: 4, maxColours: 24 }).ok).toBe(true);
  });
  it("flags partial alpha, too many colours and non-uniform blocks", () => {
    const g = gradient(16, 16);
    const rep = validate(g, { maxColours: 8, scale: 4 });
    expect(rep.ok).toBe(false);
    expect(rep.issues.join(" ")).toMatch(/colours exceeds/);
    expect(rep.issues.join(" ")).toMatch(/not one solid colour/);
    g.data[3] = 100;
    expect(validate(g).issues.join(" ")).toMatch(/partial alpha/);
  });
});

describe("pixelize (placeholder pipeline)", () => {
  it("is deterministic, size-correct and within the era colour budget", () => {
    const a = pixelize(gradient(200, 100), { era: 16, width: 80, seed: 3 });
    const b = pixelize(gradient(200, 100), { era: 16, width: 80, seed: 3 });
    expect([a.native.w, a.native.h]).toEqual([80, 40]);
    expect(a.meta.colours).toBeLessThanOrEqual(48);
    expect([...a.native.data]).toEqual([...b.native.data]);
    expect(validate(a.native, { maxColours: 48 }).ok).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { paletteBudget, projectPalette } from "./cohesion";

const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");
const ramp = (base: number, n: number) => Array.from({ length: n }, (_, i) => hex(base + i));

describe("palette cohesion", () => {
  it("the first asset in a project is solo, not drifting — there is nothing to drift from", () => {
    const b = paletteBudget(ramp(0x20305e, 48), 16, []);
    expect(b.cohesion).toBe("solo");
    expect(b.overlap).toBe(0);
    expect(b.hint).toBe("");
  });

  it("counts distinct colours and compares them to the era limit", () => {
    const b = paletteBudget([...ramp(0x20305e, 40), ...ramp(0x20305e, 8)], 16, []);
    expect(b.colours).toBe(40);
    expect(b.limit).toBe(48);
    expect(b.within_limit).toBe(true);
  });

  it("flags an over-limit palette and says so", () => {
    const b = paletteBudget(ramp(0, 60), 16, []);
    expect(b.within_limit).toBe(false);
    expect(b.hint).toMatch(/exceeds the 16-bit limit of 48/);
  });

  it("bands overlap into tight / partial / drifting", () => {
    const base = ramp(0x20305e, 20);
    expect(paletteBudget(base, 16, [base]).cohesion).toBe("tight");
    expect(paletteBudget([...base.slice(0, 10), ...ramp(0x804020, 10)], 16, [base]).cohesion).toBe("partial");
    expect(paletteBudget(ramp(0x804020, 20), 16, [base]).cohesion).toBe("drifting");
  });

  it("a drifting palette gets an actionable hint that names the fix", () => {
    const b = paletteBudget(ramp(0x804020, 20), 16, [ramp(0x20305e, 20)]);
    expect(b.cohesion).toBe("drifting");
    expect(b.hint).toMatch(/looks action=save/);
    expect(b.hint).toMatch(/look=</);
    expect(b.shared).toBe(0);
    expect(b.overlap).toBe(0);
  });

  it("a partial palette says how much is shared", () => {
    const base = ramp(0x20305e, 20);
    // 9 of 20 shared = 45% overlap, inside the partial band
    const b = paletteBudget([...base.slice(0, 9), ...ramp(0x804020, 11)], 16, [base]);
    expect(b.cohesion).toBe("partial");
    expect(b.shared).toBe(9);
    expect(b.overlap).toBeCloseTo(0.45, 5);
    expect(b.hint).toMatch(/45%/);
  });

  it("treats hex case-insensitively so #ABCDEF and #abcdef are one colour", () => {
    const b = paletteBudget(["#ABCDEF", "#123456"], 16, [["#abcdef"]]);
    expect(b.colours).toBe(2);
    expect(b.shared).toBe(1);
    expect(b.overlap).toBe(0.5);
  });

  it("projectPalette unions every other result and de-dupes", () => {
    expect([...projectPalette([["#111111", "#222222"], ["#222222", "#333333"]])].sort()).toEqual([
      "#111111", "#222222", "#333333",
    ]);
  });
});
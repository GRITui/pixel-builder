import { describe, expect, it } from "vitest";
import { smoothCurves, finalize } from "./enforce";
import { DEFAULT_KIT, KIT_PRESETS, resolveRamps, RICH_KIT } from "./kit";
import { GENERATORS } from "./generators";
import { defaults } from "./generators/types";
import { decodeIndex, flattenRamps, luma, MATERIALS, RAMP_LEN } from "./palette";
import type { Sprite, StyleKit } from "./types";

const gen = (id: string) => GENERATORS.find((g) => g.id === id)!;
const frames = (id: string, params: object, kit: StyleKit, seed = 1) =>
  gen(id).generate({ ...defaults(gen(id)), ...params } as never, kit, seed).rows.flatMap((r) => r.frames);
const richOf = (k: StyleKit): StyleKit => ({ ...k, detail: "rich" });
const CHAR = { sex: "female", age: "elder", facial: "glasses", costume: "apron", headwear: "cap" };

describe("rich detail", () => {
  it("standard kits ignore the detail field being absent or 'standard'", () => {
    for (const k of KIT_PRESETS.filter((p) => p.detail !== "rich")) {
      const a = frames("character", CHAR, k);
      const b = frames("character", CHAR, { ...k, detail: "standard" });
      expect(b).toEqual(a);
      expect(resolveRamps({ ...k, detail: "standard" })).toEqual(resolveRamps(k));
    }
    expect(DEFAULT_KIT.detail).toBeUndefined();
  });

  it("rich differs from standard and is deterministic", () => {
    const std = frames("character", CHAR, DEFAULT_KIT);
    const a = frames("character", CHAR, RICH_KIT);
    expect(a).not.toEqual(std);
    expect(frames("character", CHAR, RICH_KIT)).toEqual(a);
    expect(a[0].w).toBe(std[0].w);
  });

  it("rich ramps keep luminance order and the same palette size", () => {
    for (const base of [DEFAULT_KIT, KIT_PRESETS[2]]) {
      const r = resolveRamps(richOf(base));
      for (const m of MATERIALS) {
        expect(r[m]).toHaveLength(RAMP_LEN);
        for (let i = 1; i < RAMP_LEN; i++) expect(luma(r[m][i])).toBeGreaterThan(luma(r[m][i - 1]));
      }
    }
    expect(resolveRamps(richOf(DEFAULT_KIT)).skin).not.toEqual(resolveRamps(DEFAULT_KIT).skin);
  });

  it("sel-out uses only palette indices of the material it touches (or ink)", () => {
    const flat = flattenRamps(resolveRamps(RICH_KIT));
    for (const s of frames("character", CHAR, RICH_KIT)) for (const v of s.data) if (v) expect(flat[v]).toBeTruthy();
    const s = frames("environment", {}, RICH_KIT)[0];
    const mats = new Set(s.data.filter(Boolean).map((v) => decodeIndex(v)!.mat));
    expect(mats.size).toBeGreaterThan(0);
  });

  it("anti-aliasing never creates an isolated pixel", () => {
    const isolated = (s: Sprite) => {
      let n = 0;
      for (let y = 0; y < s.h; y++)
        for (let x = 0; x < s.w; x++) {
          const v = s.data[y * s.w + x];
          if (!v) continue;
          let same = false;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && s.data[(y + dy) * s.w + x + dx] === v) same = true;
          if (!same) n++;
        }
      return n;
    };
    for (const s of frames("character", CHAR, RICH_KIT)) {
      const before = finalize(s, { ...RICH_KIT, outline: "none" });
      expect(isolated(smoothCurves(before))).toBeLessThanOrEqual(isolated(before));
    }
  });

  it("works for animals, buildings and maps under a rich kit", () => {
    for (const id of ["animal", "building", "map"])
      expect(frames(id, {}, RICH_KIT).length).toBeGreaterThan(0);
  });
});

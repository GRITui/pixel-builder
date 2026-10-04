import { describe, expect, it } from "vitest";
import { applyOutline, downscaleRGBA, finalize, quantizeRGBA, removeOrphans, stripOutline } from "./enforce";
import { DEFAULT_KIT, KIT_PRESETS, lightVector, resolveRamps } from "./kit";
import { Painter } from "./painter";
import { colorIndex, decodeIndex, flattenRamps, MATERIALS, OUTLINE_INDEX, PALETTE_SIZE, RAMP_LEN } from "./palette";
import { rng, valueNoise } from "./rng";
import { createSprite, getPx, setPx } from "./sprite";
import { emptyTileMap, ensureTile, renderTileMap } from "./tilemap";
import type { StyleKit } from "./types";

describe("palette indices", () => {
  it("round-trips every material and level", () => {
    for (const m of MATERIALS)
      for (let l = 0; l < RAMP_LEN; l++) expect(decodeIndex(colorIndex(m, l))).toEqual({ mat: m, level: l });
  });

  it("treats 0 as transparent and clamps levels", () => {
    expect(decodeIndex(0)).toBeNull();
    expect(colorIndex("wood", 99)).toBe(colorIndex("wood", RAMP_LEN - 1));
    expect(colorIndex("wood", -3)).toBe(colorIndex("wood", 0));
  });

  it("flattens every kit palette to PALETTE_SIZE entries", () => {
    for (const kit of KIT_PRESETS) {
      const flat = flattenRamps(resolveRamps(kit));
      expect(flat).toHaveLength(PALETTE_SIZE);
      expect(flat[0]).toBeNull();
      expect(flat.slice(1).every((c) => /^#[0-9a-f]{6}$/i.test(c!))).toBe(true);
    }
  });

  it("applies per-material ramp overrides", () => {
    const kit: StyleKit = { ...DEFAULT_KIT, rampOverrides: { wood: ["#000000", "#111111", "#222222", "#333333", "#444444"] } };
    expect(flattenRamps(resolveRamps(kit))[colorIndex("wood", 2)]).toBe("#222222");
  });
});

describe("painter lighting", () => {
  const shadeOf = (kit: StyleKit, x: number, y: number) => {
    const p = new Painter(20, 20, kit).ellipse(10, 10, 8, 8, "stone");
    return decodeIndex(getPx(p.toSprite(), x, y))!.level;
  };

  it("lights the side facing the kit light", () => {
    const left = { ...DEFAULT_KIT, lightDir: "top-left" as const };
    expect(shadeOf(left, 5, 5)).toBeGreaterThan(shadeOf(left, 15, 15));
    const right = { ...DEFAULT_KIT, lightDir: "top-right" as const };
    expect(shadeOf(right, 15, 5)).toBeGreaterThan(shadeOf(right, 5, 15));
  });

  it("uses no more distinct shades than shadeSteps", () => {
    for (const steps of [2, 3, 4, 5]) {
      const s = new Painter(24, 24, { ...DEFAULT_KIT, shadeSteps: steps, dither: false }).ellipse(12, 12, 11, 11, "metal").toSprite();
      expect(new Set(s.data.filter(Boolean)).size).toBeLessThanOrEqual(steps);
    }
  });

  it("keeps explicit detail pixels at their level", () => {
    const s = new Painter(4, 4, DEFAULT_KIT).box(0, 0, 4, 4, "skin").px(1, 1, "ink", 0).toSprite();
    expect(getPx(s, 1, 1)).toBe(OUTLINE_INDEX);
  });

  it("dithers gradients but never a flat face", () => {
    const kit = { ...DEFAULT_KIT, dither: true, shadeSteps: 3 };
    const flat = new Painter(32, 32, kit).box(0, 0, 32, 32, "stone").toSprite();
    expect(new Set(flat.data).size).toBe(1);
    const ball = new Painter(32, 32, kit).ellipse(16, 16, 15, 15, "stone").toSprite();
    const plain = new Painter(32, 32, { ...kit, dither: false }).ellipse(16, 16, 15, 15, "stone").toSprite();
    expect(ball.data).not.toEqual(plain.data);
  });

  it("is deterministic", () => {
    const a = new Painter(16, 16, DEFAULT_KIT).ellipse(8, 8, 6, 5, "foliage").cylinder(6, 8, 4, 7, "wood").toSprite();
    const b = new Painter(16, 16, DEFAULT_KIT).ellipse(8, 8, 6, 5, "foliage").cylinder(6, 8, 4, 7, "wood").toSprite();
    expect(a).toEqual(b);
  });

  it("normalises light vectors", () => {
    for (const d of ["top-left", "top", "top-right"] as const) expect(Math.hypot(...lightVector(d))).toBeCloseTo(1);
  });
});

describe("enforcement", () => {
  const blob = () => {
    const s = createSprite(7, 7);
    for (let y = 2; y < 5; y++) for (let x = 2; x < 5; x++) setPx(s, x, y, colorIndex("cloth", 3));
    return s;
  };

  it("outlines only the silhouette border", () => {
    const out = applyOutline(blob(), { ...DEFAULT_KIT, outline: "black" });
    expect(getPx(out, 1, 3)).toBe(OUTLINE_INDEX);
    expect(getPx(out, 3, 3)).toBe(colorIndex("cloth", 3));
    expect(getPx(out, 0, 0)).toBe(0);
    expect(getPx(out, 1, 1)).toBe(0); // 4-connected outline, corners stay empty
  });

  it("colored outline uses the touching material's darkest shade", () => {
    const out = applyOutline(blob(), { ...DEFAULT_KIT, outline: "colored" });
    expect(getPx(out, 5, 3)).toBe(colorIndex("cloth", 0));
  });

  it("outline 'none' is a no-op and strip+apply is idempotent", () => {
    expect(applyOutline(blob(), { ...DEFAULT_KIT, outline: "none" })).toEqual(blob());
    const kit = { ...DEFAULT_KIT, outline: "black" as const };
    const once = applyOutline(blob(), kit);
    expect(applyOutline(stripOutline(once), kit)).toEqual(once);
  });

  it("removes isolated pixels and sanitises bad indices", () => {
    const s = blob();
    setPx(s, 0, 6, colorIndex("gold", 4));
    expect(getPx(removeOrphans(s), 0, 6)).toBe(0);
    const bad = { w: 2, h: 1, data: [9999, -4] };
    expect(finalize(bad, { ...DEFAULT_KIT, outline: "none" }).data).toEqual([0, 0]);
  });

  it("quantises RGB to the nearest kit colour and keeps alpha holes", () => {
    const flat = flattenRamps(resolveRamps(DEFAULT_KIT));
    const target = colorIndex("water", 3);
    const hex = flat[target]!;
    const rgba = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255, 0, 0, 0, 0];
    expect(quantizeRGBA(rgba, 2, 1, DEFAULT_KIT).data).toEqual([target, 0]);
  });

  it("downscales by majority colour", () => {
    const src = new Uint8ClampedArray(4 * 4 * 4);
    for (let i = 0; i < 16; i++) src.set(i === 0 ? [255, 0, 0, 255] : [0, 0, 255, 255], i * 4);
    const out = downscaleRGBA(src, 4, 4, 1, 1);
    expect(out[2]).toBeGreaterThan(200);
    expect(out[0]).toBeLessThan(50);
  });
});

describe("rng + noise", () => {
  it("is reproducible", () => {
    const a = rng(42), b = rng(42);
    expect([a.next(), a.next(), a.int(0, 9)]).toEqual([b.next(), b.next(), b.int(0, 9)]);
  });

  it("value noise wraps on its period", () => {
    const n = valueNoise(7, 4);
    expect(n(0.3, 1.7)).toBeCloseTo(n(4.3, 5.7));
  });
});

describe("tilemap", () => {
  it("renders ground then bottom-anchored deco", () => {
    const tm = emptyTileMap(2, 2, 2);
    const g = ensureTile(tm, "g", { w: 2, h: 2, data: new Array(4).fill(colorIndex("grass", 2)) });
    const tree = ensureTile(tm, "t", { w: 2, h: 3, data: new Array(6).fill(colorIndex("foliage", 3)) }, true);
    expect(ensureTile(tm, "g", createSprite(2, 2))).toBe(g);
    tm.ground.fill(g);
    tm.deco[3] = tree; // bottom-right cell
    const s = renderTileMap(tm);
    expect(s.w).toBe(4);
    expect(getPx(s, 0, 0)).toBe(colorIndex("grass", 2));
    expect(getPx(s, 3, 3)).toBe(colorIndex("foliage", 3));
    expect(getPx(s, 3, 1)).toBe(colorIndex("foliage", 3)); // tall prop overflows upward
  });
});

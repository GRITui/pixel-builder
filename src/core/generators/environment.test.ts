import { describe, expect, it } from "vitest";
import { KIT_PRESETS } from "../kit";
import { decodeIndex } from "../palette";
import { bounds, getPx } from "../sprite";
import type { Sprite } from "../types";
import { environmentGenerator, PROP_KINDS, TILE_KINDS } from "./environment";
import { coerceParams, defaults } from "./types";

const gen = (kind: string, kitIdx = 0, seed = 1, extra: Record<string, string | number> = {}) =>
  environmentGenerator.generate({ ...defaults(environmentGenerator), kind, ...extra }, KIT_PRESETS[kitIdx], seed);

/** How many pixels differ between two columns (or rows) of a tile. */
function lineDiff(s: Sprite, a: number, b: number, axis: "x" | "y"): number {
  let n = 0;
  for (let i = 0; i < s.w; i++) {
    const pa = axis === "x" ? getPx(s, a, i) : getPx(s, i, a);
    const pb = axis === "x" ? getPx(s, b, i) : getPx(s, i, b);
    if (pa !== pb) n++;
  }
  return n;
}

describe("environment generator", () => {
  it("keeps the exported kind lists the map and UI rely on", () => {
    expect(TILE_KINDS).toEqual(["grass-tile", "dirt-tile", "sand-tile", "water-tile", "stone-path-tile", "snow-tile"]);
    for (const k of ["oak", "pine", "palm", "dead-tree", "bush", "rock", "boulder", "flowers", "mushroom", "tall-grass", "stump", "crystal"]) expect(PROP_KINDS).toContain(k);
    const kind = environmentGenerator.params.find((p) => p.key === "kind");
    expect(kind && kind.type === "select" && kind.options.length).toBe(PROP_KINDS.length + TILE_KINDS.length);
  });

  it("exposes material params and a variant param", () => {
    const keys = environmentGenerator.params.map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(["kind", "foliage", "trunk", "variant"]));
    expect(environmentGenerator.params.filter((p) => p.type === "material").length).toBeGreaterThanOrEqual(3);
  });

  describe.each(KIT_PRESETS.map((k, i) => [k.id, i] as const))("%s", (_id, kitIdx) => {
    const kit = KIT_PRESETS[kitIdx];

    it.each([...PROP_KINDS])("prop %s is environment-sized, outlined and non-empty", (kind) => {
      const { rows, fps } = gen(kind, kitIdx);
      expect(rows).toHaveLength(1);
      expect(rows[0].frames).toHaveLength(1);
      expect(fps).toBeGreaterThan(0);
      const s = rows[0].frames[0];
      expect(s.w).toBe(kit.sizes.environment);
      expect(s.h).toBe(kit.sizes.environment);
      const b = bounds(s)!;
      expect(b).not.toBeNull();
      expect(b.x1 - b.x0).toBeGreaterThan(kit.sizes.environment / 4);
      expect(b.y1 - b.y0).toBeGreaterThan(kit.sizes.environment / 4);
      // free-standing prop: transparent corners
      for (const [x, y] of [[0, 0], [s.w - 1, 0]]) expect(getPx(s, x, y)).toBe(0);
    });

    it.each([...TILE_KINDS])("tile %s is tile-sized, opaque, ink-free and seamless", (kind) => {
      const { rows } = gen(kind, kitIdx, 3);
      for (const f of rows[0].frames) {
        expect(f.w).toBe(kit.sizes.tile);
        expect(f.h).toBe(kit.sizes.tile);
        for (const v of f.data) {
          expect(v).toBeGreaterThan(0);
          expect(decodeIndex(v)?.mat).not.toBe("ink"); // no outline on ground
        }
        const T = f.w;
        for (const axis of ["x", "y"] as const) {
          let interior = 0;
          for (let i = 0; i < T - 1; i++) interior += lineDiff(f, i, i + 1, axis);
          interior /= T - 1;
          // The wrap-around seam must be no busier than a typical interior neighbour pair. Cobbles are
          // high-frequency (every stone edge differs), so that tile gets more headroom.
          const slack = kind === "stone-path-tile" ? 2.4 : 1.6;
          expect(lineDiff(f, T - 1, 0, axis)).toBeLessThanOrEqual(interior * slack + 2);
        }
      }
    });
  });

  it("animates only the water tile", () => {
    const water = gen("water-tile");
    expect(water.rows[0].frames.length).toBeGreaterThanOrEqual(3);
    expect(water.rows[0].frames.length).toBeLessThanOrEqual(4);
    expect(water.fps).toBeGreaterThanOrEqual(3);
    expect(water.fps).toBeLessThanOrEqual(5);
    expect(water.rows[0].frames[0].data).not.toEqual(water.rows[0].frames[1].data);
    for (const k of TILE_KINDS.filter((k) => k !== "water-tile")) expect(gen(k).rows[0].frames).toHaveLength(1);
  });

  it("is deterministic per seed and varies with seed", () => {
    for (const kind of [...PROP_KINDS, ...TILE_KINDS]) {
      const a = gen(kind, 0, 42), b = gen(kind, 0, 42);
      expect(a).toEqual(b);
    }
    // tiles are noise-driven, so a new seed gives a new texture
    for (const kind of TILE_KINDS) expect(gen(kind, 0, 1).rows[0].frames[0].data).not.toEqual(gen(kind, 0, 2).rows[0].frames[0].data);
  });

  it("variant param changes the art", () => {
    for (const kind of ["oak", "pine", "bush", "boulder", "stump", "flowers", "grass-tile", "dirt-tile"]) {
      const a = gen(kind, 0, 1, { variant: 0 }).rows[0].frames[0].data;
      const b = gen(kind, 0, 1, { variant: 7 }).rows[0].frames[0].data;
      expect(a).not.toEqual(b);
    }
  });

  it("material params re-skin props", () => {
    const base = gen("oak").rows[0].frames[0];
    const skinned = gen("oak", 0, 1, { foliage: "accent" }).rows[0].frames[0];
    expect(skinned.data).not.toEqual(base.data);
    expect(skinned.data.some((v) => decodeIndex(v)?.mat === "accent")).toBe(true);
    expect(base.data.some((v) => decodeIndex(v)?.mat === "accent")).toBe(false);
    const trunk = gen("stump", 0, 1, { trunk: "stone" }).rows[0].frames[0];
    expect(trunk.data.some((v) => decodeIndex(v)?.mat === "stone")).toBe(true);
  });

  it("survives AI-style coerced params", () => {
    const p = coerceParams(environmentGenerator, { kind: "crystal", foliage: "nope", variant: 99 });
    const s = environmentGenerator.generate(p, KIT_PRESETS[0], 5).rows[0].frames[0];
    expect(s.w).toBe(KIT_PRESETS[0].sizes.environment);
  });
});

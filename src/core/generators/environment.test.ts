import { describe, expect, it } from "vitest";
import { KIT_PRESETS, proportions } from "../kit";
import { decodeIndex } from "../palette";
import { bounds, getPx } from "../sprite";
import type { Sprite } from "../types";
import { EXTRA_PROP_KINDS, environmentGenerator, PROP_KINDS, SOIL_TILE_KINDS, TILE_KINDS } from "./environment";
import { FENCE_PIECES } from "./fence";
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
    expect(TILE_KINDS).toEqual(["grass-tile", "dirt-tile", "sand-tile", "water-tile", "stone-path-tile", "snow-tile", "paddy-tile"]);
    for (const k of ["oak", "pine", "palm", "dead-tree", "bush", "rock", "boulder", "flowers", "mushroom", "tall-grass", "stump", "crystal"]) expect(PROP_KINDS).toContain(k);
    const kind = environmentGenerator.params.find((p) => p.key === "kind");
    expect(kind && kind.type === "select" && kind.options.length).toBe(PROP_KINDS.length + EXTRA_PROP_KINDS.length + TILE_KINDS.length + SOIL_TILE_KINDS.length);
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
      expect(rows[0].name).toBe("idle");
      expect(rows[0].frames).toHaveLength(1);
      expect(fps).toBeGreaterThan(0);
      const s = rows[0].frames[0];
      expect(s.w).toBe(kit.sizes.environment);
      expect(s.h).toBe(["oak", "pine", "palm", "dead-tree"].includes(kind) ? proportions(kit).tree + 2 : kit.sizes.environment);
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

  it("trees are about twice a character tall", () => {
    for (let i = 0; i < KIT_PRESETS.length; i++)
      for (const kind of ["oak", "pine", "palm", "dead-tree"]) {
        const s = gen(kind, i).rows[0].frames[0];
        const b = bounds(s)!;
        expect(b.y1 - b.y0 + 1).toBeGreaterThanOrEqual(proportions(KIT_PRESETS[i]).tree * 0.85);
      }
  });

  it("animates only the water and paddy tiles", () => {
    const water = gen("water-tile");
    expect(water.rows[0].frames.length).toBeGreaterThanOrEqual(3);
    expect(water.rows[0].frames.length).toBeLessThanOrEqual(4);
    expect(water.fps).toBeGreaterThanOrEqual(3);
    expect(water.fps).toBeLessThanOrEqual(5);
    expect(water.rows[0].frames[0].data).not.toEqual(water.rows[0].frames[1].data);
    for (const k of TILE_KINDS.filter((k) => k !== "water-tile" && k !== "paddy-tile")) expect(gen(k).rows[0].frames).toHaveLength(1);
  });

  it("paddy-tile is an opaque animated tile with seedlings, and wraps", () => {
    for (let i = 0; i < KIT_PRESETS.length; i++) {
      const kit = KIT_PRESETS[i];
      const { rows, fps } = gen("paddy-tile", i);
      expect(fps).toBeGreaterThanOrEqual(2);
      const frames = rows[0].frames;
      expect(frames.length).toBeGreaterThanOrEqual(3);
      for (const f of frames) {
        expect(f.w).toBe(kit.sizes.tile);
        expect(f.h).toBe(kit.sizes.tile);
        expect(f.data.every((v) => v !== 0)).toBe(true);
        expect(f.data.some((v) => decodeIndex(v)?.mat === "grass")).toBe(true);
      }
      expect(frames[0].data).not.toEqual(frames[1].data);
    }
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

  describe("farming kit", () => {
    const names = (kind: string, extra: Record<string, string | number> = {}) => gen(kind, 0, 1, extra).rows.map((r) => r.name);

    it("gives cuttable trees chop/fall/stump rows and old-oak only sway", () => {
      for (const k of ["oak", "pine", "palm", "dead-tree"]) {
        expect(names(k)).toEqual(["idle", "sway", "chop", "fall", "stump"]);
        const rows = gen(k).rows;
        expect(rows[1].frames).toHaveLength(4);
        expect(rows[3].frames.length).toBeGreaterThanOrEqual(4);
        expect(rows[4].frames).toHaveLength(1);
      }
      const uncut = environmentGenerator.generate({ ...defaults(environmentGenerator), kind: "oak", cuttable: false }, KIT_PRESETS[0], 1);
      expect(uncut.rows.map((r) => r.name)).toEqual(["idle", "sway"]);
      const old = environmentGenerator.generate({ ...defaults(environmentGenerator), kind: "old-oak", cuttable: true }, KIT_PRESETS[0], 1);
      expect(old.rows.map((r) => r.name)).toEqual(["idle", "sway"]);
      expect(old.rows[0].frames[0].w).toBeGreaterThan(KIT_PRESETS[0].sizes.environment);
    });

    it("animates the small props", () => {
      expect(names("bush")).toEqual(["idle", "sway", "cut"]);
      expect(names("tall-grass")).toEqual(["idle", "sway", "cut"]);
      expect(names("flowers")).toEqual(["idle", "sway"]);
      expect(names("rock")).toEqual(["idle", "break"]);
      expect(names("boulder")).toEqual(["idle", "break"]);
      expect(names("stump")).toEqual(["idle", "chop"]);
      expect(names("crystal")).toEqual(["idle"]);
    });

    it("keeps every animation frame the same size and non-empty", () => {
      for (let i = 0; i < KIT_PRESETS.length; i++)
        for (const kind of [...PROP_KINDS, "old-oak"]) {
          const { rows } = gen(kind, i);
          const { w, h } = rows[0].frames[0];
          for (const r of rows) for (const f of r.frames) { expect(f.w).toBe(w); expect(f.h).toBe(h); expect(bounds(f)).not.toBeNull(); }
        }
    });

    it("changes row 0 frame 0 for no existing kind when animation params change", () => {
      for (const kind of PROP_KINDS) expect(gen(kind, 0, 4, { cuttable: 0 as never }).rows[0].frames[0].data).toEqual(gen(kind, 0, 4).rows[0].frames[0].data);
    });

    it.each(KIT_PRESETS.map((k, i) => [k.id, i] as const))("soil tiles and fence pieces on %s", (_id, kitIdx) => {
      const T = KIT_PRESETS[kitIdx].sizes.tile;
      for (const kind of SOIL_TILE_KINDS) {
        const f = gen(kind, kitIdx, 3).rows[0].frames[0];
        expect(f.w).toBe(T);
        for (const v of f.data) { expect(v).toBeGreaterThan(0); expect(decodeIndex(v)?.mat).not.toBe("ink"); }
        // furrows have period 4, so the wrap seam is as quiet as any interior pair
        for (const axis of ["x", "y"] as const) {
          let interior = 0;
          for (let i = 0; i < T - 1; i++) interior += lineDiff(f, i, i + 1, axis);
          // y: the wrap pair (rows 15,0) is a furrow-phase step like rows (3,4); x: no busier than interior
          const limit = axis === "y" ? lineDiff(f, 3, 4, "y") + 4 : (interior / (T - 1)) * 1.6 + 2;
          expect(lineDiff(f, T - 1, 0, axis)).toBeLessThanOrEqual(limit);
        }
      }
      const piece = (p: string, extra = {}) => gen("fence", kitIdx, 1, { piece: p, ...extra }).rows[0].frames[0];
      for (const p of FENCE_PIECES) expect(piece(p).w).toBe(T);
      const col = (s: Sprite, x: number) => Array.from({ length: s.h }, (_, y) => getPx(s, x, y));
      const row = (s: Sprite, y: number) => Array.from({ length: s.w }, (_, x) => getPx(s, x, y));
      // pieces reaching a shared edge present the same pixels there
      for (const a of ["h", "cross", "corner-ne", "corner-se", "t-n", "t-s", "t-e"])
        for (const b of ["h", "cross", "corner-nw", "corner-sw", "t-n", "t-s", "t-w"]) {
          if (!["h", "cross", "corner-ne", "corner-se", "t-n", "t-s"].includes(a) || !["h", "cross", "corner-nw", "corner-sw", "t-n", "t-s"].includes(b)) continue;
          expect(col(piece(a), T - 1)).toEqual(col(piece(b), 0));
        }
      expect(row(piece("v"), T - 1)).toEqual(row(piece("cross"), 0).map((_, i) => row(piece("v"), 0)[i]));
      expect(row(piece("v"), 0)).toEqual(row(piece("v"), T - 1));
      expect(col(piece("h"), 0)).toEqual(col(piece("h"), T - 1));
      expect(gen("fence", kitIdx, 1, { piece: "gate-closed" }).rows.map((r) => r.name)).toEqual(["idle", "open"]);
      expect(piece("h", { trunk: "stone" }).data).not.toEqual(piece("h").data);
    });
  });

  it("never clips animation frames against the canvas border", () => {
    const kinds = [...PROP_KINDS, ...EXTRA_PROP_KINDS];
    const touches = (s: Sprite) => {
      const b = bounds(s);
      return { l: !!b && b.x0 === 0, r: !!b && b.x1 === s.w - 1, t: !!b && b.y0 === 0 };
    };
    for (let ki = 0; ki < KIT_PRESETS.length; ki++)
      for (const kind of kinds) {
        const res = gen(kind, ki);
        const idle = touches(res.rows[0].frames[0]);
        for (const row of res.rows)
          for (const f of row.frames) {
            const t = touches(f);
            expect(f.w).toBe(res.rows[0].frames[0].w);
            if (!idle.l) expect(t.l, `${kind} ${row.name} left`).toBe(false);
            if (!idle.r) expect(t.r, `${kind} ${row.name} right`).toBe(false);
            if (!idle.t) expect(t.t, `${kind} ${row.name} top`).toBe(false);
          }
      }
  });

  it("watered soil differs from tilled soil in every kit", () => {
    for (let ki = 0; ki < KIT_PRESETS.length; ki++)
      expect(gen("watered-soil-tile", ki).rows[0].frames[0].data).not.toEqual(gen("tilled-soil-tile", ki).rows[0].frames[0].data);
  });
});

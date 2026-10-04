import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { KIT_PRESETS } from "../kit";
import { decodeIndex } from "../palette";
import { emptyTileMap } from "../tilemap";
import { environmentGenerator } from "./environment";
import { mapGenerator, paintWaterDepth, waterDepthField, type Ground } from "./map";
import { tilesetGenerator } from "./tileset";
import { defaults } from "./types";

const kit = (id: string) => KIT_PRESETS.find((k) => k.id === id)!;
const env = (p: Record<string, string | number | boolean>, k = kit("kit-default"), seed = 3) => environmentGenerator.generate({ ...defaults(environmentGenerator), ...p }, k, seed);
const hash = (x: unknown) => createHash("sha1").update(JSON.stringify(x)).digest("hex").slice(0, 12);

describe("water depth", () => {
  it("leaves the classic water tile and maps byte-identical", () => {
    const w = env({ kind: "water-tile" });
    expect(hash(w.rows.map((r) => r.frames.map((f) => Array.from(f.data))))).toBe("df9ce2bfebdd");
    const m = mapGenerator.generate({ ...defaults(mapGenerator), biome: "meadow" }, kit("kit-default"), 5);
    expect(hash(Array.from(m.rows[0].frames[0].data))).toBe("718cdeaa5526");
  });

  it("renders four seamless depth frames per kit, deterministically", () => {
    for (const id of ["kit-default", "kit-gameboy", "kit-hd-rich", "kit-hd-deep"]) {
      const k = kit(id), T = k.sizes.tile;
      for (let depth = 0; depth < 4; depth++) {
        const a = env({ kind: "water-tile", depth }, k), b = env({ kind: "water-tile", depth }, k);
        expect(a.rows[0].frames).toHaveLength(4);
        expect(a.rows[0].frames).toEqual(b.rows[0].frames);
        expect(a.rows[0].frames[0].w).toBe(T);
        expect(a.rows[0].frames[0].data).not.toEqual(a.rows[0].frames[1].data);
        expect(a.rows[0].frames[0].data.every((v) => v > 0)).toBe(true);
      }
    }
  });

  it("gets darker with depth", () => {
    const k = kit("kit-hd-rich");
    const lum = (depth: number) => {
      const d = env({ kind: "water-tile", depth }, k).rows[0].frames[0].data;
      let sum = 0, n = 0;
      for (const v of d) { const x = decodeIndex(v); if (x?.mat === "water") { sum += x.level; n++; } }
      return sum / n;
    };
    expect(lum(1)).toBeGreaterThan(lum(2));
    expect(lum(2)).toBeGreaterThan(lum(3));
  });

  it("shore tiles animate their foam line", () => {
    const t = env({ kind: "water-tile", depth: 0, shore: "n", shore_rocks: true });
    expect(t.rows[0].frames[0].data).not.toEqual(t.rows[0].frames[2].data);
  });

  it("depth field grows away from shore", () => {
    const cols = 13, rows = 13;
    const ground: Ground[] = Array.from({ length: cols * rows }, (_, i) => (i % cols < 1 || i % cols > 11 || i < cols || i >= cols * 12 ? "grass" : "water"));
    const d = waterDepthField(ground, cols, rows);
    const row = 6;
    for (let x = 1; x < 6; x++) expect(d[row * cols + x + 1]).toBeGreaterThanOrEqual(d[row * cols + x]);
    expect(d[row * cols + 1]).toBe(0);
    expect(d[row * cols + 6]).toBe(3);
    const tm = emptyTileMap(cols, rows, 16);
    paintWaterDepth(tm, ground, kit("kit-hd-rich"), 1);
    expect(tm.ground.every((t) => t >= 0)).toBe(true);
  });

  it("opt-in map water depth is deterministic and adds props", () => {
    const run = (seed: number) => mapGenerator.generate({ ...defaults(mapGenerator), biome: "meadow", river: true, water_depth: true }, kit("kit-hd-rich"), seed);
    const a = run(4), b = run(4);
    expect(a.rows[0].frames[0]).toEqual(b.rows[0].frames[0]);
    const names = a.tilemap!.tiles.map((t) => t.name);
    expect(names.some((n) => n.startsWith("water-d"))).toBe(true);
    expect(names.some((n) => /^(reeds|cattail|lily-pad)-/.test(n))).toBe(true);
    const off = mapGenerator.generate({ ...defaults(mapGenerator), biome: "meadow", river: true }, kit("kit-hd-rich"), 4);
    expect(off.rows[0].frames[0]).not.toEqual(a.rows[0].frames[0]);
  });

  it("water props render, animate and keep a margin", () => {
    for (const kind of ["lily-pad", "reeds", "cattail", "river-rock", "driftwood"]) {
      const r = env({ kind });
      expect(r.rows).toHaveLength(2);
      const idle = r.rows[0].frames[0], anim = r.rows[1].frames;
      expect(anim.length).toBe(4);
      expect(anim.some((f) => f.data.some((v, i) => v !== idle.data[i]))).toBe(true);
      for (const f of anim) for (let i = 0; i < f.w; i++) expect([f.data[i], f.data[(f.h - 1) * f.w + i], f.data[i * f.w], f.data[i * f.w + f.w - 1]]).toEqual([0, 0, 0, 0]);
    }
  });

  it("bridges span 1-3 tiles in wood or stone", () => {
    const S = kit("kit-default").sizes.environment;
    for (const span of [1, 2, 3]) {
      const w = env({ kind: "small-bridge", span }), s = env({ kind: "small-bridge", span, trunk: "stone" });
      expect(w.rows[0].frames[0].w).toBe(S * span);
      expect(w.rows[0].frames[0].data).not.toEqual(s.rows[0].frames[0].data);
      expect(w.rows[0].frames[0].data[0]).toBe(0);
    }
  });

  it("tileset can build water depth bands", () => {
    const g = (p: Record<string, string | number>) => tilesetGenerator.generate({ ...defaults(tilesetGenerator), ...p }, kit("kit-hd-rich"), 1).rows[0].frames[0];
    const bands = g({ lower: "water", upper: "water", lower_depth: 3, upper_depth: 1 });
    expect(bands).toEqual(g({ lower: "water", upper: "water", lower_depth: 3, upper_depth: 1 }));
    expect(bands).not.toEqual(g({ lower: "water", upper: "grass" }));
  });
});

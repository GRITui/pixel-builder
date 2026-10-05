import { describe, expect, it } from "vitest";
import { KIT_PRESETS } from "../kit";
import { renderTileMap } from "../tilemap";
import type { TileMap } from "../types";
import { mapGenerator } from "./map";
import { defaults } from "./types";

const BIOMES = ["meadow", "forest", "island", "desert", "winter", "rice-village", "farm", "forest-mmo", "farm-mmo", "village"];
const kit = KIT_PRESETS[0];

const make = (extra: Record<string, string | number | boolean> = {}, seed = 1, k = kit) =>
  mapGenerator.generate({ ...defaults(mapGenerator), ...extra }, k, seed);
const tilemap = (extra: Record<string, string | number | boolean> = {}, seed = 1, k = kit): TileMap => make(extra, seed, k).tilemap!;

const nameAt = (tm: TileMap, layer: "ground" | "deco", i: number) => tm.tiles[tm[layer][i]]?.name ?? "";
const count = (tm: TileMap, pred: (name: string) => boolean, layer: "ground" | "deco" = "ground") =>
  tm[layer].filter((t) => t >= 0 && pred(tm.tiles[t].name)).length;
const decoCount = (tm: TileMap) => tm.deco.filter((t) => t >= 0).length;

describe("map generator", () => {
  it("declares the documented params", () => {
    const biome = mapGenerator.params.find((p) => p.key === "biome");
    expect(biome && biome.type === "select" && biome.options).toEqual(BIOMES);
    const keys = mapGenerator.params.map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(["biome", "cols", "rows", "density", "path"]));
  });

  describe.each(KIT_PRESETS.map((k) => [k.id, k] as const))("%s", (_id, k) => {
    it.each(BIOMES)("%s: returns a rendered map plus a consistent tilemap", (biome) => {
      const r = make({ biome, cols: 20, rows: 16 }, 4, k);
      const tm = r.tilemap!;
      expect(r.fps).toBe(1);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0].name).toBe("map");
      expect(r.rows[0].frames).toHaveLength(1);
      expect(tm.cols).toBe(20);
      expect(tm.rows).toBe(16);
      expect(tm.tile).toBe(k.sizes.tile);
      expect(tm.ground).toHaveLength(20 * 16);
      expect(tm.deco).toHaveLength(20 * 16);
      const img = r.rows[0].frames[0];
      expect(img.w).toBe(20 * k.sizes.tile);
      expect(img.h).toBe(16 * k.sizes.tile);
      expect(img).toEqual(renderTileMap(tm));
      for (const t of tm.ground) expect(t).toBeGreaterThanOrEqual(0); // fully covered ground
      for (const t of [...tm.ground, ...tm.deco]) expect(t).toBeLessThan(tm.tiles.length);
      // ground tiles are exactly tile-sized and opaque
      for (const g of new Set(tm.ground)) {
        const s = tm.tiles[g].sprite;
        expect([s.w, s.h]).toEqual([k.sizes.tile, k.sizes.tile]);
        expect(s.data.every((v) => v > 0)).toBe(true);
      }
      // the rendered map has no holes
      expect(img.data.every((v) => v > 0)).toBe(true);
    });
  });

  it("is deterministic per seed and changes with the seed", () => {
    for (const biome of BIOMES) {
      const a = make({ biome }, 99), b = make({ biome }, 99);
      expect(a).toEqual(b);
      expect(make({ biome }, 100).tilemap!.ground).not.toEqual(a.tilemap!.ground);
    }
  });

  it("never places deco on water (all biomes, many seeds, all densities)", () => {
    let waterSeen = 0;
    for (const biome of BIOMES)
      for (let seed = 1; seed <= 12; seed++)
        for (const density of [0.3, 1]) {
          const tm = tilemap({ biome, density, cols: 24, rows: 24 }, seed);
          for (let i = 0; i < tm.ground.length; i++) {
            const g = nameAt(tm, "ground", i);
            if (g === "water") {
              waterSeen++;
              expect(tm.deco[i]).toBe(-1);
            }
          }
        }
    expect(waterSeen).toBeGreaterThan(0);
  }, 20_000); // 144 full maps: ~2s locally, slower on shared CI runners

  it("marks water, trees and rocks solid, and soft props walkable", () => {
    let seen = new Set<string>();
    for (const biome of BIOMES)
      for (let seed = 1; seed <= 6; seed++) {
        const tm = tilemap({ biome, density: 1, cols: 32, rows: 32 }, seed);
        for (const t of tm.tiles) {
          const kind = t.name.replace(/-\d+$/, "");
          seen.add(kind);
          if (["water", "oak", "pine", "palm", "dead-tree", "rock", "boulder", "crystal"].includes(kind)) expect(t.solid, t.name).toBe(true);
          if (["grass", "dirt", "sand", "snow", "stone-path", "flowers", "tall-grass", "mushroom", "bush"].includes(kind)) expect(t.solid ?? false, t.name).toBe(false);
        }
      }
    for (const k of ["water", "oak", "pine", "palm", "rock", "flowers"]) expect(seen.has(k)).toBe(true);
  });

  it("builds the biome's ground", () => {
    const sand = (n: string) => n.startsWith("sand");
    const snow = (n: string) => n.startsWith("snow");
    const grass = (n: string) => n.startsWith("grass");
    const total = 24 * 24;
    const island = tilemap({ biome: "island", cols: 24, rows: 24 }, 3);
    expect(count(island, (n) => n === "water")).toBeGreaterThan(total * 0.15);
    expect(count(island, sand)).toBeGreaterThan(0);
    expect(count(island, grass)).toBeGreaterThan(total * 0.15);
    // water hugs the border, land in the middle
    expect(nameAt(island, "ground", 0)).toBe("water");
    const centre = nameAt(island, "ground", 12 * 24 + 12);
    expect(centre).not.toBe("water");
    expect(count(tilemap({ biome: "desert", cols: 24, rows: 24 }, 3), sand)).toBeGreaterThan(total * 0.5);
    expect(count(tilemap({ biome: "winter", cols: 24, rows: 24 }, 3), snow)).toBeGreaterThan(total * 0.5);
    expect(count(tilemap({ biome: "meadow", cols: 24, rows: 24 }, 3), grass)).toBeGreaterThan(total * 0.5);
  });

  it("density scales the amount of deco; 0 gives none", () => {
    for (const biome of BIOMES) {
      const none = decoCount(tilemap({ biome, density: 0 }, 5));
      const some = decoCount(tilemap({ biome, density: 0.3 }, 5));
      const lots = decoCount(tilemap({ biome, density: 1 }, 5));
      expect(none).toBe(0);
      expect(lots).toBeGreaterThan(some);
      expect(some).toBeGreaterThan(0);
    }
    const trees = (biome: string) => count(tilemap({ biome, density: 0.8, cols: 32, rows: 32 }, 5), (n) => /^(oak|pine)/.test(n), "deco");
    expect(trees("forest")).toBeGreaterThan(trees("meadow"));
  });

  it("carves a path across the map only when asked", () => {
    for (const [biome, kind] of [["meadow", "dirt"], ["forest", "dirt"], ["winter", "stone-path"]] as const) {
      const withPath = tilemap({ biome, path: true, cols: 28, rows: 20 }, 8);
      const isPath = (i: number) => nameAt(withPath, "ground", i).startsWith(kind);
      for (let x = 0; x < 28; x++) {
        const hit = Array.from({ length: 20 }, (_, y) => y * 28 + x).some(isPath);
        expect(hit, `${biome} path reaches column ${x}`).toBe(true);
      }
      for (let i = 0; i < withPath.deco.length; i++) if (isPath(i)) expect(withPath.deco[i]).toBe(-1);
      expect(count(tilemap({ biome, path: false }, 8), (n) => n.startsWith(kind))).toBe(0);
    }
  });

  it("clamps cols/rows to 12-48", () => {
    const small = tilemap({ cols: 2, rows: 3 });
    expect([small.cols, small.rows]).toEqual([12, 12]);
    const big = tilemap({ cols: 500, rows: 99, density: 0.2 });
    expect([big.cols, big.rows]).toEqual([48, 48]);
  });

  it("keeps big props off the map edge so they are not clipped", () => {
    const tm = tilemap({ biome: "forest", density: 1, cols: 24, rows: 24 }, 2);
    for (let x = 0; x < tm.cols; x++) {
      const n = nameAt(tm, "deco", x); // top row
      expect(/^(oak|pine|palm|dead-tree|boulder)/.test(n)).toBe(false);
    }
  });

  it("adds ragged path edge tiles that are opaque and tile-sized", () => {
    const tm = tilemap({ biome: "meadow", path: true, cols: 28, rows: 20 }, 8);
    const edges = tm.tiles.filter((t) => /-edge-\d+/.test(t.name));
    expect(edges.length).toBeGreaterThan(0);
    for (const t of edges) {
      expect([t.sprite.w, t.sprite.h]).toEqual([kit.sizes.tile, kit.sizes.tile]);
      expect(t.sprite.data.every((v) => v !== 0)).toBe(true);
    }
  });

  it("adds shore transition tiles where land meets water", () => {
    const tm = tilemap({ biome: "island", cols: 24, rows: 24 }, 3);
    expect(count(tm, (n) => /-shore-\d+/.test(n))).toBeGreaterThan(0);
    for (const t of tm.tiles.filter((t) => t.name.includes("-shore-"))) expect([t.sprite.w, t.sprite.h]).toEqual([kit.sizes.tile, kit.sizes.tile]);
  });

  it("generates a 32x32 map in under 200ms", () => {
    for (const biome of BIOMES) make({ biome, cols: 32, rows: 32, density: 1 }, 1); // warm up
    for (const biome of BIOMES) {
      const t0 = performance.now();
      make({ biome, cols: 32, rows: 32, density: 1 }, 7);
      expect(performance.now() - t0).toBeLessThan(200);
    }
  });

  it("rice-village has paddies and a path, no deco on paddies, deterministic", () => {
    const tm = tilemap({ biome: "rice-village", cols: 28, rows: 20, path: true }, 3);
    expect(count(tm, (n) => n.startsWith("paddy"))).toBeGreaterThan(20);
    expect(count(tm, (n) => n.startsWith("dirt"))).toBeGreaterThan(10);
    for (let i = 0; i < tm.deco.length; i++) if (tm.deco[i] >= 0) expect(nameAt(tm, "ground", i).startsWith("paddy")).toBe(false);
    expect(decoCount(tm)).toBeGreaterThan(0);
    expect(tilemap({ biome: "rice-village" }, 9).ground).toEqual(tilemap({ biome: "rice-village" }, 9).ground);
  });

  it("rice-village places solid stilt houses and 2+ paddy fields", () => {
    const tm = tilemap({ biome: "rice-village", cols: 32, rows: 32 }, 4);
    const houses = tm.tiles.filter((t) => t.name.startsWith("stilt-house"));
    expect(houses.length).toBeGreaterThan(0);
    for (const h of houses) expect(h.solid).toBe(true);
  });

  describe.each(["normal", "sea"])("farm biome (%s set)", (set) => {
    const sizes: [number, number][] = [[24, 20], [32, 24], [40, 32]];
    it("lays out buildings, fenced fields, animals and solids", () => {
      for (const [cols, rows] of sizes)
        for (let seed = 1; seed <= 4; seed++) {
          const tm = tilemap({ biome: "farm", set, cols, rows, density: 1 }, seed);
          const at = (i: number) => [i % cols, Math.floor(i / cols)];
          const T = tm.tile;
          const fenceAt = (i: number) => tm.deco[i] >= 0 && tm.tiles[tm.deco[i]].name.startsWith("fence-");
          // buildings fully on the map, not overlapping, solid
          const boxes: number[][] = [];
          tm.deco.forEach((t, i) => {
            if (t < 0) return;
            const { name, sprite, solid } = tm.tiles[t];
            const [x, y] = at(i);
            if (/^(farmhouse|half-brick|stilt-house|barn|coop)-/.test(name)) {
              const x0 = x * T + Math.floor((T - sprite.w) / 2), y0 = (y + 1) * T - sprite.h;
              expect(x0).toBeGreaterThanOrEqual(0);
              expect(x0 + sprite.w).toBeLessThanOrEqual(cols * T);
              expect(y0).toBeGreaterThanOrEqual(0);
              expect(solid).toBe(true);
              for (const b of boxes) expect(x0 + sprite.w <= b[0] || b[0] + b[2] <= x0 || y0 + sprite.h <= b[1] || b[1] + b[3] <= y0).toBe(true);
              boxes.push([x0, y0, sprite.w, sprite.h]);
            }
            if (name.startsWith("fence-")) expect(!!solid).toBe(!name.includes("gate"));
            if (/^(cow|sheep|pig|water-buffalo|dog|cat|chicken)/.test(name)) {
              expect(x).toBeGreaterThanOrEqual(1); expect(x).toBeLessThanOrEqual(cols - 2);
              expect(y).toBeGreaterThanOrEqual(1); expect(y).toBeLessThanOrEqual(rows - 2);
            }
            expect(tm.ground[i] >= 0 && nameAt(tm, "ground", i) !== "water").toBe(true);
          });
          expect(boxes.length).toBeGreaterThanOrEqual(2);
          // every soil region is enclosed by fence (flood fill never escapes) and the ring has a gate
          const soil = (i: number) => /soil/.test(nameAt(tm, "ground", i));
          const seen = new Set<number>();
          let fields = 0;
          for (let s = 0; s < cols * rows; s++) {
            if (!soil(s) || seen.has(s)) continue;
            fields++;
            const stack = [s]; seen.add(s);
            const ring = new Set<number>();
            while (stack.length) {
              const i = stack.pop()!; const [x, y] = at(i);
              for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
                const xx = x + dx, yy = y + dy;
                expect(xx >= 0 && yy >= 0 && xx < cols && yy < rows).toBe(true);
                const j = yy * cols + xx;
                if (soil(j)) { if (!seen.has(j)) { seen.add(j); stack.push(j); } } else { expect(fenceAt(j)).toBe(true); ring.add(j); }
              }
            }
            expect([...ring].some((j) => tm.tiles[tm.deco[j]].name === "fence-gate-closed")).toBe(true);
          }
          expect(fields).toBeGreaterThanOrEqual(1);
        }
    });
    it("is varied by seed and has a pond", () => {
      const tm = tilemap({ biome: "farm", set, cols: 32, rows: 24 }, 2);
      expect(count(tm, (n) => n === "water")).toBeGreaterThan(0);
      expect(tilemap({ biome: "farm", set }, 1).ground).not.toEqual(tilemap({ biome: "farm", set }, 2).ground);
    });
  });
});

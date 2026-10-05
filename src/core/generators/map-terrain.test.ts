import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAsset } from "../asset";
import { KIT_PRESETS } from "../kit";
import { PALETTE_SIZE } from "../palette";
import { renderMapFrames } from "../mapanim";
import type { TileMap } from "../types";
import { exportAsset, Workspace } from "../../node/workspace";
import { mapGenerator, mapObjects } from "./map";
import { terrainReach, terrainWalkable, waterfallFrame } from "./map-terrain";
import { defaults } from "./types";

const kit = KIT_PRESETS.find((k) => k.id === "kit-hd-rich")!;
const make = (extra: Record<string, string | number | boolean> = {}, seed = 1, k = kit) =>
  mapGenerator.generate({ ...defaults(mapGenerator), biome: "forest-mmo", cols: 24, rows: 16, ...extra }, k, seed);
const nm = (tm: TileMap, i: number) => tm.tiles[tm.ground[i]]?.name ?? "";

describe("terrain: hills", () => {
  it("flat (default) is byte-identical to a map without the param", () => {
    for (const biome of ["forest-mmo", "meadow", "forest"]) {
      const a = mapGenerator.generate({ ...defaults(mapGenerator), biome, cols: 20, rows: 16 }, kit, 3);
      const b = mapGenerator.generate({ ...defaults(mapGenerator), biome, cols: 20, rows: 16, terrain: "flat" }, kit, 3);
      expect(b.rows[0].frames[0].data).toEqual(a.rows[0].frames[0].data);
      expect(a.tilemap!.heights).toBeUndefined();
    }
  });

  it("is deterministic per seed and differs between seeds", () => {
    const a = make({ terrain: "hills" }, 4), b = make({ terrain: "hills" }, 4), c = make({ terrain: "hills" }, 5);
    expect(a.rows[0].frames[0].data).toEqual(b.rows[0].frames[0].data);
    expect(a.tilemap!.heights).toEqual(b.tilemap!.heights);
    expect(c.rows[0].frames[0].data).not.toEqual(a.rows[0].frames[0].data);
  });

  it.each([1, 2, 3, 7, 11])("forest-mmo seed %i: solid cliffs, a ramp, every plateau cell reachable, props on their level", (seed) => {
    const r = make({ terrain: "hills" }, seed);
    const tm = r.tilemap!, meta = r.meta as { playerStart: { x: number; y: number }; terrain: { ramps: { x: number; y: number }[]; waterfalls: unknown[]; cliffCells: { x: number; y: number }[] } };
    const H = tm.heights!;
    expect(Math.max(...H)).toBe(1);
    expect(meta.terrain.ramps.length).toBeGreaterThan(0);
    expect(meta.terrain.cliffCells.length).toBeGreaterThan(8);
    for (const c of meta.terrain.cliffCells) {
      const i = c.y * tm.cols + c.x;
      expect(tm.tiles[tm.ground[i]].solid).toBe(true);
      expect(tm.deco[i]).toBe(-1);
      expect(Math.max(H[i - tm.cols], H[i - tm.cols - 1] ?? 0, H[i - tm.cols + 1] ?? 0)).toBeGreaterThan(H[i]);
    }
    const walk = terrainWalkable(tm);
    for (const rp of meta.terrain.ramps) {
      expect(walk[rp.y * tm.cols + rp.x]).toBe(true);
      expect(nm(tm, rp.y * tm.cols + rp.x)).toMatch(/^ramp-/);
    }
    // from the foot of the ramp: up the ramp and onto the plateau (heights change only across ramps)
    const rp = meta.terrain.ramps[0], seen = terrainReach(tm, { x: rp.x, y: rp.y + 1 });
    expect(seen.size).toBeGreaterThan(30);
    expect(seen.has(rp.y * tm.cols + rp.x)).toBe(true);
    expect(seen.has((rp.y - 1) * tm.cols + rp.x)).toBe(true);
    let up = 0;
    seen.forEach((i) => { if (H[i] === 1) up++; });
    expect(up).toBeGreaterThan(3);
    for (const o of mapObjects(tm)) expect(o.level).toBe(H[o.row * tm.cols + o.col]);
  });

  it("puts a waterfall where the river meets the cliff, and it flows", { timeout: 30_000 }, () => {
    for (const seed of [1, 2, 3, 7]) {
      const r = make({ terrain: "hills", animate: true, frames: 8 }, seed);
      const tm = r.tilemap!, meta = r.meta as { terrain: { waterfalls: { x: number; y: number }[] } };
      expect(meta.terrain.waterfalls.length).toBeGreaterThan(2);
      for (const w of meta.terrain.waterfalls) {
        expect(nm(tm, w.y * tm.cols + w.x)).toMatch(/^waterfall-/);
        expect(nm(tm, (w.y - 1) * tm.cols + w.x)).toMatch(/^water/);
        expect(tm.heights![(w.y - 1) * tm.cols + w.x]).toBe(1);
      }
      const frames = r.rows[0].frames;
      expect(frames).toHaveLength(8);
      expect(frames[1].data).not.toEqual(frames[0].data);
      const t = tm.tiles[tm.ground[meta.terrain.waterfalls[0].y * tm.cols + meta.terrain.waterfalls[0].x]];
      expect(waterfallFrame(t.sprite, t.name, 4).data).toEqual(waterfallFrame(t.sprite, t.name, 0).data);
    }
  });

  it("makes plateaus with a level-2 summit and stairs on other biomes", { timeout: 30_000 }, () => {
    let found = false;
    for (const seed of [3, 4, 5, 6]) {
      const r = mapGenerator.generate({ ...defaults(mapGenerator), biome: "meadow", cols: 40, rows: 30, terrain: "hills", density: 0.6 }, kit, seed);
      const tm = r.tilemap!, meta = r.meta as { terrain: { ramps: { from: number; to: number }[] } };
      expect(tm.heights!.some((h) => h === 0)).toBe(true);
      expect(renderMapFrames(tm, kit, 2)[0].data.every((v) => v > 0 && v < PALETTE_SIZE)).toBe(true);
      if (Math.max(...tm.heights!) === 2 && meta.terrain.ramps.some((x) => x.to === 2)) found = true;
    }
    expect(found).toBe(true);
  });

  it("works in every top-down kit: opaque tiles of the right size", () => {
    for (const k of KIT_PRESETS.filter((x) => x.camera !== "iso" && x.camera !== "side")) {
      const r = make({ terrain: "hills", cols: 20, rows: 14, density: 0.4 }, 2, k);
      const f = r.rows[0].frames[0];
      expect(f.w).toBe(20 * k.sizes.tile);
      expect(f.data.every((v) => v > 0)).toBe(true);
    }
  });

  it("exports a height layer to Tiled", () => {
    const r = make({ terrain: "hills" }, 2);
    const dir = mkdtempSync(join(tmpdir(), "pb-terrain-"));
    try {
      const ws = new Workspace(dir), p = ws.load();
      const asset = createAsset({ name: "Hills", category: "map", kit, rows: r.rows, tilemap: r.tilemap!, meta: r.meta, source: { kind: "procedural" } });
      p.assets.push(asset);
      exportAsset(ws, p, asset);
      const tiled = JSON.parse(readFileSync(join(dir, "maps", "hills.tiled.json"), "utf8"));
      const h = tiled.layers.find((l: { name: string }) => l.name === "height");
      expect(h.data).toEqual(r.tilemap!.heights);
      expect(h.visible).toBe(false);
      const obj = tiled.layers.find((l: { name: string }) => l.name === "objects").objects[0];
      expect(obj.properties[0].name).toBe("level");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

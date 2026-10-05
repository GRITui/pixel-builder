import { describe, expect, it } from "vitest";
import { ALL_KIT_PRESETS } from "../kit";
import { mapGenerator, BIOMES } from "./map";
import { farmMmoPlan, farmReach, farmWalkable } from "./map-farm";
import { defaults } from "./types";
import type { TileMap } from "../types";

const kit = ALL_KIT_PRESETS.find((k) => k.id === "kit-hd-rich")!;
const gen = (p: object, k = kit, seed = 1) => mapGenerator.generate({ ...defaults(mapGenerator), biome: "farm-mmo", cols: 42, rows: 26, ...p } as never, k, seed);
const plan = (seed = 1, o: Partial<Parameters<typeof farmMmoPlan>[4]> = {}, cols = 42, rows = 26) => farmMmoPlan(cols, rows, seed, kit, { sea: false, density: 0.5, wantPath: true, terrain: false, ...o });

describe("farm-mmo", () => {
  it("is a biome and renders at map size", () => {
    expect(BIOMES).toContain("farm-mmo");
    const r = gen({});
    expect(r.rows[0].frames[0].w).toBe(42 * kit.sizes.tile);
    expect(r.rows[0].frames[0].h).toBe(26 * kit.sizes.tile);
    expect(r.rows[0].frames.length).toBe(1);
  }, 30000);

  it("is deterministic per seed and differs between seeds", () => {
    const a = gen({}).rows[0].frames[0].data, b = gen({}).rows[0].frames[0].data, c = gen({}, kit, 2).rows[0].frames[0].data;
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });

  it("lays out buildings, fields, pen and fills the map with trees", () => {
    const p = plan();
    expect(p.buildings.map((b) => b.style).sort()).toEqual(["barn", "coop", "farmhouse"]);
    expect(p.lots.some((l) => l.kind === "field")).toBe(true);
    expect(p.lots.some((l) => l.kind === "pen")).toBe(true);
    expect(p.trees.length).toBeGreaterThan(60);
    expect(p.animals.length).toBeGreaterThan(3);
    expect(p.bridge).not.toBeNull();
  });

  it("puts crops only on tilled cells", () => {
    for (const seed of [1, 2, 3]) {
      const p = plan(seed);
      expect(p.crops.length).toBeGreaterThan(10);
      for (const c of p.crops) expect(["tilled-soil", "watered-soil"]).toContain(p.ground[c.y * 42 + c.x]);
    }
  });

  it("makes the pen, fields and work spots reachable from the yard", () => {
    for (const seed of [1, 2, 3, 4]) {
      const p = plan(seed);
      const ok = farmWalkable(p, 42, 26);
      const reach = farmReach(ok, 42, 26, p.start);
      expect(ok[p.start.y * 42 + p.start.x]).toBe(true);
      for (const l of p.lots) if (l.kind === "field" || l.kind === "pen") expect(reach.has((l.y0 + 1) * 42 + l.gx)).toBe(true);
      for (const s of p.spawns) expect(ok[s.y * 42 + s.x] && reach.has(s.y * 42 + s.x)).toBe(true);
    }
  });

  it("exposes meta for games: y-sorted objects, spawns, blocked cells", () => {
    const m = gen({}).meta as { ysorted: boolean; spawns: { role: string }[]; objects: { y: number }[]; blocked: unknown[]; biome: string };
    expect(m.biome).toBe("farm-mmo");
    expect(m.ysorted).toBe(true);
    expect(m.spawns.map((s) => s.role)).toContain("farmer");
    expect(m.objects.length).toBeGreaterThan(100);
    expect(m.objects.every((o, i) => i === 0 || m.objects[i - 1].y <= o.y)).toBe(true);
    expect(m.blocked.length).toBeGreaterThan(0);
  });

  it("supports the sea set, hills, animate and lighting", () => {
    const sea = gen({ set: "sea" });
    expect(sea.rows[0].frames[0].w).toBe(42 * kit.sizes.tile);
    const hills = gen({ terrain: "hills", rows: 34 });
    expect((hills.meta as { terrain?: unknown }).terrain).toBeDefined();
    const live = gen({ animate: true, frames: 3, lighting: "on", time: "dusk" });
    expect(live.rows[0].frames.length).toBe(3);
  }, 30000); // three full 42-column maps (sea, hills, animated + lit)

  it("works on small maps and the 16px kits without crashing", () => {
    const gb = ALL_KIT_PRESETS.find((k) => k.id === "kit-gameboy")!;
    for (const [c, r] of [[24, 20], [30, 22]]) expect(gen({ cols: c, rows: r }, gb).rows[0].frames[0].w).toBe(c * gb.sizes.tile);
  });

  it("leaves the plain farm biome alone and stays inside a time budget", () => {
    const farm = mapGenerator.generate({ ...defaults(mapGenerator), biome: "farm", cols: 24, rows: 16 } as never, kit, 3);
    expect((farm.tilemap as TileMap).cols).toBe(24);
    expect(farm.meta).toBeUndefined();
    const t0 = Date.now();
    gen({}, kit, 9);
    expect(Date.now() - t0).toBeLessThan(15000);
  });
});

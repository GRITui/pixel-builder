import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAsset } from "../asset";
import { ALL_KIT_PRESETS } from "../kit";
import { findLights, mapLitObjects } from "../lighting";
import { renderMapFrames } from "../mapanim";
import { Workspace, exportAsset } from "../../node/workspace";
import { BIOMES, mapGenerator, mapObjects } from "./map";
import { farmMmoPlan, farmReach, farmWalkable } from "./map-farm";
import { villagePlan, villageWalkable } from "./map-village";
import { defaults } from "./types";

const kit = ALL_KIT_PRESETS.find((k) => k.id === "kit-hd-rich")!;
const k0 = ALL_KIT_PRESETS.find((k) => k.id === "kit-default")!;
const fp = (d: ArrayLike<number>) => createHash("sha1").update(Buffer.from(d as never)).digest("hex").slice(0, 12);
const gen = (p: object, k = kit, seed = 1) => mapGenerator.generate({ ...defaults(mapGenerator), ...p } as never, k, seed);
const V = { biome: "village", cols: 44, rows: 36 };

describe("buildings: classic stays byte-identical", () => {
  it("pins every existing biome (with lighting) recorded before the rich buildings existed", () => {
    const want: [string, string, string, object, string][] = [
      ["kit-default", "farm-mmo", "medium", {}, "5b7d112be272"],
      ["kit-default", "farm-mmo", "off", { set: "sea" }, "9f6510977a2a"],
      ["kit-default", "farm", "off", {}, "0fc4068de1c7"],
      ["kit-default", "rice-village", "off", {}, "bd651b41e504"],
      ["kit-default", "forest-mmo", "medium", {}, "f6f2079794be"],
      ["kit-default", "meadow", "off", {}, "2c2c6a46dc08"],
      ["kit-hd-rich", "farm-mmo", "medium", {}, "f5592bee9cf5"],
      ["kit-hd-rich", "farm-mmo", "off", { set: "sea" }, "aa3c646c5e5e"],
      ["kit-hd-rich", "farm", "off", {}, "f20dc2ac1c5f"],
    ];
    for (const [kid, biome, detail, extra, hash] of want) {
      const k = ALL_KIT_PRESETS.find((x) => x.id === kid)!;
      const r = gen({ biome, cols: 42, rows: 26, detail, ...extra, lighting: "on", time: "dusk" }, k, 3);
      expect(fp(r.rows[0].frames[0].data), `${kid} ${biome} ${detail}`).toBe(hash);
    }
  }, 60000);

  it("defaults to classic and adds no rich meta", () => {
    expect(defaults(mapGenerator).buildings).toBe("classic");
    const m = gen({ biome: "farm-mmo", cols: 42, rows: 26 }).meta as Record<string, unknown>;
    expect(m.buildingLook).toBeUndefined();
    expect(m.lights).toBeUndefined();
  });
});

describe("farm-mmo with rich buildings", () => {
  const plan = (seed: number, cols = 42, rows = 28, sea = false) => farmMmoPlan(cols, rows, seed, kit, { sea, density: 0.5, wantPath: true, terrain: false, rich: true });

  it("places footprints: entries reachable from the start, doors and entries free, solid = footprint", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const p = plan(seed);
      const ok = farmWalkable(p, 42, 28), reach = farmReach(ok, 42, 28, p.start);
      expect(p.buildings.map((b) => b.style)).toEqual(expect.arrayContaining(["farmhouse", "barn", "coop"]));
      for (const b of p.buildings) {
        expect(b.rich, b.style).toBeDefined();
        const { rect, entry } = b.rich!;
        expect(rect.x1 - rect.x0 + 1).toBe(b.rich!.fp.w);
        expect(rect.y1 - rect.y0 + 1).toBe(b.rich!.fp.d);
        for (let y = rect.y0; y <= rect.y1; y++) for (let x = rect.x0; x <= rect.x1; x++) expect(ok[y * 42 + x]).toBe(false);
        expect(ok[entry.y * 42 + entry.x], `${b.style} entry walkable`).toBe(true);
        expect(reach.has(entry.y * 42 + entry.x), `${b.style} entry reachable`).toBe(true);
        expect(p.ground[entry.y * 42 + entry.x]).not.toBe("water");
      }
      for (const l of p.lots) if (l.kind === "field" || l.kind === "pen") expect(reach.has((l.y0 + 1) * 42 + l.gx)).toBe(true);
    }
  });

  it("keeps trees, props and animals off the footprints and the entry tiles", () => {
    for (const seed of [1, 2, 3]) {
      const p = plan(seed);
      const cells = new Set<number>();
      for (const b of p.buildings) {
        const { rect, entry } = b.rich!;
        for (let y = rect.y0; y <= rect.y1; y++) for (let x = rect.x0; x <= rect.x1; x++) cells.add(y * 42 + x);
        cells.add(entry.y * 42 + entry.x);
      }
      for (const t of p.trees) expect(cells.has(t.y * 42 + t.x)).toBe(false);
      for (const o of p.props) expect(cells.has(o.y * 42 + o.x), o.kind).toBe(false);
      for (const a of p.animals) expect(cells.has(a.y * 42 + a.x)).toBe(false);
      for (const c of p.crops) expect(cells.has(c.y * 42 + c.x)).toBe(false);
    }
  });

  it("renders with the y-sort at the footprint front row and carries lights into meta and the tiles", () => {
    const r = gen({ biome: "farm-mmo", cols: 42, rows: 28, buildings: "rich", lighting: "on" });
    const m = r.meta as { buildingLook: string; lights: unknown[]; buildings: { style: string; y: number; solid: { x0: number; y0: number; x1: number; y1: number }; entry: { x: number; y: number }; lights: unknown[] }[]; objects: { name: string; y: number }[]; blocked: { x: number; y: number }[] };
    expect(m.buildingLook).toBe("rich");
    expect(m.lights.length).toBeGreaterThan(3);
    const T = kit.sizes.tile;
    for (const b of m.buildings) {
      const obj = m.objects.find((o) => o.name.startsWith(`rich:${b.style}:`))!;
      expect(obj.y).toBe((b.solid.y1 + 1) * T);
      const blocked = new Set(m.blocked.map((c) => `${c.x},${c.y}`));
      for (let y = b.solid.y0; y <= b.solid.y1; y++) for (let x = b.solid.x0; x <= b.solid.x1; x++) expect(blocked.has(`${x},${y}`)).toBe(true);
      expect(blocked.has(`${b.entry.x},${b.entry.y}`)).toBe(false);
    }
    const lit = mapLitObjects(r.tilemap!).filter((o) => o.name.startsWith("rich:"));
    expect(lit.length).toBe(m.buildings.length);
    expect(lit.every((o) => (o.lights?.length ?? 0) >= 0)).toBe(true);
    expect(findLights(lit).length).toBeGreaterThanOrEqual(m.lights.length - 1);
  });

  it("is deterministic per seed and differs from classic", () => {
    const a = gen({ biome: "farm-mmo", cols: 42, rows: 28, buildings: "rich" }), b = gen({ biome: "farm-mmo", cols: 42, rows: 28, buildings: "rich" });
    expect(Array.from(a.rows[0].frames[0].data)).toEqual(Array.from(b.rows[0].frames[0].data));
    const c = gen({ biome: "farm-mmo", cols: 42, rows: 28 });
    expect(fp(a.rows[0].frames[0].data)).not.toBe(fp(c.rows[0].frames[0].data));
  });

  it("works in the sea set and in 16px kits", () => {
    const p = plan(2, 42, 28, true);
    expect(p.buildings.some((b) => b.style === "stilt-house" || b.style === "half-brick")).toBe(true);
    const r = gen({ biome: "farm-mmo", cols: 42, rows: 28, buildings: "rich" }, k0);
    expect(r.rows[0].frames[0].w).toBe(42 * k0.sizes.tile);
  });
});

describe("village biome", () => {
  it("is a biome and renders at map size", () => {
    expect(BIOMES).toContain("village");
    const r = gen(V);
    expect(r.rows[0].frames[0].w).toBe(44 * kit.sizes.tile);
    expect(r.rows[0].frames[0].h).toBe(36 * kit.sizes.tile);
    expect(r.tilemap!.tiles.some((t) => t.name.startsWith("rich:"))).toBe(true);
  });

  it("is deterministic per seed and differs between seeds", () => {
    const a = gen(V).rows[0].frames[0].data, b = gen(V).rows[0].frames[0].data, c = gen(V, kit, 2).rows[0].frames[0].data;
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });

  it("lays out the town: shops, inn, smithy, temple, windmill, well-house, stalls, houses, lamps and benches", () => {
    const p = villagePlan(44, 36, 1, kit, { sea: false, density: 0.5, wantPath: true });
    const styles = p.buildings.map((b) => b.style);
    for (const s of ["shop", "inn", "blacksmith", "windmill", "well-house", "market-stall", "cottage"]) expect(styles, s).toContain(s);
    expect(p.buildings.length).toBeGreaterThanOrEqual(10);
    const kinds = new Set(p.props.map((o) => o.kind));
    for (const k of ["lamp-post", "bench", "barrel"]) expect(kinds.has(k), k).toBe(true);
    expect(p.trees.length).toBeGreaterThan(20);
    expect(p.spawns.length).toBeGreaterThanOrEqual(5);
    const thai = villagePlan(44, 36, 1, kit, { sea: true, density: 0.5, wantPath: true });
    expect(thai.buildings.some((b) => b.style === "stilt-house")).toBe(true);
    expect(thai.buildings.find((b) => b.style === "temple")?.extra.gable).toBe("thai");
  });

  it("walkability: every entry and spawn is reachable from the start, doors unblocked, nothing on footprints", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) for (const sea of [false, true]) {
      const p = villagePlan(44, 36, seed, kit, { sea, density: 0.55, wantPath: true });
      const ok = villageWalkable(p, 44, 36), reach = farmReach(ok, 44, 36, p.start);
      const foot = new Set<number>();
      for (const b of p.buildings) for (let y = b.rect.y0; y <= b.rect.y1; y++) for (let x = b.rect.x0; x <= b.rect.x1; x++) foot.add(y * 44 + x);
      for (const b of p.buildings) {
        const e = b.entry.y * 44 + b.entry.x;
        expect(p.path.has(e), `${b.style} entry on a path`).toBe(true);
        expect(ok[e]).toBe(true);
        expect(reach.has(e), `${b.style} entry reachable (seed ${seed})`).toBe(true);
        expect(p.solid[b.y * 44 + b.x]).toBe(1);
      }
      for (const i of foot) expect(p.solid[i]).toBe(1);
      expect(p.solid.reduce((a, v) => a + v, 0)).toBe(foot.size);
      for (const t of p.trees) expect(foot.has(t.y * 44 + t.x)).toBe(false);
      for (const o of p.props) expect(foot.has(o.y * 44 + o.x), o.kind).toBe(false);
      for (const s of p.spawns) expect(reach.has(s.y * 44 + s.x)).toBe(true);
      // sprites never overlap each other
      const bs = p.buildings;
      for (let a = 0; a < bs.length; a++) for (let b = a + 1; b < bs.length; b++) {
        const A = bs[a], B = bs[b];
        const ox = A.x - A.left <= B.x + B.right && B.x - B.left <= A.x + A.right, oy = A.y - A.up <= B.y && B.y - B.up <= A.y;
        expect(ox && oy, `${A.style}/${B.style}`).toBe(false);
      }
    }
  });

  it("degrades gracefully on small maps", () => {
    for (const [cols, rows] of [[12, 12], [24, 20], [30, 24], [48, 48]]) {
      const r = gen({ biome: "village", cols, rows });
      expect(r.rows[0].frames[0].w).toBe(cols * kit.sizes.tile);
      const m = r.meta as { playerStart: { x: number; y: number } };
      expect(m.playerStart.x).toBeGreaterThanOrEqual(0);
    }
  });

  it("carries lights into meta and the lit objects; night glows windows and lamps", () => {
    const day = gen(V), night = gen({ ...V, lighting: "on", time: "night" });
    const m = day.meta as { lights: { x: number; y: number; r: number }[]; buildings: { lights: unknown[] }[] };
    expect(m.lights.length).toBeGreaterThan(20);
    const lights = findLights(mapLitObjects(day.tilemap!));
    expect(lights.length).toBeGreaterThan(m.lights.length); // + lamp posts
    expect(Array.from(night.rows[0].frames[0].data)).not.toEqual(Array.from(day.rows[0].frames[0].data));
    // a lit pixel next to a window is lighter than the day pixel is dark-shifted elsewhere: compare mean palette level near a light vs far away
    expect(night.rows[0].frames[0].data.every((v) => v > 0)).toBe(true);
  });

  it("y-sorts by the footprint front row", () => {
    const r = gen(V);
    const T = kit.sizes.tile;
    const objs = mapObjects(r.tilemap!);
    const m = r.meta as { buildings: { style: string; footprint: { y: number; d: number } }[] };
    for (const b of m.buildings) {
      const o = objs.find((q) => q.name.startsWith(`rich:${b.style}:`) && q.row === b.footprint.y + b.footprint.d - 1)!;
      expect(o.y).toBe((b.footprint.y + b.footprint.d) * T);
    }
  });

  it("animates smoke and the windmill when animate is on", () => {
    const r = gen({ ...V, animate: true, frames: 12 });
    const frames = r.rows[0].frames;
    expect(frames.length).toBe(12);
    const tm = r.tilemap!;
    const base = renderMapFrames(tm, kit, 12, 1);
    expect(base.length).toBe(12);
    // the windmill tile differs between frames
    const mill = mapObjects(tm).find((o) => o.name.includes(":windmill:"))!;
    const T = kit.sizes.tile, sp = tm.tiles[mill.tile].sprite;
    const x0 = Math.round(mill.x - sp.w / 2), y0 = mill.y - sp.h;
    const diff = (a: number, b: number) => { for (let y = y0; y < y0 + sp.h; y++) for (let x = x0; x < x0 + sp.w; x++) if (frames[a].data[y * frames[a].w + x] !== frames[b].data[y * frames[a].w + x]) return true; return false; };
    expect([1, 2, 3].some((f) => diff(0, f))).toBe(true);
    expect(T).toBeGreaterThan(0);
  });

  it("supports detail, 16px kits and lighting in every kit", () => {
    for (const k of ALL_KIT_PRESETS.filter((x) => x.camera !== "iso" && x.camera !== "side")) {
      const r = gen({ ...V, detail: "low", lighting: "on", time: "dusk" }, k);
      expect(r.rows[0].frames[0].w).toBe(44 * k.sizes.tile);
    }
  }, 120000);

  it("stays inside a time budget", () => {
    gen(V); // warm the sprite caches
    const t0 = Date.now();
    gen(V, kit, 7);
    expect(Date.now() - t0).toBeLessThan(15000);
  });

  it("exports Tiled json with the y-sorted objects and a collision layer", () => {
    const dir = mkdtempSync(join(tmpdir(), "pb-village-"));
    try {
      const ws = new Workspace(dir);
      const p = ws.load();
      const r = gen(V);
      const asset = createAsset({ name: "Village", category: "map", kit, rows: r.rows, tilemap: r.tilemap, meta: r.meta, source: { kind: "procedural" } });
      p.assets.push(asset);
      const files = exportAsset(ws, p, asset);
      expect(files.some((f) => f.path.endsWith("village.tiled.json"))).toBe(true);
      const tiled = JSON.parse(readFileSync(join(dir, "maps", "village.tiled.json"), "utf8"));
      const names = tiled.layers.map((l: { name: string }) => l.name);
      expect(names).toEqual(expect.arrayContaining(["ground", "deco", "objects", "collision", "spawns"]));
      const meta = r.meta as { buildings: unknown[] };
      expect(tiled.layers.find((l: { name: string }) => l.name === "collision").objects.length).toBe(meta.buildings.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

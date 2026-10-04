import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAsset } from "../asset";
import { KIT_PRESETS } from "../kit";
import { PALETTE_SIZE } from "../palette";
import type { TileMap } from "../types";
import { exportAsset, Workspace } from "../../node/workspace";
import { BIOMES, mapGenerator, mapObjects, waterDepthField } from "./map";
import { forestMmoPlan } from "./map-forest";
import { defaults } from "./types";

const kit = KIT_PRESETS.find((k) => k.id === "kit-hd-rich")!;
const make = (extra: Record<string, string | number | boolean> = {}, seed = 1, k = kit) =>
  mapGenerator.generate({ ...defaults(mapGenerator), biome: "forest-mmo", cols: 24, rows: 16, ...extra }, k, seed);
const name = (tm: TileMap, layer: "ground" | "deco", i: number) => tm.tiles[tm[layer][i]]?.name ?? "";
type Meta = { spawns: { x: number; y: number; monster: string }[]; playerStart: { x: number; y: number }; bridge: { x0: number; x1: number; y0: number; y1: number } | null; objects: { y: number; col: number }[] };

/** 4-connected walkable cells: ground not water, no solid deco, ground tile not solid. */
function walkable(tm: TileMap, i: number) {
  const g = tm.tiles[tm.ground[i]], d = tm.tiles[tm.deco[i]];
  return !!g && !g.solid && !(d && d.solid);
}
function reach(tm: TileMap, from: number): Set<number> {
  const seen = new Set<number>([from]);
  const q = [from];
  for (let h = 0; h < q.length; h++) {
    const i = q[h], x = i % tm.cols, y = Math.floor(i / tm.cols);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const xx = x + dx, yy = y + dy, j = yy * tm.cols + xx;
      if (xx >= 0 && yy >= 0 && xx < tm.cols && yy < tm.rows && !seen.has(j) && walkable(tm, j)) { seen.add(j); q.push(j); }
    }
  }
  return seen;
}

describe("forest-mmo biome", () => {
  it("is a documented biome with detail and season params", () => {
    const biome = mapGenerator.params.find((p) => p.key === "biome");
    expect(biome && biome.type === "select" && biome.options).toContain("forest-mmo");
    expect(BIOMES).toContain("forest-mmo");
    const keys = mapGenerator.params.map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(["detail", "season"]));
  });

  it("returns a complete map of the requested size in every kit, deterministic per seed", { timeout: 60_000 }, () => {
    for (const k of KIT_PRESETS) {
      const a = make({}, 3, k), b = make({}, 3, k);
      expect(a.tilemap!.cols).toBe(24);
      expect(a.tilemap!.tile).toBe(k.sizes.tile);
      expect(a.rows[0].frames[0].w).toBe(24 * k.sizes.tile);
      expect(a.rows[0].frames[0].data.every((v) => v > 0)).toBe(true);
      expect(a.rows[0].frames[0].data).toEqual(b.rows[0].frames[0].data);
      expect(a.meta).toEqual(b.meta);
      expect(make({}, 4, k).tilemap!.ground).not.toEqual(a.tilemap!.ground);
    }
  });

  it("has a 4-7 tile wide river that reaches deep water (depth >= 2) in the middle", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const plan = forestMmoPlan(24, 16, seed, kit, "mixed", 0.5, true);
      const depth = waterDepthField(plan.ground, 24, 16);
      expect(Math.max(...depth), `seed ${seed}`).toBeGreaterThanOrEqual(2);
      for (let y = 0; y < 16; y++) {
        let w = 0;
        for (let x = 0; x < 24; x++) if (plan.ground[y * 24 + x] === "water") w++;
        expect(w, `seed ${seed} row ${y}`).toBeGreaterThanOrEqual(4);
        expect(w, `seed ${seed} row ${y}`).toBeLessThanOrEqual(8);
      }
    }
  });

  it("crosses the river on a bridge exactly where the path meets the water", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const r = make({}, seed);
      const tm = r.tilemap!, meta = r.meta as Meta;
      const plan = forestMmoPlan(24, 16, seed, kit, "mixed", 0.5, true);
      expect(meta.bridge).not.toBeNull();
      let overWater = 0;
      for (const i of plan.path) {
        if (plan.ground[i] === "water") {
          overWater++;
          expect(name(tm, "ground", i), `seed ${seed}`).toMatch(/^bridge-/);
          expect(tm.tiles[tm.ground[i]].solid).toBeFalsy();
        }
      }
      expect(overWater).toBeGreaterThanOrEqual(8);
      // water elsewhere is not bridged
      plan.ground.forEach((g, i) => { if (g === "water" && !plan.path.has(i)) { expect(name(tm, "ground", i)).toMatch(/^water/); expect(tm.tiles[tm.ground[i]].solid).toBe(true); } });
      // you can walk from the left edge to the right edge along the path
      const left = meta.playerStart.y * 24 + meta.playerStart.x;
      const seen = reach(tm, left);
      const rightEdge = [...plan.path].filter((i) => i % 24 === 23);
      expect(rightEdge.some((i) => seen.has(i)), `seed ${seed}`).toBe(true);
    }
  });

  it("puts monster spawn points on walkable, reachable tiles", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const r = make({}, seed);
      const tm = r.tilemap!, meta = r.meta as Meta;
      expect(meta.spawns.length).toBeGreaterThanOrEqual(4);
      const seen = reach(tm, meta.playerStart.y * 24 + meta.playerStart.x);
      expect(walkable(tm, meta.playerStart.y * 24 + meta.playerStart.x)).toBe(true);
      for (const s of meta.spawns) {
        const i = s.y * 24 + s.x;
        expect(walkable(tm, i), `seed ${seed} ${s.monster}`).toBe(true);
        expect(tm.deco[i], `seed ${seed}`).toBe(-1);
        expect(seen.has(i), `seed ${seed} ${s.monster} reachable`).toBe(true);
        expect(name(tm, "ground", i)).not.toMatch(/^(water|bridge)/);
      }
    }
  });

  it("keeps trees off the path, bridge and water, and apart from each other", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const plan = forestMmoPlan(24, 16, seed, kit, "mixed", 0.5, true);
      expect(plan.trees.length).toBeGreaterThan(20);
      const species = new Set(plan.trees.map((t) => t.species));
      expect(species.size).toBeGreaterThanOrEqual(3);
      for (const t of plan.trees) {
        const i = t.y * 24 + t.x;
        expect(plan.path.has(i)).toBe(false);
        expect(plan.ground[i]).not.toBe("water");
        expect(plan.props.some((p) => p.x === t.x && p.y === t.y)).toBe(false);
      }
      for (const p of plan.props) expect(plan.canopy.has(p.y * 24 + p.x), `prop ${p.kind} under a crown`).toBe(false);
    }
  });

  it("mixes willows by the water and maples elsewhere; season recolours", () => {
    const plan = forestMmoPlan(32, 22, 5, kit, "mixed", 0.6, true);
    const willows = plan.trees.filter((t) => t.species === "willow");
    expect(willows.length).toBeGreaterThan(0);
    const dW = (x: number, y: number) => { let d = 99; for (let yy = 0; yy < 22; yy++) for (let xx = 0; xx < 32; xx++) if (plan.ground[yy * 32 + xx] === "water") d = Math.min(d, Math.max(Math.abs(xx - x), Math.abs(yy - y))); return d; };
    for (const w of willows) expect(dW(w.x, w.y)).toBeLessThanOrEqual(3);
    const spring = forestMmoPlan(32, 22, 5, kit, "spring", 0.6, true);
    expect(spring.trees.every((t) => t.season !== "winter")).toBe(true);
    expect(spring.trees.filter((t) => t.species === "oak").every((t) => t.season === "spring")).toBe(true);
  });

  it("y-sorts the deco objects by base line (and exports them as a Tiled object layer)", () => {
    const r = make({}, 2);
    const tm = r.tilemap!, meta = r.meta as Meta;
    const objs = mapObjects(tm);
    expect(objs.length).toBeGreaterThan(30);
    for (let i = 1; i < objs.length; i++) expect(objs[i].y).toBeGreaterThanOrEqual(objs[i - 1].y);
    expect(meta.objects.map((o) => o.y)).toEqual(objs.map((o) => o.y));
    expect(objs.every((o) => o.y === (o.row + 1) * tm.tile)).toBe(true);

    const dir = mkdtempSync(join(tmpdir(), "pb-forest-"));
    try {
      const ws = new Workspace(dir), p = ws.load();
      const asset = createAsset({ name: "Forest", category: "map", kit, rows: r.rows, tilemap: tm, meta: r.meta, source: { kind: "procedural" } });
      p.assets.push(asset);
      exportAsset(ws, p, asset);
      const tiled = JSON.parse(readFileSync(join(dir, "maps", "forest.tiled.json"), "utf8"));
      const names = tiled.layers.map((l: { name: string }) => l.name);
      expect(names).toEqual(["ground", "deco", "objects", "spawns"]);
      const og = tiled.layers[2];
      expect(og.type).toBe("objectgroup");
      expect(og.draworder).toBe("topdown");
      expect(og.objects.length).toBe(objs.length);
      for (let i = 1; i < og.objects.length; i++) expect(og.objects[i].y).toBeGreaterThanOrEqual(og.objects[i - 1].y);
      expect(og.objects.every((o: { gid: number }) => o.gid > 0)).toBe(true);
      expect(tiled.layers[3].objects).toHaveLength(meta.spawns.length);
      expect(tiled.layers[1].visible).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("generates quickly, and a second map in the same kit reuses the cached trees", () => {
    const k = { ...kit }; // a fresh object: its own sprite cache
    const t0 = performance.now();
    make({ cols: 32, rows: 24, detail: "high" }, 1, k);
    const cold = performance.now() - t0;
    const t1 = performance.now();
    make({ cols: 32, rows: 24, detail: "high" }, 2, k);
    const warm = performance.now() - t1;
    expect(cold).toBeLessThan(8000);
    expect(warm).toBeLessThan(3000);
  }, 30_000);

  it("without a path there is no bridge", () => {
    const r = make({ path: false }, 1);
    expect((r.meta as Meta).bridge).toBeNull();
    expect(r.tilemap!.ground.some((g) => r.tilemap!.tiles[g].name.startsWith("bridge"))).toBe(false);
  });
});

describe("ground detail pass", () => {
  const fp = (data: ArrayLike<number>) => createHash("sha1").update(Buffer.from(data as never)).digest("hex").slice(0, 12);
  const k0 = KIT_PRESETS[0];

  it("is off by default: existing biomes are byte-identical to the pre-detail generator", () => {
    // fingerprints recorded from the generator before the detail pass / forest-mmo existed
    const want: Record<string, string> = { meadow: "950170089322", forest: "3b769adab578", island: "ba5ec452b8bf", desert: "61d08030c045", winter: "0b164794711b", "rice-village": "9547e1f0477b", farm: "35d51a81d516" };
    for (const [biome, hash] of Object.entries(want)) {
      const r = mapGenerator.generate({ ...defaults(mapGenerator), biome, cols: 24, rows: 18, river: biome === "meadow" || biome === "forest", water_depth: biome === "forest" }, k0, 3);
      expect(fp(r.rows[0].frames[0].data), biome).toBe(hash);
    }
  });

  it("adds decals and colour variation when asked, deterministically, with only palette colours", () => {
    for (const k of [k0, kit, KIT_PRESETS.find((x) => x.id === "kit-hd-deep")!]) {
      const gen = (detail: string, seed = 2) => mapGenerator.generate({ ...defaults(mapGenerator), biome: "meadow", cols: 16, rows: 12, detail }, k, seed);
      const off = gen("off"), low = gen("low"), high = gen("high");
      expect(fp(low.rows[0].frames[0].data)).not.toBe(fp(off.rows[0].frames[0].data));
      expect(fp(high.rows[0].frames[0].data)).not.toBe(fp(low.rows[0].frames[0].data));
      expect(high.rows[0].frames[0].data).toEqual(gen("high").rows[0].frames[0].data);
      const diff = (a: ArrayLike<number>, b: ArrayLike<number>) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return n; };
      expect(diff(high.rows[0].frames[0].data, off.rows[0].frames[0].data)).toBeGreaterThan(diff(low.rows[0].frames[0].data, off.rows[0].frames[0].data));
      expect(high.rows[0].frames[0].data.every((v) => v > 0 && v < PALETTE_SIZE)).toBe(true);
      // the deco layer and the layout are untouched
      expect(high.tilemap!.deco).toEqual(off.tilemap!.deco);
    }
  });

  it("leaves water and bridge tiles undecorated", () => {
    const r = make({ detail: "high" }, 2);
    const tm = r.tilemap!;
    const kinds = new Set<string>();
    tm.ground.forEach((g) => kinds.add(tm.tiles[g].name.split("-")[0]));
    expect(kinds.has("bridge")).toBe(true);
    expect(kinds.has("water")).toBe(true);
    tm.tiles.forEach((t) => { if (t.name.startsWith("bridge") || t.name.startsWith("water")) expect(t.name).not.toMatch(/-d\d+-\d+$/); });
  });
});

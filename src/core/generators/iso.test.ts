import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAsset } from "../asset";
import { ALL_KIT_PRESETS, DEFAULT_KIT, ISO_KIT, KIT_PRESETS } from "../kit";
import { PALETTE_SIZE } from "../palette";
import { renderRig, ISO_NAME } from "../rig";
import { EXAMPLE_RIG, WALK } from "../rigs/example";
import { Workspace, exportAsset } from "../../node/workspace";
import { defaults, generatorById, type Params } from "./index";
import { diamondRows, isoTile, isoTileW, ISO_PROP_MARGIN, type IsoTileKind } from "./iso";
import { isoPropOrigin, planIsoMap } from "./isomap";

const gen = (id: string, p: Params = {}, kit = ISO_KIT, seed = 1) => {
  const g = generatorById(id)!;
  return g.generate({ ...defaults(g), ...p }, kit, seed);
};
const flat = (res: ReturnType<typeof gen>) => res.rows.flatMap((r) => r.frames.map((f) => f.data.join(","))).join("|");
const KINDS: IsoTileKind[] = ["grass", "dirt", "sand", "water", "stone"];

describe("kit-iso", () => {
  it("is a seeded preset (outside the pinned KIT_PRESETS list) with the iso camera and a 2:1 tile", () => {
    expect(ALL_KIT_PRESETS.find((k) => k.id === "kit-iso")).toMatchObject({ camera: "iso", sizes: { tile: 32 } });
    expect(isoTileW(ISO_KIT)).toBe(32);
  });

  it("diamond rows partition the plane when placed on the iso lattice", () => {
    for (const T of [16, 24, 32, 48]) {
      const rows = diamondRows(T), TH = T / 2;
      expect(rows).toHaveLength(TH);
      const N = 6, W = (N + 1) * T, H = (N + 1) * TH;
      const hits = new Uint8Array(W * H);
      for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++) {
          const ox = (c - r + N) * (T / 2), oy = (c + r) * (TH / 2);
          rows.forEach(([x0, x1], y) => { for (let x = x0; x < x1; x++) hits[(oy + y) * W + ox + x]++; });
        }
      expect(Math.max(...hits)).toBe(1); // no overlap
      // the central band (all four neighbours present) has no holes
      for (let y = N * (TH / 2) - TH; y <= N * (TH / 2) + TH; y++) for (let x = (N * T) / 2 - T; x <= (N * T) / 2 + T; x++) expect(hits[y * W + x]).toBe(1);
    }
  });

  it("every ground kind fills exactly the diamond, with no outline and no stray pixels", () => {
    for (const kit of [ISO_KIT, { ...ISO_KIT, outline: "black" as const }])
      for (const kind of KINDS) {
        const s = isoTile(kit, kind, 3, 1, 0);
        const rows = diamondRows(32);
        expect([s.w, s.h]).toEqual([32, 16]);
        for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) expect(s.data[y * s.w + x] > 0).toBe(x >= rows[y][0] && x < rows[y][1]);
      }
  });

  it("raised blocks keep the same top diamond and hang walls below it (left lit, right shaded)", () => {
    const s = isoTile(ISO_KIT, "stone", 1, 0, 2);
    expect([s.w, s.h]).toEqual([32, 16 + 16]);
    const lit = s.data[(16 + 6) * 32 + 4], shaded = s.data[(16 + 6) * 32 + 27];
    expect(lit).toBeGreaterThan(0);
    expect(shaded).toBeGreaterThan(0);
    expect(lit).not.toBe(shaded);
  });

  it("tiles stay seamless at 16px (gameboy) and tile-based kits", () => {
    const kit = { ...KIT_PRESETS.find((k) => k.id === "kit-gameboy")!, camera: "iso" as const };
    const s = isoTile(kit, "grass", 1, 0, 0);
    expect([s.w, s.h]).toEqual([16, 8]);
  });
});

describe("iso generators", () => {
  const cases: [string, Params][] = [
    ["iso-tile", { kind: "grass" }], ["iso-tile", { kind: "water" }], ["iso-tile", { kind: "stone", height: 2 }],
    ["iso-prop", { kind: "tree" }], ["iso-prop", { kind: "pine" }], ["iso-prop", { kind: "rock" }], ["iso-prop", { kind: "bush" }],
    ["iso-prop", { kind: "fence-se" }], ["iso-prop", { kind: "fence-sw" }], ["iso-prop", { kind: "post" }],
    ["iso-building", {}], ["iso-building", { size: 1 }], ["iso-building", { size: 3, wall: "stone" }],
    ["isomap", {}],
  ];
  it("are deterministic per seed and valid in every kit", () => {
    for (const [id, p] of cases) {
      expect(flat(gen(id, p, ISO_KIT, 5))).toBe(flat(gen(id, p, ISO_KIT, 5)));
      for (const kit of KIT_PRESETS) {
        const res = gen(id, p, { ...kit, camera: "iso" as const }, 2);
        for (const f of res.rows.flatMap((r) => r.frames)) {
          expect(f.data.every((v) => v >= 0 && v < PALETTE_SIZE)).toBe(true);
          expect(f.data.some(Boolean)).toBe(true);
        }
      }
    }
  });

  it("seeds change textured output", () => {
    expect(flat(gen("iso-tile", { kind: "grass" }, ISO_KIT, 1))).not.toBe(flat(gen("iso-tile", { kind: "grass" }, ISO_KIT, 2)));
    expect(flat(gen("isomap", {}, ISO_KIT, 1))).not.toBe(flat(gen("isomap", {}, ISO_KIT, 2)));
  });

  it("props keep a transparent margin and the foot row", () => {
    for (const kind of ["tree", "pine", "rock", "bush", "fence-se", "fence-sw", "post"]) {
      const s = gen("iso-prop", { kind }).rows[0].frames[0];
      expect(s.data.slice((s.h - ISO_PROP_MARGIN) * s.w).every((v) => v === 0)).toBe(true);
      expect(s.data.slice(0, s.w).every((v) => v === 0)).toBe(true);
    }
  });

  it("the house shows two walls with different shades and fits its footprint", () => {
    const s = gen("iso-building").rows[0].frames[0];
    expect(s.w).toBeGreaterThanOrEqual(64);
    const left = new Set<number>(), right = new Set<number>();
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { const v = s.data[y * s.w + x]; if (v) (x < s.w / 2 ? left : right).add(v); }
    expect(left.size).toBeGreaterThan(3);
    expect(right.size).toBeGreaterThan(3);
  });
});

describe("iso map", () => {
  it("is an isometric tilemap with consistent sizes, heights and a reachable house lot", () => {
    const res = gen("isomap", { cols: 12, rows: 10 });
    const tm = res.tilemap!;
    expect(tm).toMatchObject({ orientation: "isometric", cols: 12, rows: 10, tile: 32 });
    expect(tm.ground).toHaveLength(120);
    expect(tm.heights).toHaveLength(120);
    expect(tm.ground.every((g) => g >= 0 && g < tm.tiles.length)).toBe(true);
    expect(res.meta).toMatchObject({ camera: "iso" });
    // ground tiles share one canvas so Tiled can bottom-align them
    const sizes = new Set(tm.tiles.filter((t) => /^(grass|dirt|sand|water|stone)/.test(t.name)).map((t) => `${t.sprite.w}x${t.sprite.h}`));
    expect(sizes.size).toBe(1);
    const plan = planIsoMap(12, 10, 1, 0.3, true, 2);
    if (plan.house) for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) expect(plan.kind[(plan.house.r + j) * 12 + plan.house.c + i]).toBe("grass");
  });

  it("props stand on cell centres: foot of every prop is inside its diamond", () => {
    const tm = gen("isomap").tilemap!;
    for (let r = 0; r < tm.rows; r++)
      for (let c = 0; c < tm.cols; c++) {
        const d = tm.tiles[tm.deco[r * tm.cols + c]];
        if (!d) continue;
        const [ox, oy] = isoPropOrigin(tm, c, r, d.sprite);
        expect(ox + d.sprite.w / 2).toBe(((c - r + tm.rows) * tm.tile) / 2);
        expect(oy + d.sprite.h - ISO_PROP_MARGIN).toBeGreaterThan(0);
      }
  });

  it("exports to Tiled as an isometric map: ground tile layer + y-sorted object layer", () => {
    const dir = mkdtempSync(join(tmpdir(), "pb-iso-"));
    try {
      const ws = new Workspace(dir);
      const p = ws.load();
      const res = gen("isomap", { cols: 10, rows: 10 });
      const map = createAsset({ name: "Iso", category: "map", kit: ISO_KIT, rows: res.rows, tilemap: res.tilemap, source: { kind: "procedural" } });
      p.assets.push(map);
      exportAsset(ws, p, map);
      const tiled = JSON.parse(readFileSync(join(dir, "maps", "iso.tiled.json"), "utf8"));
      expect(tiled).toMatchObject({ type: "map", orientation: "isometric", width: 10, height: 10, tilewidth: 32, tileheight: 16 });
      expect(tiled.layers[0]).toMatchObject({ name: "ground", type: "tilelayer" });
      expect(tiled.layers[0].data).toHaveLength(100);
      expect(tiled.layers[1]).toMatchObject({ name: "props", type: "objectgroup", draworder: "topdown" });
      expect(tiled.layers[1].objects.length).toBeGreaterThan(0);
      expect(tiled.layers[1].objects[0]).toHaveProperty("gid");
      expect(tiled.tilesets[0].tileheight).toBe(32);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("orthogonal maps still export orthogonal", () => {
    expect(DEFAULT_KIT.camera).toBeUndefined();
    expect(generatorById("map")!.generate(defaults(generatorById("map")!), DEFAULT_KIT, 1).tilemap!.orientation).toBeUndefined();
  });
});

describe("iso rigs", () => {
  it("name rows by iso compass point: 4 = diagonals, 8 adds the axes", () => {
    const rows = renderRig({ rig: EXAMPLE_RIG, kit: ISO_KIT }, [WALK]);
    expect(rows.map((r) => r.name)).toEqual(["walk-se", "walk-sw", "walk-ne", "walk-nw"]);
    const eight = renderRig({ rig: EXAMPLE_RIG, kit: ISO_KIT }, [WALK], { directions: 8 });
    expect(eight.map((r) => r.name).sort()).toEqual(Object.values(ISO_NAME).map((n) => `walk-${n}`).sort());
    for (const f of rows.flatMap((r) => r.frames)) expect([f.w, f.h]).toEqual([32, 32]);
  });

  it("the character generator renders the iso rows, and non-iso kits keep walk-down", () => {
    expect(gen("character").rows.map((r) => r.name)).toEqual(["walk-se", "walk-sw", "walk-ne", "walk-nw"]);
    expect(gen("character", {}, DEFAULT_KIT).rows.map((r) => r.name)).toEqual(["walk-down", "walk-left", "walk-right", "walk-up"]);
  });
});

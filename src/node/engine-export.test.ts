import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAsset } from "../core/asset";
import { DEFAULT_KIT } from "../core/kit";
import { tilesetGenerator } from "../core/generators/tileset";
import { defaults } from "../core/generators/types";
import { createSprite } from "../core/sprite";
import { decodePng } from "./png";
import { ToolError, Workspace, exportAsset } from "./workspace";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pb-tiles-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function tilesetAsset(layout: "wang16" | "blob47") {
  const r = tilesetGenerator.generate({ ...defaults(tilesetGenerator), layout }, DEFAULT_KIT, 7);
  return createAsset({ name: `Grass ${layout}`, category: "environment", kit: DEFAULT_KIT, rows: r.rows, fps: r.fps, meta: r.meta, source: { kind: "procedural", generator: "tileset" } });
}
const run = (layout: "wang16" | "blob47", format: "tiled-tileset" | "godot" | "unity" | "atlas", scale = 1) => {
  const ws = new Workspace(dir);
  const p = ws.load();
  const a = tilesetAsset(layout);
  p.assets.push(a);
  return exportAsset(ws, p, a, { format, scale });
};
const text = (files: { path: string }[], ext: string) => readFileSync(files.find((f) => f.path.endsWith(ext))!.path, "utf8");

describe("engine tileset export", () => {
  it("tiled-tileset: valid .tsj with a corner wangset for wang16", () => {
    const files = run("wang16", "tiled-tileset");
    const png = decodePng(readFileSync(files[0].path));
    const t = JSON.parse(text(files, ".tsj"));
    expect(t).toMatchObject({ type: "tileset", tilewidth: 16, tilecount: 16, columns: 4, imagewidth: png.width, imageheight: png.height });
    const ws = t.wangsets[0];
    expect(ws.type).toBe("corner");
    expect(ws.colors).toHaveLength(2);
    expect(ws.wangtiles).toHaveLength(16);
    // tile 5 = NE + SW upper -> topright, bottomleft = 2; edges 0
    expect(ws.wangtiles.find((w: any) => w.tileid === 5).wangid).toEqual([0, 2, 0, 1, 0, 2, 0, 1]);
    expect(ws.wangtiles.find((w: any) => w.tileid === 15).wangid).toEqual([0, 2, 0, 2, 0, 2, 0, 2]);
  });

  it("tiled-tileset: mixed wangset for blob47 (47 wangtiles incl. the plain lower filler)", () => {
    const t = JSON.parse(text(run("blob47", "tiled-tileset"), ".tsj"));
    expect(t.wangsets[0].type).toBe("mixed");
    expect(t.wangsets[0].wangtiles).toHaveLength(47);
    expect(t.tilecount).toBe(48);
    const ids = t.wangsets[0].wangtiles.map((w: any) => w.tileid);
    expect(ids).not.toContain(0);
    expect(ids).toContain(47);
  });

  it("godot: TileSet resource with an atlas source, terrain set and peering bits", () => {
    const wang = text(run("wang16", "godot"), ".tres");
    expect(wang).toMatch(/^\[gd_resource type="TileSet" load_steps=3 format=3\]/);
    expect(wang).toContain('[ext_resource type="Texture2D" path="res://grass-wang16.png"');
    expect(wang).toContain('[sub_resource type="TileSetAtlasSource"');
    expect(wang).toContain("[resource]");
    expect(wang).toContain("terrain_set_0/mode = 1");
    expect(wang.match(/^\d+:\d+\/0 = 0$/gm)).toHaveLength(16);
    expect(wang).not.toContain("right_side");
    // tile index 1 sits at 1:0 with only its NE corner upper
    expect(wang).toContain("1:0/0/terrains_peering_bit/top_right_corner = 1");
    expect(wang).toContain("1:0/0/terrains_peering_bit/bottom_left_corner = 0");
    const blob = text(run("blob47", "godot"), ".tres");
    expect(blob).toContain("terrain_set_0/mode = 0");
    expect(blob.match(/^\d+:\d+\/0 = 0$/gm)).toHaveLength(48);
    expect(blob).toContain("right_side");
  });

  it("unity: slice rects and neighbour rules parse and agree with the masks", () => {
    const files = run("blob47", "unity", 2);
    const r = JSON.parse(text(files, ".rules.json"));
    expect(r.tileSize).toBe(32);
    expect(r.sprites).toHaveLength(48);
    const t1 = r.tiles[1]; // mask 4 = E only? ascending masks: 0, 1(N), ...
    expect(t1.mask).toBe(1);
    expect(t1.neighbours.N).toBe("upper");
    expect(t1.ruleNeighbors).toEqual([2, 1, 2, 2, 2, 2, 2, 2]);
    expect(r.tiles[0].rect).toEqual({ x: 0, y: 0, w: 32, h: 32 });
    expect(r.tiles[0].unityRect.y).toBe(r.imageHeight - 32);
    expect(decodePng(readFileSync(files[0].path)).width).toBe(8 * 32);
  });

  it("atlas: PNG + JSON index", () => {
    const files = run("wang16", "atlas");
    expect(files.map((f) => f.kind)).toEqual(["tileset", "engine"]);
    const a = JSON.parse(text(files, ".atlas.json"));
    expect(a).toMatchObject({ layout: "wang16", cols: 4, rows: 4, tileSize: 16, upper: "grass", lower: "dirt" });
    expect(a.tiles).toHaveLength(16);
    expect(a.tiles[6]).toMatchObject({ index: 6, x: 32, y: 16 });
  });

  it("refuses assets that are not tilesets", () => {
    const ws = new Workspace(dir);
    const p = ws.load();
    const a = createAsset({ name: "Gem", category: "object", kit: DEFAULT_KIT, rows: [{ name: "idle", frames: [createSprite(4, 4)] }], source: { kind: "manual" } });
    p.assets.push(a);
    expect(() => exportAsset(ws, p, a, { format: "godot" })).toThrow(ToolError);
  });
});

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAsset } from "../core/asset";
import { DEFAULT_KIT } from "../core/kit";
import { parseProject } from "../core/project";
import { colorIndex } from "../core/palette";
import { createSprite } from "../core/sprite";
import { emptyTileMap, renderTileMap } from "../core/tilemap";
import { decodePng } from "./png";
import { CATEGORY_DIR, ToolError, Workspace, exportAsset, exportSlug, findAsset, resolveWorkspaceDir, slugify } from "./workspace";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pb-ws-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function sprite(w = 4, h = 4) {
  const s = createSprite(w, h);
  s.data[0] = colorIndex("roof", 3);
  s.data[w * h - 1] = colorIndex("water", 2);
  return s;
}
const staticAsset = (name: string, category: "object" | "ui" = "object") =>
  createAsset({ name, category, kit: DEFAULT_KIT, rows: [{ name: "idle", frames: [sprite()] }], source: { kind: "manual" } });

describe("workspace", () => {
  it("resolves the directory: explicit > env > ./pixel-assets", () => {
    const saved = process.env.PIXEL_BUILDER_WORKSPACE;
    try {
      delete process.env.PIXEL_BUILDER_WORKSPACE;
      expect(resolveWorkspaceDir()).toBe(join(process.cwd(), "pixel-assets"));
      process.env.PIXEL_BUILDER_WORKSPACE = join(dir, "from-env");
      expect(resolveWorkspaceDir()).toBe(join(dir, "from-env"));
      expect(resolveWorkspaceDir(join(dir, "explicit"))).toBe(join(dir, "explicit"));
    } finally {
      if (saved === undefined) delete process.env.PIXEL_BUILDER_WORKSPACE;
      else process.env.PIXEL_BUILDER_WORKSPACE = saved;
    }
  });

  it("loads an empty project when nothing is saved yet, and writes nothing", () => {
    const ws = new Workspace(join(dir, "new"));
    expect(ws.load().assets).toEqual([]);
    expect(existsSync(ws.dir)).toBe(false);
  });

  it("saves atomically in the shared ProjectFile format and loads it back", () => {
    const ws = new Workspace(join(dir, "ws"));
    const p = ws.load();
    p.assets.push(staticAsset("Gem"));
    ws.save(p);
    expect(readdirSync(ws.dir)).toEqual(["pixel-builder.json"]); // no temp files left behind
    const text = readFileSync(ws.projectPath, "utf8");
    expect(parseProject(text).project.assets[0].name).toBe("Gem"); // plain parseProject reads it
    expect(text.split("\n").length).toBeLessThan(200); // one asset per line, not one number per line
    expect(new Workspace(ws.dir).load().assets[0].rows[0].frames[0].data).toEqual(p.assets[0].rows[0].frames[0].data);
  });

  it("refuses to overwrite a corrupt project file", () => {
    const ws = new Workspace(dir);
    writeFileSync(ws.projectPath, "{ nope");
    expect(() => ws.load()).toThrow(ToolError);
    expect(() => ws.load()).toThrow(/was not modified/);
    expect(readFileSync(ws.projectPath, "utf8")).toBe("{ nope");
  });

  it("reports dropped invalid assets as warnings", () => {
    const ws = new Workspace(dir);
    writeFileSync(ws.projectPath, JSON.stringify({ format: "pixel-builder/project", version: 1, assets: [{ id: "x" }] }));
    ws.load();
    expect(ws.warnings.join()).toMatch(/Dropped invalid asset/);
  });

  it("finds assets by id or unambiguous name and suggests near misses", () => {
    const ws = new Workspace(dir);
    const p = ws.load();
    const a = staticAsset("Oak Tree"), b = staticAsset("Pine"), c = staticAsset("Pine");
    p.assets.push(a, b, c);
    expect(findAsset(p, a.id)).toBe(a);
    expect(findAsset(p, "oak tree")).toBe(a);
    expect(() => findAsset(p, "pine")).toThrow(/matches 2 assets/);
    expect(() => findAsset(p, "oak")).toThrow(/Did you mean: .*Oak Tree/);
  });
});

describe("export layout", () => {
  it("slugifies names and disambiguates duplicates by creation order", () => {
    expect(slugify("  Big Oak Tree!! ")).toBe("big-oak-tree");
    expect(slugify("???")).toBe("asset");
    const ws = new Workspace(dir);
    const p = ws.load();
    const a = staticAsset("Rock"), b = staticAsset("rock");
    b.createdAt = a.createdAt + 1;
    p.assets.push(b, a);
    expect(exportSlug(p, a)).toBe("rock");
    expect(exportSlug(p, b)).toBe("rock-2");
  });

  it("puts static assets in <category>s/<slug>.png (ui in ui/) as decodable, scaled PNGs", () => {
    expect(CATEGORY_DIR.ui).toBe("ui");
    const ws = new Workspace(dir);
    const p = ws.load();
    const gem = staticAsset("Gem"), panel = staticAsset("Panel", "ui");
    p.assets.push(gem, panel);
    const [f] = exportAsset(ws, p, gem, { scale: 4 });
    expect(f.path).toBe(join(dir, "objects", "gem.png"));
    const img = decodePng(readFileSync(f.path));
    expect([img.width, img.height]).toEqual([16, 16]);
    expect(img.rgba[3]).toBe(255);
    expect(img.rgba[(8 * 16 + 8) * 4 + 3]).toBe(0);
    expect(exportAsset(ws, p, panel)[0].path).toBe(join(dir, "ui", "panel.png"));
  });

  it("exports animated assets as a spritesheet with .json metadata", () => {
    const ws = new Workspace(dir);
    const p = ws.load();
    const walk = createAsset({
      name: "Walker", category: "character", kit: DEFAULT_KIT, fps: 8, source: { kind: "manual" },
      rows: [{ name: "walk-down", frames: [sprite(), sprite(), sprite()] }, { name: "walk-up", frames: [sprite(), sprite(), sprite()] }],
    });
    p.assets.push(walk);
    const files = exportAsset(ws, p, walk, { scale: 2 });
    expect(files.map((f) => f.kind)).toEqual(["spritesheet", "sheet-json"]);
    const img = decodePng(readFileSync(files[0].path));
    expect([img.width, img.height]).toEqual([3 * 4 * 2, 2 * 4 * 2]);
    const meta = JSON.parse(readFileSync(files[1].path, "utf8"));
    expect(meta).toMatchObject({ image: "walker.png", frameWidth: 8, frameHeight: 8, columns: 3, rows: 2, fps: 8 });
    expect(meta.animations).toEqual([{ name: "walk-down", row: 0, frames: 3 }, { name: "walk-up", row: 1, frames: 3 }]);
  });

  it("forces a sheet for 'spritesheet' and rejects 'tiled' for non-maps", () => {
    const ws = new Workspace(dir);
    const p = ws.load();
    const gem = staticAsset("Gem");
    p.assets.push(gem);
    expect(exportAsset(ws, p, gem, { format: "spritesheet" }).map((f) => f.kind)).toEqual(["spritesheet", "sheet-json"]);
    expect(() => exportAsset(ws, p, gem, { format: "tiled" })).toThrow(/not a map/);
  });

  it("exports maps as png + Tiled json with ground and deco tilesets", () => {
    const ws = new Workspace(dir);
    const p = ws.load();
    const tm = emptyTileMap(3, 2, 4);
    const grass = createSprite(4, 4, colorIndex("grass", 2));
    const tree = createSprite(6, 8, colorIndex("foliage", 2));
    tm.tiles.push({ name: "grass", sprite: grass }, { name: "tree", sprite: tree, solid: true });
    tm.ground.fill(0);
    tm.deco[1] = 1;
    const map = createAsset({ name: "Meadow", category: "map", kit: DEFAULT_KIT, rows: [{ name: "map", frames: [renderTileMap(tm)] }], tilemap: tm, source: { kind: "procedural" } });
    p.assets.push(map);
    const files = exportAsset(ws, p, map);
    expect(files.map((f) => f.path.split("/").pop()).sort()).toEqual(["meadow.deco.png", "meadow.png", "meadow.tiled.json", "meadow.tileset.png"]);
    const tiled = JSON.parse(readFileSync(join(dir, "maps", "meadow.tiled.json"), "utf8"));
    expect(tiled).toMatchObject({ type: "map", width: 3, height: 2, tilewidth: 4, orientation: "orthogonal" });
    expect(tiled.layers[0].data).toEqual([1, 1, 1, 1, 1, 1]);
    expect(tiled.layers[1].data).toEqual([0, 2, 0, 0, 0, 0]);
    expect(tiled.tilesets.map((t: { firstgid: number }) => t.firstgid)).toEqual([1, 2]);
    expect(tiled.tilesets[1]).toMatchObject({ tilewidth: 6, tileheight: 8, tileoffset: { x: -1, y: 0 } });
    expect(tiled.tilesets[1].tiles[0].properties[1]).toEqual({ name: "solid", type: "bool", value: true });
    expect(existsSync(join(dir, "maps", "meadow.deco.png"))).toBe(true);
  });
});

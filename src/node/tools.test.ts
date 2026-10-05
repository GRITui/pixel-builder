import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GENERATORS } from "../core/generators";
import { decodePng, blankImage, encodePng } from "./png";
import { TOOLS, ToolError, callTool, type ToolResult } from "./tools";
import { Workspace } from "./workspace";

let dir: string;
let ws: Workspace;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pb-tools-"));
  ws = new Workspace(join(dir, "ws"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const call = (name: string, input: unknown = {}): ToolResult => callTool(ws, name, input);
const data = (name: string, input: unknown = {}): any => call(name, input).data;
const isPng = (b: Buffer) => b.subarray(1, 4).toString() === "PNG";

describe("tool contract", () => {
  it("exposes exactly the planned tool names", () => {
    expect(TOOLS.map((t) => t.name)).toEqual([
      "get_style_guide", "list_generators", "generate_asset", "generate_variations", "paint_asset", "edit_asset", "edit_region", "list_assets",
      "get_asset", "delete_asset", "export_asset", "import_image", "list_kits", "create_kit", "update_kit", "set_active_kit", "rerender_assets",
      "list_rigs", "list_clips", "list_attachments", "generate_rigged", "attach", "create_rig", "create_clip", "create_attachment",
      "generate_pack", "import_svg", "add_reference", "list_references", "get_reference", "delete_reference", "kit_from_reference",
    ]);
    for (const t of TOOLS) expect(t.description.length).toBeGreaterThan(20);
  });

  it("validates input with actionable errors", () => {
    expect(() => call("nope")).toThrow(/Unknown tool 'nope'/);
    expect(() => call("generate_asset", {})).toThrow(/generator/);
    expect(() => call("generate_asset", { generator: "environment", bogus: 1 })).toThrow(/unknown input 'bogus'/);
    expect(() => call("generate_variations", { generator: "environment", count: 13 })).toThrow(/count/);
    expect(() => call("paint_asset", { name: "x", category: "object", width: 0, height: 4, frames: [["."]] })).toThrow(/width/);
  });

  it("generate_rigged takes directions 4 (default) or 8", () => {
    const rows = (a: any) => a.rows ?? a.animations?.map((r: any) => r.name);
    const a4 = data("generate_rigged", { rig: "humanoid-normal", clips: ["walk"], name: "d4", save: false }).asset;
    const a8 = data("generate_rigged", { rig: "humanoid-normal", clips: ["walk"], directions: 8, name: "d8", save: false }).asset;
    expect(JSON.stringify(a8)).toContain("walk-down-right");
    expect(JSON.stringify(a4)).not.toContain("walk-down-right");
    void rows;
    expect(() => call("generate_rigged", { rig: "humanoid-normal", directions: 6 })).toThrow();
  });
});

describe("get_style_guide / list_generators", () => {
  it("returns the kit summary, palette legend and rules", () => {
    const r = call("get_style_guide");
    const d = r.data as any;
    expect(d.kit).toMatchObject({ id: "kit-default", active: true, outline: "selective", shade_steps: 4 });
    expect(d.legend).toContain(". = transparent");
    expect(d.legend).toMatch(/roof level 3 \(#/);
    expect(d.legend_entries).toHaveLength(95); // 18 base materials + blossom
    expect(d.rules.join(" ")).toMatch(/levels 1, 2, 3, 4/);
    expect(r.text).toContain("## Palette legend");
  });

  it("limits the legend to requested materials and honours kit_id", () => {
    const d = data("get_style_guide", { kit_id: "kit-gameboy", materials: ["wood"] });
    expect(d.legend_entries.every((e: { material: string }) => e.material === "wood")).toBe(true);
    expect(d.kit.id).toBe("kit-gameboy");
    expect(() => call("get_style_guide", { kit_id: "nope" })).toThrow(/Unknown kit 'nope'.*kit-default/);
  });

  it("lists generators with param specs, filtered by category", () => {
    const all = data("list_generators").generators;
    expect(all.map((g: { id: string }) => g.id)).toEqual(GENERATORS.map((g) => g.id));
    const env = data("list_generators", { category: "environment" }).generators;
    expect(env.map((g: { id: string }) => g.id)).toEqual(["environment", "tileset", "sideview", "foliage", "iso-tile", "iso-prop", "crop"]);
    expect(env[0].params.find((p: { key: string }) => p.key === "kind").options).toContain("oak");
    expect(env[0].defaults.kind).toBe("oak");
  });
});

describe("generate_asset / generate_variations", () => {
  it("generates, saves, exports and previews; same seed gives same pixels", () => {
    const r = call("generate_asset", { generator: "environment", params: { kind: "oak" }, seed: 42, name: "Oak" });
    const d = r.data as any;
    expect(d.saved).toBe(true);
    expect(d.asset).toMatchObject({ name: "Oak", category: "environment", width: 32, source: { kind: "procedural", generator: "environment", seed: 42 } });
    // trees are animated (sway, chop, fall), so they export a sheet plus its frame map
    expect(d.asset.files).toEqual([join(ws.dir, "environments", "oak.png"), join(ws.dir, "environments", "oak.json")]);
    expect(existsSync(d.asset.files[0])).toBe(true);
    expect(r.images).toHaveLength(1);
    expect(isPng(r.images![0].png)).toBe(true);
    const pv = decodePng(r.images![0].png);
    expect(Math.max(pv.width, pv.height)).toBeGreaterThanOrEqual(256);
    expect(ws.load().assets).toHaveLength(1);

    const again = data("generate_asset", { generator: "environment", params: { kind: "oak" }, seed: 42, name: "Oak again" });
    expect(readFileSync(again.asset.files[0]).equals(readFileSync(d.asset.files[0]))).toBe(true);
  });

  it("does not save or export with save=false", () => {
    const r = call("generate_asset", { generator: "object", save: false });
    expect((r.data as any).saved).toBe(false);
    expect((r.data as any).asset.files).toEqual([]);
    expect(r.images).toHaveLength(1);
    expect(ws.load().assets).toHaveLength(0);
    expect(existsSync(ws.dir)).toBe(false);
  });

  it("exports animated characters as sheet + json", () => {
    const d = data("generate_asset", { generator: "character", seed: 1, name: "Hero" });
    expect(d.asset.rows.map((r: { name: string }) => r.name)).toEqual(["walk-down", "walk-left", "walk-right", "walk-up"]);
    expect(d.asset.files.map((f: string) => f.split("/").pop())).toEqual(["hero.png", "hero.json"]);
  });

  it("gives actionable errors for unknown generators and params", () => {
    expect(() => call("generate_asset", { generator: "tre" })).toThrow(/Unknown generator 'tre'\. Generators: character,/);
    expect(() => call("generate_asset", { generator: "oak" })).toThrow(/Unknown generator 'oak'\. Generators: /);
    expect(() => call("generate_asset", { generator: "nope" })).toThrow(/^(?!.*with params)/);
    expect(() => call("generate_asset", { generator: "enviroment" })).toThrow(/Did you mean 'environment'\?/);
    expect(() => call("generate_asset", { generator: "environment", params: { kind: "tre" } })).toThrow(/Param 'kind'.*Did you mean 'dead-tree'/);
    expect(() => call("generate_asset", { generator: "environment", params: { knd: "oak" } })).toThrow(/no param 'knd'.*Did you mean 'kind'/);
    expect(() => call("generate_asset", { generator: "environment", params: { foliage: "stone-ish" } })).toThrow(/must be a material/);
  });

  it("accepts string-typed numbers/bools and clamps out-of-range numbers with a note", () => {
    const d = data("generate_asset", { generator: "building", params: { floors: "99", chimney: "false" }, seed: 3, save: false });
    expect(d.asset.source.params).toMatchObject({ floors: 3, chimney: false });
    expect(d.notes[0]).toMatch(/floors.*clamped/);
  });

  it("makes numbered contact sheets without saving anything", () => {
    const r = call("generate_variations", { generator: "environment", count: 5, vary: "params", params: { kind: "bush" } });
    const d = r.data as any;
    expect(d.variations).toHaveLength(5);
    expect(d.variations.every((v: { params: { kind: string } }) => v.params.kind === "bush")).toBe(true);
    expect(new Set(d.variations.map((v: { seed: number }) => v.seed)).size).toBe(5);
    expect(r.images).toHaveLength(1);
    expect(decodePng(r.images![0].png).width).toBeGreaterThan(256);
    expect(ws.load().assets).toHaveLength(0);
    const bySeed = data("generate_variations", { generator: "environment", count: 3 }).variations;
    expect(new Set(bySeed.map((v: { params: unknown }) => JSON.stringify(v.params))).size).toBe(1);
  });
});

describe("paint_asset / edit_asset / get_asset", () => {
  const frame = ["........", "..tttt..", ".tssssr.", ".tsssrr.", ".sssrrr.", "..srrr..", "...rr...", "........"];

  it("paints from legend rows, outlines it, saves and exports", () => {
    const r = call("paint_asset", { name: "Gem", category: "object", width: 8, height: 8, frames: [frame] });
    const d = r.data as any;
    expect(d.asset).toMatchObject({ name: "Gem", width: 8, height: 8, source: { kind: "ai-pixels" } });
    expect(existsSync(join(ws.dir, "objects", "gem.png"))).toBe(true);
    const pix = data("get_asset", { id: "Gem", include_pixels: true }).pixels[0].frames[0] as string[];
    expect(pix[0]).toMatch(/[^.]/); // outline was added on the top margin row
    expect(pix[3]).toContain("s");
    expect(r.images).toHaveLength(1);
  });

  it("splits frames across row_names, and reports sloppy rows", () => {
    const d = data("paint_asset", { name: "Blink", category: "object", width: 4, height: 4, frames: [["tt..", "ts..", "....", "...."], ["tt", "ss"], ["tt..", "ts..", "....", "...."], ["tt..", "ts..", "....", "...."]], row_names: ["a", "b"], outline: false });
    expect(d.asset.rows).toEqual([{ name: "a", frames: 2 }, { name: "b", frames: 2 }]);
    expect(d.notes.join()).toMatch(/frame 1: 2 rows, expected 4/);
    expect(() => call("paint_asset", { name: "x", category: "object", width: 4, height: 4, frames: [["tt"], ["tt"], ["tt"]], row_names: ["a", "b"] })).toThrow(/cannot be split evenly/);
    expect(() => call("paint_asset", { name: "x", category: "object", width: 4, height: 4, frames: [["....", "....", "....", "...."]] })).toThrow(/no painted pixels/);
    expect(() => call("paint_asset", { name: "x", category: "map", width: 4, height: 4, frames: [["tttt"]] })).toThrow(/cannot create maps/);
  });

  it("edits pixels and whole rows, renames, tags and re-exports", () => {
    call("paint_asset", { name: "Gem", category: "object", width: 8, height: 8, frames: [frame], outline: false, cleanup: false });
    const id = (data("list_assets").assets[0] as { id: string }).id;
    const before = data("get_asset", { id, include_pixels: true }).pixels[0].frames[0] as string[];
    expect(before[3][3]).toBe("s");
    const d = data("edit_asset", { id, pixels: [{ x: 3, y: 3, char: "j" }, { x: 0, y: 0, char: "a" }], name: "Shiny Gem", tags: ["loot", "loot", "gem"] });
    expect(d.asset).toMatchObject({ name: "Shiny Gem", tags: ["loot", "gem"] });
    const after = data("get_asset", { id, include_pixels: true }).pixels[0].frames[0] as string[];
    expect(after[3][3]).toBe("j");
    expect(after[0][0]).toBe("a");
    expect(existsSync(join(ws.dir, "objects", "shiny-gem.png"))).toBe(true);

    data("edit_asset", { id, rows: ["tttttttt", ...new Array(7).fill("........")] });
    expect((data("get_asset", { id, include_pixels: true }).pixels[0].frames[0] as string[])[0]).toBe("tttttttt");
  });

  it("edits a specific row and frame of an animation, and rejects bad edits atomically", () => {
    const hero = data("generate_asset", { generator: "character", seed: 2, name: "Hero" }).asset;
    const px = (rowName: string, f: number) => (data("get_asset", { id: hero.id, include_pixels: true }).pixels as { row: string; frames: string[][] }[]).find((r) => r.row === rowName)!.frames[f];
    const other = px("walk-down", 0)[10];
    data("edit_asset", { id: hero.id, row: "walk-up", frame: 2, pixels: [{ x: 0, y: 0, char: "t" }] });
    expect(px("walk-up", 2)[0][0]).toBe("t");
    expect(px("walk-down", 0)[10]).toBe(other);
    expect(() => call("edit_asset", { id: hero.id, row: "nope", pixels: [{ x: 0, y: 0, char: "t" }] })).toThrow(/No row "nope"/);
    expect(() => call("edit_asset", { id: hero.id, frame: 9, pixels: [{ x: 0, y: 0, char: "t" }] })).toThrow(/frame 9 does not exist/);
    expect(() => call("edit_asset", { id: hero.id, pixels: [{ x: 0, y: 0, char: "t" }, { x: 99, y: 0, char: "t" }] })).toThrow(/Nothing changed.*outside/);
    expect(() => call("edit_asset", { id: hero.id, pixels: [{ x: 1, y: 1, char: "\"" }] })).toThrow(/not a legend char/);
    expect(() => call("edit_asset", { id: hero.id })).toThrow(/Nothing to do/);
  });

  it("will not edit maps", () => {
    const m = data("generate_asset", { generator: "map", seed: 1, name: "M" }).asset;
    expect(() => call("edit_asset", { id: m.id, name: "N" })).toThrow(/is a map/);
  });
});

describe("list_assets / delete_asset / export_asset", () => {
  beforeEach(() => {
    call("generate_asset", { generator: "environment", params: { kind: "oak" }, seed: 1, name: "Oak" });
    call("generate_asset", { generator: "environment", params: { kind: "rock" }, seed: 1, name: "Rock" });
    call("generate_asset", { generator: "building", seed: 1, name: "Inn" });
  });

  it("lists with category and query filters", () => {
    expect(data("list_assets").count).toBe(3);
    expect(data("list_assets", { category: "environment" }).count).toBe(2);
    expect(data("list_assets", { query: "inn" }).assets[0].name).toBe("Inn");
    expect(data("list_assets", { query: "zzz" }).count).toBe(0);
    expect(data("list_assets").assets[0].files[0]).toMatch(/\.png$/);
  });

  it("gets an asset with preview, optionally with pixels", () => {
    const r = call("get_asset", { id: "Oak" });
    expect((r.data as any).pixels).toBeUndefined();
    expect(r.images).toHaveLength(1);
    const d = data("get_asset", { id: "Oak", include_pixels: true });
    expect(d.pixels[0].frames[0]).toHaveLength(d.asset.height);
    expect(d.legend).toContain("foliage");
    expect(() => call("get_asset", { id: "Oaks" })).toThrow(/Did you mean: .*Oak/);
  });

  it("exports with scale, spritesheet format and out_dir", () => {
    const out = join(dir, "game-art");
    const d = data("export_asset", { id: "Inn", scale: 3, out_dir: out });
    expect(d.files[0].path).toBe(join(out, "inn.png"));
    expect(d.files[0].width).toBe(3 * data("get_asset", { id: "Inn" }).asset.width);
    const sheet = data("export_asset", { id: "Oak", format: "spritesheet", out_dir: out });
    expect(sheet.files.map((f: { kind: string }) => f.kind)).toEqual(["spritesheet", "sheet-json"]);
    expect(() => call("export_asset", { id: "Oak", format: "tiled" })).toThrow(/not a map/);
  });

  it("deletes the asset and its exported files", () => {
    const files = data("get_asset", { id: "Rock" }).asset.files as string[];
    const d = data("delete_asset", { id: "Rock" });
    expect(d).toMatchObject({ ok: true, deleted: { name: "Rock" }, removed_files: files });
    expect(files.some((f) => existsSync(f))).toBe(false);
    expect(data("list_assets").count).toBe(2);
    expect(() => call("delete_asset", { id: "Rock" })).toThrow(/No asset/);
  });
});

describe("import_image", () => {
  it("imports a PNG: removes the background, fits and quantizes onto the kit palette", () => {
    const img = blankImage(40, 40, [90, 120, 140, 255]);
    for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) img.rgba.set([200, 40, 40, 255], (y * 40 + x) * 4);
    const file = join(dir, "in.png");
    writeFileSync(file, encodePng(img));
    const r = call("import_image", { path: file, width: 16, height: 16, category: "object", name: "Blob", remove_background: true, crop: true, outline: false });
    const d = r.data as any;
    expect(d.asset).toMatchObject({ name: "Blob", width: 16, height: 16, source: { kind: "import" } });
    const pix = data("get_asset", { id: "Blob", include_pixels: true }).pixels[0].frames[0] as string[];
    expect(pix[0][0]).not.toBe("."); // cropped to content, so it fills the canvas
    expect(new Set(pix.join("").replace(/\./g, "")).size).toBeGreaterThan(0);
    expect(r.images).toHaveLength(1);
    const noBg = data("import_image", { path: file, width: 16, height: 16, category: "object", name: "Blob2" });
    expect(noBg.notes[0]).toMatch(/fully opaque/);
  });

  it("pixel-art mode recovers the true size from an upscaled, noisy image and reports the grid", () => {
    // 10x10 art with a dark outline ring, 4x upscaled with a 2px offset and block noise
    const art = blankImage(10, 10);
    for (let y = 1; y < 9; y++) for (let x = 1; x < 9; x++) art.rgba.set(x === 1 || y === 1 || x === 8 || y === 8 ? [20, 20, 30, 255] : [(x + y) % 2 ? 200 : 150, 60, 60, 255], (y * 10 + x) * 4);
    const k = 4, ox = 2, oy = 1, big = blankImage(10 * k + ox, 10 * k + oy);
    for (let y = 0; y < 10 * k; y++)
      for (let x = 0; x < 10 * k; x++) {
        const n = ((x >> 3) * 7 + (y >> 3) * 3) % 9 - 4;
        const c = art.rgba.subarray((Math.floor(y / k) * 10 + Math.floor(x / k)) * 4, (Math.floor(y / k) * 10 + Math.floor(x / k)) * 4 + 4);
        big.rgba.set([c[0] + n, c[1] + n, c[2] + n, c[3]], ((y + oy) * big.width + x + ox) * 4);
      }
    const file = join(dir, "up.png");
    writeFileSync(file, encodePng(big));
    const d = data("import_image", { path: file, category: "object", name: "Up", mode: "pixel-art", crop: true });
    expect(d.mode).toBe("pixel-art");
    expect(d.grid).toMatchObject({ scale: 4, offset_x: ox, offset_y: oy });
    expect(d.grid.confidence).toBeGreaterThan(0.6);
    expect(d.asset).toMatchObject({ width: 8, height: 8 }); // cropped 8x8 art, existing outline kept (no extra margin)
    const auto = data("import_image", { path: file, category: "object", name: "Up2", mode: "auto", crop: true, palette_mapping: "ramps" });
    expect(auto.mode).toBe("pixel-art");
    expect(() => call("import_image", { path: file, category: "object" })).toThrow(/width and height/);
  });

  it("split imports a sheet as one animation row", () => {
    const sheet = blankImage(24, 10);
    for (const x0 of [1, 9, 17]) for (let y = 2; y < 8; y++) for (let x = x0; x < x0 + 5; x++) sheet.rgba.set([200, 60, 60, 255], (y * 24 + x) * 4);
    const file = join(dir, "sheet.png");
    writeFileSync(file, encodePng(sheet));
    const d = data("import_image", { path: file, category: "character", name: "Sheet", mode: "pixel-art", split: true, outline: false });
    expect(d.asset.frames ?? 3).toBe(3);
    expect(d.notes.join(" ")).toMatch(/split into 3 frame/);
  });

  it("explains unreadable files", () => {
    expect(() => call("import_image", { path: join(dir, "missing.png"), width: 8, height: 8, category: "object" })).toThrow(/Cannot read/);
    const bad = join(dir, "bad.png");
    writeFileSync(bad, "hello");
    expect(() => call("import_image", { path: bad, width: 8, height: 8, category: "object" })).toThrow(/Not a PNG/);
  });
});

describe("kits", () => {
  it("lists, creates, updates and activates kits", () => {
    const kits = data("list_kits");
    expect(kits.active).toBe("kit-default");
    expect(kits.kits.map((k: { id: string }) => k.id)).toEqual(["kit-default", "kit-gameboy", "kit-neon", "kit-hd", "kit-hd-rich", "kit-side", "kit-hd-deep", "kit-iso"]);

    const created = data("create_kit", { name: "Noir", base_kit_id: "kit-gameboy", changes: { outline: "black", sizes: { object: 24 }, rampOverrides: { cloth: ["#000000", "#222222", "#444444", "#888888", "#ffffff"] }, vibe: "noir" } }).kit;
    expect(created).toMatchObject({ name: "Noir", paletteId: "gameboy", outline: "black", vibe: "noir" });
    expect(created.id).not.toBe("kit-gameboy");
    expect(created.sizes).toMatchObject({ object: 24, character: 16 });
    expect(data("list_kits").kits).toHaveLength(9);

    const up = data("update_kit", { kit_id: created.id, changes: { shadeSteps: 2, sizes: { tile: 8 } } });
    expect(up.kit).toMatchObject({ shadeSteps: 2, sizes: { object: 24, tile: 8 } });
    expect(up.note).toMatch(/No assets use this kit/);

    expect(data("set_active_kit", { kit_id: created.id }).kit.active).toBe(true);
    expect(data("list_kits").active).toBe(created.id);
    expect(data("get_style_guide").kit.id).toBe(created.id);
  });

  it("validates kit changes", () => {
    expect(() => call("create_kit", { name: "x", changes: { shadeSteps: 9 } })).toThrow(/shadeSteps/);
    expect(() => call("create_kit", { name: "x", changes: { outlin: "black" } })).toThrow(/unknown key 'outlin'/);
    expect(() => call("create_kit", { name: "x", changes: { rampOverrides: { cloth: ["#fff"] } } })).toThrow(/rampOverrides/);
    expect(() => call("create_kit", { name: "x", changes: { paletteId: "nope" } })).toThrow(/paletteId/);
    expect(() => call("update_kit", { kit_id: "nope", changes: {} })).toThrow(/Unknown kit/);
    expect(() => call("set_active_kit", { kit_id: "nope" })).toThrow(ToolError);
  });
});

describe("svg stays in sync", () => {
  it("rerender_assets and attach rewrite an existing .svg", () => {
    const oak = data("generate_asset", { generator: "environment", params: { kind: "oak" }, seed: 9, name: "Oak" }).asset;
    data("export_asset", { id: oak.id, format: "svg" });
    const svgPath = join(ws.dir, "environments", "oak.svg");
    const before = readFileSync(svgPath, "utf8");
    call("update_kit", { kit_id: "kit-default", changes: { outline: "black", shadeSteps: 2 } });
    call("rerender_assets");
    expect(readFileSync(svgPath, "utf8")).not.toBe(before);

    const f = data("generate_rigged", { rig: "humanoid-normal", attachments: ["straw-hat"], clips: ["idle"], name: "farmer" }).asset;
    expect(existsSync(join(ws.dir, "characters", "farmer.svg"))).toBe(false); // no svg requested: none created
    data("export_asset", { id: f.id, format: "svg" });
    const farmerSvg = join(ws.dir, "characters", "farmer.svg");
    expect(readFileSync(farmerSvg, "utf8")).not.toContain('inkscape:label="hoe"');
    data("attach", { id: f.id, add: ["hoe"] });
    expect(readFileSync(farmerSvg, "utf8")).toContain('inkscape:label="hoe"');
  });
});

describe("rerender_assets", () => {
  it("regenerates procedural assets after a kit change and skips hand-painted ones", () => {
    call("generate_asset", { generator: "environment", params: { kind: "oak" }, seed: 9, name: "Oak" });
    call("paint_asset", { name: "Gem", category: "object", width: 4, height: 4, frames: [["tt..", "ts..", "....", "...."]] });
    const before = readFileSync(join(ws.dir, "environments", "oak.png"));
    call("update_kit", { kit_id: "kit-default", changes: { outline: "black", shadeSteps: 2 } });
    const r = call("rerender_assets");
    const d = r.data as any;
    expect(d.rerendered).toBe(1);
    expect(d.skipped).toEqual([]); // default selection is procedural assets only
    expect(readFileSync(join(ws.dir, "environments", "oak.png")).equals(before)).toBe(false);
    expect(r.images).toHaveLength(1);

    const explicit = data("rerender_assets", { ids: ["Oak", "Gem"], kit_id: "kit-neon" });
    expect(explicit.rerendered).toBe(1);
    expect(explicit.skipped[0]).toMatchObject({ name: "Gem" });
    expect(ws.load().assets.find((a) => a.name === "Oak")!.kitId).toBe("kit-neon");
  });
});

describe("generate_pack", () => {
  const manifest = {
    entries: [
      { name: "p-oak", generator: "environment", params: { kind: "oak" }, seed: 1, tags: ["tree"] },
      { name: "p-farmer", rig: "humanoid-normal", attachments: ["straw-hat"], clips: ["idle"] },
      { name: "p-bad", generator: "nope" },
    ],
  };
  it("generates every entry, reports failures and returns a contact sheet", () => {
    const r = call("generate_pack", { manifest });
    const d = r.data as any;
    expect(d.generated).toBe(2);
    expect(d.failed.map((f: any) => f.name)).toEqual(["p-bad"]);
    expect(isPng(r.images![0].png)).toBe(true);
    expect(data("list_assets").assets.map((a: any) => a.name).sort()).toEqual(["p-farmer", "p-oak"]);
  });
  it("replaces same-named assets and filters with only", () => {
    call("generate_pack", { manifest });
    const d = data("generate_pack", { manifest, only: ["tree"] });
    expect(d.assets.map((a: any) => a.name)).toEqual(["p-oak"]);
    expect(data("list_assets").assets.filter((a: any) => a.name === "p-oak")).toHaveLength(1);
  });
  it("dry_run lists entries without generating; needs pack or manifest", () => {
    expect(data("generate_pack", { manifest, dry_run: true }).count).toBe(3);
    expect(data("list_assets").assets).toHaveLength(0);
    expect(() => call("generate_pack", {})).toThrow(ToolError);
  });
});

describe("svg export/import", () => {
  const roundtrip = (id: string) => {
    const before = data("get_asset", { id }).asset;
    const f = data("export_asset", { id, format: "svg" }).files[0];
    expect(f.path.endsWith(".svg")).toBe(true);
    const svg = readFileSync(f.path, "utf8");
    expect(svg).toContain('id="guides"');
    expect(svg).toContain('inkscape:groupmode="layer"');
    const r = data("import_svg", { path: f.path, name: "copy-" + id.slice(-4) }).asset;
    return { svg, before, r };
  };
  const frames = (id: string) => {
    const a = ws.load().assets.find((x) => x.id === id)!;
    return a.rows.map((r) => r.frames.map((s) => s.data.join(",")));
  };

  it("roundtrips procedural, animated, rigged and map assets byte-identically", () => {
    const ids = [
      data("generate_asset", { generator: "building", seed: 3, name: "house" }).asset.id,
      data("generate_asset", { generator: "map", seed: 1, name: "field" }).asset.id,
      data("generate_asset", { generator: "environment", params: { kind: "paddy-tile" }, name: "paddy" }).asset.id,
      data("generate_rigged", { rig: "humanoid-normal", attachments: ["straw-hat", "hoe"], clips: ["idle", "walk"], name: "farmer" }).asset.id,
    ];
    for (const id of ids) {
      const { r } = roundtrip(id);
      expect(frames(r.id)).toEqual(frames(id));
    }
    const rigSvg = readFileSync(join(dir, "ws", "characters", "farmer.svg"), "utf8");
    expect(rigSvg).toContain('inkscape:label="straw-hat"');
    expect(rigSvg).toContain('inkscape:label="core"');
    expect(rigSvg).toContain(">walk-down 0<");
  });

  it("ignores hidden layers and the guides layer, and replace_id keeps name/category", () => {
    const a = data("generate_asset", { generator: "building", seed: 3, name: "house" }).asset;
    const f = data("export_asset", { id: a.id, format: "svg" }).files[0].path;
    let svg = readFileSync(f, "utf8");
    svg = svg.replace('inkscape:label="roof" inkscape:groupmode="layer"', 'inkscape:label="roof" inkscape:groupmode="layer" style="display:none"');
    const p = join(dir, "edit.svg");
    writeFileSync(p, svg);
    const r = data("import_svg", { path: p, replace_id: a.id }).asset;
    expect(r.id).toBe(a.id);
    expect(r.name).toBe("house");
    expect(r.source.kind).toBe("manual");
    const mats = new Set(ws.load().assets[0].rows[0].frames[0].data);
    expect(mats.size).toBeGreaterThan(1);
    expect(() => call("import_svg", { path: join(dir, "nope.svg") })).toThrow(/Cannot read/);
  });

  it("generate_pack writes svg next to png by default", () => {
    const d = data("generate_pack", { manifest: { entries: [{ name: "rock1", generator: "object", params: { kind: "chest" } }] } });
    expect(d.assets[0].files.some((f: string) => f.endsWith(".svg"))).toBe(true);
  });
});

describe("farming-v1 pack", () => {
  it("lists every Farming Kit v1 entry with valid generators and rigs", () => {
    const d = data("generate_pack", { pack: "farming-v1", dry_run: true });
    expect(d.count).toBeGreaterThanOrEqual(100);
    const names = d.entries.map((e: any) => e.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of ["human-female-elder", "animal-cow-baby", "animal-water-buffalo", "house-large", "barn-large", "coop-small", "tree-old-oak", "fence-gate-open", "tile-snowed-soil", "tool-watering-can", "ui-season-winter", "farmer-chop"]) expect(names).toContain(n);
  });
  it("builds a tagged subset end to end", () => {
    const d = data("generate_pack", { pack: "farming-v1", only: ["season"] });
    expect(d.generated).toBe(4);
    expect(d.failed).toEqual([]);
  });
});

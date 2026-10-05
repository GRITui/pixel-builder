// Headless workspace: one directory holding `pixel-builder.json` (a ProjectFile,
// the same format the web app imports/exports) plus exported game-ready files.
//
//   <ws>/pixel-builder.json
//   <ws>/<category>s/<slug>.png            image (static) or spritesheet (animated)
//   <ws>/<category>s/<slug>.aseprite       Aseprite file (indexed, kit palette, layers, tags)
//   <ws>/<category>s/<slug>.json           sheet metadata (animated / spritesheet export)
//   <ws>/<category>s/<slug>.tiled.json     Tiled map (+ <slug>.tileset.png, <slug>.deco.png)
//
// All writes are atomic (temp file + rename) so a crashed or concurrent run
// never leaves a half-written project or PNG behind.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { emptyProject, parseProject, serializeProject, type ProjectFile } from "../core/project";
import type { Asset, Category, Sprite, StyleKit, TileMap } from "../core/types";
import { isoPropOrigin } from "../core/generators/isomap";
import { spriteSheetToSvg, type RigSvgInfo } from "../core/svg";
import { ENGINE_FORMATS, engineFiles, tilesetMetaOf, type EngineFormat } from "./engine-export";
import { asepriteBytes } from "./aseprite";
import { encodeGif } from "./gif";
import { blankImage, drawSprite, encodePng, kitColors, scaleImage, sheetImage, spriteImage, type RgbaImage } from "./png";

/** An error whose message is meant for the calling agent: say what is wrong and how to fix it. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export const PROJECT_FILENAME = "pixel-builder.json";
export const DEFAULT_WORKSPACE = "pixel-assets";

/** Folder names for exports. `ui` stays singular (`uis/` reads badly in a game repo). */
export const CATEGORY_DIR: Record<Category, string> = {
  character: "characters",
  building: "buildings",
  environment: "environments",
  object: "objects",
  ui: "ui",
  map: "maps",
};

/** `--workspace` > `PIXEL_BUILDER_WORKSPACE` > `./pixel-assets`. */
export function resolveWorkspaceDir(explicit?: string): string {
  return resolve(explicit || process.env.PIXEL_BUILDER_WORKSPACE || DEFAULT_WORKSPACE);
}

/** Kept as an alias: the compact one-asset-per-line format now lives in core. */
export const serializeProjectCompact = serializeProject;

export function atomicWrite(path: string, data: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

export class Workspace {
  readonly dir: string;
  /** Warnings from the last `load()` (dropped invalid assets/kits). */
  warnings: string[] = [];

  constructor(dir?: string) {
    this.dir = resolveWorkspaceDir(dir);
  }

  get projectPath(): string {
    return join(this.dir, PROJECT_FILENAME);
  }

  /** Remote workspaces fetch the project before a tool runs and write it back after; locally both are no-ops. */
  async pull(): Promise<void> {}
  async push(): Promise<void> {}
  /** Run one tool call; remote workspaces serialise calls so pull/run/push never interleave. */
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  /** Read the project file; a missing file is an empty project (nothing is written until `save`). */
  load(): ProjectFile {
    this.warnings = [];
    if (!existsSync(this.projectPath)) return emptyProject();
    try {
      const { project, warnings } = parseProject(readFileSync(this.projectPath, "utf8"));
      this.warnings = warnings;
      return project;
    } catch (e) {
      throw new ToolError(`Cannot read ${this.projectPath}: ${(e as Error).message}. Fix or move the file; it was not modified.`);
    }
  }

  save(project: ProjectFile): void {
    atomicWrite(this.projectPath, serializeProjectCompact(project));
  }

  /** Path relative to the workspace (posix separators) for compact output; absolute if outside it. */
  rel(path: string): string {
    const r = relative(this.dir, path);
    return r.startsWith("..") || resolve(r) === r ? path : r.split(sep).join("/");
  }
}

// ---------- project lookups ----------

export function getKit(project: ProjectFile, kitId?: string): StyleKit {
  const id = kitId ?? project.activeKitId;
  const norm = (x: string) => x.toLowerCase().replace(/[\s_\-]+/g, "");
  // by id, else by display name (case / separator insensitive) when that is unambiguous
  const byName = kitId ? project.kits.filter((k) => norm(k.name) === norm(kitId) || norm(k.id) === norm(kitId)) : [];
  const kit = project.kits.find((k) => k.id === id) ?? (byName.length === 1 ? byName[0] : kitId ? undefined : project.kits[0]);
  if (!kit) throw new ToolError(`Unknown kit '${id}'. Kits: ${project.kits.map((k) => `${k.id} (${k.name})`).join(", ")} (see list_kits).`);
  return kit;
}

/** The kit an asset was made with, falling back to the active kit if it was deleted. */
export function kitOf(project: ProjectFile, asset: Asset): StyleKit {
  return project.kits.find((k) => k.id === asset.kitId) ?? getKit(project);
}

/** Find an asset by id, or by exact (case-insensitive) name when that is unambiguous. */
export function findAsset(project: ProjectFile, idOrName: string): Asset {
  const byId = project.assets.find((a) => a.id === idOrName);
  if (byId) return byId;
  const byName = project.assets.filter((a) => a.name.toLowerCase() === idOrName.toLowerCase());
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) throw new ToolError(`Name '${idOrName}' matches ${byName.length} assets (${byName.map((a) => a.id).join(", ")}); use an id.`);
  const q = idOrName.toLowerCase();
  const near = project.assets.filter((a) => a.id.includes(idOrName) || a.name.toLowerCase().includes(q) || q.includes(a.name.toLowerCase())).slice(0, 5);
  throw new ToolError(
    `No asset '${idOrName}'.` + (near.length ? ` Did you mean: ${near.map((a) => `${a.id} (${a.name})`).join(", ")}?` : " Use list_assets to see ids."),
  );
}

// ---------- export ----------

export type ExportFormat = "png" | "spritesheet" | "tiled" | "svg" | "aseprite" | "gif" | EngineFormat;

export interface ExportedFile {
  path: string;
  kind: "image" | "svg" | "aseprite" | "spritesheet" | "gif" | "sheet-json" | "tiled-json" | "tileset" | "engine";
  width?: number;
  height?: number;
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "asset";
}

/** File stem for an asset: its name, with `-2`, `-3`... for later assets of the same category and name. */
export function exportSlug(project: ProjectFile, asset: Asset): string {
  const base = slugify(asset.name);
  const same = project.assets
    .filter((a) => a.category === asset.category && slugify(a.name) === base)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const i = same.findIndex((a) => a.id === asset.id);
  return i > 0 ? `${base}-${i + 1}` : base;
}

export function categoryDir(ws: Workspace, category: Category): string {
  return join(ws.dir, CATEGORY_DIR[category]);
}

/** `<slug>.gif` (single row) and `<slug>.<row>.gif` (one per animation row) sit beside the other side files. */
const gifFiles = (dir: string, slug: string): string[] =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f === `${slug}.gif` || (f.startsWith(`${slug}.`) && f.endsWith(".gif") && f.split(".").length === 3)) : [];

const SIDE_FILES = (slug: string) => [`${slug}.png`, `${slug}.svg`, `${slug}.aseprite`, `${slug}.json`, `${slug}.tiled.json`, `${slug}.tileset.png`, `${slug}.deco.png`, `${slug}.tsj`, `${slug}.tres`, `${slug}.rules.json`, `${slug}.atlas.json`];

/** Exported files that currently exist for an asset in its default folder (absolute paths). */
export function assetFiles(ws: Workspace, project: ProjectFile, asset: Asset): string[] {
  const dir = categoryDir(ws, asset.category);
  const slug = exportSlug(project, asset);
  return [...SIDE_FILES(slug), ...gifFiles(dir, slug)]
    .map((f) => join(dir, f))
    .filter((p) => existsSync(p));
}

export function removeAssetFiles(ws: Workspace, project: ProjectFile, asset: Asset): string[] {
  const dir = categoryDir(ws, asset.category);
  const removed: string[] = [];
  const slug = exportSlug(project, asset);
  for (const f of [...SIDE_FILES(slug), ...gifFiles(dir, slug)]) {
    const p = join(dir, f);
    if (existsSync(p)) {
      rmSync(p, { force: true });
      removed.push(p);
    }
  }
  return removed;
}

export function isAnimated(asset: Asset): boolean {
  return asset.rows.reduce((n, r) => n + r.frames.length, 0) > 1;
}

function writeImage(path: string, img: RgbaImage, kind: ExportedFile["kind"]): ExportedFile {
  atomicWrite(path, encodePng(img));
  return { path, kind, width: img.width, height: img.height };
}

/** Pack sprites into a grid atlas; each sprite sits bottom-centre (or top-left) in a `cellW` x `cellH` cell. */
function atlas(sprites: Sprite[], kit: StyleKit, cellW: number, cellH: number, centered: boolean): { image: RgbaImage; columns: number } {
  const columns = Math.max(1, Math.min(8, sprites.length));
  const rows = Math.max(1, Math.ceil(sprites.length / columns));
  const image = blankImage(columns * cellW, rows * cellH);
  const colors = kitColors(kit);
  sprites.forEach((s, i) => {
    const ox = (i % columns) * cellW + (centered ? Math.floor((cellW - s.w) / 2) : 0);
    const oy = Math.floor(i / columns) * cellH + (centered ? cellH - s.h : 0);
    drawSprite(image, s, colors, ox, oy);
  });
  return { image, columns };
}

/**
 * Tiled (.tmj) export of a tilemap. Ground tiles go in one tileset (cell = tile size);
 * deco sprites (often bigger than a tile, anchored bottom-centre like the in-app render)
 * go in a second tileset with a centring `tileoffset`.
 */
function tiledExport(tm: TileMap, slug: string, kit: StyleKit, dir: string, meta?: Record<string, unknown>): ExportedFile[] {
  const files: ExportedFile[] = [];
  const used = (layer: number[]) => [...new Set(layer.filter((i) => i >= 0 && i < tm.tiles.length))].sort((a, b) => a - b);
  const groundIdx = used(tm.ground);
  const decoIdx = used(tm.deco);
  const tilesets: unknown[] = [];
  const toGid = (layer: number[], idx: number[], firstgid: number) => layer.map((i) => (idx.includes(i) ? firstgid + idx.indexOf(i) : 0));
  const props = (idx: number[]) =>
    idx.map((ti, id) => ({
      id,
      properties: [
        { name: "name", type: "string", value: tm.tiles[ti].name },
        { name: "solid", type: "bool", value: !!tm.tiles[ti].solid },
      ],
    }));

  // Isometric maps: 2:1 diamond cells (tile wide, tile/2 tall); ground sprites are taller than a cell
  // (raised blocks) and Tiled bottom-aligns them; props become tile objects (see below).
  const iso = tm.orientation === "isometric";
  const cellH = iso ? Math.max(tm.tile / 2, ...groundIdx.map((i) => tm.tiles[i].sprite.h)) : tm.tile;
  let next = 1;
  let groundFirst = 0, decoFirst = 0;
  if (groundIdx.length) {
    const { image, columns } = atlas(groundIdx.map((i) => tm.tiles[i].sprite), kit, tm.tile, cellH, false);
    files.push(writeImage(join(dir, `${slug}.tileset.png`), image, "tileset"));
    groundFirst = next;
    tilesets.push({
      firstgid: next, name: `${slug}-ground`, image: `${slug}.tileset.png`, imagewidth: image.width, imageheight: image.height,
      tilewidth: tm.tile, tileheight: cellH, tilecount: groundIdx.length, columns, margin: 0, spacing: 0, tiles: props(groundIdx),
    });
    next += groundIdx.length;
  }
  if (decoIdx.length) {
    const sprites = decoIdx.map((i) => tm.tiles[i].sprite);
    const cw = Math.max(tm.tile, ...sprites.map((s) => s.w)), ch = Math.max(tm.tile, ...sprites.map((s) => s.h));
    const { image, columns } = atlas(sprites, kit, cw, ch, true);
    files.push(writeImage(join(dir, `${slug}.deco.png`), image, "tileset"));
    decoFirst = next;
    tilesets.push({
      firstgid: next, name: `${slug}-deco`, image: `${slug}.deco.png`, imagewidth: image.width, imageheight: image.height,
      tilewidth: cw, tileheight: ch, tilecount: decoIdx.length, columns, margin: 0, spacing: 0,
      ...(iso ? {} : { tileoffset: { x: -Math.floor((cw - tm.tile) / 2), y: 0 } }), tiles: props(decoIdx),
    });
  }
  const layer = (id: number, name: string, data: number[]) => ({
    id, name, type: "tilelayer", x: 0, y: 0, width: tm.cols, height: tm.rows, opacity: 1, visible: true, data,
  });
  // Tiled isometric object coordinates are in "tile height" units along the two diamond axes.
  const isoObjects = () => {
    const out: unknown[] = [];
    let id = 1;
    const cw = Math.max(tm.tile, ...decoIdx.map((i) => tm.tiles[i].sprite.w)), ch = Math.max(tm.tile, ...decoIdx.map((i) => tm.tiles[i].sprite.h));
    const th = tm.tile / 2;
    for (let r = 0; r < tm.rows; r++)
      for (let c = 0; c < tm.cols; c++) {
        const gid = toGid([tm.deco[r * tm.cols + c]], decoIdx, decoFirst)[0];
        if (!gid) continue;
        const sp = tm.tiles[tm.deco[r * tm.cols + c]].sprite;
        const [ox, oy] = isoPropOrigin(tm, c, r, sp);
        // screen position of the atlas cell's bottom-left corner (cell is cw x ch, sprite centred on the bottom)
        const sx = ox + sp.w / 2 - cw / 2 - tm.rows * (tm.tile / 2), sy = oy + sp.h;
        const a = (sx * 2) / tm.tile, b = (sy * 2) / th;
        out.push({ id: id++, name: tm.tiles[tm.deco[r * tm.cols + c]].name, type: "", gid, x: ((a + b) / 2) * th, y: ((b - a) / 2) * th, width: cw, height: ch, rotation: 0, visible: true });
      }
    return { out, nextid: id };
  };
  const isoObjs = iso ? isoObjects() : null;
  const layers: unknown[] = [
    layer(1, "ground", toGid(tm.ground, groundIdx, groundFirst)),
    isoObjs
      ? { id: 2, name: "props", type: "objectgroup", x: 0, y: 0, opacity: 1, visible: true, draworder: "topdown", objects: isoObjs.out }
      : layer(2, "deco", toGid(tm.deco, decoIdx, decoFirst)),
  ];
  let nextObject = isoObjs ? isoObjs.nextid : 1, nextLayer = 3;
  // top-down terrain (hills): the level of every cell (0..2) as a hidden layer; the values are heights, not tile ids
  if (!iso && tm.heights) layers.push({ ...layer(nextLayer++, "height", tm.heights.slice()), visible: false, properties: [{ name: "kind", type: "string", value: "height-field" }] });
  // y-sorted maps (forest-mmo): trees and props also as tile objects ordered by base line, so an engine
  // can draw characters in the same list and walk behind trunks. The flat deco layer is hidden then.
  const objs = !iso && meta?.ysorted && Array.isArray(meta.objects) ? (meta.objects as { tile: number; name: string; col: number; row: number; y: number; solid: boolean }[]) : null;
  if (objs) {
    (layers[1] as { visible: boolean }).visible = false;
    const sorted = [...objs].sort((a, b) => a.y - b.y || a.col - b.col);
    layers.push({
      id: nextLayer++, name: "objects", type: "objectgroup", x: 0, y: 0, opacity: 1, visible: true, draworder: "topdown",
      properties: [{ name: "ysort", type: "bool", value: true }],
      objects: sorted.filter((o) => decoIdx.includes(o.tile)).map((o) => ({
        id: nextObject++, name: o.name, type: o.solid ? "solid" : "prop", gid: decoFirst + decoIdx.indexOf(o.tile),
        ...((o as { level?: number }).level !== undefined ? { properties: [{ name: "level", type: "int", value: (o as { level?: number }).level }] } : {}), x: o.col * tm.tile, y: o.y, width: Math.max(tm.tile, tm.tiles[o.tile].sprite.w), height: Math.max(tm.tile, tm.tiles[o.tile].sprite.h), rotation: 0, visible: true,
      })),
    });
  }
  // rich buildings: the footprint cells are the collision, one rectangle per building
  const solids = !iso && Array.isArray(meta?.buildings) ? (meta!.buildings as { style?: string; solid?: { x0: number; y0: number; x1: number; y1: number } }[]).filter((b) => b.solid) : [];
  if (solids.length)
    layers.push({
      id: nextLayer++, name: "collision", type: "objectgroup", x: 0, y: 0, opacity: 1, visible: false, draworder: "topdown",
      objects: solids.map((b) => ({ id: nextObject++, name: b.style ?? "building", type: "solid", x: b.solid!.x0 * tm.tile, y: b.solid!.y0 * tm.tile, width: (b.solid!.x1 - b.solid!.x0 + 1) * tm.tile, height: (b.solid!.y1 - b.solid!.y0 + 1) * tm.tile, rotation: 0, visible: true })),
    });
  const spawns = Array.isArray(meta?.spawns) ? (meta!.spawns as { x: number; y: number; monster?: string; role?: string }[]) : [];
  if (spawns.length)
    layers.push({
      id: nextLayer++, name: "spawns", type: "objectgroup", x: 0, y: 0, opacity: 1, visible: true, draworder: "topdown",
      objects: spawns.map((sp) => ({ id: nextObject++, name: sp.monster ?? sp.role ?? "spawn", type: "spawn", point: true, x: sp.x * tm.tile + tm.tile / 2, y: sp.y * tm.tile + tm.tile / 2, rotation: 0, visible: true })),
    });
  const map = {
    type: "map", version: "1.10", tiledversion: "1.10.2", orientation: iso ? "isometric" : "orthogonal", renderorder: "right-down", infinite: false,
    width: tm.cols, height: tm.rows, tilewidth: tm.tile, tileheight: iso ? tm.tile / 2 : tm.tile, nextlayerid: nextLayer, nextobjectid: nextObject,
    layers,
    tilesets,
  };
  const path = join(dir, `${slug}.tiled.json`);
  atomicWrite(path, JSON.stringify(map) + "\n");
  files.push({ path, kind: "tiled-json" });
  return files;
}

export interface ExportOptions {
  format?: ExportFormat;
  scale?: number;
  /** Absolute or cwd-relative output folder; default `<ws>/<category>s`. */
  outDir?: string;
  /** Part ownership + joints for rigged assets (svg and aseprite formats; computed by the tool layer). */
  rig?: RigSvgInfo;
  /** gif: one animation row (name or index); default one GIF per animated row. */
  row?: string | number;
}

/** True if an editable `<slug>.svg` already sits where exportAsset would put it. */
export function svgExists(ws: Workspace, project: ProjectFile, asset: Asset, outDir?: string): boolean {
  const dir = outDir ? resolve(outDir) : categoryDir(ws, asset.category);
  return existsSync(join(dir, `${exportSlug(project, asset)}.svg`));
}

/** True if an `<slug>.aseprite` already sits where exportAsset would put it. */
export function asepriteExists(ws: Workspace, project: ProjectFile, asset: Asset, outDir?: string): boolean {
  const dir = outDir ? resolve(outDir) : categoryDir(ws, asset.category);
  return existsSync(join(dir, `${exportSlug(project, asset)}.aseprite`));
}

function gifExport(asset: Asset, kit: StyleKit, dir: string, slug: string, scale: number, row?: string | number): ExportedFile[] {
  const chosen = row !== undefined && row !== "";
  let rows = asset.rows.map((r, i) => ({ r, i }));
  if (chosen) {
    const hit = rows.find(({ r, i }) => r.name === String(row) || (/^[0-9]+$/.test(String(row)) && i === Number(row)));
    if (!hit) throw new ToolError(`Asset '${asset.name}' has no row '${row}'. Rows: ${asset.rows.map((r) => r.name).join(", ")}.`);
    rows = [hit];
  }
  const animated = rows.filter(({ r }) => r.frames.length > 1);
  if (!animated.length) throw new ToolError(`Asset '${asset.name}' has no animation to export as GIF (every ${chosen ? "chosen " : ""}row has one frame). ${asset.tilemap ? "Regenerate the map with animate: true." : "Use format 'png'."}`);
  const colors = kitColors(kit);
  const single = asset.rows.length === 1;
  const files: ExportedFile[] = [];
  for (const { r } of animated) {
    const path = join(dir, single || chosen ? `${slug}.gif` : `${slug}.${slugify(r.name)}.gif`);
    const sc = Math.min(scale, Math.max(1, Math.floor(65535 / Math.max(r.frames[0].w, r.frames[0].h))));
    atomicWrite(path, encodeGif(r.frames, { colors, fps: asset.fps, scale: sc }));
    files.push({ path, kind: "gif", width: r.frames[0].w * sc, height: r.frames[0].h * sc });
  }
  return files;
}

/** Write an asset's game-ready files. Returns absolute paths. */
export function exportAsset(ws: Workspace, project: ProjectFile, asset: Asset, opts: ExportOptions = {}): ExportedFile[] {
  const format = opts.format ?? "png";
  const scale = Math.max(1, Math.min(16, Math.floor(opts.scale ?? 1)));
  const dir = opts.outDir ? resolve(opts.outDir) : categoryDir(ws, asset.category);
  const slug = exportSlug(project, asset);
  const kit = kitOf(project, asset);
  const files: ExportedFile[] = [];
  const grid = asset.rows.map((r) => r.frames);

  if (format === "svg") {
    const path = join(dir, `${slug}.svg`);
    atomicWrite(path, spriteSheetToSvg({ name: asset.name, category: asset.category, fps: asset.fps, rows: asset.rows, tilemap: asset.tilemap, rig: opts.rig, kit }));
    return [{ path, kind: "svg" }];
  }
  if (format === "aseprite") {
    const path = join(dir, `${slug}.aseprite`);
    atomicWrite(path, asepriteBytes(asset, kit, opts.rig));
    return [{ path, kind: "aseprite" }];
  }
  if (format === "gif") return gifExport(asset, kit, dir, slug, scale, opts.row);
  if (format === "tiled" && !asset.tilemap) throw new ToolError(`Asset '${asset.name}' is a ${asset.category}, not a map; 'tiled' export only works for map assets. Use format 'png' or 'spritesheet'.`);

  if ((ENGINE_FORMATS as readonly string[]).includes(format)) {
    const tm = tilesetMetaOf(asset.meta);
    if (!tm) throw new ToolError(`Asset '${asset.name}' is not an autotile tileset; '${format}' export needs a 'tileset' generator asset (generate_asset generator 'tileset').`);
    return engineFiles(format as EngineFormat, slug, asset.rows[0].frames[0], kit, tm, scale).map((f) => {
      const path = join(dir, f.name);
      atomicWrite(path, f.data);
      return { path, kind: f.kind, ...(f.width ? { width: f.width, height: f.height } : {}) };
    });
  }

  const sheet = format === "spritesheet" || (isAnimated(asset) && asset.category !== "map");
  if (sheet) {
    const layout = sheetImage(grid, kit, scale);
    files.push(writeImage(join(dir, `${slug}.png`), layout.image, "spritesheet"));
    const meta = {
      image: `${slug}.png`,
      name: asset.name,
      category: asset.category,
      frameWidth: layout.cellW * scale,
      frameHeight: layout.cellH * scale,
      columns: layout.columns,
      rows: layout.rows,
      scale,
      fps: asset.fps,
      animations: asset.rows.map((r, i) => ({ name: r.name, row: i, frames: r.frames.length })),
      ...(asset.meta ? { meta: asset.meta } : {}),
    };
    const p = join(dir, `${slug}.json`);
    atomicWrite(p, JSON.stringify(meta, null, 2) + "\n");
    files.push({ path: p, kind: "sheet-json" });
  } else {
    files.push(writeImage(join(dir, `${slug}.png`), scaleImage(spriteImage(asset.rows[0].frames[0], kit), scale), "image"));
  }
  if (asset.tilemap && format !== "spritesheet") files.push(...tiledExport(asset.tilemap, slug, kit, dir, asset.meta));
  return files;
}

// Headless workspace: one directory holding `pixel-builder.json` (a ProjectFile,
// the same format the web app imports/exports) plus exported game-ready files.
//
//   <ws>/pixel-builder.json
//   <ws>/<category>s/<slug>.png            image (static) or spritesheet (animated)
//   <ws>/<category>s/<slug>.json           sheet metadata (animated / spritesheet export)
//   <ws>/<category>s/<slug>.tiled.json     Tiled map (+ <slug>.tileset.png, <slug>.deco.png)
//
// All writes are atomic (temp file + rename) so a crashed or concurrent run
// never leaves a half-written project or PNG behind.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { emptyProject, parseProject, serializeProject, type ProjectFile } from "../core/project";
import type { Asset, Category, Sprite, StyleKit, TileMap } from "../core/types";
import { spriteSheetToSvg, type RigSvgInfo } from "../core/svg";
import { encodeAseprite } from "./aseprite";
import { ENGINE_FORMATS, engineFiles, tilesetMetaOf, type EngineFormat } from "./engine-export";
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
  const kit = project.kits.find((k) => k.id === id) ?? (kitId ? undefined : project.kits[0]);
  if (!kit) throw new ToolError(`Unknown kit '${id}'. Kits: ${project.kits.map((k) => k.id).join(", ")} (see list_kits).`);
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

export type ExportFormat = "png" | "spritesheet" | "tiled" | "svg" | "aseprite" | EngineFormat;

export interface ExportedFile {
  path: string;
  kind: "image" | "svg" | "spritesheet" | "sheet-json" | "tiled-json" | "tileset" | "engine" | "aseprite";
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

const SIDE_FILES = (slug: string) => [`${slug}.png`, `${slug}.svg`, `${slug}.aseprite`, `${slug}.json`, `${slug}.tiled.json`, `${slug}.tileset.png`, `${slug}.deco.png`, `${slug}.tsj`, `${slug}.tres`, `${slug}.rules.json`, `${slug}.atlas.json`];

/** Exported files that currently exist for an asset in its default folder (absolute paths). */
export function assetFiles(ws: Workspace, project: ProjectFile, asset: Asset): string[] {
  const dir = categoryDir(ws, asset.category);
  return SIDE_FILES(exportSlug(project, asset))
    .map((f) => join(dir, f))
    .filter((p) => existsSync(p));
}

export function removeAssetFiles(ws: Workspace, project: ProjectFile, asset: Asset): string[] {
  const dir = categoryDir(ws, asset.category);
  const removed: string[] = [];
  for (const f of SIDE_FILES(exportSlug(project, asset))) {
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
function tiledExport(tm: TileMap, slug: string, kit: StyleKit, dir: string): ExportedFile[] {
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

  let next = 1;
  let groundFirst = 0, decoFirst = 0;
  if (groundIdx.length) {
    const { image, columns } = atlas(groundIdx.map((i) => tm.tiles[i].sprite), kit, tm.tile, tm.tile, false);
    files.push(writeImage(join(dir, `${slug}.tileset.png`), image, "tileset"));
    groundFirst = next;
    tilesets.push({
      firstgid: next, name: `${slug}-ground`, image: `${slug}.tileset.png`, imagewidth: image.width, imageheight: image.height,
      tilewidth: tm.tile, tileheight: tm.tile, tilecount: groundIdx.length, columns, margin: 0, spacing: 0, tiles: props(groundIdx),
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
      tileoffset: { x: -Math.floor((cw - tm.tile) / 2), y: 0 }, tiles: props(decoIdx),
    });
  }
  const layer = (id: number, name: string, data: number[]) => ({
    id, name, type: "tilelayer", x: 0, y: 0, width: tm.cols, height: tm.rows, opacity: 1, visible: true, data,
  });
  const map = {
    type: "map", version: "1.10", tiledversion: "1.10.2", orientation: "orthogonal", renderorder: "right-down", infinite: false,
    width: tm.cols, height: tm.rows, tilewidth: tm.tile, tileheight: tm.tile, nextlayerid: 3, nextobjectid: 1,
    layers: [layer(1, "ground", toGid(tm.ground, groundIdx, groundFirst)), layer(2, "deco", toGid(tm.deco, decoIdx, decoFirst))],
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
  /** Part ownership + joints for rigged assets (svg format only; computed by the tool layer). */
  rig?: RigSvgInfo;
}

/** True if an editable `<slug>.svg` already sits where exportAsset would put it. */
export function svgExists(ws: Workspace, project: ProjectFile, asset: Asset, outDir?: string): boolean {
  const dir = outDir ? resolve(outDir) : categoryDir(ws, asset.category);
  return existsSync(join(dir, `${exportSlug(project, asset)}.svg`));
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
    atomicWrite(path, encodeAseprite({ rows: asset.rows, fps: asset.fps, kit, rig: opts.rig, scale }));
    return [{ path, kind: "aseprite" }];
  }
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
  if (asset.tilemap && format !== "spritesheet") files.push(...tiledExport(asset.tilemap, slug, kit, dir));
  return files;
}

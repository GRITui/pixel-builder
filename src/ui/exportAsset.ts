// Export helpers: PNG, spritesheet + JSON, Tiled map, and whole-library JSON.
import { createSprite, blit } from "../core/sprite";
import type { Asset, StyleKit } from "../core/types";
import { buildSpritesheet, canvasToBlob, downloadBlob, paletteFor, slug, spriteToCanvas } from "./render";
import { materialLayers, writeAseprite } from "../core/aseprite";
import { resolveRamps } from "../core/kit";
import { flattenRamps } from "../core/palette";
import { parseProject, serializeProject, type ProjectFile } from "../core/project";

export const EXPORT_SCALES = [1, 2, 4, 8] as const;

function jsonBlob(o: unknown): Blob {
  return new Blob([JSON.stringify(o, null, 2)], { type: "application/json" });
}

/** Browsers may block back-to-back downloads; space them slightly. */
async function downloadAll(files: { blob: Blob; name: string }[]): Promise<void> {
  for (const f of files) {
    downloadBlob(f.blob, f.name);
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** First frame of the first row (the whole map for map assets). */
export async function exportPng(asset: Asset, kit: StyleKit, scale: number): Promise<void> {
  const c = spriteToCanvas(asset.rows[0].frames[0], paletteFor(kit), scale);
  await downloadAll([{ blob: await canvasToBlob(c), name: `${slug(asset.name)}@${scale}x.png` }]);
}

export function spritesheetJson(asset: Asset, sheetName: string, frameW: number, frameH: number, scale: number) {
  return {
    name: asset.name,
    category: asset.category,
    image: sheetName,
    scale,
    frameWidth: frameW * scale,
    frameHeight: frameH * scale,
    fps: asset.fps,
    rows: asset.rows.map((r, i) => ({ name: r.name, index: i, frames: r.frames.length })),
    meta: asset.meta ?? {},
    source: asset.source,
  };
}

export async function exportSpritesheet(asset: Asset, kit: StyleKit, scale: number): Promise<void> {
  const { canvas, frameW, frameH } = buildSpritesheet(asset.rows, paletteFor(kit), scale);
  const base = slug(asset.name);
  const png = `${base}-sheet@${scale}x.png`;
  await downloadAll([
    { blob: await canvasToBlob(canvas), name: png },
    { blob: jsonBlob(spritesheetJson(asset, png, frameW, frameH, scale)), name: `${base}-sheet@${scale}x.json` },
  ]);
}

/** Aseprite file: indexed with the kit palette, a layer per material, a tag per animation row. */
export async function exportAseprite(asset: Asset, kit: StyleKit): Promise<void> {
  const { layers, layerOf } = materialLayers(asset.rows);
  const bytes = writeAseprite({ rows: asset.rows, palette: flattenRamps(resolveRamps(kit)), fps: asset.fps, layers, layerOf });
  await downloadAll([{ blob: new Blob([bytes as BlobPart], { type: "application/octet-stream" }), name: `${slug(asset.name)}.aseprite` }]);
}

/**
 * Tiled (.tmj) export: one tileset atlas (cell = largest tile sprite, sprites
 * bottom-left aligned as Tiled expects), a ground tile layer and the deco layer as
 * tile objects so wide/tall props keep their bottom-centre anchoring.
 */
export function buildTiled(asset: Asset, tilesetImage: string, cell: number, columns: number, imageW: number, imageH: number) {
  const tm = asset.tilemap!;
  const objects: Record<string, unknown>[] = [];
  let id = 1;
  for (let y = 0; y < tm.rows; y++)
    for (let x = 0; x < tm.cols; x++) {
      const idx = tm.deco[y * tm.cols + x];
      const t = tm.tiles[idx];
      if (!t) continue;
      objects.push({
        id: id++,
        name: t.name,
        type: "",
        gid: idx + 1,
        x: x * tm.tile + Math.floor((tm.tile - t.sprite.w) / 2),
        y: (y + 1) * tm.tile,
        width: t.sprite.w,
        height: t.sprite.h,
        rotation: 0,
        visible: true,
      });
    }
  return {
    type: "map",
    version: "1.10",
    tiledversion: "1.10.2",
    orientation: "orthogonal",
    renderorder: "right-down",
    infinite: false,
    width: tm.cols,
    height: tm.rows,
    tilewidth: tm.tile,
    tileheight: tm.tile,
    nextlayerid: 3,
    nextobjectid: id,
    tilesets: [
      {
        firstgid: 1,
        name: slug(asset.name),
        image: tilesetImage,
        imagewidth: imageW,
        imageheight: imageH,
        tilewidth: cell,
        tileheight: cell,
        columns,
        tilecount: tm.tiles.length,
        margin: 0,
        spacing: 0,
        tiles: tm.tiles.map((t, i) => ({ id: i, properties: [{ name: "name", type: "string", value: t.name }, { name: "solid", type: "bool", value: !!t.solid }] })),
      },
    ],
    layers: [
      { id: 1, name: "ground", type: "tilelayer", x: 0, y: 0, width: tm.cols, height: tm.rows, opacity: 1, visible: true, data: tm.ground.map((g) => g + 1) },
      { id: 2, name: "deco", type: "objectgroup", x: 0, y: 0, opacity: 1, visible: true, draworder: "topdown", objects },
    ],
  };
}

export async function exportMap(asset: Asset, kit: StyleKit, scale: number): Promise<void> {
  const tm = asset.tilemap;
  if (!tm) return exportPng(asset, kit, scale);
  const pal = paletteFor(kit);
  const base = slug(asset.name);
  const cell = Math.max(tm.tile, ...tm.tiles.flatMap((t) => [t.sprite.w, t.sprite.h]));
  const columns = Math.max(1, Math.min(8, tm.tiles.length));
  const rowsN = Math.max(1, Math.ceil(tm.tiles.length / columns));
  const atlas = createSprite(columns * cell, rowsN * cell);
  tm.tiles.forEach((t, i) => blit(atlas, t.sprite, (i % columns) * cell, Math.floor(i / columns) * cell + cell - t.sprite.h));
  const tilesetName = `${base}-tileset.png`;
  await downloadAll([
    { blob: await canvasToBlob(spriteToCanvas(asset.rows[0].frames[0], pal, scale)), name: `${base}@${scale}x.png` },
    { blob: await canvasToBlob(spriteToCanvas(atlas, pal, 1)), name: tilesetName },
    { blob: jsonBlob(buildTiled(asset, tilesetName, cell, columns, atlas.w, atlas.h)), name: `${base}.tmj` },
  ]);
}

// ---------- whole project (kits + library) ----------

export function exportProject(project: ProjectFile): void {
  downloadBlob(new Blob([serializeProject(project)], { type: "application/json" }), "pixel-builder.json");
}

/** Parse an uploaded project file; throws a readable Error when it is unusable. */
export async function readProjectFile(f: File): Promise<{ project: ProjectFile; warnings: string[] }> {
  return parseProject(await f.text());
}

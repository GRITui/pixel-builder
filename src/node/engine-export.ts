// Engine files for `tileset` assets (see core/generators/tileset.ts for the tile ordering).
//
//   tiled-tileset  <slug>.png + <slug>.tsj   Tiled tileset with a wangset (corner for wang16, mixed for blob47)
//   godot          <slug>.png + <slug>.tres  Godot 4 TileSet: one atlas source, terrain set, peering bits
//   unity          <slug>.png + <slug>.rules.json  slice rects + per-tile neighbour rules (documented below)
//   atlas          <slug>.png + <slug>.atlas.json  plain index of every tile and its mask
//
// Terrain ids: lower = 0 (Tiled colour 1), upper = 1 (Tiled colour 2).
import { rgbToHex } from "../core/palette";
import type { Sprite, StyleKit } from "../core/types";
import { BLOB_DIRS, WANG_CORNERS, type TilesetLayout, type TilesetTile } from "../core/generators/tileset";
import { encodePng, kitColors, scaleImage, spriteImage } from "./png";

export const ENGINE_FORMATS = ["tiled-tileset", "godot", "unity", "atlas"] as const;
export type EngineFormat = (typeof ENGINE_FORMATS)[number];

export interface TilesetMeta {
  layout: TilesetLayout;
  tileSize: number;
  cols: number;
  rows: number;
  upper: string;
  lower: string;
  count: number;
  tiles: TilesetTile[];
  extra?: { index: number; col: number; row: number; x: number; y: number; note?: string }[];
  ordering: string;
}

export interface EngineFile {
  name: string;
  data: string | Uint8Array;
  kind: "tileset" | "engine";
  width?: number;
  height?: number;
}

export function tilesetMetaOf(meta: Record<string, unknown> | undefined): TilesetMeta | undefined {
  const t = meta?.tileset as TilesetMeta | undefined;
  return t && Array.isArray(t.tiles) && typeof t.tileSize === "number" ? t : undefined;
}

const json = (v: unknown) => JSON.stringify(v, null, 2) + "\n";

/** Terrain (0 lower, 1 upper) of each of a tile's 8 neighbours/corners in [N, NE, E, SE, S, SW, W, NW] order. */
function ring(layout: TilesetLayout, mask: number): number[] {
  if (layout === "blob47") return BLOB_DIRS.map((_, b) => (mask & (1 << b) ? 1 : 0));
  const c = { NE: mask & 1 ? 1 : 0, SE: mask & 2 ? 1 : 0, SW: mask & 4 ? 1 : 0, NW: mask & 8 ? 1 : 0 };
  // edges of a corner tile: terrain only when both ends agree, else the lower one
  return [c.NW & c.NE, c.NE, c.NE & c.SE, c.SE, c.SE & c.SW, c.SW, c.SW & c.NW, c.NW];
}

/** Every drawable tile: the layout's own tiles plus the plain filler of blob47. */
function allTiles(m: TilesetMeta): { index: number; col: number; row: number; x: number; y: number; mask: number; filler: boolean }[] {
  return [
    ...m.tiles.map((t) => ({ ...t, filler: false })),
    ...(m.extra ?? []).map((t) => ({ ...t, mask: 0, filler: true })),
  ];
}

/** Dominant palette colour of a tile, as a hex colour (used for terrain swatches). */
function swatch(sprite: Sprite, kit: StyleKit, x: number, y: number, T: number): string {
  const counts = new Map<number, number>();
  for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) counts.set(sprite.data[(y + j) * sprite.w + x + i], (counts.get(sprite.data[(y + j) * sprite.w + x + i]) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const rgb = kitColors(kit)[top];
  return rgb ? rgbToHex(rgb) : "#808080";
}

function pureTiles(m: TilesetMeta) {
  const find = (upper: boolean) => {
    if (m.layout === "wang16") return m.tiles[upper ? 15 : 0];
    return upper ? m.tiles[m.tiles.length - 1] : (m.extra?.[0] ?? m.tiles[0]);
  };
  return { lower: find(false), upper: find(true) };
}

export function tiledTileset(m: TilesetMeta, slug: string, imgW: number, imgH: number, scale: number, colors: { lower: string; upper: string }) {
  const corner = m.layout === "wang16";
  // wangid order: top, topright, right, bottomright, bottom, bottomleft, left, topleft; colour 1 = lower, 2 = upper
  const wangtiles = allTiles(m)
    // blob47 mask 0 (an upper island) would share an all-lower wangid with the plain filler: keep the filler
    .filter((t) => !(m.layout === "blob47" && !t.filler && t.mask === 0))
    .map((t) => {
      const r = ring(m.layout, t.mask).map((v) => v + 1); // N NE E SE S SW W NW
      const wangid = corner ? [0, r[1], 0, r[3], 0, r[5], 0, r[7]] : r;
      return { tileid: t.index, wangid };
    });
  return {
    type: "tileset", version: "1.10", tiledversion: "1.10.2", name: slug, image: `${slug}.png`,
    imagewidth: imgW, imageheight: imgH, tilewidth: m.tileSize * scale, tileheight: m.tileSize * scale,
    tilecount: m.cols * m.rows, columns: m.cols, margin: 0, spacing: 0,
    wangsets: [{
      name: `${m.lower}-${m.upper}`, type: corner ? "corner" : "mixed", tile: -1,
      colors: [
        { name: m.lower, color: colors.lower, probability: 1, tile: -1 },
        { name: m.upper, color: colors.upper, probability: 1, tile: -1 },
      ],
      wangtiles: wangtiles.sort((a, b) => a.tileid - b.tileid),
    }],
  };
}

const GODOT_BITS: Record<string, string> = {
  N: "top_side", NE: "top_right_corner", E: "right_side", SE: "bottom_right_corner",
  S: "bottom_side", SW: "bottom_left_corner", W: "left_side", NW: "top_left_corner",
};

export function godotTileset(m: TilesetMeta, slug: string, scale: number, colors: { lower: string; upper: string }): string {
  const T = m.tileSize * scale;
  const corner = m.layout === "wang16";
  const lines: string[] = [
    `[gd_resource type="TileSet" load_steps=3 format=3]`,
    ``,
    `[ext_resource type="Texture2D" path="res://${slug}.png" id="1_tex"]`,
    ``,
    `[sub_resource type="TileSetAtlasSource" id="TileSetAtlasSource_1"]`,
    `texture = ExtResource("1_tex")`,
    `texture_region_size = Vector2i(${T}, ${T})`,
  ];
  for (const t of allTiles(m)) {
    const r = ring(m.layout, t.mask);
    const set = corner ? (r[1] + r[3] + r[5] + r[7]) : 0;
    // centre terrain: blob tiles are upper (the plain filler is lower); wang tiles take the majority of their corners
    const terrain = m.layout === "blob47" ? (t.filler ? 0 : 1) : set >= 2 ? 1 : 0;
    const id = `${t.col}:${t.row}/0`;
    lines.push(`${id} = 0`, `${id}/terrain_set = 0`, `${id}/terrain = ${terrain}`);
    BLOB_DIRS.forEach((d, i) => {
      if (corner && d.length === 1) return; // corner mode has no side bits
      lines.push(`${id}/terrains_peering_bit/${GODOT_BITS[d]} = ${r[i]}`);
    });
  }
  const fromHex = (h: string) => {
    const n = parseInt(h.slice(1), 16);
    return `Color(${((n >> 16) & 255) / 255}, ${((n >> 8) & 255) / 255}, ${(n & 255) / 255}, 1)`;
  };
  lines.push(
    ``,
    `[resource]`,
    `tile_size = Vector2i(${T}, ${T})`,
    // 0 = match corners and sides, 1 = match corners
    `terrain_set_0/mode = ${corner ? 1 : 0}`,
    `terrain_set_0/terrain_0/name = "${m.lower}"`,
    `terrain_set_0/terrain_0/color = ${fromHex(colors.lower)}`,
    `terrain_set_0/terrain_1/name = "${m.upper}"`,
    `terrain_set_0/terrain_1/color = ${fromHex(colors.upper)}`,
    `sources/0 = SubResource("TileSetAtlasSource_1")`,
    ``,
  );
  return lines.join("\n");
}

/**
 * Unity rules. `sprites` slice the PNG (`rect` has a top-left origin, `unityRect` the bottom-left
 * origin Unity's SpriteRect uses). Each tile has `corners`/`neighbours` (this terrain = "upper")
 * and `ruleNeighbors`: Unity RuleTile TilingRule values (0 DontCare, 1 This, 2 NotThis) for
 * [NW, N, NE, W, E, SW, S, SE]. For blob47 "This" means the neighbour is upper; for wang16
 * (a corner set meant for a dual-grid / vertex lookup) the edge entries are 0 and only
 * the corner entries carry meaning.
 */
export function unityRules(m: TilesetMeta, slug: string, imgW: number, imgH: number, scale: number) {
  const T = m.tileSize * scale;
  const corner = m.layout === "wang16";
  const tiles = allTiles(m).map((t) => {
    const r = ring(m.layout, t.mask); // N NE E SE S SW W NW
    const rn = (i: number) => (r[i] ? 1 : 2);
    const rule = corner
      ? [rn(7), 0, rn(1), 0, 0, rn(5), 0, rn(3)]
      : [rn(7), rn(0), rn(1), rn(6), rn(2), rn(5), rn(4), rn(3)];
    return {
      index: t.index, name: `${slug}_${t.index}`, mask: t.mask, filler: t.filler || undefined,
      rect: { x: t.x * scale, y: t.y * scale, w: T, h: T },
      unityRect: { x: t.x * scale, y: imgH - (t.y + m.tileSize) * scale, w: T, h: T },
      [corner ? "corners" : "neighbours"]: Object.fromEntries((corner ? WANG_CORNERS : BLOB_DIRS).map((d) => [d, r[BLOB_DIRS.indexOf(d)] ? "upper" : "lower"])),
      ruleNeighbors: rule,
    };
  });
  return {
    format: "pixel-builder-unity-rules", version: 1, image: `${slug}.png`, imageWidth: imgW, imageHeight: imgH,
    layout: m.layout, tileSize: T, pixelsPerUnit: T, cols: m.cols, rows: m.rows, upper: m.upper, lower: m.lower,
    terrainThis: m.layout === "blob47" ? "upper (the tile's own cell)" : "corner values",
    neighborOrder: ["NW", "N", "NE", "W", "E", "SW", "S", "SE"],
    neighborValues: { 0: "DontCare", 1: "This", 2: "NotThis" },
    ordering: m.ordering, sprites: tiles.map((t) => ({ name: t.name, rect: t.rect, unityRect: t.unityRect })), tiles,
  };
}

export function atlasIndex(m: TilesetMeta, slug: string, imgW: number, imgH: number, scale: number) {
  const s = (t: { x: number; y: number }) => ({ x: t.x * scale, y: t.y * scale });
  return {
    image: `${slug}.png`, imageWidth: imgW, imageHeight: imgH, tileSize: m.tileSize * scale, scale,
    layout: m.layout, cols: m.cols, rows: m.rows, upper: m.upper, lower: m.lower, ordering: m.ordering,
    tiles: m.tiles.map((t) => ({ ...t, ...s(t) })),
    ...(m.extra ? { extra: m.extra.map((t) => ({ ...t, ...s(t) })) } : {}),
  };
}

/** Render the files for one engine format (PNG scaled by `scale`; tile sizes in the files follow it). */
export function engineFiles(format: EngineFormat, slug: string, atlas: Sprite, kit: StyleKit, meta: TilesetMeta, scale = 1): EngineFile[] {
  const img = scaleImage(spriteImage(atlas, kit), scale);
  const png: EngineFile = { name: `${slug}.png`, data: encodePng(img), kind: "tileset", width: img.width, height: img.height };
  const pure = pureTiles(meta);
  const colors = {
    lower: swatch(atlas, kit, pure.lower.x, pure.lower.y, meta.tileSize),
    upper: swatch(atlas, kit, pure.upper.x, pure.upper.y, meta.tileSize),
  };
  switch (format) {
    case "tiled-tileset":
      return [png, { name: `${slug}.tsj`, data: json(tiledTileset(meta, slug, img.width, img.height, scale, colors)), kind: "engine" }];
    case "godot":
      return [png, { name: `${slug}.tres`, data: godotTileset(meta, slug, scale, colors), kind: "engine" }];
    case "unity":
      return [png, { name: `${slug}.rules.json`, data: json(unityRules(meta, slug, img.width, img.height, scale)), kind: "engine" }];
    case "atlas":
      return [png, { name: `${slug}.atlas.json`, data: json(atlasIndex(meta, slug, img.width, img.height, scale)), kind: "engine" }];
  }
}

import type { Material, Ramps } from "./palette";
import type { RigRecipe } from "./rig";

/** A single frame. `data[y * w + x]` is a palette index (0 = transparent). */
export interface Sprite {
  w: number;
  h: number;
  data: number[];
}

export type Category = "character" | "building" | "environment" | "object" | "ui" | "map";

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: "character", label: "Characters" },
  { id: "building", label: "Buildings" },
  { id: "environment", label: "Environment" },
  { id: "object", label: "Objects" },
  { id: "ui", label: "UI" },
  { id: "map", label: "Map" },
];

export type OutlineMode = "none" | "black" | "colored" | "selective";
/** "rich" adds hue-shifted ramps, sel-out, anti-aliased curves and humanoid micro-detail; absent = "standard". */
export type DetailLevel = "standard" | "rich";
export type LightDir = "top-left" | "top" | "top-right";

/**
 * The style kit is the single source of truth for "how this game looks".
 * Every generator, the AI prompts and the enforcement pass read from it.
 */
export interface StyleKit {
  id: string;
  name: string;
  paletteId: string;
  /** User edits on top of the base palette, per material ramp. */
  rampOverrides: Partial<Ramps>;
  outline: OutlineMode;
  lightDir: LightDir;
  /** How many ramp levels the lit renderer may use (2-5). Fewer = flatter, chunkier look. */
  shadeSteps: number;
  dither: boolean;
  /** Ambient light 0..1 — raises the darkest shade used on shadow sides. */
  ambient: number;
  sizes: Record<Exclude<Category, "map">, number> & { tile: number };
  /** Pixel richness (see DetailLevel). Optional so existing kits stay standard. */
  detail?: DetailLevel;
  /** Shades per material ramp: 7 or 9 adds smoother volume shading (HD kits); absent / 5 = classic. */
  rampDepth?: 5 | 7 | 9;
  /** Camera: "side" is the platformer view (ground line at the bottom, profile characters); "iso" is 2:1 dimetric (tile = diamond `tile` wide, `tile/2` tall, characters face the diagonals); absent = "topdown". */
  camera?: "topdown" | "side" | "iso";
  /** Free-text art direction used by the AI ("cozy, chunky, SNES-era"). */
  vibe: string;
  /** House style: edits are refused; fork it (create_kit / Duplicate) to change anything. */
  locked?: boolean;
  /** Bumped on every change (missing = 1). Assets record the version they were made with (`Asset.kitVersion`). */
  version?: number;
}

export interface FrameSet {
  /** Named row of an animation, e.g. "walk-down". */
  name: string;
  frames: Sprite[];
}

export interface Asset {
  id: string;
  name: string;
  category: Category;
  kitId: string;
  /** `StyleKit.version` at creation / last rerender (missing = 1). Older than the kit's = stale. */
  kitVersion?: number;
  /** One or more animation rows; static assets have a single row with one frame. */
  rows: FrameSet[];
  fps: number;
  source: { kind: "procedural" | "ai-vibe" | "ai-pixels" | "import" | "manual" | "rigged"; generator?: string; params?: unknown; seed?: number; prompt?: string; rig?: RigRecipe };
  /** Present for map assets: a self-contained tile grid (tile sprites are copied in). */
  tilemap?: TileMap;
  /** Free-form extras, e.g. `{ nineSlice: { left, top, right, bottom } }` for UI panels. */
  meta?: Record<string, unknown>;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface TileMap {
  cols: number;
  rows: number;
  tile: number;
  /** Ordered tile set. Each entry is a sprite (copied in, so maps are self-contained). */
  tiles: { name: string; sprite: Sprite; solid?: boolean }[];
  /** Ground layer: index into tiles, -1 empty. */
  ground: number[];
  /** Decoration layer drawn on top (trees, rocks...). */
  deco: number[];
  /** "isometric" = 2:1 diamond cells (`tile` wide, `tile / 2` tall); absent = orthogonal. */
  orientation?: "orthogonal" | "isometric";
  /** Isometric maps: raise of each cell's top face in pixels (parallel to `ground`); props on a raised cell stand on top of it. */
  heights?: number[];
}

export type MaterialMap = Partial<Record<string, Material>>;

/** A reference image (mood board entry). The inline `preview` (base64 PNG, longest side <= 512) syncs with the project; the full image lives in `references/<slug>.png` in a local workspace. */
export interface Reference {
  id: string;
  name: string;
  tags: string[];
  source: { kind: "path" | "url" | "paste"; value: string };
  /** Dimensions of the original image. */
  width: number;
  height: number;
  /** Base64 PNG, longest side <= REFERENCE_PREVIEW_MAX. */
  preview: string;
  createdAt: number;
}

export const REFERENCE_PREVIEW_MAX = 512;
export const REFERENCE_MAX_DIM = 4096;

// Building footprint and scale system: how many tiles a building covers, where its door is,
// which cells block movement, and how tall a person-scaled door/storey is. Pure data, no painting.
import type { StyleKit } from "./types";

/** Footprint in tiles. door = tile column on the front (bottom) row. */
export interface Footprint {
  w: number;
  d: number;
  storeys: number;
  door: number;
  /** Upgrade tier 1..3 for tiered styles (farmhouse, barn, coop); 2 elsewhere. */
  tier?: number;
}

export interface TileRect { x: number; y: number; w: number; h: number }

export interface BuildingFootprint extends Footprint {
  /** Walkable tile in front of the door, relative to the footprint's top-left. */
  entry: { dx: number; dy: number };
  /** Collision rect in tiles, relative to the footprint's top-left. */
  solid: TileRect;
  /** Canvas for the rich look in px: w = footprint width + side margins, h from storeys and roof. */
  canvas: { w: number; h: number };
}

type Dim = [w: number, d: number, storeys: number];

const TABLE: Record<string, Partial<Record<string, Dim>> & { medium: Dim }> = {
  cottage: { medium: [4, 3, 1] },
  shop: { medium: [5, 3, 1] },
  farmhouse: { small: [5, 3, 1], medium: [6, 4, 1], large: [7, 5, 2] },
  barn: { small: [6, 4, 1], medium: [7, 5, 1] },
  coop: { medium: [3, 2, 1] },
  tower: { medium: [3, 3, 3] },
  keep: { medium: [6, 5, 2] },
  "stilt-house": { medium: [5, 4, 1] },
  "half-brick": { medium: [6, 4, 2] },
  // reserved for the next building styles
  inn: { medium: [7, 5, 2] },
  temple: { medium: [7, 5, 1] },
  blacksmith: { medium: [5, 4, 1] },
  windmill: { medium: [3, 3, 1] },
  greenhouse: { medium: [5, 3, 1] },
  "market-stall": { medium: [3, 2, 1] },
  "well-house": { medium: [2, 2, 1] },
};

/** Upgrade tiers: shack, house, manor. Footprints grow with the tier. */
const TIERS: Record<string, [Dim, Dim, Dim]> = {
  farmhouse: [[4, 3, 1], [6, 4, 1], [7, 5, 2]],
  barn: [[5, 4, 1], [7, 5, 1], [8, 5, 2]],
  coop: [[2, 2, 1], [3, 2, 1], [4, 3, 1]],
};

export const FOOTPRINT_STYLES = Object.keys(TABLE);

/** A doorway: clearly taller than a person. */
export const doorHeightPx = (kit: StyleKit): number => Math.ceil(kit.sizes.character * 1.25);
/** One storey: a bit taller than the door. */
export const storeyHeightPx = (kit: StyleKit): number => Math.round(kit.sizes.character * 1.6);

/** `tier` 1..3 overrides `size` for tiered styles; 0 (default) keeps the size-based footprint. */
export function buildingFootprint(style: string, size: string, kit: StyleKit, tier = 0): BuildingFootprint {
  const row = TABLE[style] ?? TABLE.cottage;
  const tiers = TIERS[style];
  const t = tiers && tier >= 1 && tier <= 3 ? Math.round(tier) : 0;
  // barn "large" shares the medium footprint; unknown sizes fall back to medium
  const [w, d, storeys] = t ? tiers[t - 1] : (row[size] ?? row.medium);
  const derived = style === "farmhouse" ? (size === "small" ? 1 : size === "large" ? 3 : 2) : 2;
  const tile = kit.sizes.tile;
  const door = Math.floor((w - 1) / 2);
  const margin = 2; // px each side for overhang and the outline
  const roof = Math.round(storeyHeightPx(kit) * 0.7);
  return {
    w, d, storeys, door, tier: t || derived,
    entry: { dx: door, dy: d },
    solid: { x: 0, y: 0, w, h: d },
    canvas: { w: w * tile + margin * 2, h: storeys * storeyHeightPx(kit) + roof + Math.round(tile / 2) + margin },
  };
}

/** Minimal map grid: `solid[y * w + x]` is truthy where movement is blocked. */
export interface PlaceGrid {
  w: number;
  h: number;
  solid: { [i: number]: number | boolean };
}

export interface Placement {
  solidCells: { x: number; y: number }[];
  doorCell: { x: number; y: number };
  entryCell: { x: number; y: number };
}

function layout(fp: BuildingFootprint, at: { x: number; y: number }): Placement {
  const solidCells: { x: number; y: number }[] = [];
  for (let y = 0; y < fp.solid.h; y++) for (let x = 0; x < fp.solid.w; x++) solidCells.push({ x: at.x + fp.solid.x + x, y: at.y + fp.solid.y + y });
  return {
    solidCells,
    doorCell: { x: at.x + fp.door, y: at.y + fp.d - 1 },
    entryCell: { x: at.x + fp.entry.dx, y: at.y + fp.entry.dy },
  };
}

const inside = (g: PlaceGrid, x: number, y: number) => x >= 0 && y >= 0 && x < g.w && y < g.h;

/** True when the footprint and its entry tile are inside the grid, no solid cell is overlapped and the entry is free. */
export function canPlace(grid: PlaceGrid, fp: BuildingFootprint, at: { x: number; y: number }): boolean {
  const pl = layout(fp, at);
  for (const c of pl.solidCells) if (!inside(grid, c.x, c.y) || grid.solid[c.y * grid.w + c.x]) return false;
  const e = pl.entryCell;
  return inside(grid, e.x, e.y) && !grid.solid[e.y * grid.w + e.x];
}

/** Marks the footprint solid (entry stays walkable) and returns the cells; returns null and changes nothing if it cannot be placed. */
export function placeBuilding(grid: PlaceGrid, fp: BuildingFootprint, at: { x: number; y: number }): Placement | null {
  if (!canPlace(grid, fp, at)) return null;
  const pl = layout(fp, at);
  for (const c of pl.solidCells) grid.solid[c.y * grid.w + c.x] = 1;
  return pl;
}

// Rich 3/4 buildings as map objects: one deco tile per building, anchored on the door column of the
// footprint's front row, so the sprite's bottom sits on the front row's bottom edge (y-sort = footprint
// depth), the door column is the entry column and the cell below it is the walkable entry tile.
import { buildingFootprint, type BuildingFootprint } from "../footprint";
import { blit, createSprite } from "../sprite";
import type { Sprite, StyleKit } from "../types";
import { buildingGenerator } from "./building";
import { defaults } from "./types";

export type Extra = Record<string, string | number | boolean>;
export interface Light { x: number; y: number; r: number }

export interface RichBuilding {
  /** tile name; carries everything `richLoopFrames` needs to rebuild the animation rows */
  name: string;
  style: string;
  fp: BuildingFootprint;
  sprite: Sprite;
  /** emitters in sprite px (shifted with the sprite's padding) */
  lights: Light[];
  /** rows the sprite reaches above the front row */
  up: number;
  /** columns left / right of the door column covered by the footprint */
  left: number;
  right: number;
}

const cache = new WeakMap<StyleKit, Map<string, RichBuilding>>();
const clone = (s: Sprite): Sprite => ({ ...s, data: s.data.slice() });

export const richTileName = (style: string, extra: Extra, variant: number) => `rich:${style}:${variant}:${JSON.stringify(extra)}`;

function parseName(name: string): { style: string; variant: number; extra: Extra } | null {
  if (!name.startsWith("rich:")) return null;
  const parts = name.split(":");
  try { return { style: parts[1], variant: Number(parts[2]), extra: JSON.parse(parts.slice(3).join(":")) as Extra }; } catch { return null; }
}

/** Even footprints centre half a tile off a cell: pad one tile on the left so the blit lands on the footprint. */
function pad(s: Sprite, left: number): Sprite {
  if (!left) return s;
  const out = createSprite(s.w + left, s.h);
  blit(out, s, left, 0);
  return out;
}

const params = (style: string, extra: Extra) => ({ ...defaults(buildingGenerator), look: "rich", style, ...extra });

export function richBuilding(kit: StyleKit, style: string, extra: Extra, variant: number): RichBuilding {
  const name = richTileName(style, extra, variant);
  let m = cache.get(kit);
  if (!m) cache.set(kit, (m = new Map()));
  let b = m.get(name);
  if (!b) {
    const T = kit.sizes.tile;
    const res = buildingGenerator.generate(params(style, extra), kit, variant);
    const fp = buildingFootprint(style, String(extra.size ?? "medium"), kit, Number(extra.tier ?? 0));
    const left = fp.w % 2 === 0 ? T : 0;
    const sprite = pad(res.rows[0].frames[0], left);
    const lights = ((res.meta?.lights ?? []) as Light[]).map((l) => ({ x: l.x + left, y: l.y, r: l.r }));
    b = { name, style, fp, sprite, lights, up: Math.ceil(sprite.h / T) - 1, left: fp.door, right: fp.w - 1 - fp.door };
    m.set(name, b);
  }
  return { ...b, sprite: clone(b.sprite) };
}

/** Footprint rect (cells) of a building whose door column is `doorX` and front row is `frontY`. */
export function richRect(b: Pick<RichBuilding, "fp">, doorX: number, frontY: number) {
  return { x0: doorX - b.fp.door, y0: frontY - b.fp.d + 1, x1: doorX - b.fp.door + b.fp.w - 1, y1: frontY };
}

/** Ambient loop (smoke puffs, windmill sails) of a rich building tile, padded like the idle sprite; null when it has none. */
export function richLoopFrames(name: string, idle: Sprite, kit: StyleKit): Sprite[] | null {
  const p = parseName(name);
  if (!p) return null;
  const T = kit.sizes.tile;
  const res = buildingGenerator.generate(params(p.style, p.extra), kit, p.variant);
  const fp = buildingFootprint(p.style, String(p.extra.size ?? "medium"), kit, Number(p.extra.tier ?? 0));
  const left = fp.w % 2 === 0 ? T : 0;
  const row = res.rows.find((r) => r.name === "spin") ?? res.rows.find((r) => r.name === "smoke");
  if (!row || row.frames.length < 2) return null;
  const frames = row.frames.map((f) => pad(f, left));
  const f0 = frames[0];
  if (f0.w !== idle.w || f0.h !== idle.h || !f0.data.every((v, i) => v === idle.data[i])) return null;
  return frames;
}

/** What a game needs to know about a placed rich building (cells, door, entry, lights in map pixels). */
export interface PlacedRich {
  style: string;
  name: string;
  /** anchor cell: door column, front row */
  x: number;
  y: number;
  footprint: { x: number; y: number; w: number; d: number };
  /** solid cells = the footprint */
  solid: { x0: number; y0: number; x1: number; y1: number };
  door: { x: number; y: number };
  entry: { x: number; y: number };
  /** window / lamp / forge emitters in map pixels */
  lights: Light[];
}

export function placedRich(kit: StyleKit, style: string, extra: Extra, variant: number, doorX: number, frontY: number): PlacedRich {
  const rb = richBuilding(kit, style, extra, variant), T = kit.sizes.tile;
  const rect = richRect(rb, doorX, frontY);
  const ox = Math.round(doorX * T + T / 2 - rb.sprite.w / 2), oy = (frontY + 1) * T - rb.sprite.h;
  return {
    style, name: rb.name, x: doorX, y: frontY,
    footprint: { x: rect.x0, y: rect.y0, w: rb.fp.w, d: rb.fp.d },
    solid: rect, door: { x: doorX, y: frontY }, entry: { x: doorX, y: frontY + 1 },
    lights: rb.lights.map((l) => ({ x: ox + l.x, y: oy + l.y, r: l.r })),
  };
}

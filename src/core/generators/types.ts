import { MATERIALS, type Material } from "../palette";
import type { Rng } from "../rng";
import type { Category, FrameSet, StyleKit, TileMap } from "../types";

export type ParamValue = string | number | boolean;
export type Params = Record<string, ParamValue>;

export type ParamSpec =
  | { key: string; label: string; type: "select"; options: string[]; default: string }
  | { key: string; label: string; type: "material"; options?: Material[]; default: Material }
  | { key: string; label: string; type: "number"; min: number; max: number; step?: number; default: number }
  | { key: string; label: string; type: "bool"; default: boolean };

export interface GenResult {
  rows: FrameSet[];
  fps: number;
  /** Only the map generator sets this; rows[0].frames[0] is then the rendered map preview. */
  tilemap?: TileMap;
  /** Optional extra metadata stored on the asset (e.g. 9-slice insets for UI panels). */
  meta?: Record<string, unknown>;
}

export interface Generator {
  id: string;
  category: Category;
  label: string;
  /** One-line description for the AI so it can pick a generator. */
  description: string;
  params: ParamSpec[];
  generate(p: Params, kit: StyleKit, seed: number): GenResult;
}

/** Materials that make sense as paint for objects (excludes structural ink/ui). */
export const PAINT: Material[] = MATERIALS.filter((m) => m !== "ink" && m !== "ui");

export function defaults(g: Generator): Params {
  const out: Params = {};
  for (const s of g.params) out[s.key] = s.default;
  return out;
}

export function randomParams(g: Generator, r: Rng): Params {
  const out: Params = {};
  for (const s of g.params) {
    if (s.type === "select") out[s.key] = r.pick(s.options);
    else if (s.type === "material") out[s.key] = r.chance(0.6) ? s.default : r.pick(s.options ?? PAINT);
    else if (s.type === "number") {
      const step = s.step ?? 1;
      out[s.key] = s.min + Math.round((r.next() * (s.max - s.min)) / step) * step;
    } else out[s.key] = r.chance(0.5);
  }
  return out;
}

/** Fill in missing / invalid values from defaults so AI-produced params are always safe. */
export function coerceParams(g: Generator, input: Record<string, unknown>): Params {
  const out = defaults(g);
  for (const s of g.params) {
    const v = input[s.key];
    if (v === undefined || v === null) continue;
    if (s.type === "select" && typeof v === "string" && s.options.includes(v)) out[s.key] = v;
    else if (s.type === "material" && typeof v === "string" && (s.options ?? PAINT).includes(v as Material)) out[s.key] = v;
    else if (s.type === "number" && typeof v === "number" && Number.isFinite(v)) out[s.key] = Math.max(s.min, Math.min(s.max, v));
    else if (s.type === "bool" && typeof v === "boolean") out[s.key] = v;
  }
  return out;
}

export const str = (p: Params, k: string) => String(p[k]);
export const num = (p: Params, k: string) => Number(p[k]);
export const bool = (p: Params, k: string) => Boolean(p[k]);
export const mat = (p: Params, k: string) => String(p[k]) as Material;

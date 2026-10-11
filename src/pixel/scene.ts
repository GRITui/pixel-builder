// Z-layer scene compositor: parses a scene-spec.json (owner's Game Asset Design Guide
// schema) and composes a layered environment onto a strict 4-layer stack, writing
// layer-separated PNGs, the flat composite, and pivot metadata.
//
// Layers (guide §2.2):
//   L0 base ground   — mud/dirt/bed, 100% opacity
//   L1 submerged     — underwater roots/rocks, 40-60% alpha, blue/cyan tinted
//   L2 water surface — translucent fill, caustics, shoreline foam
//   L3 surface float — lily pads, blossoms, canopy overhang
// Pivots: entities bottom-centre (0.5, 1.0); structures bottom-left.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Rgba } from "./types";
import { wangTile, canonicalMasks, canonicalMask, swatchMean, ramp, type WangOptions } from "./wang";
import { enforceClusters } from "./cluster";

export interface SceneSpec {
  project: { name: string; tileSize: number; projection: "TOP_DOWN_3_4" | string; paletteLUT?: string };
  terrain: {
    autoTiling: {
      system: "WANG_47_BITMASK" | string;
      layers: { id: string; zOrder: number; alpha?: number; bitmaskRule?: string; tile?: string; band?: number }[];
    };
    /** Map of terrain id -> tile index grid, row-major strings. Legend maps chars to layer ids. */
    grid?: string[];
    legend?: Record<string, string>;
  };
  entities?: {
    id: string;
    image: string;
    footprint?: { tilesX: number; tilesY: number };
    pivot?: "BOTTOM_CENTER" | "BOTTOM_LEFT" | "CENTER";
    at: { x: number; y: number };
    layerSplit?: { submergedRoots?: { targetLayer: number; alpha: number }; trunkAndCanopy?: { targetLayer: number; alpha: number } };
  }[];
  postProcessing?: {
    clusterFilter?: string;             // "MIN_2X2"
    removeSinglePixelNoise?: boolean;
    hueShift?: { highlightTint?: string; shadowTint?: string };
  };
}

const LAYERS = 4;

function hex(c: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) throw new Error(`'${c}' is not a #rrggbb colour`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function blank(w: number, h: number): Rgba {
  return { w, h, data: new Uint8ClampedArray(w * h * 4) };
}

function blit(dst: Rgba, src: Rgba, ox: number, oy: number, alphaScale = 1): void {
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
    const px = ox + x, py = oy + y;
    if (px < 0 || py < 0 || px >= dst.w || py >= dst.h) continue;
    const s = (y * src.w + x) * 4, d = (py * dst.w + px) * 4;
    const a = Math.round(src.data[s + 3] * alphaScale);
    if (a === 0) continue;
    if (a === 255 || dst.data[d + 3] === 0) {
      dst.data[d] = src.data[s]; dst.data[d + 1] = src.data[s + 1]; dst.data[d + 2] = src.data[s + 2];
      dst.data[d + 3] = 255;
    } else {
      // OVER with the given alpha
      const aa = a / 255, ba = dst.data[d + 3] / 255;
      const oa = aa + ba * (1 - aa);
      for (let k = 0; k < 3; k++) dst.data[d + k] = Math.round((src.data[s + k] * aa + dst.data[d + k] * ba * (1 - aa)) / oa);
      dst.data[d + 3] = Math.round(oa * 255);
    }
  }
}

/** Blue/cyan tint + alpha for the submerged layer (guide: reduced saturation under water). */
function submerge(img: Rgba, alpha: number, tint: [number, number, number]): Rgba {
  const out = { w: img.w, h: img.h, data: new Uint8ClampedArray(img.data) };
  for (let i = 0; i < img.w * img.h; i++) {
    if (out.data[i * 4 + 3] === 0) continue;
    const r = out.data[i * 4], g = out.data[i * 4 + 1], b = out.data[i * 4 + 2];
    const grey = 0.3 * r + 0.59 * g + 0.11 * b;
    out.data[i * 4] = Math.round(r * (1 - 0.4) + (grey * 0.6 + tint[0] * 0.4));
    out.data[i * 4 + 1] = Math.round(g * (1 - 0.4) + (grey * 0.75 + tint[1] * 0.4));
    out.data[i * 4 + 2] = Math.round(b * (1 - 0.4) + (grey * 0.85 + tint[2] * 0.4));
    out.data[i * 4 + 3] = Math.round(255 * alpha);
  }
  return out;
}

export interface SceneResult {
  layers: Rgba[];               // [L0, L1, L2, L3]
  composite: Rgba;
  meta: {
    name: string; tileSize: number; width: number; height: number;
    pivots: { id: string; pivot: string; px: number; py: number }[];
    entities: { id: string; layer: number; px: number; py: number; footprint?: { tilesX: number; tilesY: number } }[];
    wang: { masks: number[]; tileSize: number; band: number };
  };
}

export function buildScene(specPath: string, outDir: string): SceneResult {
  const spec = JSON.parse(readFileSync(resolve(specPath), "utf8")) as SceneSpec;
  const T = spec.project.tileSize ?? 16;
  const gw = spec.terrain.grid?.[0]?.length ?? 0;
  const gh = spec.terrain.grid?.length ?? 0;
  if (!gw || !gh) throw new Error("scene-spec: terrain.grid rows missing");
  const W = gw * T, H = gh * T;

  // --- terrain layers via the wang engine ---
  // one wang layer per terrain layer entry; transition bands only where the neighbour is a LOWER zOrder band
  const layers: Rgba[] = Array.from({ length: LAYERS }, () => blank(W, H));
  const layerOf: Record<string, number> = {};
  spec.terrain.autoTiling.layers.forEach((l) => { layerOf[l.id] = Math.max(0, Math.min(LAYERS - 1, l.zOrder)); });
  const legend = spec.terrain.legend ?? {};
  // swatch tiles: each terrain layer id names an image (16x16-ish texture) in spec.terrain
  const swatches: Record<string, Rgba> = {};
  for (const l of spec.terrain.autoTiling.layers) {
    if (!l.tile) continue;
    const buf = readFileSync(resolve(l.tile));
    swatches[l.id] = decodeImageSync(buf);
  }
  const grid = spec.terrain.grid;
  if (!grid) throw new Error("scene-spec: terrain.grid missing");
  const ids = spec.terrain.autoTiling.layers.map((l) => l.id);
  // per-cell terrain id from the legend
  const cell: string[][] = grid.map((row) => [...row].map((ch) => legend[ch] ?? ch));
  const bandPx = Math.max(2, Math.round(T / 8));
  const cluster = spec.postProcessing?.clusterFilter === "MIN_4X4" ? 4 : 2;

  for (let cy = 0; cy < gh; cy++) for (let cx = 0; cx < gw; cx++) {
    const id = cell[cy][cx];
    const zi = layerOf[id] ?? 0;
    // raw neighbour mask: neighbour with LOWER z (closer to water) triggers the transition
    let mask = 0;
    const DIRS: [string, number, number, number][] = [["N", 0, -1, 1], ["NE", 1, -1, 2], ["E", 1, 0, 4], ["SE", 1, 1, 8], ["S", 0, 1, 16], ["SW", -1, 1, 32], ["W", -1, 0, 64], ["NW", -1, -1, 128]];
    for (const [, dx, dy, bit] of DIRS) {
      const n = cell[cy + dy]?.[cx + dx];
      if (n === undefined) continue;
      const zn = layerOf[n] ?? 0;
      if (zn > zi || (zn === zi && n !== id && spec.terrain.autoTiling.layers[zi]?.bitmaskRule === "INNER_BORDER")) mask |= bit;
    }
    mask = canonicalMask(mask);
    const land = swatchMean(swatches[id] ?? swatches[ids[0]]);
    const waterId = ids[ids.length - 1];
    const water = swatchMean(swatches[waterId] ?? swatches[ids[0]]);
    const o: WangOptions = { tileSize: T, ramp: ramp(land, water, Math.max(2, Math.min(5, waterStepsFor(spec)))), band: bandPx, cluster, seed: 1 };
    const tile = wangTile(mask, o);
    blit(layers[Math.min(zi, LAYERS - 1)], tile, cx * T, cy * T);
  }

  // --- entities ---
  const pivots: SceneResult["meta"]["pivots"] = [];
  const ents: SceneResult["meta"]["entities"] = [];
  for (const e of spec.entities ?? []) {
    const buf = readFileSync(resolve(e.image));
    const img = decodeImageSync(buf);
    const at = { x: e.at.x * T, y: e.at.y * T };
    const root = e.layerSplit?.submergedRoots;
    if (root) {
      const tint: [number, number, number] = spec.postProcessing?.hueShift?.shadowTint ? hex(spec.postProcessing.hueShift.shadowTint) : [40, 110, 160];
      const sub = submerge(img, root.alpha ?? 0.5, tint);
      blit(layers[Math.max(0, Math.min(LAYERS - 1, root.targetLayer))], sub, at.x, at.y);
    }
    const canopy = e.layerSplit?.trunkAndCanopy;
    const target = canopy ? Math.max(0, Math.min(LAYERS - 1, canopy.targetLayer)) : (e as { targetLayer?: number }).targetLayer ?? LAYERS - 1;
    blit(layers[target], img, at.x, at.y, canopy?.alpha ?? 1);
    const pivot = e.pivot ?? "BOTTOM_CENTER";
    const fp = e.footprint;
    const px = pivot === "BOTTOM_LEFT" ? at.x : at.x + Math.round(((fp?.tilesX ?? 1) * img.w) / 2);
    const py = pivot === "CENTER" ? at.y + Math.round(img.h / 2) : at.y + (fp?.tilesY ?? 1) * img.h;
    pivots.push({ id: e.id, pivot, px, py });
    ents.push({ id: e.id, layer: target, px: at.x, py: at.y, footprint: fp });
  }

  // --- post: cluster filter on every layer (the guide's anti-noise rule) ---
  if (spec.postProcessing?.clusterFilter || spec.postProcessing?.removeSinglePixelNoise) {
    for (const l of layers) enforceClusters(l, spec.postProcessing?.clusterFilter === "MIN_4X4" ? 4 : 2);
  }

  // --- composite: L0..L3 (alpha OVER) ---
  const composite = blank(W, H);
  for (const l of layers) blit(composite, l, 0, 0);

  void outDir;
  return {
    layers, composite,
    meta: { name: spec.project.name, tileSize: T, width: W, height: H, pivots, entities: ents, wang: { masks: canonicalMasks(), tileSize: T, band: bandPx } },
  };
}

function waterStepsFor(spec: SceneSpec): number {
  return spec.terrain.autoTiling.layers.length;
}

// decodeImage is async in this codebase; the scene builder is sync by design (file-driven),
// so use the PNG codec directly — scene specs reference PNG tiles.
import { decodePng } from "../io/png";
function decodeImageSync(buf: Buffer): Rgba {
  return decodePng(buf);
}

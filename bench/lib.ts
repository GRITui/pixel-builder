// Shared bits of the benchmark: brief loading, offline recipe validation, automated metrics.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GENERATORS } from "../src/core/generators";
import { decodeIndex } from "../src/core/palette";
import type { Asset, Sprite } from "../src/core/types";
import { TOOLS, callTool, parseInput } from "../src/node/tools";
import type { Workspace } from "../src/node/workspace";

export interface RecipeStep {
  tool: "generate_asset" | "generate_rigged" | "generate_pack";
  input: Record<string, unknown>;
}
export interface Brief {
  id: string;
  category: string;
  prompt: string;
  /** Our best answer: plain tool inputs, no AI. */
  recipe: RecipeStep[];
  /** Side-view brief: rendered with kit-side only. */
  side?: boolean;
  /** Override the kit list. */
  kits?: string[];
  /** Expected number of facing directions (side view: 2, left/right), for the coverage metric. */
  expect?: { directions?: number };
}

export const KITS = ["kit-default", "kit-gameboy", "kit-neon", "kit-hd-rich"];
export const SIDE_KITS = ["kit-side"];
export const BENCH_DIR = dirname(fileURLToPath(import.meta.url));

export const kitsFor = (b: Brief) => b.kits ?? (b.side ? SIDE_KITS : KITS);

export function loadBriefs(file = join(BENCH_DIR, "briefs.json")): Brief[] {
  return JSON.parse(readFileSync(file, "utf8")) as Brief[];
}

const RECIPE_TOOLS = ["generate_asset", "generate_rigged", "generate_pack"];

/** Static checks of one brief against tool schemas, generators, rigs, clips and attachments. Returns problems (empty = ok). */
export function validateBrief(b: Brief, ws: Workspace): string[] {
  const errs: string[] = [];
  const ids = (tool: string, key: string) => new Set<string>(((callTool(ws, tool, {}).data as any)[key] as { id: string }[]).map((x) => x.id));
  const rigs = ids("list_rigs", "rigs"), clips = ids("list_clips", "clips"), atts = ids("list_attachments", "attachments");
  if (!b.id || !b.prompt || !b.category) errs.push("id, category and prompt are required");
  if (!b.recipe?.length) errs.push("recipe is empty");
  const checkEntry = (tool: string, input: any, where: string) => {
    if (tool === "generate_rigged") {
      if (!rigs.has(input.rig)) errs.push(`${where}: unknown rig '${input.rig}'`);
      for (const c of input.clips ?? []) if (!clips.has(c)) errs.push(`${where}: unknown clip '${c}'`);
      for (const a of input.attachments ?? []) if (!atts.has(a)) errs.push(`${where}: unknown attachment '${a}'`);
      return;
    }
    const g = GENERATORS.find((x) => x.id === input.generator);
    if (!g) return void errs.push(`${where}: unknown generator '${input.generator}'`);
    for (const [k, v] of Object.entries(input.params ?? {})) {
      const p = g.params.find((x) => x.key === k);
      if (!p) errs.push(`${where}: ${g.id} has no param '${k}'`);
      else if ("options" in p && p.options && !(p.options as readonly unknown[]).map(String).includes(String(v))) errs.push(`${where}: ${g.id}.${k}='${v}' not in ${(p.options ?? []).join("/")}`);
    }
  };
  (b.recipe ?? []).forEach((s, i) => {
    const where = `${b.id}[${i}]`;
    if (!RECIPE_TOOLS.includes(s.tool)) return void errs.push(`${where}: tool '${s.tool}' not allowed in a recipe`);
    const tool = TOOLS.find((t) => t.name === s.tool)!;
    try {
      parseInput(tool, { ...s.input, kit_id: kitsFor(b)[0] });
    } catch (e) {
      return void errs.push(`${where}: ${(e as Error).message}`);
    }
    if (s.tool === "generate_pack") for (const e of (s.input as any).manifest?.entries ?? []) checkEntry("generator" in e ? "generate_asset" : "generate_rigged", e, where);
    else checkEntry(s.tool, s.input, where);
  });
  return errs;
}

// ---------- automated metrics ----------

const DIRS = ["down", "up", "left", "right", "down-right", "up-right", "up-left", "down-left"];
export interface Metrics {
  assets: number;
  frames: number;
  rows: number;
  /** Distinct facing directions found in row names (`<clip>-<dir>`); null when the brief has no animated rows. */
  directions: number | null;
  expectedDirections: number | null;
  /** Distinct animation clip names (row names with the direction stripped). */
  clips: number;
  /** Distinct palette indices used across all sprites. */
  paletteColors: number;
  /** Share of silhouette-edge pixels that are dark outline-level (null where no outline applies: tiles, maps, UI). */
  outlineCompliance: number | null;
  /** Share of props whose silhouette keeps a 1px transparent margin (null where it does not apply). */
  marginOk: number | null;
}

const OUTLINED_SKIP = new Set(["tileset", "map", "sidelevel", "ui"]);
function outlineApplies(a: Asset): boolean {
  const g = a.source.generator;
  if (g && OUTLINED_SKIP.has(g)) return false;
  if (a.category === "map" || a.category === "ui") return false;
  const kind = String((a.source.params as any)?.kind ?? "");
  if (kind.endsWith("-tile") || kind.startsWith("ground") || kind.startsWith("slope") || kind.startsWith("bg-") || kind === "platform" || kind === "ladder") return false;
  return true;
}

function edgeStats(s: Sprite): { edge: number; dark: number; margin: boolean } {
  let edge = 0, dark = 0, margin = true;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= s.w || y >= s.h ? 0 : s.data[y * s.w + x]);
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++) {
      const v = at(x, y);
      if (!v) continue;
      if (x === 0 || y === 0 || x === s.w - 1 || y === s.h - 1) margin = false;
      if (!at(x - 1, y) || !at(x + 1, y) || !at(x, y - 1) || !at(x, y + 1)) {
        edge++;
        const d = decodeIndex(v);
        if (!d || d.mat === "ink" || d.level <= 1) dark++;
      }
    }
  return { edge, dark, margin };
}

export function metricsOf(assets: Asset[], expectedDirections?: number): Metrics {
  const used = new Set<number>();
  const dirs = new Set<string>(), clips = new Set<string>();
  let frames = 0, rows = 0, edge = 0, dark = 0, marginN = 0, marginOk = 0, animated = false;
  for (const a of assets) {
    const outlined = outlineApplies(a);
    const first = a.rows[0].frames[0];
    for (const r of a.rows) {
      rows++;
      const m = DIRS.slice().sort((x, y) => y.length - x.length).find((d) => r.name.endsWith("-" + d));
      if (m) {
        dirs.add(m);
        clips.add(r.name.slice(0, -m.length - 1));
        animated = true;
      } else if (a.rows.length > 1 || r.frames.length > 1) clips.add(r.name);
      for (const f of r.frames) {
        frames++;
        for (const v of f.data) if (v) used.add(v);
        if (outlined && f !== undefined) {
          const e = edgeStats(f);
          edge += e.edge;
          dark += e.dark;
        }
      }
    }
    if (outlined) {
      marginN++;
      if (edgeStats(first).margin) marginOk++;
    }
  }
  return {
    assets: assets.length,
    frames,
    rows,
    directions: animated ? dirs.size : null,
    expectedDirections: expectedDirections ?? null,
    clips: clips.size,
    paletteColors: used.size,
    outlineCompliance: edge ? dark / edge : null,
    marginOk: marginN ? marginOk / marginN : null,
  };
}

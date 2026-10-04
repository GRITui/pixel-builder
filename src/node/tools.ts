// The agent tool layer: every capability exists once, here, as a function from
// (workspace, validated input) to plain data + PNG buffers. The MCP server
// (mcp.ts) and the CLI (cli.ts) are thin adapters over TOOLS, so tool names and
// input fields are identical in both.
import { fitRigToWorld } from "../core/rigs/fit";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { createAsset } from "../core/asset";
import { downscaleRGBA, finalize, materialsUsed, quantizeRGBA } from "../core/enforce";
import { GENERATORS, generatorById } from "../core/generators";
import { coerceParams, defaults, randomParams, type Generator, type ParamSpec, type Params } from "../core/generators/types";
import { newId } from "../core/kit";
import { buildLegend, decodeRows, encodeSprite, legendText, type Legend } from "../core/legend";
import { cropRowsToSprite, inpaintFrame, maskBounds, offLegendChars, toMaskGrid, type MaskRect, type Region } from "../core/inpaint";
import { MATERIALS, PALETTES, RAMP_LEN, type Material } from "../core/palette";
import type { ProjectFile } from "../core/project";
import { rigSvgInfo, svgToSprites } from "../core/svg";
import { renderRig, renderRigFrame, solvePose, validateRig, type Attachment, type Clip, type RigDef, type RigRecipe } from "../core/rig";
import { ATTACHMENTS, CLIPS, RIGS, withHumanoidDefaults } from "../core/rigs";
import { randomSeed, rng } from "../core/rng";
import { CATEGORIES, type Asset, type Category, type Sprite, type StyleKit } from "../core/types";
import { decodePng, contactSheet, encodePng, previewScale, sheetImage, spriteImage, type RgbaImage } from "./png";
import { isRigged, packById, PACKS, type PackEntry } from "./packs";
import {
  ToolError, Workspace, assetFiles, exportAsset as exportAssetRaw, findAsset, getKit, isAnimated, kitOf, removeAssetFiles,
  type ExportedFile, type ExportOptions,
} from "./workspace";
import { svgExists } from "./workspace";

export { ToolError };

// ---------- tool plumbing ----------

export interface ToolImage {
  png: Buffer;
  /** Short caption, also used as the file stem when the CLI saves previews. */
  label: string;
}

export interface ToolResult {
  /** Compact JSON-able result (ids, names, sizes, file paths, short notes). */
  data: unknown;
  /** Human/LLM-readable rendering used instead of JSON when it reads better (style guide). */
  text?: string;
  /** Previews for multimodal hosts (MCP `image` blocks / files saved by the CLI). */
  images?: ToolImage[];
}

export interface ToolDef {
  name: string;
  title: string;
  description: string;
  shape: z.ZodRawShape;
  /** Input that the CLI accepts as the first positional argument. */
  positional?: string;
  readOnly?: boolean;
  destructive?: boolean;
  /** Sync tools return a ToolResult; async tools (edit_region prompt-mode) return a promise. */
  run(ws: Workspace, input: any): ToolResult | Promise<ToolResult>;
}

function defineTool<S extends z.ZodRawShape>(d: {
  name: string;
  title: string;
  description: string;
  shape: S;
  positional?: keyof S & string;
  readOnly?: boolean;
  destructive?: boolean;
  run: (ws: Workspace, input: z.output<z.ZodObject<S>>) => ToolResult | Promise<ToolResult>;
}): ToolDef {
  return d as unknown as ToolDef;
}

const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as [Category, ...Category[]];
const categoryEnum = z.enum(CATEGORY_IDS);
const kitIdField = z.string().optional().describe("Style kit id (see list_kits). Default: the active kit.");
const paramsField = z
  .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
  .optional()
  .describe("Generator params by key (see list_generators). Missing keys use defaults.");

/** Validate raw input against a tool's schema with an agent-readable error. */
export function parseInput(tool: ToolDef, raw: unknown): any {
  const r = z.object(tool.shape).strict().safeParse(raw ?? {});
  if (r.success) return r.data;
  const lines = r.error.issues.map((i) => {
    const where = i.path.length ? i.path.join(".") : "(input)";
    if (i.code === "unrecognized_keys") {
      const keys = (i as { keys: string[] }).keys.map((k) => `'${k}'`).join(", ");
      return i.path.length ? `${where}: unknown key ${keys}` : `unknown input ${keys}; valid inputs: ${Object.keys(tool.shape).join(", ")}`;
    }
    return `${where}: ${i.message}`;
  });
  throw new ToolError(`Invalid input for ${tool.name}: ${lines.join("; ")}`);
}

/** JSON Schema of a tool's input (used for CLI help and flag coercion). */
export function inputJsonSchema(tool: ToolDef): { properties?: Record<string, any>; required?: string[] } {
  return z.toJSONSchema(z.object(tool.shape), { io: "input", unrepresentable: "any" }) as any;
}

/** Withhold workspace warnings until the result is built (shared by both entry points). */
function withWarnings(ws: Workspace, result: ToolResult): ToolResult {
  if (ws.warnings.length && result.data && typeof result.data === "object" && !Array.isArray(result.data))
    (result.data as Record<string, unknown>).workspace_warnings = ws.warnings;
  return result;
}

export function callTool(ws: Workspace, name: string, raw: unknown): ToolResult {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new ToolError(`Unknown tool '${name}'. Tools: ${TOOLS.map((t) => t.name).join(", ")}`);
  const result = tool.run(ws, parseInput(tool, raw));
  if (result instanceof Promise) throw new ToolError(`Tool '${name}' is async; call it with callToolAsync.`);
  return withWarnings(ws, result);
}

/**
 * Async entry point for tools that may hit the network (edit_region prompt-mode).
 * Sync tools resolve immediately; the CLI, the MCP server and internal callers
 * that only use sync tools keep their synchronous signature.
 */
export async function callToolAsync(ws: Workspace, name: string, raw: unknown): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new ToolError(`Unknown tool '${name}'. Tools: ${TOOLS.map((t) => t.name).join(", ")}`);
  return withWarnings(ws, await tool.run(ws, parseInput(tool, raw)));
}

// ---------- helpers ----------

const png = (img: RgbaImage, label: string): ToolImage => ({ png: encodePng(img), label });

function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/** Closest candidates to `input` (case-insensitive substring or small edit distance). */
export function nearest(input: string, candidates: readonly string[], max = 3): string[] {
  const q = input.toLowerCase();
  return candidates
    .map((c) => ({ c, d: c.toLowerCase().includes(q) || q.includes(c.toLowerCase()) ? 0 : levenshtein(q, c.toLowerCase()) }))
    .filter((x) => x.d <= Math.max(1, Math.floor(q.length / 3)))
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((x) => x.c);
}

function resolveGenerator(id: string): Generator {
  const g = generatorById(id) ?? GENERATORS.find((x) => x.id === id.toLowerCase());
  if (g) return g;
  const hints: string[] = nearest(id, GENERATORS.map((x) => x.id), 2).map((n) => `'${n}'`);
  throw new ToolError(
    `Unknown generator '${id}'.` + (hints.length ? ` Did you mean ${hints.join(" or ")}?` : "") + ` Generators: ${GENERATORS.map((x) => x.id).join(", ")} (see list_generators).`,
  );
}

function describeSpec(s: ParamSpec): string {
  if (s.type === "select") return `one of ${s.options.join(", ")}`;
  if (s.type === "material") return `a material (${(s.options ?? MATERIALS).join(", ")})`;
  if (s.type === "number") return `a number ${s.min}..${s.max}`;
  return "true or false";
}

/**
 * Validate agent-supplied generator params. Unknown keys and invalid values are errors
 * (so the agent corrects them instead of silently getting defaults); out-of-range numbers are clamped.
 * Strings like "12" / "true" are accepted for number / bool params (CLI convenience).
 */
function validateParams(g: Generator, input: Record<string, unknown>): { params: Params; provided: string[]; notes: string[] } {
  const notes: string[] = [];
  const specs = new Map(g.params.map((s) => [s.key, s]));
  const clean: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(input)) {
    const s = specs.get(key);
    if (!s) {
      const near = nearest(key, [...specs.keys()], 1);
      throw new ToolError(`Generator '${g.id}' has no param '${key}'.` + (near.length ? ` Did you mean '${near[0]}'?` : "") + ` Params: ${[...specs.keys()].join(", ") || "(none)"}.`);
    }
    let v = raw;
    if (s.type === "number" && typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) v = Number(v);
    if (s.type === "bool" && (v === "true" || v === "false")) v = v === "true";
    const ok =
      s.type === "select" ? typeof v === "string" && s.options.includes(v)
      : s.type === "material" ? typeof v === "string" && (s.options ?? MATERIALS).includes(v as never)
      : s.type === "number" ? typeof v === "number" && Number.isFinite(v)
      : typeof v === "boolean";
    if (!ok) {
      const opts = s.type === "select" ? s.options : s.type === "material" ? [...(s.options ?? MATERIALS)] : [];
      const near = typeof v === "string" && opts.length ? nearest(v, opts, 1) : [];
      throw new ToolError(`Param '${key}' of '${g.id}' must be ${describeSpec(s)}; got ${JSON.stringify(raw)}.` + (near.length ? ` Did you mean '${near[0]}'?` : ""));
    }
    if (s.type === "number" && ((v as number) < s.min || (v as number) > s.max)) notes.push(`param '${key}' ${String(v)} clamped to ${s.min}..${s.max}`);
    clean[key] = v;
  }
  return { params: coerceParams(g, clean), provided: Object.keys(clean), notes };
}

interface AssetSummary {
  id: string;
  name: string;
  category: Category;
  kit_id: string;
  width: number;
  height: number;
  rows: { name: string; frames: number }[];
  fps: number;
  source: { kind: Asset["source"]["kind"]; generator?: string; seed?: number; params?: unknown; rig?: { rig: string; slots?: Record<string, string>; attachments: string[]; clips: string[] } };
  tags: string[];
  tilemap?: { cols: number; rows: number; tile: number; tiles: string[] };
  files: string[];
}

function summarize(ws: Workspace, project: ReturnType<Workspace["load"]>, a: Asset): AssetSummary {
  const f = a.rows[0].frames[0];
  return {
    id: a.id,
    name: a.name,
    category: a.category,
    kit_id: a.kitId,
    width: f.w,
    height: f.h,
    rows: a.rows.map((r) => ({ name: r.name, frames: r.frames.length })),
    fps: a.fps,
    source: { kind: a.source.kind, ...(a.source.generator ? { generator: a.source.generator } : {}), ...(a.source.seed !== undefined ? { seed: a.source.seed } : {}), ...(a.source.params ? { params: a.source.params } : {}), ...(a.source.rig ? { rig: recipeSummary(a.source.rig) } : {}) },
    tags: a.tags,
    ...(a.tilemap ? { tilemap: { cols: a.tilemap.cols, rows: a.tilemap.rows, tile: a.tilemap.tile, tiles: a.tilemap.tiles.map((t) => t.name) } } : {}),
    files: assetFiles(ws, project, a),
  };
}

/** Preview PNG of an asset, >= ~256px on its long side, on a checkerboard so transparency is visible. */
function previewOf(a: Asset, kit: StyleKit): ToolImage {
  if (isAnimated(a) && a.category !== "map") {
    const grid = a.rows.map((r) => r.frames);
    const cols = Math.max(...grid.map((r) => r.length));
    const w = Math.max(...grid.flat().map((s) => s.w)), h = Math.max(...grid.flat().map((s) => s.h));
    return png(sheetImage(grid, kit, previewScale(cols * w, grid.length * h), "checker").image, `${a.name}-sheet`);
  }
  const f = a.rows[0].frames[0];
  return png(spriteImage(f, kit, previewScale(f.w, f.h), "checker"), a.name);
}

const idOf = (x: string | { id: string }) => (typeof x === "string" ? x : x.id);
function recipeSummary(r: RigRecipe) {
  return { rig: idOf(r.rig), ...(r.slots ? { slots: r.slots } : {}), attachments: (r.attachments ?? []).map(idOf), clips: r.clips.map(idOf) };
}

const absPaths = (files: ExportedFile[]) => files.map((f) => f.path);

function uniqueName(project: { assets: Asset[] }, category: Category, name: string, seed?: number): string {
  if (!project.assets.some((a) => a.category === category && a.name.toLowerCase() === name.toLowerCase())) return name;
  return `${name} ${seed !== undefined ? seed % 10000 : project.assets.length + 1}`;
}

function lintRows(frames: string[][], w: number, h: number, legend: Legend): string[] {
  const notes: string[] = [];
  let unknown = 0;
  const unknownChars = new Set<string>();
  frames.forEach((rows, f) => {
    if (rows.length !== h) notes.push(`frame ${f}: ${rows.length} rows, expected ${h} (missing rows are transparent, extra rows dropped)`);
    rows.forEach((row, y) => {
      const chars = Array.from(row);
      if (chars.length !== w && y < h) notes.push(`frame ${f} row ${y}: ${chars.length} chars, expected ${w} (padded/cropped)`);
      for (const c of chars) if (!legend.byChar.has(c)) { unknown++; unknownChars.add(c); }
    });
  });
  if (unknown) notes.push(`${unknown} pixel(s) used chars not in the legend (${[...unknownChars].slice(0, 8).map((c) => JSON.stringify(c)).join(" ")}); they became transparent`);
  return notes.length > 8 ? [...notes.slice(0, 8), `...and ${notes.length - 8} more`] : notes;
}

// ---------- style guide ----------

const SHADE_LEVELS: Record<number, number[]> = { 2: [1, 3], 3: [1, 2, 3], 4: [1, 2, 3, 4], 5: [0, 1, 2, 3, 4] };

function kitSummary(kit: StyleKit, active: boolean) {
  return {
    id: kit.id,
    name: kit.name,
    active,
    vibe: kit.vibe,
    palette: kit.paletteId,
    light: kit.lightDir,
    outline: kit.outline,
    shade_steps: kit.shadeSteps,
    dither: kit.dither,
    ambient: kit.ambient,
    sizes: kit.sizes,
  };
}

function paintingRules(kit: StyleKit): string[] {
  const levels = SHADE_LEVELS[Math.max(2, Math.min(5, Math.round(kit.shadeSteps)))];
  const rules = [
    "Paint with legend chars only. '.' is transparent. Every frame is exactly `height` rows of exactly `width` chars (no spaces, quotes or backslashes).",
    `Each material has 5 shades, level 0 (darkest) to 4 (lightest). This kit shades with levels ${levels.join(", ")} (shade_steps ${kit.shadeSteps}); stay inside them. Use the middle levels for base colour, the lowest on the side facing away from the light, the highest for small highlights.`,
    `Light comes from the ${kit.lightDir.replace("-", " ")}: lit edges and tops get lighter levels, the opposite sides darker. Keep this identical across every asset.`,
    kit.outline === "none"
      ? "This kit has no outline: paint silhouettes with enough contrast against the background to read."
      : `This kit uses a ${kit.outline} outline. paint_asset adds it automatically (outline=true), so do NOT paint the outline and leave a 1px transparent margin around the silhouette.`,
    kit.dither ? "Dithering is on for this kit: blend between two adjacent shades with a checkerboard, never a long gradient." : "Dithering is off for this kit: use flat bands of shade, no noise or checkerboards.",
    `Sizes for this kit: character ${kit.sizes.character}px, building ${kit.sizes.building}px, environment ${kit.sizes.environment}px, object ${kit.sizes.object}px, ui ${kit.sizes.ui}px, tile ${kit.sizes.tile}px. Match them so assets sit together; stand characters, buildings and props on the bottom edge, centred horizontally.`,
    "Keep silhouettes readable at 1x: chunky shapes, a few materials per sprite, no stray single pixels (cleanup=true removes them).",
    "Animation: all frames of an asset share one size and change only a few pixels between frames. For several animation rows pass row_names and give frames in row order (equal frames per row).",
    "Prefer generate_asset for characters, buildings, trees/tiles, props, UI and maps; hand-paint only what generators cannot make, look at the preview, then fix details with edit_asset.",
  ];
  return rules;
}

const getStyleGuide = defineTool({
  name: "get_style_guide",
  title: "Get style guide",
  description:
    "Get a kit's style guide. Read it before hand-painting: it has the kit summary (vibe, light, outline, shade steps, sizes), the palette legend (one char per palette colour, used in paint_asset / edit_asset rows) and the painting rules that keep hand-painted art on-kit.",
  shape: {
    kit_id: kitIdField,
    materials: z.array(z.enum(MATERIALS)).optional().describe("Only list these materials in the legend (default: all). Chars never change."),
  },
  readOnly: true,
  run(ws, i) {
    const project = ws.load();
    const kit = getKit(project, i.kit_id);
    const legend = buildLegend(kit, i.materials);
    const rules = paintingRules(kit);
    const summary = kitSummary(kit, kit.id === project.activeKitId);
    const text = [
      `# Style guide: ${kit.name} (${kit.id})`,
      `vibe: ${kit.vibe}`,
      `palette ${kit.paletteId} | light ${kit.lightDir} | outline ${kit.outline} | shade steps ${kit.shadeSteps} | dither ${kit.dither} | ambient ${kit.ambient}`,
      `sizes: ${Object.entries(kit.sizes).map(([k, v]) => `${k} ${v}`).join(", ")}`,
      "",
      "## Palette legend (level 0 = darkest, 4 = lightest)",
      legendText(legend),
      "",
      "## Painting rules",
      ...rules.map((r) => `- ${r}`),
    ].join("\n");
    return {
      data: { kit: summary, legend: legendText(legend), legend_entries: legend.entries.map((e) => ({ char: e.char, material: e.material, level: e.level, hex: e.hex })), rules },
      text,
    };
  },
});

// ---------- generators ----------

const listGenerators = defineTool({
  name: "list_generators",
  title: "List generators",
  description: "List procedural generators (character, building, environment, object, ui, map) with their parameter specs. Use the id with generate_asset.",
  shape: { category: categoryEnum.optional().describe("Only generators of this category.") },
  readOnly: true,
  run(_ws, i) {
    const list = GENERATORS.filter((g) => !i.category || g.category === i.category);
    return {
      data: {
        generators: list.map((g) => ({ id: g.id, category: g.category, label: g.label, description: g.description, params: g.params, defaults: defaults(g) })),
      },
    };
  },
});

function defaultName(g: Generator, params: Params): string {
  const sel = g.params.find((s) => s.type === "select");
  return sel ? String(params[sel.key]) : g.label.toLowerCase();
}

const generateAsset = defineTool({
  name: "generate_asset",
  title: "Generate asset",
  description:
    "Generate an asset with a procedural generator, using the kit's palette/light/outline so it matches everything else. Saves it to the workspace project and exports game-ready files (PNG; sheet JSON for animations; Tiled JSON for maps) unless save=false. Same generator + params + seed + kit always gives the same pixels.",
  shape: {
    generator: z.string().describe("Generator id (see list_generators), e.g. 'environment'."),
    params: paramsField,
    seed: z.number().int().min(0).max(4294967295).optional().describe("Seed for reproducible output. Default: random (returned in the result)."),
    kit_id: kitIdField,
    name: z.string().min(1).max(80).optional().describe("Asset name; also the exported file name."),
    save: z.boolean().default(true).describe("false = preview only: nothing is saved or exported."),
  },
  positional: "generator",
  run(ws, i) {
    const project = ws.load();
    const kit = getKit(project, i.kit_id);
    const g = resolveGenerator(i.generator);
    const { params, notes } = validateParams(g, i.params ?? {});
    const seed = i.seed ?? randomSeed();
    const res = g.generate(params, kit, seed);
    const asset = createAsset({
      name: uniqueName(project, g.category, i.name ?? defaultName(g, params), seed),
      category: g.category,
      kit,
      rows: res.rows,
      fps: res.fps,
      source: { kind: "procedural", generator: g.id, params, seed },
      tilemap: res.tilemap,
      meta: res.meta,
    });
    let files: string[] = [];
    if (i.save) {
      project.assets.push(asset);
      ws.save(project);
      files = absPaths(exportAsset(ws, project, asset));
    }
    return {
      data: { saved: i.save, asset: { ...summarize(ws, project, asset), files }, ...(notes.length ? { notes } : {}) },
      images: [previewOf(asset, kit)],
    };
  },
});

const generateVariations = defineTool({
  name: "generate_variations",
  title: "Generate variations",
  description:
    "Render 1-12 variations of a generator as one numbered contact-sheet image (left-to-right, top-to-bottom) so you can pick the best. Nothing is saved: re-run generate_asset with the chosen variation's seed and params.",
  shape: {
    generator: z.string().describe("Generator id (see list_generators)."),
    count: z.number().int().min(1).max(12).default(6),
    params: paramsField.describe("Params to pin. With vary='params' every other param is randomised per variation."),
    vary: z.enum(["seed", "params"]).default("seed").describe("'seed' = same params, different seeds; 'params' = randomise the params you did not pin."),
    kit_id: kitIdField,
  },
  positional: "generator",
  readOnly: true,
  run(ws, i) {
    const project = ws.load();
    const kit = getKit(project, i.kit_id);
    const g = resolveGenerator(i.generator);
    const { params: base, provided, notes } = validateParams(g, i.params ?? {});
    const first = randomSeed();
    const variations: { n: number; seed: number; params: Params }[] = [];
    const sprites: Sprite[] = [];
    for (let k = 0; k < i.count; k++) {
      const seed = (first + k) % 4294967296;
      const params: Params = i.vary === "params" ? { ...randomParams(g, rng(seed ^ 0x9e3779b9)), ...Object.fromEntries(provided.map((key) => [key, base[key]])) } : base;
      variations.push({ n: k + 1, seed, params });
      sprites.push(g.generate(params, kit, seed).rows[0].frames[0]);
    }
    const columns = i.count <= 4 ? i.count : i.count <= 6 ? 3 : 4;
    return {
      data: { generator: g.id, variations, note: "Numbered left-to-right, top-to-bottom. Not saved; keep one with generate_asset {generator, seed, params}.", ...(notes.length ? { notes } : {}) },
      images: [png(contactSheet(sprites, kit, { columns }), `${g.id}-variations`)],
    };
  },
});

// ---------- hand-painted assets ----------

const paintAsset = defineTool({
  name: "paint_asset",
  title: "Paint asset",
  description:
    "Create an asset from legend-char rows you paint yourself (read get_style_guide first). `frames` is one entry per frame, each an array of `height` strings of `width` chars. Runs the same finishing pass as generators (outline per the kit, orphan cleanup), saves and exports it. Maps are not paintable; use generate_asset for those.",
  shape: {
    name: z.string().min(1).max(80),
    category: categoryEnum,
    width: z.number().int().min(1).max(256),
    height: z.number().int().min(1).max(256),
    frames: z.array(z.array(z.string())).min(1).max(64).describe("string[][]: one inner array of legend rows per frame."),
    row_names: z.array(z.string().min(1).max(40)).optional().describe("Animation row names (e.g. ['walk-down','walk-up']). Frames are split evenly across them in order. Default: one row 'idle'."),
    fps: z.number().min(1).max(60).optional(),
    outline: z.boolean().default(true).describe("Add the kit's outline around the silhouette (leave a 1px transparent margin)."),
    cleanup: z.boolean().default(true).describe("Remove stray single pixels."),
    kit_id: kitIdField,
  },
  run(ws, i) {
    if (i.category === "map") throw new ToolError("paint_asset cannot create maps (they are tile grids). Use generate_asset with generator 'map'.");
    const project = ws.load();
    const kit = getKit(project, i.kit_id);
    const legend = buildLegend(kit);
    const names = i.row_names?.length ? i.row_names : ["idle"];
    if (i.frames.length % names.length !== 0)
      throw new ToolError(`${i.frames.length} frame(s) cannot be split evenly across ${names.length} row_names (${names.join(", ")}); give a multiple of ${names.length} frames.`);
    const per = i.frames.length / names.length;
    const sprites = i.frames.map((rows) => finalize(decodeRows(rows, i.width, i.height, legend), kit, { outline: i.outline, cleanup: i.cleanup }));
    const empty = sprites.findIndex((s) => !s.data.some((v) => v > 0));
    if (empty >= 0) throw new ToolError(`Frame ${empty} has no painted pixels. Use legend chars (see get_style_guide); '.' is transparent.`);
    const notes = lintRows(i.frames, i.width, i.height, legend);
    const asset = createAsset({
      name: i.name,
      category: i.category,
      kit,
      rows: names.map((name, r) => ({ name, frames: sprites.slice(r * per, (r + 1) * per) })),
      fps: i.fps ?? (sprites.length > 1 ? 6 : 1),
      source: { kind: "ai-pixels" },
      meta: i.outline ? undefined : { outline: false },
    });
    project.assets.push(asset);
    ws.save(project);
    const files = absPaths(exportAsset(ws, project, asset));
    return { data: { asset: { ...summarize(ws, project, asset), files }, ...(notes.length ? { notes } : {}) }, images: [previewOf(asset, kit)] };
  },
});

const editAsset = defineTool({
  name: "edit_asset",
  title: "Edit asset",
  description:
    "Edit one frame of a saved asset: set individual `pixels` [{x,y,char}] and/or replace the whole frame with legend `rows`; also rename or retag. Writes exactly what you give it (outline pixels included, as shown by get_asset include_pixels), only dropping invalid values. Re-exports the files. Not for maps.",
  shape: {
    id: z.string().describe("Asset id (or exact name)."),
    row: z.union([z.string(), z.number().int().min(0)]).optional().describe("Animation row name or index. Default 0."),
    frame: z.number().int().min(0).default(0).describe("Frame index within the row."),
    pixels: z.array(z.object({ x: z.number().int(), y: z.number().int(), char: z.string().length(1) })).max(8192).optional().describe("Single pixels to set; char is a legend char ('.' erases)."),
    rows: z.array(z.string()).optional().describe("Replace the whole frame with these legend rows."),
    name: z.string().min(1).max(80).optional(),
    tags: z.array(z.string().max(40)).max(32).optional(),
  },
  positional: "id",
  run(ws, i) {
    const project = ws.load();
    const asset = findAsset(project, i.id);
    const kit = kitOf(project, asset);
    const legend = buildLegend(kit);
    const notes: string[] = [];
    if (asset.tilemap) throw new ToolError(`'${asset.name}' is a map (a tile grid); edit_asset only edits sprites. Regenerate it with generate_asset or use rerender_assets.`);
    const wantsPixels = i.pixels?.length || i.rows;
    if (wantsPixels) {
      let ri = 0;
      if (typeof i.row === "string") {
        const byName = asset.rows.findIndex((r) => r.name === i.row);
        ri = byName >= 0 ? byName : /^\d+$/.test(i.row) ? Number(i.row) : -1;
      } else if (typeof i.row === "number") ri = i.row;
      const row = asset.rows[ri];
      if (!row) throw new ToolError(`No row ${JSON.stringify(i.row)} in '${asset.name}'. Rows: ${asset.rows.map((r, k) => `${k}=${r.name}`).join(", ")}.`);
      const frame = row.frames[i.frame];
      if (!frame) throw new ToolError(`Row '${row.name}' has ${row.frames.length} frame(s); frame ${i.frame} does not exist.`);
      let sprite: Sprite = { w: frame.w, h: frame.h, data: frame.data.slice() };
      if (i.rows) {
        notes.push(...lintRows([i.rows], frame.w, frame.h, legend));
        sprite = decodeRows(i.rows, frame.w, frame.h, legend);
      }
      const bad: string[] = [];
      for (const p of i.pixels ?? []) {
        if (p.x < 0 || p.y < 0 || p.x >= frame.w || p.y >= frame.h) bad.push(`(${p.x},${p.y}) is outside ${frame.w}x${frame.h}`);
        else if (!legend.byChar.has(p.char)) bad.push(`'${p.char}' at (${p.x},${p.y}) is not a legend char`);
        else sprite.data[p.y * frame.w + p.x] = legend.byChar.get(p.char)!;
      }
      if (bad.length) throw new ToolError(`Nothing changed. ${bad.slice(0, 5).join("; ")}${bad.length > 5 ? `; ...${bad.length - 5} more` : ""}. See get_style_guide for the legend.`);
      row.frames[i.frame] = finalize(sprite, kit, { outline: false, cleanup: false });
    }
    if (i.name !== undefined) asset.name = i.name;
    if (i.tags) asset.tags = [...new Set(i.tags)];
    if (!wantsPixels && i.name === undefined && !i.tags) throw new ToolError("Nothing to do: give pixels, rows, name or tags.");
    asset.updatedAt = Date.now();
    ws.save(project);
    exportAsset(ws, project, asset);
    return { data: { asset: summarize(ws, project, asset), ...(notes.length ? { notes } : {}) }, images: [previewOf(asset, kit)] };
  },
});

/** Resolve a row by name or index, with the same errors every editing tool uses. */
function resolveRowIndex(asset: Asset, row: string | number | undefined): number {
  if (row === undefined) return 0;
  let ri = 0;
  if (typeof row === "string") {
    const byName = asset.rows.findIndex((r) => r.name === row);
    ri = byName >= 0 ? byName : /^\d+$/.test(row) ? Number(row) : -1;
  } else ri = row;
  if (ri < 0 || ri >= asset.rows.length)
    throw new ToolError(`No row ${JSON.stringify(row)} in '${asset.name}'. Rows: ${asset.rows.map((r, k) => `${k}=${r.name}`).join(", ")}.`);
  return ri;
}

// ---------- region edit (inpaint, issue #18) ----------

/**
 * Ask the model for the region's replacement pixels. The node layer has no API
 * key of its own, so it goes through the local API server (the same one the web
 * editor uses); when that server has no key the caller gets the rows it already
 * has. Returns legend rows sized to the region's bounding box.
 */
async function modelRegionRows(a: { prompt: string; frame: Sprite; box: MaskRect; kit: StyleKit; legend: Legend }): Promise<string[]> {
  const url = process.env.PIXEL_API_URL ?? "http://127.0.0.1:8787";
  let res: Response;
  try {
    res = await fetch(`${url}/api/inpaint`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: a.prompt,
        kit: a.kit,
        // the model sees the whole sprite as legend rows for context; only the
        // region's rect is asked back (the server crops the answer to it)
        sprite: { w: a.frame.w, h: a.frame.h, data: a.frame.data },
        mask: a.box,
      }),
      signal: AbortSignal.timeout(240_000),
    });
  } catch (e) {
    throw new ToolError(
      `Prompt mode needs the pixel-builder API server running (${url}) with ANTHROPIC_API_KEY set. ` +
        `Give rows instead to paint the region yourself with no API key. (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  const data = (await res.json().catch(() => null)) as { rows?: unknown; error?: unknown; frames?: unknown } | null;
  if (!res.ok) throw new ToolError(typeof data?.error === "string" ? data.error : `The API server returned ${res.status}. Give rows instead to paint the region yourself.`);
  const rows = data?.rows;
  if (!Array.isArray(rows)) throw new ToolError("The API server returned no rows for the region. Give rows instead to paint the region yourself.");
  return rows.filter((r): r is string => typeof r === "string");
}

/**
 * Turn an inpaint into a rig attachment (issue #18 "prefer the rig attachment
 * path when rigged"): the painted rows become a `pixels` part pinned to the
 * joint nearest the region, so every clip x direction re-renders with the edit
 * instead of baking one raster frame. Returns null when the rig has no joints.
 */
function rigAttachmentForEdit(region: MaskRect, rows: string[], kit: StyleKit, rig: RigDef, id: string): Attachment | null {
  const joints = solvePose(rig, "down");
  const ids = Object.keys(joints);
  if (!ids.length) return null;
  const size = kit.sizes.character;
  const k = size / rig.grid;
  const cx = (region.x + region.w / 2) * k;
  const cy = (region.y + region.h / 2) * k;
  let best = ids[0];
  let bestD = Infinity;
  for (const jid of ids) {
    const d = (joints[jid][0] * k - cx) ** 2 + (joints[jid][1] * k - cy) ** 2;
    if (d < bestD) {
      bestD = d;
      best = jid;
    }
  }
  // `anchor` is in grid units and is measured back from the joint's pixel
  // position, so the painted block lands back on the cells it was taken from.
  return {
    id,
    name: id,
    parts: [{ id, kind: "pixels", joint: best, anchor: [region.x - joints[best][0] + (k - region.w) / 2, region.y - joints[best][1]], z: 90, rows }],
  };
}

const editRegion = defineTool({
  name: "edit_region",
  title: "Edit a region (inpaint)",
  description:
    "AI region edit on a saved sprite: change part of a frame from plain words (prompt, e.g. 'add a red scarf') while every pixel outside the region stays byte-identical. Pass `rows` instead of `prompt` to paint the region yourself (works with no API key). On a rigged asset the edit is applied through the rig so every clip and direction follows; `all_frames` applies it to every frame of the row otherwise. Pixels outside the region never change.",
  shape: {
    id: z.string().describe("Asset id (or exact name)."),
    row: z.union([z.string(), z.number().int().min(0)]).optional().describe("Animation row name or index. Default 0."),
    frame: z.number().int().min(0).default(0).describe("Frame index within the row."),
    rect: z.object({ x: z.number(), y: z.number(), w: z.number().min(1), h: z.number().min(1) }).optional().describe("Rectangular region in pixels: {x,y,w,h}."),
    mask: z.array(z.array(z.boolean())).optional().describe("Lasso region as a 2D boolean grid (one row per pixel row)."),
    prompt: z.string().min(1).max(1000).optional().describe("What to change in the region. Needs ANTHROPIC_API_KEY."),
    rows: z.array(z.string()).optional().describe("Your own replacement legend rows for the region, sized to the region's bounding box."),
    all_frames: z.boolean().default(false).describe("Apply the same edit to every frame of the row."),
    attachment_name: z.string().min(1).max(80).optional().describe("On a rigged asset, name the attachment this edit is stored as (so attach can remove it)."),
  },
  positional: "id",
  async run(ws, i) {
    const project = ws.load();
    const asset = findAsset(project, i.id);
    if (asset.tilemap) throw new ToolError(`'${asset.name}' is a map (a tile grid); edit_region only edits sprites.`);
    if (!i.rect && !i.mask) throw new ToolError("Give rect {x,y,w,h} or mask (a 2D boolean grid) to select the region.");
    if (!i.prompt && !i.rows) throw new ToolError("Give a prompt (needs ANTHROPIC_API_KEY) or rows to paint the region yourself.");
    const kit = kitOf(project, asset);
    const legend = buildLegend(kit);

    const ri = resolveRowIndex(asset, i.row);
    const row = asset.rows[ri];
    const frames = row.frames.map((f) => ({ ...f, data: f.data.slice() }));
    const fi = Math.min(i.frame, frames.length - 1);
    const frame = frames[fi];
    if (!frame) throw new ToolError(`Row '${row.name}' has no frames.`);

    const region: Region = i.mask ? toMaskGrid(frame.w, frame.h, i.mask) : (i.rect as MaskRect);
    const box = maskBounds(toMaskGrid(frame.w, frame.h, region));
    if (!box) throw new ToolError(`The region covers none of the ${frame.w}x${frame.h} pixels. Check rect / mask bounds.`);
    const notes: string[] = [];

    // One painted result for the region: the agent's own rows, or the model's.
    const painted = i.rows ?? (await modelRegionRows({ prompt: i.prompt!, frame, box, kit, legend }));
    if (i.rows) notes.push(...lintRows([i.rows], box.w, box.h, legend));
    const bad = offLegendChars(painted, legend);
    if (bad.length) notes.push(`${bad.length} char(s) not in the legend (${bad.map((c) => JSON.stringify(c)).slice(0, 6).join(" ")}); those pixels became transparent`);
    if (!painted.some((r) => Array.from(r).some((c) => c !== ".")))
      throw new ToolError(i.prompt ? "The model returned an empty region (all transparent). Try a more specific prompt." : "The rows you gave are all transparent; nothing to draw.");

    const regionOut = { x: box.x, y: box.y, w: box.w, h: box.h };
    const recipe = asset.source.rig;

    // Rigged assets prefer the attachment path: all clips and directions change.
    if (recipe) {
      const lib = resolveRig(project, recipe.rig);
      const attachment = rigAttachmentForEdit(box, painted, kit, lib.rig, i.attachment_name ?? "ai-region-edit");
      if (attachment) {
        const next: RigRecipe = { ...recipe, attachments: [...(recipe.attachments ?? []), attachment] };
        const res = renderRecipe(project, kit, next);
        asset.source = { ...asset.source, rig: next };
        asset.rows = res.rows;
        asset.updatedAt = Date.now();
        ws.save(project);
        return {
          data: {
            asset: { ...summarize(ws, project, asset), files: absPaths(exportAsset(ws, project, asset)) },
            region: regionOut,
            via: "rig-attachment",
            attachment: attachment.id,
            ...(notes.length ? { notes } : {}),
          },
          images: [previewOf(asset, kit)],
        };
      }
    }

    // Otherwise bake: only the masked cells change; the rest is byte-identical.
    const targets = i.all_frames ? frames.map((_, k) => k) : [fi];
    for (const k of targets) {
      const f = frames[k];
      const mask = toMaskGrid(f.w, f.h, region);
      frames[k] = inpaintFrame(f, cropRowsToSprite(painted, box, f.w, f.h, legend), mask, kit);
    }
    asset.rows[ri] = { ...row, frames };
    asset.updatedAt = Date.now();
    ws.save(project);
    return {
      data: {
        asset: { ...summarize(ws, project, asset), files: absPaths(exportAsset(ws, project, asset)) },
        region: regionOut,
        via: "baked",
        frames_edited: targets.length,
        ...(notes.length ? { notes } : {}),
      },
      images: [previewOf(asset, kit)],
    };
  },
});

// ---------- library ----------

const listAssets = defineTool({
  name: "list_assets",
  title: "List assets",
  description: "List saved assets (newest first) with sizes, rows, source and exported file paths. Filter by category and/or a text query over name, tags and id.",
  shape: { category: categoryEnum.optional(), query: z.string().optional().describe("Case-insensitive match on name, tags or id.") },
  readOnly: true,
  run(ws, i) {
    const project = ws.load();
    const q = i.query?.toLowerCase();
    const list = project.assets
      .filter((a) => (!i.category || a.category === i.category) && (!q || a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q) || a.tags.some((t) => t.toLowerCase().includes(q))))
      .sort((a, b) => b.createdAt - a.createdAt);
    return { data: { count: list.length, workspace: ws.dir, assets: list.map((a) => summarize(ws, project, a)) } };
  },
});

const getAsset = defineTool({
  name: "get_asset",
  title: "Get asset",
  description: "Show one asset: summary, a preview image, and (include_pixels=true) its pixels as legend rows per animation row/frame so you can read and edit them.",
  shape: { id: z.string().describe("Asset id (or exact name)."), include_pixels: z.boolean().default(false) },
  positional: "id",
  readOnly: true,
  run(ws, i) {
    const project = ws.load();
    const asset = findAsset(project, i.id);
    const kit = kitOf(project, asset);
    const data: Record<string, unknown> = { asset: summarize(ws, project, asset) };
    if (i.include_pixels) {
      const used = [...new Set(asset.rows.flatMap((r) => r.frames.flatMap((f) => materialsUsed(f))))];
      const legend = buildLegend(kit, used);
      data.legend = legendText(legend);
      data.pixels = asset.rows.map((r) => ({ row: r.name, frames: r.frames.map((f) => encodeSprite(f, legend)) }));
      if (asset.tilemap) data.note = "For maps these pixels are the rendered preview; the tile grid itself is exported as .tiled.json.";
    }
    return { data, images: [previewOf(asset, kit)] };
  },
});

const deleteAsset = defineTool({
  name: "delete_asset",
  title: "Delete asset",
  description: "Delete an asset from the project and remove its exported files.",
  shape: { id: z.string().describe("Asset id (or exact name).") },
  positional: "id",
  destructive: true,
  run(ws, i) {
    const project = ws.load();
    const asset = findAsset(project, i.id);
    const removed = removeAssetFiles(ws, project, asset);
    project.assets = project.assets.filter((a) => a.id !== asset.id);
    ws.save(project);
    return { data: { ok: true, deleted: { id: asset.id, name: asset.name }, removed_files: removed } };
  },
});

const exportAssetTool = defineTool({
  name: "export_asset",
  title: "Export asset",
  description:
    "Write game-ready files for an asset. 'png' = image (animated assets become a spritesheet + .json metadata; maps also get .tiled.json + tilesets); 'spritesheet' = always sheet + .json; 'tiled' = map only; 'svg' = layered vector (a layer per material, per part for rigged assets, plus a locked 'guides' layer with pixel/tile grid, ground line, frame labels, joints) that opens in Inkscape/Figma and comes back with import_svg; 'aseprite' = native .aseprite binary for Aseprite (indexed pixels locked to the kit palette, one layer per rig part, one tag per animation row, frame duration from fps). Autotile assets (generator 'tileset') also export 'tiled-tileset' (.tsj with a wangset), 'godot' (.tres TileSet with terrain + peering bits), 'unity' (PNG + .rules.json slice rects and neighbour rules) and 'atlas' (PNG + .atlas.json index); each writes <slug>.png beside it. Default folder: <workspace>/<category>s/ (characters/, buildings/, environments/, objects/, maps/ - and ui/ for UI assets, not uis/).",
  shape: {
    id: z.string().describe("Asset id (or exact name)."),
    format: z.enum(["png", "spritesheet", "tiled", "svg", "aseprite", "tiled-tileset", "godot", "unity", "atlas"]).default("png"),
    scale: z.number().int().min(1).max(16).default(1).describe("Integer upscale of the PNG (nearest neighbour); ignored for svg, applied to .aseprite cels."),
    out_dir: z.string().optional().describe("Output folder (relative to the current directory). Default: <workspace>/<category>s/ (ui/ for UI assets)."),
  },
  positional: "id",
  run(ws, i) {
    const project = ws.load();
    const asset = findAsset(project, i.id);
    const layered = i.format === "svg" || i.format === "aseprite";
    const files = exportAsset(ws, project, asset, { format: i.format, scale: i.scale, outDir: i.out_dir, rig: layered ? rigInfoOf(project, asset) : undefined });
    return { data: { asset: { id: asset.id, name: asset.name }, files } };
  },
});

/**
 * Every re-export of an asset's PNG also refreshes its editable .svg when one already
 * exists, so the vector never goes stale (rerender, attach, edit, import replace, ...).
 */
function exportAsset(ws: Workspace, project: ProjectFile, asset: Asset, opts: ExportOptions = {}): ExportedFile[] {
  const files = exportAssetRaw(ws, project, asset, opts);
  if ((opts.format ?? "png") !== "svg" && svgExists(ws, project, asset, opts.outDir))
    files.push(...exportAssetRaw(ws, project, asset, { format: "svg", outDir: opts.outDir, rig: rigInfoOf(project, asset) }));
  return files;
}

/** Part ownership for a rigged asset's SVG layers (undefined for everything else, or if the recipe no longer resolves). */
function rigInfoOf(project: ProjectFile, asset: Asset) {
  const recipe = asset.source.kind === "rigged" ? asset.source.rig : undefined;
  if (!recipe) return undefined;
  try {
    const kit = kitOf(project, asset);
    const res = renderRecipe(project, kit, recipe);
    if (res.rows.length !== asset.rows.length) return undefined;
    return rigSvgInfo({ rig: res.lib.rig, slots: recipe.slots, attachments: res.attachments, clips: res.clips, kit });
  } catch {
    return undefined;
  }
}

// ---------- import ----------

function removeBackground(img: RgbaImage, tolerance = 28): RgbaImage {
  const { width: w, height: h } = img;
  const out = new Uint8Array(img.rgba);
  const bg = [out[0], out[1], out[2]];
  const near = (i: number) => Math.hypot(out[i] - bg[0], out[i + 1] - bg[1], out[i + 2] - bg[2]) <= tolerance && out[i + 3] > 0;
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < w && y < h && near((y * w + x) * 4)) {
      out[(y * w + x) * 4 + 3] = 0;
      stack.push(x, y);
    }
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const y = stack.pop()!, x = stack.pop()!;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }
  return { width: w, height: h, rgba: out };
}

function cropToContent(img: RgbaImage): RgbaImage {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (img.rgba[(y * img.width + x) * 4 + 3] >= 128) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
  if (x1 < 0) return img;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) out.set(img.rgba.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x0 + w) * 4), y * w * 4);
  return { width: w, height: h, rgba: out };
}

const importImage = defineTool({
  name: "import_image",
  title: "Import image",
  description:
    "Import a PNG (e.g. AI-generated art or a mock-up) as an asset: optionally remove its background and crop to content, fit it into width x height, then snap every pixel to the kit palette so it matches the rest. Saves and exports it.",
  shape: {
    path: z.string().describe("Path to a PNG file (relative to the current directory)."),
    width: z.number().int().min(1).max(256).describe("Target width in pixels."),
    height: z.number().int().min(1).max(256).describe("Target height in pixels."),
    category: categoryEnum,
    name: z.string().min(1).max(80).optional().describe("Default: the file name."),
    remove_background: z.boolean().default(false).describe("Make the background (flood-filled from the image border, colour of the top-left pixel) transparent."),
    crop: z.boolean().default(false).describe("Crop to the non-transparent content before fitting."),
    outline: z.boolean().default(true).describe("Add the kit's outline (set false if the image already has one). Reserves a 1px margin."),
    kit_id: kitIdField,
  },
  positional: "path",
  run(ws, i) {
    const file = resolve(i.path);
    let buf: Buffer;
    try {
      buf = readFileSync(file);
    } catch (e) {
      throw new ToolError(`Cannot read '${file}': ${(e as Error).message}`);
    }
    let img: RgbaImage;
    try {
      img = decodePng(buf);
    } catch (e) {
      throw new ToolError(`'${file}': ${(e as Error).message}`);
    }
    const notes: string[] = [];
    if (i.remove_background) img = removeBackground(img);
    else if (!img.rgba.some((_, k) => k % 4 === 3 && img.rgba[k] < 128)) notes.push("image is fully opaque; pass remove_background=true to cut out a flat background");
    if (i.crop) img = cropToContent(img);

    const project = ws.load();
    const kit = getKit(project, i.kit_id);
    const m = i.outline ? 1 : 0;
    const bw = Math.max(1, i.width - 2 * m), bh = Math.max(1, i.height - 2 * m);
    const k = Math.min(bw / img.width, bh / img.height);
    const iw = Math.max(1, Math.round(img.width * k)), ih = Math.max(1, Math.round(img.height * k));
    const fitted = iw === img.width && ih === img.height ? img.rgba : downscaleRGBA(new Uint8ClampedArray(img.rgba.buffer, img.rgba.byteOffset, img.rgba.length), img.width, img.height, iw, ih);
    const canvas = new Uint8ClampedArray(i.width * i.height * 4);
    const ox = Math.floor((i.width - iw) / 2);
    const oy = i.category === "ui" ? Math.floor((i.height - ih) / 2) : i.height - ih - m;
    for (let y = 0; y < ih; y++) canvas.set(fitted.subarray(y * iw * 4, (y + 1) * iw * 4), ((oy + y) * i.width + ox) * 4);
    const sprite = finalize(quantizeRGBA(canvas, i.width, i.height, kit), kit, { outline: i.outline, cleanup: true });
    if (!sprite.data.some((v) => v > 0)) throw new ToolError("The imported image ended up empty (fully transparent). Check remove_background / the source image.");
    const stem = file.split(/[\\/]/).pop()!.replace(/\.png$/i, "");
    const asset = createAsset({
      name: i.name ?? stem,
      category: i.category,
      kit,
      rows: [{ name: "idle", frames: [sprite] }],
      fps: 1,
      source: { kind: "import" },
      meta: i.outline ? undefined : { outline: false },
    });
    project.assets.push(asset);
    ws.save(project);
    const files = absPaths(exportAsset(ws, project, asset));
    return { data: { asset: { ...summarize(ws, project, asset), files }, ...(notes.length ? { notes } : {}) }, images: [previewOf(asset, kit)] };
  },
});

const importSvg = defineTool({
  name: "import_svg",
  title: "Import SVG",
  description:
    "Import a layered SVG (from export_asset format 'svg', edited in Inkscape/Figma/by an AI, or any pixel-rect SVG) as an asset, or with replace_id replace an existing asset's frames (name/category kept, source becomes 'manual'). Edit by layer: keep data-material/data-level on rects, or use kit palette colours (a changed fill wins and is snapped to the nearest kit colour). The 'guides' layer and hidden layers are ignored. Saves and exports it.",
  shape: {
    path: z.string().describe("Path to an .svg file (relative to the current directory)."),
    name: z.string().min(1).max(80).optional().describe("Default: the name stored in the SVG, else the file name."),
    category: categoryEnum.optional().describe("Default: the category stored in the SVG, else 'object'."),
    replace_id: z.string().optional().describe("Replace the frames of this existing asset (id or name) instead of creating one."),
    kit_id: kitIdField,
  },
  positional: "path",
  run(ws, i) {
    const file = resolve(i.path);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (e) {
      throw new ToolError(`Cannot read '${file}': ${(e as Error).message}`);
    }
    const project = ws.load();
    const existing = i.replace_id ? findAsset(project, i.replace_id) : undefined;
    const kit = existing ? kitOf(project, existing) : getKit(project, i.kit_id);
    let parsed;
    try {
      parsed = svgToSprites(text, kit);
    } catch (e) {
      throw new ToolError(`'${file}': ${(e as Error).message}`);
    }
    const notes = [...parsed.notes];
    if (!parsed.rows.some((r) => r.frames.some((s) => s.data.some((v) => v > 0)))) throw new ToolError("The SVG produced only transparent frames. Check that the pixel rects are visible and outside the 'guides' layer.");
    let asset: Asset;
    if (existing) {
      existing.rows = parsed.rows;
      existing.source = { kind: "manual" };
      if (existing.tilemap) { existing.tilemap = undefined; notes.push("tilemap data dropped: the map is now plain pixels"); }
      existing.updatedAt = Date.now();
      asset = existing;
    } else {
      const stem = file.split(/[\\/]/).pop()!.replace(/\.svg$/i, "");
      asset = createAsset({
        name: i.name ?? parsed.name ?? stem,
        category: i.category ?? parsed.category ?? "object",
        kit,
        rows: parsed.rows,
        fps: parsed.fps ?? 6,
        source: { kind: "import" },
      });
      project.assets.push(asset);
    }
    ws.save(project);
    const files = absPaths(exportAsset(ws, project, asset));
    return { data: { asset: { ...summarize(ws, project, asset), files }, ...(notes.length ? { notes } : {}) }, images: [previewOf(asset, kit)] };
  },
});

// ---------- kits ----------

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "must be a #rrggbb hex colour");
const size = z.number().int().min(4).max(256);
const kitChanges = z
  .object({
    name: z.string().min(1).max(60),
    paletteId: z.enum(PALETTES.map((p) => p.id) as [string, ...string[]]).describe(`One of: ${PALETTES.map((p) => p.id).join(", ")}`),
    rampOverrides: z.partialRecord(z.enum(MATERIALS), z.array(hex).length(RAMP_LEN)).describe(`Per-material colour ramp, ${RAMP_LEN} hexes dark -> light, e.g. {"cloth":["#101030","#202060","#3050a0","#5080d0","#90c0f0"]}.`),
    outline: z.enum(["none", "black", "colored", "selective"]),
    lightDir: z.enum(["top-left", "top", "top-right"]),
    shadeSteps: z.number().int().min(2).max(5).describe("Shades used per material (2 = flat/chunky, 5 = smooth)."),
    dither: z.boolean(),
    ambient: z.number().min(0).max(1),
    sizes: z.object({ character: size, building: size, environment: size, object: size, ui: size, tile: size }).partial().strict(),
    vibe: z.string().max(500).describe("Free-text art direction."),
  })
  .partial()
  .strict();

type KitChanges = z.output<typeof kitChanges>;

function applyChanges(kit: StyleKit, c: KitChanges): StyleKit {
  const { sizes, rampOverrides, ...rest } = c;
  return { ...kit, ...rest, sizes: { ...kit.sizes, ...sizes }, rampOverrides: { ...kit.rampOverrides, ...rampOverrides } };
}

const listKits = defineTool({
  name: "list_kits",
  title: "List kits",
  description: "List style kits (id, name, active) with their key style settings.",
  shape: {},
  readOnly: true,
  run(ws) {
    const project = ws.load();
    return { data: { active: project.activeKitId, kits: project.kits.map((k) => kitSummary(k, k.id === project.activeKitId)) } };
  },
});

const createKit = defineTool({
  name: "create_kit",
  title: "Create kit",
  description: "Create a style kit by copying base_kit_id (default: the active kit) and applying `changes` (a partial StyleKit: paletteId, rampOverrides, outline, lightDir, shadeSteps, dither, ambient, sizes, vibe). It is not activated; use set_active_kit.",
  shape: { name: z.string().min(1).max(60), base_kit_id: z.string().optional(), changes: kitChanges.optional() },
  positional: "name",
  run(ws, i) {
    const project = ws.load();
    const base = getKit(project, i.base_kit_id);
    const kit = { ...applyChanges(base, i.changes ?? {}), id: newId("kit"), name: i.name };
    project.kits.push(kit);
    ws.save(project);
    return { data: { kit, note: `Created from '${base.id}'. Use set_active_kit to make it the default, or pass kit_id to tools.` } };
  },
});

const updateKit = defineTool({
  name: "update_kit",
  title: "Update kit",
  description: "Change a kit in place (partial StyleKit; sizes and rampOverrides merge). Palette/ramp changes recolour existing assets automatically (sprites store palette indices); shape-affecting changes (outline, light, shadeSteps, sizes) need rerender_assets for procedural assets.",
  shape: { kit_id: z.string(), changes: kitChanges },
  positional: "kit_id",
  run(ws, i) {
    const project = ws.load();
    const kit = getKit(project, i.kit_id);
    const next = { ...applyChanges(kit, i.changes), id: kit.id };
    project.kits = project.kits.map((k) => (k.id === kit.id ? next : k));
    ws.save(project);
    const used = project.assets.filter((a) => a.kitId === kit.id);
    const procedural = used.filter((a) => a.source.kind === "procedural" || a.source.kind === "rigged").length;
    const reshape = ["outline", "lightDir", "shadeSteps", "dither", "ambient", "sizes"].some((k) => k in i.changes);
    return {
      data: {
        kit: next,
        note: used.length
          ? `${used.length} asset(s) use this kit.` + (reshape && procedural ? ` Run rerender_assets to regenerate the ${procedural} procedural one(s) with the new settings.` : " Colour changes already apply to exports on the next export_asset / rerender_assets.")
          : "No assets use this kit yet.",
      },
    };
  },
});

const setActiveKit = defineTool({
  name: "set_active_kit",
  title: "Set active kit",
  description: "Make a kit the default for tools that take kit_id.",
  shape: { kit_id: z.string() },
  positional: "kit_id",
  run(ws, i) {
    const project = ws.load();
    const kit = getKit(project, i.kit_id);
    project.activeKitId = kit.id;
    ws.save(project);
    return { data: { kit: kitSummary(kit, true) } };
  },
});

const rerenderAssets = defineTool({
  name: "rerender_assets",
  title: "Rerender assets",
  description:
    "Re-run the generator (or rig recipe, for rigged assets) of procedural/rigged assets with the current kit settings (after update_kit) so everything stays consistent, and re-export their files. Default: all procedural assets, each with its own kit; pass kit_id to move them to another kit. Hand-painted/imported assets are skipped.",
  shape: { ids: z.array(z.string()).optional().describe("Asset ids or names. Default: every procedural asset."), kit_id: kitIdField.describe("Re-render with this kit and move the assets to it. Default: each asset's own kit.") },
  run(ws, i) {
    const project = ws.load();
    const targets = i.ids ? i.ids.map((id) => findAsset(project, id)) : project.assets.filter((a) => a.source.kind === "procedural" || a.source.kind === "rigged");
    const forced = i.kit_id ? getKit(project, i.kit_id) : undefined;
    const done: AssetSummary[] = [];
    const skipped: { id: string; name: string; reason: string }[] = [];
    const sprites: Sprite[] = [];
    let kitForSheet: StyleKit | undefined;
    for (const a of targets) {
      if (a.source.kind === "rigged" && a.source.rig) {
        const kit = forced ?? kitOf(project, a);
        const res = renderRecipe(project, kit, a.source.rig);
        a.rows = res.rows;
        a.fps = res.fps;
        a.kitId = kit.id;
        a.updatedAt = Date.now();
        ws.save(project);
        exportAsset(ws, project, a);
        done.push(summarize(ws, project, a));
        if (sprites.length < 12) { sprites.push(a.rows[0].frames[0]); kitForSheet ??= kit; }
        continue;
      }
      const g = a.source.kind === "procedural" && a.source.generator ? generatorById(a.source.generator) : undefined;
      if (!g) {
        skipped.push({ id: a.id, name: a.name, reason: a.source.kind === "procedural" ? `generator '${a.source.generator}' no longer exists` : `${a.source.kind} asset: not procedural, re-paint it with paint_asset/edit_asset` });
        continue;
      }
      const kit = forced ?? kitOf(project, a);
      const res = g.generate(coerceParams(g, (a.source.params ?? {}) as Record<string, unknown>), kit, a.source.seed ?? 1);
      a.rows = res.rows;
      a.fps = res.fps;
      a.tilemap = res.tilemap;
      if (res.meta) a.meta = { ...a.meta, ...res.meta };
      a.kitId = kit.id;
      a.updatedAt = Date.now();
      ws.save(project); // keep progress if a later generator throws
      exportAsset(ws, project, a);
      done.push(summarize(ws, project, a));
      if (sprites.length < 12) { sprites.push(a.rows[0].frames[0]); kitForSheet ??= kit; }
    }
    return {
      data: { rerendered: done.length, assets: done, skipped },
      images: sprites.length ? [png(contactSheet(sprites, kitForSheet!, { columns: Math.min(4, sprites.length) }), "rerendered")] : undefined,
    };
  },
});


// ---------- rigs ----------

type Lib = { rig: RigDef; family: string; builtin: boolean };

function allRigs(project: ProjectFile): Lib[] {
  return [...RIGS.map((r) => ({ ...r, builtin: true })), ...(project.rigs ?? []).map((rig) => ({ rig, family: "custom", builtin: false }))];
}
const allClips = (project: ProjectFile) => [...CLIPS.map((c) => ({ ...c, builtin: true })), ...(project.clips ?? []).map((clip) => ({ clip, family: "custom", builtin: false }))];
const allAttachments = (project: ProjectFile) => [...ATTACHMENTS.map((a) => ({ ...a, builtin: true })), ...(project.attachments ?? []).map((attachment) => ({ attachment, family: "custom", builtin: false }))];

function notFound(kind: string, id: string, ids: string[], tool: string): never {
  const near = nearest(id, ids, 2).map((n) => `'${n}'`);
  throw new ToolError(`Unknown ${kind} '${id}'.` + (near.length ? ` Did you mean ${near.join(" or ")}?` : "") + ` Available: ${ids.join(", ") || "(none)"} (see ${tool}).`);
}

/** Registry first, then the project's own rigs. A recipe may also embed the definition. */
function resolveRig(project: ProjectFile, r: string | RigDef): Lib {
  if (typeof r !== "string") return { rig: r, family: "custom", builtin: false };
  const hit = allRigs(project).find((x) => x.rig.id === r);
  return hit ?? notFound("rig", r, allRigs(project).map((x) => x.rig.id), "list_rigs");
}
function resolveClip(project: ProjectFile, c: string | Clip, rig: Lib): Clip {
  if (typeof c !== "string") return c;
  const all = allClips(project);
  const hit = all.find((x) => x.clip.id === c && x.family === rig.family) ?? all.find((x) => x.clip.id === c && !x.builtin) ?? all.find((x) => x.clip.id === c);
  if (!hit) notFound("clip", c, [...new Set(all.filter((x) => x.family === rig.family || !x.builtin).map((x) => x.clip.id))], "list_clips");
  return hit.clip;
}
function resolveAttachment(project: ProjectFile, a: string | Attachment): Attachment {
  if (typeof a !== "string") return a;
  const hit = allAttachments(project).find((x) => x.attachment.id === a);
  return hit ? hit.attachment : notFound("attachment", a, allAttachments(project).map((x) => x.attachment.id), "list_attachments");
}

/** Render a recipe to animation rows; unknown joints in clips/attachments become readable errors. */
function renderRecipe(project: ProjectFile, kit: StyleKit, recipe: RigRecipe) {
  const lib = resolveRig(project, recipe.rig);
  const atts = withHumanoidDefaults(lib.rig, (recipe.attachments ?? []).map((a) => resolveAttachment(project, a)));
  const clips = recipe.clips.map((c) => resolveClip(project, c, lib));
  if (!clips.length) throw new ToolError("At least one clip is required (see list_clips).");
  const errs = validateRig(lib.rig, atts);
  const joints = new Set(lib.rig.joints.map((j) => j.id));
  // Clips may pose optional attachment joints (a tool tip, a carrying pole); without that attachment
  // the pose key is simply ignored, so only joints nothing could ever provide are errors.
  const optional = new Set([...allAttachments(project), ...atts.map((attachment) => ({ attachment }))].flatMap((x) => (x.attachment.joints ?? []).map((j) => j.id)));
  for (const c of clips) {
    const frames = Array.isArray(c.frames) ? [c.frames] : Object.values(c.frames);
    for (const pose of frames.flat() as Record<string, unknown>[])
      for (const j of Object.keys(pose)) if (!joints.has(j) && !optional.has(j)) errs.push(`clip '${c.id}' moves unknown joint '${j}' (rig '${lib.rig.id}' joints: ${[...joints].join(", ")})`);
  }
  if (errs.length) throw new ToolError(`Cannot render rig '${lib.rig.id}': ${[...new Set(errs)].slice(0, 6).join("; ")}.`);
  // built-in animals share one world scale with the `animal` generator (issue #24)
  const fit = lib.builtin && !atts.length ? fitRigToWorld(lib.rig, kit, recipe.slots ?? {}, clips) : undefined;
  const rows = fit ? renderRig({ rig: fit.rig, kit, slots: recipe.slots, size: fit.size }, fit.clips) : renderRig({ rig: lib.rig, kit, slots: recipe.slots, attachments: atts }, clips);
  return { rows, fps: clips[0].fps, lib, attachments: atts, clips };
}

const slotsField = z.record(z.string(), z.enum(MATERIALS)).optional().describe("Material per slot, e.g. {\"top\":\"cloth\",\"bottom\":\"leather\"}. Missing slots use the rig's defaults (see list_rigs).");

const listRigs = defineTool({
  name: "list_rigs",
  title: "List rigs",
  description: "List rigs (skeleton + parts) usable with generate_rigged: built-in registry first, then rigs saved in the project (create_rig). Shows family, default material slots and joint ids.",
  shape: { family: z.string().optional().describe("Only this family (humanoid, quadruped, bird, custom).") },
  readOnly: true,
  run(ws, i) {
    const list = allRigs(ws.load()).filter((r) => !i.family || r.family === i.family);
    return { data: { rigs: list.map((r) => ({ id: r.rig.id, name: r.rig.name, family: r.family, builtin: r.builtin, grid: r.rig.grid, slots: r.rig.slots, joints: r.rig.joints.map((j) => j.id), parts: r.rig.parts.length })) } };
  },
});

const listClips = defineTool({
  name: "list_clips",
  title: "List clips",
  description: "List animation clips (poses = joint offsets) for generate_rigged: built-in then project clips. A clip fits every rig of its family (same joint names).",
  shape: { family: z.string().optional().describe("Only this family (humanoid, quadruped, bird, custom).") },
  readOnly: true,
  run(ws, i) {
    const list = allClips(ws.load()).filter((c) => !i.family || c.family === i.family);
    return { data: { clips: list.map((c) => ({ id: c.clip.id, family: c.family, builtin: c.builtin, fps: c.clip.fps, frames: Array.isArray(c.clip.frames) ? c.clip.frames.length : Object.fromEntries(Object.entries(c.clip.frames).map(([v, f]) => [v, (f as unknown[]).length])) })) } };
  },
});

const listAttachments = defineTool({
  name: "list_attachments",
  title: "List attachments",
  description: "List attachments (hats, tools, baskets: parts pinned to a joint) for generate_rigged / attach: built-in then project attachments, with family.",
  shape: { family: z.string().optional().describe("Only this family (humanoid, quadruped, bird, custom).") },
  readOnly: true,
  run(ws, i) {
    const list = allAttachments(ws.load()).filter((a) => !i.family || a.family === i.family);
    return { data: { attachments: list.map((a) => ({ id: a.attachment.id, name: a.attachment.name, family: a.family, builtin: a.builtin, parts: a.attachment.parts.map((p) => p.id) })) } };
  },
});

const generateRigged = defineTool({
  name: "generate_rigged",
  title: "Generate rigged character",
  description:
    "Render a rigged character: one skeleton, material slots, optional attachments, and animation clips x 4 directions (rows '<clip>-<dir>'). Lit by the kit like every generator. Saves (as a character) and exports a spritesheet + .json, with a preview. Re-render later with rerender_assets; change accessories with attach.",
  shape: {
    rig: z.string().describe("Rig id (see list_rigs), e.g. a humanoid."),
    slots: slotsField,
    attachments: z.array(z.string()).optional().describe("Attachment ids (see list_attachments)."),
    clips: z.array(z.string()).optional().describe("Clip ids (see list_clips). Default: walk and idle when available."),
    name: z.string().min(1).max(80).optional(),
    kit_id: kitIdField,
    save: z.boolean().default(true),
  },
  positional: "rig",
  run(ws, i) {
    const project = ws.load();
    const kit = getKit(project, i.kit_id);
    const lib = resolveRig(project, i.rig);
    const defClips = allClips(project).filter((c) => c.family === lib.family && ["walk", "idle"].includes(c.clip.id)).map((c) => c.clip.id).sort().reverse();
    const recipe: RigRecipe = { rig: lib.rig.id, ...(i.slots ? { slots: i.slots as Record<string, Material> } : {}), attachments: i.attachments ?? [], clips: i.clips?.length ? i.clips : defClips.length ? defClips : [allClips(project).find((c) => c.family === lib.family)?.clip.id ?? "walk"] };
    const res = renderRecipe(project, kit, recipe);
    const asset = createAsset({
      name: uniqueName(project, "character", i.name ?? lib.rig.name.toLowerCase()),
      category: "character",
      kit,
      rows: res.rows,
      fps: res.fps,
      source: { kind: "rigged", rig: recipe },
    });
    let files: string[] = [];
    if (i.save) {
      project.assets.push(asset);
      ws.save(project);
      files = absPaths(exportAsset(ws, project, asset));
    }
    return { data: { saved: i.save, asset: { ...summarize(ws, project, asset), files } }, images: [previewOf(asset, kit)] };
  },
});

const attach = defineTool({
  name: "attach",
  title: "Attach / detach",
  description: "Add and/or remove attachments (hats, tools...) on a saved rigged asset: updates its recipe, re-renders every clip and direction, re-exports. Ids from list_attachments.",
  shape: {
    id: z.string().describe("Rigged asset id (or exact name)."),
    add: z.array(z.string()).optional().describe("Attachment ids to add."),
    remove: z.array(z.string()).optional().describe("Attachment ids to remove."),
  },
  positional: "id",
  run(ws, i) {
    const project = ws.load();
    const asset = findAsset(project, i.id);
    const recipe = asset.source.rig;
    if (asset.source.kind !== "rigged" || !recipe) throw new ToolError(`'${asset.name}' is a ${asset.source.kind} asset, not rigged; attach only works on assets made with generate_rigged.`);
    if (!i.add?.length && !i.remove?.length) throw new ToolError("Nothing to do: give add and/or remove (attachment ids).");
    const have = recipe.attachments ?? [];
    for (const r of i.remove ?? []) if (!have.some((a) => idOf(a) === r)) throw new ToolError(`Asset '${asset.name}' has no attachment '${r}'. It has: ${have.map(idOf).join(", ") || "(none)"}.`);
    const next = have.filter((a) => !(i.remove ?? []).includes(idOf(a)));
    for (const a of i.add ?? []) if (!next.some((x) => idOf(x) === a)) next.push(a);
    const kit = kitOf(project, asset);
    const updated: RigRecipe = { ...recipe, attachments: next };
    const res = renderRecipe(project, kit, updated);
    asset.source = { ...asset.source, rig: updated };
    asset.rows = res.rows;
    asset.updatedAt = Date.now();
    ws.save(project);
    const files = absPaths(exportAsset(ws, project, asset));
    return { data: { asset: { ...summarize(ws, project, asset), files } }, images: [previewOf(asset, kit)] };
  },
});

// Agent-authored JSON: check the shape first so validateRig/renderRig never see garbage.
const isObj = (x: unknown): x is Record<string, any> => !!x && typeof x === "object" && !Array.isArray(x);
const isPt = (x: unknown) => Array.isArray(x) && x.length === 2 && x.every((n) => typeof n === "number" && Number.isFinite(n));
const perView = (x: unknown, ok: (v: unknown) => boolean) => ok(x) || (isObj(x) && Object.keys(x).length > 0 && Object.keys(x).every((k) => ["down", "side", "up"].includes(k)) && Object.values(x).every(ok));
const PART_KINDS = ["ellipse", "box", "limb", "pixels"];

function shapeErrors(parts: unknown, label: string): string[] {
  const errs: string[] = [];
  if (!Array.isArray(parts)) return [`${label}: 'parts' must be an array`];
  parts.forEach((p, n) => {
    const w = `${label} part ${isObj(p) && typeof p.id === "string" ? p.id : `#${n}`}`;
    if (!isObj(p)) return void errs.push(`${w}: must be an object`);
    if (typeof p.id !== "string" || !p.id) errs.push(`${w}: needs a string 'id'`);
    if (!PART_KINDS.includes(p.kind)) return void errs.push(`${w}: 'kind' must be one of ${PART_KINDS.join(", ")}`);
    if (!perView(p.z, (v) => typeof v === "number")) errs.push(`${w}: 'z' must be a number or {down,side,up} numbers`);
    if (p.kind === "limb") {
      if (typeof p.from !== "string" || typeof p.to !== "string" || typeof p.r !== "number") errs.push(`${w}: limb needs 'from', 'to' (joint ids) and numeric 'r'`);
    } else if (typeof p.joint !== "string") errs.push(`${w}: needs a 'joint' id`);
    if (p.kind === "ellipse" && (typeof p.rx !== "number" || typeof p.ry !== "number")) errs.push(`${w}: ellipse needs numeric 'rx' and 'ry'`);
    if (p.kind === "box" && (typeof p.w !== "number" || typeof p.h !== "number")) errs.push(`${w}: box needs numeric 'w' and 'h'`);
    if (p.kind === "pixels" && (!perView(p.rows, (v) => Array.isArray(v) && v.every((r) => typeof r === "string")) || !isPt(p.anchor))) errs.push(`${w}: pixels needs 'rows' (string[]) and 'anchor' [x,y]`);
  });
  return errs;
}

function rigShapeErrors(r: unknown): string[] {
  if (!isObj(r)) return ["rig must be a JSON object {id,name,grid,joints,parts,slots}"];
  const errs: string[] = [];
  if (typeof r.id !== "string" || !/^[a-z0-9][a-z0-9-_]*$/i.test(r.id)) errs.push("'id' must be a string like 'my-rig'");
  if (typeof r.name !== "string") errs.push("'name' must be a string");
  if (typeof r.grid !== "number" || r.grid < 8 || r.grid > 128) errs.push("'grid' must be a number 8..128 (design grid, e.g. 32)");
  if (!Array.isArray(r.joints) || !r.joints.length) errs.push("'joints' must be a non-empty array of {id, parent, rest}");
  else r.joints.forEach((j: any, n: number) => {
    if (!isObj(j) || typeof j.id !== "string" || !(j.parent === null || typeof j.parent === "string") || !perView(j.rest, isPt)) errs.push(`joint #${n}: needs {id: string, parent: string|null, rest: [x,y] or {down,side,up}}`);
  });
  errs.push(...shapeErrors(r.parts, "rig"));
  if (!isObj(r.slots) || !Object.values(r.slots).every((m) => (MATERIALS as readonly string[]).includes(m as string))) errs.push(`'slots' must map slot names to materials (${MATERIALS.join(", ")})`);
  return errs;
}

function failWith(what: string, errs: string[]): never {
  throw new ToolError(`Invalid ${what}: ${errs.slice(0, 8).join("; ")}${errs.length > 8 ? `; ...${errs.length - 8} more` : ""}.`);
}

const upsert = <T extends { id: string }>(list: T[] | undefined, item: T): T[] => [...(list ?? []).filter((x) => x.id !== item.id), item];

const createRig = defineTool({
  name: "create_rig",
  title: "Create rig",
  description:
    "Author a rig as JSON and store it in the project: {id, name, grid, joints:[{id,parent,rest}], parts:[ellipse|box|limb|pixels ...], slots}. Validated (joint references, parent cycles) and test-rendered; errors say what to fix. Replaces a project rig with the same id; built-in ids are reserved. Use the joint names of an existing family (list_rigs) so its clips and attachments fit. See docs/RIG.md.",
  shape: { rig: z.record(z.string(), z.unknown()).describe("The RigDef object."), kit_id: kitIdField },
  positional: "rig",
  run(ws, i) {
    const project = ws.load();
    const errs = rigShapeErrors(i.rig);
    if (errs.length) failWith("rig", errs);
    const rig = i.rig as unknown as RigDef;
    if (RIGS.some((r) => r.rig.id === rig.id)) throw new ToolError(`Rig id '${rig.id}' is a built-in; choose another id.`);
    const verr = [...validateRig(rig), ...slotErrors(rig.parts, rig.slots, "rig")];
    if (verr.length) failWith("rig", verr);
    const kit = getKit(project, i.kit_id);
    const frames = (["down", "side", "up"] as const).map((v) => {
      try {
        return renderRigFrame({ rig, kit, slots: undefined }, v === "side" ? "right" : v);
      } catch (e) {
        throw new ToolError(`Rig '${rig.id}' failed to render (${v} view): ${(e as Error).message}`);
      }
    });
    project.rigs = upsert(project.rigs, rig);
    ws.save(project);
    return {
      data: { rig: { id: rig.id, name: rig.name, joints: rig.joints.map((j) => j.id), parts: rig.parts.length }, note: "Stored in the project. Render it with generate_rigged {rig, clips}." },
      images: [png(contactSheet(frames, kit, { columns: 3 }), `${rig.id}-views`)],
    };
  },
});

/** Every part's material slot must be a slot the rig declares or a literal material, else it silently renders as skin. */
function slotErrors(parts: unknown, slots: Record<string, unknown> | undefined, where: string): string[] {
  if (!Array.isArray(parts)) return [];
  const known = new Set([...Object.keys(slots ?? {}), ...(MATERIALS as readonly string[])]);
  return parts.flatMap((p: any) =>
    p && typeof p.slot === "string" && !known.has(p.slot)
      ? [`part ${p.id ?? "?"}: unknown slot '${p.slot}' in ${where} (use one of the rig slots ${Object.keys(slots ?? {}).join(", ") || "(none)"} or a material name)`]
      : [],
  );
}

const createClip = defineTool({
  name: "create_clip",
  title: "Create clip",
  description: "Author an animation clip as JSON and store it in the project: {id, fps, frames:[pose,...]} where a pose is {jointId:[dx,dy]} in rig grid units (children follow parents), or frames per view {down:[...],side:[...],up:[...]}. Pass rig to check the joints exist and preview it.",
  shape: { clip: z.record(z.string(), z.unknown()).describe("The Clip object."), rig: z.string().optional().describe("Rig id to validate against and preview on."), kit_id: kitIdField },
  positional: "clip",
  run(ws, i) {
    const project = ws.load();
    const c = i.clip as Record<string, any>;
    const errs: string[] = [];
    if (typeof c.id !== "string" || !c.id) errs.push("needs a string 'id'");
    if (typeof c.fps !== "number" || c.fps < 1 || c.fps > 60) errs.push("'fps' must be a number 1..60");
    const poseOk = (p: unknown) => isObj(p) && Object.values(p).every(isPt);
    const listOk = (v: unknown) => Array.isArray(v) && v.length > 0 && v.every(poseOk);
    if (!perView(c.frames, listOk)) errs.push("'frames' must be a non-empty array of poses {joint:[dx,dy]}, or {down,side,up} of such arrays");
    if (errs.length) failWith("clip", errs);
    const clip = c as unknown as Clip;
    const kit = getKit(project, i.kit_id);
    let images: ToolImage[] | undefined;
    if (i.rig) {
      const rows = renderRecipe(project, kit, { rig: i.rig, clips: [clip] }).rows;
      images = [png(sheetImage(rows.map((r) => r.frames), kit, previewScale(rows[0].frames.length * rows[0].frames[0].w, rows.length * rows[0].frames[0].h), "checker").image, `${clip.id}-preview`)];
    }
    project.clips = upsert(project.clips, clip);
    ws.save(project);
    return { data: { clip: { id: clip.id, fps: clip.fps }, checked_against: i.rig ?? null, note: "Stored in the project. Use its id in generate_rigged clips." }, images };
  },
});

const createAttachment = defineTool({
  name: "create_attachment",
  title: "Create attachment",
  description: "Author an attachment as JSON and store it in the project: {id, name, parts:[...]} (same part kinds as rigs; a part reusing an existing part id replaces it). Pass rig to check the joints exist and preview it worn. Then use its id in generate_rigged / attach.",
  shape: { attachment: z.record(z.string(), z.unknown()).describe("The Attachment object."), rig: z.string().optional().describe("Rig id to validate against and preview on. Default: no check."), kit_id: kitIdField },
  positional: "attachment",
  run(ws, i) {
    const project = ws.load();
    const a = i.attachment as Record<string, any>;
    const errs: string[] = [];
    if (typeof a.id !== "string" || !a.id) errs.push("needs a string 'id'");
    if (typeof a.name !== "string") errs.push("needs a string 'name'");
    errs.push(...shapeErrors(a.parts, "attachment"));
    if (Array.isArray(a.parts) && a.parts.length === 0) errs.push("'parts' is empty; an attachment needs at least one part");
    if (errs.length) failWith("attachment", errs);
    const att = a as unknown as Attachment;
    const kit = getKit(project, i.kit_id);
    let images: ToolImage[] | undefined;
    if (i.rig) {
      const lib = resolveRig(project, i.rig);
      const verr = [...validateRig(lib.rig, [att]), ...slotErrors(att.parts, lib.rig.slots, `attachment for rig '${lib.rig.id}'`)];
      if (verr.length) failWith(`attachment for rig '${lib.rig.id}'`, verr);
      const frames = (["down", "right", "up"] as const).map((d) => renderRigFrame({ rig: lib.rig, kit, attachments: [att] }, d));
      images = [png(contactSheet(frames, kit, { columns: 3 }), `${att.id}-worn`)];
    }
    project.attachments = upsert(project.attachments, att);
    ws.save(project);
    return { data: { attachment: { id: att.id, name: att.name, parts: att.parts.map((p) => p.id) }, checked_against: i.rig ?? null }, images };
  },
});


// ---------- packs ----------

const packEntrySchema = z.union([
  z.object({ name: z.string().min(1).max(80), generator: z.string(), params: paramsField, seed: z.number().int().min(0).max(4294967295).optional(), tags: z.array(z.string()).optional() }).strict(),
  z.object({ name: z.string().min(1).max(80), rig: z.string(), slots: z.record(z.string(), z.string()).optional(), attachments: z.array(z.string()).optional(), clips: z.array(z.string()).optional(), tags: z.array(z.string()).optional() }).strict(),
]);

const generatePack = defineTool({
  name: "generate_pack",
  title: "Generate asset pack",
  description:
    "Build a whole starter set in one call: a built-in pack (e.g. 'farming-v1') or your own manifest of generate_asset / generate_rigged inputs. Every asset uses the kit, is saved and exported like generate_asset; same-named assets are replaced so re-running a pack updates it. `only` keeps entries with any of those tags or generator ids (e.g. ['sea'], ['building']). dry_run lists the entries without generating.",
  shape: {
    pack: z.string().optional().describe(`Built-in pack id. Available: ${PACKS.map((p) => p.id).join(", ") || "(none yet)"}.`),
    manifest: z.object({ id: z.string().optional(), name: z.string().optional(), entries: z.array(packEntrySchema).min(1) }).optional().describe("Your own pack: {entries: [{name, generator, params, seed, tags} | {name, rig, slots, attachments, clips, tags}]}."),
    only: z.array(z.string()).optional().describe("Keep entries tagged with any of these (or using one of these generator ids; rigged entries count as 'rigged')."),
    kit_id: kitIdField,
    replace: z.boolean().default(true).describe("Delete an existing asset with the same name first, so re-running a pack updates it in place."),
    svg: z.boolean().default(true).describe("Also write a layered .svg next to each asset's PNG (editable in Inkscape/Figma; re-import with import_svg)."),
    dry_run: z.boolean().default(false),
  },
  positional: "pack",
  run(ws, i) {
    if (!i.pack === !i.manifest) throw new ToolError(`Give either pack (one of: ${PACKS.map((p) => p.id).join(", ")}) or manifest.`);
    const pack = i.pack ? packById(i.pack) : undefined;
    if (i.pack && !pack) notFound("pack", i.pack, PACKS.map((p) => p.id), "generate_pack with dry_run");
    const all = (pack ? pack.entries : i.manifest!.entries) as PackEntry[];
    const keys = (e: PackEntry) => [...(e.tags ?? []), isRigged(e) ? "rigged" : e.generator];
    const entries = i.only?.length ? all.filter((e) => keys(e).some((k) => i.only!.includes(k))) : all;
    if (i.dry_run) return { data: { pack: pack?.id ?? i.manifest?.id ?? "manifest", count: entries.length, entries } };
    const made: { name: string; files: string[] }[] = [];
    const failed: { name: string; error: string }[] = [];
    for (const e of entries) {
      try {
        if (i.replace && ws.load().assets.some((a) => a.name === e.name)) callTool(ws, "delete_asset", { id: e.name });
        const { tags: _t, ...input } = e;
        const r = callTool(ws, isRigged(e) ? "generate_rigged" : "generate_asset", { ...input, ...(i.kit_id ? { kit_id: i.kit_id } : {}) });
        const asset = (r.data as { asset: { name: string; files: string[] } }).asset;
        if (i.svg) {
          const project = ws.load();
          const a = project.assets.find((x) => x.name === asset.name);
          if (a) asset.files.push(...absPaths(exportAsset(ws, project, a, { format: "svg", rig: rigInfoOf(project, a) })));
        }
        made.push({ name: asset.name, files: asset.files });
      } catch (err) {
        failed.push({ name: e.name, error: err instanceof Error ? err.message : String(err) });
      }
    }
    const project = ws.load();
    const kit = getKit(project, i.kit_id);
    const sprites = made.flatMap((m) => project.assets.find((a) => a.name === m.name)?.rows[0].frames[0] ?? []);
    return {
      data: { pack: pack?.id ?? i.manifest?.id ?? "manifest", generated: made.length, failed, assets: made },
      images: sprites.length ? [png(contactSheet(sprites, kit, { columns: Math.min(8, sprites.length) }), `${pack?.id ?? "pack"}-sheet`)] : [],
    };
  },
});

export const TOOLS: ToolDef[] = [
  getStyleGuide, listGenerators, generateAsset, generateVariations, paintAsset, editAsset, editRegion, listAssets, getAsset,
  deleteAsset, exportAssetTool, importImage, listKits, createKit, updateKit, setActiveKit, rerenderAssets,
  listRigs, listClips, listAttachments, generateRigged, attach, createRig, createClip, createAttachment,
  generatePack, importSvg,
];

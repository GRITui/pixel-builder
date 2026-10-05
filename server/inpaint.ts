// POST /api/inpaint: the model repaints only a masked region of a sprite. It
// sees the whole sprite as legend rows plus the mask and returns legend rows
// for the mask's bounding box (structured output). One repair round on bad
// chars/sizes, then an error. The client applies the rows with applyRegionEdit.
import { callStructured, type StructuredCall } from "./claude";
import { collectImages, withReferenceRule } from "./images";
import { HttpError, LIGHT_TEXT, OUTLINE_TEXT, normalizeKit, requirePrompt, type JsonSchema } from "./prompts";
import { cellsMask, checkRegionRows, maskBounds, rectMask, type Mask, type Rect } from "../src/core/inpaint";
import { buildLegend, legendText, type Legend } from "../src/core/legend";
import type { StyleKit } from "../src/core/types";

const MAX_SIDE = 256;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export interface InpaintRequest {
  rows: string[];
  w: number;
  h: number;
  mask: Mask;
  bbox: Rect;
  prompt: string;
  kit: StyleKit;
}

export function normalizeInpaint(body: Record<string, unknown>): InpaintRequest {
  const rowsRaw = body.rows;
  if (!Array.isArray(rowsRaw) || !rowsRaw.length || rowsRaw.length > MAX_SIDE) throw new HttpError(400, "`rows` must be the sprite as 1..256 legend-row strings.");
  const rows = rowsRaw.map((r) => (typeof r === "string" ? r : ""));
  const h = rows.length;
  const w = Math.max(...rows.map((r) => Array.from(r).length));
  if (w < 1 || w > MAX_SIDE) throw new HttpError(400, "`rows` must be 1..256 chars wide.");
  const m = body.mask;
  if (!isObj(m)) throw new HttpError(400, "`mask` must be {rect:{x,y,w,h}} or {cells:[[x,y],...]}.");
  let mask: Mask;
  if (isObj(m.rect)) {
    const r = m.rect;
    if (![r.x, r.y, r.w, r.h].every((v) => typeof v === "number" && Number.isInteger(v))) throw new HttpError(400, "`mask.rect` needs integer x, y, w, h.");
    mask = rectMask(w, h, { x: r.x as number, y: r.y as number, w: r.w as number, h: r.h as number });
  } else if (Array.isArray(m.cells)) {
    const cells = m.cells.slice(0, w * h).filter((c): c is [number, number] => Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number");
    mask = cellsMask(w, h, cells);
  } else throw new HttpError(400, "`mask` must be {rect:{x,y,w,h}} or {cells:[[x,y],...]}.");
  const bbox = maskBounds(mask, w);
  if (!bbox) throw new HttpError(400, "The mask selects no cells inside the sprite.");
  return { rows, w, h, mask, bbox, prompt: requirePrompt(body.prompt), kit: normalizeKit(body.kit) };
}

const escapeClass = (c: string) => (/[a-zA-Z0-9]/.test(c) ? c : "\\" + c);

export function buildInpaintSchema(bbox: Rect, legend: Legend): JsonSchema {
  const chars = [".", ...legend.entries.map((e) => e.char)].map(escapeClass).join("");
  return {
    type: "object",
    properties: {
      rows: {
        type: "array",
        description: `Exactly ${bbox.h} strings of exactly ${bbox.w} legend characters, top to bottom`,
        items: { type: "string", pattern: `^[${chars}]{${bbox.w}}$` },
      },
    },
    required: ["rows"],
    additionalProperties: false,
  };
}

export function buildInpaintPrompt(r: InpaintRequest, legend: Legend, repair?: { previous: unknown; errors: string[] }) {
  const { kit, bbox, w, h } = r;
  const system =
    "You are a pixel artist editing part of an existing sprite given as rows of text. Each character is one pixel from a fixed palette legend ('.' is transparent). " +
    "You repaint ONLY the cells marked '#' in the mask and return JSON {rows}: the bounding box of the mask as exactly the requested number of strings, each exactly the requested width. " +
    "Chars for cells outside the mask are ignored (use '.'). Use only legend characters (never spaces or quotes). Match the sprite's existing shading, light direction, palette use and level of detail; keep the result clean with a clear silhouette and no stray pixels.";
  const maskRows: string[] = [];
  for (let y = 0; y < h; y++) {
    let s = "";
    for (let x = 0; x < w; x++) s += r.mask[y * w + x] ? "#" : ".";
    maskRows.push(s);
  }
  const parts = [
    `Sprite: ${w} columns x ${h} rows.`,
    `Light comes from ${LIGHT_TEXT[kit.lightDir]}.`,
    OUTLINE_TEXT[kit.outline] + " The outline around changed pixels is re-applied automatically.",
    `Art direction: ${kit.vibe}`,
    "",
    "Palette legend (each material has 5 levels, 0 = darkest to 4 = lightest):",
    legendText(legend),
    "",
    "Current sprite:",
    ...r.rows,
    "",
    "Mask ('#' = repaint these cells):",
    ...maskRows,
    "",
    `Mask bounding box: x=${bbox.x}, y=${bbox.y}, ${bbox.w} columns x ${bbox.h} rows. Return exactly ${bbox.h} strings of exactly ${bbox.w} characters covering that box.`,
    `Edit: ${r.prompt}`,
  ];
  if (repair) {
    parts.push("", "Your previous answer was invalid:", JSON.stringify(repair.previous), "Problems:", ...repair.errors.map((e) => `- ${e}`), "Return a corrected answer.");
  }
  return { system, user: parts.join("\n"), schema: buildInpaintSchema(bbox, legend) };
}

export type ModelCall = (c: StructuredCall) => Promise<unknown>;

export async function inpaint(body: Record<string, unknown>, signal: AbortSignal, call: ModelCall = callStructured) {
  const req = normalizeInpaint(body);
  const images = await collectImages(body);
  const legend = buildLegend(req.kit);
  let repair: { previous: unknown; errors: string[] } | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = buildInpaintPrompt(req, legend, repair);
    const { user, schema } = p;
    const system = withReferenceRule(p.system, images);
    const raw = await call({ system, user, images, schema, effort: "medium", maxTokens: 8000, signal });
    const rows = isObj(raw) ? raw.rows : undefined;
    const errors = checkRegionRows(rows, req.bbox, legend, req.mask, req.w);
    if (!errors.length) return { rect: req.bbox, rows: rows as string[] };
    repair = { previous: rows ?? raw, errors };
  }
  throw new HttpError(502, `The model's edit stayed invalid after a repair attempt (${repair!.errors[0]}). Try again or a simpler prompt.`);
}

// Pure prompt / JSON-schema construction and request validation. No network.
// Everything that arrives from the browser or from the model is untrusted.
import { MATERIALS, PALETTES, RAMP_LEN, hexToRgb, rgbToOklab, type Material, type Ramps } from "../src/core/palette";
import { DEFAULT_KIT } from "../src/core/kit";
import { CATEGORIES, type Category, type LightDir, type OutlineMode, type Sprite, type StyleKit } from "../src/core/types";
import { PAINT, coerceParams, type Generator, type ParamSpec, type Params } from "../src/core/generators/types";
import { buildLegend, encodeSprite, legendText } from "../src/core/legend";

export const MIN_DIM = 8;
export const MAX_DIM = 64;

/** Round and clamp a requested sprite dimension to 8..64 (fallback if not a number). */
export function clampDim(v: unknown, fallback: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.max(MIN_DIM, Math.min(MAX_DIM, n));
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const OUTLINES: OutlineMode[] = ["none", "black", "colored", "selective"];
const LIGHTS: LightDir[] = ["top-left", "top", "top-right"];
const HEX = /^#[0-9a-f]{6}$/i;

export type JsonSchema = Record<string, unknown>;

// ---------- request validation ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function cleanText(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f]/g, " ").trim().slice(0, max) : "";
}

export function requirePrompt(v: unknown): string {
  const p = cleanText(v, 1000);
  if (!p) throw new HttpError(400, "`prompt` is required");
  return p;
}

/** Coerce an untrusted kit into a fully-formed StyleKit (defaults fill the gaps). */
export function normalizeKit(raw: unknown): StyleKit {
  const k = isObj(raw) ? raw : {};
  const rampOverrides: Partial<Ramps> = {};
  if (isObj(k.rampOverrides)) {
    for (const m of MATERIALS) {
      const r = (k.rampOverrides as Record<string, unknown>)[m];
      if (Array.isArray(r)) {
        const hex = r.filter((c): c is string => typeof c === "string" && HEX.test(c)).slice(0, RAMP_LEN);
        if (hex.length) rampOverrides[m] = hex;
      }
    }
  }
  const sizes = { ...DEFAULT_KIT.sizes };
  if (isObj(k.sizes)) for (const key of Object.keys(sizes) as (keyof typeof sizes)[]) sizes[key] = clampDim((k.sizes as Record<string, unknown>)[key], sizes[key]);
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  return {
    id: cleanText(k.id, 80) || DEFAULT_KIT.id,
    name: cleanText(k.name, 80) || DEFAULT_KIT.name,
    paletteId: typeof k.paletteId === "string" && PALETTES.some((p) => p.id === k.paletteId) ? k.paletteId : DEFAULT_KIT.paletteId,
    rampOverrides,
    outline: OUTLINES.includes(k.outline as OutlineMode) ? (k.outline as OutlineMode) : DEFAULT_KIT.outline,
    lightDir: LIGHTS.includes(k.lightDir as LightDir) ? (k.lightDir as LightDir) : DEFAULT_KIT.lightDir,
    shadeSteps: Math.round(num(k.shadeSteps, 2, RAMP_LEN, DEFAULT_KIT.shadeSteps)),
    dither: typeof k.dither === "boolean" ? k.dither : DEFAULT_KIT.dither,
    ambient: num(k.ambient, 0, 1, DEFAULT_KIT.ambient),
    sizes,
    vibe: cleanText(k.vibe, 600) || DEFAULT_KIT.vibe,
  };
}

function normalizeSpec(raw: unknown): ParamSpec | null {
  if (!isObj(raw)) return null;
  const key = cleanText(raw.key, 60);
  if (!key) return null;
  const label = cleanText(raw.label, 80) || key;
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 80).map((x) => x.slice(0, 60)) : []);
  switch (raw.type) {
    case "select": {
      const options = strs(raw.options);
      if (!options.length) return null;
      const def = typeof raw.default === "string" && options.includes(raw.default) ? raw.default : options[0];
      return { key, label, type: "select", options, default: def };
    }
    case "material": {
      const options = Array.isArray(raw.options) ? (strs(raw.options).filter((m) => (MATERIALS as readonly string[]).includes(m)) as Material[]) : undefined;
      const pool = options && options.length ? options : PAINT;
      const def = typeof raw.default === "string" && pool.includes(raw.default as Material) ? (raw.default as Material) : pool[0];
      return { key, label, type: "material", options: options && options.length ? options : undefined, default: def };
    }
    case "number": {
      const min = typeof raw.min === "number" && Number.isFinite(raw.min) ? raw.min : 0;
      const max = typeof raw.max === "number" && Number.isFinite(raw.max) ? raw.max : Math.max(min, 1);
      const step = typeof raw.step === "number" && raw.step > 0 ? raw.step : undefined;
      const d = typeof raw.default === "number" && Number.isFinite(raw.default) ? raw.default : min;
      return { key, label, type: "number", min, max: Math.max(min, max), step, default: Math.max(min, Math.min(max, d)) };
    }
    case "bool":
      return { key, label, type: "bool", default: raw.default === true };
    default:
      return null;
  }
}

/** Rebuild a Generator-shaped object (only fields the prompts need) from untrusted JSON. */
export function normalizeGenerator(raw: unknown): Generator {
  if (!isObj(raw)) throw new HttpError(400, "`generator` is required");
  const specs = (Array.isArray(raw.params) ? raw.params : []).slice(0, 40).map(normalizeSpec).filter((s): s is ParamSpec => !!s);
  return {
    id: cleanText(raw.id, 60) || "generator",
    category: "object",
    label: cleanText(raw.label, 80) || "Generator",
    description: cleanText(raw.description, 400),
    params: specs,
    generate: () => {
      throw new Error("not available on the server");
    },
  };
}

export function normalizeCurrent(raw: unknown): Record<string, unknown> | undefined {
  if (!isObj(raw)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw).slice(0, 40)) if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k.slice(0, 60)] = typeof v === "string" ? v.slice(0, 60) : v;
  return out;
}

export function normalizeCategory(v: unknown): Category {
  if (CATEGORIES.some((c) => c.id === v)) return v as Category;
  throw new HttpError(400, "`category` must be one of " + CATEGORIES.map((c) => c.id).join(", "));
}

/** A sprite sent by the client as a style reference; invalid ones are dropped. */
export function normalizeSprite(raw: unknown): Sprite | null {
  if (!isObj(raw)) return null;
  const { w, h, data } = raw;
  if (typeof w !== "number" || typeof h !== "number" || !Number.isInteger(w) || !Number.isInteger(h)) return null;
  if (w < 1 || h < 1 || w > MAX_DIM || h > MAX_DIM || !Array.isArray(data) || data.length !== w * h) return null;
  return { w, h, data: data.map((v) => (typeof v === "number" ? v : 0)) };
}

export function normalizeReferences(raw: unknown): Sprite[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 2).map(normalizeSprite).filter((s): s is Sprite => !!s);
}

// ---------- vibe (generator params) ----------

export function buildVibeSchema(g: Pick<Generator, "params">): JsonSchema {
  const props: Record<string, JsonSchema> = {};
  for (const s of g.params) {
    if (s.type === "select") props[s.key] = { type: "string", enum: s.options, description: s.label };
    else if (s.type === "material") props[s.key] = { type: "string", enum: s.options ?? PAINT, description: s.label };
    else if (s.type === "number") props[s.key] = { type: "number", description: `${s.label} (${s.min} to ${s.max})` };
    else props[s.key] = { type: "boolean", description: s.label };
  }
  const keys = Object.keys(props);
  return {
    type: "object",
    properties: {
      name: { type: "string", description: "Short evocative asset name, 1-4 words" },
      params: { type: "object", properties: props, required: keys, additionalProperties: false },
      notes: { type: "string", description: "One sentence on how the prompt was interpreted" },
    },
    required: ["name", "params", "notes"],
    additionalProperties: false,
  };
}

function describeKit(kit: StyleKit): string {
  return [
    `Style kit "${kit.name}": palette ${kit.paletteId}, outline ${kit.outline}, light from ${kit.lightDir}, ${kit.shadeSteps} shade steps, dither ${kit.dither ? "on" : "off"}, ambient ${kit.ambient}.`,
    `Art direction: ${kit.vibe}`,
  ].join("\n");
}

function describeSpec(s: ParamSpec): string {
  if (s.type === "select") return `- ${s.key} (${s.label}): one of ${s.options.join(", ")}; default ${s.default}`;
  if (s.type === "material") return `- ${s.key} (${s.label}): a material, one of ${(s.options ?? PAINT).join(", ")}; default ${s.default}`;
  if (s.type === "number") return `- ${s.key} (${s.label}): number ${s.min}..${s.max}${s.step ? ` step ${s.step}` : ""}; default ${s.default}`;
  return `- ${s.key} (${s.label}): true/false; default ${s.default}`;
}

export function buildVibePrompt(a: { prompt: string; generator: Generator; kit: StyleKit; current?: Record<string, unknown> }) {
  const system =
    "You configure a procedural pixel-art generator for a game asset pipeline. " +
    "Pick parameter values that best realise the user's description. The generator and the style kit guarantee a consistent look, " +
    "so you only choose parameters. Materials are named colour ramps from the style kit's palette (e.g. cloth, leather, metal, gold, wood, stone, roof, foliage); " +
    "choose materials whose colours suit the description. Respond only with the JSON object described by the schema.";
  const user = [
    describeKit(a.kit),
    "",
    `Generator: ${a.generator.label} (${a.generator.id}) - ${a.generator.description}`,
    "Parameters:",
    ...a.generator.params.map(describeSpec),
    a.current && Object.keys(a.current).length ? `\nCurrent values (keep what the request does not change):\n${JSON.stringify(a.current)}` : "",
    "",
    `Request: ${a.prompt}`,
  ]
    .filter((l) => l !== "")
    .join("\n");
  return { system, user, schema: buildVibeSchema(a.generator) };
}

/** Model output -> safe params via coerceParams (defaults fill anything invalid). */
export function parseVibe(raw: unknown, g: Generator): { name: string; params: Params; notes: string } {
  const o = isObj(raw) ? raw : {};
  return {
    name: cleanText(o.name, 60) || g.label,
    params: coerceParams(g, isObj(o.params) ? o.params : {}),
    notes: cleanText(o.notes, 300),
  };
}

// ---------- freeform pixels ----------

export function buildPixelsSchema(): JsonSchema {
  return {
    type: "object",
    properties: {
      name: { type: "string", description: "Short evocative asset name, 1-4 words" },
      rows: { type: "array", items: { type: "string" }, description: "Pixel rows, top to bottom" },
    },
    required: ["name", "rows"],
    additionalProperties: false,
  };
}

const CATEGORY_HINT: Record<Category, string> = {
  character: "a single character sprite, standing, facing the viewer (or down for a top-down RPG), centred, feet near the bottom row",
  building: "a single building in 3/4 top-down view showing roof and front wall, door and windows readable, centred",
  environment: "a single environment element (tree, rock, bush, flower...) centred and grounded near the bottom row",
  object: "a single object / item icon, centred, readable silhouette",
  ui: "a flat front-on UI element (button, panel, icon, bar) with crisp pixel-aligned edges",
  map: "a seamless, tileable terrain tile that fills the whole frame edge to edge (no transparency)",
};

export const LIGHT_TEXT: Record<LightDir, string> = {
  "top-left": "the top-left (highlights on upper-left faces, shadows on lower-right)",
  top: "directly above (highlights on top faces, shadows underneath)",
  "top-right": "the top-right (highlights on upper-right faces, shadows on lower-left)",
};

export const OUTLINE_TEXT: Record<OutlineMode, string> = {
  none: "Do not draw outlines.",
  black: "Do NOT draw the outer silhouette outline - a 1px ink outline is added automatically, so leave a 1px transparent margin around the shape.",
  colored: "Do NOT draw the outer silhouette outline - a 1px coloured outline is added automatically, so leave a 1px transparent margin around the shape.",
  selective: "Do NOT draw the outer silhouette outline - a 1px selective outline is added automatically, so leave a 1px transparent margin around the shape.",
};

export function buildPixelsPrompt(a: { prompt: string; category: Category; w: number; h: number; kit: StyleKit; references: Sprite[] }) {
  const { w, h, kit } = a;
  const legend = buildLegend(kit);
  const system =
    "You are a pixel artist painting a sprite as rows of text. Each character is one pixel, chosen from a fixed palette legend. " +
    "Return JSON {name, rows}: `rows` has exactly the requested number of strings, top to bottom, each string exactly the requested width. " +
    "Use only characters from the legend (never spaces, quotes or other characters). Keep the art clean: clear silhouette, no stray pixels, " +
    "consistent light direction, shade each material from its dark to light chars, and keep to the requested art direction.";
  const parts = [
    `Canvas: ${w} columns x ${h} rows (exactly ${h} strings of exactly ${w} characters).`,
    `Subject: ${CATEGORY_HINT[a.category]}.`,
    `Light comes from ${LIGHT_TEXT[kit.lightDir]}. Use at most ${kit.shadeSteps} distinct shades per material` +
      (kit.dither ? "; ordered dithering is part of this style." : "; avoid dithering, use flat clustered shading."),
    OUTLINE_TEXT[kit.outline],
    `Art direction: ${kit.vibe}`,
    "",
    "Palette legend (each material has 5 levels, 0 = darkest to 4 = lightest):",
    legendText(legend),
  ];
  a.references.forEach((r, i) => {
    parts.push("", `Style reference ${i + 1} (${r.w}x${r.h}, same legend) - match its shading, palette use and level of detail, but do not copy its subject:`, ...encodeSprite(r, legend));
  });
  parts.push("", `Paint: ${a.prompt}`);
  return { system, user: parts.join("\n"), schema: buildPixelsSchema() };
}

// ---------- style kit ----------

export function buildKitSchema(): JsonSchema {
  return {
    type: "object",
    properties: {
      paletteId: { type: "string", enum: PALETTES.map((p) => p.id) },
      outline: { type: "string", enum: OUTLINES },
      lightDir: { type: "string", enum: LIGHTS },
      shadeSteps: { type: "integer", enum: [2, 3, 4, 5], description: "Shade levels per material" },
      dither: { type: "boolean" },
      ambient: { type: "number", description: "Ambient light 0 (harsh) to 1 (flat)" },
      vibe: { type: "string", description: "One or two sentences of art direction for later prompts" },
      rampOverrides: {
        type: "array",
        description: "Up to 6 hue-tweaked colour ramps; empty if the base palette already fits",
        items: {
          type: "object",
          properties: {
            material: { type: "string", enum: [...MATERIALS] },
            colors: { type: "array", items: { type: "string" }, description: `${RAMP_LEN} hex colours like #aabbcc, darkest to lightest` },
          },
          required: ["material", "colors"],
          additionalProperties: false,
        },
      },
      notes: { type: "string", description: "One sentence on how the style was interpreted" },
    },
    required: ["paletteId", "outline", "lightDir", "shadeSteps", "dither", "ambient", "vibe", "rampOverrides", "notes"],
    additionalProperties: false,
  };
}

export function buildKitPrompt(a: { prompt: string; kit: StyleKit }) {
  const system =
    "You are an art director defining a pixel-art style kit that keeps every asset in a game visually consistent. " +
    "Translate the user's description into kit settings. Pick the closest base palette, then optionally adjust the hue of up to 6 material ramps " +
    "(5 hex colours each, strictly dark to light, shadows slightly cooler/more saturated and highlights warmer) so the palette matches the mood. " +
    "Respond only with the JSON object described by the schema.";
  const palettes = PALETTES.map((p) => `- ${p.id}: ${p.name}; sample ramps cloth ${p.ramps.cloth.join(" ")}, foliage ${p.ramps.foliage.join(" ")}`).join("\n");
  const user = [
    "Base palettes (each has the same " + MATERIALS.length + " materials: " + MATERIALS.join(", ") + "):",
    palettes,
    "",
    "Outline modes: none, black (ink), colored (darkest shade of the touching material), selective (dark on shadow side, tinted toward the light).",
    "Light directions: top-left, top, top-right. shadeSteps 2-5 (fewer = flatter, chunkier). ambient 0-1.",
    "",
    "Current kit:",
    describeKit(a.kit),
    "",
    `Request: ${a.prompt}`,
  ].join("\n");
  return { system, user, schema: buildKitSchema() };
}

const oklabL = (hex: string) => rgbToOklab(hexToRgb(hex))[0];

/** Model output -> validated Partial<StyleKit> (+ notes). */
export function parseKit(raw: unknown): { kit: Partial<StyleKit>; notes: string } {
  const o = isObj(raw) ? raw : {};
  const kit: Partial<StyleKit> = {};
  if (typeof o.paletteId === "string" && PALETTES.some((p) => p.id === o.paletteId)) kit.paletteId = o.paletteId;
  if (OUTLINES.includes(o.outline as OutlineMode)) kit.outline = o.outline as OutlineMode;
  if (LIGHTS.includes(o.lightDir as LightDir)) kit.lightDir = o.lightDir as LightDir;
  if (typeof o.shadeSteps === "number" && Number.isFinite(o.shadeSteps)) kit.shadeSteps = Math.max(2, Math.min(RAMP_LEN, Math.round(o.shadeSteps)));
  if (typeof o.dither === "boolean") kit.dither = o.dither;
  if (typeof o.ambient === "number" && Number.isFinite(o.ambient)) kit.ambient = Math.max(0, Math.min(1, o.ambient));
  const vibe = cleanText(o.vibe, 600);
  if (vibe) kit.vibe = vibe;
  const overrides: Partial<Ramps> = {};
  let count = 0;
  if (Array.isArray(o.rampOverrides)) {
    for (const e of o.rampOverrides) {
      if (count >= 6 || !isObj(e)) continue;
      const m = e.material as Material;
      if (!(MATERIALS as readonly string[]).includes(m) || overrides[m]) continue;
      const colors = Array.isArray(e.colors) ? e.colors.filter((c): c is string => typeof c === "string" && HEX.test(c.trim())).map((c) => c.trim().toLowerCase()) : [];
      if (colors.length !== RAMP_LEN) continue;
      overrides[m] = [...colors].sort((a, b) => oklabL(a) - oklabL(b)); // enforce dark -> light
      count++;
    }
  }
  // The model's list is the complete new override set (an empty list clears old overrides).
  if (Array.isArray(o.rampOverrides)) kit.rampOverrides = overrides;
  return { kit, notes: cleanText(o.notes, 300) };
}


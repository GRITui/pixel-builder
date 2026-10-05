// Provider-agnostic helpers: env config, health, and the pure JSON plumbing
// shared by non-Anthropic providers. Never expose keys from here.
import type { JsonSchema } from "./prompts";

export type ProviderName = "anthropic" | "openai";
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";
export const DEFAULT_OPENAI_BASE = "https://api.openai.com/v1";

type Env = Record<string, string | undefined>;

export const providerName = (env: Env = process.env): ProviderName => (env.AI_PROVIDER?.trim().toLowerCase() === "openai" ? "openai" : "anthropic");

export interface OpenAIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  visionModel: string;
}

export function openaiConfig(env: Env = process.env): OpenAIConfig {
  const model = env.AI_MODEL || "gpt-4o";
  return {
    baseUrl: (env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE).replace(/\/+$/, ""),
    apiKey: env.OPENAI_API_KEY ?? "",
    model,
    visionModel: env.AI_VISION_MODEL || model,
  };
}

/** AI is usable when the provider's key is set (openai: or a custom base URL, for keyless local servers). */
export function aiEnabled(env: Env = process.env): boolean {
  if (providerName(env) === "openai") return !!env.OPENAI_API_KEY || !!env.OPENAI_BASE_URL;
  return !!env.ANTHROPIC_API_KEY;
}

export function activeModel(env: Env = process.env): string {
  return providerName(env) === "openai" ? openaiConfig(env).model : env.PIXEL_MODEL || DEFAULT_ANTHROPIC_MODEL;
}

export function aiHealth(env: Env = process.env) {
  const provider = providerName(env);
  if (!aiEnabled(env)) {
    const reason = provider === "openai" ? "OPENAI_API_KEY is not set on the server" : "ANTHROPIC_API_KEY is not set on the server";
    return { enabled: false, provider, model: null, vision_model: null, reason };
  }
  if (provider === "openai") {
    const c = openaiConfig(env);
    return { enabled: true, provider, model: c.model, vision_model: c.visionModel };
  }
  const model = activeModel(env);
  return { enabled: true, provider, model, vision_model: model };
}

export const stripThink = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim();

/** Parse JSON from model text: whole text, ```json fence, then first balanced object. */
export function extractJson(raw: string): unknown {
  const text = stripThink(raw);
  const tries: string[] = [text];
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) tries.push(fence[1].trim());
  const bal = firstBalanced(text);
  if (bal) tries.push(bal);
  for (const t of tries) {
    try {
      return JSON.parse(t);
    } catch {
      /* try next */
    }
  }
  throw new Error("no JSON object found in model output");
}

function firstBalanced(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === "\\") i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return s.slice(start, i + 1);
  }
  return null;
}

/** Small validator for the JSON-schema subset we use. Returns an error string or null. */
export function validateSchema(v: unknown, schema: JsonSchema, path = "$"): string | null {
  const s = schema as Record<string, any>;
  if (Array.isArray(s.enum) && !s.enum.some((e: unknown) => e === v)) return `${path}: must be one of ${JSON.stringify(s.enum)}`;
  if (s.const !== undefined && s.const !== v) return `${path}: must equal ${JSON.stringify(s.const)}`;
  if (Array.isArray(s.anyOf)) return s.anyOf.some((x: JsonSchema) => !validateSchema(v, x, path)) ? null : `${path}: matches none of anyOf`;
  const types: string[] = s.type === undefined ? [] : Array.isArray(s.type) ? s.type : [s.type];
  if (types.length) {
    const ok = types.some((t) =>
      t === "integer" ? Number.isInteger(v) : t === "number" ? typeof v === "number" && Number.isFinite(v) : t === "array" ? Array.isArray(v) : t === "object" ? typeof v === "object" && v !== null && !Array.isArray(v) : t === "null" ? v === null : typeof v === t,
    );
    if (!ok) return `${path}: expected ${types.join("|")}`;
  }
  if (typeof v === "number") {
    if (typeof s.minimum === "number" && v < s.minimum) return `${path}: must be >= ${s.minimum}`;
    if (typeof s.maximum === "number" && v > s.maximum) return `${path}: must be <= ${s.maximum}`;
  }
  if (Array.isArray(v)) {
    if (typeof s.minItems === "number" && v.length < s.minItems) return `${path}: needs at least ${s.minItems} items`;
    if (typeof s.maxItems === "number" && v.length > s.maxItems) return `${path}: at most ${s.maxItems} items`;
    if (s.items) {
      for (let i = 0; i < v.length; i++) {
        const e = validateSchema(v[i], s.items, `${path}[${i}]`);
        if (e) return e;
      }
    }
  } else if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    const props = (s.properties ?? {}) as Record<string, JsonSchema>;
    for (const k of (s.required ?? []) as string[]) if (!(k in o)) return `${path}: missing required property "${k}"`;
    for (const [k, val] of Object.entries(o)) {
      if (k in props) {
        const e = validateSchema(val, props[k], `${path}.${k}`);
        if (e) return e;
      } else if (s.additionalProperties === false) return `${path}: unexpected property "${k}"`;
    }
  }
  return null;
}

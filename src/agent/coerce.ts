// Forgiving input coercion for tool calls. Smaller / non-Claude models make predictable slips:
// numbers as strings, "True", JSON-in-a-string, `frames` as one flat list, enum case, camelCase keys.
// This module repairs those against a tool's JSON schema *before* zod validates, so consistency rules
// (palette indices, finalize, legend chars) are untouched: only the transport of the value is fixed.

export type JsonSchema = {
  type?: string;
  enum?: unknown[];
  const?: unknown;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  required?: string[];
  description?: string;
};

/** Lower-case and drop `_`, `-`, spaces: "Dead Tree", "dead_tree" and "dead-tree" compare equal. */
export const normKey = (s: string): string => s.toLowerCase().replace(/[\s_\-]+/g, "");

/** Also splits camelCase, so `kitId` and `kit_id` compare equal. */
const normField = (s: string): string => normKey(s.replace(/([a-z0-9])([A-Z])/g, "$1_$2"));

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

function matches(v: unknown, s: JsonSchema): boolean {
  if ("const" in s) return v === s.const;
  if (s.enum) return s.enum.includes(v);
  switch (s.type) {
    case "string": return typeof v === "string";
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "integer": return typeof v === "number" && Number.isInteger(v);
    case "boolean": return typeof v === "boolean";
    case "array": return Array.isArray(v);
    case "object": return isObj(v);
    default: return true;
  }
}

function parseJsonLoose(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** "a=1,b=x" -> {a:1,b:"x"} (the CLI shorthand, accepted for any object input). */
function parsePairs(text: string): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const pair of text.split(",")) {
    const i = pair.indexOf("=");
    if (i < 1) return undefined;
    const raw = pair.slice(i + 1).trim();
    out[pair.slice(0, i).trim()] = raw === "true" ? true : raw === "false" ? false : raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : raw;
  }
  return Object.keys(out).length ? out : undefined;
}

export function coerceValue(v: unknown, s: JsonSchema | undefined, path: string, warnings: string[]): unknown {
  if (!s || typeof s !== "object") return v;
  const branches = s.anyOf ?? s.oneOf;
  if (branches) {
    if (branches.some((b) => matches(v, b) && !(b.type === "array" || b.type === "object"))) return v;
    for (const b of branches) {
      const c = coerceValue(v, b, path, warnings);
      if (matches(c, b)) return c;
    }
    return v;
  }
  if (s.enum && s.enum.every((e) => typeof e === "string")) {
    if (typeof v !== "string" || s.enum.includes(v)) return v;
    const hit = (s.enum as string[]).find((e) => normKey(e) === normKey(v));
    return hit ?? v;
  }
  switch (s.type) {
    case "number":
    case "integer": {
      let n = v;
      if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v.trim()))) n = Number(v.trim());
      else if (typeof v === "boolean") return v;
      if (s.type === "integer" && typeof n === "number" && Number.isFinite(n) && !Number.isInteger(n)) n = Math.round(n);
      return n;
    }
    case "boolean": {
      if (typeof v === "string") {
        const t = v.trim().toLowerCase();
        if (["true", "yes", "on", "1"].includes(t)) return true;
        if (["false", "no", "off", "0"].includes(t)) return false;
      } else if (v === 0 || v === 1) return v === 1;
      return v;
    }
    case "string":
      return typeof v === "number" || typeof v === "boolean" ? String(v) : v;
    case "array": {
      let a = v;
      if (typeof a === "string") {
        const t = a.trim();
        const parsed = t.startsWith("[") ? parseJsonLoose(t) : undefined;
        if (Array.isArray(parsed)) a = parsed;
        else if (s.items && (s.items.type === "string" || s.items.type === "number" || s.items.type === "integer")) a = t === "" ? [] : t.split(",").map((x) => x.trim()).filter(Boolean);
        else return v;
      } else if (!Array.isArray(a)) {
        // a lone element where a list is expected: wrap it
        return s.items && s.items.type !== "array" && a !== undefined && a !== null ? [coerceValue(a, s.items, path, warnings)] : v;
      }
      // a plain row string among frames stays a string (it is a flat list of rows, handled below)
      const list = (a as unknown[]).map((x, i) => (s.items?.type === "array" && typeof x === "string" && !x.trim().startsWith("[") ? x : coerceValue(x, s.items, `${path}.${i}`, warnings)));
      // frames given as one flat list of rows -> one frame
      if (s.items?.type === "array" && list.length > 0 && list.every((x) => typeof x === "string")) {
        warnings.push(`'${path}': expected a list of frames (each a list of rows); wrapped your single list as one frame`);
        return [list];
      }
      return list;
    }
    case "object": {
      let o = v;
      if (typeof o === "string") {
        const t = o.trim();
        const parsed = t.startsWith("{") ? parseJsonLoose(t) : parsePairs(t);
        if (isObj(parsed)) o = parsed;
        else return v;
      }
      if (!isObj(o)) return v;
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(o)) {
        if (x === null && !(s.required ?? []).includes(k)) continue; // null for "not set"
        const ps = s.properties?.[k] ?? (isObj(s.additionalProperties) ? (s.additionalProperties as JsonSchema) : undefined);
        out[k] = coerceValue(x, ps, path ? `${path}.${k}` : k, warnings);
      }
      return out;
    }
    default:
      return v;
  }
}

/**
 * Coerce a tool's raw input against its JSON schema. Unknown top-level keys are renamed when they only
 * differ by case / separators (`kitId` -> `kit_id`), otherwise dropped with a warning.
 */
export function coerceInput(schema: JsonSchema, raw: unknown, warnings: string[]): unknown {
  let input = raw ?? {};
  if (typeof input === "string") {
    const t = input.trim();
    input = t === "" ? {} : (parseJsonLoose(t) ?? input);
  }
  if (!isObj(input)) return input;
  const props = schema.properties ?? {};
  const names = Object.keys(props);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(input)) {
    let key = k;
    if (!(k in props)) {
      const hit = names.find((n) => normField(n) === normField(k) && !(n in input));
      if (hit) {
        key = hit;
        warnings.push(`input '${k}' read as '${hit}'`);
      } else {
        warnings.push(`ignored unknown input '${k}'; valid inputs: ${names.join(", ")}`);
        continue;
      }
    }
    if (x === null && !(schema.required ?? []).includes(key)) continue;
    out[key] = coerceValue(x, props[key], key, warnings);
  }
  return out;
}

// ---------- schema compatibility for function-calling layers ----------

const SCHEMA_DROP = new Set(["propertyNames", "patternProperties", "$schema", "$ref", "$defs", "definitions", "not", "if", "then", "else"]);

function typeOfBranch(b: any): string | undefined {
  return typeof b?.type === "string" ? b.type : undefined;
}

/**
 * Rewrite a JSON schema into the subset Gemini / Qwen / local function calling accepts: no
 * anyOf/oneOf/allOf, $ref, tuple items, type arrays or schema-valued additionalProperties. The
 * server still validates (and coerces) with the full zod schema, so this only simplifies what is advertised.
 */
export function simplifySchema(node: any): any {
  if (Array.isArray(node)) return node.map(simplifySchema);
  if (!node || typeof node !== "object") return node;
  let n: Record<string, any> = { ...node };

  const union = n.anyOf ?? n.oneOf;
  if (union) {
    delete n.anyOf;
    delete n.oneOf;
    const branches = (union as any[]).map(simplifySchema).filter((b) => typeOfBranch(b) !== "null");
    const types = [...new Set(branches.map(typeOfBranch))];
    let merged: Record<string, any>;
    if (branches.length && branches.every((b) => "const" in b || Array.isArray(b.enum))) {
      const values = branches.flatMap((b) => ("const" in b ? [b.const] : b.enum));
      const t = values.every((x) => typeof x === "number") ? "number" : "string";
      merged = { type: t, enum: t === "string" ? values.map(String) : values };
    } else if (types.length === 1 && types[0] === "object") {
      const properties: Record<string, any> = {};
      for (const b of branches) for (const [k, v] of Object.entries(b.properties ?? {})) properties[k] ??= v;
      merged = { type: "object", properties };
    } else if (types.length === 1 && types[0]) {
      merged = { ...branches[0] };
    } else {
      // mixed primitives (string | number | boolean ...): advertise a string; the server coerces
      const prim = types.includes("string") ? "string" : (types[0] ?? "string");
      merged = { type: prim, description: `${prim} (also accepts ${types.filter((t) => t !== prim).join(", ") || "other forms"})` };
    }
    n = { ...merged, ...n, ...(merged.type ? { type: merged.type } : {}), ...(merged.enum ? { enum: merged.enum } : {}) };
    if (merged.properties) n.properties = merged.properties;
    if (merged.description && n.description && n.description !== merged.description) n.description = `${n.description} (${merged.description})`;
    else if (merged.description) n.description = merged.description;
  }
  if (Array.isArray(n.allOf)) {
    const parts = n.allOf.map(simplifySchema);
    delete n.allOf;
    for (const p of parts) n = { ...p, ...n };
  }
  if (Array.isArray(n.type)) n.type = (n.type as string[]).find((t) => t !== "null") ?? "string";
  if (Array.isArray(n.items)) n.items = simplifySchema(n.items[0]) ?? {};
  else if (n.items) n.items = simplifySchema(n.items);
  if (n.additionalProperties && typeof n.additionalProperties === "object") {
    const hint = n.additionalProperties.type && !Array.isArray(n.additionalProperties.type) ? `values: ${n.additionalProperties.type}` : "";
    if (hint && n.properties === undefined) n.description = [n.description, `Free-form key/value object (${hint}).`].filter(Boolean).join(" ");
    delete n.additionalProperties;
  }
  for (const k of SCHEMA_DROP) delete n[k];
  if (n.properties) n.properties = Object.fromEntries(Object.entries(n.properties).map(([k, v]) => [k, simplifySchema(v)]));
  return n;
}

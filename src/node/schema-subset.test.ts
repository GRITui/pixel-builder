import { describe, expect, it } from "vitest";
import { TOOLS, mcpInputSchema } from "./tools";

/** Constructs that Gemini / Qwen / many local-model function-calling layers reject. */
export function schemaViolations(node: unknown, path: string, out: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((x, i) => schemaViolations(x, `${path}[${i}]`, out));
  else if (node && typeof node === "object") {
    const n = node as Record<string, unknown>;
    for (const k of ["oneOf", "anyOf", "allOf", "not", "$ref", "$defs", "definitions", "patternProperties", "propertyNames", "if", "then", "else"]) if (k in n) out.push(`${path}.${k}`);
    if (Array.isArray(n.type)) out.push(`${path}.type is an array`);
    if (Array.isArray(n.items)) out.push(`${path}.items is a tuple`);
    if (n.additionalProperties && typeof n.additionalProperties === "object") out.push(`${path}.additionalProperties is a schema`);
    for (const [k, v] of Object.entries(n)) schemaViolations(v, `${path}.${k}`, out);
  }
  return out;
}

describe("tool input schemas stay in the portable JSON-schema subset", () => {
  it("has no oneOf/anyOf/allOf/$ref/tuples/type arrays/additionalProperties schemas", () => {
    const all = TOOLS.flatMap((t) => schemaViolations(mcpInputSchema(t), t.name));
    expect(all).toEqual([]);
  });
  it("every schema is a plain object schema", () => {
    for (const t of TOOLS) expect(mcpInputSchema(t).type).toBe("object");
  });
});

// Tool registry: every capability is one ToolDef; MCP and CLI are adapters over this list.
// Adding a tool is one line in tools.ts:  registerTool({ name, title, description, shape, run })
import { z } from "zod";
import { coerceInput, simplifySchema, type JsonSchema } from "./coerce";

export class ToolError extends Error {}

export interface ToolImage { png: Buffer; label: string }
export interface ToolResult {
  /** Compact JSON-able result (paths, sizes, notes). */
  data: Record<string, unknown>;
  /** Images shown to multimodal hosts (MCP image blocks). */
  images?: ToolImage[];
}
export interface ToolContext {
  /** Default output folder when a tool is not given out_dir. */
  outDir: string;
}
export interface ToolDef<S extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  shape: S;
  /** CLI: the input that may be given as a bare first argument. */
  positional?: string;
  readOnly?: boolean;
  run(ctx: ToolContext, input: z.infer<z.ZodObject<S>>): Promise<ToolResult>;
}

export const TOOLS: ToolDef[] = [];

export function registerTool<S extends z.ZodRawShape>(def: ToolDef<S>): ToolDef<S> {
  if (TOOLS.some((t) => t.name === def.name)) throw new Error(`duplicate tool ${def.name}`);
  TOOLS.push(def as unknown as ToolDef);
  return def;
}

export const findTool = (name: string): ToolDef | undefined => TOOLS.find((t) => t.name === name || t.name === name.replace(/-/g, "_"));

export function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export function nearest(input: string, candidates: readonly string[], max = 3): string[] {
  const q = input.toLowerCase();
  return candidates
    .map((c) => ({ c, d: c.toLowerCase().includes(q) || q.includes(c.toLowerCase()) ? 0 : levenshtein(q, c.toLowerCase()) }))
    .filter((x) => x.d <= Math.max(1, Math.floor(q.length / 3)))
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((x) => x.c);
}

export function inputJsonSchema(tool: ToolDef): JsonSchema & { properties?: Record<string, any>; required?: string[] } {
  return z.toJSONSchema(z.object(tool.shape), { io: "input", unrepresentable: "any" }) as any;
}
export function mcpInputSchema(tool: ToolDef): { type: "object"; properties?: Record<string, any>; required?: string[] } {
  return simplifySchema(z.toJSONSchema(z.object(tool.shape), { io: "input", unrepresentable: "any", target: "draft-7" }));
}

/** Coerce then validate; errors name the field and the valid values. */
export function parseInput(tool: ToolDef, raw: unknown, warnings: string[] = []): any {
  const input = coerceInput(inputJsonSchema(tool), raw, warnings);
  const r = z.object(tool.shape).strict().safeParse(input);
  if (r.success) return r.data;
  const lines = r.error.issues.map((i) => {
    const where = i.path.length ? i.path.map(String).join(".") : "(input)";
    const got = i.path.reduce<any>((o, k) => o?.[k as any], input);
    if (i.code === "invalid_value") {
      const values = ((i as { values?: unknown[] }).values ?? []).map(String);
      const near = typeof got === "string" ? nearest(got, values, 1) : [];
      return `${where}: must be one of ${values.join(", ")}; got ${JSON.stringify(got)}.${near.length ? ` Did you mean '${near[0]}'?` : ""}`;
    }
    if (i.code === "unrecognized_keys") return `unknown input ${(i as { keys: string[] }).keys.map((k) => `'${k}'`).join(", ")}; valid inputs: ${Object.keys(tool.shape).join(", ")}`;
    if (i.code === "invalid_type" && got === undefined) return `${where}: required`;
    return `${where}: ${i.message}`;
  });
  throw new ToolError(`Invalid input for ${tool.name}: ${lines.join("; ")}`);
}

export async function callTool(ctx: ToolContext, name: string, raw: unknown): Promise<ToolResult & { warnings: string[] }> {
  const tool = findTool(name);
  if (!tool) {
    const near = nearest(name, TOOLS.map((t) => t.name), 2);
    throw new ToolError(`Unknown tool '${name}'.${near.length ? ` Did you mean ${near.join(" or ")}?` : ""} Tools: ${TOOLS.map((t) => t.name).join(", ")}`);
  }
  const warnings: string[] = [];
  const input = parseInput(tool, raw, warnings);
  const r = await tool.run(ctx, input);
  return { ...r, warnings };
}

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { coerceInput, coerceValue, normKey, simplifySchema } from "./coerce";
import { TOOL_EXAMPLES } from "./examples";
import { createMcpServer } from "./mcp";
import { CORE_TOOLS, TOOLS, callTool, callToolAsync, inputJsonSchema, mcpInputSchema, parseInput, resolveProfile, toolsForProfile } from "./tools";
import { Workspace } from "./workspace";

let dir: string;
let ws: Workspace;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pb-robust-"));
  ws = new Workspace(join(dir, "ws"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const gen = (input: unknown) => callTool(ws, "generate_asset", input).data as any;
const tool = (name: string) => TOOLS.find((t) => t.name === name)!;

describe("coerceValue", () => {
  const w: string[] = [];
  it("numeric strings become numbers / integers", () => {
    expect(coerceValue("12", { type: "number" }, "x", w)).toBe(12);
    expect(coerceValue(" 3.5 ", { type: "number" }, "x", w)).toBe(3.5);
    expect(coerceValue("7", { type: "integer" }, "x", w)).toBe(7);
    expect(coerceValue("7.0", { type: "integer" }, "x", w)).toBe(7);
    expect(coerceValue("abc", { type: "number" }, "x", w)).toBe("abc");
    expect(coerceValue("", { type: "number" }, "x", w)).toBe("");
  });
  it("booleans from true/false strings", () => {
    expect(coerceValue("true", { type: "boolean" }, "x", w)).toBe(true);
    expect(coerceValue("False", { type: "boolean" }, "x", w)).toBe(false);
    expect(coerceValue("maybe", { type: "boolean" }, "x", w)).toBe("maybe");
  });
  it("JSON strings become arrays and objects", () => {
    expect(coerceValue('["a","b"]', { type: "array", items: { type: "string" } }, "x", w)).toEqual(["a", "b"]);
    expect(coerceValue("a, b", { type: "array", items: { type: "string" } }, "x", w)).toEqual(["a", "b"]);
    expect(coerceValue('{"kind":"oak"}', { type: "object" }, "x", w)).toEqual({ kind: "oak" });
    expect(coerceValue("kind=oak,n=3", { type: "object" }, "x", w)).toEqual({ kind: "oak", n: 3 });
  });
  it("enums ignore case, underscores, dashes and spaces", () => {
    const s = { type: "string", enum: ["dead-tree", "oak"] };
    expect(coerceValue("Dead Tree", s, "x", w)).toBe("dead-tree");
    expect(coerceValue("DEAD_TREE", s, "x", w)).toBe("dead-tree");
    expect(coerceValue("pine", s, "x", w)).toBe("pine");
    expect(normKey("A b_C-d")).toBe("abcd");
  });
  it("a flat string[] frames value becomes one frame", () => {
    const frames = { type: "array", items: { type: "array", items: { type: "string" } } };
    const warnings: string[] = [];
    expect(coerceValue(["..", "aa"], frames, "frames", warnings)).toEqual([["..", "aa"]]);
    expect(warnings.join()).toMatch(/wrapped/);
    expect(coerceValue([["..", "aa"]], frames, "frames", [])).toEqual([["..", "aa"]]);
    expect(coerceValue('[["..","aa"]]', frames, "frames", [])).toEqual([["..", "aa"]]);
  });
  it("anyOf picks the branch that fits", () => {
    const s = { anyOf: [{ type: "string" }, { type: "integer" }] };
    expect(coerceValue(3, s, "x", [])).toBe(3);
    expect(coerceValue("name", s, "x", [])).toBe("name");
  });
});

describe("coerceInput", () => {
  const schema = inputJsonSchema(tool("generate_asset")) as any;
  it("renames case / separator variants and warns on unknown keys", () => {
    const w: string[] = [];
    const out = coerceInput(schema, { generator: "environment", kitId: "x", Seed: "5", bogus: 1, name: null }, w) as any;
    expect(out).toEqual({ generator: "environment", kit_id: "x", seed: 5 });
    expect(w.join("\n")).toMatch(/'kitId' read as 'kit_id'/);
    expect(w.join("\n")).toMatch(/ignored unknown input 'bogus'; valid inputs: generator, params/);
  });
  it("accepts the whole input as a JSON string", () => {
    expect(coerceInput(schema, '{"generator":"environment"}', [])).toEqual({ generator: "environment" });
  });
});

describe("end to end through the tool layer", () => {
  it("generate_asset accepts strings for seed/save and params as a JSON string", () => {
    const a = gen({ generator: "environment", params: '{"kind":"oak"}', seed: "42", save: "false", match: "Both" });
    expect(a.saved).toBe(false);
    expect(a.asset.source.seed).toBe(42);
    expect(a.asset.source.params.kind).toBe("oak");
    expect(a.warnings).toBeUndefined();
  });
  it("same pixels as the canonical call", () => {
    const x = gen({ generator: "environment", params: { kind: "oak" }, seed: 42, save: false });
    const y = gen({ generator: "Environment", params: { Kind: "OAK" }, seed: "42", save: "false" });
    expect(y.asset.source.params).toEqual(x.asset.source.params);
  });
  it("looks generators up by id or display name", () => {
    const g = callTool(ws, "list_generators", {}).data as any;
    const first = g.generators[0];
    const byLabel = gen({ generator: first.label.toUpperCase(), seed: 1, save: false });
    expect(byLabel.asset.source.generator).toBe(first.id);
  });
  it("looks kits up by name as well as id", () => {
    const kits = (callTool(ws, "list_kits", {}).data as any).kits;
    const k = kits[0];
    expect((callTool(ws, "set_active_kit", { kit_id: k.name.toUpperCase() }).data as any).kit.id).toBe(k.id);
  });
  it("paint_asset accepts flat frames, string sizes and a JSON string", () => {
    const c = (callTool(ws, "get_style_guide", {}).data as any).legend_entries[1].char as string;
    const rows = ["....", `.${c}${c}.`, `.${c}${c}.`, "...."];
    const a = callTool(ws, "paint_asset", { name: "blob", category: "Object", width: "4", height: "4", frames: rows }).data as any;
    expect(a.asset.width).toBe(4);
    const b = callTool(ws, "paint_asset", { name: "blob2", category: "object", width: 4, height: 4, frames: JSON.stringify([rows]) }).data as any;
    expect(b.asset.height).toBe(4);
  });
  it("unknown generator params are warnings, not errors", () => {
    const r = callTool(ws, "generate_asset", { generator: "environment", params: { knd: "oak", kind: "pine" }, save: false });
    expect((r.data as any).warnings.join()).toMatch(/no param 'knd'/);
    expect((r.data as any).asset.source.params.kind).toBe("pine");
  });
  it("warnings are appended to text results too", () => {
    const r = callTool(ws, "get_style_guide", { nonsense: 1 });
    expect(r.text).toMatch(/warnings:\n- ignored unknown input 'nonsense'/);
  });
  it("async tools get warnings too", async () => {
    const r = await callToolAsync(ws, "list_kits", { zzz: 1 });
    expect((r.data as any).warnings[0]).toMatch(/zzz/);
  });
});

describe("errors that teach", () => {
  const msg = (name: string, input: unknown) => {
    try {
      parseInput(tool(name), input);
    } catch (e) {
      return (e as Error).message;
    }
    return "";
  };
  it("names the field, lists valid values and shows an example", () => {
    const m = msg("list_generators", { category: "chracter" });
    expect(m).toMatch(/category: must be one of character, building, environment/);
    expect(m).toMatch(/Did you mean 'character'\?/);
    expect(m).toMatch(/Example: list_generators \{/);
  });
  it("reports missing required fields with the field description", () => {
    const m = msg("generate_asset", {});
    expect(m).toMatch(/generator: required \(string\) \(Generator id/);
    expect(m).toMatch(/Example: generate_asset \{"generator":"environment"/);
  });
  it("reports wrong types with the received value", () => {
    expect(msg("generate_asset", { generator: "environment", seed: "abc" })).toMatch(/seed: expected number, got "abc"/);
    expect(msg("get_style_guide", { materials: ["wood", "unobtainium"] })).toMatch(/materials\.1: must be one of .*wood/);
  });
  it("unknown generator hints at generator + kind", () => {
    expect(() => callTool(ws, "generate_asset", { generator: "oak" })).toThrow(/Did you mean 'environment' with params \{"kind":"oak"\}/);
  });
  it("invalid generator param value lists the options", () => {
    expect(() => callTool(ws, "generate_asset", { generator: "environment", params: { kind: "tre" } })).toThrow(/must be one of/);
  });
});

describe("tool descriptions and examples", () => {
  it("every tool has an example and its description ends with it", () => {
    for (const t of TOOLS) {
      expect(TOOL_EXAMPLES[t.name], t.name).toBeTruthy();
      const last = t.description.split("\n").pop()!;
      expect(last.startsWith(`Example: ${t.name} {`), t.name).toBe(true);
      expect(() => JSON.parse(last.slice(`Example: ${t.name} `.length)), t.name).not.toThrow();
    }
  });
  it("every example passes input validation", () => {
    for (const t of TOOLS) expect(() => parseInput(t, TOOL_EXAMPLES[t.name]), t.name).not.toThrow();
  });
});

describe("tool profiles", () => {
  it("core is the documented subset, all is everything", () => {
    expect(toolsForProfile("core").map((t) => t.name).sort()).toEqual([...CORE_TOOLS].sort());
    expect(CORE_TOOLS).toHaveLength(12);
    expect(toolsForProfile("all")).toEqual(TOOLS);
    expect(toolsForProfile()).toEqual(TOOLS);
  });
  it("resolves flag, then env, then all", () => {
    const old = process.env.PIXEL_BUILDER_TOOLS;
    try {
      delete process.env.PIXEL_BUILDER_TOOLS;
      expect(resolveProfile()).toBe("all");
      process.env.PIXEL_BUILDER_TOOLS = "CORE";
      expect(resolveProfile()).toBe("core");
      expect(resolveProfile("all")).toBe("all");
      expect(() => resolveProfile("tiny")).toThrow(/Unknown tool profile 'tiny'.*core.*all/);
    } finally {
      if (old === undefined) delete process.env.PIXEL_BUILDER_TOOLS;
      else process.env.PIXEL_BUILDER_TOOLS = old;
    }
  });
  async function connect(profile?: "core" | "all") {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer(ws, { tools: profile }).connect(b);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(a);
    return client;
  }
  it("mcp lists only the core tools under --tools core and rejects the rest", async () => {
    const client = await connect("core");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...CORE_TOOLS].sort());
    await expect(client.callTool({ name: "delete_asset", arguments: { id: "x" } })).rejects.toThrow(/not found/);
  });
  it("mcp lists everything by default", async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools).toHaveLength(TOOLS.length);
  });
});

describe("MCP robustness", () => {
  it("coerces sloppy arguments (the SDK must not reject them first)", async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer(ws).connect(b);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(a);
    const r = await client.callTool({ name: "generate_asset", arguments: { generator: "Environment", seed: "7", save: "true", params: '{"kind":"Pine"}', extra: 1 } });
    const content = r.content as { type: string; text?: string }[];
    expect(r.isError).toBeFalsy();
    const d = JSON.parse(content[0].text!);
    expect(d.asset.source.seed).toBe(7);
    expect(d.warnings[0]).toMatch(/extra/);
    expect(content.some((c) => c.type === "image")).toBe(true);
  });
  it("puts the saved preview path in the text next to the image", async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer(ws).connect(b);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(a);
    const r = await client.callTool({ name: "generate_asset", arguments: { generator: "environment", seed: 1 } });
    const d = JSON.parse((r.content as { text: string }[])[0].text);
    expect(d.previews).toHaveLength(1);
    expect(existsSync(d.previews[0])).toBe(true);
    expect(d.previews[0]).toContain(".previews");
  });
  it("teaching errors come back as isError text", async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await createMcpServer(ws).connect(b);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(a);
    const r = await client.callTool({ name: "list_generators", arguments: { category: "nope" } });
    expect(r.isError).toBe(true);
    expect((r.content as { text: string }[])[0].text).toMatch(/must be one of.*Example: list_generators/);
  });
});

describe("simplifySchema", () => {
  it("rewrites unions, tuples, type arrays and records", () => {
    const out = simplifySchema({
      type: "object",
      properties: {
        a: { anyOf: [{ type: "string" }, { type: "number" }] },
        b: { anyOf: [{ type: "number", const: 4 }, { type: "number", const: 8 }] },
        c: { type: "array", items: [{ type: "number" }, { type: "number" }] },
        d: { type: ["string", "null"] },
        e: { type: "object", propertyNames: { type: "string" }, additionalProperties: { type: "string" } },
      },
    });
    expect(out.properties.a.type).toBe("string");
    expect(out.properties.b).toMatchObject({ type: "number", enum: [4, 8] });
    expect(out.properties.c.items).toEqual({ type: "number" });
    expect(out.properties.d.type).toBe("string");
    expect(out.properties.e.additionalProperties).toBeUndefined();
    expect(out.properties.e.propertyNames).toBeUndefined();
  });
  it("mcp schemas keep property names and required lists", () => {
    const s = mcpInputSchema(tool("generate_asset"));
    expect(s.required).toEqual(["generator"]);
    expect(Object.keys(s.properties!)).toContain("params");
  });
});

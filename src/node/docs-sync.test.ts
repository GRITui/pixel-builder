import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOOLS, inputJsonSchema } from "./tools";

/**
 * Docs are a contract, not prose (AGENTS.md: a tool change updates tools.ts,
 * SKILL.md + its copy, docs/integrations.md and llms.txt together). These tests
 * fail when the prose drifts from the exported tools, which is how "16 tools"
 * survived in the docs after the rig/round of tools landed.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const DOCS: Record<string, string> = {
  "README.md": join(REPO, "README.md"),
  "SKILL.md": join(REPO, "skills", "pixel-builder", "SKILL.md"),
  "SKILL.md (.claude copy)": join(REPO, ".claude", "skills", "pixel-builder", "SKILL.md"),
  "llms.txt": join(REPO, "llms.txt"),
  "docs/integrations.md": join(REPO, "docs", "integrations.md"),
};

const read = (name: string) => readFileSync(DOCS[name], "utf8");
const TOOL_NAMES = TOOLS.map((t) => t.name);

describe("docs stay in sync with the exported tools", () => {
  it("every tool in code is named in the docs that claim to list the tools", () => {
    // SKILL.md, llms.txt and integrations.md are the exhaustive tool listings.
    // README deliberately shows a representative handful plus a link, so it is
    // not held to the full list (it does get the count check below).
    const listing = ["SKILL.md", "SKILL.md (.claude copy)", "llms.txt", "docs/integrations.md"];
    for (const doc of listing) {
      const text = read(doc);
      const missing = TOOL_NAMES.filter((n) => !text.includes(n));
      expect(missing, `${doc} does not mention: ${missing.join(", ")}`).toEqual([]);
    }
  });

  it("the two SKILL.md copies are identical", () => {
    expect(read("SKILL.md")).toBe(read("SKILL.md (.claude copy)"));
  });

  it("no doc hard-codes a stale tool count", () => {
    // Only the claim "the same N tools" / "all N tools" / "the N tools" is a
    // count. Match that phrasing so unrelated numbers (e.g. "1 tool error",
    // an exit code) are not mistaken for a tool count.
    for (const doc of Object.keys(DOCS)) {
      const text = read(doc);
      const counts = [...text.matchAll(/\b(?:same|all|the)\s+(\d+)\s+tools?\b/g)].map((m) => Number(m[1]));
      for (const n of counts) {
        expect(
          n === TOOL_NAMES.length,
          `${doc} says "${n} tools" but ${TOOL_NAMES.length} tools are exported. Update the doc in the same commit as the tool change.`,
        ).toBe(true);
      }
    }
  });

  it("docs do not advertise a tool that does not exist", () => {
    // Backticked snake_case names in the tool tables must be real tools or
    // documented input params. Allow the known param/prompt names.
    const NOT_TOOLS = new Set([
      "asset_pack", "base_kit_id", "hair_style", "kit_id", "replace_id", "row_names",
      "accent_mat", "lit_windows", "out_dir", "roof_style", "bearer_token_env_var",
      "connect_timeout", "context_servers", "http_headers", "mcp_servers",
      // edit_region input params
      "all_frames", "attachment_name",
    ]);
    const known = new Set([...TOOL_NAMES, ...NOT_TOOLS]);
    for (const doc of ["SKILL.md", "SKILL.md (.claude copy)"]) {
      const text = read(doc);
      const names = new Set([...text.matchAll(/`([a-z][a-z0-9]*_[a-z0-9_]+)`/g)].map((m) => m[1]));
      const unknown = [...names].filter((n) => !known.has(n));
      expect(unknown, `${doc} names unknown tools/params: ${unknown.join(", ")}`).toEqual([]);
    }
  });

  it("README feature counts match the generators", async () => {
    const { BIOMES } = await import("../core/generators/map");
    const { GENERATORS } = await import("../core/generators");
    const objectKinds = (GENERATORS as any[]).find((g) => g.id === "object")!.params.find((p: any) => p.key === "kind").options.length;

    const readme = read("README.md");
    const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
    expect(readme, `README biome count should be ${BIOMES.length}`).toMatch(
      new RegExp(`(${BIOMES.length}|${WORDS[BIOMES.length]}) biomes`),
    );
    expect(readme, `README object count should be ${objectKinds}`).toMatch(
      new RegExp(`(${objectKinds}|${WORDS[objectKinds]}) props and items`),
    );
  });

  it("documents every export format the code accepts", () => {
    // export_asset's enum is the contract; a new format must reach the docs.
    // inputJsonSchema is the same public helper the MCP server publishes.
    const schema = inputJsonSchema(TOOLS.find((t) => t.name === "export_asset")!) as any;
    const formats: string[] = (schema.properties?.format?.enum ?? []) as string[];
    expect(formats.length, "could not read export_asset format enum from the schema").toBeGreaterThan(1);
    for (const doc of ["SKILL.md", "SKILL.md (.claude copy)", "llms.txt"]) {
      const text = read(doc);
      const missing = formats.filter((f) => !text.includes(f));
      expect(missing, `${doc} omits export formats: ${missing.join(", ")}`).toEqual([]);
    }
  });
});
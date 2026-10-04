import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "./cli";
import { TOOLS } from "./tools";

let dir: string;
let ws: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pb-cli-"));
  ws = join(dir, "ws");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function run(...argv: string[]): Promise<{ code: number; out: string; err: string; json: any }> {
  let out = "", err = "";
  const code = await main(argv, { out: (t) => (out += t + "\n"), err: (t) => (err += t + "\n") });
  let json: unknown;
  try {
    json = JSON.parse(out);
  } catch {
    /* human output */
  }
  return { code, out, err, json };
}
const cli = (...argv: string[]) => run("--workspace", ws, ...argv);

describe("cli help", () => {
  it("lists every tool as a kebab-case command plus mcp", async () => {
    const r = await run("--help");
    expect(r.code).toBe(0);
    for (const t of TOOLS) expect(r.out).toContain(t.name.replace(/_/g, "-"));
    expect(r.out).toMatch(/\bmcp\b/);
    expect(r.out).toContain("--json");
    expect(r.out).toContain("--workspace");
    expect(r.out).toContain("ui/");
    expect((await run()).out).toBe(r.out); // no args = help
  });

  it("documents each command's options from its schema", async () => {
    const r = await run("generate-asset", "--help");
    expect(r.out).toContain("Usage: pixel-builder generate-asset <generator>");
    expect(r.out).toContain("--kit-id");
    expect(r.out).toContain("--no-save");
    expect(r.out).toContain("--generator <text>");
    expect(r.out).toContain("(required)");
    expect((await run("help", "paint-asset")).out).toContain("--frames <json|@file>");
  });

  it("says UI exports land in ui/ in export-asset help", async () => {
    const r = await run("export-asset", "--help");
    expect(r.out).toMatch(/ui\/ for UI assets/);
    expect(r.out).toMatch(/not uis\//);
  });

  it("documents mcp, tunnel hosts and the bearer token", async () => {
    const r = await run("mcp", "--help");
    expect(r.out).toContain("--http");
    expect(r.out).toContain("--allowed-host");
    expect(r.out).toContain("PIXEL_BUILDER_ALLOWED_HOSTS");
    expect(r.out).toContain("--token");
    expect(r.out).toContain("PIXEL_BUILDER_TOKEN");
  });

  it("prints the version", async () => {
    expect((await run("--version")).out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("cli commands", () => {
  it("generate-asset --json returns machine-readable output with saved preview paths", async () => {
    const r = await cli("generate-asset", "environment", "--params", "kind=oak", "--seed", "42", "--name", "Oak Tree", "--json");
    expect(r.code).toBe(0);
    expect(r.json.ok).toBe(true);
    expect(r.json.asset.name).toBe("Oak Tree");
    expect(r.json.asset.source).toMatchObject({ generator: "environment", seed: 42, params: { kind: "oak" } });
    expect(existsSync(r.json.asset.files[0])).toBe(true);
    expect(r.json.asset.files[0]).toBe(join(ws, "environments", "oak-tree.png"));
    expect(r.json.previews).toHaveLength(1);
    expect(readFileSync(r.json.previews[0]).subarray(1, 4).toString()).toBe("PNG");
  });

  it("honours the workspace env var and a --workspace flag after the command", async () => {
    const saved = process.env.PIXEL_BUILDER_WORKSPACE;
    process.env.PIXEL_BUILDER_WORKSPACE = join(dir, "env-ws");
    try {
      const r = await run("generate-asset", "object", "--json");
      expect(r.json.asset.files[0].startsWith(join(dir, "env-ws"))).toBe(true);
      const r2 = await run("generate-asset", "object", "--json", "--workspace", ws);
      expect(r2.json.asset.files[0].startsWith(ws)).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.PIXEL_BUILDER_WORKSPACE;
      else process.env.PIXEL_BUILDER_WORKSPACE = saved;
    }
  });

  it("parses booleans, numbers, arrays and @file JSON", async () => {
    const r = await cli("generate-variations", "environment", "--count=3", "--vary", "params", "--json");
    expect(r.json.variations).toHaveLength(3);
    const noSave = await cli("generate-asset", "object", "--no-save", "--json");
    expect(noSave.json.saved).toBe(false);
    expect(existsSync(ws)).toBe(true); // previews dir only
    expect((await cli("list-assets", "--json")).json.count).toBe(0);

    const frames = join(dir, "gem.json");
    writeFileSync(frames, JSON.stringify([["..tt..", ".tsst.", ".tssr.", "..rr.."]]));
    const painted = await cli("paint-asset", "--name", "Gem", "--category", "object", "--width", "6", "--height", "4", "--frames", `@${frames}`, "--json");
    expect(painted.json.asset).toMatchObject({ name: "Gem", width: 6, height: 4 });
    const edited = await cli("edit-asset", "Gem", "--pixels", '[{"x":2,"y":1,"char":"j"}]', "--tags", "a,b", "--json");
    expect(edited.json.asset.tags).toEqual(["a", "b"]);
    const mats = await cli("get-style-guide", "--materials", "wood,stone", "--json");
    expect(mats.json.legend_entries.every((e: { material: string }) => ["wood", "stone"].includes(e.material))).toBe(true);
    const viaInput = await cli("get-asset", "--input", '{"id":"Gem","include_pixels":true}', "--json");
    expect(viaInput.json.pixels[0].frames[0][1][2]).toBe("j");
    const kit = await cli("create-kit", "Noir", "--changes", '{"outline":"black","sizes":{"object":24}}', "--json");
    expect(kit.json.kit).toMatchObject({ name: "Noir", outline: "black" });
  });

  it("prints human-readable output without --json", async () => {
    await cli("generate-asset", "building", "--name", "Inn");
    const r = await cli("list-assets");
    expect(r.out).toMatch(/1 asset\(s\)/);
    expect(r.out).toMatch(/Inn \[asset-.*\] building \d+x\d+/);
    const gens = await cli("list-generators");
    expect(gens.out).toMatch(/environment \(environment\)/);
    expect(gens.out).toMatch(/kind: oak \|/);
  });

  it("uses exit codes: 0 ok, 1 tool error, 2 usage error; errors are JSON with --json", async () => {
    const bad = await cli("generate-asset", "enviroment", "--json");
    expect(bad.code).toBe(1);
    expect(bad.json).toMatchObject({ ok: false });
    expect(bad.json.error).toMatch(/did you mean|Did you mean/);
    const human = await cli("get-asset", "nope");
    expect(human.code).toBe(1);
    expect(human.err).toMatch(/^error: No asset 'nope'/);
    expect(human.out).toBe("");

    expect((await cli("generate-assets")).err).toMatch(/Did you mean generate-asset/);
    expect((await cli("generate-assets")).code).toBe(2);
    const opt = await cli("generate-asset", "object", "--seeed", "1");
    expect(opt.code).toBe(2);
    expect(opt.err).toMatch(/Unknown option --seeed.*--seed/);
    expect((await cli("generate-asset", "a", "b")).code).toBe(2);
    expect((await cli("list-kits", "extra")).err).toMatch(/takes no positional/);
    expect((await cli("generate-variations", "object", "--count", "many")).err).toMatch(/expects a number/);
    expect((await cli("paint-asset", "--frames", "[oops")).err).toMatch(/expects JSON/);
    expect((await cli("generate-variations", "object", "--count", "99", "--json")).json.error).toMatch(/count/);
  });
});

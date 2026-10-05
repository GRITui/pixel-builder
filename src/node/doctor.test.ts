import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "./cli";
import { SETUP_CLIENTS, repoRoot, setupSnippet, setupWrite } from "./doctor";
import { TOOLS } from "./tools";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pb-doctor-test-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function run(...argv: string[]) {
  let out = "", err = "";
  const code = await main(argv, { out: (t) => (out += t + "\n"), err: (t) => (err += t + "\n") });
  return { code, out, err };
}

describe("doctor", () => {
  it("passes every check, including the real MCP stdio handshake, and never prints a key", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-secret-test-key";
    try {
      const r = await run("doctor", "--json", "--workspace", join(dir, "ws"));
      expect(r.out).not.toContain("sk-secret-test-key");
      const j = JSON.parse(r.out);
      expect(j.checks.map((c: { name: string }) => c.name)).toEqual(["node", "workspace", "tools", "generate", "mcp"]);
      expect(j.checks.filter((c: { ok: boolean }) => !c.ok)).toEqual([]);
      expect(j.checks.find((c: { name: string }) => c.name === "mcp").detail).toContain(`${TOOLS.length} tools`);
      expect(j.ai).toMatchObject({ provider: "anthropic", key_present: true, enabled: true });
      expect(r.code).toBe(0);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }
  }, 60000);

  it("fails with a fix hint and exit code 1 when the workspace is not writable", async () => {
    const file = join(dir, "afile");
    writeFileSync(file, "x");
    const r = await run("doctor", "--workspace", join(file, "sub"));
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/FAIL {2}workspace/);
    expect(r.out).toContain("fix:");
  }, 60000);
});

describe("setup", () => {
  const opts = { root: "/abs/pixel-builder", workspace: "/abs/game/pixel-assets" };

  it("prints a snippet for every client with absolute paths filled in", () => {
    for (const c of SETUP_CLIENTS) {
      const s = setupSnippet(c, opts).snippet;
      expect(s, c).toBeTruthy();
      if (c !== "http") {
        expect(s, c).toContain("/abs/pixel-builder/src/node/cli.ts");
        expect(s, c).toContain("/abs/game/pixel-assets");
      } else expect(s).toContain("http://127.0.0.1:8788/mcp");
    }
  });

  it("uses the right top-level key and shape per client", () => {
    const j = (c: Parameters<typeof setupSnippet>[0]) => JSON.parse(setupSnippet(c, opts).snippet);
    expect(j("qwen-code").mcpServers["pixel-builder"].command).toBe("node");
    expect(j("vscode").servers["pixel-builder"].type).toBe("stdio");
    expect(j("zed").context_servers["pixel-builder"].args).toContain("mcp");
    const oc = j("opencode");
    expect(oc.mcp["pixel-builder"]).toMatchObject({ type: "local", enabled: true });
    expect(oc.mcp["pixel-builder"].command[0]).toBe("node");
    expect(setupSnippet("codex", opts).snippet).toContain("[mcp_servers.pixel-builder]");
    expect(setupSnippet("goose", opts).snippet).toContain("cmd: node");
    expect(setupSnippet("continue", opts).snippet).toContain("schema: v1");
  });

  it("adds --tools core only when asked", () => {
    expect(setupSnippet("qwen-code", opts).snippet).not.toContain("core");
    const core = JSON.parse(setupSnippet("qwen-code", { ...opts, profile: "core" }).snippet);
    expect(core.mcpServers["pixel-builder"].args.slice(-3)).toEqual(["mcp", "--tools", "core"]);
  });

  it("--write merges into an existing file without dropping other servers", () => {
    mkdirSync(join(dir, ".qwen"));
    const f = join(dir, ".qwen", "settings.json");
    writeFileSync(f, JSON.stringify({ theme: "dark", mcpServers: { other: { command: "x" } } }));
    expect(setupWrite("qwen-code", opts, dir)).toBe(f);
    const doc = JSON.parse(readFileSync(f, "utf8"));
    expect(doc.theme).toBe("dark");
    expect(doc.mcpServers.other).toEqual({ command: "x" });
    expect(doc.mcpServers["pixel-builder"].env.PIXEL_BUILDER_WORKSPACE).toBe("/abs/game/pixel-assets");
    setupWrite("qwen-code", { ...opts, profile: "core" }, dir); // idempotent: replaces its own entry
    expect(Object.keys(JSON.parse(readFileSync(f, "utf8")).mcpServers).sort()).toEqual(["other", "pixel-builder"]);
  });

  it("--write creates the file and folder, refuses broken JSON and non-local clients", () => {
    setupWrite("cursor", opts, dir);
    expect(existsSync(join(dir, ".cursor", "mcp.json"))).toBe(true);
    writeFileSync(join(dir, ".mcp.json"), "{ nope");
    expect(() => setupWrite("claude-code", opts, dir)).toThrow(/not valid JSON/);
    expect(readFileSync(join(dir, ".mcp.json"), "utf8")).toBe("{ nope");
    expect(() => setupWrite("zed", opts, dir)).toThrow(/no project-local/);
  });

  it("the CLI command works end to end", async () => {
    const r = await run("setup", "qwen-code", "--tools", "core", "--workspace", join(dir, "ws"));
    expect(r.code).toBe(0);
    expect(r.out).toContain(join(dir, "ws"));
    expect(r.out).toContain('"core"');
    expect(r.out).toContain(repoRoot());
    const bad = await run("setup", "qwen");
    expect(bad.code).toBe(2);
    expect(bad.err).toContain("qwen-code");
  });
});

// CLI-only helpers (not MCP tools): `doctor` (self-check) and `setup <client>` (MCP config snippets).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, accessSync, constants } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { aiHealth } from "../../server/llm";
import { TOOLS, callToolAsync, savePreviews, toolsForProfile, type ToolProfile } from "./tools";
import { DEFAULT_WORKSPACE, Workspace } from "./workspace";

const here = fileURLToPath(import.meta.url);
/** Repo root: this file is src/node/doctor.ts or the bundled dist-node/cli.mjs. */
export const repoRoot = (file = here): string => resolve(dirname(file), basename(dirname(file)) === "node" ? "../.." : "..");

export interface Launch {
  command: string;
  args: string[];
}

/** How a client starts the stdio server: the bundled build with node, else the TypeScript source through the repo's tsx. */
export function launchFor(root = repoRoot(), profile: ToolProfile = "all"): Launch {
  const built = join(root, "dist-node", "cli.mjs");
  const tsx = join(root, "node_modules", "tsx", "dist", "cli.mjs");
  const base = existsSync(built) ? [built] : [tsx, join(root, "src", "node", "cli.ts")];
  return { command: "node", args: [...base, "mcp", ...(profile === "core" ? ["--tools", "core"] : [])] };
}

// ---------- doctor ----------

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: Check[];
  ai: { provider: string; model: string | null; vision_model: string | null; key_present: boolean; enabled: boolean };
}

export interface DoctorOptions {
  workspace?: string;
  env?: Record<string, string | undefined>;
  /** Command to spawn for the stdio handshake (default: this CLI's `mcp`). */
  launch?: Launch;
  nodeVersion?: string;
}

const isUrl = (s: string) => /^https?:\/\//i.test(s);

export async function runDoctor(opts: DoctorOptions = {}): Promise<DoctorReport> {
  const env = opts.env ?? process.env;
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string, fix?: string) => checks.push({ name, ok, detail, ...(ok ? {} : { fix }) });

  const nodeV = opts.nodeVersion ?? process.versions.node;
  const major = Number(nodeV.split(".")[0]);
  add("node", major >= 20, `Node ${nodeV}`, "Install Node 20 or newer from https://nodejs.org (or `nvm install 20`).");

  const wsDir = resolve(opts.workspace ?? env.PIXEL_BUILDER_WORKSPACE ?? DEFAULT_WORKSPACE);
  if (isUrl(opts.workspace ?? env.PIXEL_BUILDER_WORKSPACE ?? "")) {
    add("workspace", true, `remote workspace ${opts.workspace ?? env.PIXEL_BUILDER_WORKSPACE} (not checked)`);
  } else {
    try {
      let probe = wsDir;
      while (!existsSync(probe)) probe = dirname(probe); // the workspace is created on first use; its nearest existing parent must be writable
      if (!statSync(probe).isDirectory()) throw new Error(`${probe} is not a folder`);
      accessSync(probe, constants.W_OK);
      add("workspace", true, `${wsDir} is writable${existsSync(wsDir) ? "" : " (will be created)"}`);
    } catch (e) {
      add("workspace", false, `${wsDir}: ${(e as Error).message}`, "Pick a folder you can write to: --workspace <dir> or env PIXEL_BUILDER_WORKSPACE.");
    }
  }

  add("tools", TOOLS.length > 0, `${TOOLS.length} tools load (core profile: ${toolsForProfile("core").length})`, "Run `npm install`, then `npx tsc` to see what is broken.");

  const tmp = mkdtempSync(join(tmpdir(), "pb-doctor-"));
  try {
    const ws = new Workspace(join(tmp, "ws"));
    const r = await callToolAsync(ws, "generate_asset", { generator: "object", params: { kind: "chest" }, name: "doctor chest" });
    const previews = savePreviews(ws, r);
    const png = previews[0] ? readFileSync(previews[0]) : Buffer.alloc(0);
    const isPng = png.length > 8 && png.subarray(1, 4).toString() === "PNG";
    add("generate", isPng, isPng ? `generate_asset made a chest and wrote a ${png.length} byte preview PNG` : "generate_asset ran but no PNG preview was written", "Run `npm test -- src/node` and report the failure.");
  } catch (e) {
    add("generate", false, `generate_asset failed: ${(e as Error).message}`, "Run `npm install`, then `npx tsx src/node/cli.ts generate-asset object --params kind=chest` to see the error.");
  }

  const launch = opts.launch ?? (here.endsWith(".ts") ? { command: process.execPath, args: [join(repoRoot(), "node_modules", "tsx", "dist", "cli.mjs"), here.replace(/doctor\.ts$/, "cli.ts"), "mcp"] } : { command: process.execPath, args: [here, "mcp"] });
  const client = new Client({ name: "pixel-builder-doctor", version: "0" });
  try {
    const transport = new StdioClientTransport({ command: launch.command, args: launch.args, env: { ...(process.env as Record<string, string>), PIXEL_BUILDER_WORKSPACE: join(tmp, "mcp-ws") }, stderr: "ignore" });
    const work = (async () => {
      await client.connect(transport);
      return client.listTools();
    })();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error("timed out after 30s")), 30000)));
    const list = await Promise.race([work, timeout]).finally(() => clearTimeout(timer));
    add("mcp", list.tools.length === TOOLS.length, `MCP stdio handshake ok, tools/list returned ${list.tools.length} tools`, "The server started but listed a different tool count; rebuild (`npm run build:node`) or re-run from a clean checkout.");
  } catch (e) {
    add("mcp", false, `MCP stdio handshake failed: ${(e as Error).message}`, "Run `npx tsx src/node/cli.ts mcp` by hand; it should wait silently. Anything printed on stdout, or a crash, is the problem.");
  } finally {
    await client.close().catch(() => undefined);
    rmSync(tmp, { recursive: true, force: true });
  }

  const h = aiHealth(env);
  const provider = h.provider;
  const keyVar = provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY";
  return {
    ok: checks.every((c) => c.ok),
    checks,
    ai: { provider, model: h.model, vision_model: h.vision_model, key_present: !!env[keyVar], enabled: h.enabled },
  };
}

export function formatDoctor(r: DoctorReport): string {
  const lines = ["pixel-builder doctor", ""];
  for (const c of r.checks) {
    lines.push(`${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.detail}`);
    if (!c.ok && c.fix) lines.push(`      fix: ${c.fix}`);
  }
  const a = r.ai;
  lines.push("", "Web app AI (optional, the CLI and MCP server do not need it):", `  provider: ${a.provider}   model: ${a.model ?? "-"}   vision model: ${a.vision_model ?? "-"}   key set: ${a.key_present ? "yes" : "no"}   enabled: ${a.enabled ? "yes" : "no"}`);
  if (!a.enabled) lines.push(a.provider === "openai" ? "  to enable: AI_PROVIDER=openai OPENAI_API_KEY=... (see docs/deploy.md)" : "  to enable: set ANTHROPIC_API_KEY (or AI_PROVIDER=openai, see docs/deploy.md)");
  lines.push("", r.ok ? "All checks passed." : `${r.checks.filter((c) => !c.ok).length} check(s) failed.`);
  return lines.join("\n");
}

// ---------- setup ----------

export const SETUP_CLIENTS = ["claude-code", "claude-desktop", "cursor", "codex", "gemini-cli", "qwen-code", "opencode", "goose", "continue", "vscode", "windsurf", "cline", "zed", "http"] as const;
export type SetupClient = (typeof SETUP_CLIENTS)[number];

export interface SetupOptions {
  root?: string;
  workspace: string; // absolute
  profile?: ToolProfile;
  port?: number;
}

interface Target {
  /** Project-local file relative to cwd that `--write` may merge into. */
  file?: string;
  /** Where to paste it when it is not project-local. */
  where?: string;
  /** JSON key holding the server map. */
  key?: string;
  /** Build the server entry. */
  entry?: (l: Launch, o: SetupOptions) => unknown;
  extra?: Record<string, unknown>;
  /** Non-JSON snippet. */
  text?: (l: Launch, o: SetupOptions) => string;
  doc: string;
}

const stdioEntry = (l: Launch, o: SetupOptions) => ({ command: l.command, args: l.args, env: { PIXEL_BUILDER_WORKSPACE: o.workspace } });
const q = (s: string) => JSON.stringify(s);

const TARGETS: Record<SetupClient, Target> = {
  "claude-code": { file: ".mcp.json", key: "mcpServers", entry: (l, o) => ({ type: "stdio", ...stdioEntry(l, o) }), doc: "https://code.claude.com/docs/en/mcp" },
  "claude-desktop": { where: "macOS ~/Library/Application Support/Claude/claude_desktop_config.json, Windows %APPDATA%\\Claude\\claude_desktop_config.json (restart the app)", key: "mcpServers", entry: stdioEntry, doc: "https://modelcontextprotocol.io/quickstart/user" },
  cursor: { file: ".cursor/mcp.json", key: "mcpServers", entry: stdioEntry, doc: "https://cursor.com/docs/mcp" },
  codex: {
    where: "~/.codex/config.toml (or run: codex mcp add, see docs/integrations.md)",
    text: (l, o) => `[mcp_servers.pixel-builder]\ncommand = ${q(l.command)}\nargs = [${l.args.map(q).join(", ")}]\n\n[mcp_servers.pixel-builder.env]\nPIXEL_BUILDER_WORKSPACE = ${q(o.workspace)}`,
    doc: "https://developers.openai.com/codex/mcp",
  },
  "gemini-cli": { file: ".gemini/settings.json", key: "mcpServers", entry: stdioEntry, doc: "https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md" },
  "qwen-code": { file: ".qwen/settings.json", key: "mcpServers", entry: stdioEntry, doc: "https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/mcp.md" },
  opencode: {
    file: "opencode.json",
    key: "mcp",
    entry: (l, o) => ({ type: "local", command: [l.command, ...l.args], enabled: true, environment: { PIXEL_BUILDER_WORKSPACE: o.workspace } }),
    extra: { $schema: "https://opencode.ai/config.json" },
    doc: "https://opencode.ai/docs/mcp-servers/",
  },
  goose: {
    where: "~/.config/goose/config.yaml under `extensions:` (or run `goose configure`)",
    text: (l, o) => `extensions:\n  pixel-builder:\n    name: pixel-builder\n    type: stdio\n    cmd: ${l.command}\n    args: [${l.args.map(q).join(", ")}]\n    envs: { "PIXEL_BUILDER_WORKSPACE": ${q(o.workspace)} }\n    enabled: true\n    timeout: 300`,
    doc: "https://github.com/block/goose/blob/main/documentation/docs/getting-started/using-extensions.md",
  },
  continue: {
    where: ".continue/mcpServers/pixel-builder.yaml (Continue loads MCP servers in agent mode only)",
    text: (l, o) => `name: pixel-builder\nversion: 0.0.1\nschema: v1\nmcpServers:\n  - name: pixel-builder\n    type: stdio\n    command: ${l.command}\n    args:\n${l.args.map((a) => `      - ${q(a)}`).join("\n")}\n    env:\n      PIXEL_BUILDER_WORKSPACE: ${q(o.workspace)}`,
    doc: "https://docs.continue.dev/customize/deep-dives/mcp",
  },
  vscode: { file: ".vscode/mcp.json", key: "servers", entry: (l, o) => ({ type: "stdio", ...stdioEntry(l, o) }), doc: "https://code.visualstudio.com/docs/agents/reference/mcp-configuration" },
  windsurf: { where: "the file opened by Cascade -> ... -> Open MCP config file (~/.codeium/windsurf/mcp_config.json on older versions)", key: "mcpServers", entry: stdioEntry, doc: "https://docs.windsurf.com/windsurf/cascade/mcp" },
  cline: { where: "cline_mcp_settings.json (Cline panel -> MCP Servers -> Configure MCP Servers)", key: "mcpServers", entry: (l, o) => ({ ...stdioEntry(l, o), disabled: false, autoApprove: [] }), doc: "https://docs.cline.bot/mcp/configuring-mcp-servers" },
  zed: { where: "~/.config/zed/settings.json (or .zed/settings.json)", key: "context_servers", entry: stdioEntry, doc: "https://github.com/zed-industries/zed/blob/main/docs/src/ai/mcp.md" },
  http: { where: "any client that takes a URL; start the server first: node ... mcp --http (see docs/integrations.md section 12)", key: "mcpServers", doc: "docs/integrations.md" },
};

export interface SetupResult {
  client: SetupClient;
  snippet: string;
  doc: string;
  /** Project-local file that --write targets, if any. */
  file?: string;
  where?: string;
  note?: string;
}

function entryFor(client: SetupClient, o: SetupOptions): unknown {
  const t = TARGETS[client];
  const l = launchFor(o.root, o.profile);
  if (client === "http") return { url: `http://127.0.0.1:${o.port ?? 8788}/mcp` };
  return t.entry!(l, o);
}

export function setupSnippet(client: SetupClient, o: SetupOptions): SetupResult {
  const t = TARGETS[client];
  const l = launchFor(o.root, o.profile);
  const snippet = t.text ? t.text(l, o) : JSON.stringify({ ...t.extra, [t.key!]: { "pixel-builder": entryFor(client, o) } }, null, 2);
  const note = client === "http" ? `Start the server first: ${[l.command, ...l.args, "--http", "--port", String(o.port ?? 8788)].join(" ")}` : undefined;
  return { client, snippet, doc: t.doc, ...(t.file ? { file: t.file } : {}), ...(t.where ? { where: t.where } : {}), ...(note ? { note } : {}) };
}

/** Merge the pixel-builder server into a JSON config file, keeping everything else. Returns the file written. */
export function setupWrite(client: SetupClient, o: SetupOptions, cwd = process.cwd()): string {
  const t = TARGETS[client];
  if (!t.file || !t.key) throw new Error(`${client} has no project-local config file; paste the snippet where it says instead.`);
  const path = resolve(cwd, t.file);
  let doc: Record<string, any> = {};
  if (existsSync(path)) {
    try {
      doc = JSON.parse(readFileSync(path, "utf8"));
    } catch (e) {
      throw new Error(`${path} is not valid JSON (${(e as Error).message}); fix or remove it, nothing was changed.`);
    }
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) throw new Error(`${path} is not a JSON object; nothing was changed.`);
  }
  for (const [k, v] of Object.entries(t.extra ?? {})) if (!(k in doc)) doc[k] = v;
  const servers = doc[t.key] && typeof doc[t.key] === "object" ? doc[t.key] : {};
  servers["pixel-builder"] = entryFor(client, o);
  doc[t.key] = servers;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
  return path;
}

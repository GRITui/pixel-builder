// MCP adapter over the tool layer: stdio by default, `--http` for Streamable HTTP.
// stdio rule: stdout carries protocol messages only; everything else goes to stderr.
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { TOOLS, ToolError, callTool, type ToolDef, type ToolResult } from "./tools";
import { Workspace, serializeProjectCompact } from "./workspace";

export const VERSION = "0.1.0";
export const DEFAULT_HTTP_PORT = 8788;

const INSTRUCTIONS = [
  "Pixel Builder makes consistent pixel art (characters, buildings, environment, objects, UI, tile maps) from one style kit, and exports game-ready PNG / spritesheet / Tiled files into the workspace.",
  "Workflow: get_style_guide -> (optionally create_kit / update_kit to match the game's vibe) -> list_generators -> generate_variations to compare -> generate_asset with the chosen seed/params -> look at the preview image -> paint_asset / edit_asset only for what generators cannot make -> files are already exported (see `files`).",
  "After changing a kit, call rerender_assets so procedural assets stay consistent. Hand-painting uses the palette legend from get_style_guide.",
].join("\n");

export function toCallToolResult(r: ToolResult): CallToolResult {
  const text = r.text ?? JSON.stringify(r.data, null, 2);
  return {
    content: [
      { type: "text", text },
      ...(r.images ?? []).map((img) => ({ type: "image" as const, data: img.png.toString("base64"), mimeType: "image/png" })),
    ],
  };
}

function errorResult(e: unknown, tool: string): CallToolResult {
  if (!(e instanceof ToolError)) process.stderr.write(`[pixel-builder] ${tool} failed: ${(e as Error)?.stack ?? String(e)}\n`);
  return { isError: true, content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }] };
}

function register(server: McpServer, ws: Workspace, tool: ToolDef): void {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.shape,
      annotations: {
        title: tool.title,
        readOnlyHint: !!tool.readOnly,
        destructiveHint: !!tool.destructive,
        openWorldHint: false,
      },
    },
    async (args: unknown): Promise<CallToolResult> => {
      try {
        return toCallToolResult(callTool(ws, tool.name, args));
      } catch (e) {
        return errorResult(e, tool.name);
      }
    },
  );
}

export function assetPackPrompt(game: string, count: number): string {
  return [
    `Build a consistent starter asset pack of about ${count} assets for this game: ${game}`,
    "",
    "Follow these steps with the pixel-builder tools, looking at each preview image before moving on:",
    "1. Call get_style_guide and list_kits. If the active kit's vibe, palette, outline or sizes do not fit the game, call create_kit (base it on the closest kit; set paletteId, outline, lightDir, shadeSteps, dither, sizes and a one-sentence vibe) and then set_active_kit. Keep one kit for the whole pack.",
    "2. Call list_generators. Plan a balanced pack: a hero and 1-2 NPC/enemy characters, 2-3 buildings, ground tiles plus trees/rocks/bushes, a few objects/items (chest, key, potion, sign), a UI panel and button, and one small map. Name every asset descriptively (e.g. 'oak tree', 'inn', 'hero').",
    "3. For each planned asset call generate_variations (6 variations; vary='params' to explore, vary='seed' to polish), pick the best number, then call generate_asset with that variation's generator, seed and params and a good name. Reuse the same materials (e.g. the same roof and wood) across buildings and props so they belong together.",
    "4. Only for things no generator can make, read the legend from get_style_guide and call paint_asset, then fix details with edit_asset (use get_asset include_pixels to read the pixels back).",
    "5. Call list_assets to review the set. If something clashes, adjust the kit with update_kit and call rerender_assets so everything is regenerated consistently.",
    "6. Finish by listing the exported file paths (each asset's `files`) grouped by category, and note the kit settings used.",
  ].join("\n");
}

/** Build an MCP server bound to a workspace (no transport attached). */
export function createMcpServer(ws: Workspace): McpServer {
  const server = new McpServer({ name: "pixel-builder", version: VERSION }, { instructions: INSTRUCTIONS });
  for (const tool of TOOLS) register(server, ws, tool);

  server.registerResource(
    "project",
    "pixel-builder://project",
    { title: "Project file", description: "The workspace project (kits + assets) as pixel-builder/project JSON, the same format the web app imports and exports.", mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: serializeProjectCompact(ws.load()) }] }),
  );
  server.registerResource(
    "style-guide",
    "pixel-builder://style-guide",
    { title: "Style guide", description: "Style guide of the active kit: look settings, palette legend for painting and the painting rules.", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: callTool(ws, "get_style_guide", {}).text ?? "" }] }),
  );

  server.registerPrompt(
    "asset_pack",
    {
      title: "Build an asset pack",
      description: "Walk through building a consistent starter asset pack for a game: kit, generators, variations, hand-painting, export.",
      argsSchema: {
        game: z.string().describe("What the game is, e.g. 'cozy farming sim with a seaside village'."),
        count: z.string().optional().describe("Roughly how many assets (default 12)."),
      },
    },
    ({ game, count }) => {
      const n = Math.max(3, Math.min(60, Number.parseInt(count ?? "", 10) || 12));
      return { messages: [{ role: "user", content: { type: "text", text: assetPackPrompt(game, n) } }] };
    },
  );
  return server;
}

export async function startStdio(ws: Workspace): Promise<void> {
  const server = createMcpServer(ws);
  await server.connect(new StdioServerTransport());
  process.stderr.write(`[pixel-builder] MCP server on stdio (workspace ${ws.dir})\n`);
}

const MAX_BODY = 16 * 1024 * 1024;

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new Error("Request body too large");
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function jsonError(res: ServerResponse, status: number, message: string, code = -32000): void {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

/** Lower-cased hostname from a Host header value, a bare host, `host:port`, `[v6]:port` or a full URL. */
export function normalizeHost(value: string): string {
  let v = value.trim().toLowerCase();
  if (v.includes("://")) {
    try {
      return new URL(v).hostname.replace(/^\[|\]$/g, "");
    } catch {
      return v;
    }
  }
  if (v.startsWith("[")) return v.slice(1, v.indexOf("]") < 0 ? undefined : v.indexOf("]"));
  if ((v.match(/:/g) ?? []).length === 1) v = v.slice(0, v.indexOf(":"));
  return v;
}

/** Host list from a flag/env value: comma-separated, each entry normalised, empties dropped. */
export function parseHostList(...values: (string | undefined)[]): string[] {
  return [...new Set(values.flatMap((v) => (v ?? "").split(",")).map(normalizeHost).filter(Boolean))];
}

/** DNS-rebinding guard: Host (and Origin, when sent) must be loopback or explicitly allowed. */
function hostAllowed(req: IncomingMessage, allowed: ReadonlySet<string>): boolean {
  if (!allowed.has(normalizeHost(req.headers.host ?? ""))) return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (!allowed.has(new URL(origin).hostname.replace(/^\[|\]$/g, "").toLowerCase())) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Constant-time check of `Authorization: Bearer <token>`. */
function bearerOk(req: IncomingMessage, token: string): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
  if (!m) return false;
  const a = createHash("sha256").update(m[1].trim()).digest();
  const b = createHash("sha256").update(token).digest();
  return timingSafeEqual(a, b);
}

export interface HttpHandle {
  server: Server;
  url: string;
  close(): Promise<void>;
}

export interface HttpOptions {
  port?: number;
  /** Bind address. Default 127.0.0.1. */
  host?: string;
  /** Extra Host/Origin names to accept (tunnels, reverse proxies), on top of loopback. */
  allowedHosts?: string[];
  /** When set, every request must carry `Authorization: Bearer <token>`. */
  token?: string;
}

/**
 * Streamable HTTP transport at `/mcp` (stateless: one server per request, JSON responses).
 * Binds 127.0.0.1 and only accepts loopback Host/Origin headers by default. `allowedHosts` extends
 * that list (needed behind cloudflared/ngrok) and `token` adds bearer auth; use both when exposing it.
 */
export async function startHttp(ws: Workspace, opts: HttpOptions = {}): Promise<HttpHandle> {
  const host = opts.host ?? "127.0.0.1";
  const extra = parseHostList(...(opts.allowedHosts ?? []));
  const token = opts.token || undefined;
  const loopbackBind = LOOPBACK.has(normalizeHost(host));
  const allowed = new Set([...LOOPBACK, ...extra]);
  const guard = loopbackBind || extra.length > 0;
  if (!loopbackBind && !token) process.stderr.write(`[pixel-builder] WARNING: listening on ${host} without --token: anyone who can reach this port can create, edit and delete assets and write files in the workspace.\n`);
  else if (extra.length && !token) process.stderr.write(`[pixel-builder] WARNING: accepting requests for ${extra.join(", ")} without --token (PIXEL_BUILDER_TOKEN): anyone with that address can drive this server.\n`);
  const http = createServer(async (req, res) => {
    try {
      const path = (req.url ?? "/").split("?")[0];
      if (path !== "/mcp" && path !== "/") return jsonError(res, 404, "Not found. The MCP endpoint is /mcp.", -32601);
      if (guard && !hostAllowed(req, allowed)) return jsonError(res, 403, "Forbidden: Host/Origin not allowed. Start the server with --allowed-host <name> to accept it.");
      if (token && !bearerOk(req, token)) {
        res.setHeader("www-authenticate", 'Bearer realm="pixel-builder"');
        return jsonError(res, 401, "Unauthorized: send `Authorization: Bearer <token>`.");
      }
      if (req.method !== "POST") {
        res.setHeader("allow", "POST");
        return jsonError(res, 405, "Method not allowed: this server is stateless; POST JSON-RPC to /mcp.");
      }
      let body: unknown;
      try {
        body = await readBody(req);
      } catch (e) {
        return jsonError(res, 400, `Bad request: ${(e as Error).message}`, -32700);
      }
      const server = createMcpServer(ws);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      process.stderr.write(`[pixel-builder] http error: ${(e as Error)?.stack ?? String(e)}\n`);
      jsonError(res, 500, "Internal server error", -32603);
    }
  });
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(opts.port ?? DEFAULT_HTTP_PORT, host, () => resolve());
  });
  const addr = http.address();
  const port = typeof addr === "object" && addr ? addr.port : (opts.port ?? DEFAULT_HTTP_PORT);
  const url = `http://${host.includes(":") ? `[${host}]` : host}:${port}/mcp`;
  process.stderr.write(`[pixel-builder] MCP server (Streamable HTTP) at ${url} (workspace ${ws.dir})${token ? ", bearer token required" : ""}\n`);
  return { server: http, url, close: () => new Promise<void>((resolve) => http.close(() => resolve())) };
}

// MCP adapter over the registry: stdio by default, Streamable HTTP with --http (binds 127.0.0.1).
// stdio rule: stdout carries protocol messages only; logs go to stderr.
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { TOOLS, ToolError, callTool, mcpInputSchema, type ToolContext, type ToolResult } from "./registry";
import "./tools"; // registers the tools

export const VERSION = "0.2.0";
export const DEFAULT_HTTP_PORT = 8788;

const INSTRUCTIONS =
  "Pixel Builder turns realistic images into TRUE pixel art (one solid colour per pixel) at 8/16/32/64-bit era limits. Call `pixelize` with an image path or URL, look at the returned preview, then `validate` the native PNG. Files are written to out_dir; use the returned paths.";

export function toCallToolResult(r: ToolResult & { warnings?: string[] }): CallToolResult {
  const data = r.warnings?.length ? { ...r.data, warnings: r.warnings } : r.data;
  return {
    content: [
      { type: "text", text: JSON.stringify(data, null, 2) },
      ...(r.images ?? []).map((img) => ({ type: "image" as const, data: img.png.toString("base64"), mimeType: "image/png" })),
    ],
  };
}

/** tools/list + tools/call are served directly so input is coerced (numeric strings, "true", ...) before zod validates. */
export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: "pixel-builder", version: VERSION }, { instructions: INSTRUCTIONS });
  server.server.registerCapabilities({ tools: { listChanged: false } });
  server.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: mcpInputSchema(t) as { type: "object"; properties?: Record<string, object>; required?: string[] },
      annotations: { title: t.title, readOnlyHint: !!t.readOnly, destructiveHint: false, openWorldHint: false },
    })),
  }));
  server.server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const name = req.params.name;
    if (!TOOLS.some((t) => t.name === name)) throw new McpError(ErrorCode.InvalidParams, `Tool ${name} not found. Tools: ${TOOLS.map((t) => t.name).join(", ")}`);
    try {
      return toCallToolResult(await callTool(ctx, name, req.params.arguments));
    } catch (e) {
      if (!(e instanceof ToolError)) process.stderr.write(`[pixel-builder] ${name} failed: ${(e as Error)?.stack ?? String(e)}\n`);
      return { isError: true, content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }] };
    }
  });
  return server;
}

export async function startStdio(ctx: ToolContext): Promise<void> {
  await createMcpServer(ctx).connect(new StdioServerTransport());
  process.stderr.write(`[pixel-builder] MCP server on stdio (out ${ctx.outDir})\n`);
}

// ---------- HTTP ----------

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

export function normalizeHost(value: string): string {
  let v = value.trim().toLowerCase();
  if (v.includes("://")) {
    try { return new URL(v).hostname.replace(/^\[|\]$/g, ""); } catch { return v; }
  }
  if (v.startsWith("[")) return v.slice(1, v.indexOf("]") < 0 ? undefined : v.indexOf("]"));
  if ((v.match(/:/g) ?? []).length === 1) v = v.slice(0, v.indexOf(":"));
  return v;
}
export const parseHostList = (...values: (string | undefined)[]): string[] => [...new Set(values.flatMap((v) => (v ?? "").split(",")).map(normalizeHost).filter(Boolean))];

function hostAllowed(req: IncomingMessage, allowed: ReadonlySet<string>): boolean {
  if (!allowed.has(normalizeHost(req.headers.host ?? ""))) return false;
  const origin = req.headers.origin;
  if (origin) {
    try { if (!allowed.has(new URL(origin).hostname.replace(/^\[|\]$/g, "").toLowerCase())) return false; } catch { return false; }
  }
  return true;
}
function bearerOk(req: IncomingMessage, token: string): boolean {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "");
  return !!m && timingSafeEqual(createHash("sha256").update(m[1].trim()).digest(), createHash("sha256").update(token).digest());
}
function jsonError(res: ServerResponse, status: number, message: string, code = -32000): void {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}
async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 16 * 1024 * 1024) throw new Error("Request body too large");
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export interface HttpHandle { server: Server; url: string; close(): Promise<void> }
export interface HttpOptions { port?: number; host?: string; allowedHosts?: string[]; token?: string }

/** Stateless Streamable HTTP at /mcp. Loopback Host/Origin only unless allowedHosts is given; optional bearer token. */
export async function startHttp(ctx: ToolContext, opts: HttpOptions = {}): Promise<HttpHandle> {
  const host = opts.host ?? "127.0.0.1";
  const extra = parseHostList(...(opts.allowedHosts ?? []));
  const token = opts.token || undefined;
  const loopbackBind = LOOPBACK.has(normalizeHost(host));
  const allowed = new Set([...LOOPBACK, ...extra]);
  if (!loopbackBind && !token) process.stderr.write(`[pixel-builder] WARNING: listening on ${host} without --token: anyone who can reach this port can write files.\n`);
  const http = createServer(async (req, res) => {
    try {
      const path = (req.url ?? "/").split("?")[0];
      if (path !== "/mcp" && path !== "/") return jsonError(res, 404, "Not found. The MCP endpoint is /mcp.", -32601);
      if ((loopbackBind || extra.length) && !hostAllowed(req, allowed)) return jsonError(res, 403, "Forbidden: Host/Origin not allowed. Use --allowed-host <name>.");
      if (token && !bearerOk(req, token)) {
        res.setHeader("www-authenticate", 'Bearer realm="pixel-builder"');
        return jsonError(res, 401, "Unauthorized: send `Authorization: Bearer <token>`.");
      }
      if (req.method !== "POST") {
        res.setHeader("allow", "POST");
        return jsonError(res, 405, "Method not allowed: POST JSON-RPC to /mcp.");
      }
      let body: unknown;
      try { body = await readBody(req); } catch (e) { return jsonError(res, 400, `Bad request: ${(e as Error).message}`, -32700); }
      const server = createMcpServer(ctx);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => { void transport.close(); void server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      process.stderr.write(`[pixel-builder] http error: ${(e as Error)?.stack ?? String(e)}\n`);
      jsonError(res, 500, "Internal server error", -32603);
    }
  });
  await new Promise<void>((resolve, reject) => { http.once("error", reject); http.listen(opts.port ?? DEFAULT_HTTP_PORT, host, () => resolve()); });
  const addr = http.address();
  const port = typeof addr === "object" && addr ? addr.port : (opts.port ?? DEFAULT_HTTP_PORT);
  const url = `http://${host.includes(":") ? `[${host}]` : host}:${port}/mcp`;
  process.stderr.write(`[pixel-builder] MCP server (Streamable HTTP) at ${url}${token ? ", bearer token required" : ""}\n`);
  return { server: http, url, close: () => new Promise<void>((resolve) => http.close(() => resolve())) };
}

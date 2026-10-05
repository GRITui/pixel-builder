import { request } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VERSION, assetPackPrompt, createMcpServer, normalizeHost, parseHostList, startHttp, type HttpHandle } from "./mcp";
import { TOOLS } from "./tools";
import { Workspace } from "./workspace";
import pkg from "../../package.json";

let dir: string;
let ws: Workspace;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pb-mcp-"));
  ws = new Workspace(join(dir, "ws"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

type Content = { type: string; text?: string; data?: string; mimeType?: string };

describe("MCP server (in-memory transport)", () => {
  async function connect() {
    const [a, b] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer(ws);
    await server.connect(b);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(a);
    return client;
  }

  it("matches the package version", () => {
    expect(VERSION).toBe(pkg.version);
  });

  it("lists every tool with schemas, descriptions and read-only hints", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    const gen = tools.find((t) => t.name === "generate_asset")!;
    expect(gen.inputSchema.required).toEqual(["generator"]);
    expect(Object.keys(gen.inputSchema.properties!)).toEqual(["generator", "params", "seed", "kit_id", "name", "save", "reference_id", "match"]);
    expect(tools.find((t) => t.name === "list_assets")!.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "delete_asset")!.annotations?.destructiveHint).toBe(true);
    expect(client.getInstructions()).toMatch(/get_style_guide/);
  });

  it("generate_asset returns text and a PNG image block", async () => {
    const client = await connect();
    const r = await client.callTool({ name: "generate_asset", arguments: { generator: "environment", params: { kind: "pine" }, seed: 5, name: "Pine" } });
    const content = r.content as Content[];
    expect(r.isError).toBeFalsy();
    expect(content[0].type).toBe("text");
    expect(JSON.parse(content[0].text!).asset).toMatchObject({ name: "Pine", category: "environment" });
    const img = content.find((c) => c.type === "image")!;
    expect(img.mimeType).toBe("image/png");
    expect(Buffer.from(img.data!, "base64").subarray(1, 4).toString()).toBe("PNG");
  });

  it("returns tool failures as isError results with the actionable message", async () => {
    const client = await connect();
    const r = await client.callTool({ name: "generate_asset", arguments: { generator: "enviroment" } });
    expect(r.isError).toBe(true);
    expect((r.content as Content[])[0].text).toMatch(/Unknown generator .enviroment.*Did you mean .environment./);
    const bad = await client.callTool({ name: "get_asset", arguments: { id: "missing" } });
    expect(bad.isError).toBe(true);
  });

  it("serves the project and style-guide resources", async () => {
    const client = await connect();
    await client.callTool({ name: "generate_asset", arguments: { generator: "object", name: "Thing" } });
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(["pixel-builder://project", "pixel-builder://style-guide"]);
    const proj = await client.readResource({ uri: "pixel-builder://project" });
    expect(proj.contents[0].mimeType).toBe("application/json");
    const parsed = JSON.parse((proj.contents[0] as { text: string }).text);
    expect(parsed).toMatchObject({ format: "pixel-builder/project", activeKitId: "kit-default" });
    expect(parsed.assets[0].name).toBe("Thing");
    const guide = await client.readResource({ uri: "pixel-builder://style-guide" });
    expect((guide.contents[0] as { text: string }).text).toMatch(/# Style guide: Cozy RPG/);
  });

  it("offers the asset_pack prompt", async () => {
    const client = await connect();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(["asset_pack", "design_creature", "match_reference"]);
    expect(prompts[0].arguments?.map((a) => a.name)).toEqual(["game", "count"]);
    const p = await client.getPrompt({ name: "asset_pack", arguments: { game: "a seaside farming sim", count: "8" } });
    const text = (p.messages[0].content as { text: string }).text;
    expect(text).toContain("about 8 assets");
    expect(text).toContain("a seaside farming sim");
    for (const tool of ["get_style_guide", "create_kit", "generate_variations", "generate_asset", "paint_asset", "rerender_assets"]) expect(text).toContain(tool);
    const d = await client.getPrompt({ name: "design_creature", arguments: { description: "a river crab", family: "custom" } });
    const dt = (d.messages[0].content as { text: string }).text;
    expect(dt).toContain("a river crab");
    for (const tool of ["create_rig", "create_attachment", "create_clip", "generate_rigged", "list_rigs"]) expect(dt).toContain(tool);
    expect(assetPackPrompt("x", 12)).toContain("about 12 assets");
  });
});

describe("host / token helpers", () => {
  it("normalises hosts, ports, IPv6 and URLs", () => {
    expect(normalizeHost("Example.COM:8788")).toBe("example.com");
    expect(normalizeHost("[::1]:8788")).toBe("::1");
    expect(normalizeHost("https://my-tunnel.trycloudflare.com/mcp")).toBe("my-tunnel.trycloudflare.com");
    expect(normalizeHost("127.0.0.1")).toBe("127.0.0.1");
    expect(parseHostList("a.com, b.com:443", undefined, "A.com", "")).toEqual(["a.com", "b.com"]);
  });
});

describe("MCP over Streamable HTTP", () => {
  let handle: HttpHandle | undefined;
  let stderr: string[];
  beforeEach(() => {
    stderr = [];
    vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
      stderr.push(String(chunk));
      return true;
    }) as never);
  });
  afterEach(async () => {
    await handle?.close();
    handle = undefined;
    vi.restoreAllMocks();
  });

  const INIT = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } } });

  function post(url: string, headers: Record<string, string> = {}, body = INIT, method = "POST"): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const req = request(
        { host: u.hostname, port: u.port, path: u.pathname, method, headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers } },
        (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body: b }));
        },
      );
      req.on("error", reject);
      req.end(method === "POST" ? body : undefined);
    });
  }

  it("binds 127.0.0.1 and serves tools to the SDK client", async () => {
    handle = await startHttp(ws, { port: 0 });
    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(handle.url)));
    expect((await client.listTools()).tools).toHaveLength(TOOLS.length);
    const r = await client.callTool({ name: "generate_asset", arguments: { generator: "object", name: "Over HTTP" } });
    expect((r.content as Content[]).some((c) => c.type === "image")).toBe(true);
    expect(ws.load().assets[0].name).toBe("Over HTTP");
    await client.close();
    expect(stderr.join()).not.toMatch(/WARNING/);
  });

  it("answers other paths and methods with proper errors", async () => {
    handle = await startHttp(ws, { port: 0 });
    expect((await post(handle.url.replace("/mcp", "/nope"))).status).toBe(404);
    const get = await post(handle.url, {}, "", "GET");
    expect(get.status).toBe(405);
    expect((await post(handle.url, {}, "{not json")).status).toBe(400);
  });

  it("rejects non-local Host and Origin headers by default", async () => {
    handle = await startHttp(ws, { port: 0 });
    const evil = await post(handle.url, { host: "evil.example" });
    expect(evil.status).toBe(403);
    expect(evil.body).toMatch(/--allowed-host/);
    expect((await post(handle.url, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post(handle.url, { origin: "http://localhost:5173" })).status).toBe(200);
    expect((await post(handle.url, { host: "localhost:8788" })).status).toBe(200);
  });

  it("--allowed-host extends the allow-list (and warns without a token)", async () => {
    handle = await startHttp(ws, { port: 0, allowedHosts: ["my-tunnel.trycloudflare.com", "https://other.ngrok.app"] });
    expect((await post(handle.url, { host: "my-tunnel.trycloudflare.com" })).status).toBe(200);
    expect((await post(handle.url, { host: "other.ngrok.app:443", origin: "https://other.ngrok.app" })).status).toBe(200);
    expect((await post(handle.url, { host: "evil.example" })).status).toBe(403);
    expect((await post(handle.url, { host: "my-tunnel.trycloudflare.com", origin: "https://evil.example" })).status).toBe(403);
    expect(stderr.join()).toMatch(/WARNING: accepting requests for my-tunnel\.trycloudflare\.com, other\.ngrok\.app without --token/);
  });

  it("--token requires a matching bearer token", async () => {
    handle = await startHttp(ws, { port: 0, token: "s3cret-token" });
    const none = await post(handle.url);
    expect(none.status).toBe(401);
    expect(none.headers["www-authenticate"]).toMatch(/Bearer/);
    expect((await post(handle.url, { authorization: "Bearer wrong" })).status).toBe(401);
    expect((await post(handle.url, { authorization: "Bearer s3cret-token-and-more" })).status).toBe(401);
    expect((await post(handle.url, { authorization: "Basic s3cret-token" })).status).toBe(401);
    expect((await post(handle.url, { authorization: "Bearer s3cret-token" })).status).toBe(200);
    expect((await post(handle.url, { authorization: "bearer s3cret-token" })).status).toBe(200);
    expect((await post(handle.url, { host: "evil.example", authorization: "Bearer s3cret-token" })).status).toBe(403); // host guard still applies
    expect(stderr.join()).not.toMatch(/s3cret/);
    expect(stderr.join()).not.toMatch(/WARNING/);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(handle.url), { requestInit: { headers: { Authorization: "Bearer s3cret-token" } } }));
    expect((await client.listTools()).tools.length).toBe(TOOLS.length);
    await client.close();
  });

  it("warns when binding a non-loopback host without a token", async () => {
    handle = await startHttp(ws, { port: 0, host: "0.0.0.0" });
    expect(stderr.join()).toMatch(/WARNING: listening on 0\.0\.0\.0 without --token/);
    await handle.close();
    stderr.length = 0;
    handle = await startHttp(ws, { port: 0, host: "0.0.0.0", token: "t" });
    expect(stderr.join()).not.toMatch(/WARNING/);
  });
});

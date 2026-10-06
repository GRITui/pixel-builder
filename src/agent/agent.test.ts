import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { gradient } from "../pixel/fixtures";
import { encodePng } from "../io/png";
import { isBlockedIp } from "../net/fetch-safe";
import { main } from "./cli";
import { createMcpServer, startHttp } from "./mcp";

const tmp = () => mkdtempSync(join(tmpdir(), "pb-"));
function fixture(): string {
  const p = join(tmp(), "grad.png");
  writeFileSync(p, encodePng(gradient(120, 80)));
  return p;
}

async function connect(outDir: string) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createMcpServer({ outDir }).connect(a);
  const client = new Client({ name: "t", version: "0" });
  await client.connect(b);
  return client;
}

describe("MCP", () => {
  it("lists tools and runs pixelize with coerced input, returning an image", async () => {
    const out = tmp();
    const client = await connect(out);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["pixelize", "validate"]));
    const r: any = await client.callTool({ name: "pixelize", arguments: { image: fixture(), era: "8", size: "40", outline: "true" } });
    expect(r.isError).toBeFalsy();
    expect(r.content.some((c: any) => c.type === "image")).toBe(true);
    const data = JSON.parse(r.content[0].text);
    expect(existsSync(data.files.native)).toBe(true);
    const v: any = await client.callTool({ name: "validate", arguments: { path: data.files.native, max_colours: 24 } });
    expect(JSON.parse(v.content[0].text).ok).toBe(true);
    const bad: any = await client.callTool({ name: "pixelize", arguments: { image: fixture(), preset: "vivd" } });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toMatch(/Did you mean 'vivid'/);
  });
  it("serves over Streamable HTTP on loopback", async () => {
    const h = await startHttp({ outDir: tmp() }, { port: 0 });
    const client = new Client({ name: "t", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(h.url)));
    expect((await client.listTools()).tools.length).toBeGreaterThan(1);
    await client.close();
    await h.close();
  });
});

describe("CLI", () => {
  it("pixelize --json", async () => {
    const lines: string[] = [];
    const code = await main(["pixelize", fixture(), "--era", "16", "--size", "48", "--out-dir", tmp(), "--json"], { out: (t) => lines.push(t), err: () => {} });
    expect(code).toBe(0);
    const r = JSON.parse(lines[0]);
    expect(r.ok).toBe(true);
    expect(r.width).toBe(48);
  });
  it("reports usage errors with suggestions", async () => {
    const lines: string[] = [];
    const code = await main(["pixelise", "--json"], { out: (t) => lines.push(t), err: () => {} });
    expect(code).toBe(2);
    expect(JSON.parse(lines[0]).error).toMatch(/pixelize/);
  });
});

describe("fetch-safe", () => {
  it("blocks private addresses", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"]) expect(isBlockedIp(ip)).toBe(true);
    expect(isBlockedIp("8.8.8.8")).toBe(false);
  });
});

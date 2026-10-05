import { createServer, type Server } from "node:http";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import jpeg from "jpeg-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyProject, parseProject, serializeProject } from "../core/project";
import { FsStore } from "../../server/store";
import { handleProjects } from "../../server/projects-api";
import { blankImage, decodePng, encodePng } from "./png";
import { decodeImageBuffer, loadReferenceImage } from "./refs";
import { RemoteWorkspace } from "./remote-workspace";
import { callToolAsync } from "./tools";
import { Workspace } from "./workspace";

let dir: string;
let ws: Workspace;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pb-refs-"));
  ws = new Workspace(join(dir, "ws"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function gradient(w: number, h: number) {
  const img = blankImage(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img.rgba.set([(x * 255) / w, (y * 255) / h, 128, 255], (y * w + x) * 4);
  return img;
}
const pngFile = (name: string, w = 8, h = 6) => {
  const p = join(dir, name);
  writeFileSync(p, encodePng(gradient(w, h)));
  return p;
};
const jpgBuf = (w: number, h: number) => {
  const g = gradient(w, h);
  return Buffer.from(jpeg.encode({ width: w, height: h, data: Buffer.from(g.rgba) }, 90).data);
};
const call = (name: string, input: unknown = {}) => callToolAsync(ws, name, input);

describe("decode", () => {
  it("PNG round trip and JPEG decode", () => {
    const g = gradient(10, 7);
    const back = decodeImageBuffer(encodePng(g));
    expect(back.width).toBe(10);
    expect(Array.from(back.rgba)).toEqual(Array.from(g.rgba));
    const j = decodeImageBuffer(jpgBuf(16, 12));
    expect([j.width, j.height]).toEqual([16, 12]);
    expect(Math.abs(j.rgba[2] - 128)).toBeLessThan(20);
  });
  it("rejects webp, gif, junk, oversize dimensions and bytes", () => {
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 "), Buffer.alloc(8)]);
    expect(() => decodeImageBuffer(webp)).toThrow(/WebP is only supported in the web app/);
    expect(() => decodeImageBuffer(Buffer.from("GIF89a" + "x".repeat(20)))).toThrow(/GIF/);
    expect(() => decodeImageBuffer(Buffer.from("hello world, not an image"))).toThrow(/Unsupported/);
    expect(() => decodeImageBuffer(encodePng(blankImage(4097, 1)))).toThrow(/4096/);
    expect(() => decodeImageBuffer(Buffer.alloc(10 * 1024 * 1024 + 1))).toThrow(/limit/);
  });
});

describe("reference tools", () => {
  it("add (path) / list / get / delete", async () => {
    const r = await call("add_reference", { path: pngFile("hero.png", 600, 300), tags: ["mood", "mood", "hero"] });
    const ref = (r.data as any).reference;
    expect(ref).toMatchObject({ id: "hero", name: "hero", width: 600, height: 300, tags: ["mood", "hero"] });
    expect(r.images?.[0].png.subarray(1, 4).toString()).toBe("PNG");
    expect(decodePng(r.images![0].png).width).toBe(512);
    expect(existsSync(join(ws.dir, "references", "hero.png"))).toBe(true);
    expect(parseProject(serializeProject(ws.load())).project.references).toHaveLength(1);

    const again = await call("add_reference", { path: pngFile("hero.png"), name: "hero" });
    expect((again.data as any).reference.id).toBe("hero-2");
    expect((await call("list_references")).data).toMatchObject({ count: 2 });
    expect((await call("list_references", { tag: "mood" })).data).toMatchObject({ count: 1 });
    const g = await call("get_reference", { id: "hero" });
    expect(g.images).toHaveLength(1);
    expect((g.data as any).file).toBe("references/hero.png");

    await call("delete_reference", { id: "hero" });
    expect(existsSync(join(ws.dir, "references", "hero.png"))).toBe(false);
    expect((await call("list_references")).data).toMatchObject({ count: 1 });
    await expect(call("get_reference", { id: "gone" })).rejects.toThrow(/No reference 'gone'/);
  });

  it("accepts base64 (JPEG, data URI) and validates input", async () => {
    const r = await call("add_reference", { base64: "data:image/jpeg;base64," + jpgBuf(20, 10).toString("base64"), name: "pasted" });
    expect((r.data as any).reference).toMatchObject({ width: 20, height: 10, source: { kind: "paste" } });
    await expect(call("add_reference", {})).rejects.toThrow(/exactly one/);
    await expect(call("add_reference", { path: "a.png", url: "http://x/y.png" })).rejects.toThrow(/exactly one/);
    await expect(call("add_reference", { base64: "!!!" })).rejects.toThrow(/base64/);
  });

  it("blocks traversal and bad types in paths, non-http urls", async () => {
    await expect(call("add_reference", { path: "../../etc/passwd.png" })).rejects.toThrow(/\.\./);
    await expect(call("add_reference", { path: "notes.txt" })).rejects.toThrow(/png/);
    await expect(call("add_reference", { path: join(dir, "missing.png") })).rejects.toThrow(/Cannot read/);
    await expect(call("add_reference", { url: "file:///etc/passwd" })).rejects.toThrow(/http/);
    await expect(call("delete_reference", { id: "../../x" })).rejects.toThrow(/No reference/);
    await call("add_reference", { path: pngFile("a.png"), name: "../../evil" });
    expect(existsSync(join(ws.dir, "references", "evil.png"))).toBe(true);
  });

  it("fetches urls with a size limit", async () => {
    process.env.PIXEL_BUILDER_ALLOW_PRIVATE_URLS = "1"; // test server is on loopback
    const png = encodePng(gradient(9, 9));
    const server: Server = createServer((req, res) => {
      if (req.url === "/big.png") res.writeHead(200, { "content-type": "image/png", "content-length": String(21 * 1024 * 1024) }).end();
      else res.writeHead(200, { "content-type": "image/png" }).end(png);
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const r = await call("add_reference", { url: `${base}/tree.png` });
      expect((r.data as any).reference).toMatchObject({ id: "tree", width: 9, source: { kind: "url" } });
      await expect(call("add_reference", { url: `${base}/big.png` })).rejects.toThrow(/limit/);
    } finally {
      server.close();
      delete process.env.PIXEL_BUILDER_ALLOW_PRIVATE_URLS;
    }
  });

  it("loadReferenceImage reads the full file, or the preview from a bare project", async () => {
    await call("add_reference", { path: pngFile("big.png", 1000, 500), name: "big" });
    const full = loadReferenceImage(ws, "big");
    expect([full.w, full.h, full.data.length]).toEqual([1000, 500, 1000 * 500 * 4]);
    const small = loadReferenceImage(ws.load(), "big");
    expect([small.w, small.h]).toEqual([512, 256]);
  });
});

describe("project format", () => {
  it("accepts references, drops invalid ones, old files still load", () => {
    const p = emptyProject();
    p.references = [{ id: "a", name: "A", tags: ["x"], source: { kind: "path", value: "a.png" }, width: 2, height: 2, preview: "AAAA", createdAt: 1 }];
    const back = parseProject(serializeProject(p));
    expect(back.project.references).toEqual(p.references);
    const bad = parseProject(JSON.stringify({ ...p, references: [{ id: 5 }, p.references[0]] }));
    expect(bad.project.references).toHaveLength(1);
    expect(bad.warnings.join()).toMatch(/invalid reference/);
    expect(parseProject(serializeProject(emptyProject())).project.references).toBeUndefined();
  });
});

describe("remote workspace", () => {
  it("references sync through the team server", async () => {
    const store = new FsStore(join(dir, "data"));
    const server = createServer(async (req, res) => {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      if (!(await handleProjects(req, res, path, store))) res.writeHead(404).end();
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/team`;
    try {
      const a = new RemoteWorkspace(url, join(dir, "outA"), undefined);
      const b = new RemoteWorkspace(url, join(dir, "outB"), undefined);
      await callToolAsync(a, "add_reference", { path: pngFile("sky.png", 40, 30), tags: ["sky"] });
      const r = await callToolAsync(b, "list_references", {});
      expect((r.data as any).references).toMatchObject([{ id: "sky", width: 40, height: 30, tags: ["sky"] }]);
      // b has no local full file: the inline preview is used
      await b.pull();
      expect(loadReferenceImage(b, "sky").w).toBe(40);
      await callToolAsync(b, "delete_reference", { id: "sky" });
      expect(((await callToolAsync(a, "list_references", {})).data as any).count).toBe(0);
    } finally {
      server.close();
      delete process.env.PIXEL_BUILDER_ALLOW_PRIVATE_URLS;
    }
  });
});

import { createServer, type Server } from "node:http";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyProject } from "../src/core/project";
import { callToolAsync } from "../src/node/tools";
import { RemoteWorkspace, openWorkspace } from "../src/node/remote-workspace";
import { Workspace } from "../src/node/workspace";
import { createAuth, isOpenPath } from "./auth";
import { handleProjects } from "./projects-api";
import { ConflictError, FsStore, InvalidIdError, isValidId } from "./store";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pb-team-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const project = (activeKitId?: string) => ({ ...emptyProject(), ...(activeKitId ? { activeKitId } : {}) });

describe("FsStore", () => {
  it("round-trips, lists, deletes, with a content-hash etag", async () => {
    const s = new FsStore(join(dir, "data"));
    expect(await s.get("a")).toBeNull();
    const e1 = await s.put("a", project());
    const got = await s.get("a");
    expect(got?.etag).toBe(e1);
    expect(await s.put("a", project())).toBe(e1); // same content, same etag
    expect((await s.list()).map((p) => p.id)).toEqual(["a"]);
    expect(await s.delete("a")).toBe(true);
    expect(await s.delete("a")).toBe(false);
  });

  it("two writers with the same etag: one wins, one conflicts", async () => {
    const s = new FsStore(dir);
    const e0 = await s.put("lib", project());
    const a = project("kit-neon");
    const b = project("kit-gameboy");
    const results = await Promise.allSettled([s.put("lib", a, e0), s.put("lib", b, e0)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(ConflictError);
  });

  it("stale etag throws, unconditional create is fine, leaves no temp files", async () => {
    const s = new FsStore(dir);
    await s.put("lib", project());
    await expect(s.put("lib", project(), '"nope"')).rejects.toBeInstanceOf(ConflictError);
    await expect(s.put("missing", project(), '"x"')).rejects.toBeInstanceOf(ConflictError);
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("validates ids (no traversal)", async () => {
    const s = new FsStore(dir);
    for (const bad of ["../x", "a/b", "", ".hidden", "A", "x".repeat(65), "a.json"]) {
      expect(isValidId(bad)).toBe(false);
      await expect(s.get(bad)).rejects.toBeInstanceOf(InvalidIdError);
    }
    expect(isValidId("team-1_a")).toBe(true);
  });
});

describe("auth", () => {
  const req = (authorization?: string) => ({ headers: authorization ? { authorization } : {} }) as never;
  it("none allows everything", () => expect(createAuth({})(req()).ok).toBe(true));
  it("token requires the bearer token", () => {
    const a = createAuth({ AUTH: "token", PIXEL_BUILDER_TOKEN: "s3cret" });
    expect(a(req()).ok).toBe(false);
    expect(a(req("Bearer wrong")).ok).toBe(false);
    expect(a(req("Basic s3cret")).ok).toBe(false);
    expect(a(req("Bearer s3cret")).ok).toBe(true);
    expect(isOpenPath("/healthz")).toBe(true);
    expect(isOpenPath("/api/projects")).toBe(false);
  });
  it("misconfiguration fails loudly", () => {
    expect(() => createAuth({ AUTH: "token" })).toThrow(/PIXEL_BUILDER_TOKEN/);
    expect(() => createAuth({ AUTH: "proxy-header" })).toThrow(/not implemented/);
    expect(() => createAuth({ AUTH: "wat" })).toThrow(/Unknown AUTH/);
  });
});

/** Same composition as server/index.ts: healthz, auth on /api, projects routes. */
function serve(store: FsStore, env: Record<string, string>): Promise<{ server: Server; base: string }> {
  const auth = createAuth(env);
  const server = createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === "/healthz") return void res.writeHead(200).end("{}");
    if (path.startsWith("/api/")) {
      const a = auth(req);
      if (!a.ok) return void res.writeHead(a.status).end(JSON.stringify({ error: a.message }));
    }
    if (!(await handleProjects(req, res, path, store))) res.writeHead(404).end();
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

describe("projects API", () => {
  let srv: Server;
  let base: string;
  afterEach(() => new Promise<void>((r) => srv.close(() => r())));

  it("token mode: 401 without token, /healthz open, ETag + If-Match flow", async () => {
    ({ server: srv, base } = await serve(new FsStore(join(dir, "d")), { AUTH: "token", PIXEL_BUILDER_TOKEN: "tok" }));
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/api/projects`)).status).toBe(401);
    expect((await fetch(`${base}/api/projects`, { headers: { authorization: "Bearer bad" } })).status).toBe(401);
    const h = { authorization: "Bearer tok" };
    expect((await fetch(`${base}/api/projects/t`, { headers: h })).status).toBe(404);
    const body = JSON.stringify(project());
    const put1 = await fetch(`${base}/api/projects/t`, { method: "PUT", headers: h, body });
    expect(put1.status).toBe(200);
    const etag = put1.headers.get("etag")!;
    const get = await fetch(`${base}/api/projects/t`, { headers: h });
    expect(get.headers.get("etag")).toBe(etag);
    expect((await fetch(`${base}/api/projects/t`, { headers: { ...h, "if-none-match": etag } })).status).toBe(304);
    expect((await fetch(`${base}/api/projects/t`, { method: "PUT", headers: { ...h, "if-match": '"stale"' }, body })).status).toBe(409);
    expect((await fetch(`${base}/api/projects/t`, { method: "PUT", headers: { ...h, "if-match": etag }, body })).status).toBe(200);
    expect((await fetch(`${base}/api/projects/..%2Fx`, { headers: h })).status).toBe(400);
    expect((await fetch(`${base}/api/projects/t`, { method: "PUT", headers: h, body: "nope" })).status).toBe(400);
    const list = (await (await fetch(`${base}/api/projects`, { headers: h })).json()) as { projects: { id: string }[] };
    expect(list.projects.map((p) => p.id)).toEqual(["t"]);
    expect((await fetch(`${base}/api/projects/t`, { method: "DELETE", headers: h })).status).toBe(200);
    expect((await fetch(`${base}/api/projects/t`, { method: "DELETE", headers: h })).status).toBe(404);
  });

  it("none mode needs no token", async () => {
    ({ server: srv, base } = await serve(new FsStore(join(dir, "d")), {}));
    expect((await fetch(`${base}/api/projects`)).status).toBe(200);
  });

  it("remote workspace: agent tools load/save through the API, exports stay local", async () => {
    const store = new FsStore(join(dir, "d"));
    ({ server: srv, base } = await serve(store, { AUTH: "token", PIXEL_BUILDER_TOKEN: "tok" }));
    const out = join(dir, "out");
    const ws = openWorkspace(`${base}/api/projects/team`, out);
    expect(ws).toBeInstanceOf(RemoteWorkspace);
    expect(ws.dir).toBe(out);
    // no token -> actionable error
    await expect(callToolAsync(new RemoteWorkspace(`${base}/api/projects/team`, out, undefined), "list_assets", {})).rejects.toThrow(/PIXEL_BUILDER_TOKEN/);
    const authed = new RemoteWorkspace(`${base}/api/projects/team`, out, "tok");
    const r = await callToolAsync(authed, "generate_asset", { generator: "environment", params: { kind: "oak" }, name: "Oak" });
    expect(JSON.stringify(r.data)).toContain("Oak");
    const stored = await store.get("team");
    expect(stored?.project.assets.map((a) => a.name)).toEqual(["Oak"]);
    expect(readdirSync(join(out, "environments")).some((f) => f.endsWith(".png"))).toBe(true);
    // a second client sees it
    const other = new RemoteWorkspace(`${base}/api/projects/team`, join(dir, "out2"), "tok");
    const l = await callToolAsync(other, "list_assets", {});
    expect(JSON.stringify(l.data)).toContain("Oak");
    // 409 when the project moved under a tool
    await other.pull();
    await store.put("team", project());
    other.save(other.load());
    await expect(other.push()).rejects.toThrow(/changed while this tool ran/);
  });

  it("local workspace specs are unchanged", () => {
    expect(openWorkspace(dir)).toBeInstanceOf(Workspace);
    expect(openWorkspace(dir)).not.toBeInstanceOf(RemoteWorkspace);
    expect(() => new RemoteWorkspace("http://h/api/nope", dir)).toThrow(/api\/projects/);
  });
});

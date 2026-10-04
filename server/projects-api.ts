// REST routes for the shared project library: /api/projects[/:id]. Plain node:http.
import type { IncomingMessage, ServerResponse } from "node:http";
import { parseProject } from "../src/core/project";
import { ConflictError, InvalidIdError, isValidId, type Store } from "./store";

export const MAX_PROJECT_BODY = 64 * 1024 * 1024;

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): true {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers });
  res.end(JSON.stringify(body));
  return true;
}

async function readText(req: IncomingMessage, max: number): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > max) return null;
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Handles /api/projects routes. Returns false when the path is not one of them. */
export async function handleProjects(req: IncomingMessage, res: ServerResponse, path: string, store: Store): Promise<boolean> {
  const m = /^\/api\/projects(?:\/([^/]*))?$/.exec(path);
  if (!m) return false;
  try {
    if (m[1] === undefined) {
      if (req.method !== "GET") return send(res, 405, { error: "Use GET." });
      return send(res, 200, { projects: await store.list() });
    }
    let id: string;
    try {
      id = decodeURIComponent(m[1]);
    } catch {
      id = "";
    }
    if (!isValidId(id)) throw new InvalidIdError(id);

    if (req.method === "GET") {
      const r = await store.get(id);
      if (!r) return send(res, 404, { error: `No project '${id}'.` });
      if (req.headers["if-none-match"] === r.etag) {
        res.writeHead(304, { etag: r.etag, "cache-control": "no-store" });
        res.end();
        return true;
      }
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", etag: r.etag, "x-content-type-options": "nosniff" });
      res.end(r.text);
      return true;
    }
    if (req.method === "PUT") {
      const text = await readText(req, MAX_PROJECT_BODY);
      if (text === null) return send(res, 413, { error: "Project too large (max 64 MB)." });
      let project;
      try {
        project = parseProject(text).project;
      } catch (e) {
        return send(res, 400, { error: `Not a pixel-builder project: ${(e as Error).message}` });
      }
      const ifMatch = req.headers["if-match"];
      const etag = await store.put(id, project, typeof ifMatch === "string" ? ifMatch : undefined);
      return send(res, 200, { id, etag }, { etag });
    }
    if (req.method === "DELETE") {
      const ok = await store.delete(id);
      return send(res, ok ? 200 : 404, ok ? { deleted: id } : { error: `No project '${id}'.` });
    }
    return send(res, 405, { error: "Use GET, PUT or DELETE." });
  } catch (e) {
    if (e instanceof ConflictError) return send(res, 409, { error: "Project changed elsewhere; reload and retry.", currentEtag: e.currentEtag }, e.currentEtag ? { etag: e.currentEtag } : {});
    if (e instanceof InvalidIdError) return send(res, 400, { error: e.message });
    console.error(e);
    return send(res, 500, { error: "Internal server error." });
  }
}

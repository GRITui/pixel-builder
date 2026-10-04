// Pixel Builder API: plain node:http, no framework. Holds the Anthropic key.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { callStructured, getModel, hasKey } from "./claude";
import { buildLegend, decodeRows } from "../src/core/legend";
import { inpaint } from "./inpaint";
import { clipRoute } from "./clip";
import { rigRoute } from "./rig";
import * as P from "./prompts";

try {
  process.loadEnvFile(); // .env, if present (the SDK reads the key lazily, after this)
} catch {
  /* no .env file */
}

const MAX_BODY = 1024 * 1024; // 1 MB
const DIST = fileURLToPath(new URL("../dist", import.meta.url));

function send(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (declared > MAX_BODY) throw new P.HttpError(413, "Request body too large (max 1 MB).");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new P.HttpError(413, "Request body too large (max 1 MB).");
    chunks.push(chunk as Buffer);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("not an object");
    return v as Record<string, unknown>;
  } catch {
    throw new P.HttpError(400, "Request body must be a JSON object.");
  }
}

function health() {
  if (!hasKey()) return { enabled: false, model: null, reason: "ANTHROPIC_API_KEY is not set on the server" };
  return { enabled: true, model: getModel() };
}

async function vibe(body: Record<string, unknown>, signal: AbortSignal) {
  const prompt = P.requirePrompt(body.prompt);
  const generator = P.normalizeGenerator(body.generator);
  if (!generator.params.length) throw new P.HttpError(400, "`generator.params` must list at least one parameter.");
  const kit = P.normalizeKit(body.kit);
  const { system, user, schema } = P.buildVibePrompt({ prompt, generator, kit, current: P.normalizeCurrent(body.current) });
  const raw = await callStructured({ system, user, schema, effort: "low", maxTokens: 4000, signal });
  return P.parseVibe(raw, generator);
}

async function pixels(body: Record<string, unknown>, signal: AbortSignal) {
  const prompt = P.requirePrompt(body.prompt);
  const category = P.normalizeCategory(body.category);
  const kit = P.normalizeKit(body.kit);
  const fallback = category === "map" ? kit.sizes.tile : kit.sizes[category];
  const w = P.clampDim(body.w, fallback);
  const h = P.clampDim(body.h, fallback);
  const references = P.normalizeReferences(body.references);
  const { system, user, schema } = P.buildPixelsPrompt({ prompt, category, w, h, kit, references });
  const raw = (await callStructured({ system, user, schema, effort: "high", maxTokens: 32000, stream: true, signal })) as Record<string, unknown> | null;
  const sprite = decodeRows(Array.isArray(raw?.rows) ? (raw.rows as string[]) : [], w, h, buildLegend(kit));
  if (!sprite.data.some((v) => v > 0)) throw new P.HttpError(502, "The model returned an empty image. Try again.");
  return { name: P.cleanText(raw?.name, 60) || "AI sprite", sprite };
}

async function kitRoute(body: Record<string, unknown>, signal: AbortSignal) {
  const prompt = P.requirePrompt(body.prompt);
  const kit = P.normalizeKit(body.kit);
  const { system, user, schema } = P.buildKitPrompt({ prompt, kit });
  const raw = await callStructured({ system, user, schema, effort: "low", maxTokens: 4000, signal });
  return P.parseKit(raw);
}

const POST_ROUTES: Record<string, (b: Record<string, unknown>, s: AbortSignal) => Promise<unknown>> = {
  "/api/vibe": vibe,
  "/api/pixels": pixels,
  "/api/kit": kitRoute,
  "/api/inpaint": inpaint,
  "/api/clip": clipRoute,
  "/api/rig": rigRoute,
};

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

async function serveStatic(pathname: string, res: ServerResponse) {
  let rel: string;
  try {
    rel = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, "");
  } catch {
    rel = "";
  }
  let file = join(DIST, rel);
  const inside = file === DIST || file.startsWith(DIST + sep);
  if (!inside || !existsSync(file) || !statSync(file).isFile()) file = join(DIST, "index.html"); // SPA fallback
  if (!existsSync(file)) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found (run `npm run build` first)");
    return;
  }
  const body = await readFile(file);
  const immutable = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream",
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

const production = process.env.NODE_ENV === "production";

const server = createServer(async (req, res) => {
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/api/health") {
      if (req.method !== "GET") throw new P.HttpError(405, "Use GET.");
      return send(res, 200, health());
    }
    if (path in POST_ROUTES) {
      if (req.method !== "POST") throw new P.HttpError(405, "Use POST.");
      const body = await readJson(req);
      return send(res, 200, await POST_ROUTES[path](body, controller.signal));
    }
    if (path.startsWith("/api/")) throw new P.HttpError(404, "Unknown endpoint.");
    if (production && (req.method === "GET" || req.method === "HEAD")) return await serveStatic(url.pathname, res);
    throw new P.HttpError(404, "Not found.");
  } catch (e) {
    const status = e instanceof P.HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent && !res.destroyed) send(res, status === 499 ? 400 : status, { error: e instanceof P.HttpError ? e.message : "Internal server error." });
  }
});

const port = Number(process.env.PORT ?? 8787);
server.listen(port, () => {
  const h = health();
  console.log(`api on :${port} (${h.enabled ? `model ${h.model}` : "AI disabled: no ANTHROPIC_API_KEY"})${production ? ", serving dist/" : ""}`);
});

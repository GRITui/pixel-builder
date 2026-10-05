// Reference library: decode / validate / store reference images (mood board).
// The project keeps a <=512px inline preview (so remote workspaces and the web app
// see every reference); a local workspace also keeps the full PNG in references/<id>.png.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { resolve, sep } from "node:path";
import jpeg from "jpeg-js";
import { downscaleRGBA } from "../core/enforce";
import type { ProjectFile } from "../core/project";
import { REFERENCE_MAX_DIM, REFERENCE_PREVIEW_MAX, type Reference } from "../core/types";
import { decodePng, encodePng, type RgbaImage } from "./png";
import { ToolError, Workspace, atomicWrite, slugify } from "./workspace";

export const REFERENCE_MAX_BYTES = 10 * 1024 * 1024;
export const REFERENCE_DIR = "references";
export const FETCH_TIMEOUT_MS = 15000;

/** RGBA image as other lanes consume it. */
export interface RefImage {
  w: number;
  h: number;
  data: Uint8ClampedArray;
}

const isPng = (b: Uint8Array) => b.length > 8 && b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71;
const isJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const ascii = (b: Uint8Array, from: number, to: number) => Buffer.from(b.subarray(from, to)).toString("latin1");

/** Decode PNG or JPEG bytes. WebP/GIF are browser-only (canvas); others are rejected with a clear error. */
export function decodeImageBuffer(buf: Uint8Array): RgbaImage {
  if (buf.length > REFERENCE_MAX_BYTES) throw new ToolError(`Image is ${(buf.length / 1048576).toFixed(1)} MB; the limit is ${REFERENCE_MAX_BYTES / 1048576} MB.`);
  let img: RgbaImage;
  if (isPng(buf) || isJpeg(buf)) {
    try {
      if (isPng(buf)) img = decodePng(buf);
      else {
        const d = jpeg.decode(Buffer.from(buf), { useTArray: true, formatAsRGBA: true, maxResolutionInMP: (REFERENCE_MAX_DIM * REFERENCE_MAX_DIM) / 1e6, maxMemoryUsageInMB: 512 });
        img = { width: d.width, height: d.height, rgba: d.data };
      }
    } catch (e) {
      throw new ToolError(`Cannot decode image: ${(e as Error).message}`);
    }
  } else if (buf.length > 12 && ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") {
    throw new ToolError("WebP is only supported in the web app (browser canvas). Convert it to PNG or JPEG first.");
  } else if (buf.length > 6 && ascii(buf, 0, 3) === "GIF") {
    throw new ToolError("GIF is only supported in the web app (browser canvas). Convert it to PNG or JPEG first.");
  } else {
    throw new ToolError("Unsupported image type: only PNG and JPEG can be decoded here.");
  }
  if (img.width > REFERENCE_MAX_DIM || img.height > REFERENCE_MAX_DIM) throw new ToolError(`Image is ${img.width}x${img.height}; the limit is ${REFERENCE_MAX_DIM}px per side. Downscale it first.`);
  return img;
}

/** Box-filter downscale so the longest side is <= max (no-op if already small). */
export function fitWithin(img: RgbaImage, max = REFERENCE_PREVIEW_MAX): RgbaImage {
  const k = Math.min(1, max / Math.max(img.width, img.height));
  if (k === 1) return img;
  const w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
  const out = downscaleRGBA(new Uint8ClampedArray(img.rgba.buffer, img.rgba.byteOffset, img.rgba.length), img.width, img.height, w, h);
  return { width: w, height: h, rgba: new Uint8Array(out.buffer, out.byteOffset, out.length) };
}

/** Local path input: no NUL bytes, no `..` segments, PNG/JPEG extension. Returns the absolute path. */
export function safeInputPath(p: string): string {
  if (p.includes("\0")) throw new ToolError("Invalid path.");
  if (p.split(/[\\/]/).includes("..")) throw new ToolError(`Path '${p}' contains '..'; pass a path without parent-directory segments (or an absolute path).`);
  if (!/\.(png|jpe?g)$/i.test(p)) throw new ToolError(`'${p}' is not a .png/.jpg/.jpeg file.`);
  return resolve(p);
}

export const FETCH_MAX_REDIRECTS = 3;
export const URL_FETCH_MAX_BYTES = 20 * 1024 * 1024;

/** True if `ip` (v4 or v6 literal) is loopback/private/link-local/CGNAT/multicast/etc. Unparseable input counts as blocked. */
export function isBlockedIp(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  const kind = isIP(addr);
  if (kind === 4) return blockedV4(addr.split(".").map(Number));
  if (kind !== 6) return true;
  let g = addr;
  const v4tail = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4tail) {
    const o = v4tail[1].split(".").map(Number);
    g = addr.slice(0, -v4tail[1].length) + ((o[0] << 8) | o[1]).toString(16) + ":" + ((o[2] << 8) | o[3]).toString(16);
  }
  const [h, t] = g.split("::");
  const hp = h ? h.split(":") : [], tp = t ? t.split(":") : [];
  const groups = g.includes("::") ? [...hp, ...Array(8 - hp.length - tp.length).fill("0"), ...tp] : hp;
  const w = groups.map((x) => parseInt(x, 16));
  if (w.length !== 8 || w.some((x) => Number.isNaN(x))) return true;
  if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0xffff || w[5] === 0)) {
    // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (compatible); also covers :: and ::1
    return blockedV4([w[6] >> 8, w[6] & 255, w[7] >> 8, w[7] & 255]);
  }
  if ((w[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((w[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((w[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

function blockedV4([a, b]: number[]): boolean {
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export interface FetchDeps {
  lookup?: (host: string) => Promise<{ address: string }[]>;
  fetch?: typeof fetch;
}

const allowPrivate = () => process.env.PIXEL_BUILDER_ALLOW_PRIVATE_URLS === "1";

async function assertPublicHost(u: URL, deps: FetchDeps): Promise<void> {
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new ToolError(`Only http and https URLs are allowed, got '${u.protocol}'.`);
  if (allowPrivate()) return;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  let addrs: { address: string }[];
  if (isIP(host)) addrs = [{ address: host }];
  else {
    try {
      addrs = await (deps.lookup ?? ((h) => dnsLookup(h, { all: true })))(host);
    } catch (e) {
      throw new ToolError(`Could not resolve ${host}: ${(e as Error).message}`);
    }
  }
  if (!addrs.length) throw new ToolError(`Could not resolve ${host}.`);
  if (addrs.some((a) => isBlockedIp(a.address))) throw new ToolError(`Refusing to fetch ${u.origin}: it resolves to a private or reserved address. Set PIXEL_BUILDER_ALLOW_PRIVATE_URLS=1 for local development.`);
}

/** Fetch an http(s) image URL: public hosts only (re-checked per redirect hop), size limit, timeout, image/* only. */
export async function fetchImage(url: string, deps: FetchDeps = {}): Promise<Buffer> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ToolError(`'${url}' is not a valid URL.`);
  }
  const doFetch = deps.fetch ?? fetch;
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const limitMb = URL_FETCH_MAX_BYTES / 1048576;
  let res!: Response;
  for (let hop = 0; hop <= FETCH_MAX_REDIRECTS; hop++) {
    await assertPublicHost(u, deps);
    try {
      res = await doFetch(u, { signal, redirect: "manual" });
    } catch (e) {
      throw new ToolError(`Could not fetch ${url}: ${(e as Error).message}`);
    }
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      if (hop === FETCH_MAX_REDIRECTS) throw new ToolError(`${url}: too many redirects (max ${FETCH_MAX_REDIRECTS}).`);
      try {
        u = new URL(loc, u);
      } catch {
        throw new ToolError(`${url}: invalid redirect target.`);
      }
      await res.body?.cancel().catch(() => {});
      continue;
    }
    break;
  }
  if (!res.ok) throw new ToolError(`Fetching ${url} failed: HTTP ${res.status}.`);
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!type.startsWith("image/")) {
    await res.body?.cancel().catch(() => {});
    throw new ToolError(`${url} is '${type || "unknown type"}', not an image.`);
  }
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > URL_FETCH_MAX_BYTES) throw new ToolError(`${url} is ${(declared / 1048576).toFixed(1)} MB; the limit is ${limitMb} MB.`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for await (const c of res.body as unknown as AsyncIterable<Uint8Array>) {
      size += c.length;
      if (size > URL_FETCH_MAX_BYTES) throw new ToolError(`${url} is larger than ${limitMb} MB.`);
      chunks.push(c);
    }
  } catch (e) {
    if (e instanceof ToolError) throw e;
    throw new ToolError(`Download of ${url} failed: ${(e as Error).message}`);
  }
  return Buffer.concat(chunks);
}

export function decodeBase64Image(data: string): Buffer {
  const b64 = data.replace(/^data:[^,]*;base64,/, "").replace(/\s+/g, "");
  if (!b64.length || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) throw new ToolError("'base64' is not valid base64 image data.");
  if ((b64.length * 3) / 4 > REFERENCE_MAX_BYTES * 1.01) throw new ToolError(`Image is larger than ${REFERENCE_MAX_BYTES / 1048576} MB.`);
  return Buffer.from(b64, "base64");
}

function uniqueId(project: ProjectFile, name: string): string {
  const base = slugify(name) || "reference";
  const taken = new Set((project.references ?? []).map((r) => r.id));
  let id = base, n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

export function referenceFile(ws: Workspace, id: string): string {
  const dir = resolve(ws.dir, REFERENCE_DIR);
  const file = resolve(dir, `${id}.png`);
  if (!file.startsWith(dir + sep)) throw new ToolError(`Invalid reference id '${id}'.`);
  return file;
}

/** Decode, validate, store the full PNG in the workspace and append the record to `project`. The caller saves the project. */
export function storeReference(ws: Workspace, project: ProjectFile, buf: Uint8Array, opts: { name: string; tags?: string[]; source: Reference["source"] }): Reference {
  const img = decodeImageBuffer(buf);
  const id = uniqueId(project, opts.name);
  const ref: Reference = {
    id,
    name: opts.name,
    tags: [...new Set((opts.tags ?? []).map((t) => t.trim()).filter(Boolean))],
    source: opts.source,
    width: img.width,
    height: img.height,
    preview: encodePng(fitWithin(img)).toString("base64"),
    createdAt: Date.now(),
  };
  atomicWrite(referenceFile(ws, id), encodePng(img));
  project.references = [...(project.references ?? []), ref];
  return ref;
}

export function findReference(project: ProjectFile, idOrName: string): Reference {
  const refs = project.references ?? [];
  const r = refs.find((x) => x.id === idOrName) ?? refs.find((x) => x.name === idOrName);
  if (!r) throw new ToolError(`No reference '${idOrName}'.${refs.length ? ` References: ${refs.map((x) => x.id).join(", ")}.` : " The library is empty; use add_reference."}`);
  return r;
}

export function removeReferenceFile(ws: Workspace, id: string): void {
  rmSync(referenceFile(ws, id), { force: true });
}

const toRef = (img: RgbaImage): RefImage => ({ w: img.width, h: img.height, data: new Uint8ClampedArray(img.rgba.buffer, img.rgba.byteOffset, img.rgba.length) });

/**
 * RGBA pixels of a reference. With a Workspace the full-size file is used when present,
 * otherwise (remote workspace, other machine, or a bare ProjectFile) the inline <=512px preview.
 */
export function loadReferenceImage(from: Workspace | ProjectFile, idOrName: string): RefImage {
  const ws = from instanceof Workspace ? from : undefined;
  const project = ws ? ws.load() : (from as ProjectFile);
  const ref = findReference(project, idOrName);
  if (ws) {
    const file = referenceFile(ws, ref.id);
    if (existsSync(file)) {
      try {
        return toRef(decodePng(readFileSync(file)));
      } catch {
        /* fall back to the preview */
      }
    }
  }
  return toRef(decodePng(Buffer.from(ref.preview, "base64")));
}

export const referencePreviewPng = (ref: Reference): Buffer => Buffer.from(ref.preview, "base64");

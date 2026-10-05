// Reference library: decode / validate / store reference images (mood board).
// The project keeps a <=512px inline preview (so remote workspaces and the web app
// see every reference); a local workspace also keeps the full PNG in references/<id>.png.
import { existsSync, readFileSync, rmSync } from "node:fs";
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

/** Fetch an http(s) URL with a size limit and timeout. */
export async function fetchImage(url: string): Promise<Buffer> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ToolError(`'${url}' is not a valid URL.`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new ToolError(`Only http and https URLs are allowed, got '${u.protocol}'.`);
  let res: Response;
  try {
    res = await fetch(u, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (e) {
    throw new ToolError(`Could not fetch ${url}: ${(e as Error).message}`);
  }
  if (!res.ok) throw new ToolError(`Fetching ${url} failed: HTTP ${res.status}.`);
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > REFERENCE_MAX_BYTES) throw new ToolError(`${url} is ${(declared / 1048576).toFixed(1)} MB; the limit is ${REFERENCE_MAX_BYTES / 1048576} MB.`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for await (const c of res.body as unknown as AsyncIterable<Uint8Array>) {
      size += c.length;
      if (size > REFERENCE_MAX_BYTES) throw new ToolError(`${url} is larger than ${REFERENCE_MAX_BYTES / 1048576} MB.`);
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

// The tool layer. One implementation; MCP (mcp.ts) and CLI (cli.ts) are thin adapters.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { z } from "zod";
import { decodeImage } from "../io/decode";
import { encodePng, decodePng } from "../io/png";
import { upscale } from "../io/resize";
import { fetchImage, FetchError } from "../net/fetch-safe";
import { pixelize } from "../pixel/pipeline";
import { BLOOMS, DITHERS, ERAS, MODES, PRESETS } from "../pixel/types";
import { validate } from "../pixel/validate";
import { registerTool, ToolError, type ToolImage } from "./registry";

export { TOOLS, ToolError, callTool } from "./registry";

export function atomicWrite(path: string, data: Buffer | string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "image";

/** Local path or http(s) URL -> decoded image + a name stem. */
export async function loadImage(src: string) {
  try {
    if (/^https?:\/\//i.test(src)) {
      const buf = await fetchImage(src);
      return { img: await decodeImage(buf), stem: slug(basename(new URL(src).pathname, extname(src))) };
    }
    if (src.includes("\0")) throw new ToolError("Invalid path.");
    const path = resolve(src);
    return { img: await decodeImage(readFileSync(path)), stem: slug(basename(path, extname(path))) };
  } catch (e) {
    if (e instanceof ToolError) throw e;
    if (e instanceof FetchError) throw new ToolError(e.message);
    if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new ToolError(`File not found: ${src}`);
    throw new ToolError(`Could not read image '${src}': ${(e as Error).message}`);
  }
}

/** Integer scale so the preview's long side is about `target` px (>= 256 for multimodal hosts). */
export const previewScale = (w: number, h: number, target = 768) => Math.max(1, Math.min(16, Math.round(target / Math.max(w, h))));

registerTool({
  name: "pixelize",
  title: "Pixelize an image",
  description:
    "Turn a realistic image (file path or http(s) URL) into TRUE pixel art: every pixel one solid colour, era-limited palette. Writes <out_dir>/<name>.png (native size), <name>@Nx.png (upscaled preview) and <name>.json (meta); returns paths and shows the preview.",
  positional: "image",
  shape: {
    image: z.string().min(1).describe("Image file path or http(s) URL (PNG, JPEG, WebP, GIF)."),
    mode: z.enum(MODES as [string, ...string[]]).default("scene").describe("scene | sprite (cut-out, exact size) | tile (seamless)."),
    era: z.union([z.literal(8), z.literal(16), z.literal(32), z.literal(64)]).default(16).describe("Era: 8, 16, 32 or 64 (bit)."),
    preset: z.enum(PRESETS as [string, ...string[]]).default("vivid").describe("Colour look preset."),
    bloom: z.enum(BLOOMS as [string, ...string[]]).default("off"),
    dither: z.enum(DITHERS as [string, ...string[]]).default("off"),
    outline: z.boolean().default(false).describe("Add a 1px dark outline."),
    size: z.number().int().min(8).max(2048).optional().describe("Native width in pixels (default from era)."),
    seed: z.number().int().min(0).max(2 ** 31).default(1),
    out_dir: z.string().optional().describe("Output folder (default ./pixel-out)."),
  },
  async run(ctx, i) {
    const { img, stem } = await loadImage(i.image);
    const result = pixelize(img, {
      mode: i.mode as "scene", era: i.era, preset: i.preset as "vivid", bloom: i.bloom as "off", dither: i.dither as "off",
      outline: i.outline, width: i.size ?? ERAS[i.era].width, seed: i.seed,
    });
    const dir = resolve(i.out_dir ?? ctx.outDir);
    mkdirSync(dir, { recursive: true });
    const name = `${stem}-${i.mode}-${i.era}bit`;
    const k = previewScale(result.native.w, result.native.h);
    const files = { native: join(dir, `${name}.png`), preview: join(dir, `${name}@${k}x.png`), meta: join(dir, `${name}.json`) };
    const previewPng = encodePng(upscale(result.native, k));
    atomicWrite(files.native, encodePng(result.native));
    atomicWrite(files.preview, previewPng);
    atomicWrite(files.meta, JSON.stringify({ ...result.meta, palette: result.palette, preview_scale: k, source: i.image }, null, 2));
    const images: ToolImage[] = [{ png: previewPng, label: `${name} (${k}x preview)` }];
    return {
      data: { files, width: result.native.w, height: result.native.h, colours: result.meta.colours, preview_scale: k, meta: result.meta },
      images,
    };
  },
});

registerTool({
  name: "validate",
  title: "Validate true pixel art",
  description: "Check a PNG is true pixel art: alpha only 0/255, colour count within a limit, and (with scale) every scale x scale block one solid colour.",
  positional: "path",
  readOnly: true,
  shape: {
    path: z.string().min(1).describe("PNG file path."),
    max_colours: z.number().int().min(2).max(65536).optional().describe("Colour limit (default: 256)."),
    scale: z.number().int().min(1).max(64).optional().describe("If the file is an upscaled preview, its integer scale."),
  },
  async run(_ctx, i) {
    let buf: Buffer;
    try { buf = readFileSync(resolve(i.path)); } catch { throw new ToolError(`File not found: ${i.path}`); }
    let img;
    try { img = decodePng(buf); } catch (e) { throw new ToolError(`Not a readable PNG: ${(e as Error).message}`); }
    const r = validate(img, { maxColours: i.max_colours ?? 256, scale: i.scale });
    return { data: { ...r } };
  },
});

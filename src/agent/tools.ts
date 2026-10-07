// The tool layer. One implementation; MCP (mcp.ts) and CLI (cli.ts) are thin adapters.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { z } from "zod";
import { decodeImage } from "../io/decode";
import { encodePng, decodePng } from "../io/png";
import { upscale } from "../io/resize";
import { fetchImage, FetchError } from "../net/fetch-safe";
import { pixelize } from "../pixel/pipeline";
import { pixelizeSprite } from "../pixel/sprite";
import { pixelizeTile } from "../pixel/tile";
import { BLOOMS, DITHERS, EFFECTS, ERAS, MODES, PRESETS, type Effect } from "../pixel/types";
import { validate } from "../pixel/validate";
import { loadLook, looksDir } from "./looks";
import { imageFromPrompt, writeEffects } from "./pixelize-extras";
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
    "Turn a realistic image (file path or http(s) URL) into TRUE pixel art: every pixel one solid colour, era-limited palette. Writes <out_dir>/<name>.png (native size), <name>@Nx.png (upscaled preview) and <name>.json (meta); returns paths and shows the preview. Example: pixelize image=photo.jpg era=16 preset=neon bloom=med effects=[rain].",
  positional: "image",
  shape: {
    image: z.string().min(1).optional().describe("Image file path or http(s) URL (PNG, JPEG, WebP, GIF). Give this or prompt."),
    prompt: z.string().min(1).max(2000).optional().describe("Generate the source image from this text instead of image (needs IMAGE_API_KEY / IMAGE_BASE_URL / IMAGE_MODEL)."),
    mode: z.enum(MODES as [string, ...string[]]).default("scene").describe("scene | sprite (cut-out, exact size) | tile (seamless)."),
    era: z.union([z.literal(8), z.literal(16), z.literal(32), z.literal(64)]).default(16).describe("Era: 8, 16, 32 or 64 (bit)."),
    preset: z.enum(PRESETS as [string, ...string[]]).default("vivid").describe("Colour look preset."),
    bloom: z.enum(BLOOMS as [string, ...string[]]).default("off"),
    dither: z.enum(DITHERS as [string, ...string[]]).default("off"),
    outline: z.boolean().default(false).describe("Add a 1px dark outline."),
    look: z.string().optional().describe("Name of a saved look (see the looks tool): forces its era, palette and settings."),
    size: z.number().int().min(8).max(2048).optional().describe("Native width in pixels (default from era)."),
    bg: z.string().optional().describe("Sprite mode: background colour #rrggbb to key out (default: estimated from the border)."),
    seed: z.number().int().min(0).max(2 ** 31).default(1),
    out_dir: z.string().optional().describe("Output folder (default ./pixel-out)."),
    effects: z.array(z.enum(EFFECTS as [string, ...string[]])).optional().describe("Looping effects: rain, snow, shimmer, flicker, bloom_pulse. Also writes <name>-fx.gif, -fx-sheet.png, -fx-frames.json."),
    frames: z.number().int().min(2).max(64).default(12).describe("Frames in the effect loop."),
    fps: z.number().int().min(1).max(50).default(10).describe("Effect loop speed."),
  },
  async run(ctx, i) {
    if (!i.image === !i.prompt) throw new ToolError("Give exactly one of image (a file path or URL) or prompt (text to generate the image from).");
    const src = i.prompt ? await imageFromPrompt(i.prompt, i.mode as "scene") : { ...(await loadImage(i.image!)), png: undefined };
    const { img, stem } = src;
    const look = i.look ? loadLook(looksDir(i.out_dir ?? ctx.outDir), i.look) : undefined;
    const popts = {
      look,
      mode: i.mode as "scene", era: i.era, preset: i.preset as "vivid", bloom: i.bloom as "off", dither: i.dither as "off",
      outline: i.outline, width: i.size ?? (i.mode === "scene" ? ERAS[look?.era ?? i.era].width : 32), seed: i.seed,
    };
    const tile = i.mode === "tile" ? pixelizeTile(img, popts) : undefined;
    const result = tile ?? (i.mode === "sprite" ? pixelizeSprite(img, popts, { bg: i.bg }) : pixelize(img, popts));
    const dir = resolve(i.out_dir ?? ctx.outDir);
    mkdirSync(dir, { recursive: true });
    const name = `${stem}-${i.mode}-${result.meta.era}bit`;
    const k = previewScale(result.native.w, result.native.h);
    const files = { native: join(dir, `${name}.png`), preview: join(dir, `${name}@${k}x.png`), meta: join(dir, `${name}.json`) };
    const previewPng = encodePng(upscale(result.native, k));
    atomicWrite(files.native, encodePng(result.native));
    atomicWrite(files.preview, previewPng);
    if (src.png) atomicWrite(join(dir, `${name}-source.png`), src.png);
    atomicWrite(files.meta, JSON.stringify({ ...result.meta, palette: result.palette, preview_scale: k, source: i.image ?? { prompt: i.prompt }, ...(look ? { look: look.id } : {}) }, null, 2));
    const images: ToolImage[] = [{ png: previewPng, label: `${name} (${k}x preview)` }];
    if (tile) {
      const sheetPath = join(dir, `${name}-3x3@${k}x.png`);
      const sheetPng = encodePng(upscale(tile.sheet, k));
      atomicWrite(sheetPath, sheetPng);
      images.push({ png: sheetPng, label: `${name} 3x3 tiling check` });
    }
    const fx = i.effects?.length
      ? writeEffects(result, { effects: i.effects as Effect[], frames: i.frames, fps: i.fps, seed: i.seed, gifScale: Math.max(1, Math.min(k, Math.floor(1024 / Math.max(result.native.w, result.native.h)))) }, dir, name, atomicWrite)
      : undefined;
    return {
      data: {
        files: { ...files, ...(src.png ? { source: join(dir, `${name}-source.png`) } : {}), ...fx?.files },
        width: result.native.w, height: result.native.h, colours: result.meta.colours, preview_scale: k, meta: result.meta,
        ...(fx ? { effects: { list: i.effects, frames: fx.frames, fps: fx.fps, stats: fx.stats } } : {}),
      },
      images,
    };
  },
});

registerTool({
  name: "validate",
  title: "Validate true pixel art",
  description: "Check a PNG is true pixel art: alpha only 0/255, colour count within a limit, and (with scale) every scale x scale block one solid colour. Example: validate path=pixel-out/photo-scene-16bit.png max_colours=48.",
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

const PRESET_INFO: Record<string, string> = {
  vivid: "Punchy saturated colours, the default.",
  neon: "Hot magentas/cyans on deep darks; pairs with bloom for night scenes.",
  pastel: "Soft, light, low-contrast colours.",
  warm: "Orange/amber cast, golden-hour feel.",
  cool: "Blue/teal cast, night or winter feel.",
  sepia: "Brown monochrome, old-photo look.",
  neutral: "No colour grade; faithful to the source.",
};
const EFFECT_INFO: Record<string, string> = {
  rain: "Falling streaks over the whole frame.",
  snow: "Drifting flakes.",
  shimmer: "Water/reflective areas ripple (best on water scenes).",
  flicker: "Bright emitters (lamps, neon) flicker.",
  bloom_pulse: "Glow around bright emitters pulses.",
};
const MODE_INFO: Record<string, string> = {
  scene: "Whole image to era width (default).",
  sprite: "Cut-out subject on transparent background, exact small size (default 32 wide); bg keyed out.",
  tile: "Seamless tile plus a 3x3 tiling-check sheet.",
};

registerTool({
  name: "presets",
  title: "List eras, presets and options",
  description:
    "List every valid choice for pixelize: eras (width, colour limit, palette rule), colour presets, bloom/dither levels, modes and effects, each with an example call. Read-only; call it first if unsure. Example: presets (no input).",
  readOnly: true,
  shape: {},
  async run() {
    const ex = (a: string) => `pixelize image=photo.jpg ${a}`;
    return {
      data: {
        eras: Object.entries(ERAS).map(([era, e]) => ({ era: Number(era), width: e.width, max_colours: e.colours, palette: e.palette, example: ex(`era=${era}`) })),
        presets: PRESETS.map((p) => ({ name: p, description: PRESET_INFO[p], example: ex(`preset=${p}`) })),
        bloom: BLOOMS.map((b) => ({ level: b, example: ex(`bloom=${b}`) })),
        dither: DITHERS.map((d) => ({ level: d, example: ex(`dither=${d}`) })),
        modes: MODES.map((m) => ({ mode: m, description: MODE_INFO[m], example: ex(`mode=${m}`) })),
        effects: EFFECTS.map((f) => ({ effect: f, description: EFFECT_INFO[f], example: ex(`effects=[${f}] frames=12 fps=10`) })),
        other: { outline: ex("outline=true"), size: ex("size=256"), look: "looks action=save name=mine from=pixel-out/x.json; then pixelize image=y.jpg look=mine" },
      },
    };
  },
});

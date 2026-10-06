// pixelize additions from #107, kept out of tools.ts so lanes adding other inputs don't collide:
// the prompt path (prompt -> image provider -> pixelize) and effect loops (GIF + spritesheet + JSON).
import { join } from "node:path";
import { generateImage } from "../ai/images";
import { ProviderError } from "../ai/provider";
import { encodePng } from "../io/png";
import { animate, encodeAnimation } from "../pixel/effects";
import type { Effect, Mode, PixelResult, Rgba } from "../pixel/types";
import { ToolError } from "./registry";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "image";

/** Generate the source image for a prompt; provider failures become tool errors (already key-free). */
export async function imageFromPrompt(prompt: string, mode: Mode): Promise<{ img: Rgba; stem: string; png: Buffer }> {
  try {
    const img = await generateImage({ prompt, mode });
    return { img, stem: slug(prompt), png: encodePng(img) };
  } catch (e) {
    if (e instanceof ProviderError) throw new ToolError(`Image generation failed: ${e.message}`);
    throw e;
  }
}

export interface EffectFiles { gif: string; sheet: string; frames: string }

/** Animate `result` and write <name>-fx.gif (scaled), <name>-fx-sheet.png (native) and <name>-fx-frames.json. */
export function writeEffects(
  result: PixelResult,
  opts: { effects: Effect[]; frames: number; fps: number; seed: number; gifScale: number },
  dir: string,
  name: string,
  write: (path: string, data: Buffer | string) => void,
): { files: EffectFiles; frames: number; fps: number; stats: Record<string, number> } {
  try {
    const anim = animate(result, opts.effects, { frames: opts.frames, seed: opts.seed });
    const base = `${name}-fx`;
    const enc = encodeAnimation(anim, { fps: opts.fps, gifScale: opts.gifScale, sheetName: `${base}-sheet.png` });
    const files = { gif: join(dir, `${base}.gif`), sheet: join(dir, `${base}-sheet.png`), frames: join(dir, `${base}-frames.json`) };
    write(files.gif, enc.gif);
    write(files.sheet, enc.sheet);
    write(files.frames, JSON.stringify(enc.json, null, 2));
    return { files, frames: anim.frames.length, fps: enc.json.fps, stats: anim.stats };
  } catch (e) {
    throw new ToolError(`Effects failed: ${(e as Error).message}`);
  }
}

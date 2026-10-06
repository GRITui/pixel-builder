// Animation outputs: GIF (scaled, looping), spritesheet PNG (native size) and a frames JSON for engines.
import { encodeGif } from "../../io/gif";
import { encodePng } from "../../io/png";
import type { Rgba } from "../types";
import type { Animation } from "./animate";

export interface SheetLayout { columns: number; rows: number; frameWidth: number; frameHeight: number }

export function sheetLayout(count: number, fw: number, fh: number, columns?: number): SheetLayout {
  const columns_ = Math.max(1, Math.min(count, Math.round(columns ?? Math.min(count, 8))));
  return { columns: columns_, rows: Math.ceil(count / columns_), frameWidth: fw, frameHeight: fh };
}

/** Frames left-to-right, top-to-bottom; unused cells stay transparent. */
export function spritesheet(frames: Rgba[], columns?: number): { image: Rgba; layout: SheetLayout } {
  const { w, h } = frames[0];
  const layout = sheetLayout(frames.length, w, h, columns);
  const W = w * layout.columns, H = h * layout.rows, data = new Uint8ClampedArray(W * H * 4);
  frames.forEach((f, k) => {
    const ox = (k % layout.columns) * w, oy = Math.floor(k / layout.columns) * h;
    for (let y = 0; y < h; y++) data.set(f.data.subarray(y * w * 4, (y + 1) * w * 4), ((oy + y) * W + ox) * 4);
  });
  return { image: { w: W, h: H, data }, layout };
}

export interface FramesJson {
  frames: { index: number; x: number; y: number; w: number; h: number; duration_ms: number }[];
  fps: number;
  loop: true;
  width: number;
  height: number;
  columns: number;
  rows: number;
  effects: string[];
  palette: string[];
  image?: string;
}

export function framesJson(anim: Animation, layout: SheetLayout, fps: number, image?: string): FramesJson {
  const dur = Math.round(1000 / fps);
  return {
    frames: anim.frames.map((_, k) => ({ index: k, x: (k % layout.columns) * layout.frameWidth, y: Math.floor(k / layout.columns) * layout.frameHeight, w: layout.frameWidth, h: layout.frameHeight, duration_ms: dur })),
    fps, loop: true, width: layout.frameWidth, height: layout.frameHeight, columns: layout.columns, rows: layout.rows,
    effects: anim.effects, palette: anim.palette, ...(image ? { image } : {}),
  };
}

export interface AnimationFiles { gif: Buffer; sheet: Buffer; json: FramesJson }

/** Encode all outputs. `gifScale` is an integer nearest-neighbour upscale for the GIF only. */
export function encodeAnimation(anim: Animation, opts: { fps?: number; gifScale?: number; sheetName?: string; columns?: number } = {}): AnimationFiles {
  const fps = Math.min(50, Math.max(1, opts.fps ?? 10));
  if (anim.palette.length > 255) throw new Error(`GIF holds at most 255 colours; this palette has ${anim.palette.length}. Use a lower era for animated output.`);
  const { image, layout } = spritesheet(anim.frames, opts.columns);
  return {
    gif: encodeGif(anim.frames, { fps, scale: opts.gifScale ?? 1, loop: 0 }),
    sheet: encodePng(image),
    json: framesJson(anim, layout, fps, opts.sheetName),
  };
}

// Shared browser rendering helpers (owned by the integrator; lanes import, don't edit).
import { flattenPalette } from "../core/palette";
import { resolveRamps } from "../core/kit";
import type { Asset, FrameSet, Sprite, StyleKit } from "../core/types";

export type FlatPalette = (string | null)[];

export function paletteFor(kit: StyleKit): FlatPalette {
  return flattenPalette(resolveRamps(kit));
}

/** Draw a sprite at (x, y) on a 2D context, `scale` screen pixels per art pixel. */
export function drawSprite(ctx: CanvasRenderingContext2D, s: Sprite, pal: FlatPalette, x = 0, y = 0, scale = 1): void {
  for (let j = 0; j < s.h; j++)
    for (let i = 0; i < s.w; i++) {
      const c = pal[s.data[j * s.w + i]];
      if (!c) continue;
      ctx.fillStyle = c;
      ctx.fillRect(x + i * scale, y + j * scale, scale, scale);
    }
}

export function spriteToCanvas(s: Sprite, pal: FlatPalette, scale = 1): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = s.w * scale;
  c.height = s.h * scale;
  drawSprite(c.getContext("2d")!, s, pal, 0, 0, scale);
  return c;
}

/** Lay out every frame of every row into one sheet: one animation row per sheet row. */
export function buildSpritesheet(rows: FrameSet[], pal: FlatPalette, scale = 1): { canvas: HTMLCanvasElement; frameW: number; frameH: number } {
  const frameW = Math.max(...rows.flatMap((r) => r.frames.map((f) => f.w)));
  const frameH = Math.max(...rows.flatMap((r) => r.frames.map((f) => f.h)));
  const cols = Math.max(...rows.map((r) => r.frames.length));
  const c = document.createElement("canvas");
  c.width = cols * frameW * scale;
  c.height = rows.length * frameH * scale;
  const ctx = c.getContext("2d")!;
  rows.forEach((r, ri) => r.frames.forEach((f, fi) => drawSprite(ctx, f, pal, fi * frameW * scale, ri * frameH * scale, scale)));
  return { canvas: c, frameW, frameH };
}

export function canvasToBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
}

export function downloadBlob(blob: Blob, filename: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "asset";
}

/** First frame of the first row — the asset's thumbnail. */
export function thumbnailSprite(a: Asset): Sprite {
  return a.rows[0].frames[0];
}

/** Read an image file into RGBA pixels at its natural size. */
export async function fileToRGBA(file: File | Blob): Promise<{ data: Uint8ClampedArray; w: number; h: number }> {
  const bmp = await createImageBitmap(file);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  return { data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
}

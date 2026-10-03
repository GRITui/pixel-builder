import { hexToRgb } from "../../core/palette";
import type { Sprite } from "../../core/types";
import type { FlatPalette } from "../render";

/** RGBA bytes per palette index (4 each), aligned with sprite indices. */
export function rgbaTable(pal: FlatPalette): Uint8ClampedArray {
  const t = new Uint8ClampedArray(pal.length * 4);
  pal.forEach((hex, i) => {
    if (!hex) return;
    const [r, g, b] = hexToRgb(hex);
    t.set([r, g, b, 255], i * 4);
  });
  return t;
}

export interface Layer {
  sprite: Sprite | null | undefined;
  /** 0..255 opacity of this layer's pixels. */
  alpha: number;
}

/** Composite layers (later wins where it has a pixel) onto a canvas at 1 canvas px per art px. */
export function paintLayers(canvas: HTMLCanvasElement, w: number, h: number, layers: Layer[], table: Uint8ClampedArray): void {
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = ctx.createImageData(w, h);
  for (const { sprite, alpha } of layers) {
    if (!sprite || sprite.w !== w || sprite.h !== h) continue;
    for (let i = 0; i < sprite.data.length; i++) {
      const v = sprite.data[i];
      if (!v) continue;
      const o = i * 4, t = v * 4;
      img.data[o] = table[t];
      img.data[o + 1] = table[t + 1];
      img.data[o + 2] = table[t + 2];
      img.data[o + 3] = alpha;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Largest integer scale at which (w, h) fits inside `box` px (at least 1). */
export function fitScale(w: number, h: number, box: number): number {
  return Math.max(1, Math.floor(box / Math.max(1, w, h)));
}

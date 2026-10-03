import type { Sprite } from "./types";

export function createSprite(w: number, h: number, fill = 0): Sprite {
  return { w, h, data: new Array(w * h).fill(fill) };
}

export function cloneSprite(s: Sprite): Sprite {
  return { w: s.w, h: s.h, data: s.data.slice() };
}

export function getPx(s: Sprite, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) return 0;
  return s.data[y * s.w + x];
}

export function setPx(s: Sprite, x: number, y: number, v: number): void {
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) return;
  s.data[y * s.w + x] = v;
}

export function flipX(s: Sprite): Sprite {
  const out = createSprite(s.w, s.h);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) out.data[y * s.w + x] = s.data[y * s.w + (s.w - 1 - x)];
  return out;
}

/** Draw `src` onto `dst` at (dx, dy); transparent pixels are skipped. */
export function blit(dst: Sprite, src: Sprite, dx: number, dy: number): void {
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const v = src.data[y * src.w + x];
      if (v) setPx(dst, dx + x, dy + y, v);
    }
}

export function bounds(s: Sprite): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = s.w, y0 = s.h, x1 = -1, y1 = -1;
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++)
      if (s.data[y * s.w + x]) {
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

export function spritesEqual(a: Sprite, b: Sprite): boolean {
  return a.w === b.w && a.h === b.h && a.data.every((v, i) => v === b.data[i]);
}

/** Resize canvas (no scaling), anchoring content bottom-centre — good for sprites that stand on the ground. */
export function resizeCanvas(s: Sprite, w: number, h: number): Sprite {
  const out = createSprite(w, h);
  blit(out, s, Math.floor((w - s.w) / 2), h - s.h);
  return out;
}

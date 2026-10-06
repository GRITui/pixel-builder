// Synthetic inputs for sprite/tile tests: a shaded character-like shape on flat/gradient backgrounds, and a noisy texture with a visible seam.
import type { Rgba } from "./types";

export type Bg = [number, number, number] | "gradient";

/** Shaded ball with a hat and arms on a background, 200x240. */
export function shadedSubject(bg: Bg, w = 200, h = 240): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let c: number[] = bg === "gradient" ? [90 + (x / w) * 60, 150 + (y / h) * 50, 200 - (y / h) * 40] : [...bg];
    const dx = x - 100, dy = y - 140;
    const r = Math.hypot(dx, dy);
    const body = r < 70;
    const hat = Math.abs(x - 100) < 40 - (110 - y) * 0.2 && y > 55 && y < 90;
    const arm = Math.abs(y - 140 - (x < 100 ? -20 : 20) * 0.2) < 8 && Math.abs(dx) > 60 && Math.abs(dx) < 95;
    if (body) {
      const l = Math.max(0, Math.min(1, 0.5 - (dx * 0.5 + dy * 0.6) / 140 + (r / 70) * -0.1));
      c = [200 * l + 40, 60 * l + 30, 50 * l + 40];
    } else if (hat) c = [40, 70, 190];
    else if (arm) c = [220, 180, 120];
    data.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
  }
  return { w, h, data };
}

/** Value-noise stone-like texture whose left/right and top/bottom edges do NOT match. */
export function noiseTexture(n = 128): Rgba {
  const data = new Uint8ClampedArray(n * n * 4);
  const hash = (x: number, y: number) => {
    let h = Math.imul(x * 374761393 + y * 668265263, 1274126177);
    h ^= h >>> 13;
    return ((Math.imul(h, 1103515245) >>> 8) & 1023) / 1023;
  };
  const vn = (x: number, y: number, s: number) => {
    const gx = x / s, gy = y / s, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const t = 0.6 * vn(x, y, 24) + 0.3 * vn(x, y, 9) + 0.1 * vn(x, y, 3) + (x / n) * 0.35; // x ramp = guaranteed seam
    data.set([60 + t * 150, 70 + t * 130, 50 + t * 100, 255], (y * n + x) * 4);
  }
  return { w: n, h: n, data };
}

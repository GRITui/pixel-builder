import type { Rgba } from "./types";

/** Smooth RGB gradient, for tests. */
export function gradient(w: number, h: number): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([(x * 255) / w, (y * 255) / h, 128, 255], (y * w + x) * 4);
  return { w, h, data };
}

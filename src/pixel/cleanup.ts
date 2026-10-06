// Orphan cleanup: a pixel matching none of its 4 neighbours takes their majority (when >= 2 agree).
/** idx: palette index per pixel, -1 = transparent. Modified in place. */
export function cleanup(idx: Int32Array, w: number, h: number, passes: number): void {
  for (let p = 0; p < passes; p++) {
    const src = idx.slice();
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, v = src[i];
      if (v < 0) continue;
      const n = [src[i - w], src[i + w], src[i - 1], src[i + 1]];
      if (n.some((q) => q === v || q < 0)) continue;
      let best = -1, bc = 0;
      for (const q of n) { let c = 0; for (const r of n) if (r === q) c++; if (c > bc) { bc = c; best = q; } }
      if (bc >= 2) idx[i] = best;
    }
  }
}

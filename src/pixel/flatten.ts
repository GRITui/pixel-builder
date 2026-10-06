// Kuwahara flattening: each pixel takes the mean of the calmest of its 4 quadrants (edge-preserving).
// Uses summed-area tables so cost is independent of the radius.

/** rgb: float RGB (3/px) of size w*h; returns a new flattened array. */
export function kuwahara(rgb: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return rgb;
  const pw = w + 2 * r, ph = h + 2 * r, S = pw + 1;
  // 4 tables over the edge-padded image: sum of r, g, b and of squares (all channels).
  const T = [0, 1, 2, 3].map(() => new Float64Array(S * (ph + 1)));
  for (let y = 0; y < ph; y++) {
    const sy = Math.min(h - 1, Math.max(0, y - r));
    const acc = [0, 0, 0, 0];
    for (let x = 0; x < pw; x++) {
      const sx = Math.min(w - 1, Math.max(0, x - r)), o = (sy * w + sx) * 3;
      const r0 = rgb[o], g0 = rgb[o + 1], b0 = rgb[o + 2];
      acc[0] += r0; acc[1] += g0; acc[2] += b0; acc[3] += r0 * r0 + g0 * g0 + b0 * b0;
      for (let k = 0; k < 4; k++) T[k][(y + 1) * S + x + 1] = T[k][y * S + x + 1] + acc[k];
    }
  }
  const out = new Float32Array(rgb.length);
  const n = (r + 1) * (r + 1);
  const box = (t: Float64Array, x0: number, y0: number) => t[(y0 + r + 1) * S + x0 + r + 1] - t[y0 * S + x0 + r + 1] - t[(y0 + r + 1) * S + x0] + t[y0 * S + x0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let bestV = Infinity, br = 0, bg = 0, bb = 0;
    for (let dy = 0; dy <= r; dy += r) for (let dx = 0; dx <= r; dx += r) {
      const x0 = x + dx, y0 = y + dy; // padded coords of the window's top-left
      const sr = box(T[0], x0, y0), sg = box(T[1], x0, y0), sb = box(T[2], x0, y0), sq = box(T[3], x0, y0);
      const v = sq / n - (sr * sr + sg * sg + sb * sb) / (n * n);
      if (v < bestV) { bestV = v; br = sr / n; bg = sg / n; bb = sb / n; }
    }
    const o = (y * w + x) * 3;
    out[o] = br; out[o + 1] = bg; out[o + 2] = bb;
  }
  return out;
}

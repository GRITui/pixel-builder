// Hand-drawn style edges: where a much brighter region meets a darker one, the darker pixel steps down the lightness ramp.
/** idx: palette indices (-1 transparent); paletteL: OKLab L per palette entry. Modified in place. */
export function outline(idx: Int32Array, w: number, h: number, paletteL: number[], threshold = 0.28, steps = 2): void {
  const order = paletteL.map((_, i) => i).sort((a, b) => paletteL[a] - paletteL[b]);
  const rank = new Int32Array(order.length);
  order.forEach((p, r) => (rank[p] = r));
  const edge: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, v = idx[i];
    if (v < 0) continue;
    const L = paletteL[v];
    const up = y > 0 && idx[i - w] >= 0 ? paletteL[idx[i - w]] : L, lf = x > 0 && idx[i - 1] >= 0 ? paletteL[idx[i - 1]] : L;
    if (up - L > threshold || lf - L > threshold) edge.push(i);
  }
  for (const i of edge) idx[i] = order[Math.max(0, rank[idx[i]] - steps)];
}

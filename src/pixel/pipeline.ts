// PLACEHOLDER pipeline (issue #104): box downscale + k-means to N colours in OKLab.
// The core lane (#105) replaces the internals (presets, bloom, dither, outline, hardware palettes,
// sprite/tile modes). Keep the exported names and the PixelResult contract stable.
import { hexToRgb, labDist2, oklabToRgb, rgbToHex, rgbToOklab, type Vec3 } from "../color/oklab";
import { resizeBox, resizeLanczos } from "../io/resize";
import { ERAS, type PixelOptions, type PixelResult, type Rgba } from "./types";

/** Small seeded PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** k-means (k-means++ init) over OKLab points; returns centroids. */
export function kmeans(points: Vec3[], k: number, seed = 1, iters = 16): Vec3[] {
  const rand = rng(seed);
  k = Math.min(k, points.length);
  const c: Vec3[] = [points[Math.floor(rand() * points.length)]];
  const d = new Float64Array(points.length).fill(Infinity);
  while (c.length < k) {
    let sum = 0;
    const last = c[c.length - 1];
    for (let i = 0; i < points.length; i++) { d[i] = Math.min(d[i], labDist2(points[i], last)); sum += d[i]; }
    let r = rand() * sum, pick = 0;
    for (; pick < points.length - 1; pick++) { r -= d[pick]; if (r <= 0) break; }
    c.push(points[pick]);
  }
  for (let it = 0; it < iters; it++) {
    const acc = c.map(() => [0, 0, 0, 0]);
    for (const p of points) {
      let best = 0, bd = Infinity;
      for (let j = 0; j < c.length; j++) { const dd = labDist2(p, c[j]); if (dd < bd) { bd = dd; best = j; } }
      const a = acc[best]; a[0] += p[0]; a[1] += p[1]; a[2] += p[2]; a[3]++;
    }
    acc.forEach((a, j) => { if (a[3]) c[j] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
  }
  return c;
}

export function pixelize(img: Rgba, opts: PixelOptions = {}): PixelResult {
  const look = opts.look;
  const era = look?.era ?? opts.era ?? 16;
  const spec = ERAS[era];
  const mode = opts.mode ?? "scene";
  const seed = opts.seed ?? 1;
  const width = Math.max(1, Math.min(img.w, Math.round(opts.width ?? spec.width)));
  const height = Math.max(1, Math.round(opts.height ?? (img.h * width) / img.w));
  const big = resizeLanczos(img, width * 2, height * 2);
  const small = resizeBox(big, width, height);

  const pts: Vec3[] = [], at: number[] = [];
  for (let i = 0; i < width * height; i++) {
    if (small.data[i * 4 + 3] >= 128) { pts.push(rgbToOklab(small.data[i * 4], small.data[i * 4 + 1], small.data[i * 4 + 2])); at.push(i); }
  }
  const out = new Uint8ClampedArray(width * height * 4);
  let palette: string[] = [];
  if (pts.length) {
    const sample = pts.length > 8000 ? Array.from({ length: 8000 }, (_, i) => pts[Math.floor((i * pts.length) / 8000)]) : pts;
    const cent = look ? look.palette.map((h) => rgbToOklab(...hexToRgb(h))) : kmeans(sample, spec.colours, seed);
    const rgb = cent.map((c) => oklabToRgb(c[0], c[1], c[2]).map(Math.round));
    const used = new Set<number>();
    at.forEach((px, n) => {
      let best = 0, bd = Infinity;
      for (let j = 0; j < cent.length; j++) { const dd = labDist2(pts[n], cent[j]); if (dd < bd) { bd = dd; best = j; } }
      used.add(best);
      out.set([rgb[best][0], rgb[best][1], rgb[best][2], 255], px * 4);
    });
    palette = [...used].sort((a, b) => a - b).map((j) => rgbToHex(rgb[j][0], rgb[j][1], rgb[j][2]));
  }
  return {
    native: { w: width, h: height, data: out },
    palette,
    meta: {
      era, mode, width, height, colours: palette.length, seed,
      preset: look?.preset ?? opts.preset ?? "vivid",
      bloom: look?.bloom ?? opts.bloom ?? "off",
      dither: look?.dither ?? opts.dither ?? "off",
      outline: look?.outline ?? opts.outline ?? false,
      placeholder: true,
    },
  };
}

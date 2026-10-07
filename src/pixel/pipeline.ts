// Scene pixelizer (#105): lanczos 2x -> kuwahara -> box to native -> grade -> bloom -> palette ->
// calm-area ordered dither -> OKLab nearest -> orphan cleanup -> outline.
import { hexToRgb, labDist2, type Vec3 } from "../color/oklab";
import { resizeBox, resizeLanczos } from "../io/resize";
import { snap555 } from "../color/rgb555";
import { bloom } from "./bloom";
import { cleanup } from "./cleanup";
import { ditherCalm } from "./dither";
import { kuwahara } from "./flatten";
import { grade } from "./grade";
import { outline } from "./outline";
import { buildPalette, chromaWeight, Nearest, paletteHex, toLab, type Rgb } from "./palette";
import { rng } from "./rng";
import { ERAS, type PixelOptions, type PixelResult, type Rgba } from "./types";

export { rng };

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
  const preset = look?.preset ?? opts.preset ?? "vivid";
  const bloomLevel = look?.bloom ?? opts.bloom ?? "off";
  const ditherLevel = look?.dither ?? opts.dither ?? "off";
  const wantOutline = look?.outline ?? opts.outline ?? false;
  const width = Math.max(1, Math.min(img.w, Math.round(opts.width ?? spec.width)));
  const height = Math.max(1, Math.round(opts.height ?? (img.h * width) / img.w));
  const n = width * height;

  // Lanczos to 2x, flatten photo noise, then box down to the native grid.
  const big = resizeLanczos(img, width * 2, height * 2);
  const bigRgb = new Float32Array(big.w * big.h * 3);
  for (let i = 0; i < big.w * big.h; i++) { bigRgb[i * 3] = big.data[i * 4]; bigRgb[i * 3 + 1] = big.data[i * 4 + 1]; bigRgb[i * 3 + 2] = big.data[i * 4 + 2]; }
  const flat = kuwahara(bigRgb, big.w, big.h, spec.palette === "hardware-nes" ? 3 : 2);
  const flatBytes = new Uint8ClampedArray(big.w * big.h * 4);
  for (let i = 0; i < big.w * big.h; i++) flatBytes.set([flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2], big.data[i * 4 + 3]], i * 4);
  const small = resizeBox({ w: big.w, h: big.h, data: flatBytes }, width, height);
  const rgb = new Float32Array(n * 3);
  const opaque = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = small.data[i * 4]; rgb[i * 3 + 1] = small.data[i * 4 + 1]; rgb[i * 3 + 2] = small.data[i * 4 + 2];
    opaque[i] = small.data[i * 4 + 3] >= 128 ? 1 : 0;
  }

  grade(rgb, preset);
  bloom(rgb, width, height, bloomLevel);
  if (spec.palette === "rgb555") for (let i = 0; i < rgb.length; i++) rgb[i] = snap555(rgb[i]);

  const out = new Uint8ClampedArray(n * 4);
  const idx = new Int32Array(n).fill(-1);
  let pal: Rgb[] = [], used: number[] = [];
  const cw = chromaWeight(spec.palette);
  const ops: number[] = [];
  for (let i = 0; i < n; i++) if (opaque[i]) ops.push(i);
  if (ops.length) {
    const op = new Float32Array(ops.length * 3);
    ops.forEach((p, k) => op.set(rgb.subarray(p * 3, p * 3 + 3), k * 3));
    pal = look ? look.palette.map((h) => hexToRgb(h) as Rgb) : buildPalette({ rgb: op, count: spec.colours, rule: spec.palette, seed });
    const near = new Nearest(pal, cw);
    if (ditherLevel !== "off") {
      const lab = toLab(rgb, n, cw);
      ditherCalm(lab, width, height, near.paletteL, ditherLevel, opaque);
      for (const p of ops) idx[p] = near.byLab(lab[p * 3], lab[p * 3 + 1], lab[p * 3 + 2]);
    } else {
      for (const p of ops) idx[p] = near.byRgb(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]);
    }
    cleanup(idx, width, height, ditherLevel !== "off" ? 1 : 2);
    if (wantOutline) outline(idx, width, height, near.paletteL);
    const seen = new Set<number>();
    for (let i = 0; i < n; i++) {
      const j = idx[i];
      if (j < 0) continue;
      seen.add(j);
      out.set([pal[j][0], pal[j][1], pal[j][2], 255], i * 4);
    }
    used = [...seen].sort((a, b) => a - b);
  }
  // A locked look reports its whole palette so two images share it exactly; otherwise only colours in use.
  const palette = paletteHex(look ? pal : used.map((j) => pal[j]));
  return {
    native: { w: width, h: height, data: out },
    palette,
    meta: { era, mode, width, height, colours: used.length, seed, preset, bloom: bloomLevel, dither: ditherLevel, outline: wantOutline, placeholder: false },
  };
}

// Sprite mode (#106): key the background out of the full-res input, trim, fit to an exact size with a
// 1px transparent margin, pixelize only the subject, optional 1px outline. Alpha is always 0 or 255.
import { hexToRgb, oklabToRgb, rgbToHex, rgbToOklab, type Vec3 } from "../color/oklab";
import { resizeBox, resizeLanczos } from "../io/resize";
import { pixelize } from "./pipeline";
import type { PixelOptions, PixelResult, Rgba } from "./types";
import { validate } from "./validate";

export interface SpriteOptions {
  /** Background colour #rrggbb; default estimated from the image border. */
  bg?: string;
  /** OKLab distance override for the key; default derived from border variance. */
  tolerance?: number;
}

export interface KeyResult {
  /** 1 = subject, 0 = background. */
  mask: Uint8Array;
  tolerance: number;
  bg: string;
}

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function solve3(A: number[][], B: number[]): number[] | undefined {
  const M = A.map((r, i) => [...r, B[i]]);
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
    if (Math.abs(M[p][i]) < 1e-12) return undefined;
    [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < 3; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let q = i; q < 4; q++) M[r][q] -= f * M[i][q]; }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

/** Fit an OKLab plane c0 + cx*x + cy*y per channel to the border (handles flat and soft gradient backgrounds). */
function fitBackground(lab: Vec3[], w: number, h: number, seedBg?: Vec3) {
  const pts: number[] = [];
  for (let x = 0; x < w; x++) pts.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) pts.push(y * w, y * w + w - 1);
  const model = (x: number, y: number, c: number[][]): Vec3 => [0, 1, 2].map((k) => c[k][0] + c[k][1] * (x / w) + c[k][2] * (y / h)) as Vec3;
  if (seedBg) {
    const c = [0, 1, 2].map((k) => [seedBg[k], 0, 0]);
    return { at: (x: number, y: number) => model(x, y, c), std: 0 };
  }
  // robust: start from the median colour, keep border pixels near it, then least-squares plane
  const med = [0, 1, 2].map((k) => { const s = pts.map((i) => lab[i][k]).sort((a, b) => a - b); return s[s.length >> 1]; }) as Vec3;
  let use = pts.filter((i) => dist(lab[i], med) < 0.25);
  if (use.length < 8) use = pts;
  const c = [0, 1, 2].map(() => [0, 0, 0]);
  for (let k = 0; k < 3; k++) {
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], B = [0, 0, 0];
    for (const i of use) {
      const f = [1, (i % w) / w, Math.floor(i / w) / h];
      for (let r = 0; r < 3; r++) { B[r] += f[r] * lab[i][k]; for (let q = 0; q < 3; q++) A[r][q] += f[r] * f[q]; }
    }
    for (let r = 0; r < 3; r++) A[r][r] += 1e-6;
    c[k] = solve3(A, B) ?? [med[k], 0, 0];
  }
  const at = (x: number, y: number) => model(x, y, c);
  const res = use.map((i) => dist(lab[i], at(i % w, Math.floor(i / w))));
  const mean = res.reduce((s, v) => s + v, 0) / res.length;
  const std = Math.sqrt(res.reduce((s, v) => s + (v - mean) ** 2, 0) / res.length) + mean;
  return { at, std };
}

/** Background key on the full-res image: border flood fill in OKLab, fringe trim, small-island removal. */
export function keyBackground(img: Rgba, o: SpriteOptions = {}): KeyResult {
  const { w, h, data } = img;
  const lab: Vec3[] = new Array(w * h);
  for (let i = 0; i < w * h; i++) lab[i] = rgbToOklab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  const seedBg = o.bg ? rgbToOklab(...hexToRgb(o.bg)) : undefined;
  const fit = fitBackground(lab, w, h, seedBg);
  const tolerance = o.tolerance ?? Math.min(0.3, Math.max(0.07, 0.05 + 2.5 * fit.std));
  const isBg = (i: number) => data[i * 4 + 3] < 128 || dist(lab[i], fit.at(i % w, Math.floor(i / w))) < tolerance;

  const bg = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (i: number) => { if (!bg[i] && isBg(i)) { bg[i] = 1; stack.push(i); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const i = stack.pop()!, x = i % w, y = (i - x) / w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  // fringe: boundary pixels that are mostly background blended into the subject edge
  const fringeTol = tolerance * 1.7;
  const fringe: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (bg[i]) continue;
    const x = i % w, y = (i - x) / w;
    const nb = (x > 0 && bg[i - 1]) || (x < w - 1 && bg[i + 1]) || (y > 0 && bg[i - w]) || (y < h - 1 && bg[i + w]);
    if (nb && dist(lab[i], fit.at(x, y)) < fringeTol) fringe.push(i);
  }
  for (const i of fringe) bg[i] = 1;

  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = bg[i] ? 0 : 1;
  removeIslands(mask, w, h);
  const m = fit.at(w >> 1, h >> 1);
  const [r, g, b] = oklabToRgb(m[0], m[1], m[2]);
  return { mask, tolerance, bg: rgbToHex(r, g, b) };
}

const nbrs = (i: number, x: number, y: number, w: number, h: number) =>
  [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1].filter((j) => j >= 0);

/** Drop subject components smaller than 3% of the largest one. */
function removeIslands(mask: Uint8Array, w: number, h: number): void {
  const label = new Int32Array(w * h);
  const sizes: number[] = [0];
  for (let s = 0; s < w * h; s++) {
    if (!mask[s] || label[s]) continue;
    const id = sizes.length;
    let n = 0;
    const st = [s];
    label[s] = id;
    while (st.length) {
      const i = st.pop()!, x = i % w, y = (i - x) / w;
      n++;
      for (const j of nbrs(i, x, y, w, h)) if (mask[j] && !label[j]) { label[j] = id; st.push(j); }
    }
    sizes.push(n);
  }
  const keepMin = Math.max(...sizes) * 0.03;
  for (let i = 0; i < w * h; i++) if (mask[i] && sizes[label[i]] < keepMin) mask[i] = 0;
}

/** Extend subject colour into unmasked pixels (dilation, then the mean) so resampling and the palette see subject only. */
function fillBackground(data: Uint8ClampedArray, w: number, h: number, mask: Uint8Array, passes: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data);
  const have = Uint8Array.from(mask);
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < w * h; i++) if (mask[i]) { n++; for (let k = 0; k < 3; k++) sum[k] += out[i * 4 + k]; }
  const mean = sum.map((s) => (n ? s / n : 128));
  for (let pass = 0; pass < passes; pass++) {
    const next = Uint8Array.from(have);
    let changed = false;
    for (let i = 0; i < w * h; i++) {
      if (have[i]) continue;
      const c = nbrs(i, i % w, Math.floor(i / w), w, h).filter((j) => have[j]);
      if (!c.length) continue;
      for (let k = 0; k < 3; k++) out[i * 4 + k] = c.reduce((s, j) => s + out[j * 4 + k], 0) / c.length;
      next[i] = 1;
      changed = true;
    }
    have.set(next);
    if (!changed) break;
  }
  for (let i = 0; i < w * h; i++) {
    if (!have[i]) out.set(mean, i * 4);
    out[i * 4 + 3] = 255;
  }
  return out;
}

export function pixelizeSprite(img: Rgba, opts: PixelOptions = {}, extra: SpriteOptions = {}): PixelResult & { key: KeyResult } {
  const W = Math.max(8, Math.round(opts.width ?? 32));
  const H = Math.max(8, Math.round(opts.height ?? opts.width ?? 32));
  const outline = opts.look?.outline ?? opts.outline ?? false;
  const key = keyBackground(img, extra);
  const { w, h } = img;

  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let i = 0; i < w * h; i++) {
    if (!key.mask[i]) continue;
    const x = i % w, y = (i - x) / w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  if (x1 < 0) throw new Error("Sprite mode: no subject found after removing the background. Pass bg=#rrggbb or use scene mode.");
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;

  const cdata = new Uint8ClampedArray(bw * bh * 4);
  const cmask = new Uint8Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
    const s = (y0 + y) * w + x0 + x;
    cdata.set(img.data.subarray(s * 4, s * 4 + 4), (y * bw + x) * 4);
    cmask[y * bw + x] = key.mask[s];
  }
  const crop: Rgba = { w: bw, h: bh, data: fillBackground(cdata, bw, bh, cmask, 4) };

  const pad = outline ? 2 : 1;
  const scale = Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh);
  const sw = Math.max(1, Math.min(W - 2 * pad, Math.round(bw * scale)));
  const sh = Math.max(1, Math.min(H - 2 * pad, Math.round(bh * scale)));
  const ox = Math.floor((W - sw) / 2), oy = Math.floor((H - sh) / 2);

  // colour: resample the filled crop; coverage: resample the mask, then threshold (hard alpha)
  const smallRgb = resizeLanczos(crop, sw, sh);
  const maskImg: Rgba = { w: bw, h: bh, data: new Uint8ClampedArray(bw * bh * 4) };
  for (let i = 0; i < bw * bh; i++) maskImg.data.set([cmask[i] * 255, 0, 0, 255], i * 4);
  const smallMask = resizeBox(maskImg, sw, sh);

  const canvas = new Uint8ClampedArray(W * H * 4);
  const alpha = new Uint8Array(W * H);
  for (let y = oy; y < oy + sh; y++) for (let x = ox; x < ox + sw; x++) {
    const si = ((y - oy) * sw + (x - ox)) * 4;
    canvas.set(smallRgb.data.subarray(si, si + 3), (y * W + x) * 4);
    if (smallMask.data[si] >= 128) alpha[y * W + x] = 1;
  }
  // exactly the target size, background replaced by subject colour, so the palette is built from the subject
  const r = pixelize(
    { w: W, h: H, data: fillBackground(canvas, W, H, alpha, Math.max(W, H)) },
    { ...opts, mode: "scene", width: W, height: H, outline: false },
  );
  const out = r.native;
  for (let i = 0; i < W * H; i++) {
    if (alpha[i]) out.data[i * 4 + 3] = 255;
    else out.data.set([0, 0, 0, 0], i * 4);
  }
  let palette = [...new Set([...Array(W * H).keys()].filter((i) => alpha[i]).map((i) => rgbToHex(out.data[i * 4], out.data[i * 4 + 1], out.data[i * 4 + 2])))].sort();

  if (outline && palette.length) {
    const dark = palette.map((hx) => rgbToOklab(...hexToRgb(hx))).sort((a, b) => a[0] - b[0])[0];
    const [r2, g2, b2] = oklabToRgb(dark[0] * 0.45, dark[1] * 0.6, dark[2] * 0.6).map(Math.round);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (alpha[i]) continue;
      if (nbrs(i, x, y, W, H).some((j) => alpha[j])) out.data.set([r2, g2, b2, 255], i * 4);
    }
    palette = [...new Set([...palette, rgbToHex(r2, g2, b2)])].sort();
  }

  const rep = validate(out, { maxColours: 256 });
  if (!rep.ok) throw new Error(`Sprite validation failed: ${rep.issues.join("; ")}`);
  return {
    native: out,
    palette,
    meta: { ...r.meta, mode: "sprite", width: W, height: H, colours: palette.length, outline, bg: key.bg, tolerance: +key.tolerance.toFixed(3) },
    key,
  };
}

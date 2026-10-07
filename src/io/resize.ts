import type { Rgba } from "../pixel/types";

/** Integer nearest-neighbour upscale. */
export function upscale(img: Rgba, k: number): Rgba {
  k = Math.max(1, Math.floor(k));
  if (k === 1) return img;
  const W = img.w * k, out = new Uint8ClampedArray(W * img.h * k * 4);
  for (let y = 0; y < img.h * k; y++) {
    const sy = Math.floor(y / k);
    for (let x = 0; x < W; x++) {
      const s = (sy * img.w + Math.floor(x / k)) * 4, d = (y * W + x) * 4;
      out[d] = img.data[s]; out[d + 1] = img.data[s + 1]; out[d + 2] = img.data[s + 2]; out[d + 3] = img.data[s + 3];
    }
  }
  return { w: W, h: img.h * k, data: out };
}

/** Area (box) average resize, alpha-weighted. Good for downscaling. */
export function resizeBox(img: Rgba, w: number, h: number): Rgba {
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = img.w / w, sy = img.h / h;
  for (let y = 0; y < h; y++) {
    const y0 = y * sy, y1 = (y + 1) * sy;
    for (let x = 0; x < w; x++) {
      const x0 = x * sx, x1 = (x + 1) * sx;
      let r = 0, g = 0, b = 0, a = 0, wt = 0;
      for (let yy = Math.floor(y0); yy < Math.min(img.h, Math.ceil(y1)); yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        for (let xx = Math.floor(x0); xx < Math.min(img.w, Math.ceil(x1)); xx++) {
          const ww = wy * (Math.min(xx + 1, x1) - Math.max(xx, x0)), i = (yy * img.w + xx) * 4, al = img.data[i + 3] / 255;
          r += img.data[i] * al * ww; g += img.data[i + 1] * al * ww; b += img.data[i + 2] * al * ww; a += al * ww; wt += ww;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
      out[o + 3] = wt > 0 ? (a / wt) * 255 : 0;
    }
  }
  return { w, h, data: out };
}

const lanczos = (x: number): number => {
  if (x === 0) return 1;
  if (Math.abs(x) >= 3) return 0;
  const p = Math.PI * x;
  return (3 * Math.sin(p) * Math.sin(p / 3)) / (p * p);
};

/** Separable Lanczos-3 resize (opaque-weighted by alpha). Use for the 2x pre-scale before the box step. */
export function resizeLanczos(img: Rgba, w: number, h: number): Rgba {
  const pass = (src: Rgba, nw: number, nh: number, horiz: boolean): Rgba => {
    const out = new Uint8ClampedArray(nw * nh * 4);
    const scale = horiz ? src.w / nw : src.h / nh, support = Math.max(1, scale) * 3, fs = Math.max(1, scale);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const c = ((horiz ? x : y) + 0.5) * scale;
      const lo = Math.max(0, Math.ceil(c - support - 0.5)), hi = Math.min((horiz ? src.w : src.h) - 1, Math.floor(c + support - 0.5));
      let r = 0, g = 0, b = 0, a = 0, ws = 0;
      for (let t = lo; t <= hi; t++) {
        const wt = lanczos((t + 0.5 - c) / fs), i = ((horiz ? y * src.w + t : t * src.w + x)) * 4, al = src.data[i + 3] / 255;
        r += src.data[i] * al * wt; g += src.data[i + 1] * al * wt; b += src.data[i + 2] * al * wt; a += al * wt; ws += wt;
      }
      const o = (y * nw + x) * 4;
      if (a > 1e-6) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
      out[o + 3] = ws ? (a / ws) * 255 : 0;
    }
    return { w: nw, h: nh, data: out };
  };
  return pass(pass(img, w, img.h, true), w, h, false);
}

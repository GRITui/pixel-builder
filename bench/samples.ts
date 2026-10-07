// Eight synthetic eval images (no stock photos). Deterministic: same code, same pixels.
import { noiseTexture, shadedSubject } from "../src/pixel/modes.fixtures";
import type { Mode, Rgba } from "../src/pixel/types";

export interface Sample { name: string; mode: Mode; img: Rgba; note: string }

const hash = (x: number, y: number, s = 0) => {
  let h = Math.imul(x * 374761393 + y * 668265263 + s * 2246822519, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
const canvas = (w: number, h: number, f: (x: number, y: number) => number[]): Rgba => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = f(x, y); data.set([c[0], c[1], c[2], 255], (y * w + x) * 4); }
  return { w, h, data };
};
const glow = (x: number, y: number, cx: number, cy: number, r: number) => Math.max(0, 1 - Math.hypot(x - cx, y - cy) / r) ** 2;

function landscape(): Rgba {
  const w = 480, h = 300;
  return canvas(w, h, (x, y) => {
    const ridge = 170 + Math.sin(x / 40) * 18 + Math.sin(x / 13) * 5;
    if (y < ridge) {
      let c = mix([40, 90, 200], [255, 190, 120], (y / ridge) ** 1.6);
      c = mix(c, [255, 240, 200], glow(x, y, 360, 150, 90));
      return c;
    }
    return mix([40, 120, 50], [15, 55, 30], (y - ridge) / (h - ridge)).map((v, i) => v + (hash(x, y) - 0.5) * 18 * (i === 1 ? 1 : 0.5));
  });
}

function nightStreet(): Rgba {
  const w = 480, h = 300;
  const lamps = [[80, 120], [240, 110], [400, 125]];
  const signs: [number, number, number[]][] = [[150, 80, [255, 40, 160]], [320, 70, [40, 230, 255]]];
  return canvas(w, h, (x, y) => {
    let c = y > 200 ? mix([30, 30, 40], [12, 12, 20], (y - 200) / 100) : mix([10, 12, 35], [30, 20, 60], y / 200);
    const bx = Math.floor(x / 60);
    if (y > 60 + (bx % 3) * 25 && y <= 200) c = mix([18, 18, 28], [28, 24, 40], hash(bx, 1)).map((v) => v + ((x * 7 + y * 3) % 23 < 2 ? 10 : 0));
    if (y > 200) c = mix(c, [60, 70, 110], glow(x, y, 240, 240, 140) * 0.4);
    for (const [lx, ly] of lamps) c = mix(c, [255, 220, 140], Math.min(1, glow(x, y, lx, ly, 70) * 1.4 + (Math.hypot(x - lx, y - ly) < 5 ? 1 : 0)));
    for (const [sx, sy, sc] of signs) c = Math.abs(x - sx) < 28 && Math.abs(y - sy) < 9 ? sc : mix(c, sc, glow(x, y, sx, sy, 60) * 0.7);
    return c;
  });
}

function portrait(): Rgba {
  const w = 300, h = 380;
  return canvas(w, h, (x, y) => {
    let c = mix([70, 80, 100], [140, 150, 170], y / h);
    const dx = (x - 150) / 85, dy = (y - 170) / 115;
    const r = Math.hypot(dx, dy);
    if (y > 290 && Math.hypot((x - 150) / 140, (y - 400) / 120) < 1) c = mix([50, 70, 130], [30, 40, 90], x / w);
    if (r < 1) {
      const l = Math.max(0, Math.min(1, 0.65 - dx * 0.35 - dy * 0.25 + (1 - r) * 0.2));
      c = mix([120, 70, 55], [245, 200, 170], l);
      for (const ex of [-0.38, 0.38]) if (Math.hypot(dx - ex, dy + 0.15) < 0.12) c = [30, 25, 30];
      if (Math.abs(dx) < 0.28 && Math.abs(dy - 0.45 - dx * dx) < 0.04) c = [150, 60, 70];
    } else if (dy < -0.5 && r < 1.12) c = [50, 30, 25];
    return c;
  });
}

function waterScene(): Rgba {
  const w = 480, h = 300, hor = 130;
  return canvas(w, h, (x, y) => {
    if (y < hor) return mix([90, 160, 230], [250, 210, 170], y / hor);
    const t = (y - hor) / (h - hor);
    const wave = Math.sin(x / (6 + t * 10) + y * 0.9) * 0.5 + 0.5;
    let c = mix([40, 110, 160], [10, 50, 100], t);
    c = mix(c, [200, 230, 250], wave * 0.25 * (1 - t) + glow(x, y, 300, hor + 30, 120) * 0.4 * wave);
    return c;
  });
}

function colourChart(): Rgba {
  const w = 384, h = 256;
  return canvas(w, h, (x, y) => {
    if (y < 192) {
      const cx = Math.floor(x / 32), cy = Math.floor(y / 32);
      const hue = (cx / 12) * 360 + cy * 10, l = 0.35 + (cy % 3) * 0.2;
      const f = (n: number) => { const k = (n + hue / 30) % 12; return l - 0.45 * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
      return [f(0), f(8), f(4)].map((v) => Math.max(0, Math.min(255, v * 255)));
    }
    const g = (x / w) * 255, stripe = Math.floor((y - 192) / 16);
    return [[g, g, g], [g, 0, 0], [0, g, 0], [0, 0, g]][stripe % 4].map((v) => v + (hash(x, y) - 0.5) * 6);
  });
}

function brick(): Rgba {
  const n = 128;
  const base = noiseTexture(n);
  return canvas(n, n, (x, y) => {
    const row = Math.floor(y / 16), off = row % 2 ? 16 : 0;
    const bx = (x + off) % 32, by = y % 16;
    const mortar = bx < 2 || by < 2;
    const noise = (base.data[(y * n + x) * 4] - 128) / 6;
    const tint = hash(Math.floor((x + off) / 32), row, 3);
    return (mortar ? [170, 165, 155] : mix([150, 60, 45], [190, 95, 60], tint)).map((v) => v + noise);
  });
}

export function samples(): Sample[] {
  return [
    { name: "landscape", mode: "scene", img: landscape(), note: "gradient sky, hills, sun glow" },
    { name: "night-street", mode: "scene", img: nightStreet(), note: "dark scene with bright lamps and neon signs" },
    { name: "portrait", mode: "scene", img: portrait(), note: "shaded face shape" },
    { name: "water", mode: "scene", img: waterScene(), note: "sky over water (shimmer)" },
    { name: "colour-chart", mode: "scene", img: colourChart(), note: "high-detail hue grid and ramps" },
    { name: "sprite-green", mode: "sprite", img: shadedSubject([0, 200, 0]), note: "shaded object on flat green" },
    { name: "sprite-gradient", mode: "sprite", img: shadedSubject("gradient"), note: "shaded object on gradient background" },
    { name: "tile-brick", mode: "tile", img: brick(), note: "noisy brick texture" },
  ];
}

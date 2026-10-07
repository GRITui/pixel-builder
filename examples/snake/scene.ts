// Title-screen source: a soft-lit meadow (sky, clouds, hills, trees, bushes, flowers, a friendly snake and an apple).
import { rng } from "../../src/pixel/rng";
import { Canvas, clamp, fbm, hex, mix, mul, skin, smooth, type C } from "./render";

const sphere = (cv: Canvas, cx: number, cy: number, r: number, dark: C, mid: C, light: C, seed: number, leafy = 0) => {
  cv.shape((x, y) => Math.hypot(x - cx, y - cy) - r, (x, y) => {
    const nx = (x - cx) / r, ny = (y - cy) / r, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
    let L = clamp(0.3 + 0.8 * (nz * 0.5 - nx * 0.5 - ny * 0.6));
    if (leafy) L = clamp(L + leafy * (fbm(x / (r * 0.18), y / (r * 0.18), seed, 3) - 0.5));
    let c = mix(dark, mid, smooth(0.1, 0.6, L));
    c = mix(c, light, smooth(0.6, 1, L));
    return c;
  }, [cx - r - 2, cy - r - 2, cx + r + 2, cy + r + 2]);
};

export function titleScene(W = 1280, H = 960): Canvas {
  const cv = new Canvas(W, H, [0, 0, 0]), r = rng(77);
  const hor = H * 0.52;
  // sky
  cv.fill((x, y) => {
    const t = clamp(y / hor);
    let c = mix(hex("#3f8ae8"), hex("#b8e4ff"), Math.pow(t, 0.8));
    const sd = Math.hypot((x - W * 0.82) / W, (y - H * 0.16) / H);
    c = mix(c, hex("#fff6c8"), 0.55 * Math.exp(-sd * sd * 90));
    return c;
  });
  // clouds: soft fbm blobs kept to the sides and the horizon, leaving the middle-top calm for the title
  cv.fill((x, y) => {
    const base = [cv.d[(Math.floor(y) * W + Math.floor(x)) * 3], cv.d[(Math.floor(y) * W + Math.floor(x)) * 3 + 1], cv.d[(Math.floor(y) * W + Math.floor(x)) * 3 + 2]] as C;
    if (y > hor) return base;
    const calm = smooth(0.18, 0.4, Math.abs(x / W - 0.5)) * 0.9 + smooth(0.18, 0.34, y / H) * 0.9;
    const n = fbm(x / 170, y / 90, 4, 5);
    const dens = smooth(0.52, 0.72, n - 0.18 * (1 - Math.min(1, calm)));
    if (dens <= 0) return base;
    const shade = clamp(0.78 + 0.35 * (fbm(x / 170 + 0.4, y / 90 + 0.5, 4, 5) - n) * 3 + 0.12 * ((hor - y) / hor));
    return mix(base, mul(hex("#ffffff"), clamp(shade, 0.9, 1)), dens * 0.95);
  });
  // far hills
  const ridge = (x: number, y0: number, a: number, f: number, p: number) => y0 + a * Math.sin(x * f + p) + a * 0.5 * Math.sin(x * f * 2.3 + p * 2);
  cv.shape((x, y) => ridge(x, hor - 25, 22, 0.006, 1) - y, (_x, y) => mix(hex("#7fb3c8"), hex("#9ccbb0"), smooth(hor - 80, hor + 20, y)));
  cv.shape((x, y) => ridge(x, hor + 5, 18, 0.0075, 4) - y, (_x, y) => mix(hex("#58a860"), hex("#3f9a50"), smooth(hor - 20, hor + 90, y)));
  // trees on the hills
  const tree = (x: number, base: number, s: number, seed: number) => {
    cv.shape((px, py) => Math.max(Math.abs(px - x) - 6 * s, base - py - 70 * s, py - base), (px) => mix(hex("#3e2412"), hex("#7a4e28"), smooth(x - 6 * s, x + 6 * s, px)));
    const blobs: [number, number, number][] = [[0, -95, 52], [-38, -68, 40], [38, -66, 42], [0, -50, 46], [-18, -118, 32], [22, -112, 30]];
    blobs.forEach(([dx, dy, rr], k) => sphere(cv, x + dx * s, base + dy * s, rr * s, hex("#14501f"), hex("#2f8a35"), hex("#8fd05a"), seed + k, 0.5));
  };
  for (const [x, s] of [[130, 0.9], [330, 0.62], [980, 0.7], [1150, 1.0], [1260, 0.55]] as [number, number][]) tree(x, ridge(x, hor + 5, 18, 0.0075, 4) + 40 * s, s, Math.floor(x));
  // near meadow
  const mTop = (x: number) => H * 0.6 + 14 * Math.sin(x * 0.005 + 2) + 8 * Math.sin(x * 0.013);
  cv.shape((x, y) => mTop(x) - y, (x, y) => {
    const t = clamp((y - H * 0.6) / (H * 0.4));
    const n = fbm(x / 90, y / 40, 8, 4);
    return mix(mix(hex("#55b845"), hex("#2f8f36"), t), hex("#7fd05a"), (n - 0.45) * 0.7 + 0.1);
  });
  // bushes
  const bush = (x: number, y: number, s: number, berries: boolean) => {
    for (const [dx, dy, rr] of [[-40, 0, 34], [0, -14, 42], [42, 2, 32], [4, 8, 38]]) sphere(cv, x + dx * s, y + dy * s, rr * s, hex("#12501d"), hex("#2b8a35"), hex("#7ccc55"), Math.floor(x + dx), 0.55);
    if (berries) for (let i = 0; i < 9; i++) { const bx = x + (r() - 0.5) * 90 * s, by = y + (r() - 0.7) * 50 * s; sphere(cv, bx, by, 5 * s, hex("#7a0a18"), hex("#d02030"), hex("#ff8a80"), 1); }
  };
  bush(260, H * 0.64, 1.0, true);
  bush(1040, H * 0.66, 1.15, false);
  // blades + flowers scattered over the meadow, denser and bigger toward the viewer
  for (let i = 0; i < 2600; i++) {
    const y = H * 0.62 + Math.pow(r(), 0.8) * H * 0.4, x = r() * W, t = (y - H * 0.6) / (H * 0.4), len = 14 + 38 * t, lean = (r() - 0.5) * 0.7;
    const col = mix(hex("#2a7a2e"), r() > 0.5 ? hex("#8be05a") : hex("#6cc84a"), 0.4 + 0.6 * r());
    for (let k = 0; k <= 8; k++) {
      const u = k / 8, qx = x + lean * len * u * u, qy = y - len * u, w = (2.4 + 2 * t) * (1 - u) + 0.4;
      cv.shape((px, py) => Math.hypot(px - qx, py - qy) - w, () => mul(col, 0.75 + 0.3 * u), [qx - w - 2, qy - w - 2, qx + w + 2, qy + w + 2]);
    }
  }
  const flower = (x: number, y: number, s: number, petal: C) => {
    cv.shape((px, py) => Math.max(Math.abs(px - x) - 1.5 * s, y + 24 * s - py, py - y - 22 * s), () => hex("#2f7a2e"));
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; sphere(cv, x + Math.cos(a) * 8 * s, y + Math.sin(a) * 8 * s, 6.5 * s, mul(petal, 0.7), petal, mix(petal, [1, 1, 1], 0.6), 1); }
    sphere(cv, x, y, 6 * s, hex("#b07a00"), hex("#f4c020"), hex("#fff2a0"), 2);
  };
  const fl: C[] = [hex("#ffffff"), hex("#ff9ac8"), hex("#ffd84a"), hex("#c8a0ff")];
  for (let i = 0; i < 16; i++) {
    const y = H * 0.66 + Math.pow(r(), 1.2) * H * 0.3, x = r() * W;
    if (x > 380 && x < 900 && y > H * 0.72) continue;
    flower(x, y, 0.6 + 0.9 * ((y - H * 0.6) / (H * 0.4)), fl[i % 4]);
  }
  // friendly snake: an S curve in the foreground, head up on the right
  const pts: [number, number, number][] = [];
  for (let t = 0; t <= 1; t += 0.004) pts.push([380 + t * 520, H * 0.86 + Math.sin(t * Math.PI * 2.4 + 0.6) * 46 - t * 30, 20 + 22 * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5)]);
  cv.shape((x, y) => { let d = 1e9; for (let i = 0; i < pts.length; i += 3) d = Math.min(d, Math.hypot(x - pts[i][0] + 10, (y - pts[i][1] - 30) * 2.2) - pts[i][2]); return d; }, (_x, _y, d) => mix([0.2, 0.5, 0.2], [0.1, 0.32, 0.14], 0.55 * smooth(0.5, -10, d)), [300, H * 0.7, 1000, H]);
  const seg: number[] = [0];
  pts.forEach((q, i) => { if (i) seg.push(seg[i - 1] + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1])); });
  const len = seg[seg.length - 1];
  let qx = -1, qy = -1, qr = { d: 0, i: 0, side: 1 };
  const near = (x: number, y: number) => {
    if (x === qx && y === qy) return qr;
    let bd = 1e18, bi = 0;
    for (let i = 0; i < pts.length; i++) { const d = (x - pts[i][0]) ** 2 + (y - pts[i][1]) ** 2 - pts[i][2] ** 2 * 0; if (d < bd) { bd = d; bi = i; } }
    const j = Math.min(pts.length - 1, bi + 1), tx = pts[j][0] - pts[bi][0], ty = pts[j][1] - pts[bi][1];
    qx = x; qy = y; qr = { d: Math.sqrt(bd), i: bi, side: Math.sign(tx * (y - pts[bi][1]) - ty * (x - pts[bi][0])) || 1 };
    return qr;
  };
  cv.shape((x, y) => { const q = near(x, y); return q.d - pts[q.i][2]; }, (x, y) => { const q = near(x, y); return skin(clamp((q.side * q.d) / pts[q.i][2], -1, 1), seg[q.i], 12); }, [300, H * 0.7, 1000, H]);
  const [hx, hy, hr] = pts[pts.length - 1];
  const hxr = hx + hr * 0.5;
  cv.shape((x, y) => Math.hypot((x - hxr) / 1.45, (y - hy) / 1.1) - hr * 1.05, (x, y) => skin(clamp((y - hy) / (hr * 1.1), -1, 1) * 0.9, len + (x - hxr), 12), [hxr - hr * 2, hy - hr * 1.5, hxr + hr * 2, hy + hr * 1.5]);
  for (const sg of [-1, 1]) {
    sphere(cv, hxr + hr * 0.2, hy + sg * hr * 0.62, hr * 0.34, hex("#c8c880"), hex("#fffbd0"), [1, 1, 1], 1);
    sphere(cv, hxr + hr * 0.3, hy + sg * hr * 0.62, hr * 0.19, [0, 0, 0], [0.04, 0.03, 0.03], [0.3, 0.3, 0.3], 1);
  }
  // tongue
  cv.shape((x, y) => Math.max(Math.abs(y - hy) - 3, hxr + hr * 1.5 - x, x - hxr - hr * 2.4), () => hex("#d81e3c"));
  // apple beside it
  const ax = 1030, ay = H * 0.9, ar = 54;
  cv.shape((x, y) => Math.hypot((x - ax) / 1.4, (y - ay - 40) * 1.6) - ar * 0.8, () => [0.12, 0.35, 0.12]);
  sphere(cv, ax, ay, ar, hex("#6e0a14"), hex("#d6232c"), hex("#ff7a62"), 3, 0.15);
  cv.shape((x, y) => Math.hypot((x - ax + ar * 0.4) / 0.2, (y - ay + ar * 0.42) / 0.12) - ar, () => [1, 1, 1]);
  cv.shape((x, y) => Math.max(Math.abs(x - ax) - 4, ay - ar * 0.85 - y, y - ay + ar * 0.5), () => hex("#5a3818"));
  cv.shape((x, y) => Math.hypot((x - ax - 22) / 2.1, (y - ay + ar * 1.0 + 4)) - 10, () => hex("#4aa83a"));
  return cv;
}

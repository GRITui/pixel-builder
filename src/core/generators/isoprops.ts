// Isometric variants of the `environment` and `object` generators (kit.camera === "iso").
//
// Every prop stands on one diamond cell: the foot is the cell centre, the sprite is `T` wide (wider for
// big trees) and keeps a transparent row under the foot (`ISO_PROP_MARGIN`), exactly like `iso-prop`.
// Volumes use the lit Painter with the screen-space iso normals (top / SW wall lit / SE wall shaded);
// only details (stems, hoops, sparkles) use explicit ramp levels. The props are also registered as
// `iso-prop` kinds so a map can place them directly.
import { finalize } from "../enforce";
import { proportions } from "../kit";
import { Painter } from "../painter";
import type { Material } from "../palette";
import { rng, type Rng } from "../rng";
import { blit, bounds, createSprite } from "../sprite";
import type { FrameSet, Sprite, StyleKit } from "../types";
import { foliageGenerator, FOLIAGE_SPECIES } from "./foliage";
import { ISO_PROP_MARGIN, isoProp, isoTile, isoTileW, N, registerIsoProp, TOP, WALL_SE, WALL_SW, type IsoPropKind, type IsoTileKind, type Vec3 } from "./iso";
import { bool, mat, num, str, type GenResult, type Params } from "./types";

type Pt = [number, number];
interface Mats { leaf: Material; wood: Material; stone: Material; accent: Material }

// -------------------------------------------------------------------------- canvas + shape helpers

function canvas(kit: StyleKit, h: number, wide?: number) {
  const T = isoTileW(kit), W = Math.max(T, wide ?? T);
  const P = new Painter(W, h, kit);
  return { P, T, TH: T / 2, W, k: T / 32, fx: W / 2, fy: h - ISO_PROP_MARGIN - T / 4 };
}
const cellH = (kit: StyleKit) => isoTileW(kit) / 2 + ISO_PROP_MARGIN;
const R = Math.round;

/** World px -> screen: u runs SE, v runs SW (a world px along either axis moves 1 screen px across and 1/2 down). */
const wp = (fx: number, fy: number, u: number, v: number, z: number): Pt => [fx + (u - v), fy + (u + v) / 2 - z];

/** Axis-aligned iso block centred (cu, cv) on the foot: SW wall lit, SE wall shaded, lit top. */
function block(P: Painter, fx: number, fy: number, hu: number, hv: number, z0: number, z1: number, m: Material, o: { cu?: number; cv?: number; tone?: number } = {}) {
  const cu = o.cu ?? 0, cv = o.cv ?? 0, t = o.tone ?? 0;
  const q = (pts: [number, number, number][], n: Vec3, tone = t) => P.poly(pts.map(([u, v, z]) => wp(fx, fy, u, v, z)), m, n, { tone });
  q([[cu - hu, cv + hv, z0], [cu + hu, cv + hv, z0], [cu + hu, cv + hv, z1], [cu - hu, cv + hv, z1]], WALL_SW);
  q([[cu + hu, cv + hv, z0], [cu + hu, cv - hv, z0], [cu + hu, cv - hv, z1], [cu + hu, cv + hv, z1]], WALL_SE);
  q([[cu - hu, cv - hv, z1], [cu + hu, cv - hv, z1], [cu + hu, cv + hv, z1], [cu - hu, cv + hv, z1]], TOP);
}

/** Flat horizontal ellipse (the lit top of a barrel, stump, pot) as a polygon so it takes the TOP shade. */
function disc(P: Painter, cx: number, cy: number, rx: number, ry: number, m: Material, tone = 0, n: Vec3 = TOP) {
  const pts: Pt[] = Array.from({ length: 20 }, (_, i) => [cx + Math.cos((i / 20) * Math.PI * 2) * rx, cy + Math.sin((i / 20) * Math.PI * 2) * ry]);
  P.poly(pts, m, n, { tone });
}

/** A vertical drum on the ground: round side shading, a lower rim that follows the ground ellipse and a lit elliptical top. */
function drum(P: Painter, cx: number, baseY: number, rx: number, h: number, m: Material, o: { tone?: number; topTone?: number } = {}) {
  const x0 = Math.round(cx - rx), w = Math.max(2, Math.round(rx * 2));
  for (let i = 0; i < w; i++) {
    const u = ((i + 0.5) / w) * 2 - 1, nz = Math.sqrt(Math.max(0, 1 - u * u));
    const y0 = Math.round(baseY - h), y1 = Math.round(baseY + (rx / 2) * nz);
    P.box(x0 + i, y0, 1, Math.max(1, y1 - y0), m, [u, 0.05, nz + 0.15], { tone: o.tone ?? 0 });
  }
  disc(P, cx, baseY - h, rx, rx / 2, m, o.topTone ?? 1);
}


// -------------------------------------------------------------------------- environment props

function palm(kit: StyleKit, seed: number, variant: number, m: Mats): Sprite {
  const pr = proportions(kit), r = rng(seed * 7 + variant);
  const th = R(pr.tree * 0.95), { P, fx, fy, k } = canvas(kit, th + cellH(kit) + 2, isoTileW(kit) + 8);
  const lean = (variant % 2 ? -1 : 1) * R(3 * k);
  const top: Pt = [fx + lean, fy - th * 0.74];
  P.capsule(fx, fy, fx + lean * 0.4, fy - th * 0.4, Math.max(2.4, 3 * k), m.wood, { tone: 0 });
  P.capsule(fx + lean * 0.4, fy - th * 0.4, top[0], top[1], Math.max(2, 2.5 * k), m.wood, { tone: 0 });
  for (let z = 3; z < th * 0.7; z += 4) { const t = z / (th * 0.74), x = fx + lean * (t < 0.5 ? t * 0.8 : 0.4 + (t - 0.5) * 1.2); P.px(R(x), R(fy - z), m.wood, 1); }
  // fronds: a lit leaf blade per direction, drooping at the tip
  const fronds = 7;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + r.next() * 0.3, len = T(kit) * (0.6 + 0.1 * r.next());
    const dx = Math.cos(a), dy = Math.sin(a) * 0.45;
    const tip: Pt = [top[0] + dx * len, top[1] + dy * len + len * 0.25 + (dy < 0 ? 3 : 0)];
    const mid: Pt = [top[0] + dx * len * 0.55, top[1] + dy * len * 0.55 - 3];
    const nrm: Vec3 = [dx * 0.8, -0.2, 0.7];
    P.poly([top, [mid[0] - dy * 6, mid[1] - 4], tip, [mid[0] + dy * 6, mid[1] + 3]], m.leaf, nrm, { tone: i % 2 ? 0 : -1 });
  }
  P.ellipse(top[0], top[1] + 1, 2.4 * k, 2 * k, m.accent === "cloth2" ? "wood" : m.accent, { tone: -1 }); // coconuts
  return finalize(P.toSprite(), kit);
}
const T = (kit: StyleKit) => isoTileW(kit);

function deadTree(kit: StyleKit, seed: number, variant: number, m: Mats): Sprite {
  const pr = proportions(kit), r = rng(seed * 11 + variant);
  const th = R(pr.tree * 0.85), { P, fx, fy, k } = canvas(kit, th + cellH(kit), isoTileW(kit) + 4);
  P.capsule(fx, fy - 2, fx, fy - th * 0.62, Math.max(2.4, 3 * k), m.wood, { tone: -1 });
  P.box(R(fx - 3.5 * k), R(fy - 2), R(7 * k), 2, m.wood, WALL_SW, { tone: -1 }); // root flare
  const limb = (x: number, y: number, dx: number, dy: number, rad: number, depth: number) => {
    const x1 = x + dx, y1 = y + dy;
    P.capsule(x, y, x1, y1, rad, m.wood, { tone: -1 });
    if (depth > 0) { limb(x1, y1, dx * 0.7 + (r.chance(0.5) ? 2 : -2), dy * 0.8 - 1, Math.max(0.9, rad - 0.5), depth - 1); }
  };
  const y0 = fy - th * 0.62;
  limb(fx, y0 + 4, -T(kit) * 0.2, -th * 0.18, Math.max(1.2, 1.7 * k), 1);
  limb(fx, y0 + 1, T(kit) * 0.22, -th * 0.2, Math.max(1.2, 1.6 * k), 1);
  limb(fx, y0 - 5, -2, -th * 0.2, 1, 0);
  return finalize(P.toSprite(), kit);
}

function stump(kit: StyleKit, seed: number, variant: number, m: Mats): Sprite {
  const { P, fx, fy, k } = canvas(kit, R(14 * (T(kit) / 32)) + cellH(kit));
  const rx = 6 * k, h = 8 * k + (variant % 3);
  drum(P, fx, fy, rx, h, m.wood);
  disc(P, fx, fy - h, rx - 1, rx / 2 - 0.5, m.wood, 2);
  P.line(fx - rx * 0.5, fy - h + 0.5, fx + rx * 0.4, fy - h - 0.5, m.wood, 1); // growth ring
  P.px(R(fx), R(fy - h), m.wood, 1);
  P.box(R(fx - rx - 1), R(fy - 2), 3, 2, m.wood, WALL_SW, { tone: -1 }); // roots
  P.box(R(fx + rx - 1), R(fy - 2), 3, 2, m.wood, WALL_SE, { tone: -1 });
  void seed;
  return finalize(P.toSprite(), kit);
}

/** Random cell-interior positions (u, v in world px, |u|+|v| inside the diamond) sorted back to front. */
function scatter(r: Rng, n: number, rad: number, minD: number): [number, number][] {
  const out: [number, number][] = [];
  for (let tries = 0; tries < 60 && out.length < n; tries++) {
    const u = r.int(-rad, rad), v = r.int(-rad, rad);
    if (Math.abs(u) + Math.abs(v) > rad * 1.2) continue;
    if (out.some(([a, b]) => Math.hypot(a - u, b - v) < minD)) continue;
    out.push([u, v]);
  }
  return out.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
}

function flowers(kit: StyleKit, seed: number, variant: number, m: Mats): Sprite {
  const { P, fx, fy, k } = canvas(kit, R(12 * k0(kit)) + cellH(kit));
  const r = rng(seed * 13 + variant);
  const spots = scatter(r, Math.max(3, R(7 * k)), R(9 * k), Math.max(2, 4 * k));
  for (const [u, v] of spots) {
    const [x, y] = wp(fx, fy, u, v, 0);
    const h = R((4 + r.int(0, 3)) * k);
    P.px(R(x), R(y) - 1, m.leaf, 1);
    P.line(x, y - 1, x, y - h, m.leaf, 2);
    P.px(R(x) - 1, R(y) - R(h / 2), m.leaf, 2); // leaf
    const hx = R(x), hy = R(y) - h;
    P.box(hx - 1, hy - 1, 3, 2, m.accent, TOP, { tone: 1 });
    P.px(hx, hy - 1, "gold", 3);
  }
  return finalize(P.toSprite(), kit);
}
const k0 = (kit: StyleKit) => isoTileW(kit) / 32;

function mushrooms(kit: StyleKit, seed: number, variant: number, m: Mats): Sprite {
  const { P, fx, fy, k } = canvas(kit, R(12 * k0(kit)) + cellH(kit));
  const r = rng(seed * 17 + variant);
  const spots = scatter(r, 3, R(6 * k), Math.max(4, 6 * k));
  for (const [u, v] of spots) {
    const [x, y] = wp(fx, fy, u, v, 0);
    const big = r.chance(0.5), h = R((big ? 5 : 3) * k), rw = Math.max(2, (big ? 4 : 3) * k);
    P.cylinder(R(x) - 1, R(y) - h, 2, h, "sand", { tone: 1 });
    P.ellipse(x, y - h - 0.5, rw, rw * 0.62, m.accent === "cloth2" ? "cloth2" : m.accent);
    P.px(R(x) - 1, R(y - h - 1), "sand", 4);
    if (big) P.px(R(x) + 1, R(y - h), "sand", 4);
  }
  return finalize(P.toSprite(), kit);
}

function tallGrass(kit: StyleKit, seed: number, variant: number, m: Mats): Sprite {
  const { P, fx, fy, k } = canvas(kit, R(16 * k0(kit)) + cellH(kit));
  const r = rng(seed * 19 + variant);
  const spots = scatter(r, Math.max(5, R(9 * k)), R(8 * k), Math.max(2, 2.5 * k));
  for (const [u, v] of spots) {
    const [x, y] = wp(fx, fy, u, v, 0);
    const h = R((7 + r.int(0, 6)) * k), lean = r.int(-2, 2), w = Math.max(1.5, 1.8 * k);
    P.poly([[x - w, y], [x + w, y], [x + lean, y - h]], m.leaf, lean < 0 ? WALL_SW : WALL_SE, { tone: r.chance(0.4) ? 1 : 0 });
  }
  return finalize(P.toSprite(), kit);
}

function crystal(kit: StyleKit, seed: number, variant: number, m: Mats): Sprite {
  const { P, fx, fy, k } = canvas(kit, R(24 * k0(kit)) + cellH(kit));
  const r = rng(seed * 23 + variant);
  P.ellipse(fx, fy - 2 * k, 8 * k, 3.5 * k, m.stone, { tone: -1 });
  const gem = m.accent === "cloth2" ? "water" : m.accent;
  const shard = (cx: number, h: number, w: number, tone = 0) => {
    const base = fy - 2 * k, tip: Pt = [cx + r.int(-1, 1), base - h];
    P.poly([tip, [cx - w, base - h * 0.55], [cx - w * 0.8, base], [cx, base + 1]], gem, WALL_SW, { tone });
    P.poly([tip, [cx, base + 1], [cx + w * 0.8, base], [cx + w, base - h * 0.55]], gem, WALL_SE, { tone });
    P.px(R(tip[0]) - 1, R(tip[1]) + 3, gem, 4);
  };
  shard(fx - 5 * k, 11 * k, 3.2 * k, -1);
  shard(fx + 5 * k, 9 * k, 3 * k, -1);
  shard(fx, 17 * k + (variant % 3), 4.6 * k);
  return finalize(P.toSprite(), kit);
}

function boulder(kit: StyleKit, seed: number, variant: number, m: Mats): Sprite {
  const { P, fx, fy, k, T: Tw } = canvas(kit, R(Tw0(kit) * 0.62) + cellH(kit));
  const rh = R(Tw * 0.5);
  P.ellipse(fx - 6 * k, fy - 3 * k, Tw * 0.24, rh * 0.36, m.stone, { tone: -1 });
  P.ellipse(fx + 7 * k, fy - 4 * k, Tw * 0.22, rh * 0.4, m.stone, { tone: -1 });
  P.ellipse(fx, fy - rh * 0.45, Tw * 0.36, rh * 0.52, m.stone);
  P.line(fx - 1, fy - rh * 0.55, fx + 2, fy - rh * 0.15, m.stone, 1);
  P.box(R(fx - 3), R(fy - rh * 0.85), 4, 1, m.stone, TOP, { tone: 1 });
  void seed; void variant;
  return finalize(P.toSprite(), kit);
}
const Tw0 = (kit: StyleKit) => isoTileW(kit);

function well(kit: StyleKit, seed: number, variant: number, m: Mats): Sprite {
  const { P, fx, fy, k } = canvas(kit, R(36 * k0(kit)) + cellH(kit));
  // stone ring: back half first, water, front half
  block(P, fx, fy, 8 * k, 8 * k, 0, 8 * k, m.stone);
  const [wx, wy] = wp(fx, fy, 0, 0, 8 * k);
  P.poly([wp(fx, fy, -5 * k, -5 * k, 8 * k), wp(fx, fy, 5 * k, -5 * k, 8 * k), wp(fx, fy, 5 * k, 5 * k, 8 * k), wp(fx, fy, -5 * k, 5 * k, 8 * k)], "water", TOP, { tone: -1 });
  P.px(R(wx), R(wy), "water", 3);
  for (let z = 3; z < 8 * k; z += 3) for (const [u, v, n] of [[0, 8, WALL_SW], [8, 0, WALL_SE]] as [number, number, Vec3][]) { const [x, y] = wp(fx, fy, u, v, z); P.box(R(x) - 2, R(y), 4, 1, m.stone, n, { tone: -1 }); }
  // posts, beam and a small gable roof
  for (const [u, v] of [[-7, 6], [7, -6]] as [number, number][]) { const [x, y] = wp(fx, fy, u * k, v * k, 0); P.box(R(x) - 1, R(y) - R(26 * k), 2, R(24 * k), m.wood, WALL_SW); }
  const [bx0, by0] = wp(fx, fy, -7 * k, 6 * k, 22 * k), [bx1, by1] = wp(fx, fy, 7 * k, -6 * k, 22 * k);
  P.line(bx0, by0, bx1, by1, m.wood, 1);
  P.line(bx0 + 4, by0 + 2, bx0 + 4, by0 + 8, "ink", 0); // rope
  P.box(R(bx0) + 3, R(by0) + 8, 3, 3, m.wood, WALL_SW, { tone: -1 }); // bucket
  const ridgeY = by0 - R(9 * k);
  const mid: Pt = [(bx0 + bx1) / 2, (by0 + by1) / 2];
  P.poly([[bx0 - 4, by0 + 2], [mid[0] + 1, ridgeY + 3], [mid[0] + 1, mid[1] - 4], [bx0 - 4, by0 - 5]], "roof", WALL_SW);
  P.poly([[mid[0] + 1, ridgeY + 3], [bx1 + 5, by1 + 1], [bx1 + 5, by1 - 6], [mid[0] + 1, mid[1] - 4]], "roof", WALL_SE);
  void seed; void variant;
  return finalize(P.toSprite(), kit);
}

function haystack(kit: StyleKit, seed: number, variant: number, m: Mats): Sprite {
  const { P, fx, fy, k } = canvas(kit, R(20 * k0(kit)) + cellH(kit));
  const r = rng(seed * 29 + variant);
  const straw: Material = "gold";
  P.ellipse(fx, fy - 5 * k, 9.5 * k, 5 * k, straw, { tone: -1 });
  P.ellipse(fx - 0.5, fy - 9 * k, 7.5 * k, 8 * k, straw);
  for (let i = 0; i < 9 * k; i++) P.px(R(fx + r.int(-6, 6) * k), R(fy - r.int(3, 15) * k), straw, r.chance(0.5) ? 1 : 4);
  P.rect(R(fx - 8 * k), R(fy - 6 * k), R(16 * k), 1, m.wood, 1); // binding
  void m;
  return finalize(P.toSprite(), kit);
}

function gate(open: boolean) {
  return (kit: StyleKit, seed: number, variant: number, m: Mats): Sprite => {
    const hp = Math.max(8, R(proportions(kit).figure * 0.42));
    const { P, fx, fy, k, T: Tw } = canvas(kit, hp + cellH(kit) + 2);
    const a: Pt = [fx - Tw / 4, fy - Tw / 8], b: Pt = [fx + Tw / 4, fy + Tw / 8];
    const post = (c: Pt) => { P.box(R(c[0]) - 1, R(c[1]) - hp - 1, 3, hp + 2, m.wood, WALL_SW); P.box(R(c[0]) + 1, R(c[1]) - hp - 1, 1, hp + 2, m.wood, WALL_SE); P.box(R(c[0]) - 1, R(c[1]) - hp - 1, 3, 1, m.wood, TOP, { tone: 1 }); };
    post(a);
    if (!open) {
      const pts = (z0: number, z1: number): Pt[] => [[a[0] + 2, a[1] + 1 - z0], [b[0] - 2, b[1] - 1 - z0], [b[0] - 2, b[1] - 1 - z1], [a[0] + 2, a[1] + 1 - z1]];
      P.poly(pts(R(hp * 0.2), R(hp * 0.85)), m.wood, WALL_SW, { tone: -1 });
      for (const z of [0.3, 0.62]) P.poly(pts(R(hp * z), R(hp * z) + 2), m.wood, WALL_SW, { tone: 1 });
      P.line(a[0] + 2, a[1] + 1 - hp * 0.25, b[0] - 2, b[1] - 1 - hp * 0.8, m.wood, 1);
    } else {
      // the leaf stands open against the near post, seen edge-on along the other axis
      P.poly([[a[0] + 2, a[1] + 1 - hp * 0.2], [a[0] + 2 + 4, a[1] + 1 + 2 - hp * 0.2], [a[0] + 2 + 4, a[1] + 3 - hp * 0.85], [a[0] + 2, a[1] + 1 - hp * 0.85]], m.wood, WALL_SE, { tone: -1 });
    }
    post(b);
    void seed; void variant; void k;
    return finalize(P.toSprite(), kit);
  };
}

function crop(kit: StyleKit, seed: number, variant: number, m: Mats): Sprite {
  const stage = Math.max(0, Math.min(3, variant));
  const { P, fx, fy, k } = canvas(kit, R(18 * k0(kit)) + cellH(kit));
  const r = rng(seed * 31 + stage);
  const step = k >= 1 ? 6 : 4, ext = k >= 1 ? 6 : 3;
  const spots: [number, number][] = [];
  for (let u = -ext; u <= ext; u += step) for (let v = -ext; v <= ext; v += step) spots.push([u, v]);
  spots.sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
  const ripe = m.accent === "cloth2" ? "gold" : m.accent;
  for (const [u, v] of spots) {
    const [x, y] = wp(fx, fy, u, v, 0), px = R(x), py = R(y);
    const h = [2, 5, 8, 9][stage] * Math.max(0.6, k) + (r.chance(0.3) ? 1 : 0);
    P.line(px, py, px, py - h, m.leaf, 2);
    if (stage >= 1) { P.px(px - 1, py - R(h * 0.5), m.leaf, 3); P.px(px + 1, py - R(h * 0.7), m.leaf, 1); }
    if (stage >= 2) { P.px(px - 1, py - R(h) , m.leaf, 3); P.px(px + 1, py - R(h) + 1, m.leaf, 2); }
    if (stage === 3) { P.box(px - 1, py - R(h) - 1, 3, 2, ripe, TOP, { tone: 1 }); P.px(px, py - R(h) - 1, "gold", 4); }
    else if (stage === 2) P.px(px, py - R(h) - 1, m.leaf, 4);
  }
  return finalize(P.toSprite(), kit);
}

/** A foliage-generator tree re-anchored so its trunk base sits on the cell centre. */
function hdTree(kit: StyleKit, seed: number, variant: number, p: Params): Sprite {
  const species = FOLIAGE_SPECIES.includes(str(p, "species") as never) ? str(p, "species") : "oak";
  const size = ["small", "medium", "large"].includes(str(p, "size")) ? str(p, "size") : "small";
  const res = foliageGenerator.generate({ species, size, season: "summer", leaf: p.leaf && p.leaf !== "foliage" ? String(p.leaf) : "foliage", accent: "cloth2", variant }, kit, seed);
  const src = res.rows[0].frames[0];
  const bb = bounds(src)!;
  // trunk base = middle of the lowest opaque rows (the ground shadow is wider; the trunk is the narrow core)
  let sum = 0, cnt = 0;
  for (let y = bb.y1 - 3; y <= bb.y1; y++) for (let x = bb.x0; x <= bb.x1; x++) if (src.data[y * src.w + x]) { sum += x; cnt++; }
  const baseX = cnt ? sum / cnt : (bb.x0 + bb.x1) / 2;
  const T0 = isoTileW(kit);
  const left = Math.ceil(baseX - bb.x0), right = Math.ceil(bb.x1 - baseX) + 1;
  const half = Math.max(T0 / 2, left, right) + 1;
  const W = Math.ceil(half * 2);
  const fy = bb.y1 - bb.y0 + 1; // the lowest opaque row becomes the foot row, with one blank row above the crown
  const out = createSprite(W, fy + T0 / 4 + ISO_PROP_MARGIN);
  blit(out, src, Math.round(W / 2 - baseX), fy - bb.y1);
  return out;
}

// -------------------------------------------------------------------------- objects

function pot(kit: StyleKit, main: Material, accent: Material, seed: number): Sprite {
  const { P, fx, fy, k } = canvas(kit, R(14 * k0(kit)) + cellH(kit));
  P.ellipse(fx, fy - 4 * k, 5.2 * k, 5 * k, main);
  drum(P, fx, fy - 7 * k, 3.2 * k, 2 * k, main, { tone: 0 });
  P.ellipse(fx, fy - 8.5 * k, 3 * k, 1.4 * k, accent, { tone: -1 });
  P.rect(R(fx - 4 * k), R(fy - 5 * k), R(8 * k), 1, main, 1);
  void seed;
  return finalize(P.toSprite(), kit);
}

function chest(kit: StyleKit, main: Material, accent: Material, open: boolean): Sprite {
  const { P, fx, fy, k } = canvas(kit, R(18 * k0(kit)) + cellH(kit));
  const hu = 6 * k, hv = 4.5 * k, body = 5 * k, lid = 3 * k;
  if (open) {
    // lid hinged at the back: a thin slab leaning up behind the open top
    block(P, fx, fy, hu, 1, body, body + 7 * k, main, { cv: -hv + 1, tone: -1 });
    block(P, fx, fy, hu, hv, 0, body, main);
    const q = (u: number, v: number) => wp(fx, fy, u, v, body);
    P.poly([q(-hu + 1, -hv + 1), q(hu - 1, -hv + 1), q(hu - 1, hv - 1), q(-hu + 1, hv - 1)], main, TOP, { tone: -2 });
    P.px(R(fx), R(fy - body - 1 * k), "gold", 4);
    P.px(R(fx - 2), R(fy - body), "gold", 3);
    P.px(R(fx + 2), R(fy - body - 1), "gold", 2);
  } else {
    block(P, fx, fy, hu, hv, 0, body, main);
    block(P, fx, fy, hu, hv, body, body + lid, main, { tone: 0 });
    P.poly([wp(fx, fy, hu, hv, body + lid), wp(fx, fy, -hu, hv, body + lid), wp(fx, fy, -hu, hv, body + lid + 0.01)], main, TOP); // keeps the lid ridge exact
  }
  // metal straps on the front walls + lock
  for (const cu of [-hu * 0.6, hu * 0.6]) { const a = wp(fx, fy, cu, hv, 0), b = wp(fx, fy, cu, hv, body + (open ? 0 : lid)); P.line(a[0], a[1], b[0], b[1], accent, 2); }
  const [lx, ly] = wp(fx, fy, 0, hv, body - 1);
  P.box(R(lx) - 1, R(ly) - 1, 3, 3, accent, WALL_SW, { tone: 1 });
  P.px(R(lx), R(ly), "gold", 4);
  return finalize(P.toSprite(), kit);
}

function barrel(kit: StyleKit, main: Material, accent: Material): Sprite {
  const { P, fx, fy, k } = canvas(kit, R(18 * k0(kit)) + cellH(kit));
  const rx = 6.5 * k, h = 12 * k;
  // slightly bulged staves: wider in the middle
  P.ellipse(fx, fy - h * 0.5, rx + 0.6, h * 0.5, main, { flat: 0.1 });
  drum(P, fx, fy - 1, rx, h - 1, main);
  for (const z of [0.2, 0.75]) {
    const y = R(fy - h * z);
    P.rect(R(fx - rx), y, R(rx * 2), 1, accent, 2);
    P.px(R(fx - rx), y, accent, 1);
  }
  disc(P, fx, fy - h, rx - 0.5, rx / 2 - 0.2, main, 1);
  disc(P, fx, fy - h, rx - 2.5, rx / 2 - 1.6, main, -1);
  return finalize(P.toSprite(), kit);
}

function crate(kit: StyleKit, main: Material, accent: Material): Sprite {
  const { P, fx, fy, k } = canvas(kit, R(16 * k0(kit)) + cellH(kit));
  const h = 9 * k, hh = 5.5 * k;
  block(P, fx, fy, hh, hh, 0, h, main);
  // frame battens in the darker shade + X brace on the lit face
  const edge = (u0: number, v0: number, z0: number, u1: number, v1: number, z1: number, tone: number) => { const a = wp(fx, fy, u0, v0, z0), b = wp(fx, fy, u1, v1, z1); P.line(a[0], a[1], b[0], b[1], main, tone); };
  edge(-hh, hh, 1, -hh, hh, h, 1); edge(hh, hh, 1, hh, hh, h, 1); edge(hh, -hh, 1, hh, -hh, h, 1);
  edge(-hh, hh, 1, hh, hh, 1, 1); edge(-hh, hh, h - 1, hh, hh, h - 1, 2);
  edge(hh, hh, 1, hh, -hh, 1, 0); edge(hh, hh, h - 1, hh, -hh, h - 1, 1);
  edge(-hh + 1, hh, 1, hh - 1, hh, h - 1, 1);
  edge(hh - 1, hh, 1, -hh + 1, hh, h - 1, 1);
  const [cx, cy] = wp(fx, fy, hh, hh, h / 2);
  P.px(R(cx), R(cy), accent, 3);
  return finalize(P.toSprite(), kit);
}

function lampPost(kit: StyleKit, seed: number, main: Material, accent: Material, frame: number): Sprite {
  const pr = proportions(kit);
  const hp = R(pr.figure * 0.95), { P, fx, fy, k } = canvas(kit, hp + R(6 * k0(kit)) + cellH(kit));
  block(P, fx, fy, 3 * k, 3 * k, 0, 3 * k, "stone");
  P.cylinder(R(fx - 1), R(fy - hp + 5), 3, hp - 5, main, { tone: -1 });
  P.box(R(fx - 1), R(fy - hp + 4), 3, 1, main, TOP, { tone: 1 });
  // lantern: glass box with a warm core; the flame flickers by a pixel
  block(P, fx, fy - hp + 2 * k, 2.5 * k, 2.5 * k, 0, 5 * k, accent === "gold" || accent === "wood" || accent === "metal" ? "metal" : accent, { tone: -1 });
  const ly = R(fy - hp - 1);
  P.rect(R(fx - 1), ly - 1 - (frame % 2), 3, 3 + (frame % 2), "gold", 3);
  P.px(R(fx), ly - (frame % 2), "gold", 4);
  P.box(R(fx - 3), ly - 4, 7, 2, main, TOP, { tone: 0 });
  void seed;
  return finalize(P.toSprite(), kit);
}

function signpost(kit: StyleKit, main: Material, accent: Material, variant: number): Sprite {
  const hp = R(proportions(kit).figure * 0.75), { P, fx, fy, k } = canvas(kit, hp + cellH(kit));
  block(P, fx, fy, 1.4 * k, 1.4 * k, 0, hp - 2, accent === "metal" ? "wood" : accent, { tone: -1 });
  const bw = 8 * k, z0 = hp - 9 * k, z1 = hp - 1;
  block(P, fx, fy, bw, 1, z0, z1, main, { cv: 2 });
  // arrow tip on the lit board and a nail dot
  const [ax, ay] = wp(fx, fy, bw, 3, (z0 + z1) / 2);
  P.poly([[ax - 1, ay - 3], [ax + 3, ay + 1], [ax - 1, ay + 3]], main, WALL_SE, { tone: 0 });
  P.line(...wp(fx, fy, -bw + 2, 3, z0 + 3), ...wp(fx, fy, bw - 3, 3, z0 + 3), main, 1);
  if (variant % 2) P.line(...wp(fx, fy, -bw + 2, 3, z1 - 3), ...wp(fx, fy, bw - 5, 3, z1 - 3), main, 1);
  return finalize(P.toSprite(), kit);
}

const OBJ_NATURAL: Record<string, [Material, Material]> = {
  chest: ["wood", "metal"], "chest-open": ["wood", "metal"], barrel: ["wood", "metal"], crate: ["wood", "metal"],
  torch: ["metal", "gold"], sign: ["wood", "wood"], pot: ["dirt", "foliage"],
};
/** World-prop object kinds that have an isometric drawing; every other kind is an inventory icon and stays flat. */
export const ISO_OBJECT_KINDS = Object.keys(OBJ_NATURAL);

export function isoObject(p: Params, kit: StyleKit, seed: number): GenResult | null {
  const kind = str(p, "kind");
  if (!ISO_OBJECT_KINDS.includes(kind)) return null;
  const nat = OBJ_NATURAL[kind];
  const main = str(p, "main") === "natural" ? nat[0] : (str(p, "main") as Material);
  const acc = str(p, "accent") === "natural" ? nat[1] : (str(p, "accent") as Material);
  const variant = Math.round(num(p, "variant"));
  const one = (s: Sprite): FrameSet[] => [{ name: "idle", frames: [s] }];
  switch (kind) {
    case "chest": return { rows: one(chest(kit, main, acc, false)), fps: 1 };
    case "chest-open": return { rows: one(chest(kit, main, acc, true)), fps: 1 };
    case "barrel": return { rows: one(barrel(kit, main, acc)), fps: 1 };
    case "crate": return { rows: one(crate(kit, main, acc)), fps: 1 };
    case "pot": return { rows: one(pot(kit, main, acc, seed)), fps: 1 };
    case "sign": return { rows: one(signpost(kit, main, acc, variant)), fps: 1 };
    default: return { rows: [{ name: "idle", frames: [0, 1, 2].map((f) => lampPost(kit, seed, main, acc, f)) }], fps: 6 }; // torch = lamp post
  }
}

// -------------------------------------------------------------------------- environment dispatch

const matsOf = (p: Params): Mats => ({ leaf: mat(p, "foliage"), wood: mat(p, "trunk"), stone: mat(p, "stone"), accent: mat(p, "accent") });
const ISO_TILE_OF: Record<string, IsoTileKind> = {
  "grass-tile": "grass", "dirt-tile": "dirt", "sand-tile": "sand", "water-tile": "water", "stone-path-tile": "stone", "snow-tile": "sand", "paddy-tile": "water",
  "tilled-soil-tile": "soil", "watered-soil-tile": "soil", "dried-soil-tile": "soil", "snowed-soil-tile": "soil",
};
const FENCE_OF: Record<string, IsoPropKind> = { h: "fence-se", v: "fence-sw" };

/** The `environment` generator's result under an iso kit, or null for kinds with no iso drawing (water props). */
export function isoEnvironment(p: Params, kit: StyleKit, seed: number): GenResult | null {
  const kind = str(p, "kind"), variant = Math.round(num(p, "variant") || 0);
  const m = matsOf(p);
  const one = (s: Sprite, fps = 1): GenResult => ({ rows: [{ name: "idle", frames: [s] }], fps });
  const tile = ISO_TILE_OF[kind];
  if (tile) return one(isoTile(kit, tile, seed, variant % 4, 0));
  const cl = { leaf: m.leaf, wood: m.wood, stone: m.stone };
  switch (kind) {
    case "oak": return one(isoProp(kit, "tree", seed, variant, cl));
    case "old-oak": return one(hdTree(kit, seed, variant, { species: "oak", size: "medium", leaf: m.leaf }));
    case "pine": return one(isoProp(kit, "pine", seed, variant, cl));
    case "bush": return one(isoProp(kit, "bush", seed, variant, cl));
    case "rock": return one(isoProp(kit, "rock", seed, variant, cl));
    case "palm": return one(palm(kit, seed, variant, m));
    case "dead-tree": return one(deadTree(kit, seed, variant, m));
    case "boulder": return one(boulder(kit, seed, variant, m));
    case "flowers": return one(flowers(kit, seed, variant, m));
    case "mushroom": return one(mushrooms(kit, seed, variant, m));
    case "tall-grass": return one(tallGrass(kit, seed, variant, m));
    case "stump": return one(stump(kit, seed, variant, m));
    case "crystal": return one(crystal(kit, seed, variant, m));
    case "fence": {
      const piece = str(p, "piece");
      if (piece.startsWith("gate")) return one(gate(piece === "gate-open")(kit, seed, variant, m));
      return one(isoProp(kit, FENCE_OF[piece] ?? "post", seed, variant, cl));
    }
    default: return null;
  }
}

// -------------------------------------------------------------------------- iso-prop registrations

const propMats = (p: Params): Mats => ({ leaf: mat(p, "leaf"), wood: mat(p, "wood"), stone: mat(p, "stone"), accent: "cloth2" });
registerIsoProp("palm", (kit, seed, v, p) => palm(kit, seed, v, propMats(p)));
registerIsoProp("dead-tree", (kit, seed, v, p) => deadTree(kit, seed, v, propMats(p)));
registerIsoProp("stump", (kit, seed, v, p) => stump(kit, seed, v, propMats(p)));
registerIsoProp("flowers", (kit, seed, v, p) => flowers(kit, seed, v, propMats(p)));
registerIsoProp("mushroom", (kit, seed, v, p) => mushrooms(kit, seed, v, propMats(p)));
registerIsoProp("tall-grass", (kit, seed, v, p) => tallGrass(kit, seed, v, propMats(p)));
registerIsoProp("crystal", (kit, seed, v, p) => crystal(kit, seed, v, propMats(p)));
registerIsoProp("boulder", (kit, seed, v, p) => boulder(kit, seed, v, propMats(p)));
registerIsoProp("well", (kit, seed, v, p) => well(kit, seed, v, propMats(p)));
registerIsoProp("haystack", (kit, seed, v, p) => haystack(kit, seed, v, propMats(p)));
registerIsoProp("gate-closed", (kit, seed, v, p) => gate(false)(kit, seed, v, propMats(p)));
registerIsoProp("gate-open", (kit, seed, v, p) => gate(true)(kit, seed, v, propMats(p)));
registerIsoProp("crop", (kit, seed, v, p) => crop(kit, seed, v, { ...propMats(p), leaf: "grass" }));
registerIsoProp("lamp-post", (kit, seed, _v, _p) => lampPost(kit, seed, "metal", "gold", 0));
registerIsoProp("tree-hd", (kit, seed, v, p) => hdTree(kit, seed, v, p));

export { bool, N };

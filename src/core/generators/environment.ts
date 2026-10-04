import { finalize } from "../enforce";
import { lightVector, proportions } from "../kit";
import { Painter } from "../painter";
import { colorIndex, decodeIndex, type Material } from "../palette";
import { hashString, rng, valueNoise, type Rng } from "../rng";
import { bounds, createSprite, setPx } from "../sprite";
import type { FrameSet, Sprite, StyleKit } from "../types";
import { FENCE_PIECES, fenceRows, type FencePiece } from "./fence";
import { SHORE_OPTIONS, WATER_PROP_KINDS, waterDepthTile, waterPropRows } from "./water";
import { bool, mat, num, str, type GenResult, type Generator, type Params } from "./types";

/** Seamless ground tiles (no outline, exactly kit.sizes.tile square, must tile/wrap). */
export const TILE_KINDS = ["grass-tile", "dirt-tile", "sand-tile", "water-tile", "stone-path-tile", "snow-tile", "paddy-tile"] as const;
/** Free-standing props (outlined, transparent background). */
export const PROP_KINDS = ["oak", "pine", "palm", "dead-tree", "bush", "rock", "boulder", "flowers", "mushroom", "tall-grass", "stump", "crystal"] as const;

/** Farming-kit additions (kept apart so the original lists stay as other code expects them). */
export const EXTRA_PROP_KINDS = ["old-oak", "fence"] as const;
export const SOIL_TILE_KINDS = ["tilled-soil-tile", "watered-soil-tile", "dried-soil-tile", "snowed-soil-tile"] as const;

const FOLIAGE: Material[] = ["foliage", "grass", "accent", "cloth", "cloth2", "sand", "gold", "water"];
const TRUNKS: Material[] = ["wood", "leather", "stone", "dirt", "metal", "hair"];
const STONES: Material[] = ["stone", "metal", "dirt", "sand", "wood", "accent"];
const ACCENTS: Material[] = ["cloth2", "accent", "gold", "cloth", "skin", "sand", "foliage", "water"];

const WATER_FRAMES = 4;

const OLD_OAK_SCALE = 1.35;
export const TREE_KINDS = ["oak", "pine", "palm", "dead-tree"] as const;
/** Canvas height of a prop: trees are ~2x a character (proportions) plus a 2px margin, the rest are square. */
export function treeHeight(kit: StyleKit, kind: string): number {
  if (kind === "old-oak") return Math.round(proportions(kit).tree * OLD_OAK_SCALE) + 2;
  return (TREE_KINDS as readonly string[]).includes(kind) ? proportions(kit).tree + 2 : kit.sizes.environment;
}

// ---------------------------------------------------------------------------
// Props. Authored on a 32px grid, scaled by k = size / 32. `G` is the ground
// line (exclusive): the last painted row is G-1 so a 1px margin stays free for
// the outline.
// ---------------------------------------------------------------------------

interface Ctx {
  P: Painter;
  S: number;
  /** canvas height (taller than S for trees) */
  H: number;
  k: number;
  G: number;
  r: Rng;
  v: number;
  foliage: Material;
  trunk: Material;
  stone: Material;
  accent: Material;
  /** scale and round to whole pixels */
  R: (n: number) => number;
  /** scale and round, at least 1px */
  R1: (n: number) => number;
}

/** Column-shaded cone layer (pine boughs): rounded left-to-right like the painter's cylinders. */
function cone(c: Ctx, cx: number, baseY: number, halfW: number, h: number, m: Material, jag: number) {
  const { P } = c;
  for (let x = Math.floor(cx - halfW); x <= Math.ceil(cx + halfW); x++) {
    const u = (x + 0.5 - cx) / halfW;
    if (Math.abs(u) > 1) continue;
    let colH = Math.round(h * (1 - Math.abs(u)));
    if (Math.abs(u) > 0.45 && (x + jag) % 2 === 0) colH -= 1;
    if (colH <= 0) continue;
    P.box(x, baseY - colH, 1, colH, m, [u * 1.1, -0.45, Math.sqrt(1 - u * u) + 0.25]);
  }
  P.box(Math.ceil(cx - halfW + 1), baseY - 1, Math.max(1, Math.floor(halfW * 2 - 2)), 1, m, [0, 0.4, 1], { tone: -1 });
}

/** Trees are authored in "u" units: 32px-wide grid, u measured upward from the ground line. */
const Yu = (c: Ctx, u: number) => c.G - u * c.k;

function oak(c: Ctx) {
  const { P, S, k, r, G, R1 } = c;
  const cx = S / 2;
  const tw = R1(8) + (c.v % 3 === 0 ? 1 : 0);
  const tx = Math.round(cx - tw / 2);
  const trunkTop = Math.round(Yu(c, 26));
  P.cylinder(tx, trunkTop, tw, G - trunkTop, c.trunk);
  P.box(tx + tw - Math.max(2, Math.round(tw * 0.3)), trunkTop, Math.max(2, Math.round(tw * 0.3)), G - trunkTop, c.trunk, [0.9, 0, 0.4], { tone: -1 });
  P.box(tx, trunkTop, tw, R1(3), c.trunk, [0, 0, 1], { tone: -1 }); // canopy shadow
  P.box(tx - 1, G - R1(3), 1, R1(3), c.trunk, [-0.6, 0, 0.8]);
  P.box(tx + tw, G - R1(3), 1, R1(3), c.trunk, [0.6, 0, 0.8], { tone: -1 });
  if (c.v % 4 === 1) P.px(tx + Math.floor(tw / 2), Math.round(Yu(c, 12)), c.trunk, 0); // knot

  const Yc = (u: number) => Yu(c, (u - 26) * 1.1 + 21);
  const j = () => (r.next() - 0.5) * 2 * k;
  const L = (dx: number, u: number, rx: number, ry: number, tone = 0) => P.ellipse(cx + dx * k + j(), Yc(u), rx * k, ry * 1.2 * k, c.foliage, { tone });
  P.ellipse(cx, Yc(38), 14.5 * k, 10.5 * k, c.foliage, { tone: -1 });
  L(-8, 41, 7.5, 8);
  L(8, 42, 7.5, 7.5);
  L(0, 50, 11, 9);
  L(-5.5, 55, 6.5, 5);
  L(6, 54, 6, 4.5);
  L(-6, 35, 5, 3, -1);
  L(7, 34.5, 5, 3, -1);
  P.ellipse(cx - 5 * k, Yc(57.5), 4 * k, 2.8 * k, c.foliage, { tone: 1 });
  P.ellipse(cx + 3 * k + j(), Yc(45), 3.2 * k, 2.8 * k, c.foliage, { tone: 1 });
  if (c.v >= 5) {
    const spots: [number, number][] = [[-9, 41], [2, 36], [9, 45], [-2, 52], [5, 56]];
    for (const [dx, u] of spots) {
      const x = Math.round(cx + dx * k), y = Math.round(Yc(u));
      P.px(x, y, c.accent, 3);
      if (k >= 1) P.px(x + 1, y, c.accent, 2);
    }
  }
}

/** Landmark tree: the oak, bigger, with a hollow and mossy roots. */
function oldOak(c: Ctx) {
  oak(c);
  const { P, S, k, G } = c;
  const cx = S / 2;
  P.ellipse(cx + 0.5 * k, G - 7 * k, 2 * k, 3.2 * k, c.trunk, { tone: -2 });
  P.ellipse(cx - 5 * k, G - 1.5 * k, 3 * k, 1.5 * k, c.foliage, { tone: -1 });
  P.ellipse(cx + 5.5 * k, G - 1.2 * k, 2.5 * k, 1.2 * k, c.foliage, { tone: 0 });
}

function pine(c: Ctx) {
  const { P, S, k, G, R, R1 } = c;
  const cx = S / 2;
  const n = 5 + (c.v % 2);
  const tw = R1(5);
  const th = R1(10);
  P.cylinder(Math.round(cx - tw / 2), G - th, tw, th, c.trunk);
  const top = 1.5 * k, bottom = G - R(8);
  const step = (bottom - top) / (n + 0.9);
  const h = step * 1.9;
  for (let i = n - 1; i >= 0; i--) {
    const halfW = (5 + (9.5 * i) / (n - 1)) * k;
    cone(c, cx, Math.round(top + h + i * step), halfW, Math.round(h), c.foliage, c.v + i);
  }
}

function palm(c: Ctx) {
  const { P, S, k, r, G, R1 } = c;
  const ls = P.lightSide || 1;
  const cx = S / 2;
  const lean = (c.v % 2 ? 1 : -1) * 3 * k;
  const x0 = cx - 2 * k, y0 = G - 1;
  const x2 = cx + 2 * k + lean, y2 = Yu(c, 45);
  const x1 = cx - 4 * k + lean * 0.3, y1 = Yu(c, 26);
  const tw = R1(4);
  // segmented trunk: alternating tone rings every ~2px of arc, slightly tapering
  let prevY = -1, ring = 0;
  for (let t = 0; t <= 1.0001; t += 1 / 200) {
    const x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * x1 + t * t * x2;
    const y = Math.round((1 - t) ** 2 * y0 + 2 * (1 - t) * t * y1 + t * t * y2);
    if (y === prevY) continue;
    prevY = y;
    ring++;
    const w = Math.max(2, Math.round(tw * (1 - 0.2 * t)));
    P.cylinder(Math.round(x - w / 2), y, w, 1, c.trunk, { tone: Math.floor(ring / Math.max(1, Math.round(1.5 * k + 0.5))) % 2 ? -1 : 0 });
  }
  P.box(Math.round(x0 - tw / 2) - 1, G - R1(3), tw + 2, R1(3), c.trunk, [0, 0, 1], { tone: -1 });
  const hx = x2, hy = y2;
  // [angle deg, length, droop, back]: back fronds first, then the front ones
  const fronds: [number, number, number, boolean][] =
    k < 1
      ? [[-100, 8, 2, true], [-150, 10, 5, false], [-30, 10, 5, false], [178, 9, 7, false], [2, 9, 7, false]]
      : [
          [-100, 8, 3, true], [-78, 8, 3, true], [-145, 13, 8, true], [-35, 13, 8, true],
          [-165, 13, 10, false], [-15, 13, 10, false], [150, 11, 12, false], [30, 11, 12, false],
        ];
  const nF = c.v % 3 === 0 ? fronds.length - 1 : fronds.length;
  // coconuts hang under the crown, behind the front fronds
  const cr = Math.max(1, 1.8 * k);
  P.ellipse(hx - 1.6 * k, hy + 2.2 * k, cr, cr, c.trunk, { tone: -1 });
  P.ellipse(hx + 1.6 * k, hy + 2.4 * k, cr, cr, c.trunk, { tone: -1 });
  if (k >= 1) P.ellipse(hx, hy + 3.8 * k, cr, cr, c.trunk, { tone: -1 });
  for (const [deg, len, droop, back] of fronds.slice(0, nF)) {
    const a = (deg * Math.PI) / 180 + (r.next() - 0.5) * 0.12;
    const Ln = len * 1.5 * k;
    const steps = Math.max(4, Math.round(Ln / 1.2));
    const pts: { x: number; y: number; w: number }[] = [];
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      pts.push({
        x: hx + Math.cos(a) * Ln * f,
        y: hy + Math.sin(a) * Ln * f + f * f * droop * k,
        w: Math.max(0.5, (3 * Math.sin(Math.PI * Math.min(1, f * 0.85 + 0.12)) + 0.4) * k * (back ? 0.85 : 1)),
      });
    }
    const dark = back ? -2 : -1;
    for (let i = 0; i < steps; i++) {
      const A = pts[i], B = pts[i + 1];
      // upper edge faces the light, underside faces down and away from it
      P.poly([[A.x, A.y - A.w], [B.x, B.y - B.w], [B.x, B.y + 0.2], [A.x, A.y + 0.2]], c.foliage, [ls * 0.5, -0.7, 0.6], { tone: back ? -1 : 0 });
      P.poly([[A.x, A.y], [B.x, B.y], [B.x, B.y + B.w], [A.x, A.y + A.w]], c.foliage, [-ls * 0.3, 0.8, 0.4], { tone: dark });
    }
    // lighter rim along the top edge
    if (!back && k >= 0.9) for (let i = 1; i < steps - 1; i += 2) P.px(pts[i].x, pts[i].y - pts[i].w, c.foliage, 4);
  }
  P.ellipse(hx, hy + 0.5 * k, 2 * k, 1.6 * k, c.foliage, { tone: 0 });
}

function deadTree(c: Ctx) {
  const { P, S, k, r, G, R1 } = c;
  const ls = P.lightSide || 1;
  const cx = S / 2;
  const top = Math.round(Yu(c, 58));
  const phase = c.v * 1.3;
  const rows = G - top;
  const xAt = (y: number) => cx + Math.sin(((G - y) / rows) * 3 + phase) * 1.5 * k;
  for (let y = G - 1; y >= top; y--) {
    const t = (G - 1 - y) / rows;
    const w = Math.max(2, Math.round(R1(8) * (1 - 0.65 * t)));
    P.cylinder(Math.round(xAt(y) - w / 2), y, w, 1, c.trunk);
  }
  P.box(Math.round(cx - R1(4)) - 1, G - R1(3), R1(8) + 2, R1(3), c.trunk, [0, 0, 1], { tone: -1 });
  // limb: thick (2px) near the trunk, 1px toward the tip, shadow on the side away from the light
  const limb = (x0: number, y0: number, x1: number, y1: number, thick: number) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const x = Math.round(x0 + (x1 - x0) * f), y = Math.round(y0 + (y1 - y0) * f);
      const wide = thick >= 2 && f < 0.55;
      P.px(x, y, c.trunk, 3);
      if (wide) {
        if (Math.abs(x1 - x0) < Math.abs(y1 - y0)) P.px(x - ls, y, c.trunk, 1);
        else P.px(x, y + 1, c.trunk, 1);
      }
    }
  };
  const branch = (fromY: number, dx: number, dy: number, fork: boolean, thick = 2) => {
    const x0 = Math.round(xAt(fromY)), y0 = Math.round(fromY);
    const x1 = Math.round(x0 + dx * k), y1 = Math.round(y0 + dy * k);
    limb(x0, y0, x1, y1, thick);
    if (fork) {
      const f = 0.45;
      const mx = Math.round(x0 + (x1 - x0) * f), my = Math.round(y0 + (y1 - y0) * f);
      limb(mx, my, Math.round(mx + Math.sign(dx) * 5 * k), Math.round(my - 7 * k), thick);
      // twig off the main limb tip
      limb(x1, y1, Math.round(x1 - Math.sign(dx) * 2 * k), Math.round(y1 - 4 * k), 1);
    }
  };
  branch(Yu(c, 38), -10 + r.int(-1, 1), -13, true);
  branch(Yu(c, 28), 9 + r.int(-1, 1), -10, c.v % 2 === 0);
  branch(Yu(c, 47), 6, -7, k >= 1 && c.v % 3 === 0, 2);
  if (k >= 1) branch(Yu(c, 20), -7, -5, false, 1);
  P.px(Math.round(cx), Math.round(Yu(c, 14)), c.trunk, 0); // knot hole
}

function bush(c: Ctx) {
  const { P, S, k, r, G } = c;
  const cx = S / 2;
  const by = G - 7 * k;
  P.ellipse(cx, by + 1 * k, 12 * k, 6.5 * k, c.foliage, { tone: -1 });
  P.ellipse(cx - 7 * k, by + 1.5 * k, 6.5 * k, 5.5 * k, c.foliage);
  P.ellipse(cx + 7 * k, by + 2 * k, 6 * k, 5 * k, c.foliage);
  P.ellipse(cx, by - 2.5 * k, 8.5 * k, 6.5 * k, c.foliage);
  P.ellipse(cx - 4 * k, by - 4.5 * k, 3.5 * k, 2.5 * k, c.foliage, { tone: 1 });
  P.ellipse(cx + 6.5 * k, by + 5 * k, 4 * k, 1.8 * k, c.foliage, { tone: -1 });
  if (c.v >= 4) {
    for (let i = 0; i < 4; i++) {
      const x = Math.round(cx + (r.next() - 0.5) * 14 * k), y = Math.round(by - 1 * k + (r.next() - 0.3) * 7 * k);
      if (P.isFilled(x, y)) P.px(x, y, c.accent, 3);
    }
  }
}

function rock(c: Ctx) {
  const { P, S, k, r, G } = c;
  const cx = S / 2;
  P.ellipse(cx - 1 * k, G - 7 * k, 10 * k, 6.5 * k, c.stone, { flat: 0.15 });
  P.ellipse(cx + 8.5 * k, G - 4.5 * k, 5.5 * k, 4 * k, c.stone, { tone: -1, flat: 0.15 });
  P.ellipse(cx - 4 * k, G - 10 * k, 4 * k, 2.2 * k, c.stone, { tone: 1, flat: 0.1 });
  // crack
  const x = Math.round(cx + 2 * k + r.int(-1, 1) * k), y = Math.round(G - 9 * k);
  P.px(x, y, c.stone, 1);
  P.px(x, y + 1, c.stone, 1);
  if (k >= 1) P.px(x + 1, y + 2, c.stone, 1);
}

function boulder(c: Ctx) {
  const { P, S, k, r, G, R } = c;
  const cx = S / 2;
  const pt = (x: number, y: number): [number, number] => [x * k, G - y * k];
  P.ellipse(cx, G - 10 * k, 13.5 * k, 10 * k, c.stone, { flat: 0.3 });
  // facets: lit top-left plane, shadowed right plane
  P.poly([pt(5, 11), pt(8, 18), pt(15, 20), pt(15, 12)], c.stone, [-0.5, -0.6, 0.6], { tone: 1 });
  P.poly([pt(21, 3), pt(25, 14), pt(28, 10), pt(27, 3)], c.stone, [0.6, 0.2, 0.6], { tone: -1 });
  P.poly([pt(14, 12), pt(20, 16), pt(21, 3), pt(14, 3)], c.stone, [0.3, 0.2, 0.9]);
  P.line(R(14), G - R(12), R(15), G - R(7), c.stone, 1);
  P.line(R(15), G - R(7), R(13), G - R(4), c.stone, 1);
  if (c.v >= 5) {
    P.ellipse(cx - 3 * k, G - 19 * k, 5 * k, 2.2 * k, "foliage", { tone: 0 });
    P.ellipse(cx + 5 * k, G - 17.5 * k, 3 * k, 1.6 * k, "foliage", { tone: -1 });
  }
  void r;
}

function flowers(c: Ctx) {
  const { P, S, k, r, G, R, R1 } = c;
  const cx = S / 2;
  const alt = (["gold", "cloth", "accent", "cloth2"] as Material[])[c.v % 4];
  const colours: Material[] = [c.accent, alt === c.accent ? "gold" : alt, c.accent];
  // grass tuft
  for (const [dx, h] of [[-6, 6], [-3, 8], [0, 5], [3, 8], [6, 6]] as [number, number][]) {
    const x = Math.round(cx + dx * k);
    const hw = k >= 1 ? 1 : 0.6;
    P.poly([[x - hw, G], [x + hw + 0.5, G], [x + (dx > 0 ? 1.5 : -1.5), G - h * k]], "grass", [dx / 8, -0.2, 1], { tone: dx % 2 ? 0 : -1 });
  }
  const heads: [number, number][] = [[-6, 18], [1, 23], [7, 16]];
  heads.forEach(([dx, hy], i) => {
    const x = Math.round(cx + (dx + r.int(-1, 1)) * k), y = Math.round(G - hy * k);
    P.line(x, y + 1, Math.round(cx + dx * 0.5 * k), G - R(5), "grass", 2);
    const m = colours[i % colours.length];
    if (k >= 1) {
      P.box(x - 1, y - 2, 3, 5, m, [0, 0, 1]);
      P.box(x - 2, y - 1, 5, 3, m, [0, 0, 1]);
      P.px(x, y, "gold", 4);
      P.px(x - 1, y - 2, m, 4);
    } else {
      P.rect(x, y - 1, 2, 2, m, 4);
      P.px(x, y, "gold", 4);
    }
  });
  void R1;
}

function mushroom(c: Ctx) {
  const { P, S, k, G, R1 } = c;
  const cx = S / 2;
  const one = (x: number, base: number, capR: number, stemH: number, tone: number) => {
    const rim = Math.round(base - stemH);
    const sw = R1(capR * 0.55);
    P.cylinder(Math.round(x - sw / 2), rim, sw, Math.max(1, Math.round(base - rim)), "sand", { tone });
    const capH = capR * 0.85;
    for (let px = Math.floor(x - capR); px < Math.ceil(x + capR); px++) {
      const u = (px + 0.5 - x) / capR;
      if (Math.abs(u) > 1) continue;
      const colH = Math.max(1, Math.round(capH * Math.sqrt(1 - u * u)));
      P.box(px, rim - colH, 1, colH + 1, c.accent, [u * 0.9, -0.5, Math.sqrt(1 - u * u) + 0.25], { tone });
    }
    P.box(Math.round(x - capR + 1), rim, Math.max(2, Math.round(capR * 2 - 2)), 1, c.accent, [0, 0.6, 1], { tone: tone - 1 });
    if (capR >= 4) {
      P.px(Math.round(x - capR * 0.45), Math.round(rim - capH * 0.6), "sand", 4);
      P.px(Math.round(x + capR * 0.3), Math.round(rim - capH * 0.35), "sand", 4);
      P.px(Math.round(x + capR * 0.15), Math.round(rim - capH * 0.85), "sand", 3);
    }
  };
  one(cx - 1 * k, G, 8 * k, 11 * k, 0);
  one(cx + 8.5 * k, G, 4.5 * k, 6 * k, -1);
  one(cx - 8.5 * k, G, 4 * k, 4.5 * k, -1);
}

function tallGrass(c: Ctx) {
  const { P, S, k, r, G } = c;
  const cx = S / 2;
  const blades = 9;
  const list = Array.from({ length: blades }, (_, i) => {
    const t = i / (blades - 1);
    const x = cx + (t - 0.5) * 22 * k + (r.next() - 0.5) * 2 * k;
    const h = (10 + 12 * (1 - Math.abs(t - 0.5) * 1.6) + r.next() * 4) * k;
    const lean = ((t - 0.5) * 8 + (r.next() - 0.5) * 5) * k;
    return { x, h, lean, t };
  }).sort((a, b) => b.h - a.h);
  list.forEach((b, i) => {
    const w = 2.2 * k;
    P.poly([[b.x - w, G], [b.x + w, G], [b.x + b.lean, G - b.h]], "grass", [b.lean / (b.h + 1) * 2, -0.2, 0.9], { tone: i < 3 ? -1 : i > 6 ? 1 : 0 });
  });
}

function stump(c: Ctx) {
  const { P, S, k, r, G, R, R1 } = c;
  const cx = S / 2;
  const w = R1(14), h = R1(11);
  const x = Math.round(cx - w / 2), top = G - h;
  P.cylinder(x, top, w, h, c.trunk);
  P.box(x - 1, G - R1(3), 1, R1(3), c.trunk, [-0.6, 0, 0.8]);
  P.box(x + w, G - R1(3), 1, R1(3), c.trunk, [0.6, 0, 0.8], { tone: -1 });
  for (let i = 0; i < 3; i++) {
    const bx = x + 2 + Math.floor((i * (w - 4)) / 2) + r.int(0, 1);
    P.px(bx, top + R1(4), c.trunk, 1);
    P.px(bx, top + R1(4) + 1, c.trunk, 1);
  }
  const ty = top;
  P.ellipse(cx, ty, w / 2 + 0.3, 3.3 * k, c.trunk, { tone: 1, flat: 1 });
  P.ellipse(cx, ty, w / 2 - 2 * k, 2 * k, c.trunk, { tone: 0, flat: 1 });
  P.ellipse(cx, ty, Math.max(1, w / 2 - 4.5 * k), Math.max(0.8, 1 * k), c.trunk, { tone: 1, flat: 1 });
  if (c.v % 2) {
    P.ellipse(cx + w / 2 + 1 * k, G - R(4), 3 * k, 2.2 * k, c.foliage);
    P.px(Math.round(cx + w / 2 + 1 * k), G - R(7), c.foliage, 3);
  }
  void R;
}

function crystal(c: Ctx) {
  const { P, S, k, G } = c;
  const cx = S / 2;
  const accent = c.accent === "cloth2" ? "accent" : c.accent; // crystals default to the purple ramp
  P.ellipse(cx, G - 3 * k, 11 * k, 3.5 * k, c.stone, { tone: -1, flat: 0.3 });
  const spire = (x: number, baseY: number, w: number, h: number, tilt: number, tone: number) => {
    const tipX = x + tilt, tipY = baseY - h;
    P.poly([[x - w, baseY], [x - w, baseY - h * 0.62], [tipX, tipY], [tipX, baseY]], accent, [-0.7, -0.4, 0.6], { tone });
    P.poly([[tipX, tipY], [x + w, baseY - h * 0.62], [x + w, baseY], [tipX, baseY]], accent, [0.6, 0.1, 0.55], { tone: tone - 1 });
    P.px(Math.round(x - w * 0.5), Math.round(baseY - h * 0.55), accent, 4);
  };
  spire(cx - 8 * k, G - 3 * k, 3.5 * k, 12 * k, -1 * k, 0);
  spire(cx + 8 * k, G - 2.5 * k, 3.5 * k, 10 * k, 1 * k, -1);
  spire(cx, G - 2.5 * k, 5.5 * k, 23 * k, 0.5 * k, 0);
  P.px(Math.round(cx - 2 * k), Math.round(G - 20 * k), accent, 4);
  P.px(Math.round(cx - 2 * k), Math.round(G - 19 * k + 1), accent, 4);
  P.ellipse(cx + 3 * k, G - 2.5 * k, 5 * k, 2.5 * k, c.stone, { tone: 0, flat: 0.3 });
}

const PROPS: Record<(typeof PROP_KINDS)[number], (c: Ctx) => void> = {
  oak,
  pine,
  palm,
  "dead-tree": deadTree,
  bush,
  rock,
  boulder,
  flowers,
  mushroom,
  "tall-grass": tallGrass,
  stump,
  crystal,
};

// ---------------------------------------------------------------------------
// Tiles. Everything wraps: noise lattices use integer periods and scatter
// positions are taken modulo the tile size, so any tile can sit next to itself.
// ---------------------------------------------------------------------------

const wrap = (n: number, T: number) => ((Math.round(n) % T) + T) % T;

function clampLevel(l: number) {
  return Math.max(0, Math.min(4, l));
}

/** Small helper: write ramp levels into a fresh sprite. */
function painter(T: number) {
  const s = createSprite(T, T);
  const put = (x: number, y: number, m: Material, level: number) => setPx(s, wrap(x, T), wrap(y, T), colorIndex(m, clampLevel(level)));
  return { s, put };
}

/** Accent count: roughly one per 8x8 area. */
const perArea = (T: number) => Math.max(1, Math.round((T * T) / 64));

function grassTile(T: number, r: Rng, seed: number, flat: boolean): Sprite {
  const { s, put } = painter(T);
  const big = valueNoise(seed, 2), small = valueNoise(seed + 1, 4);
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const v = 0.5 * big((x * 2) / T, (y * 2) / T) + 0.5 * small((x * 4) / T, (y * 4) / T);
      put(x, y, "grass", flat ? 2 : v > 0.78 ? 3 : v < 0.16 ? 1 : 2);
    }
  for (let i = 0; i < perArea(T); i++) {
    const x = r.int(0, T - 1), y = r.int(0, T - 1);
    put(x, y, "grass", 3);
    put(x, y + 1, "grass", 1);
  }
  return s;
}

function dirtTile(T: number, r: Rng, seed: number, flat: boolean): Sprite {
  const { s, put } = painter(T);
  const big = valueNoise(seed, 2), small = valueNoise(seed + 1, 4);
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const v = 0.5 * big((x * 2) / T, (y * 2) / T) + 0.5 * small((x * 4) / T, (y * 4) / T);
      put(x, y, "dirt", flat ? 2 : v > 0.78 ? 3 : v < 0.16 ? 1 : 2);
    }
  for (let i = 0; i < perArea(T); i++) {
    const x = r.int(0, T - 1), y = r.int(0, T - 1);
    put(x, y, "dirt", 3);
    put(x + 1, y, "dirt", 1);
  }
  return s;
}

function sandTile(T: number, r: Rng, seed: number, flat: boolean): Sprite {
  const { s, put } = painter(T);
  const n = valueNoise(seed, 2);
  const cycles = Math.max(2, Math.round(T / 8));
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const warp = 0.12 * Math.sin((2 * Math.PI * x) / T) + 0.18 * n((x * 2) / T, (y * 2) / T);
      const w = Math.sin(2 * Math.PI * ((y / T) * cycles + warp));
      put(x, y, "sand", flat ? 3 : w > 0.93 ? 4 : w < -0.93 ? 2 : 3);
    }
  for (let i = 0; i < perArea(T); i++) {
    const x = r.int(0, T - 1), y = r.int(0, T - 1);
    put(x, y, "sand", 2);
    put(x + 1, y, "sand", 4);
  }
  return s;
}

function snowTile(T: number, r: Rng, seed: number, flat: boolean): Sprite {
  const { s, put } = painter(T);
  const big = valueNoise(seed, 2), small = valueNoise(seed + 1, 4);
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const v = 0.4 * big((x * 2) / T, (y * 2) / T) + 0.6 * small((x * 4) / T, (y * 4) / T);
      if (v < 0.12 && !flat) put(x, y, "stone", 4);
      else put(x, y, "ui", 4);
    }
  for (let i = 0; i < perArea(T); i++) {
    const x = r.int(0, T - 1), y = r.int(0, T - 1);
    put(x, y, "stone", flat ? 3 : 4);
    put(x + 1, y, "stone", flat ? 3 : 4);
  }
  return s;
}

function stonePathTile(T: number, r: Rng, kit: StyleKit): Sprite {
  const { s, put } = painter(T);
  const c = Math.max(2, Math.round(T / 5));
  const cell = T / c;
  const pts: { x: number; y: number; base: number }[] = [];
  for (let j = 0; j < c; j++)
    for (let i = 0; i < c; i++) pts.push({ x: (i + 0.25 + 0.5 * r.next()) * cell, y: (j + 0.25 + 0.5 * r.next()) * cell, base: r.chance(0.5) ? 3 : 2 });
  const L = lightVector(kit.lightDir);
  const half = T / 2;
  const d = (a: number, b: number) => {
    let v = a - b;
    if (v > half) v -= T;
    if (v < -half) v += T;
    return v;
  };
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      let d1 = Infinity, d2 = Infinity, best = pts[0], bdx = 0, bdy = 0;
      for (const p of pts) {
        const dx = d(x + 0.5, p.x), dy = d(y + 0.5, p.y);
        const dist = Math.hypot(dx, dy);
        if (dist < d1) { d2 = d1; d1 = dist; best = p; bdx = dx; bdy = dy; }
        else if (dist < d2) d2 = dist;
      }
      const gap = d2 - d1;
      if (gap < 0.9) { put(x, y, "stone", 1); continue; }
      let level = best.base;
      if (gap < 2.1) {
        const lit = -(bdx * L[0] + bdy * L[1]) / (d1 || 1);
        if (lit > 0.2) level += 1;
        else if (lit < -0.2) level -= 1;
      }
      put(x, y, "stone", level);
    }
  for (let i = 0; i < Math.round(T / 8); i++) put(r.int(0, T - 1), r.int(0, T - 1), "stone", 4);
  return s;
}

function waterTile(T: number, r: Rng, seed: number): Sprite[] {
  const n = valueNoise(seed, 2);
  const sparkles = Array.from({ length: Math.max(2, Math.round(T / 5)) }, () => ({ x: r.int(0, T - 1), y: r.int(0, T - 1), f: r.int(0, WATER_FRAMES - 1) }));
  const frames: Sprite[] = [];
  const tau = 2 * Math.PI;
  for (let f = 0; f < WATER_FRAMES; f++) {
    const { s, put } = painter(T);
    const ph = f / WATER_FRAMES;
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) {
        const warp = n((x * 2) / T, (y * 2) / T) * 2.4;
        const w1 = Math.sin(tau * ((x / T) * 1 + (y / T) * 2 - ph) + warp);
        const w2 = Math.sin(tau * ((x / T) * 2 - (y / T) * 1 + ph) + warp * 0.6);
        const v = w1 * 0.65 + w2 * 0.35;
        put(x, y, "water", v > 0.62 ? 3 : v < -0.6 ? 1 : 2);
      }
    for (const sp of sparkles) if (sp.f === f) put(sp.x, sp.y, "water", 4);
    frames.push(s);
  }
  return frames;
}

/**
 * Flooded rice field: muddy water with rows of seedlings. Rows and seedlings sit on
 * lattices that divide the tile, ripples are low-contrast streaks drifting sideways, and
 * the seedling tips sway one pixel between frames.
 */
function paddyTile(T: number, r: Rng, seed: number, flat: boolean): Sprite[] {
  const mud = valueNoise(seed + 3, 4);
  const tau = 2 * Math.PI;
  const rowsN = Math.max(1, Math.round(T / 8));
  const gap = T / rowsN;
  const step = Math.max(3, Math.round(T / 4)); // seedling spacing along a row
  const per = Math.max(1, Math.round(T / step));
  // each row gets its own x jitter (and a tiny per-seedling wobble) so no lattice shows when tiled
  const rowOff = Array.from({ length: rowsN }, () => r.int(0, T - 1));
  const wob = Array.from({ length: rowsN * per }, () => (r.chance(0.3) ? 1 : 0));
  const rowPhase = Array.from({ length: T }, () => r.next() * tau);
  const rowOn = Array.from({ length: T }, () => r.chance(0.3));
  const frames: Sprite[] = [];
  for (let f = 0; f < WATER_FRAMES; f++) {
    const { s, put } = painter(T);
    const ph = f / WATER_FRAMES;
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) {
        const m = mud((x * 4) / T, (y * 4) / T);
        put(x, y, m > 0.82 && !flat ? "dirt" : "water", 2);
        // sky glints on the surface: short horizontal streaks that drift along their row
        const w = Math.sin(tau * (x / T - ph) + rowPhase[y]);
        if (rowOn[y] && w > 0.85 && !(m > 0.82 && !flat)) put(x, y, "water", 3);
      }
    for (let j = 0; j < rowsN; j++) {
      const y = Math.round(gap * (j + 0.5)) + 1;
      for (let i = 0; i < per; i++) {
        const x = Math.round((i * T) / per) + rowOff[j] + wob[j * per + i];
        const sway = f === 1 ? 1 : f === 3 ? -1 : 0;
        put(x, y + 1, "grass", flat ? 3 : 2); // stem
        put(x + (sway > 0 ? 1 : 0), y, "grass", flat ? 4 : 3); // leaf leans with the breeze
      }
    }
    frames.push(s);
  }
  return frames;
}


// ---------------------------------------------------------------------------
// Soil tiles: furrows run along x with period 4, so they meet themselves on every edge.
// ---------------------------------------------------------------------------

function soilTile(T: number, r: Rng, kind: (typeof SOIL_TILE_KINDS)[number], flat: boolean): Sprite {
  const { s, put } = painter(T);
  const row = (y: number) => y % 4;
  const scatter = (n: number, m: Material, level: number, rows: number[]) => {
    for (let i = 0; i < n; i++) {
      const y = r.int(0, T - 1);
      if (rows.includes(row(y))) put(r.int(0, T - 1), y, m, level);
    }
  };
  const n = perArea(T) * 3;
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const q = row(y);
      if (kind === "tilled-soil-tile") put(x, y, "dirt", [2, 2, 1, 0][q]);
      else if (kind === "watered-soil-tile") put(x, y, "dirt", (flat ? [1, 1, 1, 0] : [1, 1, 0, 0])[q]);
      else if (kind === "dried-soil-tile") put(x, y, "dirt", [4, 4, 3, 3][q]);
      else put(x, y, "ui", [4, 4, 3, 3][q]);
    }
  if (kind === "tilled-soil-tile") {
    scatter(n, "dirt", 3, [0]);
    if (!flat) scatter(n, "dirt", 1, [0, 1]);
  } else if (kind === "watered-soil-tile") {
    // few tones: dithered mid-tone on the lit ridges so wet soil is not a solid dark slab
    if (flat) for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (row(y) < 2 && (x + y) % 2 === 0) put(x, y, "dirt", 2);
    // wet sheen: short glints on the lit ridge, a darker dirt crumb or two
    for (let i = 0; i < Math.max(2, T / 4); i++) {
      const x = r.int(0, T - 1), y = r.int(0, Math.floor(T / 4) - 1) * 4;
      put(x, y, "water", 2);
      put(x + 1, y, "water", 3);
    }
    if (!flat) scatter(n, "dirt", 2, [1]);
  } else if (kind === "dried-soil-tile") {
    // cracks: short wrapped random walks
    const cracks = Math.max(2, Math.round(T / 5));
    for (let i = 0; i < cracks; i++) {
      let x = r.int(0, T - 1), y = r.int(0, T - 1);
      const len = r.int(4, 7);
      for (let j = 0; j < len; j++) {
        put(x, y, "dirt", 1);
        if (r.chance(0.6)) y++;
        else x += r.chance(0.5) ? 1 : -1;
        if (j === len - 1) put(x, y, "dirt", 2);
      }
    }
    scatter(n, "dirt", 2, [0, 1, 2, 3]);
  } else {
    // snowed: dirt barely shows through at the bottom of each furrow
    for (let y = 3; y < T; y += 4) for (let x = 0; x < T; x++) if (r.chance(flat ? 0.1 : 0.2)) put(x, y, "dirt", 1);
    scatter(n, "stone", flat ? 3 : 4, [0]);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Prop animations. Every frame is derived from the idle prop's pre-outline
// sprite (so one painting, one light) by shearing, shaking, rotating or
// cutting it, then finalized. Flying bits are stamped afterwards.
// ---------------------------------------------------------------------------

const sget = (s: Sprite, x: number, y: number) => (x < 0 || y < 0 || x >= s.w || y >= s.h ? 0 : s.data[y * s.w + x]);

function warp(src: Sprite, f: (x: number, y: number) => [number, number] | null): Sprite {
  const out = createSprite(src.w, src.h);
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const m = f(x, y);
      if (m) out.data[y * src.w + x] = sget(src, Math.floor(m[0]), Math.floor(m[1]));
    }
  return out;
}

const copy = (s: Sprite): Sprite => ({ w: s.w, h: s.h, data: s.data.slice() });

/** Sway: everything above `thr` (fraction of the prop's height) slides one pixel. */
function sway(raw: Sprite, G: number, off: number, thr: number): Sprite {
  const b = bounds(raw);
  if (!b || !off) return raw;
  const hgt = G - b.y0 + 1;
  return warp(raw, (x, y) => [x - ((G - y) / hgt > thr ? off : 0), y]);
}

/** Whole prop above `fromY` moves by dx; rows above `dipBelow` also drop by dy. */
function shake(raw: Sprite, fromY: number, dx: number, dy: number, dipBelow: number): Sprite {
  return warp(raw, (x, y) => (y < fromY ? [x - dx, y - (y < dipBelow ? dy : 0)] : [x, y]));
}

interface Bit { x: number; y: number; vx: number; vy: number; v: number; wide?: boolean }

function stamp(s: Sprite, bits: Bit[], t: number) {
  for (const b of bits) {
    const x = Math.round(b.x + b.vx * t), y = Math.round(b.y + b.vy * t + 0.7 * t * t);
    for (let i = 0; i < (b.wide ? 2 : 1); i++) if (x + i >= 0 && y >= 0 && x + i < s.w && y < s.h && !s.data[y * s.w + x + i]) s.data[y * s.w + x + i] = b.v;
  }
}

const fin = (s: Sprite, kit: StyleKit) => finalize(s, kit);

function centreX(raw: Sprite, y: number): number {
  let a = -1, z = -1;
  for (let x = 0; x < raw.w; x++) if (sget(raw, x, y)) { if (a < 0) a = x; z = x; }
  return a < 0 ? raw.w / 2 : (a + z + 1) / 2;
}

/** Light cut face on a trunk: used for the stump top. */
function cutFace(raw: Sprite, y: number, m: Material): Sprite {
  const out = copy(raw);
  for (let x = 0; x < raw.w; x++) if (sget(raw, x, y)) out.data[y * raw.w + x] = colorIndex(m, 3);
  return out;
}

function woodChips(c: Ctx, x: number, y: number, side: number, n: number, rr: Rng): Bit[] {
  const sc = Math.max(0.7, c.k);
  return Array.from({ length: n }, (_, i) => ({
    x, y,
    vx: (i % 3 === 2 ? -side : side) * (0.7 + rr.next() * 1.3) * sc,
    vy: -(1 + rr.next() * 1.6) * sc,
    v: colorIndex(c.trunk, [4, 3, 2][i % 3]),
    wide: i % 2 === 0,
  }));
}

function leafBits(c: Ctx, raw: Sprite, n: number, rr: Rng): Bit[] {
  const pts: [number, number, number][] = [];
  const b = bounds(raw);
  if (!b) return [];
  for (let y = b.y0; y < b.y0 + (b.y1 - b.y0) * 0.7; y++)
    for (let x = b.x0; x <= b.x1; x++) {
      const v = sget(raw, x, y);
      if (v && decodeIndex(v)?.mat === c.foliage && (x < b.x0 + 4 * c.k || x > b.x1 - 4 * c.k || y < b.y0 + 3)) pts.push([x, y, v]);
    }
  if (!pts.length) return [];
  return Array.from({ length: n }, () => {
    const p = pts[rr.int(0, pts.length - 1)];
    return { x: p[0], y: p[1], vx: (rr.next() - 0.5) * 1.2, vy: 0.5 + rr.next() * 0.8, v: p[2] };
  });
}

function treeRows(c: Ctx, raw: Sprite, kit: StyleKit, kind: string, cuttable: boolean, rr: Rng): FrameSet[] {
  const { G, k } = c;
  const thr = kind === "pine" ? 0.5 : 0.58;
  const rows: FrameSet[] = [{ name: "sway", frames: [0, 1, 0, -1].map((o) => fin(sway(raw, G, o, thr), kit)) }];
  if (!cuttable) return rows;

  const sh = Math.max(2, Math.round(5 * k));
  const cutY = G - sh;
  const hitY = G - Math.max(4, Math.round(8 * k));
  const bx = Math.round(centreX(raw, G - 1));
  // chop: shake the tree, bite a light wound into the trunk, throw chips and leaves
  const wound = (s: Sprite, w: number) => {
    const out = copy(s);
    let xl = -1;
    for (let x = 0; x < s.w; x++) if (sget(s, x, hitY)) { xl = x; break; }
    if (xl < 0) return out;
    for (let i = 0; i < w + 1; i++) {
      out.data[hitY * s.w + xl + i] = colorIndex(c.trunk, 4);
      out.data[(hitY + 1) * s.w + xl + i] = colorIndex(c.trunk, 4);
      if (i < w) out.data[(hitY + 2) * s.w + xl + i] = colorIndex(c.trunk, 1);
    }
    return out;
  };
  let hx = bx;
  for (let x = 0; x < raw.w; x++) if (sget(raw, x, hitY)) { hx = x; break; }
  const chipsA = woodChips(c, hx - 1, hitY, -1, 6, rr);
  const leaves = kind === "dead-tree" ? [] : leafBits(c, raw, 4, rr);
  const plan = [
    { dx: 1, dy: 0, w: 1, t: 0.6, lv: false },
    { dx: -1, dy: 1, w: 2, t: 1.6, lv: true },
    { dx: 1, dy: 0, w: 2, t: 2.8, lv: true },
    { dx: 0, dy: 0, w: 2, t: 4, lv: true },
  ];
  const chop = plan.map((f, i) => {
    const wounded = wound(raw, f.w);
    let s = fin(shake(wounded, cutY, f.dx, f.dy, G * 0.55), kit);
    // a sway that would push the crown onto the canvas edge is dropped
    const eb = bounds(s), rb = bounds(fin(raw, kit));
    if (eb && rb && ((eb.x1 === s.w - 1 && rb.x1 < s.w - 1) || (eb.x0 === 0 && rb.x0 > 0))) s = fin(shake(wounded, cutY, 0, f.dy, G * 0.55), kit);
    stamp(s, chipsA, f.t);
    if (f.lv) stamp(s, leaves, f.t - 0.6 + i * 0.3);
    return s;
  });
  rows.push({ name: "chop", frames: chop });

  // stump (static part of the trunk with a pale cut face) and the falling tree above it
  const stumpOnly = createSprite(raw.w, raw.h);
  const crown = createSprite(raw.w, raw.h);
  for (let y = 0; y < raw.h; y++) for (let x = 0; x < raw.w; x++) (y >= cutY ? stumpOnly : crown).data[y * raw.w + x] = sget(raw, x, y);
  const stumpCut = cutFace(stumpOnly, cutY, c.trunk);
  const cb = bounds(crown);
  const fall: Sprite[] = [];
  if (cb) {
    const len = cutY - cb.y0;
    const hw = Math.max(bx - cb.x0, cb.x1 + 1 - bx);
    const sFit = Math.min(1, (raw.w - 6) / Math.max(1, len));
    [10, 34, 62, 90, 90].forEach((deg, i) => {
      const p = deg / 90;
      const th = (deg * Math.PI) / 180;
      const sc0 = 0.92 + (sFit - 0.92) * p;
      const px = bx + (3 - bx) * Math.sqrt(p);
      // shrink the lying crown until it clears the canvas edges (1px margin), so no frame is cut flat
      let rot = crown;
      for (let sc = sc0; sc > 0.3; sc *= 0.95) {
        const lift = hw * sc * Math.sin(th) * 0.7;
        rot = warp(crown, (x, y) => {
          const xr = (x + 0.5 - px) / sc, hr = (cutY - (y + 0.5) - lift) / sc;
          const u = xr * Math.cos(th) - hr * Math.sin(th);
          const h = xr * Math.sin(th) + hr * Math.cos(th);
          const sy = cutY - h;
          return sy >= cutY ? null : [bx + u, sy];
        });
        const rb = bounds(rot);
        if (!rb || (rb.x0 >= 2 && rb.x1 <= raw.w - 3 && rb.y0 >= 2)) break;
      }
      if (i === 4) for (let y = 0; y < rot.h; y++) for (let x = 0; x < rot.w; x++) if ((x + y) % 2) rot.data[y * rot.w + x] = 0;
      for (let j = 0; j < stumpCut.data.length; j++) if (stumpCut.data[j]) rot.data[j] = stumpCut.data[j];
      fall.push(fin(rot, kit));
    });
  }
  rows.push({ name: "fall", frames: fall });
  rows.push({ name: "stump", frames: [fin(stumpCut, kit)] });
  return rows;
}

function cutRows(raw: Sprite, kit: StyleKit, keep: number[], rr: Rng): FrameSet {
  const b = bounds(raw)!;
  const hgt = b.y1 - b.y0 + 1;
  const frames = keep.map((kf, i) => {
    const cy = b.y1 + 1 - Math.max(2, Math.round(hgt * kf));
    const kept = createSprite(raw.w, raw.h);
    const bits: Bit[] = [];
    for (let y = 0; y < raw.h; y++)
      for (let x = 0; x < raw.w; x++) {
        const v = sget(raw, x, y);
        if (!v) continue;
        if (y >= cy) kept.data[y * raw.w + x] = v;
        else if ((x * 7 + y * 13) % 4 === 0 && i < keep.length - 1) bits.push({ x, y, vx: (x - raw.w / 2) * 0.28 + (rr.next() - 0.5), vy: -1.2 - rr.next() * 1.5, v });
      }
    const s = fin(kept, kit);
    stamp(s, bits, 0.7 + i * 1.1);
    return s;
  });
  return { name: "cut", frames };
}

function breakRows(c: Ctx, raw: Sprite, kit: StyleKit, rr: Rng): FrameSet {
  const { G, k } = c;
  const b = bounds(raw)!;
  const cx = Math.round((b.x0 + b.x1 + 1) / 2);
  const top = b.y0 + 1;
  const crackPts: [number, number][] = [];
  let x = cx + 1;
  for (let y = top; y < G - 1; y++) {
    crackPts.push([x, y]);
    if ((y - top) % 3 === 1) x += rr.chance(0.5) ? 1 : -1;
  }
  const dark = colorIndex(c.stone, 0);
  const cracked = (frac: number) => {
    const s = copy(raw);
    crackPts.slice(0, Math.max(2, Math.round(crackPts.length * frac))).forEach(([px, py]) => {
      if (s.data[py * s.w + px]) s.data[py * s.w + px] = dark;
    });
    return s;
  };
  const f0 = fin(cracked(0.5), kit);
  const f1 = fin(warp(cracked(1), (px, py) => (px < cx - 1 ? [px + 1, py] : px > cx ? [px - 1, py] : null)), kit);
  // crumble: the lower part stays, ragged; the rest drops as chunks
  const cy = b.y1 + 1 - Math.max(3, Math.round((b.y1 - b.y0 + 1) * 0.42));
  const kept = createSprite(raw.w, raw.h);
  const bits: Bit[] = [];
  for (let y = 0; y < raw.h; y++)
    for (let xx = 0; xx < raw.w; xx++) {
      const v = sget(raw, xx, y);
      if (!v) continue;
      if (y >= cy + ((xx * 5) % 3 === 0 ? 1 : 0)) kept.data[y * raw.w + xx] = v;
      else if ((xx + y * 2) % 5 === 0) bits.push({ x: xx, y, vx: (xx - cx) * 0.2, vy: 0.3, v, wide: true });
    }
  const f2 = fin(kept, kit);
  stamp(f2, bits, 1.5);
  const P = new Painter(raw.w, raw.h, kit);
  const span = (b.x1 - b.x0) / 2;
  const pebbles: [number, number, number][] = [[-0.7, 2.4, 0], [0.1, 1.8, -1], [0.7, 2.2, 0], [-0.2, 1.2, 1], [0.45, 1.2, -1]];
  for (const [dx, rad, tone] of pebbles) {
    const rpx = Math.max(1, rad * k);
    P.ellipse(cx + dx * span, G - rpx, rpx, Math.max(0.8, rpx * 0.8), c.stone, { tone, flat: 0.2 });
  }
  void rr;
  return { name: "break", frames: [f0, f1, f2, fin(P.toSprite(), kit)] };
}

function chopStumpRows(c: Ctx, raw: Sprite, kit: StyleKit, rr: Rng): FrameSet {
  const { G, k } = c;
  const b = bounds(raw)!;
  const hitY = G - Math.max(3, Math.round(6 * k));
  const wound = (w: number) => {
    const out = copy(raw);
    for (let i = 0; i < w + 1; i++) {
      out.data[hitY * raw.w + b.x0 + 1 + i] = colorIndex(c.trunk, 4);
      out.data[(hitY + 1) * raw.w + b.x0 + 1 + i] = colorIndex(c.trunk, 4);
      if (i < w) out.data[(hitY + 2) * raw.w + b.x0 + 1 + i] = colorIndex(c.trunk, 1);
    }
    return out;
  };
  const chips = woodChips(c, b.x0, hitY, -1, 6, rr);
  const plan = [{ dx: 1, w: 1, t: 0.6 }, { dx: -1, w: 2, t: 1.6 }, { dx: 1, w: 2, t: 2.8 }, { dx: 0, w: 2, t: 4 }];
  return {
    name: "chop",
    frames: plan.map((f) => {
      const s = fin(shake(wound(f.w), G - 2, f.dx, 0, 0), kit);
      stamp(s, chips, f.t);
      return s;
    }),
  };
}

function propRows(c: Ctx, raw: Sprite, kit: StyleKit, kind: string, cuttable: boolean, mixed: number): FrameSet[] {
  const rr = rng((mixed ^ 0x51ed27) >>> 0);
  const swayRow = (thr: number): FrameSet => ({ name: "sway", frames: [0, 1, 0, -1].map((o) => fin(sway(raw, c.G, o, thr), kit)) });
  switch (kind) {
    case "oak": case "pine": case "palm": case "dead-tree":
      return treeRows(c, raw, kit, kind, cuttable, rr);
    case "old-oak":
      return treeRows(c, raw, kit, kind, false, rr);
    case "bush":
      return [swayRow(0.5), cutRows(raw, kit, [0.85, 0.7, 0.6, 0.6], rr)];
    case "flowers":
      return [swayRow(0.45)];
    case "tall-grass":
      return [swayRow(0.45), cutRows(raw, kit, [0.7, 0.45, 0.25, 0.2], rr)];
    case "rock": case "boulder":
      return [breakRows(c, raw, kit, rr)];
    case "stump":
      return [chopStumpRows(c, raw, kit, rr)];
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------

export const environmentGenerator: Generator = {
  id: "environment",
  category: "environment",
  label: "Environment",
  description: "Nature props (trees, bushes, rocks, flowers, crystals) and seamless ground tiles (grass, dirt, sand, animated water, stone path, snow, animated flooded rice paddy).",
  params: [
    { key: "kind", label: "Kind", type: "select", options: [...PROP_KINDS, ...EXTRA_PROP_KINDS, ...TILE_KINDS, ...SOIL_TILE_KINDS, ...WATER_PROP_KINDS], default: "oak" },
    { key: "foliage", label: "Foliage", type: "material", options: FOLIAGE, default: "foliage" },
    { key: "trunk", label: "Trunk / wood", type: "material", options: TRUNKS, default: "wood" },
    { key: "stone", label: "Stone / rock", type: "material", options: STONES, default: "stone" },
    { key: "accent", label: "Flowers / fruit / crystal", type: "material", options: ACCENTS, default: "cloth2" },
    { key: "variant", label: "Variant", type: "number", min: 0, max: 9, step: 1, default: 0 },
    { key: "cuttable", label: "Cuttable tree (chop / fall / stump rows)", type: "bool", default: true },
    { key: "piece", label: "Fence piece", type: "select", options: [...FENCE_PIECES], default: "h" },
    { key: "depth", label: "Water depth (water-tile; -1 = classic, 0 shallow .. 3 abyss)", type: "number", min: -1, max: 3, step: 1, default: -1 },
    { key: "shore", label: "Shore edges (water-tile with land on those sides: foam + wet bank)", type: "select", options: SHORE_OPTIONS, default: "" },
    { key: "shore_rocks", label: "Rocks on the bank (shore tiles)", type: "bool", default: false },
    { key: "flower", label: "Lily pad flower", type: "bool", default: true },
    { key: "span", label: "Bridge span in tiles (small-bridge, 1-3)", type: "number", min: 1, max: 3, step: 1, default: 1 },
  ],
  generate: (p, kit, seed) => generateEnvironment(p, kit, seed, false),
};

/** Just the idle frame (row 0, frame 0): maps scatter many props and never use their animation rows. */
export function environmentIdle(p: Params, kit: StyleKit, seed: number): Sprite {
  return generateEnvironment(p, kit, seed, true).rows[0].frames[0];
}

function generateEnvironment(p: Params, kit: StyleKit, seed: number, idleOnly: boolean): GenResult {
  {
    const kind = str(p, "kind");
    const variant = Math.max(0, Math.min(9, Math.round(num(p, "variant") || 0)));
    const mixed = (seed + hashString(kind) + variant * 7919) >>> 0;
    const r = rng(mixed);

    if (kind === "fence") {
      const piece = str(p, "piece");
      return fenceRows(kit, ((FENCE_PIECES as readonly string[]).includes(piece) ? piece : "h") as FencePiece, mat(p, "trunk"));
    }

    if ((TILE_KINDS as readonly string[]).includes(kind) || (SOIL_TILE_KINDS as readonly string[]).includes(kind)) {
      const T = kit.sizes.tile;
      const flat = kit.shadeSteps <= 3; // few tones: skip patchy noise, keep the texture to tufts/pebbles
      if ((SOIL_TILE_KINDS as readonly string[]).includes(kind)) return { rows: [{ name: "idle", frames: [soilTile(T, r, kind as (typeof SOIL_TILE_KINDS)[number], flat)] }], fps: 1 };
      if (kind === "paddy-tile") return { rows: [{ name: "idle", frames: paddyTile(T, r, mixed, flat) }], fps: 3 };
      if (kind === "water-tile" && (num(p, "depth") >= 0 || str(p, "shore"))) {
        const depth = Math.max(0, Math.round(num(p, "depth")) || 0);
        return { rows: [{ name: "idle", frames: waterDepthTile(T, mixed, kit, { depth, shore: str(p, "shore"), rocks: bool(p, "shore_rocks") }) }], fps: 4 };
      }
      if (kind === "water-tile") return { rows: [{ name: "idle", frames: waterTile(T, r, mixed) }], fps: 4 };
      const sprite =
        kind === "dirt-tile" ? dirtTile(T, r, mixed, flat) :
        kind === "sand-tile" ? sandTile(T, r, mixed, flat) :
        kind === "snow-tile" ? snowTile(T, r, mixed, flat) :
        kind === "stone-path-tile" ? stonePathTile(T, r, kit) :
        grassTile(T, r, mixed, flat);
      return { rows: [{ name: "idle", frames: [sprite] }], fps: 1 };
    }

    if ((WATER_PROP_KINDS as readonly string[]).includes(kind)) {
      const o = { foliage: mat(p, "foliage"), trunk: mat(p, "trunk"), stone: mat(p, "stone"), accent: mat(p, "accent"), variant, flower: bool(p, "flower"), span: num(p, "span") };
      return { rows: waterPropRows(kind, kit, mixed, o, idleOnly), fps: 6 };
    }

    const old = kind === "old-oak";
    const S = old ? Math.round(kit.sizes.environment * 1.4) : kit.sizes.environment;
    const k = (old ? OLD_OAK_SCALE : 1) * (kit.sizes.environment / 32);
    const H = treeHeight(kit, kind);
    const ctx: Ctx = {
      P: new Painter(S, H, kit),
      S,
      H,
      k,
      G: H - 1,
      r,
      v: variant,
      foliage: mat(p, "foliage"),
      trunk: mat(p, "trunk"),
      stone: mat(p, "stone"),
      accent: mat(p, "accent"),
      R: (n) => Math.round(n * k),
      R1: (n) => Math.max(1, Math.round(n * k)),
    };
    if (old) oldOak(ctx);
    else (PROPS[kind as (typeof PROP_KINDS)[number]] ?? oak)(ctx);
    const raw = ctx.P.toSprite();
    const rows: FrameSet[] = [{ name: "idle", frames: [finalize(raw, kit)] }, ...(idleOnly ? [] : propRows(ctx, raw, kit, kind, bool(p, "cuttable"), mixed))];
    for (const row of rows.slice(1)) for (const f of row.frames) keepMargin(f, rows[0].frames[0]);
    return { rows, fps: rows.length > 1 ? 8 : 1 };
  }
}

/** Animation debris/sway may not reach an edge the idle frame leaves free: drop those border pixels. */
function keepMargin(f: Sprite, idle: Sprite) {
  const ib = bounds(idle);
  if (!ib) return;
  const clear = (x: number, y: number) => { f.data[y * f.w + x] = 0; };
  for (let i = 0; i < f.h; i++) {
    if (ib.x0 > 0) clear(0, i);
    if (ib.x1 < f.w - 1) clear(f.w - 1, i);
  }
  for (let i = 0; i < f.w; i++) if (ib.y0 > 0) clear(i, 0);
}

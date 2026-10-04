import { finalize } from "../enforce";
import { lightVector, proportions } from "../kit";
import { Painter } from "../painter";
import { colorIndex, type Material } from "../palette";
import { hashString, rng, valueNoise, type Rng } from "../rng";
import { createSprite, setPx } from "../sprite";
import type { Sprite, StyleKit } from "../types";
import { mat, num, str, type Generator } from "./types";

/** Seamless ground tiles (no outline, exactly kit.sizes.tile square, must tile/wrap). */
export const TILE_KINDS = ["grass-tile", "dirt-tile", "sand-tile", "water-tile", "stone-path-tile", "snow-tile", "paddy-tile"] as const;
/** Free-standing props (outlined, transparent background). */
export const PROP_KINDS = ["oak", "pine", "palm", "dead-tree", "bush", "rock", "boulder", "flowers", "mushroom", "tall-grass", "stump", "crystal"] as const;

const FOLIAGE: Material[] = ["foliage", "grass", "accent", "cloth", "cloth2", "sand", "gold", "water"];
const TRUNKS: Material[] = ["wood", "leather", "stone", "dirt", "metal", "hair"];
const STONES: Material[] = ["stone", "metal", "dirt", "sand", "wood", "accent"];
const ACCENTS: Material[] = ["cloth2", "accent", "gold", "cloth", "skin", "sand", "foliage", "water"];

const WATER_FRAMES = 4;

export const TREE_KINDS = ["oak", "pine", "palm", "dead-tree"] as const;
/** Canvas height of a prop: trees are ~2x a character (proportions) plus a 2px margin, the rest are square. */
export function treeHeight(kit: StyleKit, kind: string): number {
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
  const off = r.int(0, 2);
  const rowPhase = Array.from({ length: T }, () => r.next() * tau);
  const rowOn = Array.from({ length: T }, (_, y) => y % 3 === off % 3 && !(Math.round(gap * 0.5) + 1 === y));
  const frames: Sprite[] = [];
  for (let f = 0; f < WATER_FRAMES; f++) {
    const { s, put } = painter(T);
    const ph = f / WATER_FRAMES;
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) {
        const m = mud((x * 4) / T, (y * 4) / T);
        put(x, y, m > 0.82 && !flat ? "dirt" : "water", m > 0.82 && !flat ? 1 : 1);
        // sky glints on the surface: short horizontal streaks that drift along their row
        const w = Math.sin(tau * (x / T - ph) + rowPhase[y]);
        if (rowOn[y] && w > 0.8) put(x, y, "water", 2);
      }
    for (let j = 0; j < rowsN; j++) {
      const y = Math.round(gap * (j + 0.5)) + 1;
      for (let i = 0; i < per; i++) {
        const x = Math.round(((i + (j % 2 ? 0.5 : 0)) * T) / per) + off;
        const sway = f === 1 ? 1 : f === 3 ? -1 : 0;
        put(x, y + 1, "water", 0); // root shadow
        put(x, y, "grass", 2);
        put(x - 1, y - 1, "grass", 3);
        put(x + 1, y - 1, "grass", 3);
        put(x + sway, y - 2, "grass", 4);
        if (T >= 24) put(x + sway, y - 3, "grass", 3);
      }
    }
    frames.push(s);
  }
  return frames;
}

// ---------------------------------------------------------------------------

export const environmentGenerator: Generator = {
  id: "environment",
  category: "environment",
  label: "Environment",
  description: "Nature props (trees, bushes, rocks, flowers, crystals) and seamless ground tiles (grass, dirt, sand, animated water, stone path, snow, animated flooded rice paddy).",
  params: [
    { key: "kind", label: "Kind", type: "select", options: [...PROP_KINDS, ...TILE_KINDS], default: "oak" },
    { key: "foliage", label: "Foliage", type: "material", options: FOLIAGE, default: "foliage" },
    { key: "trunk", label: "Trunk / wood", type: "material", options: TRUNKS, default: "wood" },
    { key: "stone", label: "Stone / rock", type: "material", options: STONES, default: "stone" },
    { key: "accent", label: "Flowers / fruit / crystal", type: "material", options: ACCENTS, default: "cloth2" },
    { key: "variant", label: "Variant", type: "number", min: 0, max: 9, step: 1, default: 0 },
  ],
  generate(p, kit, seed) {
    const kind = str(p, "kind");
    const variant = Math.max(0, Math.min(9, Math.round(num(p, "variant") || 0)));
    const mixed = (seed + hashString(kind) + variant * 7919) >>> 0;
    const r = rng(mixed);

    if ((TILE_KINDS as readonly string[]).includes(kind)) {
      const T = kit.sizes.tile;
      const flat = kit.shadeSteps <= 3; // few tones: skip patchy noise, keep the texture to tufts/pebbles
      if (kind === "paddy-tile") return { rows: [{ name: "idle", frames: paddyTile(T, r, mixed, flat) }], fps: 3 };
      if (kind === "water-tile") return { rows: [{ name: "idle", frames: waterTile(T, r, mixed) }], fps: 4 };
      const sprite =
        kind === "dirt-tile" ? dirtTile(T, r, mixed, flat) :
        kind === "sand-tile" ? sandTile(T, r, mixed, flat) :
        kind === "snow-tile" ? snowTile(T, r, mixed, flat) :
        kind === "stone-path-tile" ? stonePathTile(T, r, kit) :
        grassTile(T, r, mixed, flat);
      return { rows: [{ name: "idle", frames: [sprite] }], fps: 1 };
    }

    const S = kit.sizes.environment;
    const k = S / 32;
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
    (PROPS[kind as (typeof PROP_KINDS)[number]] ?? oak)(ctx);
    return { rows: [{ name: "idle", frames: [finalize(ctx.P.toSprite(), kit)] }], fps: 1 };
  },
};

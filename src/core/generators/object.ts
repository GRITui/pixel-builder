import { finalize } from "../enforce";
import { Painter } from "../painter";
import type { Material } from "../palette";
import { rng } from "../rng";
import type { FrameSet, Sprite, StyleKit } from "../types";
import { num, PAINT, str, type Generator, type Params } from "./types";

export const OBJECT_KINDS = [
  "chest", "chest-open", "barrel", "crate", "potion", "sword", "axe", "shield", "bow", "coin", "key",
  "torch", "sign", "pot", "gem", "scroll", "heart", "bomb", "book", "mushroom-item", "apple",
  "hoe", "watering-can", "tool-axe", "pickaxe", "sickle", "hammer", "fishing-rod", "seed-bag",
] as const;

/**
 * Farming tool kinds: rows `icon` (1 frame) and `use` (effect frames on the same canvas, to overlay
 * on a map tile). `tool-axe` is the existing `axe` drawing plus a `use` row; `axe` itself is untouched.
 */
export const TOOL_KINDS = ["hoe", "watering-can", "tool-axe", "pickaxe", "sickle", "hammer", "fishing-rod", "seed-bag"] as const;
const USE_FRAMES = 4;

/** Choices for `main` / `accent`: "natural" keeps each kind's own colours, or re-skin with any paint material. */
const OBJECT_MATS: string[] = ["natural", ...PAINT];

/** Natural [main, accent] materials for each kind (used while the param is left on "natural"). */
const NATURAL: Record<string, [Material, Material]> = {
  chest: ["wood", "metal"],
  "chest-open": ["wood", "metal"],
  barrel: ["wood", "metal"],
  crate: ["wood", "metal"],
  potion: ["cloth2", "wood"],
  sword: ["metal", "gold"],
  axe: ["metal", "wood"],
  shield: ["cloth", "metal"],
  bow: ["wood", "sand"],
  coin: ["gold", "gold"],
  key: ["gold", "gold"],
  torch: ["wood", "cloth2"],
  sign: ["wood", "leather"],
  pot: ["roof", "dirt"],
  gem: ["water", "metal"],
  scroll: ["sand", "cloth2"],
  heart: ["cloth2", "cloth2"],
  bomb: ["metal", "sand"],
  book: ["cloth2", "gold"],
  "mushroom-item": ["cloth2", "sand"],
  apple: ["cloth2", "foliage"],
  hoe: ["metal", "wood"],
  "watering-can": ["water", "metal"],
  "tool-axe": ["metal", "wood"],
  pickaxe: ["metal", "wood"],
  sickle: ["metal", "wood"],
  hammer: ["metal", "wood"],
  "fishing-rod": ["wood", "cloth2"],
  "seed-bag": ["leather", "sand"],
};

/** Painter wrapper that takes coordinates on a 16px design grid and scales them to the kit's object size. */
class D {
  readonly P: Painter;
  readonly k: number;
  constructor(readonly size: number, kit: StyleKit) {
    this.P = new Painter(size, size, kit);
    this.k = size / 16;
  }
  private u(v: number) { return Math.round(v * this.k); }
  box(x: number, y: number, w: number, h: number, m: Material, n: [number, number, number] = [0, 0, 1], tone = 0) {
    const x0 = this.u(x), y0 = this.u(y);
    this.P.box(x0, y0, Math.max(1, this.u(x + w) - x0), Math.max(1, this.u(y + h) - y0), m, n, { tone });
  }
  rect(x: number, y: number, w: number, h: number, m: Material, level: number) {
    const x0 = this.u(x), y0 = this.u(y);
    this.P.rect(x0, y0, Math.max(1, this.u(x + w) - x0), Math.max(1, this.u(y + h) - y0), m, level);
  }
  px(x: number, y: number, m: Material, level: number) { this.rect(x, y, 1, 1, m, level); }
  /** Mirror a design-grid x span when the kit light comes from the right. */
  mx(x: number, w = 1) { return this.P.lightSide > 0 ? 16 - x - w : x; }
  /** Hand-placed highlight/shadow: authored for light from the left, mirrored for light from the right. */
  hpx(x: number, y: number, m: Material, level: number) { this.rect(this.mx(x), y, 1, 1, m, level); }
  hrect(x: number, y: number, w: number, h: number, m: Material, level: number) { this.rect(this.mx(x, w), y, w, h, m, level); }
  ell(cx: number, cy: number, rx: number, ry: number, m: Material, flat = 0, tone = 0) {
    this.P.ellipse(cx * this.k, cy * this.k, rx * this.k, ry * this.k, m, { flat, tone });
  }
  poly(pts: [number, number][], m: Material, n: [number, number, number] = [0, 0, 1], tone = 0) {
    this.P.poly(pts.map(([x, y]) => [x * this.k, y * this.k] as [number, number]), m, n, { tone });
  }
  line(x0: number, y0: number, x1: number, y1: number, m: Material, level: number) {
    const t = Math.max(1, Math.round(this.k));
    for (let j = 0; j < t; j++) for (let i = 0; i < t; i++)
      this.P.line(this.u(x0) + i, this.u(y0) + j, this.u(x1) + i, this.u(y1) + j, m, level);
  }
  erase(x: number, y: number, w: number, h: number) {
    const x0 = this.u(x), y0 = this.u(y);
    this.P.erase(x0, y0, Math.max(1, this.u(x + w) - x0), Math.max(1, this.u(y + h) - y0));
  }
  /** Vertical strips shaded like a cylinder with a per-column vertical extent. */
  column(x: number, w: number, span: (i: number, n: number) => [number, number], m: Material, tone = 0) {
    for (let i = 0; i < w; i++) {
      const u = w <= 1 ? 0 : ((i + 0.5) / w) * 2 - 1;
      const [y0, y1] = span(i, w);
      this.box(x + i, y0, 1, y1 - y0, m, [u, -0.15, Math.sqrt(Math.max(0, 1 - u * u))], tone);
    }
  }
  filled(x: number, y: number) { return this.P.isFilled(Math.floor(x * this.k), Math.floor(y * this.k)); }
  /** Paint a vertical band only where the body already has pixels (follows rounded silhouettes). */
  bandV(x: number, w: number, y0: number, y1: number, m: Material, level: number, hiLevel: number) {
    const hi = this.P.lightSide <= 0 ? 0 : w - 1;
    for (let i = 0; i < w; i++)
      for (let y = y0; y < y1; y++) if (this.filled(x + i, y)) this.px(x + i, y, m, i === hi ? hiLevel : level);
  }
  bandH(x0: number, x1: number, y: number, m: Material, level: number, hiLevel: number) {
    const hi = this.P.lightSide <= 0 ? x0 : x1 - 1;
    for (let x = x0; x < x1; x++) if (this.filled(x, y)) this.px(x, y, m, x === hi ? hiLevel : level);
  }
  sprite(): Sprite { return this.P.toSprite(); }
}

interface Ctx {
  d: D;
  m: Material; // main
  a: Material; // accent
  v: number; // variant 0-9
  f: number; // frame
  r: ReturnType<typeof rng>;
  side: number; // painter light side: -1 light from left, +1 right, 0 top
}

function chest({ d, m, a, v }: Ctx) {
  d.ell(8, 8.5, 6, 5.5, m, 0.45);
  d.box(2, 8, 12, 6, m, [0, 0, 1], -1);
  d.rect(2, 8, 12, 1, "ink", 0); // lid seam (ink so it reads in 4 tones)
  d.rect(3, 9, 10, 1, m, 3 - (v % 2)); // base top light
  d.bandV(4, 2, 3, 14, a, 2, 3);
  d.bandV(10, 2, 3, 14, a, 2, 3);
  d.bandH(2, 14, 13, a, 1, 2);
  // lock
  d.rect(7, 7, 2, 3, "gold", 3);
  d.rect(7, 9, 2, 1, "gold", 2);
  d.px(7, 8, "ink", 0);
  d.hpx(8, 7, "gold", 4);
}

function chestOpen({ d, m, a, v }: Ctx) {
  // lid swung up behind the body: we see its dark inner face
  d.box(2, 1, 12, 7, m, [0, 0.4, 1], -1);
  d.box(3, 2, 10, 5, m, [0, 0.4, 1], -3);
  d.rect(2, 1, 12, 1, m, 3);
  d.bandV(2, 1, 1, 8, a, 2, 3);
  d.bandV(13, 1, 1, 8, a, 2, 3);
  // treasure heap
  d.ell(8, 8.6, 5.6, 3, "gold", 0.2);
  d.hpx(6, 7, "gold", 4); d.hpx(10, 8, "gold", 4); d.hpx(8, 6, "gold", 4);
  d.hpx(5, 8, "gold", 2); d.hpx(11, 9, "gold", 2);
  if (v % 2 === 1) { d.px(9, 7, "cloth2", 4); d.px(7, 8, "water", 4); }
  // body
  d.box(2, 9, 12, 5, m, [0, 0, 1], -1);
  d.rect(2, 9, 12, 1, m, 4);
  d.rect(2, 10, 12, 1, m, 0);
  d.bandV(4, 2, 10, 14, a, 2, 3);
  d.bandV(10, 2, 10, 14, a, 2, 3);
  d.bandH(2, 14, 13, a, 1, 2);
  d.rect(7, 10, 2, 2, "gold", 3);
  d.px(7, 11, "ink", 0);
}

function barrel({ d, m, a, v }: Ctx) {
  const prof: [number, number][] = [[5, 13], [4, 14], [4, 14], [4, 14], [4, 14], [4, 14], [4, 14], [4, 14], [4, 14], [4, 14], [4, 14], [5, 13]];
  d.column(2, 12, (i) => prof[i], m);
  // stave seams
  for (const x of [5, 8, 11]) for (let y = 7; y < 14; y++) if (d.filled(x, y)) d.px(x, y, m, 0);
  d.ell(8, 4, 5.6, 2.4, m, 0.9, 2);
  d.ell(8, 4, 4.2, 1.5, m, 0.9, -2);
  d.bandH(2, 14, 7, a, 2, 3);
  d.bandH(2, 14, 8, a, 1, 2);
  d.bandH(2, 14, 12, a, 2, 3);
  d.bandH(2, 14, 13, a, 1, 2);
  d.bandH(3, 13, 5, a, 2, 3);
  if (v % 2 === 1) d.rect(7, 9, 2, 2, m, 0); // bung
}

function crate({ d, m, a, v, r }: Ctx) {
  d.box(2, 2, 12, 12, m, [0, 0, 1], -1);
  d.box(2, 2, 12, 2, m, [0, -0.5, 1]);
  d.box(2, 12, 12, 2, m, [0, 0.5, 1], -1);
  d.box(2, 2, 2, 12, m, [-0.6, 0, 1]);
  d.box(12, 2, 2, 12, m, [0.6, 0, 1], -1);
  const flip = v % 2 === 1;
  for (let i = 0; i < 8; i++) d.px(flip ? 11 - i : 4 + i, 4 + i, m, 3);
  for (let i = 0; i < 8; i++) d.px(flip ? 12 - i : 3 + i, 4 + i, m, 0);
  for (const [x, y] of [[2, 2], [13, 2], [2, 13], [13, 13]]) if (v >= 1 || r.chance(0.75)) d.px(x, y, a, 3);
  if (v >= 2) {
    d.rect(2, 7, 12, 1, a, 2);
    d.rect(2, 8, 12, 1, a, 1);
  }
}

function potion({ d, m, a, v }: Ctx) {
  const body = v % 3; // 0 round, 1 flask, 2 tall
  const glass = m;
  if (body === 0) {
    d.ell(8, 10, 5.2, 4.2, glass, 0.1);
    d.box(6, 4, 4, 4, glass, [0, 0, 1], 1);
    d.box(5, 3, 6, 1, glass, [0, -1, 0.6], 2);
    d.rect(6, 1, 4, 2, a, 2);
    d.hrect(6, 1, 2, 1, a, 3);
    d.hpx(5, 9, glass, 4); d.hpx(5, 10, glass, 4); d.hpx(6, 8, glass, 4);
    d.hpx(6, 5, glass, 4);
  } else if (body === 1) {
    d.poly([[6, 5], [10, 5], [14, 13], [2, 13]], glass, [0, 0, 1]);
    d.ell(8, 12, 6, 1.8, glass, 0.1);
    d.box(6, 4, 4, 2, glass, [0, 0, 1], 1);
    d.box(5, 3, 6, 1, glass, [0, -1, 0.6], 2);
    d.rect(6, 1, 4, 2, a, 2);
    d.hpx(6, 1, a, 3);
    d.hpx(6, 9, glass, 4); d.hpx(5, 11, glass, 4);
  } else {
    d.box(4, 8, 8, 6, glass, [0, 0, 1]);
    d.ell(8, 12, 4, 2, glass, 0.1);
    d.ell(8, 8, 4, 2, glass, 0.1);
    d.box(6, 3, 4, 6, glass, [0, 0, 1], 1);
    d.box(5, 3, 6, 1, glass, [0, -1, 0.6], 2);
    d.rect(6, 1, 4, 2, a, 2);
    d.hpx(5, 10, glass, 4); d.hpx(5, 11, glass, 4); d.hpx(6, 5, glass, 4);
  }
}

/** Diagonal blade helper: pixels along an anti-diagonal with a lit and shadow edge. */
function sword({ d, m, a, v, side }: Ctx) {
  const long = v % 2 === 0;
  const tipX = 13, tipY = 1;
  const len = long ? 8 : 6;
  const lit = side <= 0 ? 4 : 2, shade = side <= 0 ? 2 : 4;
  for (let t = 0; t < len; t++) {
    const x = tipX - t, y = tipY + t;
    d.px(x, y, m, lit);
    d.px(x - 1, y, m, shade);
    if (t > 0 && t < len) d.px(x - 1, y - 1 + 1, m, shade);
  }
  d.px(tipX, tipY, m, 4);
  d.px(tipX - 1, tipY, m, 3);
  // crossguard
  const gx = tipX - len + 1, gy = tipY + len - 1;
  d.line(gx - 2, gy - 1, gx + 2, gy + 3, a, 3);
  d.line(gx - 2, gy, gx + 2, gy + 4, a, 2);
  d.px(gx - 2, gy - 1, a, 4);
  // grip + pommel
  d.line(gx - 1, gy + 2, gx - 3, gy + 4, "leather", 2);
  d.line(gx - 2, gy + 2, gx - 4, gy + 4, "leather", 1);
  d.rect(gx - 5, gy + 5, 2, 2, a, 3);
  d.px(gx - 5, gy + 5, a, 4);
}

function axe({ d, m, a, v }: Ctx) {
  // handle
  d.line(4, 13, 10, 4, a, 3);
  d.line(5, 13, 11, 4, a, 2);
  d.line(3, 13, 9, 4, a, 1);
  d.rect(3, 13, 2, 1, a, 1);
  // head
  const wide = v % 2 === 0;
  d.poly(wide ? [[9, 2], [13, 1], [15, 3], [15, 8], [13, 9], [10, 6]] : [[9, 2], [13, 2], [14, 4], [14, 7], [12, 8], [10, 6]], m, [0.2, -0.2, 1]);
  d.rect(9, 3, 2, 3, m, 2);
  d.line(14, 3, 14, 7, m, 4);
  d.hpx(10, 3, m, 4);
}

function shield({ d, m, a, v }: Ctx) {
  // left / right halves for a gently domed look
  d.poly([[2, 2], [8, 2], [8, 14], [2, 8]], a, [-0.35, 0, 1]);
  d.poly([[8, 2], [14, 2], [14, 8], [8, 14]], a, [0.35, 0, 1]);
  d.poly([[3, 3], [8, 3], [8, 12], [3, 8]], m, [-0.35, 0, 1]);
  d.poly([[8, 3], [13, 3], [13, 8], [8, 12]], m, [0.35, 0, 1]);
  if (v % 3 === 0) {
    d.rect(7, 3, 2, 8, a, 3); // vertical bar
    d.rect(4, 5, 8, 2, a, 3);
    d.hpx(7, 5, a, 4);
  } else if (v % 3 === 1) {
    d.ell(8, 7, 2.2, 2.2, "gold", 0.3);
    d.hpx(7, 6, "gold", 4);
  } else {
    d.poly([[8, 3], [13, 3], [13, 8], [8, 12]], a, [0.35, 0, 1], -1);
    d.rect(8, 3, 1, 9, a, 2);
  }
}

function bow({ d, m, a, v, side }: Ctx) {
  const arrow = v % 2 === 1;
  for (let t = -6; t <= 6; t++) {
    const x = 3 + Math.round((t * t) / 7);
    d.px(x, 8 + t, m, side > 0 ? 1 : 3);
    d.px(x + 1, 8 + t, m, side > 0 ? 3 : 1);
  }
  d.px(4, 8, "leather", 3); d.px(4, 7, "leather", 2); d.px(4, 9, "leather", 2);
  d.line(9, 2, 9, 14, a, 3);
  d.px(8, 2, m, 2); d.px(8, 14, m, 2);
  if (arrow) {
    d.line(5, 8, 14, 8, "wood", 4);
    d.px(14, 8, "metal", 4); d.px(13, 7, "metal", 3); d.px(13, 9, "metal", 3);
    d.px(5, 7, "cloth2", 3); d.px(5, 9, "cloth2", 3);
  }
}

function coin({ d, m, a, f }: Ctx) {
  const rx = [5.6, 3.8, 1.3, 3.8][f];
  if (f === 2) {
    d.box(7, 2, 2, 12, m, [0.5, 0, 1]);
    d.hrect(7, 2, 1, 12, m, 3);
    d.hrect(8, 2, 1, 12, m, 2);
    d.hpx(7, 3, m, 4);
    return;
  }
  d.ell(8, 8, rx, 6, m, 0.4);
  if (f === 0) {
    d.ell(8, 8, 4.1, 4.5, a, 0.9, -1);
    d.rect(7, 5, 2, 6, m, 3);
    d.hpx(7, 5, m, 4);
    d.hpx(7, 3, m, 4);
  } else if (f === 1) {
    d.ell(8, 8, 2.2, 4.4, a, 0.9, -1);
    d.hrect(8, 6, 1, 4, m, 3);
  } else {
    d.ell(8, 8, 2.2, 4.4, a, 0.9, -1);
    d.hrect(7, 6, 1, 4, m, 3);
  }
}

function key({ d, m, a, v }: Ctx) {
  d.ell(8, 4.5, 3.6, 3.6, m, 0.3);
  d.erase(7, 3, 2, 2);
  d.hpx(5, 3, m, 4);
  d.column(7, 2, () => [8, 14], m);
  const teeth = v % 3;
  d.box(9, 11, 2, 1, a, [0, 0, 1]);
  d.box(9, 13, 2, 1, a, [0, 0, 1]);
  if (teeth === 1) d.box(9, 9, 3, 1, a, [0, 0, 1]);
  if (teeth === 2) { d.box(9, 11, 3, 1, a, [0, 0, 1]); d.box(9, 13, 3, 1, a, [0, 0, 1]); }
  d.hpx(7, 8, m, 4);
}

function torch({ d, m, a, f }: Ctx) {
  d.column(7, 2, () => [8, 14], m);
  d.rect(6, 7, 4, 2, "leather", 2);
  d.rect(6, 7, 4, 1, "leather", 3);
  // flame: dark rim, bright body, hot core (explicit core levels keep it readable on any palette)
  const sway = [0, 1, 0, -1][f];
  const tipY = [1, 0.5, 2, 0.5][f] + 0.5;
  const bx = sway * 0.8;
  d.poly([[8 + sway * 1.5, tipY], [9 + bx * 0.4, 2.8], [10.2 + bx * 0.2, 4.6], [10.6, 6.2], [9.6, 7.6], [6.4, 7.6], [5.4, 6.2], [5.8, 4.6], [7 + bx * 0.4, 3]], a, [0, 0, 1], -1);
  d.poly([[8 + sway * 0.8, tipY + 2], [9.4, 4.6], [10, 6.2], [9.4, 7], [6.6, 7], [6, 6.2], [6.6, 4.6]], a, [0, 0, 1]);
  d.rect(7, 5, 2, 2, "gold", 4);
  d.px(8, 4, "gold", 4);
  if (f === 1) d.px(11, 2, "gold", 4);
  if (f === 3) d.px(4, 3, "gold", 4);
}

function sign({ d, m, a, v, r }: Ctx) {
  d.column(7, 2, () => [8, 14], a);
  d.box(2, 2, 12, 8, m, [0, 0, 1]);
  d.box(2, 2, 12, 1, m, [0, -1, 0.6], 1);
  d.box(2, 9, 12, 1, m, [0, 1, 0.6], -1);
  d.hrect(2, 2, 1, 8, m, 3);
  d.hrect(13, 2, 1, 8, m, 1);
  d.rect(4, 4, r.int(6, 8), 1, m, 0);
  d.rect(4, 6, v % 2 ? 4 : r.int(5, 7), 1, m, 0);
  if (v % 2) d.px(10, 6, m, 0);
  d.px(3, 3, a, 3); d.px(12, 3, a, 3);
}

function pot({ d, m, a, v }: Ctx) {
  d.ell(8, 9, 6, 5, m, 0.05);
  d.erase(4, 13, 8, 2);
  d.box(5, 12, 6, 2, m, [0, 0.4, 1], -1);
  d.box(5, 3, 6, 2, m, [0, 0, 1], 1);
  d.ell(8, 4, 4.4, 1.5, m, 0.8, 1);
  d.ell(8, 4.1, 3.2, 1, a, 0.9, -2);
  d.bandH(2, 14, 8, a, 2, 3);
  if (v % 2 === 1) d.bandH(2, 14, 10, a, 1, 2);
  d.hpx(4, 7, m, 4);
  d.hpx(3, 8, m, 4);
}

function gem({ d, m, a, v, f, r }: Ctx) {
  const wide = v % 2 === 0;
  const l = wide ? 2 : 3, rr = wide ? 14 : 13;
  d.poly([[5, 3], [8, 3], [l + 1, 7], [l, 7]], m, [-0.5, -0.5, 0.9], 1);
  d.poly([[8, 3], [11, 3], [rr, 7], [rr - 1, 7]], m, [0.5, -0.5, 0.9], 1);
  d.poly([[5, 3], [11, 3], [rr, 7], [l, 7]], m, [0, -0.3, 1], 2);
  d.poly([[l, 7], [8, 7], [8, 14]], m, [-0.6, 0.4, 0.7], -1);
  d.poly([[8, 7], [rr, 7], [8, 14]], m, [0.6, 0.4, 0.7], -2);
  d.hrect(5, 4, 3, 1, m, 4);
  d.line(l + 1, 7, 8, 7, m, 4);
  const spots: [number, number][] = [[4, 4], [11, 9], [3, 9], [12, 4]];
  const s1 = spots[r.int(0, 1) * 2], s2 = spots[r.int(0, 1) * 2 + 1];
  const sp = [[], [s1], [s1, s2], [s2]][f] as [number, number][];
  const sparkle = (x: number, y: number, big: boolean) => {
    d.px(x, y, a, 4);
    d.px(x - 1, y, a, 3); d.px(x + 1, y, a, 3); d.px(x, y - 1, a, 3); d.px(x, y + 1, a, 3);
    if (big) { d.px(x - 2, y, a, 4); d.px(x + 2, y, a, 4); d.px(x, y - 2, a, 4); d.px(x, y + 2, a, 4); }
  };
  sp.forEach(([x, y], i) => sparkle(x, y, f === 2 && i === 0));
}

function scroll({ d, m, a, v, r }: Ctx) {
  d.box(3, 4, 10, 8, m, [0, 0, 1], 0);
  const roll = (y: number) => {
    d.box(2, y, 12, 1, m, [0, -0.8, 0.6], 1);
    d.box(2, y + 1, 12, 1, m, [0, 0, 1], 0);
    d.box(2, y + 2, 12, 1, m, [0, 0.8, 0.6], -1);
  };
  roll(2); roll(11);
  d.rect(4, 6, r.int(6, 8), 1, m, 0); d.rect(4, 8, r.int(4, 6), 1, m, 0);
  if (v % 2 === 0) d.rect(4, 10, 4, 1, m, 0);
  d.ell(10.5, 9.5, 1.8, 1.8, a, 0.3);
  d.px(10, 9, a, 4);
}

function heart({ d, m, a }: Ctx) {
  d.ell(5.2, 6, 3.7, 3.6, m, 0.15);
  d.ell(10.8, 6, 3.7, 3.6, m, 0.15);
  d.poly([[1.6, 7], [14.4, 7], [8, 14]], m, [0, 0, 1], 0);
  d.hrect(3, 4, 2, 1, a === m ? m : a, 4);
  d.hpx(3, 5, a === m ? m : a, 4);
  d.erase(7, 3, 2, 1);
}

function bomb({ d, m, a, v }: Ctx) {
  d.ell(7.5, 9.5, 5.6, 5.4, m, 0.1, -1);
  d.box(5, 3, 5, 2, m, [0, -0.3, 1], -1);
  d.rect(5, 3, 5, 1, m, 3);
  d.line(10, 3, 12, 1, a, 3);
  d.px(12, 2, a, 2);
  d.px(13, 1, "gold", 4); d.px(12, 0 + 1, "cloth2", 4);
  d.hpx(4, 8, m, 4); d.hpx(4, 9, m, 4); d.hpx(5, 7, m, 4);
  if (v % 2 === 1) d.bandH(2, 13, 10, "cloth2", 3, 4);
}

function book({ d, m, a, v }: Ctx) {
  d.box(3, 2, 10, 12, m, [0, 0, 1]);
  d.box(3, 2, 2, 12, m, [-0.7, 0, 1], -1);
  d.rect(12, 3, 1, 10, "sand", 3);
  d.rect(4, 13, 8, 1, "sand", 3);
  d.rect(4, 13, 8, 1, "sand", 2);
  d.rect(3, 4, 2, 1, a, 3); d.rect(3, 11, 2, 1, a, 3);
  if (v % 2 === 0) {
    d.rect(7, 5, 4, 4, a, 3);
    d.rect(8, 6, 2, 2, m, 1);
    d.hpx(7, 5, a, 4);
  } else {
    d.rect(7, 5, 4, 1, a, 3);
    d.rect(7, 7, 3, 1, a, 2);
    d.rect(7, 9, 4, 1, a, 2);
  }
}

function mushroom({ d, m, a, v }: Ctx) {
  d.column(6, 4, () => [8, 14], a);
  d.rect(6, 11, 4, 1, a, 1);
  d.ell(8, 7, 6.5, 5, m, 0.1);
  d.erase(1, 9, 14, 2);
  d.rect(2, 9, 12, 1, m, 1);
  d.rect(5, 9, 6, 1, m, 0);
  d.hpx(5, 4, "sand", 4); d.hpx(6, 4, "sand", 4);
  d.rect(9, 3, 2, 2, "sand", 4);
  d.rect(3, 7, 2, 2, "sand", 4);
  d.px(12, 7, "sand", 4);
  if (v % 2 === 1) d.px(8, 6, "sand", 4);
}

function apple({ d, m, a, v }: Ctx) {
  d.ell(8, 9, 5.8, 5.2, m, 0.1);
  d.erase(8, 4, 1, 1);
  d.hpx(5, 7, m, 4); d.hpx(5, 8, m, 4); d.hpx(6, 6, m, 4);
  d.line(8, 4, 9, 2, "leather", 2);
  d.poly([[9, 3], [12, 2], [13, 3], [11, 5]], a, [0.2, -0.3, 1]);
  d.px(11, 3, a, 4);
  if (v % 2 === 1) d.px(10, 11, m, 0);
}

// ---------------------------------------------------------------- farming tools (icons)
/** Two-pixel-wide diagonal handle: lit stroke on the light side, shade stroke opposite. */
function stick(d: D, x0: number, y0: number, x1: number, y1: number, m: Material, side: number) {
  const o = side > 0 ? -1 : 1;
  d.line(x0, y0, x1, y1, m, 3);
  d.line(x0 + o, y0, x1 + o, y1, m, 1);
}

function hoe({ d, m, a, side }: Ctx) {
  stick(d, 3, 14, 10, 5, a, side);
  d.poly([[8, 3], [12, 2], [14, 5], [14, 10], [12, 11], [11, 7], [9, 6]], m, [0.2, -0.2, 1]);
  d.rect(9, 3, 3, 1, m, 4);
  d.line(13, 6, 13, 9, m, 2);
}

function wateringCan({ d, m, a, v }: Ctx) {
  // handle arcs over the top, body is a lit cylinder, spout climbs to a rose
  d.line(4, 8, 5, 4, a, 2); d.line(5, 4, 9, 4, a, 2); d.line(9, 4, 10, 8, a, 2);
  d.column(2, 9, (i) => (i === 0 || i === 8 ? [8, 14] : [7, 14]), m);
  d.rect(3, 7, 7, 1, m, 4);
  d.rect(3, 8, 7, 1, a, 2);
  d.line(10, 12, 13, 7, a, 3);
  d.line(9, 12, 12, 7, a, 1);
  d.ell(13, 6, 1.9, 1.5, a, 0.4);
  d.hpx(4, 10, m, 4); d.hpx(4, 11, m, 4);
  if (v % 2 === 1) d.rect(4, 12, 5, 1, a, 2);
}

function pickaxe({ d, m, a, side }: Ctx) {
  stick(d, 4, 14, 9, 5, a, side);
  d.poly([[2, 7], [4, 3], [9, 2], [13, 3], [14, 7], [12, 8], [11, 5], [9, 4], [5, 5], [3, 8]], m, [0.1, -0.3, 1]);
  d.rect(5, 3, 5, 1, m, 4);
  d.px(2, 7, m, 2); d.px(14, 7, m, 2);
  d.rect(8, 4, 2, 2, a, 2);
}

function sickle({ d, m, a, side }: Ctx) {
  stick(d, 3, 14, 7, 8, a, side);
  d.poly([[6, 9], [6, 6], [8, 3], [12, 1], [15, 2], [15, 4], [12, 3], [10, 5], [9, 8], [9, 9]], m, [0.2, -0.3, 1]);
  d.px(13, 2, m, 4); d.px(9, 4, m, 4);
  d.line(10, 4, 14, 3, m, 2);
}

function hammer({ d, m, a, side }: Ctx) {
  stick(d, 3, 14, 9, 6, a, side);
  d.box(6, 2, 9, 5, m, [0, -0.2, 1]);
  d.rect(6, 2, 9, 1, m, 4);
  d.rect(6, 6, 9, 1, m, 1);
  d.rect(13, 3, 2, 3, m, 2);
  d.hpx(7, 3, m, 4);
}

function fishingRod({ d, m, a }: Ctx) {
  d.line(2, 14, 13, 2, m, 3);
  d.line(3, 14, 14, 2, m, 1);
  d.ell(5.5, 11, 2, 2, "metal", 0.3);
  d.px(5, 10, "metal", 4);
  // line drops from the tip to a small hook
  d.line(14, 3, 14, 11, a, 3);
  d.px(13, 12, "metal", 4); d.px(13, 13, "metal", 3); d.px(14, 13, "metal", 2);
  d.px(12, 12, "metal", 3);
}

function seedBag({ d, m, a, v }: Ctx) {
  d.ell(8, 10, 5.6, 4.8, m, 0.1);
  d.poly([[6, 3], [10, 3], [11, 6], [5, 6]], m, [0, -0.2, 1], 1);
  d.rect(4, 6, 8, 1, a, 3); // tie
  d.px(6, 2, m, 3); d.px(9, 2, m, 3); d.rect(6, 3, 4, 1, m, 2);
  // label with a sprout
  d.ell(8, 10.5, 2.6, 2.4, a, 0.5);
  d.px(8, 11, "foliage", 3); d.px(8, 10, "foliage", 4);
  d.px(7, 9, "foliage", 4); d.px(9, 9, "foliage", 3);
  d.hpx(4, 9, m, 4);
  if (v % 2 === 1) d.px(3, 13, a, 3);
}

// ---------------------------------------------------------------- tool use effects (`use` row)
/** 1x2 particle, bright on top. */
function drop(d: D, x: number, y: number, m: Material, hi = 4, lo = 3) {
  d.px(x, y, m, hi);
  d.px(x, y + 1, m, lo);
}
/** 2x2 chunk with a lit corner and a shaded one. */
function chunk(d: D, x: number, y: number, m: Material, hi = 4, mid = 3, lo = 1) {
  d.px(x, y, m, hi); d.px(x + 1, y, m, mid);
  d.px(x, y + 1, m, mid); d.px(x + 1, y + 1, m, lo);
}
const ease = (t: number) => t * t;

function useWateringCan({ d, f }: Ctx) {
  // three drops leave the rose at top-left and arc down; staggered so the stream loops
  for (let i = 0; i < 3; i++) {
    const t = ((f + i * (USE_FRAMES / 3)) / USE_FRAMES) % 1;
    drop(d, Math.round(2 + t * 9), Math.round(3 + ease(t) * 9), "water");
  }
  for (const t of [0.15, 0.55]) d.px(Math.round(2 + ((f / USE_FRAMES + t) % 1) * 8), 12 + (f % 2), "water", 3);
}

function useAxe({ d, f }: Ctx) {
  // wood chips burst from the cut and fall
  const chips: [number, number][] = [[-1, -1.2], [1.2, -1], [-1.5, -0.2], [1.6, -0.3], [0.2, -1.6]];
  chips.forEach(([vx, vy], i) => {
    const t = f + 1;
    const x = 8 + vx * t * 1.7, y = 9 + vy * t * 1.7 + 0.45 * t * t;
    if (f === USE_FRAMES - 1 && i % 2) return;
    d.rect(Math.round(x), Math.round(y), 2, 1, "wood", i % 2 ? 4 : 3);
    d.px(Math.round(x), Math.round(y) + 1, "wood", 2);
  });
  if (f === 0) { d.px(8, 8, "sand", 4); d.px(9, 9, "sand", 4); d.px(7, 9, "sand", 4); }
}

function sparkStar(d: D, x: number, y: number, r: number) {
  d.px(x, y, "gold", 4);
  for (let i = 1; i <= r; i++) {
    d.px(x - i, y, "gold", i === 1 ? 4 : 3); d.px(x + i, y, "gold", i === 1 ? 4 : 3);
    d.px(x, y - i, "gold", i === 1 ? 4 : 3); d.px(x, y + i, "gold", i === 1 ? 4 : 3);
  }
}

function usePickaxe({ d, f }: Ctx) {
  // flash on impact, then rock chips and sparks fly out
  const hit = 8, base = 11;
  if (f === 0) { sparkStar(d, hit, base - 1, 2); return; }
  const dirs: [number, number][] = [[-2.2, -1.6], [2.2, -1.8], [-1.2, -2.6], [1.4, -2.8], [-3, -0.6], [3, -0.8]];
  dirs.forEach(([vx, vy], i) => {
    const t = f;
    const x = hit + vx * t * 1.3, y = base - 1 + vy * t * 1.3 + 0.55 * t * t;
    if (i < 4) chunk(d, Math.round(x), Math.round(y), "stone", 4, 4, 2);
    else { d.px(Math.round(x), Math.round(y), "gold", 4); d.px(Math.round(x - Math.sign(vx)), Math.round(y + 1), "gold", 3); }
  });
}

function useHammer({ d, f }: Ctx) {
  // shock line on the strike, sparks thrown sideways
  const hit = 8, base = 11;
  if (f === 0) { sparkStar(d, hit, base - 1, 3); return; }
  for (const s of [-1, 1]) {
    const x = hit + s * (2 + f * 2), y = base - 1 - Math.round(f * 1.2) + Math.round(f * f * 0.25);
    d.px(x, y, "gold", 4); d.px(x - s, y + 1, "gold", 3);
  }
  const w = 2 + f * 2;
  d.rect(hit - w, base + 1, w * 2 + 1, 1, "sand", 3);
  d.px(hit - w, base, "sand", 2); d.px(hit + w, base, "sand", 2);
  if (f < 3) d.px(hit, base - 2 - f, "metal", 4);
}

function useHoe({ d, f }: Ctx) {
  // soil clods kicked up from the furrow
  const clods: [number, number][] = [[-1.6, -2.4], [1.3, -3], [2.6, -1.8], [-2.8, -1.4]];
  d.rect(5 - (f > 1 ? 1 : 0), 13, 7 + (f > 1 ? 2 : 0), 1, "dirt", 2);
  if (f === 0) d.rect(6, 12, 4, 1, "dirt", 3);
  clods.forEach(([vx, vy], i) => {
    const t = f + 0.6;
    const x = 8 + vx * t * 1.2, y = 12 + vy * t * 1.2 + 0.95 * t * t;
    if (y > 13) return;
    chunk(d, Math.round(x), Math.round(y), "dirt", 4, 3, 1);
    if (i === 0 && f < 3) d.px(Math.round(x) + 2, Math.round(y) + 1, "dirt", 3);
  });
}

function useSickle({ d, f }: Ctx) {
  // cut grass blades fly off along the sweep
  const blades: [number, number][] = [[-1.5, -1.8], [1.8, -2], [0.2, -2.6], [2.6, -0.8]];
  blades.forEach(([vx, vy], i) => {
    const t = f + 1;
    const x = 7 + vx * t * 1.5, y = 11 + vy * t * 1.4 + 0.5 * t * t;
    const lean = vx < 0 ? -1 : 1;
    const gx = Math.round(x), gy = Math.round(y);
    d.px(gx, gy, "foliage", 4); d.px(gx + lean, gy + 1, "foliage", 3); d.px(gx + lean * 2, gy + 2, "foliage", i % 2 ? 2 : 3);
  });
  d.rect(5, 14, 6, 1, "foliage", 2);
}

function useFishingRod({ d, f }: Ctx) {
  // bobber splash: an expanding ring then drops that fall back
  const cx = 8, cy = 11;
  const rx = [2, 3.5, 5, 6][f], ry = [0.8, 1.4, 2, 2.4][f];
  for (let a = 0; a < 24; a++) {
    const t = (a / 24) * Math.PI * 2;
    d.px(Math.round(cx + Math.cos(t) * rx), Math.round(cy + Math.sin(t) * ry), "water", f === 3 ? 3 : 4);
  }
  if (f < 3) {
    const h = [3, 5, 3][f];
    drop(d, cx - 1, cy - h, "water"); drop(d, cx + 2, cy - h + 1, "water");
    if (f === 1) drop(d, cx, cy - 7, "water");
  }
}

function useSeedBag({ d, f }: Ctx) {
  // seeds scatter downward and settle in the soil
  [4, 7, 10, 13].forEach((x, i) => {
    const y = 2 + ((f + i) % USE_FRAMES) * 3 + (i % 2);
    d.px(x, y, "sand", 4); d.px(x, y + 1, "leather", 3);
  });
  d.rect(2, 14, 12, 1, "dirt", 2);
  if (f === USE_FRAMES - 1) { d.px(5, 13, "sand", 4); d.px(11, 13, "sand", 4); }
}

type Draw = (c: Ctx) => void;

const EFFECT: Record<string, Draw> = {
  hoe: useHoe, "watering-can": useWateringCan, "tool-axe": useAxe, pickaxe: usePickaxe,
  sickle: useSickle, hammer: useHammer, "fishing-rod": useFishingRod, "seed-bag": useSeedBag,
};

const DRAW: Record<string, Draw> = {
  chest, "chest-open": chestOpen, barrel, crate, potion, sword, axe, shield, bow, coin, key,
  torch, sign, pot, gem, scroll, heart, bomb, book, "mushroom-item": mushroom, apple,
  hoe, "watering-can": wateringCan, "tool-axe": axe, pickaxe, sickle, hammer, "fishing-rod": fishingRod, "seed-bag": seedBag,
};
const FRAMES: Record<string, number> = { coin: 4, torch: 4, gem: 4 };
const FPS: Record<string, number> = { coin: 8, torch: 8, gem: 6 };

function drawObject(kind: string, p: Params, kit: StyleKit, seed: number, frame: number, effect = false): Sprite {
  const d = new D(kit.sizes.object, kit);
  const [nm, na] = NATURAL[kind] ?? NATURAL.chest;
  const main = str(p, "main"), acc = str(p, "accent");
  const variant = Math.max(0, Math.min(9, Math.round(num(p, "variant"))));
  const ctx = {
    d, m: main === "natural" ? nm : (main as Material), a: acc === "natural" ? na : (acc as Material), v: variant, f: frame,
    r: rng(seed * 31 + variant), side: d.P.lightSide,
  };
  (effect ? EFFECT[kind] : DRAW[kind] ?? chest)(ctx);
  if (effect) {
    // flying particles may leave the canvas: keep the 1px transparent margin
    const n = d.size;
    d.P.erase(0, 0, n, 1); d.P.erase(0, n - 1, n, 1); d.P.erase(0, 0, 1, n); d.P.erase(n - 1, 0, 1, n);
  }
  return finalize(d.sprite(), kit);
}

export const objectGenerator: Generator = {
  id: "object",
  category: "object",
  label: "Object / Item",
  description:
    "Props and items drawn at 16px: chest, chest-open, barrel, crate, potion, sword, axe, shield, bow, coin (spins), key, torch (flickers), sign, pot, gem (sparkles), scroll, heart, bomb, book, mushroom-item, apple; farming tools hoe, watering-can, tool-axe, pickaxe, sickle, hammer, fishing-rod, seed-bag (rows icon + use effect: drops, chips, sparks, clods, grass, splash, seeds). main/accent re-skin the item ('natural' keeps its own colours); variant 0-9 changes details.",
  params: [
    { key: "kind", label: "Kind", type: "select", options: [...OBJECT_KINDS], default: "chest" },
    { key: "main", label: "Main material", type: "select", options: OBJECT_MATS, default: "natural" },
    { key: "accent", label: "Accent material", type: "select", options: OBJECT_MATS, default: "natural" },
    { key: "variant", label: "Variant", type: "number", min: 0, max: 9, step: 1, default: 0 },
  ],
  generate(p, kit, seed) {
    const kind = (OBJECT_KINDS as readonly string[]).includes(str(p, "kind")) ? str(p, "kind") : "chest";
    if ((TOOL_KINDS as readonly string[]).includes(kind)) {
      const use = Array.from({ length: USE_FRAMES }, (_, f) => drawObject(kind, p, kit, seed, f, true));
      return { rows: [{ name: "icon", frames: [drawObject(kind, p, kit, seed, 0)] }, { name: "use", frames: use }], fps: 8 };
    }
    const n = FRAMES[kind] ?? 1;
    const frames = Array.from({ length: n }, (_, f) => drawObject(kind, p, kit, seed, f));
    const rows: FrameSet[] = [{ name: "idle", frames }];
    return { rows, fps: FPS[kind] ?? 1 };
  },
};

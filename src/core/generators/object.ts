import { finalize } from "../enforce";
import { Painter } from "../painter";
import type { Material } from "../palette";
import { rng } from "../rng";
import type { FrameSet, Sprite, StyleKit } from "../types";
import { mat, num, PAINT, str, type Generator, type Params } from "./types";

export const OBJECT_KINDS = [
  "chest", "chest-open", "barrel", "crate", "potion", "sword", "axe", "shield", "bow", "coin", "key",
  "torch", "sign", "pot", "gem", "scroll", "heart", "bomb", "book", "mushroom-item", "apple",
] as const;

/** Materials selectable for `main` / `accent`. "ui" means "the item's natural colour". */
const OBJECT_MATS: Material[] = ["ui", ...PAINT];

/** Natural [main, accent] materials for each kind (used while the param is left on "ui"). */
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
  d.rect(2, 8, 12, 1, m, 0); // seam
  d.rect(3, 9, 10, 1, m, 3 - (v % 2)); // base top light
  d.bandV(4, 2, 3, 14, a, 2, 3);
  d.bandV(10, 2, 3, 14, a, 2, 3);
  d.bandH(2, 14, 13, a, 1, 2);
  // lock
  d.rect(7, 7, 2, 3, "gold", 3);
  d.rect(7, 9, 2, 1, "gold", 2);
  d.px(7, 8, "ink", 0);
  d.px(8, 7, "gold", 4);
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
  d.px(6, 7, "gold", 4); d.px(10, 8, "gold", 4); d.px(8, 6, "gold", 4);
  d.px(5, 8, "gold", 2); d.px(11, 9, "gold", 2);
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
    d.rect(6, 1, 2, 1, a, 3);
    d.px(5, 9, glass, 4); d.px(5, 10, glass, 4); d.px(6, 8, glass, 4);
    d.px(6, 5, glass, 4);
  } else if (body === 1) {
    d.poly([[6, 5], [10, 5], [14, 13], [2, 13]], glass, [0, 0, 1]);
    d.ell(8, 12, 6, 1.8, glass, 0.1);
    d.box(6, 4, 4, 2, glass, [0, 0, 1], 1);
    d.box(5, 3, 6, 1, glass, [0, -1, 0.6], 2);
    d.rect(6, 1, 4, 2, a, 2);
    d.px(6, 1, a, 3);
    d.px(6, 9, glass, 4); d.px(5, 11, glass, 4);
  } else {
    d.box(4, 8, 8, 6, glass, [0, 0, 1]);
    d.ell(8, 12, 4, 2, glass, 0.1);
    d.ell(8, 8, 4, 2, glass, 0.1);
    d.box(6, 3, 4, 6, glass, [0, 0, 1], 1);
    d.box(5, 3, 6, 1, glass, [0, -1, 0.6], 2);
    d.rect(6, 1, 4, 2, a, 2);
    d.px(5, 10, glass, 4); d.px(5, 11, glass, 4); d.px(6, 5, glass, 4);
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
  d.px(10, 3, m, 4);
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
    d.px(7, 5, a, 4);
  } else if (v % 3 === 1) {
    d.ell(8, 7, 2.2, 2.2, "gold", 0.3);
    d.px(7, 6, "gold", 4);
  } else {
    d.poly([[8, 3], [13, 3], [13, 8], [8, 12]], a, [0.35, 0, 1], -1);
    d.rect(8, 3, 1, 9, a, 2);
  }
}

function bow({ d, m, a, v }: Ctx) {
  const arrow = v % 2 === 1;
  for (let t = -6; t <= 6; t++) {
    const x = 3 + Math.round((t * t) / 7);
    d.px(x, 8 + t, m, 3);
    d.px(x + 1, 8 + t, m, 1);
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
    d.rect(7, 2, 1, 12, m, 3);
    d.rect(8, 2, 1, 12, m, 2);
    d.px(7, 3, m, 4);
    return;
  }
  d.ell(8, 8, rx, 6, m, 0.4);
  if (f === 0) {
    d.ell(8, 8, 4.1, 4.5, a, 0.9, -1);
    d.rect(7, 5, 2, 6, m, 3);
    d.px(7, 5, m, 4);
    d.px(7, 3, m, 4);
  } else if (f === 1) {
    d.ell(8, 8, 2.2, 4.4, a, 0.9, -1);
    d.rect(8, 6, 1, 4, m, 3);
  } else {
    d.ell(8, 8, 2.2, 4.4, a, 0.9, -1);
    d.rect(7, 6, 1, 4, m, 3);
  }
}

function key({ d, m, a, v }: Ctx) {
  d.ell(8, 4.5, 3.6, 3.6, m, 0.3);
  d.erase(7, 3, 2, 2);
  d.px(5, 3, m, 4);
  d.column(7, 2, () => [8, 14], m);
  const teeth = v % 3;
  d.box(9, 11, 2, 1, a, [0, 0, 1]);
  d.box(9, 13, 2, 1, a, [0, 0, 1]);
  if (teeth === 1) d.box(9, 9, 3, 1, a, [0, 0, 1]);
  if (teeth === 2) { d.box(9, 11, 3, 1, a, [0, 0, 1]); d.box(9, 13, 3, 1, a, [0, 0, 1]); }
  d.px(7, 8, m, 4);
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
  d.rect(2, 2, 1, 8, m, 3);
  d.rect(13, 2, 1, 8, m, 1);
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
  d.px(4, 7, m, 4);
  d.px(3, 8, m, 4);
}

function gem({ d, m, a, v, f, r }: Ctx) {
  const wide = v % 2 === 0;
  const l = wide ? 2 : 3, rr = wide ? 14 : 13;
  d.poly([[5, 3], [8, 3], [l + 1, 7], [l, 7]], m, [-0.5, -0.5, 0.9], 1);
  d.poly([[8, 3], [11, 3], [rr, 7], [rr - 1, 7]], m, [0.5, -0.5, 0.9], 1);
  d.poly([[5, 3], [11, 3], [rr, 7], [l, 7]], m, [0, -0.3, 1], 2);
  d.poly([[l, 7], [8, 7], [8, 14]], m, [-0.6, 0.4, 0.7], -1);
  d.poly([[8, 7], [rr, 7], [8, 14]], m, [0.6, 0.4, 0.7], -2);
  d.rect(5, 4, 3, 1, m, 4);
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
  d.rect(3, 4, 2, 1, a === m ? m : a, 4);
  d.px(3, 5, a === m ? m : a, 4);
  d.erase(7, 3, 2, 1);
}

function bomb({ d, m, a, v }: Ctx) {
  d.ell(7.5, 9.5, 5.6, 5.4, m, 0.1, -1);
  d.box(5, 3, 5, 2, m, [0, -0.3, 1], -1);
  d.rect(5, 3, 5, 1, m, 3);
  d.line(10, 3, 12, 1, a, 3);
  d.px(12, 2, a, 2);
  d.px(13, 1, "gold", 4); d.px(12, 0 + 1, "cloth2", 4);
  d.px(4, 8, m, 4); d.px(4, 9, m, 4); d.px(5, 7, m, 4);
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
    d.px(7, 5, a, 4);
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
  d.px(5, 4, "sand", 4); d.px(6, 4, "sand", 4);
  d.rect(9, 3, 2, 2, "sand", 4);
  d.rect(3, 7, 2, 2, "sand", 4);
  d.px(12, 7, "sand", 4);
  if (v % 2 === 1) d.px(8, 6, "sand", 4);
}

function apple({ d, m, a, v }: Ctx) {
  d.ell(8, 9, 5.8, 5.2, m, 0.1);
  d.erase(8, 4, 1, 1);
  d.px(5, 7, m, 4); d.px(5, 8, m, 4); d.px(6, 6, m, 4);
  d.line(8, 4, 9, 2, "leather", 2);
  d.poly([[9, 3], [12, 2], [13, 3], [11, 5]], a, [0.2, -0.3, 1]);
  d.px(11, 3, a, 4);
  if (v % 2 === 1) d.px(10, 11, m, 0);
}

type Draw = (c: Ctx) => void;
const DRAW: Record<string, Draw> = {
  chest, "chest-open": chestOpen, barrel, crate, potion, sword, axe, shield, bow, coin, key,
  torch, sign, pot, gem, scroll, heart, bomb, book, "mushroom-item": mushroom, apple,
};
const FRAMES: Record<string, number> = { coin: 4, torch: 4, gem: 4 };
const FPS: Record<string, number> = { coin: 8, torch: 8, gem: 6 };

function drawObject(kind: string, p: Params, kit: StyleKit, seed: number, frame: number): Sprite {
  const d = new D(kit.sizes.object, kit);
  const [nm, na] = NATURAL[kind] ?? NATURAL.chest;
  const main = mat(p, "main"), acc = mat(p, "accent");
  const variant = Math.max(0, Math.min(9, Math.round(num(p, "variant"))));
  const ctx = {
    d, m: main === "ui" ? nm : main, a: acc === "ui" ? na : acc, v: variant, f: frame,
    r: rng(seed * 31 + variant), side: d.P.lightSide,
  };
  (DRAW[kind] ?? chest)(ctx);
  return finalize(d.sprite(), kit);
}

export const objectGenerator: Generator = {
  id: "object",
  category: "object",
  label: "Object / Item",
  description:
    "Props and items drawn at 16px: chest, chest-open, barrel, crate, potion, sword, axe, shield, bow, coin (spins), key, torch (flickers), sign, pot, gem (sparkles), scroll, heart, bomb, book, mushroom-item, apple. main/accent re-skin the item ('ui' keeps its natural colours); variant 0-9 changes details.",
  params: [
    { key: "kind", label: "Kind", type: "select", options: [...OBJECT_KINDS], default: "chest" },
    { key: "main", label: "Main material (ui = natural)", type: "material", options: OBJECT_MATS, default: "ui" },
    { key: "accent", label: "Accent material (ui = natural)", type: "material", options: OBJECT_MATS, default: "ui" },
    { key: "variant", label: "Variant", type: "number", min: 0, max: 9, step: 1, default: 0 },
  ],
  generate(p, kit, seed) {
    const kind = (OBJECT_KINDS as readonly string[]).includes(str(p, "kind")) ? str(p, "kind") : "chest";
    const n = FRAMES[kind] ?? 1;
    const frames = Array.from({ length: n }, (_, f) => drawObject(kind, p, kit, seed, f));
    const rows: FrameSet[] = [{ name: "idle", frames }];
    return { rows, fps: FPS[kind] ?? 1 };
  },
};

// Urban night set (#99): isometric street props for the `kit-iso` camera (any iso tile width works; sizes scale with T/32).
//
// Every prop stands on one diamond cell (foot = cell centre, 1px transparent row below, like `iso-prop`). Volumes are lit
// Painter shapes (box / cylinder / ellipse / poly with the screen-space iso normals), details are explicit ramp levels.
// Emitters (lit windows, lanterns, lamps, vending fronts, signs) are reported in `lights` in sprite px so the lighting
// lane can turn them into glow: { x, y, r, kind, color?, material? }. `color` is the kit palette hex of the glow.
import { finalize } from "../enforce";
import { resolveRamps } from "../kit";
import { Painter } from "../painter";
import type { Material } from "../palette";
import { rng } from "../rng";
import type { Sprite, StyleKit } from "../types";
import { ISO_PROP_MARGIN, isoTileW, registerIsoProp, TOP, WALL_SE, WALL_SW, type Vec3 } from "./iso";
import { num, str, type Generator, type Params } from "./types";

type Pt = [number, number];
type V3 = [number, number, number];

export type LightKind = "window" | "lantern" | "lamp" | "vending" | "sign";
/** An emitter in sprite px. Structurally a superset of lighting.ts `Light` ({x, y, r}). */
export interface UrbanLight { x: number; y: number; r: number; kind: LightKind; color?: string; material?: Material }
export interface UrbanResult { sprite: Sprite; lights: UrbanLight[] }

/** Palette hex of a material's glow shade (level 3) in this kit. */
export function glowHex(kit: StyleKit, m: Material): string { return resolveRamps(kit)[m][3]; }
export const light = (kit: StyleKit, x: number, y: number, r: number, kind: LightKind, m: Material = "gold"): UrbanLight => ({ x: Math.round(x), y: Math.round(y), r, kind, color: glowHex(kit, m), material: m });

/** World-pixel drawing helper: u runs SE, v runs SW, z up; inputs are authored for a 32px tile and scaled by `k`. */
export class IsoDraw {
  constructor(readonly P: Painter, readonly ox: number, readonly oy: number, readonly k = 1) {}
  at(u: number, v: number, z: number): Pt { return [this.ox + (u - v) * this.k, this.oy + ((u + v) / 2 - z) * this.k]; }
  poly(pts: V3[], m: Material, n: Vec3, tone = 0) { this.P.poly(pts.map((p) => this.at(...p)), m, n, { tone }); }
  /** Flat fill with one explicit ramp level (lit glass, paint, signage). */
  fill(pts: V3[], m: Material, level: number) {
    const p = pts.map((q) => this.at(...q));
    const ys = p.map((q) => q[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      const sy = y + 0.5, xs: number[] = [];
      for (let i = 0; i < p.length; i++) {
        const [ax, ay] = p[i], [bx, by] = p[(i + 1) % p.length];
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let j = 0; j + 1 < xs.length; j += 2) for (let x = Math.ceil(xs[j] - 0.5); x <= Math.floor(xs[j + 1] - 0.5); x++) this.P.px(x, y, m, level);
    }
  }
  sw(u0: number, u1: number, v: number, z0: number, z1: number, m: Material, tone = 0) { this.poly([[u0, v, z0], [u1, v, z0], [u1, v, z1], [u0, v, z1]], m, WALL_SW, tone); }
  se(u: number, v0: number, v1: number, z0: number, z1: number, m: Material, tone = 0) { this.poly([[u, v0, z0], [u, v1, z0], [u, v1, z1], [u, v0, z1]], m, WALL_SE, tone); }
  top(u0: number, u1: number, v0: number, v1: number, z: number, m: Material, tone = 0) { this.poly([[u0, v0, z], [u1, v0, z], [u1, v1, z], [u0, v1, z]], m, TOP, tone); }
  fsw(u0: number, u1: number, v: number, z0: number, z1: number, m: Material, level: number) { this.fill([[u0, v, z0], [u1, v, z0], [u1, v, z1], [u0, v, z1]], m, level); }
  fse(u: number, v0: number, v1: number, z0: number, z1: number, m: Material, level: number) { this.fill([[u, v0, z0], [u, v1, z0], [u, v1, z1], [u, v0, z1]], m, level); }
  ftop(u0: number, u1: number, v0: number, v1: number, z: number, m: Material, level: number) { this.fill([[u0, v0, z], [u1, v0, z], [u1, v1, z], [u0, v1, z]], m, level); }
  /** Block with its three visible faces (SW lit, SE shaded, top lit). */
  box(u0: number, u1: number, v0: number, v1: number, z0: number, z1: number, m: Material, o: { tone?: number; sw?: number; se?: number; top?: number } = {}) {
    const t = o.tone ?? 0;
    this.sw(u0, u1, v1, z0, z1, m, o.sw ?? t);
    this.se(u1, v0, v1, z0, z1, m, o.se ?? t);
    this.top(u0, u1, v0, v1, z1, m, o.top ?? t);
  }
  px(u: number, v: number, z: number, m: Material, level: number) { const [x, y] = this.at(u, v, z); this.P.px(Math.floor(x), Math.floor(y), m, level); }
  line(a: V3, b: V3, m: Material, level: number) { const [x0, y0] = this.at(...a), [x1, y1] = this.at(...b); this.P.line(Math.floor(x0), Math.floor(y0), Math.floor(x1), Math.floor(y1), m, level); }
}

/** A hanging paper lantern (chochin): lit red body, dark caps, ribs and a white glyph. */
export function chochin(P: Painter, cx: number, top: number, s = 1, m: Material = "cloth2") {
  const rx = Math.max(2, 3.2 * s), ry = Math.max(2.5, 4 * s), cy = top + ry + 0.5;
  P.px(Math.round(cx - 0.5), Math.floor(top - 1), "ink", 1);
  P.ellipse(cx, cy, rx, ry, m, { tone: 1 });
  if (s >= 0.7) {
    P.rect(Math.floor(cx - rx * 0.6), Math.floor(top), Math.max(2, Math.round(rx * 1.2)), 1, "ink", 1);
    P.rect(Math.floor(cx - rx * 0.6), Math.floor(cy + ry - 0.5), Math.max(2, Math.round(rx * 1.2)), 1, "ink", 1);
    P.px(Math.floor(cx - rx + 0.5), Math.floor(cy), m, 1); P.px(Math.floor(cx + rx - 1.5), Math.floor(cy), m, 1);
    P.px(Math.floor(cx - 0.5), Math.floor(cy - 0.5), "sand", 4); P.px(Math.floor(cx - 0.5), Math.floor(cy + 0.5), "sand", 3);
    P.px(Math.floor(cx - 0.5), Math.floor(cy + ry + 1), "gold", 3);
  }
  return { x: cx, y: cy };
}

/** `below`: world px a wide prop pokes below its cell's lower vertex; the foot is lifted by that much so the margin row stays clear. */
function canvas(kit: StyleKit, rise: number, wide?: number, below = 0) {
  const T = isoTileW(kit), k = T / 32, W = Math.max(T, Math.round(wide ?? T) + (Math.round(wide ?? T) % 2));
  const H = Math.ceil(rise * k) + 3 + T / 4 + ISO_PROP_MARGIN;
  const fx = W / 2, fy = H - ISO_PROP_MARGIN - T / 4 - Math.ceil(below * k);
  const P = new Painter(W, H, kit);
  return { P, D: new IsoDraw(P, fx, fy, k), T, k, fx, fy, W, H };
}
const done = (P: Painter, kit: StyleKit, lights: UrbanLight[], outline = true): UrbanResult => ({ sprite: finalize(P.toSprite(), kit, { outline }), lights });

const CAN_COLORS: Material[] = ["cloth2", "cloth", "foliage", "accent", "leather", "ui"];

// -------------------------------------------------------------------------- props

function vending(kit: StyleKit, seed: number, variant: number): UrbanResult {
  const { P, D, k } = canvas(kit, 44);
  const r = rng(seed * 31 + variant), body: Material = variant === 1 ? "cloth" : variant === 2 ? "metal" : "cloth2";
  const L: UrbanLight[] = [];
  D.box(-8, 8, -5, 5, 0, 1.5, "metal", { tone: -2 });
  D.box(-8, 8, -5, 5, 1.5, 33, body);
  D.top(-8, 8, -5, 5, 33, body, 1);
  // header: backlit sign panel with a can icon
  D.fsw(-7, 7, 5, 27, 31.5, "sand", 4);
  D.fsw(-7, 7, 5, 27, 28, "sand", 3);
  D.fsw(-2, 0, 5, 28.2, 31, body, 3); D.fsw(0, 3, 5, 28.2, 31, "gold", 3);
  // product window
  D.fsw(-7.5, 2.5, 5, 7.5, 26, "ink", 0);
  D.fsw(-7, 2, 5, 8, 25.5, "gold", 3);
  for (let row = 0; row < 3; row++) {
    const zb = 9 + row * 5.6;
    D.fsw(-7, 2, 5, zb + 3.6, zb + 3.9, "ink", 1); // shelf
    for (let i = 0; i < 3; i++) {
      const u = -6.6 + i * 3, m = CAN_COLORS[(i + row * 2 + r.int(0, 2)) % CAN_COLORS.length];
      D.fsw(u, u + 2, 5, zb, zb + 3.3, m, 3);
      D.px(u + 0.2, 5, zb + 2.6, m, 4);
    }
  }
  D.fsw(-7, 2, 5, 22.5, 25.5, "gold", 4); // glare
  // control column: price display, buttons, coin slot, return flap
  D.fsw(3.5, 7.5, 5, 22, 25.5, "ink", 0); D.fsw(4, 7, 5, 23, 24.5, "cloth2", 3);
  for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) D.fsw(4 + i * 1.8, 5.2 + i * 1.8, 5, 15 + j * 2, 16.4 + j * 2, "ui", 3);
  D.fsw(4.5, 6.5, 5, 11, 12.2, "ink", 0); D.fsw(4.5, 6.5, 5, 8.2, 9.5, "metal", 3);
  // delivery slot
  D.fsw(-6, 1, 5, 2.5, 6.5, "ink", 0); D.fsw(-6, 1, 5, 6.5, 7, "metal", 3);
  // shaded side: vents and a decal stripe
  D.fse(8, -3.5, 3.5, 24, 28, "ui", 1);
  for (let i = 0; i < 3; i++) D.fse(8, -3 + i * 2.2, -2.2 + i * 2.2, 4, 9, "ink", 1);
  const c = D.at(-2.5, 5, 17);
  L.push(light(kit, c[0], c[1], Math.round(14 * k), "vending", "gold"));
  const s = D.at(0, 5, 29);
  L.push(light(kit, s[0], s[1], Math.round(8 * k), "sign", variant === 1 ? "cloth" : "gold"));
  return done(P, kit, L);
}

function recycleBox(kit: StyleKit, seed: number, variant: number): UrbanResult {
  // drink-can recycling box (a grey/blue crate with a round hole and a flip slot) that stands beside vending machines
  const { P, D } = canvas(kit, 28);
  D.box(-6, 6, -4.5, 4.5, 0, 17, variant % 2 ? "cloth" : "metal", { tone: variant % 2 ? 0 : -1 });
  D.box(-6.5, 6.5, -5, 5, 17, 19, "metal", { tone: 0 });
  D.top(-3.5, 3.5, -1.5, 1.5, 19, "ink", -1); // opening in the lid
  D.fsw(-5, 5, 4.5, 8, 14.5, "ui", 3); // label plate
  D.fsw(-4, -0.5, 4.5, 11, 13.5, "foliage", 2); D.fsw(0.5, 4, 4.5, 11, 13.5, "cloth2", 3);
  D.fsw(-4.5, 4.5, 4.5, 8.4, 9.4, "ink", 1);
  for (let i = 0; i < 3; i++) D.px(-2 + i * 2, 4.5, 15.5, "ui", 4);
  const r = rng(seed + variant);
  for (let i = 0; i < 3; i++) { const u = r.int(-4, 3); D.fsw(u, u + 1.5, 4.5, 19, 21.4, CAN_COLORS[r.int(0, 3)], 3); }
  D.line([-5.5, 4.5, 2.5], [5.5, 4.5, 2.5], "ink", 1);
  return done(P, kit, []);
}

function crates(kit: StyleKit, seed: number): UrbanResult {
  const { P, D } = canvas(kit, 28, undefined, 3);
  const r = rng(seed * 7 + 1);
  const crate = (cu: number, cv: number, z0: number, m: Material) => {
    D.box(cu - 5, cu + 5, cv - 4, cv + 4, z0, z0 + 7, m, { tone: 0 });
    for (let i = -3; i <= 3; i += 2) D.fsw(cu + i, cu + i + 1, cv + 4, z0 + 1.5, z0 + 5.5, "ink", 1);
    D.fsw(cu - 5, cu + 5, cv + 4, z0 + 6.2, z0 + 7, m, 4);
  };
  crate(-3, 1, 0, "cloth"); crate(5, 1, 0, "cloth2"); crate(1, -1, 7, r.chance(0.5) ? "cloth" : "foliage"); crate(1, -1, 14, "cloth2");
  return done(P, kit, []);
}

function bins(kit: StyleKit, seed: number, variant: number): UrbanResult {
  void seed;
  const { P, D } = canvas(kit, 28);
  const n = 1 + (variant % 3);
  const spots: [number, number][] = n === 1 ? [[0, 0]] : n === 2 ? [[-5, 0], [5, 0]] : [[-8, -2], [0, 1], [8, 4]];
  for (const [u, v] of spots) {
    D.box(u - 3.5, u + 3.5, v - 3.5, v + 3.5, 0, 12, "cloth", { tone: 0 });
    D.box(u - 4.2, u + 4.2, v - 4.2, v + 4.2, 12, 14.5, "cloth", { tone: -1, top: 0 });
    D.ftop(u - 2, u + 2, v - 1, v + 1.5, 14.5, "cloth", 4);
    D.fsw(u - 3, u + 3, v + 3.5, 3, 4, "cloth", 1); D.fsw(u - 3, u + 3, v + 3.5, 8, 9, "cloth", 1);
    D.fsw(u - 1.5, u + 1.5, v + 4.2, 12.4, 13.6, "ui", 3); // handle lip
    D.px(u - 2, v + 3.5, 10, "ui", 4);
  }
  return done(P, kit, []);
}

function bicycle(kit: StyleKit, seed: number, variant: number): UrbanResult {
  const { P, D, k } = canvas(kit, 24, 36);
  const R = 6.2, ws = [-8.5, 8.5];
  const frame: Material = variant % 2 ? "cloth" : "cloth2";
  // far to near: rear wheel, frame, front wheel
  const wheel = (u: number) => {
    for (let a = 0; a < 40; a++) {
      const t = (a / 40) * Math.PI * 2;
      D.px(u + Math.cos(t) * R, 0, R + Math.sin(t) * R, "ink", 1);
      if (k >= 0.9 && a % 2 === 0) D.px(u + Math.cos(t) * (R - 1), 0, R + Math.sin(t) * (R - 1), "metal", 2);
    }
    for (const t of [0.4, 1.6, 2.7, 3.9, 5.1]) D.line([u, 0, R], [u + Math.cos(t) * (R - 1.5), 0, R + Math.sin(t) * (R - 1.5)], "metal", 1);
    D.px(u, 0, R, "metal", 4);
  };
  wheel(ws[0]);
  D.line([ws[0], 0, R], [-2, 0, R + 1], frame, 3); D.line([-2, 0, R + 1], [-3, 0, 14], frame, 3); D.line([-3, 0, 14], [ws[0], 0, R], frame, 2);
  D.line([-2, 0, R + 1], [5, 0, 13], frame, 3); D.line([-3, 0, 14], [5, 0, 13], frame, 3); D.line([5, 0, 13], [ws[1], 0, R], frame, 3);
  D.line([5, 0, 13], [6, 0, 18], "metal", 3); D.line([4, 0, 18.5], [8.5, 0, 18.5], "ink", 2); // stem + bars
  D.line([-5, 0, 14.5], [-1, 0, 14.5], "leather", 1); D.line([-5, 0, 15.5], [-1, 0, 15.5], "leather", 2); // saddle
  // basket on the handlebars
  D.box(6, 11, -2, 2, 15, 19, "metal", { tone: -1 });
  D.px(8.5, 2, 17, "ink", 1);
  wheel(ws[1]);
  void seed;
  return done(P, kit, []);
}

function plant(kit: StyleKit, seed: number, variant: number): UrbanResult {
  const { P, D, k } = canvas(kit, 34);
  const r = rng(seed * 11 + variant), v = variant % 3;
  const pot: Material = v === 1 ? "stone" : "leather";
  D.box(-4, 4, -4, 4, 0, 8, pot, { tone: v === 1 ? 0 : -1 });
  D.box(-4.8, 4.8, -4.8, 4.8, 7, 9, pot, { tone: 0 });
  D.ftop(-3, 3, -3, 3, 9, "dirt", 1);
  if (v === 0) { // round shrub
    P.ellipse(D.ox - 4 * k, D.oy - 15 * k, 5 * k, 5 * k, "foliage", { tone: -1 });
    P.ellipse(D.ox + 4 * k, D.oy - 15 * k, 5 * k, 5 * k, "foliage", { tone: -1 });
    P.ellipse(D.ox, D.oy - 18 * k, 7 * k, 7.5 * k, "foliage");
    for (let i = 0; i < 5; i++) P.px(Math.floor(D.ox + r.int(-6, 5) * k), Math.floor(D.oy - (14 + r.int(0, 8)) * k), "foliage", 4);
  } else if (v === 1) { // spiky sansevieria
    for (let i = 0; i < 7; i++) {
      const dx = (i - 3) * 1.9, h = 14 + (i % 3) * 4 + r.int(0, 3);
      D.P.poly([[D.ox + (dx - 1.4) * k, D.oy - 8 * k], [D.ox + (dx + 1.4) * k, D.oy - 8 * k], [D.ox + dx * 1.5 * k, D.oy - (8 + h) * k]], "foliage", dx < 0 ? WALL_SW : WALL_SE, { tone: i % 2 });
    }
  } else { // flowering shrub
    P.ellipse(D.ox, D.oy - 16 * k, 7 * k, 6.5 * k, "foliage", { tone: -1 });
    for (let i = 0; i < 9; i++) { const x = D.ox + r.int(-7, 6) * k, y = D.oy - (12 + r.int(0, 9)) * k; P.px(Math.floor(x), Math.floor(y), i % 3 ? "blossom" : "cloth2", 3); P.px(Math.floor(x) + 1, Math.floor(y), "blossom", 4); }
  }
  return done(P, kit, []);
}

function cat(kit: StyleKit, seed: number, variant: number): UrbanResult {
  const { P, k, fx, fy } = canvas(kit, 14);
  const body: Material = variant % 3 === 0 ? "ink" : variant % 3 === 1 ? "leather" : "metal";
  const tone = variant % 3 === 0 ? 2 : variant % 3 === 1 ? 1 : 1;
  P.capsule(fx + 4 * k, fy - 1, fx + 7 * k, fy - 2 * k, 1 * k + 0.4, body, { tone }); // tail
  P.px(Math.floor(fx + 7 * k), Math.floor(fy - 4 * k), body, 2);
  P.ellipse(fx, fy - 3.4 * k, 3.7 * k, 4 * k, body, { tone });            // body
  P.ellipse(fx - 0.5 * k, fy - 8.3 * k, 2.9 * k, 2.5 * k, body, { tone }); // head
  P.poly([[fx - 3.3 * k, fy - 9.2 * k], [fx - 2.7 * k, fy - 12.4 * k], [fx - 0.7 * k, fy - 10.4 * k]], body, WALL_SW, { tone });
  P.poly([[fx + 0.4 * k, fy - 10.5 * k], [fx + 2.2 * k, fy - 12.4 * k], [fx + 2.4 * k, fy - 9.0 * k]], body, WALL_SE, { tone });
  if (k >= 0.75) {
    P.px(Math.floor(fx - 2 * k), Math.floor(fy - 8.2 * k), "gold", 4); P.px(Math.floor(fx + 0.4 * k), Math.floor(fy - 8.2 * k), "gold", 4);
    if (variant % 3 === 1) { P.px(Math.floor(fx - 1), Math.floor(fy - 5 * k), body, 4); P.px(Math.floor(fx + 1), Math.floor(fy - 6 * k), body, 4); }
    P.px(Math.floor(fx - 2.5 * k), Math.floor(fy - 1), body, 4 - tone); P.px(Math.floor(fx - 0.2 * k), Math.floor(fy - 1), body, 4 - tone);
  }
  void seed;
  return done(P, kit, []);
}

function pole(kit: StyleKit, seed: number): UrbanResult {
  const H = 84, { P, D, k, fx } = canvas(kit, H + 6);
  void seed;
  P.cylinder(Math.round(fx - 2 * k), Math.round(D.oy - H * k), Math.max(3, Math.round(4 * k)), Math.round(H * k) + 1, "wood", { tone: 0 });
  D.box(-3, 3, -3, 3, 0, 3, "stone", { tone: -1 });            // concrete foot
  // steps / rungs, crossarms with insulators
  for (let z = 14; z < 50; z += 6) { D.px(2.5, 0, z, "metal", 2); }
  for (const [z, w] of [[H - 4, 14], [H - 13, 12]] as [number, number][]) {
    D.box(-w, w, -1, 1, z, z + 2.5, "wood", { tone: -1 });
    for (const s of [-w + 1, -w * 0.4, w * 0.4, w - 1]) { D.px(s, 0, z + 3.5, "cloth", 3); D.px(s, 0, z + 4.5, "cloth", 4); }
  }
  // transformer can with a bracket and a cap
  const tx = D.at(0, 4.5, 56);
  D.line([0, 1, 62], [0, 4.5, 62], "metal", 1); D.line([0, 1, 52], [0, 4.5, 52], "metal", 1);
  P.cylinder(Math.round(tx[0] - 4 * k), Math.round(tx[1] - 7 * k), Math.max(5, Math.round(8 * k)), Math.round(15 * k), "metal", { tone: -1 });
  P.ellipse(tx[0], tx[1] - 7 * k, 4 * k, 1.8 * k, "metal", { tone: 1 });
  P.px(Math.round(tx[0]), Math.round(tx[1] - 9 * k), "ink", 1);
  for (const dy of [3, 6, 9]) P.rect(Math.round(tx[0] - 4 * k), Math.round(tx[1] - 7 * k + dy * k), Math.max(5, Math.round(8 * k)), 1, "metal", 1);
  // drooping drop wires out of the crossarm
  const top = D.at(0, 0, H - 1);
  for (const dir of [-1, 1]) {
    for (let i = 0; i < 12 * k; i++) P.px(Math.round(top[0] + dir * (i + 2)), Math.round(top[1] + 4 + i * i * 0.04), "ink", 2);
  }
  return done(P, kit, []);
}

function lamp(kit: StyleKit, seed: number, variant: number): UrbanResult {
  const H = 62, { P, D, k, fx, fy } = canvas(kit, H + 8, 40);
  void seed;
  const dir = variant % 2 ? -1 : 1;
  D.box(-3, 3, -3, 3, 0, 3, "metal", { tone: -1 });
  P.cylinder(Math.round(fx - 1.5 * k), Math.round(fy - H * k), Math.max(3, Math.round(3 * k)), Math.round(H * k), "metal", { tone: -1 });
  // curved goose-neck arm
  const pts: Pt[] = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push([fx + dir * Math.sin(t * Math.PI * 0.5) * 15 * k, fy - H * k - (1 - Math.cos(t * Math.PI * 0.5)) * 0 - Math.sin(t * Math.PI) * 4 * k + t * 3 * k]); }
  for (let i = 0; i < pts.length - 1; i++) P.capsule(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], Math.max(1, 1.4 * k), "metal", { tone: 0 });
  const [hx, hy] = pts[pts.length - 1];
  P.ellipse(hx, hy + 0.5, 5 * k, 2.2 * k, "metal", { tone: 0 });
  P.rect(Math.floor(hx - 3 * k), Math.floor(hy + 2 * k), Math.max(4, Math.round(6 * k)), 1, "gold", 4);
  P.px(Math.floor(hx - 1), Math.floor(hy + 3 * k), "gold", 3); P.px(Math.floor(hx + 1), Math.floor(hy + 3 * k), "gold", 3);
  return done(P, kit, [light(kit, hx, hy + 3 * k, Math.round(24 * k), "lamp", "gold")]);
}

function signStand(kit: StyleKit, seed: number, variant: number): UrbanResult {
  // A-frame menu board: an izakaya sign that glows
  const { P, D, k } = canvas(kit, 32);
  void seed;
  const m: Material = variant % 2 ? "cloth2" : "wood";
  for (const [a, b] of [[-6, 0], [6, 0]] as [number, number][]) { D.line([a, -3, 0], [a * 0.5, -1, 20], "wood", 1); D.line([a, 3, 0], [a * 0.5, 1, 20], "wood", 1); void b; }
  D.box(-7, 7, -1.5, 2, 4, 25, m, { tone: -1 });
  D.fsw(-6, 6, 2, 7, 22, "ink", 1);
  D.fsw(-5.4, 5.4, 2, 7.8, 21.2, "sand", 3);
  D.fsw(-5.4, 5.4, 2, 17, 21.2, "cloth2", 3);
  for (let i = 0; i < 4; i++) { D.fsw(-4.4, 4.2 - (i % 2) * 2.4, 2, 9 + i * 1.9, 9.8 + i * 1.9, "ink", 2); }
  const c = D.at(0, 2, 15);
  return done(P, kit, [light(kit, c[0], c[1], Math.round(11 * k), "sign", "gold")]);
}

function mailbox(kit: StyleKit): UrbanResult {
  const { P, D, k, fx, fy } = canvas(kit, 30);
  D.box(-1.5, 1.5, -1.5, 1.5, 0, 14, "metal", { tone: -1 });
  D.box(-5, 5, -4, 4, 14, 24, "cloth2", { tone: 0 });
  P.ellipse(fx, fy - 24 * k, 5.5 * k, 2.4 * k, "cloth2", { tone: 1 });
  D.fsw(-3.5, 3.5, 4, 17, 19, "ink", 0);
  D.fsw(-2.5, 2.5, 4, 21, 22.5, "gold", 3);
  return done(P, kit, []);
}

/** Ramen yatai: a wooden pushcart with a counter, a steaming pot, a noren curtain and a hanging chochin. */
function yatai(kit: StyleKit, seed: number): UrbanResult {
  const { P, D, k, fx } = canvas(kit, 44, 44, 4);
  void seed;
  const L: UrbanLight[] = [];
  // wheels (far side drawn first as ellipses, near wheel on the lit side)
  for (const [u, rr] of [[-9, 4.5], [9, 4.5]] as [number, number][]) { const [x, y] = D.at(u, 7, rr); P.ellipse(x, y, 4.6 * k, 4.6 * k, "wood", { tone: -2 }); P.ellipse(x, y, 1.6 * k, 1.6 * k, "metal", { tone: 0 }); }
  D.box(-12, 12, -6, 6, 5, 17, "wood", { tone: -1 });           // cart body
  D.fsw(-11, 11, 6, 6, 8, "wood", 1);
  for (let i = -9; i <= 9; i += 6) D.fsw(i, i + 0.8, 6, 8, 17, "wood", 1);
  // counter overhang with a stool in front
  D.box(-12.5, 12.5, -7, 8.5, 17, 18.5, "wood", { tone: 1 });
  D.fsw(-10, 4, 8.5, 18.5, 19.2, "sand", 2);
  // steaming pot + bowls on the counter
  P.cylinder(Math.round(D.at(-6, 0, 19)[0] - 3 * k), Math.round(D.at(-6, 0, 19)[1] - 6 * k), Math.max(5, Math.round(6 * k)), Math.round(6 * k), "metal", { tone: -1 });
  const sx = D.at(-6, 0, 28);
  for (let i = 0; i < 3; i++) P.px(Math.round(sx[0] + (i % 2) * 2 - 1), Math.round(sx[1] - i * 2), "ui", 3 + (i % 2));
  for (const u of [3, 8]) { const b = D.at(u, 3, 19.5); P.ellipse(b[0], b[1], 2.4 * k, 1.2 * k, "ui", { tone: 1 }); P.px(Math.round(b[0]), Math.round(b[1]), "leather", 3); }
  // roof poles + slanted cloth canopy + noren valance
  for (const [u, v] of [[-11, -5.5], [11, -5.5], [-11, 5.5], [11, 5.5]] as [number, number][]) D.line([u, v, 18], [u, v, 36], "wood", 2);
  D.poly([[-13, -7, 36], [13, -7, 36], [13, 9, 33], [-13, 9, 33]], "cloth", TOP, 0);
  D.fsw(-13, 13, 9, 29.5, 33, "cloth", 3);
  for (let i = -3; i <= 3; i++) D.fsw(i * 3.6 - 1.3, i * 3.6 + 1.3, 9, 20.5, 29.5, i % 2 ? "cloth" : "ui", i % 2 ? 2 : 3);
  for (let i = -3; i <= 3; i++) if (i % 2 === 0) D.px(i * 3.6, 9, 26, "cloth", 1);
  for (let i = -3; i <= 3; i++) D.px(i * 3.6, 9, 20.5, "ink", 1);
  // hanging lantern at the near corner
  const lp = D.at(11, 9, 35);
  P.px(Math.floor(lp[0]), Math.floor(lp[1]), "ink", 1);
  const lc = chochin(P, lp[0], lp[1] + 1, 1 * Math.max(0.7, k));
  L.push(light(kit, lc.x, lc.y, Math.round(14 * k), "lantern", "cloth2"));
  L.push(light(kit, D.at(-3, 8, 24)[0], D.at(-3, 8, 24)[1], Math.round(9 * k), "window", "gold"));
  void fx;
  return done(P, kit, L);
}

/** A vertical neon kanji sign on a post (the building variant is `neonSign` in urban-iso). */
export function neonSignAt(D: IsoDraw, face: "sw" | "se", a: number, v: number, z0: number, h: number, hue: Material, seed: number, depthOut = 3): void {
  const w = 5, r = rng(seed);
  const pl = (u0: number, u1: number, zz0: number, zz1: number, m: Material, lvl: number) => (face === "sw" ? D.fsw(u0, u1, v, zz0, zz1, m, lvl) : D.fse(v, u0, u1, zz0, zz1, m, lvl));
  // cabinet standing proud of the wall, then a glowing strip of 'glyphs'
  if (face === "sw") D.box(a - w / 2 - 1, a + w / 2 + 1, v, v + depthOut, z0, z0 + h, "metal", { tone: -2 });
  else D.box(v, v + depthOut, a - w / 2 - 1, a + w / 2 + 1, z0, z0 + h, "metal", { tone: -2 });
  const o = v + depthOut;
  pl(a - w / 2, a + w / 2, z0 + 1, z0 + h - 1, "ink", 0);
  const n = Math.floor((h - 2) / 5);
  for (let i = 0; i < n; i++) {
    const zz = z0 + 2 + i * 5;
    pl(a - w / 2 + 0.6, a + w / 2 - 0.6, zz + 3.4, zz + 4, hue, 4);       // top bar
    pl(a - 0.4, a + 0.6, zz, zz + 4, hue, 3);                              // stem
    if (r.chance(0.7)) pl(a - w / 2 + 0.6, a + w / 2 - 0.6, zz + 1.4, zz + 2, hue, 4);
    if (r.chance(0.5)) pl(a - w / 2 + 0.6, a - w / 2 + 1.4, zz, zz + 3, hue, 3);
  }
  void o;
}

function neonSign(kit: StyleKit, seed: number, variant: number): UrbanResult {
  const { P, D, k } = canvas(kit, 58);
  const hue: Material = variant % 2 ? "water" : "blossom";
  D.box(-1.2, 1.2, -1.2, 1.2, 0, 14, "metal", { tone: -1 }); // post
  neonSignAt(D, "sw", 0, 1.5, 14, 40, hue, seed, 3);
  const c = D.at(0, 4.5, 34);
  void P;
  return done(D.P, kit, [light(kit, c[0], c[1], Math.round(16 * k), "sign", hue)]);
}

/** Parked kei car / taxi: boxy body, windows, wheels, a roof lamp; lights are off but the roof sign glows. */
function car(kit: StyleKit, seed: number, variant: number): UrbanResult {
  const { P, D, k } = canvas(kit, 34, 56, 5);
  void seed;
  const taxi = variant % 2 === 1, body: Material = taxi ? "gold" : "cloth", L: UrbanLight[] = [];
  // car runs along the SE axis (u); lit side faces SW
  const hu = 15, hv = 7;
  D.box(-hu, hu, -hv, hv, 4, 13, body, { tone: taxi ? -1 : 0 });      // lower body
  D.box(-hu + 1.5, hu - 1.5, -hv + 0.3, hv - 0.3, 13, 15, body, { tone: 0 });
  // cabin
  D.box(-7, 8, -hv + 1, hv - 1, 15, 23, body, { tone: 0, top: 1 });
  // windows (dark glass with a faint sky glint)
  D.fsw(-6, 0, hv - 1, 16.5, 22, "cloth", 1); D.fsw(1, 7.4, hv - 1, 16.5, 22, "cloth", 1);
  D.fsw(-6, 0, hv - 1, 20.4, 22, "cloth", 2); D.fsw(1, 7.4, hv - 1, 20.4, 22, "cloth", 2);
  D.fse(8, -hv + 2, hv - 2, 16.5, 22, "cloth", 1);
  D.fsw(0, 1, hv - 1, 15.4, 22.6, body, 2);                              // B-pillar
  // door seams, handle, headlights (off), tail lights
  D.fsw(0, 0.8, hv, 5, 14, "ink", 1); D.fsw(-hu + 3, -hu + 3.8, hv, 5, 14, "ink", 1);
  D.fsw(2, 4.5, hv, 12, 12.8, "metal", 3);
  D.fse(hu, -hv + 1, -hv + 3.6, 8, 11, "metal", 3); D.fse(hu, hv - 3.6, hv - 1, 8, 11, "metal", 3);
  D.fse(hu, -hv + 1, hv - 1, 5, 6.2, "ink", 1);
  D.fsw(-hu, -hu + 2.5, hv, 9, 11, "cloth2", 2);
  // wheels
  for (const u of [-9, 9]) { const [x, y] = D.at(u, hv, 4.5); P.ellipse(x, y, 4.3 * k, 4.3 * k, "ink", { tone: 0 }); P.ellipse(x, y, 2 * k, 2 * k, "metal", { tone: 0 }); P.px(Math.floor(x), Math.floor(y), "metal", 4); }
  if (taxi) {
    D.box(-3, 3, -2, 2, 23, 27, "ui", { tone: 0 });
    D.fsw(-2.4, 2.4, 2, 23.8, 26, "gold", 4);
    D.fsw(-hu, hu, hv, 11.2, 12.3, "ink", 1); // checker stripe
    for (let u = -hu; u < hu; u += 2) D.fsw(u, u + 1, hv, 11.2, 12.3, "ui", 4);
    const c = D.at(0, 2, 25);
    L.push(light(kit, c[0], c[1], Math.round(10 * k), "sign", "gold"));
  } else {
    D.box(-2, 2, -1.5, 1.5, 23, 24.5, "metal", { tone: 0 });
    D.fsw(-1.6, 1.6, 1.5, 23.3, 24.2, "cloth2", 3);
    const c = D.at(0, 1.5, 24);
    L.push(light(kit, c[0], c[1], Math.round(7 * k), "lamp", "cloth2"));
  }
  return done(P, kit, L);
}

/** Pavement crack with weeds (a flat decal on one cell). */
function weeds(kit: StyleKit, seed: number, variant: number): UrbanResult {
  const { P, D, k } = canvas(kit, 12);
  const r = rng(seed * 5 + variant);
  let u = -8, v = -6 + r.int(-1, 1);
  for (let i = 0; i < 20; i++) { D.px(u, v, 0, "stone", 0); D.px(u + 1, v, 0, "stone", 1); u += 1 + r.int(0, 1); v += r.int(-1, 1) * 0.8 + 0.6; if (u > 8) break; }
  for (const [cu, cv] of [[-4, -4], [0, -1], [4, 1], [-1, 3]] as [number, number][]) {
    const [x, y] = D.at(cu + r.int(-1, 1), cv, 0);
    for (let b = 0; b < 5; b++) {
      const dx = (b - 2) * 1.5, h = (5 + r.int(0, 4)) * k;
      P.poly([[x + dx - 0.9, y], [x + dx + 0.9, y], [x + dx * 1.7, y - h]], b % 2 ? "grass" : "foliage", dx < 0 ? WALL_SW : WALL_SE, { tone: b % 2 });
    }
    if (r.chance(0.6)) P.px(Math.floor(x + 1), Math.floor(y - 6 * k), "gold", 4);
  }
  return done(P, kit, [], false);
}

// -------------------------------------------------------------------------- registry

export const URBAN_PROP_KINDS = ["vending", "recycle-box", "chochin-stand", "utility-pole", "street-lamp", "bins", "bicycle", "potted-plant", "weeds", "cat", "a-frame-sign", "crates", "mailbox", "yatai", "neon-sign", "kei-car"] as const;
export type UrbanPropKind = (typeof URBAN_PROP_KINDS)[number];

function chochinStand(kit: StyleKit, seed: number): UrbanResult {
  const { P, D, k, fx } = canvas(kit, 46, 36);
  void seed;
  D.box(-3, 3, -3, 3, 0, 3, "stone", { tone: -1 });
  D.line([0, 0, 3], [0, 0, 38], "wood", 2); D.line([1, 0, 3], [1, 0, 38], "wood", 1);
  const top = D.at(0, 0, 38);
  for (let i = 0; i < 9 * k; i++) P.px(Math.floor(top[0] + i), Math.floor(top[1] - 1), "wood", 2);
  const L: UrbanLight[] = [];
  for (const [dx, dz] of [[7, 0], [14, 3]] as [number, number][]) {
    const c = chochin(P, top[0] + dx * k, top[1] + dz * k, Math.max(0.7, k));
    L.push(light(kit, c.x, c.y, Math.round(13 * k), "lantern", "cloth2"));
  }
  void fx;
  return done(P, kit, L);
}

/** Any urban prop with its emitters. */
export function urbanProp(kit: StyleKit, kind: string, seed: number, variant = 0): UrbanResult {
  switch (kind) {
    case "vending": return vending(kit, seed, variant);
    case "recycle-box": return recycleBox(kit, seed, variant);
    case "chochin-stand": return chochinStand(kit, seed);
    case "utility-pole": return pole(kit, seed);
    case "street-lamp": return lamp(kit, seed, variant);
    case "bins": return bins(kit, seed, variant);
    case "bicycle": return bicycle(kit, seed, variant);
    case "potted-plant": return plant(kit, seed, variant);
    case "weeds": return weeds(kit, seed, variant);
    case "cat": return cat(kit, seed, variant);
    case "a-frame-sign": return signStand(kit, seed, variant);
    case "crates": return crates(kit, seed);
    case "mailbox": return mailbox(kit);
    case "yatai": return yatai(kit, seed);
    case "neon-sign": return neonSign(kit, seed, variant);
    case "kei-car": return car(kit, seed, variant);
    default: throw new Error(`unknown urban prop ${kind}`);
  }
}

for (const kind of URBAN_PROP_KINDS) registerIsoProp(`urban-${kind}`, (kit, seed, v) => urbanProp(kit, kind, seed, v).sprite);

export const urbanPropGenerator: Generator = {
  id: "urban-prop",
  category: "environment",
  label: "Urban prop (iso)",
  description: "Isometric street dressing for a Japanese night street on the 'kit-iso' camera: vending machine (variant 0 red, 1 blue, 2 white), recycle-box (drink cans), chochin-stand (paper lanterns), utility-pole (wooden, transformer, wires), street-lamp (curved), bins (blue plastic, variant = count), bicycle, potted-plant (variant 0-2), weeds (pavement crack), cat (variant 0-2), a-frame-sign, crates, mailbox, yatai (ramen cart with noren and lantern), neon-sign (vertical kanji sign, variant 0 pink / 1 cyan), kei-car (variant 0 kei car, 1 taxi). Emitters are reported in meta.lights as [{x,y,r,kind:'window'|'lantern'|'lamp'|'vending'|'sign',color,material}] in sprite px.",
  params: [
    { key: "kind", label: "Prop", type: "select", options: [...URBAN_PROP_KINDS], default: "vending" },
    { key: "variant", label: "Variant", type: "number", min: 0, max: 5, step: 1, default: 0 },
  ],
  generate(p: Params, kit: StyleKit, seed: number) {
    const res = urbanProp(kit, str(p, "kind"), seed, Math.round(num(p, "variant")));
    return { rows: [{ name: "idle", frames: [res.sprite] }], fps: 1, meta: { camera: "iso", lights: res.lights } };
  },
};

/** Draw a drooping wire (sag in px) between two sprite-space points straight into a rendered image. */
export function drawWire(img: Sprite, a: Pt, b: Pt, sag: number, idx: number): void {
  const n = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])));
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = Math.round(a[0] + (b[0] - a[0]) * t), y = Math.round(a[1] + (b[1] - a[1]) * t + Math.sin(t * Math.PI) * sag);
    if (x >= 0 && y >= 0 && x < img.w && y < img.h) img.data[y * img.w + x] = idx;
  }
}

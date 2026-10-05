import { Painter } from "../painter";
import type { Material } from "../palette";
import { proportions } from "../kit";
import type { Rng } from "../rng";
import type { StyleKit } from "../types";
import { doorHeightPx, type Footprint } from "../footprint";

/**
 * Rich 3/4 top-down buildings (`look: rich`). The camera looks down at the front wall: the roof
 * plane dominates the sprite, eaves overhang and shade the wall, and a narrow shaded side wall
 * gives depth. Volumes use the lit Painter; textures are tone offsets over the same ramps so the
 * buildings share one light with trees, crops and characters.
 */


/** Door height in px for a kit: at least 1.25 characters tall (shared with the footprint system). */
export const richDoorHeight = (kit: StyleKit) => doorHeightPx(kit);

export type Vec3 = [number, number, number];
export type NF = (x: number, y: number) => Vec3;
export const flat = (n: Vec3): NF => () => n;
export type WallKind = "plank" | "log" | "brick" | "stone" | "plaster" | "batten" | "tin";
export type Cover = "shingle" | "tile" | "thatch" | "tin" | "slate";

export function jit(a: number, b: number, s: number): number {
  let h = Math.imul(a + 374761393, 668265263) ^ Math.imul(b + 1274126177, 2246822519) ^ Math.imul(s + 1, 3266489917);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** 3-shade kits (tiny sprites): no random shingle/plank variation, it only reads as noise. */
export const calm = { on: false };
export const rj = (a: number, b: number, s: number) => (calm.on ? 0.5 : jit(a, b, s));
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export interface Ctx {
  P: Painter; kit: StyleKit; seed: number; r: Rng;
  t: number; c: number; ts: number; // tile, character, texture scale
  pr: ReturnType<typeof proportions>;
  wall: Material; roof: Material; trim: Material;
  lit: boolean; chimney: boolean; flower: boolean;
  cover: Cover; wallKind: WallKind;
  o: AddOns;
  /** window / lamp / forge light centres in painter px (flipped with the sprite by the renderer) */
  lights: { x: number; y: number; r: number }[];
  /** flue mouth in painter px, where smoke puffs start */
  smokeAt: { x: number; y: number } | null;
  /** animation state for the frame being rendered (windmill sail angle in radians) */
  spin: number;
}

/** Resolved add-ons: every style supplies defaults, `auto|on|off` params override them. */
export interface AddOns {
  porch: boolean; balcony: boolean; awning: boolean; awningMat: Material; sign: string; lanterns: boolean;
  flowerBoxes: boolean; ivy: boolean; wear: boolean; yard: boolean; hayloft: boolean;
  gable: "western" | "thai"; tier: number;
}

// ---------------------------------------------------------------------------
// Wall textures: pure tone maps so they can be reused on front, side and round walls.
// ---------------------------------------------------------------------------
export interface Tex { w: number; h: number; tone: Int8Array; mortar: Uint8Array }

export function texture(kind: WallKind, w: number, h: number, ts: number, seed: number): Tex {
  const tone = new Int8Array(w * h), mortar = new Uint8Array(w * h);
  const set = (x: number, y: number, v: number) => { if (x >= 0 && y >= 0 && x < w && y < h) tone[y * w + x] = v; };
  if (kind === "plank") {
    const ph = Math.max(3, Math.round(4 * ts));
    for (let y = 0; y < h; y++) {
      const ri = Math.floor(y / ph), yy = y % ph;
      const jx = Math.floor(rj(ri, 1, seed) * 26);
      const row = rj(ri, 0, seed) < 0.28 ? -1 : 0;
      for (let x = 0; x < w; x++) {
        let v = yy === ph - 1 ? -1 : yy === 0 ? 1 : row;
        if (yy < ph - 1 && (x + ri * 9) % 26 === jx) v = -2;
        set(x, y, v);
      }
    }
  } else if (kind === "log") {
    const lh = Math.max(4, Math.round(5 * ts));
    for (let y = 0; y < h; y++) {
      const yy = y % lh, ri = Math.floor(y / lh);
      for (let x = 0; x < w; x++) {
        let v = yy === 0 ? 1 : yy === lh - 1 ? -2 : yy === lh - 2 ? -1 : 0;
        if (yy > 0 && yy < lh - 2 && rj(Math.floor(x / 5), ri, seed) < 0.1 && yy === 2) v = -1; // knots / grain
        if (x < 2 || x >= w - 2) v = yy === Math.floor(lh / 2) && (x === 1 || x === w - 2) ? -1 : yy === lh - 1 ? -2 : 1; // round log ends
        set(x, y, v);
      }
    }
  } else if (kind === "brick") {
    const bh = Math.max(3, Math.round(4 * ts)), bw = Math.round(2 * bh) ;
    for (let y = 0; y < h; y++) {
      const ri = Math.floor(y / bh), yy = y % bh, off = (ri % 2) * (bw >> 1);
      for (let x = 0; x < w; x++) {
        const bi = Math.floor((x + off) / bw);
        if (yy === bh - 1 || (x + off) % bw === 0) { mortar[y * w + x] = 1; continue; }
        const j = rj(bi, ri, seed);
        set(x, y, yy === 0 ? 1 : j < 0.2 ? -1 : j > 0.82 ? 1 : 0);
      }
    }
  } else if (kind === "stone") {
    let by = 0, ri = 0;
    while (by < h) {
      const bh = Math.max(4, Math.round((5 + Math.floor(rj(ri, 3, seed) * 3)) * ts));
      let bx = -Math.floor(rj(ri, 4, seed) * 6);
      let ci = 0;
      while (bx < w) {
        const bw = Math.round((7 + Math.floor(rj(ci, ri, seed + 5) * 6)) * ts);
        const j = rj(ci, ri, seed + 9);
        const t0 = j < 0.25 ? -1 : j > 0.8 ? 1 : 0;
        for (let y = by; y < Math.min(h, by + bh); y++)
          for (let x = Math.max(0, bx); x < Math.min(w, bx + bw); x++) {
            const edge = x === bx + bw - 1 || y === by + bh - 1;
            set(x, y, edge ? -2 : y === by || x === bx ? 1 : t0);
          }
        bx += bw; ci++;
      }
      by += bh; ri++;
    }
  } else if (kind === "plaster") {
    for (let i = 0; i < (w * h) / 110; i++) {
      const px = Math.floor(rj(i, 7, seed) * w), py = Math.floor(rj(i, 8, seed) * h);
      for (let j = 0; j < 3; j++) for (let k = 0; k < 2; k++) set(px + j, py + k, rj(i, 9, seed) < 0.6 ? -1 : 1);
    }
  } else if (kind === "batten") {
    const bw = 4;
    for (let x = 0; x < w; x++) {
      const bi = Math.floor(x / bw), cx = x % bw;
      const j = rj(bi, 0, seed);
      for (let y = 0; y < h; y++) set(x, y, cx === bw - 1 ? -2 : cx === 0 ? 1 : j < 0.22 ? -1 : 0);
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (y % 14 === 13 && x % bw !== bw - 1) set(x, y, -1);
  } else {
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) set(x, y, x % 3 === 0 ? 1 : x % 3 === 2 ? -1 : 0);
  }
  return { w, h, tone, mortar };
}

export function paintTex(ctx: Ctx, tex: Tex, m: Material, x0: number, y0: number, nf: NF, mortarLevel = 2) {
  const { P } = ctx;
  for (let y = 0; y < tex.h; y++)
    for (let x = 0; x < tex.w; x++) {
      const i = y * tex.w + x;
      if (tex.mortar[i]) P.px(x0 + x, y0 + y, "sand", mortarLevel);
      else P.box(x0 + x, y0 + y, 1, 1, m, nf(x0 + x, y0 + y), { tone: tex.tone[i] });
    }
}

/** A flat wall face with texture. */
export function wallFace(ctx: Ctx, kind: WallKind, m: Material, x: number, y: number, w: number, h: number, nf: NF, mortarLevel = 2) {
  paintTex(ctx, texture(kind, w, h, ctx.ts, ctx.seed + x * 3 + y), m, x, y, nf, mortarLevel);
}

/** Damp, darker boards near the ground and a worn edge. */
export function wear(ctx: Ctx, x: number, y: number, w: number, h: number) {
  const { P } = ctx;
  for (let i = 0; i < w; i++) if (jit(i, 11, ctx.seed) < 0.5) P.shade(x + i, y + h - 3, 1, 3, -1);
  P.shade(x, y + h - 1, w, 1, -1);
}

// ---------------------------------------------------------------------------
// Roof covers, painted pixel by pixel inside a span function (one x range per row).
// ---------------------------------------------------------------------------
export type Span = (y: number) => [number, number] | null;

export function coverPx(ctx: Ctx, cover: Cover, x: number, y: number, y1: number, nf: NF): { n: Vec3; tone: number } {
  const ts = ctx.ts, base = nf(x, y), seed = ctx.seed;
  const rb = y1 - 1 - y; // distance up from the eaves line
  if (cover === "shingle" || cover === "slate") {
    const rowH = Math.max(4, Math.round(4 * ts)), tw = Math.max(5, Math.round(6 * ts));
    const ri = Math.floor(rb / rowH), yy = rowH - 1 - (rb % rowH), off = ri % 2 ? tw >> 1 : 0;
    const cx = (((x + off) % tw) + tw) % tw, ci = Math.floor((x + off) / tw);
    const j = rj(ci, ri, seed);
    let tone = j < 0.2 ? -1 : j > 0.85 ? 1 : 0;
    tone += yy === rowH - 1 ? -2 : yy === rowH - 2 ? -1 : yy === 0 ? 1 : 0;
    if (cx === 0 && yy < rowH - 1) tone -= 1;
    return { n: base, tone };
  }
  if (cover === "tile") {
    const rowH = Math.max(5, Math.round(6 * ts)), tw = Math.max(4, Math.round(5 * ts));
    const ri = Math.floor(rb / rowH), yy = rowH - 1 - (rb % rowH), off = ri % 2 ? tw >> 1 : 0;
    const cx = (((x + off) % tw) + tw) % tw;
    const u = ((cx + 0.5) / tw) * 2 - 1;
    const j = rj(Math.floor((x + off) / tw), ri, seed);
    return { n: [base[0] + u * 0.75, base[1], base[2] - Math.abs(u) * 0.2], tone: (j < 0.16 ? -1 : 0) + (yy === rowH - 1 ? -2 : yy === rowH - 2 ? -1 : 0) };
  }
  if (cover === "thatch") {
    const lh = Math.max(7, Math.round(9 * ts));
    const sx = x + Math.floor(y / 5), sc = Math.floor(sx / 2);
    const j = rj(sc, Math.floor(rb / lh), seed);
    const yy = lh - 1 - (rb % lh);
    let tone = j < 0.3 ? -1 : j > 0.72 ? 1 : 0;
    if (yy === lh - 1) tone = -2;
    else if (yy >= lh - 3) tone -= 1;
    else if (yy === 3 && rj(sc, 5, seed) < 0.5) tone -= 1;
    return { n: base, tone };
  }
  // tin: ribbed sheets with an overlap seam
  const tw = 3, cx = (((x % tw) + tw) % tw), u = ((cx + 0.5) / tw) * 2 - 1;
  const sheet = 14;
  const seam = rb % sheet === 0 ? -2 : rb % sheet === 1 ? -1 : 0;
  return { n: [base[0] + u * 0.9, base[1], base[2] - Math.abs(u) * 0.3], tone: seam };
}

export function paintRoof(ctx: Ctx, cover: Cover, m: Material, span: Span, y0: number, y1: number, nf: NF) {
  const { P } = ctx;
  for (let y = y0; y < y1; y++) {
    const s = span(y);
    if (!s) continue;
    const a = Math.ceil(s[0]), b = Math.floor(s[1]);
    for (let x = a; x < b; x++) {
      const { n, tone } = coverPx(ctx, cover, x, y, y1, nf);
      P.box(x, y, 1, 1, m, n, { tone });
    }
  }
  // lit rake on the light side, shaded rake opposite, dark fascia on the eaves edge
  for (let y = y0; y < y1; y++) {
    const s = span(y);
    if (!s) continue;
    P.shade(Math.ceil(s[0]), y, 1, 1, 1, m);
    P.shade(Math.floor(s[1]) - 1, y, 1, 1, -1, m);
  }
  const s = span(y1 - 1);
  if (s) P.shade(Math.ceil(s[0]), y1 - 1, Math.floor(s[1]) - Math.ceil(s[0]), 1, -1, m);
}

export function insetAt(pts: [number, number][], y: number): number {
  if (y <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++)
    if (y <= pts[i][0]) return pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * (y - pts[i - 1][0])) / (pts[i][0] - pts[i - 1][0] || 1);
  return pts[pts.length - 1][1];
}

/** Span function for a roof outline defined by left/right insets at given rows. */
export function outline(ex0: number, ex1: number, left: [number, number][], right: [number, number][], ya: number, yb: number): Span {
  return (y) => (y < ya || y >= yb ? null : [ex0 + insetAt(left, y + 0.5), ex1 - insetAt(right, y + 0.5)]);
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------
export function glass(ctx: Ctx, x: number, y: number, w: number, h: number, lit: boolean) {
  const { P } = ctx;
  if (lit) {
    ctx.lights.push({ x: x + w / 2, y: y + h / 2, r: Math.max(8, Math.round(ctx.t * 0.9)) });
    P.rect(x, y, w, h, "gold", 3);
    P.rect(x, y, w, 1, "gold", 2);
    P.rect(x, y + h - 1, w, 1, "gold", 2);
    P.rect(x + 1, y + 1, 2, 2, "gold", 4);
    P.rect(x, y + h - 2, w, 1, "gold", 2);
  } else {
    P.rect(x, y, w, h, "water", 1);
    P.rect(x, y, w, 1, "water", 0);
    P.rect(x + 1, y + 1, 1, Math.max(1, h >> 1), "water", 3);
    if (w > 3) P.px(x + 2, y + 1, "water", 4);
  }
}

/** Framed window: lintel, frame, glass with highlight, mullions, sill; optional shutters and flower box. */
export function win(ctx: Ctx, x: number, y: number, w: number, h: number, o: { shutters?: Material; flower?: boolean; lit?: boolean; arch?: boolean } = {}) {
  const { P, trim } = ctx;
  const lit = o.lit ?? ctx.lit;
  if (o.shutters) {
    const sw = Math.max(2, Math.round(w * 0.3));
    for (const sx of [x - 1 - sw, x + w + 1]) {
      P.box(sx, y - 1, sw, h + 2, o.shutters, [sx < x ? -0.3 : 0.3, 0, 1], { tone: -1 });
      for (let yy = y + 1; yy < y + h; yy += 2) P.box(sx, yy, sw, 1, o.shutters, [0, 0, 1], { tone: -2 });
    }
  }
  P.box(x - 1, y - 1, w + 2, h + 2, trim, [0, -0.3, 1], { tone: -1 });
  P.box(x - 1, y - 1, w + 2, 1, trim, [0, -0.8, 0.6], { tone: 1 });
  glass(ctx, x, y, w, h, lit);
  const mx = x + (w >> 1);
  P.box(mx, y, 1, h, trim, [0, 0, 1]);
  if (h >= 11) P.box(x, y + (h >> 1), w, 1, trim, [0, 0, 1]);
  P.box(x - 2, y + h + 1, w + 4, 1, trim, [0, -0.8, 0.6], { tone: 1 });
  P.box(x - 2, y + h + 2, w + 4, 1, trim, [0, 0.5, 0.8], { tone: -1 });
  P.shade(x - 1, y + h + 3, w + 2, 2, -1);
  if (o.flower) {
    P.box(x - 2, y + h + 1, w + 4, 3, "wood", [0, -0.3, 1], { tone: -1 });
    for (let xx = x - 1; xx < x + w + 1; xx++) {
      const j = jit(xx, y, ctx.seed);
      P.px(xx, y + h, j < 0.4 ? "cloth2" : j < 0.7 ? "foliage" : "gold", xx % 2 ? 3 : 2);
      if (j < 0.4) P.px(xx, y + h - 1, "foliage", 2);
    }
  }
}

/** Plank door with frame, straps, handle and a stone step reaching into the ground band. */
export function door(ctx: Ctx, x: number, baseY: number, w: number, h: number, o: { double?: boolean; stone?: boolean; pane?: boolean } = {}) {
  const { P } = ctx;
  const frame: Material = o.stone ? "stone" : ctx.trim;
  P.box(x - 2, baseY - h - 2, w + 4, h + 2, frame, [0, -0.3, 1], { tone: o.stone ? 0 : -1 });
  P.box(x - 2, baseY - h - 2, w + 4, 1, frame, [0, -0.8, 0.6], { tone: 1 });
  P.box(x - 2, baseY - h - 1, 1, h + 1, frame, [-0.6, 0, 1], { tone: 1 });
  P.box(x, baseY - h, w, h, ctx.trim, [0, 0, 1], { tone: -1 });
  const step = o.double ? 6 : 3;
  for (let xx = x + 2; xx < x + w; xx += step) P.box(xx, baseY - h, 1, h, ctx.trim, [0, 0, 1], { tone: -2 });
  P.box(x, baseY - h, w, 1, ctx.trim, [0, 0, 1], { tone: -2 }); // shadow under the lintel
  if (o.double) P.rect(x + (w >> 1), baseY - h, 1, h, ctx.trim, 0);
  for (const f of [0.22, 0.74]) P.rect(x, baseY - Math.round(h * (1 - f)), w, 1, "metal", 2);
  if (o.pane && w >= 9) glass(ctx, x + 2, baseY - h + 3, w - 4, Math.max(3, Math.round(h * 0.14)), ctx.lit);
  const hy = baseY - Math.round(h * 0.45);
  P.px(x + w - 3, hy, "gold", 3);
  P.px(x + w - 3, hy - 1, "gold", 4);
  if (o.double) P.px(x + 2, hy, "gold", 3);
  // stone step
  P.box(x - 3, baseY, w + 6, 2, "stone", [0, -0.6, 0.8]);
  P.box(x - 3, baseY + 1, w + 6, 1, "stone", [0, 0.4, 0.9], { tone: -1 });
}

/** Foundation course of stone blocks under a wall. */
export function foundation(ctx: Ctx, x: number, baseY: number, w: number, fh: number, nf: NF) {
  paintTex(ctx, texture("stone", w, fh, ctx.ts, ctx.seed + 77), "stone", x, baseY - fh, nf);
  ctx.P.box(x, baseY - fh, w, 1, "stone", [0, -0.8, 0.6], { tone: 1 }); // lit top lip
}

export function chimneyAt(ctx: Ctx, cx: number, top: number, bottom: number, cw: number) {
  const { P } = ctx;
  paintTex(ctx, texture("stone", cw, bottom - top, ctx.ts, ctx.seed + 31), "stone", cx, top, flat([0.25, 0, 1]));
  P.shade(cx + cw - 2, top, 2, bottom - top, -1);
  P.box(cx - 1, top - 2, cw + 2, 3, "stone", [0, -0.7, 0.7], { tone: 1 });
  P.box(cx - 1, top, cw + 2, 1, "stone", [0, 0.6, 0.8], { tone: -1 });
  P.rect(cx + 1, top - 3, cw - 2, 1, "ink", 1); // flue opening
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
export interface Layout {
  W: number; H: number; PAD: number; over: number;
  wt: number; fw: number; sw: number;
  wy: number; baseY: number; wallH: number; eh: number;
  ridgeY: number; rh: number; gb: number; fh: number;
  ex0: number; ex1: number; storey: number;
  dx: number; dw: number; dh: number;
}

export function layout(ctx: Ctx, fp: Footprint, wallH: number, rh: number, extraTop: number, o: { sideless?: boolean } = {}): Layout {
  const { t } = ctx;
  const over = Math.max(3, Math.round(t * 0.28)), PAD = over + 2; // generous eaves
  const wt = fp.w * t - 2 * over; // walls sit under the eaves, inside the footprint
  const sw = o.sideless ? 0 : Math.round(t * 0.4);
  const fw = wt - sw;
  const eh = Math.max(2, Math.round(t * 0.14));
  const gb = Math.max(5, Math.round(t * 0.42)); // ground band for the soft shadow
  const ridgeY = 2 + extraTop;
  const wy = ridgeY + rh - eh;
  const baseY = wy + wallH;
  const dw = Math.max(8, ctx.pr.doorW), dh = richDoorHeight(ctx.kit);
  const dx = clamp(Math.round(2 + (fp.door + 0.5) * t - dw / 2), PAD + 3, PAD + fw - dw - 3);
  return {
    W: fp.w * t + 4, H: baseY + gb + 2, PAD, over, wt, fw, sw, wy, baseY, wallH, eh, ridgeY, rh, gb,
    fh: Math.max(3, Math.round(t * 0.25)), ex0: 2, ex1: fp.w * t + 2, storey: storeyPx(ctx), dx, dw, dh,
  };
}

/** Wall height: a storey is ~1.3 characters (door stays >= 1.25 and the wall above it shrinks). */
export const storeyPx = (ctx: Ctx) => Math.round(ctx.c * 1.3);
export const wallHeight = (ctx: Ctx, storeys: number) => Math.max(storeys * storeyPx(ctx), richDoorHeight(ctx.kit) + Math.max(3, Math.round(ctx.c * 0.12)));

/** Front wall, side wall and eaves shading for a plain box building. */
export function walls(ctx: Ctx, L: Layout, kind: WallKind, m: Material, o: { frame?: boolean; wearIt?: boolean } = {}) {
  const { P, trim } = ctx;
  const { PAD, fw, sw, wy, baseY, wallH, fh } = L;
  wallFace(ctx, kind, m, PAD, wy, fw, wallH, flat([0, 0.1, 1]));
  if (sw > 0) {
    wallFace(ctx, kind, m, PAD + fw, wy, sw, wallH, flat([1, 0.05, 0.3]), 1);
    P.shade(PAD + fw, wy, sw, wallH, -1, m);
  }
  if (o.frame) {
    // timber frame: corner posts, mid rail, studs
    P.box(PAD, wy, 2, wallH, trim, [-0.4, 0, 1]);
    P.box(PAD + fw - 2, wy, 2, wallH, trim, [0.4, 0, 1]);
    P.box(PAD, wy + wallH - L.fh - 2, fw, 2, trim, [0, -0.5, 0.9]);
    for (let x = PAD + 12; x < PAD + fw - 6; x += 14) P.box(x, wy, 2, wallH - L.fh - 2, trim, [0, 0, 1], { tone: -1 });
    if (sw > 0) P.box(PAD + fw, wy, 2, wallH, trim, [0.4, 0, 1], { tone: -1 });
  } else if (m === "wood" || kind === "log" || kind === "plank") {
    // corner boards
    P.box(PAD, wy, 2, wallH, trim, [-0.5, 0, 1]);
    P.box(PAD + fw - 2, wy, 2, wallH, trim, [0.4, 0, 1]);
  }
  foundation(ctx, PAD - 1, baseY, fw + 2, fh, flat([0, 0, 1]));
  if (sw > 0) {
    paintTex(ctx, texture("stone", sw + 1, fh, ctx.ts, ctx.seed + 78), "stone", PAD + fw + 1, baseY - fh, flat([1, 0, 0.3]));
    P.shade(PAD + fw + 1, baseY - fh, sw, fh, -1, "stone");
  }
  if (o.wearIt !== false) wear(ctx, PAD, wy + 4, fw, wallH - 4 - fh + 3);
}

/** Roof pitched toward the viewer; returns the span for later overlays. */
export function pitched(ctx: Ctx, L: Layout, shape: "gable" | "hip" | "gambrel", roofMat: Material, cover: Cover): Span {
  const { P } = ctx;
  const { ex0, ex1, ridgeY, wy, eh, rh, sw, wt } = L;
  const yb = wy + eh;
  let left: [number, number][], right: [number, number][];
  if (shape === "hip") {
    const i = Math.round(rh * 0.5);
    left = [[ridgeY, i], [yb, 0]];
    right = [[ridgeY, i], [yb, 0]];
  } else if (shape === "gambrel") {
    const ym = ridgeY + rh * 0.42;
    const i2 = Math.round(wt * 0.2), i1 = Math.round(wt * 0.035);
    left = [[ridgeY, i2], [ym, i1], [yb, 0]];
    right = [[ridgeY, i2], [ym, i1], [yb, 0]];
  } else {
    left = [[ridgeY, 1], [yb, 0]];
    right = [[ridgeY, Math.round(sw * 0.9)], [yb, 0]];
  }
  const span = outline(ex0, ex1, left, right, ridgeY, yb);
  const nf: NF = (_x, y) => (shape === "gambrel" && y < ridgeY + rh * 0.42 ? [0, -0.75, 0.7] : [0, -0.4, 0.92]);
  paintRoof(ctx, cover, roofMat, span, ridgeY, yb, nf);
  // ridge cap
  const s0 = span(ridgeY)!;
  P.box(Math.ceil(s0[0]), ridgeY, Math.floor(s0[1]) - Math.ceil(s0[0]), 2, roofMat, [0, -1, 0.35], { tone: 1 });
  for (let x = Math.ceil(s0[0]) + 1; x < Math.floor(s0[1]); x += 4) P.px(x, ridgeY + 1, roofMat, 1);
  if (shape === "gambrel") {
    const ys = Math.round(ridgeY + rh * 0.42);
    const sp = span(ys);
    if (sp) {
      P.box(Math.ceil(sp[0]), ys - 1, Math.floor(sp[1]) - Math.ceil(sp[0]), 1, roofMat, [0, -1, 0.35], { tone: 1 });
      P.box(Math.ceil(sp[0]), ys, Math.floor(sp[1]) - Math.ceil(sp[0]), 1, roofMat, [0, 1, 0.4], { tone: -2 });
    }
  }
  // eaves: shadow band on the wall under the overhang
  const band = Math.max(2, Math.round(ctx.t * 0.12));
  P.shade(L.PAD, yb, L.fw + L.sw, band, -2);
  P.shade(L.PAD, yb + band, L.fw + L.sw, band, -2);
  P.shade(L.PAD, yb + 2 * band, L.fw + L.sw, band, -1);
  return span;
}

export function dormer(ctx: Ctx, _L: Layout, cx: number, baseY: number, cover: Cover, roofMat: Material) {
  const { P } = ctx;
  const w = Math.round(ctx.t * 1.1), h = Math.round(ctx.t * 0.9);
  const x = Math.round(cx - w / 2), top = baseY - h;
  P.box(x, top, w, h, ctx.wall, [0, 0.1, 1]);
  P.box(x, top, w, h, ctx.wall, [0, 0.1, 1]);
  paintTex(ctx, texture(ctx.wallKind === "log" ? "plank" : ctx.wallKind, w, h, ctx.ts, ctx.seed + 5), ctx.wall, x, top, flat([0, 0.1, 1]));
  win(ctx, x + 2, top + 3, w - 4, h - 7, { lit: ctx.lit });
  const rr = Math.round(w * 0.55);
  const span: Span = (y) => (y < top - rr || y >= top ? null : [x - 2 + ((y - (top - rr)) * -0) + ((top - y - 1) * 0) - 0 + (rr - (top - y)) * 0 + (top - rr - y) * 0 + ((x + w / 2 - 2 - (x - 2)) * (1 - (top - y) / rr)), x + w + 2 - ((w / 2 + 2) * (1 - (top - y) / rr))]);
  paintRoof(ctx, cover === "tile" ? "shingle" : cover, roofMat, span, top - rr, top, flat([0, -0.45, 0.9]));
  P.box(x - 2, top, w + 4, 1, roofMat, [0, 1, 0.3], { tone: -2 });
}

/** Windows centred in free spans of a wall row. */
export function windowRow(ctx: Ctx, spans: [number, number][], y: number, ww: number, wh: number, o: { shutters?: Material; flower?: boolean; lit?: boolean; max?: number } = {}) {
  const sh = o.shutters ? Math.max(2, Math.round(ww * 0.3)) : 0;
  const need = ww + 2 * sh + 4;
  for (const [a, b] of spans) {
    const room = b - a;
    if (room < ww + 4) continue;
    const useSh = o.shutters && room >= need ? o.shutters : undefined;
    const n = clamp(Math.floor((room + 3) / (need + 1)), 1, o.max ?? 3);
    for (let i = 0; i < n; i++) {
      const cx = a + ((i + 0.5) * room) / n;
      win(ctx, Math.round(cx - ww / 2), y, ww, wh, { shutters: useSh, flower: o.flower && i % 2 === 0, lit: o.lit });
    }
  }
}


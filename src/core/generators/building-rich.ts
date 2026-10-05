import { finalize } from "../enforce";
import { Painter } from "../painter";
import { colorIndex, type Material } from "../palette";
import { proportions } from "../kit";
import { rng, type Rng } from "../rng";
import { createSprite, flipX, getPx, setPx } from "../sprite";
import type { Sprite, StyleKit } from "../types";
import { buildingFootprint, doorHeightPx, type Footprint } from "../footprint";
import { bool, mat, str, type GenResult, type Params } from "./types";

/**
 * Rich 3/4 top-down buildings (`look: rich`). The camera looks down at the front wall: the roof
 * plane dominates the sprite, eaves overhang and shade the wall, and a narrow shaded side wall
 * gives depth. Volumes use the lit Painter; textures are tone offsets over the same ramps so the
 * buildings share one light with trees, crops and characters.
 */

export type { Footprint };

/** Door height in px for a kit: at least 1.25 characters tall (shared with the footprint system). */
export const richDoorHeight = (kit: StyleKit) => doorHeightPx(kit);

type Vec3 = [number, number, number];
type NF = (x: number, y: number) => Vec3;
const flat = (n: Vec3): NF => () => n;
type WallKind = "plank" | "log" | "brick" | "stone" | "plaster" | "batten" | "tin";
type Cover = "shingle" | "tile" | "thatch" | "tin" | "slate";

function jit(a: number, b: number, s: number): number {
  let h = Math.imul(a + 374761393, 668265263) ^ Math.imul(b + 1274126177, 2246822519) ^ Math.imul(s + 1, 3266489917);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
/** 3-shade kits (tiny sprites): no random shingle/plank variation, it only reads as noise. */
let CALM = false;
const rj = (a: number, b: number, s: number) => (CALM ? 0.5 : jit(a, b, s));
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

interface Ctx {
  P: Painter; kit: StyleKit; seed: number; r: Rng;
  t: number; c: number; ts: number; // tile, character, texture scale
  pr: ReturnType<typeof proportions>;
  wall: Material; roof: Material; trim: Material;
  lit: boolean; chimney: boolean; flower: boolean;
  cover: Cover; wallKind: WallKind;
}

// ---------------------------------------------------------------------------
// Wall textures: pure tone maps so they can be reused on front, side and round walls.
// ---------------------------------------------------------------------------
interface Tex { w: number; h: number; tone: Int8Array; mortar: Uint8Array }

function texture(kind: WallKind, w: number, h: number, ts: number, seed: number): Tex {
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

function paintTex(ctx: Ctx, tex: Tex, m: Material, x0: number, y0: number, nf: NF, mortarLevel = 2) {
  const { P } = ctx;
  for (let y = 0; y < tex.h; y++)
    for (let x = 0; x < tex.w; x++) {
      const i = y * tex.w + x;
      if (tex.mortar[i]) P.px(x0 + x, y0 + y, "sand", mortarLevel);
      else P.box(x0 + x, y0 + y, 1, 1, m, nf(x0 + x, y0 + y), { tone: tex.tone[i] });
    }
}

/** A flat wall face with texture. */
function wallFace(ctx: Ctx, kind: WallKind, m: Material, x: number, y: number, w: number, h: number, nf: NF, mortarLevel = 2) {
  paintTex(ctx, texture(kind, w, h, ctx.ts, ctx.seed + x * 3 + y), m, x, y, nf, mortarLevel);
}

/** Damp, darker boards near the ground and a worn edge. */
function wear(ctx: Ctx, x: number, y: number, w: number, h: number) {
  const { P } = ctx;
  for (let i = 0; i < w; i++) if (jit(i, 11, ctx.seed) < 0.5) P.shade(x + i, y + h - 3, 1, 3, -1);
  P.shade(x, y + h - 1, w, 1, -1);
}

// ---------------------------------------------------------------------------
// Roof covers, painted pixel by pixel inside a span function (one x range per row).
// ---------------------------------------------------------------------------
type Span = (y: number) => [number, number] | null;

function coverPx(ctx: Ctx, cover: Cover, x: number, y: number, y1: number, nf: NF): { n: Vec3; tone: number } {
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

function paintRoof(ctx: Ctx, cover: Cover, m: Material, span: Span, y0: number, y1: number, nf: NF) {
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

function insetAt(pts: [number, number][], y: number): number {
  if (y <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++)
    if (y <= pts[i][0]) return pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * (y - pts[i - 1][0])) / (pts[i][0] - pts[i - 1][0] || 1);
  return pts[pts.length - 1][1];
}

/** Span function for a roof outline defined by left/right insets at given rows. */
function outline(ex0: number, ex1: number, left: [number, number][], right: [number, number][], ya: number, yb: number): Span {
  return (y) => (y < ya || y >= yb ? null : [ex0 + insetAt(left, y + 0.5), ex1 - insetAt(right, y + 0.5)]);
}

// ---------------------------------------------------------------------------
// Modules
// ---------------------------------------------------------------------------
function glass(ctx: Ctx, x: number, y: number, w: number, h: number, lit: boolean) {
  const { P } = ctx;
  if (lit) {
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
function win(ctx: Ctx, x: number, y: number, w: number, h: number, o: { shutters?: Material; flower?: boolean; lit?: boolean; arch?: boolean } = {}) {
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
function door(ctx: Ctx, x: number, baseY: number, w: number, h: number, o: { double?: boolean; stone?: boolean; pane?: boolean } = {}) {
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
function foundation(ctx: Ctx, x: number, baseY: number, w: number, fh: number, nf: NF) {
  paintTex(ctx, texture("stone", w, fh, ctx.ts, ctx.seed + 77), "stone", x, baseY - fh, nf);
  ctx.P.box(x, baseY - fh, w, 1, "stone", [0, -0.8, 0.6], { tone: 1 }); // lit top lip
}

function chimneyAt(ctx: Ctx, cx: number, top: number, bottom: number, cw: number) {
  const { P } = ctx;
  paintTex(ctx, texture("stone", cw, bottom - top, ctx.ts, ctx.seed + 31), "stone", cx, top, flat([0.25, 0, 1]));
  P.shade(cx + cw - 2, top, 2, bottom - top, -1);
  P.box(cx - 1, top - 2, cw + 2, 3, "stone", [0, -0.7, 0.7], { tone: 1 });
  P.box(cx - 1, top, cw + 2, 1, "stone", [0, 0.6, 0.8], { tone: -1 });
  P.rect(cx + 1, top - 3, cw - 2, 1, "ink", 1); // flue opening
}

/** Soft contact shadow, thrown away from the light, painted after the outline so it carries none. */
function groundShadow(s: Sprite, x0: number, x1: number, y: number, rows: number, dir: number) {
  const shadow = colorIndex("ink", 2);
  for (let j = 0; j < rows; j++) {
    const a = x0 + (dir > 0 ? j : -2 - j), b = x1 + (dir > 0 ? 3 - j : j * 0 + 1);
    for (let x = a; x < b; x++) {
      if (x < 1 || x >= s.w - 1 || y + j >= s.h - 1 || getPx(s, x, y + j) !== 0) continue;
      if (j === 0 || (x + j) % 2 === 0) setPx(s, x, y + j, shadow);
    }
  }
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
interface Layout {
  W: number; H: number; PAD: number; over: number;
  wt: number; fw: number; sw: number;
  wy: number; baseY: number; wallH: number; eh: number;
  ridgeY: number; rh: number; gb: number; fh: number;
  ex0: number; ex1: number; storey: number;
  dx: number; dw: number; dh: number;
}

function layout(ctx: Ctx, fp: Footprint, wallH: number, rh: number, extraTop: number, o: { sideless?: boolean } = {}): Layout {
  const { t, c } = ctx;
  const over = Math.max(2, Math.round(t * 0.2)), PAD = over + 2;
  const wt = fp.w * t - 2 * over; // walls sit under the eaves, inside the footprint
  const sw = o.sideless ? 0 : Math.round(t * 0.4);
  const fw = wt - sw;
  const eh = Math.max(2, Math.round(t * 0.14));
  const gb = Math.max(4, Math.round(t * 0.3));
  const ridgeY = 2 + extraTop;
  const wy = ridgeY + rh - eh;
  const baseY = wy + wallH;
  const dw = Math.max(8, ctx.pr.doorW), dh = richDoorHeight(ctx.kit);
  const dx = clamp(Math.round(2 + (fp.door + 0.5) * t - dw / 2), PAD + 3, PAD + fw - dw - 3);
  return {
    W: fp.w * t + 4, H: baseY + gb + 2, PAD, over, wt, fw, sw, wy, baseY, wallH, eh, ridgeY, rh, gb,
    fh: Math.max(3, Math.round(t * 0.25)), ex0: 2, ex1: fp.w * t + 2, storey: Math.round(c * 1.6), dx, dw, dh,
  };
}

const wallHeight = (ctx: Ctx, storeys: number) => Math.max(storeys * Math.round(ctx.c * 1.6), richDoorHeight(ctx.kit) + 8);

/** Front wall, side wall and eaves shading for a plain box building. */
function walls(ctx: Ctx, L: Layout, kind: WallKind, m: Material, o: { frame?: boolean; wearIt?: boolean } = {}) {
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
function pitched(ctx: Ctx, L: Layout, shape: "gable" | "hip" | "gambrel", roofMat: Material, cover: Cover): Span {
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
  P.shade(L.PAD, yb, L.fw + L.sw, 2, -2);
  P.shade(L.PAD, yb + 2, L.fw + L.sw, 2, -1);
  return span;
}

function dormer(ctx: Ctx, _L: Layout, cx: number, baseY: number, cover: Cover, roofMat: Material) {
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
function windowRow(ctx: Ctx, spans: [number, number][], y: number, ww: number, wh: number, o: { shutters?: Material; flower?: boolean; lit?: boolean; max?: number } = {}) {
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

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
interface HouseOpts {
  shape: "gable" | "hip" | "gambrel";
  kind: WallKind; wallMat: Material;
  frame?: boolean; shutters?: Material;
  awning?: boolean; sign?: boolean; porch?: boolean; dormer?: boolean; hayloft?: boolean;
  doubleDoor?: boolean; run?: boolean; lower?: { kind: WallKind; mat: Material; h: number }; balcony?: boolean;
  rhK?: number; pane?: boolean; stringCourse?: boolean;
}

function house(ctx: Ctx, fp: Footprint, o: HouseOpts, paintOnly: { W?: number } = {}): { L: Layout; P: Painter } {
  void paintOnly;
  const { t } = ctx;
  const wallH = wallHeight(ctx, fp.storeys);
  const rh = Math.round(t * fp.d * (o.rhK ?? 0.9));
  const extra = ctx.chimney && o.shape !== "gambrel" && !o.run ? Math.round(t * 0.3) : 0;
  const L = layout(ctx, fp, wallH, rh, extra);
  ctx.P = new Painter(L.W, L.H, ctx.kit) as Painter;
  return { L, P: ctx.P };
}

function paintHouse(ctx: Ctx, L: Layout, fp: Footprint, o: HouseOpts) {
  const { P, t } = ctx;
  const { PAD, fw, sw, baseY, wy, dx, dw, dh, fh } = L;
  // walls (lower masonry band for half-brick)
  if (o.lower) {
    const lh = o.lower.h;
    walls(ctx, L, o.kind, o.wallMat, { frame: o.frame });
    wallFace(ctx, o.lower.kind, o.lower.mat, PAD, baseY - lh, fw, lh, flat([0, 0.1, 1]));
    wallFace(ctx, o.lower.kind, o.lower.mat, PAD + fw, baseY - lh, sw, lh, flat([1, 0.05, 0.3]), 1);
    P.shade(PAD + fw, baseY - lh, sw, lh, -1, o.lower.mat);
    foundation(ctx, PAD - 1, baseY, fw + 2, fh, flat([0, 0, 1]));
    paintTex(ctx, texture("stone", sw + 1, fh, ctx.ts, ctx.seed + 78), "stone", PAD + fw + 1, baseY - fh, flat([1, 0, 0.3]));
    P.shade(PAD + fw + 1, baseY - fh, sw, fh, -1, "stone");
    P.box(PAD, baseY - lh - 2, fw + sw, 2, ctx.trim, [0, -0.5, 0.9]);
    P.shade(PAD, baseY - lh, fw + sw, 2, -1, o.lower.mat);
  } else walls(ctx, L, o.kind, o.wallMat, { frame: o.frame });
  if (o.stringCourse && fp.storeys > 1) {
    const y = baseY - L.storey;
    P.box(PAD, y - 1, fw + sw, 2, ctx.trim, [0, -0.5, 0.9]);
    P.shade(PAD, y + 1, fw + sw, 2, -1, o.wallMat);
  }

  // windows
  const ww = Math.round(t * 0.75), wh = Math.round(ww * 1.3);
  const lowY = baseY - dh + 3;
  const dEdge = o.doubleDoor ? Math.round((dw * 2.2 - dw) / 2) : 0;
  const free: [number, number][] = [[PAD + 3, dx - dEdge - 3], [dx + dw + dEdge + 3, PAD + fw - 3]];
  {
    if (o.lower) windowRow(ctx, free, baseY - o.lower.h + Math.round(o.lower.h * 0.25), Math.round(ww * 0.85), Math.round(wh * 0.8), { shutters: o.shutters, max: 2 });
    else windowRow(ctx, free, lowY, ww, wh, { shutters: o.shutters, flower: o.shutters && ctx.flower, max: 2 });
  }
  for (let s = 1; s < fp.storeys; s++) {
    const top = baseY - (s + 1) * L.storey;
    const y = (s === fp.storeys - 1 ? wy : top) + Math.round(L.storey * 0.3) + (s === fp.storeys - 1 ? 0 : 0);
    const spans: [number, number][] = [[PAD + 3, PAD + fw - 3]];
    windowRow(ctx, spans, y, o.lower ? Math.round(ww * 0.85) : ww, o.lower ? Math.round(wh * 0.85) : wh, { shutters: o.shutters, max: 4 });
  }
  if (o.hayloft) {
    const w2 = Math.round(t * 0.8), h2 = Math.round(t * 0.9);
    const hx = Math.round(PAD + fw / 2 - w2 / 2), hy = wy - Math.round(L.rh * 0.0) + 5;
    void hx; void hy; void w2; void h2;
  }

  if (o.doubleDoor) {
    const bw = Math.round(dw * 2.2), bx = dx - dEdge;
    door(ctx, bx, baseY, bw, dh, { double: true });
    for (const [a, b] of [[bx, bx + (bw >> 1)], [bx + (bw >> 1), bx + bw]]) { P.line(a + 1, baseY - dh + 2, b - 2, baseY - 3, ctx.trim, 1); P.line(b - 2, baseY - dh + 2, a + 1, baseY - 3, ctx.trim, 1); }
  } else door(ctx, dx, baseY, dw, dh, { pane: o.pane });
  if (o.doubleDoor) {
    // X braces on a wide barn door are handled by the door texture; add a lantern-ish latch
    P.rect(dx + 1, baseY - dh + 1, dw - 2, 1, ctx.trim, 1);
  }

  // roof
  const cover = ctx.cover;
  const span = pitched(ctx, L, o.shape, ctx.roof, cover);

  if (o.dormer) dormer(ctx, L, dx + dw / 2, wy + L.eh - Math.round(L.rh * 0.1), cover, ctx.roof);

  if (ctx.chimney && !o.run && o.shape !== "gambrel") {
    const cw = Math.max(6, Math.round(t * 0.55));
    const cx = Math.round(PAD + fw * 0.72);
    const bottom = L.ridgeY + Math.round(L.rh * 0.62);
    chimneyAt(ctx, cx, 6, bottom, cw);
    void span;
  }

  if (o.awning) {
    const ay = baseY - dh - Math.round(t * 0.35);
    const ah = Math.round(t * 0.5);
    for (let x = PAD - 1; x < PAD + fw + 1; x++) {
      const stripe = ((x - PAD) >> 2) % 2;
      const m: Material = stripe ? "cloth2" : "ui";
      for (let y = 0; y < ah; y++) {
        const scallop = y === ah - 1 && ((x - PAD) % 4 === 0 || (x - PAD) % 4 === 3) ? 0 : 1;
        if (scallop) P.box(x, ay + y, 1, 1, m, [0, -0.5 + y / ah, 0.8 - y / (ah * 3)], { tone: y === ah - 1 ? -1 : 0 });
      }
    }
    P.shade(PAD, ay + ah, fw, 3, -2);
  }
  if (o.sign) {
    const sw2 = Math.round(t * 1.1), sh2 = Math.round(t * 0.45);
    const sx = Math.round(PAD + fw / 2 - sw2 / 2), sy = baseY - dh - Math.round(t * 0.35) - sh2 - 3;
    P.box(sx, sy, sw2, sh2, "wood", [0, -0.2, 1], { tone: 0 });
    P.box(sx, sy, sw2, 1, "wood", [0, -0.8, 0.6], { tone: 1 });
    P.box(sx, sy + sh2 - 1, sw2, 1, "wood", [0, 0.6, 0.8], { tone: -2 });
    for (let i = 0; i < Math.floor((sw2 - 4) / 2); i++) P.px(sx + 2 + i * 2, sy + (sh2 >> 1), "gold", 3 + (i % 2));
    P.rect(sx + 1, sy - 2, 1, 2, "metal", 2);
    P.rect(sx + sw2 - 2, sy - 2, 1, 2, "metal", 2);
  }
  if (o.porch) {
    const pw = Math.round(t * 1.6);
    const px0 = Math.round(dx + dw / 2 - pw / 2), py = baseY - dh - Math.round(t * 0.5);
    const ph = Math.round(t * 0.4);
    P.box(px0, py, pw, ph, ctx.roof === "sand" ? "wood" : ctx.roof, [0, -0.5, 0.85]);
    P.box(px0 - 1, py + ph - 1, pw + 2, 1, ctx.roof, [0, 0.4, 0.9], { tone: -2 });
    P.box(px0, py, pw, 1, ctx.roof, [0, -1, 0.35], { tone: 1 });
    for (let x = px0 + 2; x < px0 + pw; x += 4) P.box(x, py + 1, 1, ph - 2, ctx.roof, [0, 0, 1], { tone: -1 });
    for (const x of [px0 + 1, px0 + pw - 3]) P.cylinder(x, py + ph, 2, baseY - py - ph, ctx.trim);
    P.shade(px0, py + ph, pw, 3, -2);
    P.box(px0 + 1, baseY - Math.round(t * 0.55), pw - 2, 1, ctx.trim, [0, -0.7, 0.7], { tone: 1 });
    for (let x = px0 + 3; x < px0 + pw - 3; x += 3) if (x < dx - 3 || x > dx + dw + 2) P.box(x, baseY - Math.round(t * 0.55) + 1, 1, Math.round(t * 0.45), ctx.trim, [0, 0, 1], { tone: -1 });
  }
  if (o.balcony) {
    const bw = Math.round(t * 2.2), bx = Math.round(dx + dw / 2 - bw / 2);
    const by = baseY - (o.lower?.h ?? L.storey);
    P.box(bx, by - 2, bw, 3, ctx.trim, [0, -0.5, 0.9]);
    P.shade(bx, by + 1, bw, 3, -2);
    const rl = Math.round(t * 0.5);
    P.box(bx, by - 2 - rl, bw, 1, ctx.trim, [0, -0.8, 0.6], { tone: 1 });
    for (let x = bx + 1; x < bx + bw - 1; x += 3) P.box(x, by - 1 - rl, 1, rl - 1, ctx.trim, [0, 0, 1], { tone: -1 });
    for (const x of [bx, bx + bw - 2]) P.box(x, by - 2 - rl, 2, rl + 5, ctx.trim, [x === bx ? -0.4 : 0.4, 0, 1]);
  }
  if (o.run) {
    // fenced run in front of the left wall: posts, two rails and trampled dirt
    const fh2 = Math.round(t * 0.7), x1 = dx - 3, x0 = PAD;
    P.box(x0, baseY - 2, x1 - x0, 3, "dirt", [0, -0.5, 0.8], { tone: -1 });
    for (const yy of [baseY - fh2, baseY - Math.round(fh2 * 0.45)]) P.box(x0, yy, x1 - x0, 1, ctx.trim, [0, -0.6, 0.8], { tone: yy === baseY - fh2 ? 1 : 0 });
    for (let x = x0; x <= x1 - 2; x += Math.max(6, Math.round(t * 0.5))) P.box(x, baseY - fh2 - 1, 2, fh2 + 2, ctx.trim, [x === x0 ? -0.4 : 0.1, 0, 1]);
    P.box(x1 - 2, baseY - fh2 - 1, 2, fh2 + 2, ctx.trim, [0.4, 0, 1]);
  }
}

function render(ctx: Ctx, fp: Footprint, o: HouseOpts) {
  const { L } = house(ctx, fp, o);
  paintHouse(ctx, L, fp, o);
  return L;
}

// --- tower: round stone shaft, corbel ring, conical roof -----------------------------------
function tower(ctx: Ctx, fp: Footprint): Layout {
  const { t, c } = ctx;
  const wallH = wallHeight(ctx, fp.storeys);
  const rh = Math.round(t * fp.d * 1.05);
  const L = layout(ctx, fp, wallH, rh, 4, { sideless: true });
  const P = (ctx.P = new Painter(L.W, L.H, ctx.kit));
  const bw = fp.w * t - 8, bx = 4, cx = bx + bw / 2;
  const nf: NF = (x) => {
    const u = clamp((x + 0.5 - cx) / (bw / 2), -1, 1);
    return [u * 0.95, 0.05, Math.sqrt(Math.max(0, 1 - u * u)) + 0.15];
  };
  paintTex(ctx, texture(ctx.wallKind, bw, L.wallH, ctx.ts, ctx.seed), ctx.wall, bx, L.wy, nf, 1);
  foundation(ctx, bx - 1, L.baseY, bw + 2, L.fh, nf);
  // storey bands
  for (let s = 1; s < fp.storeys; s++) {
    const y = L.baseY - s * L.storey;
    P.box(bx - 1, y - 1, bw + 2, 2, ctx.wall, [0, -0.6, 0.8], { tone: 1 });
    P.shade(bx, y + 1, bw, 2, -2, ctx.wall);
  }
  // arrow slit windows on the lit front
  for (let s = 0; s < fp.storeys; s++) {
    const y = L.baseY - (s + 1) * L.storey + Math.round(L.storey * 0.32);
    if (s === 0) continue;
    const w2 = Math.max(3, Math.round(t * 0.35)), h2 = Math.round(t * 0.9);
    const x = Math.round(cx - w2 / 2);
    P.box(x - 1, y - 1, w2 + 2, h2 + 2, "stone", [0, -0.3, 1], { tone: 1 });
    glass(ctx, x, y, w2, h2, ctx.lit);
  }
  // corbel ring under the roof, then the cone
  const ring = Math.max(2, Math.round(t * 0.22));
  P.box(bx - 2, L.wy, bw + 4, ring, ctx.wall, [0, -0.6, 0.8], { tone: 1 });
  P.box(bx - 2, L.wy + ring - 1, bw + 4, 1, ctx.wall, [0, 0.6, 0.8], { tone: -2 });
  P.shade(bx, L.wy + ring, bw, 3, -2, ctx.wall);
  const dwT = L.dw, dhT = L.dh;
  door(ctx, Math.round(cx - dwT / 2), L.baseY, dwT, dhT, { stone: true });
  // cone
  const apex = L.ridgeY, yb = L.wy + L.eh, half = bw / 2 + 2;
  const span: Span = (y) => (y < apex || y >= yb ? null : [cx - Math.max(0.6, ((y + 0.5 - apex) / (yb - apex)) * half), cx + Math.max(0.6, ((y + 0.5 - apex) / (yb - apex)) * half)]);
  const coneNf: NF = (x) => {
    const u = clamp((x + 0.5 - cx) / half, -1, 1);
    return [u * 0.95, -0.45, Math.sqrt(Math.max(0, 1 - u * u)) * 0.7 + 0.35];
  };
  paintRoof(ctx, ctx.cover, ctx.roof, span, apex, yb, coneNf);
  P.shade(bx, yb, bw, 2, -2);
  P.px(Math.round(cx), apex - 1, "gold", 4);
  P.px(Math.round(cx), apex - 2, "gold", 3);
  void c;
  return L;
}

// --- keep: crenellated stone block with corner turrets ---------------------------------------
function keep(ctx: Ctx, fp: Footprint): Layout {
  const { t } = ctx;
  const wallH = wallHeight(ctx, fp.storeys);
  const rh = Math.round(t * fp.d * 0.5);
  const turretUp = Math.round(t * 0.9);
  const L = layout(ctx, fp, wallH, rh + turretUp, 0);
  const P = (ctx.P = new Painter(L.W, L.H, ctx.kit));
  const { PAD, fw, sw, baseY, fh } = L;
  const topY = L.wy + L.eh - rh; // far parapet line
  const kind = ctx.wallKind;
  // roof plane (walkway seen from above), far parapet, then the front wall
  paintTex(ctx, texture("stone", fw + sw, rh - 4, ctx.ts, ctx.seed + 4), "stone", PAD, topY + 3, flat([0, -0.9, 0.45]));
  P.shade(PAD, topY + 3, fw + sw, rh - 4, 1, "stone");
  const mer = Math.max(4, Math.round(t * 0.4)), gap = Math.max(2, Math.round(t * 0.2));
  const crenel = (y: number, h: number, x0: number, x1: number, n: Vec3, tone: number) => {
    for (let x = x0; x < x1; x += mer + gap) P.box(x, y, Math.min(mer, x1 - x), h, ctx.wall, n, { tone });
  };
  P.box(PAD, topY, fw + sw, 4, ctx.wall, [0, -0.2, 1], { tone: -1 });
  crenel(topY - 3, 3, PAD + 1, PAD + fw + sw - 1, [0, -0.3, 1], -1);
  // front wall
  walls(ctx, L, kind, ctx.wall, { wearIt: true });
  const my = L.wy + L.eh - 2;
  P.box(PAD - 1, my, fw + sw + 2, 3, ctx.wall, [0, -0.7, 0.7], { tone: 1 });
  P.shade(PAD, my + 3, fw + sw, 3, -2, ctx.wall);
  crenel(my - 4, 4, PAD - 1, PAD + fw + sw, [0, -0.1, 1], 0);
  for (let x = PAD - 1; x < PAD + fw + sw; x += mer + gap) P.box(x, my - 4, 1, 4, ctx.wall, [-0.6, 0, 1], { tone: 1 });
  // storey band + windows
  const ww = Math.round(t * 0.5), wh = Math.round(t * 1.1);
  const free: [number, number][] = [[PAD + 6, L.dx - 4], [L.dx + L.dw + 4, PAD + fw - 6]];
  for (let s = 0; s < fp.storeys; s++) {
    const y = s === 0 ? baseY - L.dh + 4 : baseY - L.storey - Math.round(L.storey * 0.62);
    if (s === 0) windowRowSlits(ctx, free, y, ww, wh);
    else windowRowSlits(ctx, [[PAD + 6, PAD + fw - 6]], y, ww, wh);
  }
  P.box(PAD, baseY - L.storey, fw + sw, 2, ctx.wall, [0, -0.5, 0.9], { tone: 1 });
  door(ctx, L.dx, baseY, L.dw, L.dh, { stone: true, double: true });
  // turrets
  const tw = Math.round(t * 1.5);
  for (const tx of [L.ex0 + 2, L.ex1 - 2 - tw]) {
    const th = wallH + turretUp;
    const ty = baseY - th;
    const cx = tx + tw / 2;
    const nf: NF = (x) => {
      const u = clamp((x + 0.5 - cx) / (tw / 2), -1, 1);
      return [u * 0.95, 0.05, Math.sqrt(Math.max(0, 1 - u * u)) + 0.15];
    };
    paintTex(ctx, texture("stone", tw, th, ctx.ts, ctx.seed + tx), ctx.wall, tx, ty, nf, 1);
    foundation(ctx, tx - 1, baseY, tw + 2, fh, nf);
    P.box(tx - 1, ty + 2, tw + 2, 3, ctx.wall, [0, -0.7, 0.7], { tone: 1 });
    P.shade(tx, ty + 5, tw, 3, -2, ctx.wall);
    for (let x = tx - 1; x < tx + tw + 1; x += mer + 1) P.box(x, ty - 3, Math.min(mer - 1, tx + tw + 1 - x), 5, ctx.wall, nf(x, 0), { tone: 0 });
    const sx = Math.round(cx - 1);
    P.rect(sx, ty + 10, 2, Math.round(t * 0.7), "ink", 1);
    P.rect(sx, ty + 10, 1, 1, "gold", ctx.lit ? 3 : 1);
  }
  // roofed banner
  P.rect(Math.round(PAD + (fw + sw) / 2), topY - 9, 1, 9, "metal", 3);
  P.box(Math.round(PAD + (fw + sw) / 2) + 1, topY - 9, 5, 3, "cloth2", [0.2, -0.3, 1]);
  return L;
}

function windowRowSlits(ctx: Ctx, spans: [number, number][], y: number, w: number, h: number) {
  const { P } = ctx;
  for (const [a, b] of spans) {
    if (b - a < w + 4) continue;
    const n = clamp(Math.floor((b - a) / (w * 4)), 1, 3);
    for (let i = 0; i < n; i++) {
      const x = Math.round(a + ((i + 0.5) * (b - a)) / n - w / 2);
      P.box(x - 1, y - 1, w + 2, h + 2, "stone", [0, -0.3, 1], { tone: 1 });
      P.box(x - 1, y - 1, w + 2, 1, "stone", [0, -0.8, 0.6], { tone: 2 });
      glass(ctx, x, y, w, h, ctx.lit);
    }
  }
}

// --- stilt house -------------------------------------------------------------------------
function stilt(ctx: Ctx, fp: Footprint): Layout {
  const { t, c, r } = ctx;
  const gh = Math.round(c * 1.3); // clear height under the deck: one door tall
  const deck = Math.max(3, Math.round(t * 0.22));
  const cabinH = wallHeight(ctx, 1);
  const rh = Math.round(t * fp.d * 0.6);
  const base = layout(ctx, { ...fp, w: fp.w }, cabinH, rh, 0, { sideless: false });
  const extra = gh + deck;
  const H = base.H + extra;
  const L: Layout = { ...base, H, baseY: base.baseY + extra, gb: base.gb };
  const P = (ctx.P = new Painter(L.W, H, ctx.kit));
  const G = L.baseY + 1; // ground, 1 below cabin floor + stilts
  const yDeck = L.baseY + deck - deck; // cabin floor y
  void yDeck;
  const cabW = Math.round(L.wt * 0.62), cabFw = cabW - L.sw;
  const left = r.chance(0.5);
  const x0 = L.PAD, x1 = L.PAD + L.wt;
  const cabX = left ? x1 - cabW - 1 : x0 + 1;
  const floorY = L.baseY - gh - deck + extra - extra + 0; // top of the deck
  void floorY;
  const deckTop = L.baseY - gh; // cabin bottom edge
  void G;
  // posts
  const np = 4;
  for (let i = 0; i < np; i++) {
    const x = Math.round(x0 + 2 + (i * (L.wt - 8)) / (np - 1));
    P.cylinder(x, deckTop + deck, 3, gh - deck + 1, ctx.trim, { tone: i % 2 ? -1 : 0 });
    P.cylinder(x - 1, L.baseY - 1, 5, 3, "stone", { flat: 0.3 });
  }
  P.line(x0 + 4, deckTop + deck + 2, x0 + Math.round(L.wt / 3) , L.baseY - 4, ctx.trim, 1);
  P.line(x0 + Math.round(L.wt / 3), deckTop + deck + 2, x0 + 4, L.baseY - 4, ctx.trim, 1);
  P.shade(x0, deckTop + deck, L.wt, 3, -2, ctx.trim);
  // deck slab, lit top edge, plank joints
  P.box(x0 - 1, deckTop, L.wt + 2, deck, ctx.trim, [0, -0.5, 0.9]);
  P.box(x0 - 1, deckTop, L.wt + 2, 1, ctx.trim, [0, -1, 0.5], { tone: 1 });
  for (let x = x0 + 3; x < x1 - 2; x += 5) P.px(x, deckTop + deck - 1, ctx.trim, 1);
  // cabin
  const cL: Layout = { ...L, PAD: cabX, fw: cabFw, wy: deckTop - cabinH, baseY: deckTop, wallH: cabinH, fh: 0 };
  const wy = deckTop - cabinH;
  wallFace(ctx, ctx.wallKind, ctx.wall, cabX, wy, cabFw, cabinH, flat([0, 0.1, 1]));
  wallFace(ctx, ctx.wallKind, ctx.wall, cabX + cabFw, wy, L.sw, cabinH, flat([1, 0.05, 0.3]), 1);
  P.shade(cabX + cabFw, wy, L.sw, cabinH, -1, ctx.wall);
  P.box(cabX, wy, 2, cabinH, ctx.trim, [-0.5, 0, 1]);
  P.box(cabX + cabFw - 2, wy, 2, cabinH, ctx.trim, [0.4, 0, 1]);
  const dw = L.dw, dh = Math.min(L.dh, cabinH - 6);
  const dxx = left ? cabX + cabFw - dw - 4 : cabX + 4;
  door(ctx, dxx, deckTop, dw, dh, {});
  const ww = Math.round(t * 0.7), wh = Math.round(ww * 1.25);
  const spans: [number, number][] = left ? [[cabX + 3, dxx - 3]] : [[dxx + dw + 3, cabX + cabFw - 3]];
  windowRow(ctx, spans, wy + Math.round(cabinH * 0.3), ww, wh, { shutters: ctx.trim, max: 1 });
  // roof over the cabin
  const rl = cabX - L.over, rr = cabX + cabW + L.over;
  const roofL: Layout = { ...L, ex0: rl, ex1: rr, wy, eh: L.eh, PAD: cabX, fw: cabFw, sw: L.sw, wt: cabW };
  pitched(ctx, roofL, "gable", ctx.roof, ctx.cover);
  // veranda rail on the open deck + stairs on the outer end
  const vx0 = left ? x0 : cabX + cabW, vx1 = left ? cabX : x1;
  const rail = Math.round(t * 0.55);
  const sx = left ? x0 : x1;
  const stairs = left ? -1 : 1;
  const stairRun = Math.round(gh * 0.9);
  const ra = left ? vx0 + 3 + 0 : vx0, rb = left ? vx1 : vx1 - 3;
  void sx;
  if (rb - ra > 6) {
    P.box(ra, deckTop - rail, rb - ra, 2, ctx.trim, [0, -0.8, 0.6], { tone: 1 });
    for (let x = ra + 1; x < rb - 1; x += 3) P.box(x, deckTop - rail + 2, 1, rail - 2, ctx.trim, [0, 0, 1], { tone: -1 });
    P.box(ra, deckTop - rail, 2, rail, ctx.trim, [-0.4, 0, 1]);
    P.box(rb - 2, deckTop - rail, 2, rail, ctx.trim, [0.4, 0, 1]);
  }
  void stairs; void stairRun; void cL;
  // stairs descend outward from the veranda: two stringers, treads, and a handrail parallel to the slope
  const inner = left ? vx1 - 3 : vx0 + 3, outer = left ? x0 + 1 : x1 - 1;
  const yTop = deckTop + deck, yBot = L.baseY - 1;
  for (let k = 0; k < 2; k++) P.line(inner, yTop + k, outer, yBot - 2 + k, ctx.trim, 1);
  const n = Math.max(5, Math.round(gh / 4));
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n;
    const xi = Math.round(inner + (outer - inner) * f), yi = Math.round(yTop + (yBot - 2 - yTop) * f);
    P.rect(xi - 2, yi, 5, 1, ctx.trim, 4);
    P.rect(xi - 2, yi + 1, 5, 1, ctx.trim, 2);
  }
  P.line(inner, deckTop - rail, outer, yBot - rail - 2, ctx.trim, 3);
  P.box(outer - 1, yBot - rail - 2, 2, rail + 2, ctx.trim, [left ? -0.4 : 0.4, 0, 1], { tone: -1 });
  return L;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------
function coverFor(style: string, roof: Material, rs: string): Cover {
  if (rs === "corrugated") return "tin";
  if (roof === "metal") return "tin";
  if (roof === "sand" || roof === "foliage") return "thatch";
  if (roof === "stone") return "slate";
  if (roof === "roof") return style === "shop" || style === "keep" || style === "tower" || style === "half-brick" ? "tile" : "shingle";
  return "shingle";
}

/** Render one rich building sprite (finalized, outlined, bottom-centred in its footprint-wide canvas). */
export function renderRichBuilding(style: string, p: Params, kit: StyleKit, seed: number, fp: Footprint): Sprite {
  const r = rng(seed);
  CALM = kit.shadeSteps <= 3;
  const flip = kit.lightDir === "top-right";
  const pk: StyleKit = flip ? { ...kit, lightDir: "top-left" } : kit;
  let wall = mat(p, "wall"), roof = mat(p, "roof");
  const trim = mat(p, "trim");
  const rs = str(p, "roof_style");
  const wallDef = wall === "wood", roofDef = roof === "roof";
  let kind: WallKind = "plank";
  const byMat = (m: Material, wood: WallKind): WallKind =>
    m === "stone" ? "stone" : m === "sand" || m === "cloth2" || m === "ui" ? "plaster" : m === "dirt" ? "brick" : m === "metal" ? "tin" : m === "wood" || m === "leather" ? wood : "plaster";
  let roofMat = roof;
  switch (style) {
    case "cottage": kind = byMat(wall, "log"); break;
    case "farmhouse": kind = byMat(wall, "plank"); break;
    case "shop": if (wallDef) { wall = "sand"; } kind = byMat(wall, "plank"); break;
    case "barn": if (wallDef) wall = "roof"; kind = wall === "roof" ? "batten" : byMat(wall, "batten"); if (roofDef) roofMat = "metal"; break;
    case "coop": kind = byMat(wall, "plank"); break;
    case "tower": case "keep": if (wallDef) wall = "stone"; kind = byMat(wall, "plank"); break;
    case "stilt-house": kind = byMat(wall, "plank"); if (roofDef && (rs === "auto" || rs === "corrugated")) roofMat = "metal"; break;
    case "half-brick": kind = byMat(wall, "plank"); if (roofDef) roofMat = "metal"; break;
    default: kind = byMat(wall, "plank");
  }
  roof = roofMat;
  const ctx: Ctx = {
    P: undefined as unknown as Painter, kit: pk, seed, r,
    t: kit.sizes.tile, c: kit.sizes.character, ts: (1 + kit.sizes.tile / 16) / 2,
    pr: proportions(kit), wall, roof, trim,
    lit: bool(p, "lit_windows"), chimney: bool(p, "chimney"), flower: bool(p, "flower_box"),
    cover: coverFor(style, roof, rs), wallKind: kind,
  };
  let hipWanted: "gable" | "hip" = rs === "hip" ? "hip" : "gable";
  let L: Layout;
  switch (style) {
    case "tower": L = tower(ctx, fp); break;
    case "keep": ctx.wallKind = "stone"; L = keep(ctx, fp); break;
    case "stilt-house": L = stilt(ctx, fp); break;
    case "shop": L = render(ctx, fp, { shape: hipWanted, kind, wallMat: wall, frame: wall === "sand", awning: true, sign: true, pane: true }); break;
    case "farmhouse": L = render(ctx, fp, { shape: hipWanted, kind, wallMat: wall, shutters: "foliage", porch: true, dormer: fp.d >= 4, stringCourse: true, pane: true, rhK: 0.85 }); break;
    case "barn": L = render(ctx, fp, { shape: "gambrel", kind, wallMat: wall, doubleDoor: true, hayloft: true, rhK: 0.95 }); break;
    case "coop": L = render(ctx, fp, { shape: hipWanted, kind, wallMat: wall, run: true, rhK: 0.85 }); break;
    case "half-brick": L = render(ctx, fp, { shape: hipWanted, kind, wallMat: wall, lower: { kind: "brick", mat: "roof", h: Math.round(ctx.c * 1.0) }, balcony: true, stringCourse: false, shutters: trim, pane: true }); break;
    default: L = render(ctx, fp, { shape: hipWanted, kind, wallMat: wall, shutters: "foliage", pane: true });
  }
  let s = ctx.P.toSprite();
  if (flip) s = flipX(s);
  s = finalize(s, kit);
  const x0 = L.PAD - 1, x1 = L.PAD + L.wt + 1;
  groundShadow(s, flip ? s.w - x1 : x0, flip ? s.w - x0 : x1, L.baseY + 2, Math.max(2, L.gb - 3), flip ? -1 : 1);
  void createSprite;
  return s;
}

export function richBuildingResult(p: Params, kit: StyleKit, seed: number): GenResult {
  const style = str(p, "style");
  const fp = buildingFootprint(style, str(p, "size"), kit);
  return { rows: [{ name: "idle", frames: [renderRichBuilding(style, p, kit, seed, fp)] }], fps: 1 };
}

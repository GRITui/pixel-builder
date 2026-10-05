import { Painter } from "../painter";
import type { Material } from "../palette";
import type { Footprint } from "../footprint";
import {
  chimneyAt, clamp, door, dormer, flat, foundation, glass, jit, layout, paintRoof, paintTex, pitched, richDoorHeight, texture, wallFace, wallHeight, walls, win, windowRow,
  type Ctx, type Layout, type NF, type Span, type WallKind,
} from "./building-rich";
import { boardSize, chofa, ivy, lanterns, signBoard, stripedCloth, wearOverlay, yardProps } from "./building-rich-addons";

type Vec3 = [number, number, number];

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
export interface HouseOpts {
  shape: "gable" | "hip" | "gambrel";
  kind: WallKind; wallMat: Material;
  frame?: boolean; shutters?: Material;
  dormers?: number; doubleDoor?: boolean; run?: boolean;
  lower?: { kind: WallKind; mat: Material; h: number };
  rhK?: number; pane?: boolean; stringCourse?: boolean;
  /** door centre as a fraction of the front wall (default: footprint door tile) */
  doorAt?: number;
}

/** Awning cloth height for a kit. */
const awningH = (ctx: Ctx) => Math.max(4, Math.round(ctx.t * 0.38));
const hasChimney = (ctx: Ctx, o: HouseOpts) => ctx.chimney && !o.run && o.shape !== "gambrel";
/** Headroom above a chimney for smoke puffs. */
export const smokeRoom = (ctx: Ctx) => Math.round(ctx.t * 1.3);

export function house(ctx: Ctx, fp: Footprint, o: HouseOpts): { L: Layout; P: Painter } {
  const { t } = ctx;
  let wallH = wallHeight(ctx, fp.storeys);
  const dh = richDoorHeight(ctx.kit);
  if (fp.storeys === 1) {
    // facade bands that sit above the door need room: awning, sign board, porch hood
    let need = dh;
    if (ctx.o.awning) need += Math.round(t * 0.3) + 2;
    if (ctx.o.sign) need += boardSize(ctx, ctx.o.sign).h + (ctx.o.awning ? 1 : 5);
    else if (ctx.o.porch) need += Math.max(2, Math.round(t * 0.12)) + 2;
    wallH = Math.max(wallH, need + (ctx.o.sign || ctx.o.awning ? 4 : 0));
  }
  const rh = Math.round(t * fp.d * (o.rhK ?? 0.9));
  const horn = ctx.o.gable === "thai" ? Math.round(t * 0.7) : 0;
  const extra = Math.max(horn, hasChimney(ctx, o) ? Math.round(t * 0.3) + smokeRoom(ctx) : 0);
  const L = layout(ctx, fp, wallH, rh, extra);
  if (o.doorAt !== undefined) L.dx = clamp(Math.round(L.PAD + L.fw * o.doorAt - L.dw / 2), L.PAD + 3, L.PAD + L.fw - L.dw - 3);
  ctx.P = new Painter(L.W, L.H, ctx.kit);
  return { L, P: ctx.P };
}

/** Balcony over the entrance: slab, balusters, posts and a glazed door behind it. */
export function balcony(ctx: Ctx, L: Layout, cx: number, by: number, wide: number) {
  const { P, t, trim } = ctx;
  const bw = Math.round(t * wide), bx = Math.round(cx - bw / 2);
  const rl = Math.round(t * 0.5);
  const fh = Math.round(L.storey * 0.62), fw = Math.max(8, L.dw);
  win(ctx, Math.round(cx - fw / 2), by - 3 - fh, fw, fh, { lit: ctx.lit });
  P.box(bx, by - 2, bw, 3, trim, [0, -0.5, 0.9]);
  P.box(bx, by - 2, bw, 1, trim, [0, -0.9, 0.5], { tone: 1 });
  P.shade(bx, by + 1, bw, Math.max(3, Math.round(t * 0.14)), -2);
  P.box(bx, by - 2 - rl, bw, 1, trim, [0, -0.8, 0.6], { tone: 1 });
  for (let x = bx + 2; x < bx + bw - 2; x += 3) P.box(x, by - 1 - rl, 1, rl - 1, trim, [0, 0, 1], { tone: -1 });
  for (const x of [bx, bx + bw - 2]) P.box(x, by - 2 - rl, 2, rl + 5, trim, [x === bx ? -0.4 : 0.4, 0, 1]);
}

/** Lean-to hood on two posts over the door. */
function porchHood(ctx: Ctx, L: Layout) {
  const { P, t, trim } = ctx;
  const { dx, dw, dh, baseY } = L;
  const pw = Math.round(dw + t * 1.0), ph = Math.max(5, Math.round(t * 0.28));
  const px0 = Math.round(dx + dw / 2 - pw / 2), py = baseY - dh - 1 - ph;
  const m: Material = ctx.roof === "sand" ? "wood" : ctx.roof;
  P.box(px0, py, pw, ph, m, [0, -0.5, 0.85]);
  P.box(px0 - 1, py + ph - 1, pw + 2, 1, m, [0, 0.4, 0.9], { tone: -2 });
  P.box(px0, py, pw, 1, m, [0, -1, 0.35], { tone: 1 });
  for (let x = px0 + 2; x < px0 + pw; x += 4) P.box(x, py + 1, 1, ph - 2, m, [0, 0, 1], { tone: -1 });
  for (const x of [px0 + 1, px0 + pw - 3]) P.cylinder(x, py + ph, 2, baseY - py - ph, trim);
  P.shade(px0, py + ph, pw, 3, -2);
  const ry = baseY - Math.round(t * 0.5);
  P.box(px0 + 1, ry, pw - 2, 1, trim, [0, -0.7, 0.7], { tone: 1 });
  for (let x = px0 + 3; x < px0 + pw - 3; x += 3) if (x < dx - 3 || x > dx + dw + 2) P.box(x, ry + 1, 1, Math.round(t * 0.45), trim, [0, 0, 1], { tone: -1 });
}

export function paintHouse(ctx: Ctx, L: Layout, fp: Footprint, o: HouseOpts) {
  const { P, t } = ctx;
  const { PAD, fw, sw, baseY, wy, dx, dw, dh, fh } = L;
  const ad = ctx.o;
  // walls (lower masonry band for half-brick)
  walls(ctx, L, o.kind, o.wallMat, { frame: o.frame });
  if (o.lower) {
    const lh = o.lower.h;
    wallFace(ctx, o.lower.kind, o.lower.mat, PAD, baseY - lh, fw, lh, flat([0, 0.1, 1]));
    wallFace(ctx, o.lower.kind, o.lower.mat, PAD + fw, baseY - lh, sw, lh, flat([1, 0.05, 0.3]), 1);
    P.shade(PAD + fw, baseY - lh, sw, lh, -1, o.lower.mat);
    foundation(ctx, PAD - 1, baseY, fw + 2, fh, flat([0, 0, 1]));
    paintTex(ctx, texture("stone", sw + 1, fh, ctx.ts, ctx.seed + 78), "stone", PAD + fw + 1, baseY - fh, flat([1, 0, 0.3]));
    P.shade(PAD + fw + 1, baseY - fh, sw, fh, -1, "stone");
    P.box(PAD, baseY - lh - 2, fw + sw, 2, ctx.trim, [0, -0.5, 0.9]);
    P.shade(PAD, baseY - lh, fw + sw, 2, -1, o.lower.mat);
  }
  if (o.stringCourse && fp.storeys > 1) {
    const y = baseY - L.storey;
    P.box(PAD, y - 1, fw + sw, 2, ctx.trim, [0, -0.5, 0.9]);
    P.shade(PAD, y + 1, fw + sw, 3, -2, o.wallMat);
  }
  if (ad.ivy) ivy(ctx, L);
  if (ad.wear) wearOverlay(ctx, L);

  // windows
  const ww = Math.round(t * 0.75), wh = Math.round(ww * 1.3);
  const lowY = baseY - dh + 3;
  const dEdge = o.doubleDoor ? Math.round((dw * 2.2 - dw) / 2) : 0;
  const free: [number, number][] = o.run ? [[dx + dw + dEdge + 3, PAD + fw - 3]] : [[PAD + 3, dx - dEdge - 3], [dx + dw + dEdge + 3, PAD + fw - 3]];
  const fl = ad.flowerBoxes;
  if (o.lower) windowRow(ctx, free, baseY - o.lower.h + Math.round(o.lower.h * 0.25), Math.round(ww * 0.85), Math.round(wh * 0.8), { shutters: o.shutters, max: 2, flower: fl });
  else windowRow(ctx, free, lowY, ww, wh, { shutters: o.shutters, flower: fl, max: 2 });
  const dcx = dx + dw / 2, clear = ad.sign || ad.balcony || ad.hayloft ? Math.round(t * 1.3) : 0;
  for (let s = 1; s < fp.storeys; s++) {
    const top = baseY - (s + 1) * L.storey;
    const y = (s === fp.storeys - 1 ? wy : top) + Math.round(L.storey * 0.3);
    const spans: [number, number][] = clear ? [[PAD + 3, dcx - clear], [dcx + clear, PAD + fw - 3]] : [[PAD + 3, PAD + fw - 3]];
    windowRow(ctx, spans, y, o.lower ? Math.round(ww * 0.85) : ww, o.lower ? Math.round(wh * 0.85) : wh, { shutters: o.shutters, max: 4, flower: fl });
  }
  if (ad.hayloft && fp.storeys > 1) {
    // hay door on the upper wall
    const hw = Math.round(t * 1.1), hh = Math.round(t * 1.2), hx = Math.round(dcx - hw / 2), hy = wy + Math.round(L.storey * 0.3);
    loftDoor(ctx, hx, hy, hw, hh, false);
  }

  if (o.doubleDoor) {
    const bw = Math.round(dw * 2.2), bx = dx - dEdge;
    door(ctx, bx, baseY, bw, dh, { double: true });
    for (const [a, b] of [[bx, bx + (bw >> 1)], [bx + (bw >> 1), bx + bw]]) { P.line(a + 1, baseY - dh + 2, b - 2, baseY - 3, ctx.trim, 1); P.line(b - 2, baseY - dh + 2, a + 1, baseY - 3, ctx.trim, 1); }
    P.rect(dx + 1, baseY - dh + 1, dw - 2, 1, ctx.trim, 1);
  } else door(ctx, dx, baseY, dw, dh, { pane: o.pane });

  // roof
  const span = pitched(ctx, L, o.shape, ctx.roof, ctx.cover);
  if (ctx.o.gable === "thai") thaiRoofTrim(ctx, L, span);
  const nd = o.dormers ?? 0;
  for (let i = 0; i < nd; i++) {
    const cx = nd === 1 ? dcx : PAD + (fw * (i + 1)) / (nd + 1);
    dormer(ctx, L, cx, wy + L.eh - Math.round(L.rh * 0.1), ctx.cover, ctx.roof);
  }
  if (ad.hayloft && o.shape === "gambrel" && fp.storeys === 1) loftDoor(ctx, Math.round(dcx - t * 0.5), L.ridgeY + Math.round(L.rh * 0.52), Math.round(t * 1.0), Math.round(t * 1.0), true);
  if (hasChimney(ctx, o)) {
    const cw = Math.max(6, Math.round(t * 0.55));
    const cx = Math.round(PAD + fw * 0.72);
    const top = L.ridgeY - 3;
    chimneyAt(ctx, cx, top, L.ridgeY + Math.round(L.rh * 0.62), cw);
    ctx.smokeAt = { x: cx + cw / 2, y: top - 3 };
  }

  if (ad.awning) {
    const ah = awningH(ctx), ay = baseY - dh - Math.round(t * 0.3);
    stripedCloth(ctx, PAD - 1, fw + 2, ay, ah, ad.awningMat, "ui");
    if (ad.sign) signBoard(ctx, PAD + fw / 2, ay - boardSize(ctx, ad.sign).h, ad.sign);
  } else if (ad.sign && !(ad.balcony && fp.storeys > 1)) {
    const bs = boardSize(ctx, ad.sign);
    const ch = fp.storeys > 1 ? 4 : 2;
    const sy = fp.storeys > 1 ? baseY - dh - bs.h - 8 - ch : baseY - dh - bs.h - 3;
    if (fp.storeys > 1) P.rect(Math.round(dcx - bs.w / 2) - 1, sy - ch - 1, bs.w + 2, 1, "metal", 2);
    signBoard(ctx, dcx, sy, ad.sign, { chains: ch });
  }
  if (ad.porch) porchHood(ctx, L);
  if (ad.balcony) balcony(ctx, L, dcx, o.lower ? baseY - o.lower.h : baseY - L.storey, 2.2);
  if (o.run) coopRun(ctx, L);
  if (ad.lanterns) lanterns(ctx, L);
  if (ad.yard) yardProps(ctx, L);
}

/** Hay-loft hatch. On a roof face it gets a little hood and a hoist beam; on a wall it is a plain framed hatch. */
function loftDoor(ctx: Ctx, x: number, y: number, w: number, h: number, onRoof: boolean) {
  const { P, trim } = ctx;
  if (onRoof) {
    P.box(x - 2, y - 4, w + 4, 4, ctx.roof, [0, -0.6, 0.8], { tone: 1 });
    P.shade(x - 2, y, w + 4, 2, -2, ctx.roof);
    P.box(x + w / 2 - 1, y - 9, 2, 5, trim, [0, -0.4, 0.9]); // hoist beam
    P.rect(x + w / 2 - 1, y - 4, 1, 2, "metal", 2);
  }
  P.box(x - 1, y, w + 2, h + 1, trim, [0, -0.3, 1], { tone: -1 });
  P.rect(x, y + 1, w, h - 1, "ink", 1);
  P.rect(x + 1, y + h - Math.max(2, h >> 2), w - 2, Math.max(2, h >> 2), "sand", 3); // hay
  for (let i = 0; i < w - 2; i += 2) P.px(x + 1 + i, y + h - Math.max(2, h >> 2), "sand", 4);
  P.line(x, y + 1, x + w - 1, y + h - 1, trim, 2);
  P.rect(x + (w >> 1), y + 1, 1, h - 1, trim, 1);
}

/** Thai roof trim: gold fascia and chofa horns at the ridge ends and eaves corners. */
export function thaiRoofTrim(ctx: Ctx, L: Layout, span: Span) {
  const { P, t } = ctx;
  const len = Math.max(6, Math.round(t * 0.7));
  const top = span(L.ridgeY), bot = span(L.wy + L.eh - 1);
  if (top) {
    chofa(ctx, Math.ceil(top[0]), L.ridgeY + 1, -1, len);
    chofa(ctx, Math.floor(top[1]) - 1, L.ridgeY + 1, 1, len);
  }
  if (bot) {
    const y = L.wy + L.eh - 1;
    P.rect(Math.ceil(bot[0]), y - 1, Math.floor(bot[1]) - Math.ceil(bot[0]), 1, "gold", 3);
    chofa(ctx, Math.ceil(bot[0]) + 2, y - 1, -1, Math.round(len * 0.55));
    chofa(ctx, Math.floor(bot[1]) - 3, y - 1, 1, Math.round(len * 0.55));
  }
  // gold rake lines
  for (let y = L.ridgeY + 2; y < L.wy + L.eh - 2; y++) {
    const s = span(y);
    if (!s) continue;
    P.px(Math.ceil(s[0]) + 1, y, "gold", 3);
    P.px(Math.floor(s[1]) - 2, y, "gold", 2);
  }
}

/** Chicken: body, head, comb and beak. */
function hen(ctx: Ctx, x: number, y: number, dir: 1 | -1) {
  const { P, t } = ctx;
  const s = Math.max(1, Math.round(t / 11));
  P.ellipse(x, y - 2 * s, 2.5 * s + 0.5, 2 * s, "ui");
  P.ellipse(x + dir * 2.5 * s, y - 4 * s, 1.2 * s + 0.3, 1.2 * s + 0.3, "ui");
  P.rect(x + dir * 2 * s, y - 6 * s, s, s, "accent", 3);
  P.rect(x + dir * 4 * s - (dir < 0 ? s - 1 : 0), y - 4 * s, s, s, "gold", 3);
  P.rect(x - dir * 2 * s, y - 3 * s, s, s, "ui", 2);
  P.rect(x - 1, y, 1, Math.max(1, s), "gold", 2);
  P.rect(x + 1, y, 1, Math.max(1, s), "gold", 2);
}

/** Fenced run in front of the left wall: straw floor, trough, two hens, posts and rails. */
function coopRun(ctx: Ctx, L: Layout) {
  const { P, t, trim } = ctx;
  const { PAD, baseY, dx } = L;
  const fh2 = Math.round(t * 0.7), x1 = dx - 3, x0 = PAD;
  P.box(x0, baseY - 3, x1 - x0, 5, "dirt", [0, -0.5, 0.8], { tone: -1 });
  for (let x = x0 + 1; x < x1 - 1; x += 3) if (jit(x, 5, ctx.seed) < 0.6) P.rect(x, baseY - 2 + (x % 2), 2, 1, "sand", 3);
  // wire mesh between the posts, then the top rail
  for (let x = x0 + 3; x < x1 - 2; x += 3) P.rect(x, baseY - fh2 + 1, 1, fh2 + 1, "metal", 1);
  P.box(x0, baseY - fh2, x1 - x0, 2, trim, [0, -0.6, 0.8], { tone: 1 });
  for (let x = x0; x <= x1 - 2; x += Math.max(5, Math.round(t * 0.34))) P.box(x, baseY - fh2 - 1, 2, fh2 + 3, trim, [x === x0 ? -0.4 : 0.1, 0, 1]);
  hen(ctx, Math.round(x0 + (x1 - x0) * 0.3), baseY + 3, 1);
  if (x1 - x0 > t * 1.8) hen(ctx, Math.round(x0 + (x1 - x0) * 0.72), baseY + 4, -1);
  P.box(x1 - 2, baseY - fh2 - 1, 2, fh2 + 3, trim, [0.4, 0, 1]);
  // hen hatch above the fence
  const hx = Math.round((x0 + x1) / 2) - 4, hy = baseY - fh2 - Math.round(t * 0.7);
  P.box(hx - 1, hy - 1, 10, 11, trim, [0, -0.3, 1], { tone: 1 });
  P.rect(hx + 1, hy + 1, 6, 8, "ink", 1);
  P.rect(hx + 1, hy + 8, 6, 1, "sand", 3);
  P.box(hx - 2, hy + 10, 12, 2, trim, [0, -0.6, 0.8]); // ramp
  // trough on the near side
  P.box(x0 + 2, baseY + 2, Math.round(t * 0.7), 2, "wood", [0, -0.4, 0.9], { tone: -1 });
}

export function render(ctx: Ctx, fp: Footprint, o: HouseOpts) {
  const { L } = house(ctx, fp, o);
  paintHouse(ctx, L, fp, o);
  return L;
}

// --- tower: round stone shaft, corbel ring, conical roof -----------------------------------
export function tower(ctx: Ctx, fp: Footprint): Layout {
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
export function keep(ctx: Ctx, fp: Footprint): Layout {
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
  const fy0 = topY + 4, fy1 = L.wy + L.eh - 3;
  P.box(PAD, fy0 - 1, fw + sw, fy1 - fy0 + 1, "stone", [0, -0.9, 0.45], { tone: 1 });
  // flagstones: joints get taller toward the viewer (perspective), the far parapet throws a shadow
  for (let y = fy0, k = 0; y < fy1; k++) {
    const rowH = Math.max(3, Math.round(t * 0.12) + k);
    P.rect(PAD, y, fw + sw, 1, "stone", 1);
    for (let x = PAD + ((k * 7) % 11); x < PAD + fw + sw; x += Math.round(t * 0.5) + rowH) P.rect(x, y + 1, 1, Math.min(rowH - 1, fy1 - y), "stone", 1);
    y += rowH;
  }
  P.shade(PAD, fy0, fw + sw, 4, -1, "stone");
  P.box(PAD, fy0 - 2, 3, fy1 - fy0 + 2, ctx.wall, [-0.7, -0.2, 0.7], { tone: 0 }); // side parapets seen from above
  P.box(PAD + fw + sw - 3, fy0 - 2, 3, fy1 - fy0 + 2, ctx.wall, [0.7, -0.2, 0.7], { tone: -1 });
  // stair hatch on the roof
  const hw = Math.round(t * 1.7), hh = Math.round(t * 0.7), hx = Math.round(PAD + (fw + sw) * 0.6 - hw / 2), hy = fy1 - hh - 2;
  P.shade(hx + hw, hy + hh - 3, Math.round(t * 0.4), 4, -2, "stone");
  paintTex(ctx, texture("stone", hw, hh, ctx.ts, ctx.seed + 12), ctx.wall, hx, hy, flat([0, 0.1, 1]), 1);
  P.rect(hx + (hw >> 1) - 2, hy + 4, 5, hh - 4, "ink", 1);
  P.box(hx - 2, hy - 4, hw + 4, 5, ctx.roof, [0, -0.6, 0.8]);
  P.shade(hx, hy + 1, hw, 2, -2, ctx.wall);
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
  const bpx = hx + (hw >> 1), bpy = hy - 4;
  P.rect(bpx, bpy - 12, 1, 12, "metal", 3);
  P.box(bpx + 1, bpy - 12, 7, 4, "cloth2", [0.2, -0.3, 1]);
  P.rect(bpx + 5, bpy - 11, 2, 1, "gold", 3);
  if (ctx.o.lanterns) lanterns(ctx, L);
  if (ctx.o.wear) wearOverlay(ctx, L);
  return L;
}

export function windowRowSlits(ctx: Ctx, spans: [number, number][], y: number, w: number, h: number) {
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
/** Stairs as a sawtooth band: each step is a lit tread over a darker riser, with a rail on top. */
function stairs(ctx: Ctx, inner: number, outer: number, yTop: number, yBot: number, rail: number) {
  const { P, trim, t } = ctx;
  const dir = outer > inner ? 1 : -1;
  const run = Math.abs(outer - inner);
  const n = Math.max(4, Math.round((yBot - yTop) / Math.max(3, Math.round(t * 0.2))));
  const sw = Math.max(2, Math.floor(run / n)), rise = (yBot - yTop) / n;
  for (let i = 0; i < n; i++) {
    const x = dir > 0 ? inner + i * sw : inner - (i + 1) * sw;
    const y = Math.round(yTop + i * rise);
    P.box(x, y, sw, Math.max(3, Math.round(rise) + 2), trim, [0, 0, 1], { tone: -1 });
    P.rect(x, y, sw, 1, trim, 4); // lit tread
  }
  // stringer under the steps
  P.line(inner, yTop + 3, outer, yBot + 1, trim, 1);
  // handrail parallel to the slope on posts
  P.line(inner, yTop - rail, outer, yBot - rail, trim, 4);
  P.line(inner, yTop - rail + 1, outer, yBot - rail + 1, trim, 2);
  for (const [px, py] of [[inner, yTop], [outer, yBot]]) P.box(px - 1, py - rail, 2, rail + 2, trim, [0, 0, 1], { tone: -1 });
  const nb = Math.max(2, Math.floor(n / 2));
  for (let i = 1; i < nb; i++) {
    const f = i / nb;
    const px = Math.round(inner + (outer - inner) * f), py = Math.round(yTop + (yBot - yTop) * f);
    P.rect(px, py - rail + 2, 1, rail - 1, trim, 2);
  }
}

export function stilt(ctx: Ctx, fp: Footprint): Layout {
  const { t, c, r } = ctx;
  const thai = ctx.o.gable === "thai";
  const gh = Math.round(c * 1.3); // clear height under the deck: one door tall
  const deck = Math.max(3, Math.round(t * 0.22));
  const cabinH = wallHeight(ctx, 1);
  const rh = Math.round(t * fp.d * (thai ? 0.85 : 0.62));
  const base = layout(ctx, fp, cabinH, rh, thai ? Math.round(t * 0.7) : 0, { sideless: false });
  const extra = gh + deck;
  const L: Layout = { ...base, H: base.H + extra, baseY: base.baseY + extra };
  const P = (ctx.P = new Painter(L.W, L.H, ctx.kit));
  const left = r.chance(0.5); // stairs on the left, cabin on the right
  const x0 = L.PAD, x1 = L.PAD + L.wt;
  const ss = Math.round(L.wt * 0.26); // room for the stairs beside the deck
  const dkA = left ? x0 + ss : x0, dkB = left ? x1 : x1 - ss;
  const cabW = Math.round((dkB - dkA) * 0.9), cabFw = cabW - L.sw;
  const cabX = left ? dkB - cabW - 1 : dkA + 1;
  const deckTop = L.baseY - gh; // cabin bottom edge
  // posts, cross brace and the underside shadow
  const np = 4;
  for (let i = 0; i < np; i++) {
    const x = Math.round(dkA + 2 + (i * (dkB - dkA - 8)) / (np - 1));
    P.cylinder(x, deckTop + deck, 3, gh - deck + 1, ctx.trim, { tone: i % 2 ? -1 : 0 });
    P.cylinder(x - 1, L.baseY - 1, 5, 3, "stone", { flat: 0.3 });
  }
  P.line(dkA + 4, deckTop + deck + 2, dkA + Math.round((dkB - dkA) / 3), L.baseY - 4, ctx.trim, 1);
  P.line(dkA + Math.round((dkB - dkA) / 3), deckTop + deck + 2, dkA + 4, L.baseY - 4, ctx.trim, 1);
  P.shade(dkA, deckTop + deck, dkB - dkA, 3, -2, ctx.trim);
  // deck slab, lit top edge, plank joints
  P.box(dkA - 1, deckTop, dkB - dkA + 2, deck, ctx.trim, [0, -0.5, 0.9]);
  P.box(dkA - 1, deckTop, dkB - dkA + 2, 1, ctx.trim, [0, -1, 0.5], { tone: 1 });
  for (let x = dkA + 3; x < dkB - 2; x += 5) P.px(x, deckTop + deck - 1, ctx.trim, 1);
  // cabin
  const wy = deckTop - cabinH;
  wallFace(ctx, ctx.wallKind, ctx.wall, cabX, wy, cabFw, cabinH, flat([0, 0.1, 1]));
  wallFace(ctx, ctx.wallKind, ctx.wall, cabX + cabFw, wy, L.sw, cabinH, flat([1, 0.05, 0.3]), 1);
  P.shade(cabX + cabFw, wy, L.sw, cabinH, -1, ctx.wall);
  P.box(cabX, wy, 2, cabinH, ctx.trim, [-0.5, 0, 1]);
  P.box(cabX + cabFw - 2, wy, 2, cabinH, ctx.trim, [0.4, 0, 1]);
  const dw = L.dw, dh = Math.min(L.dh, cabinH - 6);
  const dxx = left ? cabX + 4 : cabX + cabFw - dw - 4;
  door(ctx, dxx, deckTop, dw, dh, {});
  const ww = Math.round(t * 0.7), wh = Math.round(ww * 1.25);
  const spans: [number, number][] = left ? [[dxx + dw + 3, cabX + cabFw - 3]] : [[cabX + 3, dxx - 3]];
  windowRow(ctx, spans, wy + Math.round(cabinH * 0.3), ww, wh, { shutters: ctx.trim, max: 1, flower: ctx.o.flowerBoxes });
  if (ctx.o.wear) wearOverlay(ctx, { ...L, PAD: cabX, fw: cabFw, wy, baseY: deckTop, fh: 0 });
  // roof over the cabin
  const roofL: Layout = { ...L, ex0: cabX - L.over, ex1: cabX + cabW + L.over, wy, PAD: cabX, fw: cabFw, wt: cabW };
  const span = pitched(ctx, roofL, thai ? "hip" : "gable", ctx.roof, ctx.cover);
  if (thai) thaiRoofTrim(ctx, roofL, span);
  // veranda rail on the open deck, stairs descending from its outer end
  const rail = Math.round(t * 0.5);
  const ra = left ? dkA + 5 : cabX + cabW, rb = left ? cabX : dkB - 5;
  if (rb - ra > 6) {
    P.box(ra, deckTop - rail, rb - ra, 2, ctx.trim, [0, -0.8, 0.6], { tone: 1 });
    for (let x = ra + 1; x < rb - 1; x += 3) P.box(x, deckTop - rail + 2, 1, rail - 2, ctx.trim, [0, 0, 1], { tone: -1 });
    P.box(ra, deckTop - rail, 2, rail, ctx.trim, [-0.4, 0, 1]);
    P.box(rb - 2, deckTop - rail, 2, rail, ctx.trim, [0.4, 0, 1]);
  }
  stairs(ctx, left ? dkA + 1 : dkB - 1, left ? x0 - 3 : x1 + 3, deckTop + deck, L.baseY - 2, rail);
  return L;
}

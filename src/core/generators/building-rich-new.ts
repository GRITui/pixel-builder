import { Painter } from "../painter";
import type { Material } from "../palette";
import type { Footprint } from "../footprint";
import {
  chimneyAt, clamp, door, flat, foundation, jit, layout, outline, paintRoof, paintTex, pitched, richDoorHeight, texture, wallHeight, walls, win,
  type Ctx, type Layout, type NF, type Span, type WallKind,
} from "./building-rich";
import { barrel, chofa, crate, ivy, lanterns, stripedCloth, wallLamp, wearOverlay } from "./building-rich-addons";
import { render, smokeRoom } from "./building-rich-styles";

/** Wave-2 styles: inn, blacksmith, temple, windmill, greenhouse, market stall, well-house. */
export const SPIN_FRAMES = 4;

const sqrt = Math.sqrt;

// --- inn ----------------------------------------------------------------------------------------
export function inn(ctx: Ctx, fp: Footprint, shape: "gable" | "hip", kind: WallKind, wall: Material): Layout {
  return render(ctx, fp, { shape, kind, wallMat: wall, frame: wall === "sand", shutters: ctx.trim, stringCourse: true, pane: true, rhK: 0.8 });
}

// --- blacksmith: closed stone workshop on the left, open forge bay on the right ---------------------
export function blacksmith(ctx: Ctx, fp: Footprint, kind: WallKind, wall: Material): Layout {
  const { t } = ctx;
  const wallH = wallHeight(ctx, 1);
  const rh = Math.round(t * fp.d * 0.8);
  const L = layout(ctx, fp, wallH, rh, Math.round(t * 0.3) + smokeRoom(ctx));
  const P = (ctx.P = new Painter(L.W, L.H, ctx.kit));
  const { PAD, fw, sw, wy, baseY, fh, dw, dh } = L;
  walls(ctx, L, kind, wall, { wearIt: true });
  const split = PAD + Math.round(fw * 0.5);
  const bx = split + 2, bw = PAD + fw - 3 - bx;
  const top = wy + L.eh + Math.max(4, Math.round(t * 0.3)), floor = baseY - fh + 1;
  // dark bay with a stone back wall
  P.rect(bx, top, bw, floor - top, "ink", 1);
  paintTex(ctx, texture("stone", bw, floor - top, ctx.ts, ctx.seed + 9), "stone", bx, top, flat([0, -0.1, 0.9]), 1);
  P.shade(bx, top, bw, floor - top, -2);
  P.shade(bx, top, bw, Math.round((floor - top) * 0.3), -1);
  P.rect(bx, floor - 2, bw, 2, "dirt", 1);
  // hearth and fire
  const hw = Math.round(bw * 0.5), hx = bx + bw - hw - 1, hh = Math.round((floor - top) * 0.78), hy = floor - hh;
  P.box(hx, hy, hw, hh, "stone", [0, -0.2, 1], { tone: 0 });
  P.box(hx, hy, hw, 2, "stone", [0, -0.8, 0.6], { tone: 1 });
  const ox = hx + 3, ow = hw - 6, oy = hy + Math.round(hh * 0.28), oh = floor - 1 - oy;
  P.rect(ox, oy, ow, oh, "ink", 1);
  const fire = Math.max(4, Math.round(oh * 0.6));
  for (let x = ox + 1; x < ox + ow - 1; x++) {
    const u = Math.abs((x + 0.5 - (ox + ow / 2)) / (ow / 2));
    const fh2 = Math.max(2, Math.round(fire * (1 - u * u * 0.8) * (0.75 + 0.25 * jit(x, 6, ctx.seed))));
    P.rect(x, oy + oh - fh2, 1, fh2, "roof", 3);
    P.rect(x, oy + oh - Math.round(fh2 * 0.7), 1, Math.round(fh2 * 0.7), "gold", 3);
    if (u < 0.55) P.rect(x, oy + oh - Math.round(fh2 * 0.4), 1, Math.round(fh2 * 0.4), "gold", 4);
  }
  P.rect(ox + 1, oy + oh - 1, ow - 2, 1, "ink", 2);
  P.shade(hx - 2, hy - 2, hw + 4, hh + 2, 1, "stone");
  ctx.lights.push({ x: ox + ow / 2, y: oy + oh - 2, r: Math.round(t * 2.6) });
  // anvil on a stump
  const ax = bx + Math.round(bw * 0.1) + 4, sw2 = Math.max(6, Math.round(t * 0.5));
  P.cylinder(ax + 2, floor - Math.round(t * 0.36), sw2, Math.round(t * 0.36), "wood");
  const an = Math.max(9, Math.round(t * 0.9)), ay = floor - Math.round(t * 0.36) - Math.max(3, Math.round(t * 0.26));
  P.box(ax - 1, ay, an, Math.max(3, Math.round(t * 0.14)), "metal", [0, -0.7, 0.7], { tone: 1 });
  P.box(ax + 2, ay + Math.max(3, Math.round(t * 0.14)), an - 6, Math.max(3, Math.round(t * 0.14)), "metal", [0, 0, 1], { tone: -1 });
  P.rect(ax - 4, ay, 3, 2, "metal", 3); // horn
  // tools on the back wall
  for (let i = 0; i < 3; i++) {
    const tx = bx + 3 + i * Math.max(4, Math.round(t * 0.28));
    if (tx > hx - 3) break;
    P.rect(tx, top + 2, 1, Math.round(t * 0.5), "wood", 2);
    P.rect(tx - 1, top + 2, 3, 2, "metal", i % 2 ? 3 : 2);
  }
  // beam over the bay and the post between room and bay
  P.box(split - 1, wy + L.eh + 2, PAD + fw - split + 3, Math.max(3, Math.round(t * 0.14)), ctx.trim, [0, -0.5, 0.9]);
  P.box(split - 1, wy + L.eh + 2, 3, floor - wy - L.eh - 2, ctx.trim, [-0.4, 0, 1]);
  // door on the closed side (wear first so cracks do not cross it)
  const dx = Math.round(PAD + (split - PAD) / 2 - dw / 2);
  L.dx = dx;
  if (ctx.o.wear) wearOverlay(ctx, { ...L, fw: split - PAD - 2 });
  door(ctx, dx, baseY, dw, dh, {});
  // roof
  const span = pitched(ctx, L, "gable", ctx.roof, ctx.cover);
  void span;
  const cw = Math.max(7, Math.round(t * 0.62)), cx = Math.round(hx + hw / 2 - cw / 2);
  const ctop = L.ridgeY - 3;
  chimneyAt(ctx, cx, ctop, L.ridgeY + Math.round(L.rh * 0.7), cw);
  ctx.smokeAt = { x: cx + cw / 2, y: ctop - 3 };
  if (ctx.o.lanterns) lanterns(ctx, L);
  if (ctx.o.yard) {
    const bwd = Math.max(5, Math.round(t * 0.42));
    barrel(ctx, PAD + 3, baseY + Math.max(2, Math.round(t * 0.12)), bwd, Math.round(t * 0.55));
    if (dx - PAD > t * 1.6) crate(ctx, PAD + 3 + bwd + 2, baseY + Math.max(2, Math.round(t * 0.12)), Math.max(5, Math.round(t * 0.38)));
  }
  if (ctx.o.ivy) ivy(ctx, L);
  void sw;
  return L;
}

// --- temple: Thai wat inspired, tiered roofs with chofa finials and gold trim ----------------------
export function temple(ctx: Ctx, fp: Footprint): Layout {
  const { t } = ctx;
  const spire = Math.round(t * 0.7);
  const wallH = wallHeight(ctx, 1) + Math.round(t * 0.2);
  const rhTotal = Math.round(t * fp.d * 0.85);
  const L = layout(ctx, fp, wallH, rhTotal, spire, { sideless: true });
  const P = (ctx.P = new Painter(L.W, L.H, ctx.kit));
  const { wy, baseY, ridgeY, eh, fh } = L;
  const cx = L.W / 2, W = L.W;
  const wallW = Math.round((W - 4) * 0.56), wx = Math.round(cx - wallW / 2);
  // platform, then the cella wall and its pillared gallery
  const baseW = Math.round((W - 4) * 0.9);
  P.box(Math.round(cx - baseW / 2), baseY - fh, baseW, fh, "stone", [0, -0.5, 0.9]);
  P.box(Math.round(cx - baseW / 2), baseY - fh, baseW, 1, "stone", [0, -0.9, 0.5], { tone: 1 });
  const wallTop = wy + eh;
  paintTex(ctx, texture("plaster", wallW, wallH - fh, ctx.ts, ctx.seed), ctx.wall, wx, wallTop, flat([0, 0.1, 1]));
  P.shade(wx, wallTop, wallW, Math.round(t * 0.5), -2);
  // gold door
  const dw = L.dw + 2, dh = L.dh;
  const dx = Math.round(cx - dw / 2);
  door(ctx, dx, baseY - fh, dw, dh, { pane: false });
  P.rect(dx - 3, baseY - fh - dh - 3, dw + 6, 1, "gold", 3);
  P.rect(dx - 3, baseY - fh - dh - 3, 1, dh + 3, "gold", 3);
  P.rect(dx + dw + 2, baseY - fh - dh - 3, 1, dh + 3, "gold", 2);
  // slit windows either side
  const ww = Math.max(4, Math.round(t * 0.34)), wh = Math.round(t * 1.1);
  const t0 = ctx.trim;
  ctx.trim = "gold";
  for (const sx of [-1, 1]) {
    const x = Math.round(cx + sx * wallW * 0.32 - ww / 2);
    win(ctx, x, baseY - fh - dh + 2, ww, wh, { lit: ctx.lit });
  }
  ctx.trim = t0;
  // steps
  const stepW = Math.round(wallW * 0.5);
  for (let i = 0; i < 2; i++) {
    const w = stepW + i * 6;
    P.box(Math.round(cx - w / 2), baseY - fh + i * 2 + 1, w, 2, "stone", [0, -0.7, 0.7], { tone: 1 - i });
    P.box(Math.round(cx - w / 2), baseY - fh + i * 2 + 3, w, 1, "stone", [0, 0.5, 0.8], { tone: -2 });
  }
  // tiered roofs, painted bottom to top
  const A = wallTop - ridgeY;
  const f = [0.5, 0.42, 0.4];
  const s = A / (0.62 * f[0] + 0.62 * f[1] + f[2]);
  const h1 = Math.round(s * f[0]), h2 = Math.round(s * f[1]), h3 = Math.round(s * f[2]);
  const ys = [wallTop, wallTop - Math.round(h1 * 0.62)];
  ys.push(ys[1] - Math.round(h2 * 0.62));
  const hs = [h1, h2, h3];
  const full = L.W / 2 - 3 - Math.round(t * 0.4); // leave room for the upturned eave tips
  const hws = [full, full * 0.68, full * 0.4];
  for (let k = 0; k < 3; k++) {
    const yb = ys[k], top = yb - hs[k], hw = hws[k];
    const ins = hw * 0.34;
    const sp: Span = outline(cx - hw, cx + hw, [[top, ins], [yb, 0]], [[top, ins], [yb, 0]], top, yb);
    paintRoof(ctx, "tile", ctx.roof, sp, top, yb, (_x, y) => [0, -0.55 - 0.1 * ((yb - y) / hs[k]), 0.8]);
    P.box(Math.ceil(cx - hw + ins), top, Math.floor(hw * 2 - 2 * ins), 2, ctx.roof, [0, -1, 0.35], { tone: 1 });
    P.rect(Math.ceil(cx - hw), yb - 2, Math.floor(hw * 2), 1, "gold", 3);
    P.shade(Math.ceil(cx - hw), yb, Math.floor(hw * 2), Math.max(3, Math.round(t * 0.14)), -2);
    for (let y = top + 2; y < yb - 2; y++) {
      const r = sp(y)!;
      P.px(Math.ceil(r[0]) + 1, y, "gold", 3);
      P.px(Math.floor(r[1]) - 2, y, "gold", 2);
    }
    const len = Math.max(4, Math.round(t * (0.5 - k * 0.08)));
    chofa(ctx, Math.ceil(cx - hw + ins), top + 1, -1, len);
    chofa(ctx, Math.floor(cx + hw - ins) - 1, top + 1, 1, len);
    chofa(ctx, Math.ceil(cx - hw) - 1, yb - 3, -1, Math.round(len * 0.7));
    chofa(ctx, Math.floor(cx + hw), yb - 3, 1, Math.round(len * 0.7));
  }
  // spire
  const cxi = Math.round(cx);
  P.cylinder(cxi - 1, ridgeY - spire + 2, 3, spire, "gold");
  P.rect(cxi - 2, ridgeY - Math.round(spire * 0.5), 5, 1, "gold", 4);
  P.px(cxi, ridgeY - spire + 1, "gold", 4);
  // gallery pillars in front of the wall
  const pw = Math.max(3, Math.round(t * 0.3));
  for (const sx of [-0.42, -0.2, 0.2, 0.42]) {
    const x = Math.round(cx + sx * (W - 4) - pw / 2 + 0);
    if (x < 3 || x + pw > W - 3) continue;
    P.cylinder(x, wallTop, pw, wallH - fh, ctx.trim === "wood" ? "roof" : ctx.trim);
    P.box(x - 1, baseY - fh - 2, pw + 2, 2, "stone", [0, -0.5, 0.9], { tone: 1 });
    P.rect(x, wallTop + 1, pw, 1, "gold", 3);
  }
  P.shade(wx, wallTop, wallW, 3, -1);
  if (ctx.o.lanterns) for (const sx of [-0.31, 0.31]) wallLamp(ctx, Math.round(cx + sx * (W - 4)) - 1, wallTop + Math.round(t * 0.3), 1);
  if (ctx.o.wear) wearOverlay(ctx, { ...L, PAD: wx, fw: wallW, baseY: baseY - fh + fh });
  return L;
}

// --- windmill: tapered tower, conical cap and four turning sails -------------------------------------
export function windmill(ctx: Ctx, fp: Footprint): Layout {
  const { t, c } = ctx;
  const W = fp.w * t + 4, cx = W / 2;
  const R = Math.round(Math.min(W / 2 - 3, c * 0.95));
  const hubY = R + 3;
  const capUp = Math.round(R * 0.32), capDown = Math.round(t * 0.55);
  const bodyTop = hubY + capDown;
  const Hb = Math.round(c * 2.3);
  const L = layout(ctx, fp, Hb + capDown, hubY - capUp - 2 + 2, 0, { sideless: true });
  // layout's heights are only a frame: pin the real geometry
  L.baseY = bodyTop + Hb; L.wy = bodyTop - L.eh; L.ridgeY = hubY - capUp; L.H = L.baseY + L.gb + 2; L.wallH = Hb;
  const P = (ctx.P = new Painter(L.W, L.H, ctx.kit));
  const bw0 = fp.w * t - 12, bwT = Math.round(bw0 * 0.62);
  const tex = texture(ctx.wallKind === "plank" ? "plaster" : ctx.wallKind, bw0 + 2, Hb, ctx.ts, ctx.seed);
  for (let y = 0; y < Hb; y++) {
    const f = y / Hb, w = bwT + (bw0 - bwT) * f, x0 = cx - w / 2;
    for (let x = Math.ceil(x0); x < Math.floor(x0 + w); x++) {
      const u = clamp((x + 0.5 - cx) / (w / 2), -1, 1);
      const nf: Vec3 = [u * 0.95, 0.05, sqrt(Math.max(0, 1 - u * u)) + 0.15];
      const ti = y * tex.w + clamp(Math.round(x - (cx - bw0 / 2)), 0, tex.w - 1);
      if (tex.mortar[ti]) P.px(x, bodyTop + y, "sand", 2);
      else P.box(x, bodyTop + y, 1, 1, ctx.wall, nf, { tone: tex.tone[ti] });
    }
  }
  const wBot = bw0;
  foundation(ctx, Math.round(cx - wBot / 2) - 1, L.baseY, wBot + 2, L.fh, (x) => {
    const u = clamp((x + 0.5 - cx) / (wBot / 2), -1, 1);
    return [u * 0.95, 0.05, sqrt(Math.max(0, 1 - u * u)) + 0.15];
  });
  // gallery ring and window
  const gy = bodyTop + Math.round(Hb * 0.34), gw = Math.round(bwT + (bw0 - bwT) * 0.34) + 8;
  P.box(Math.round(cx - gw / 2), gy, gw, 3, "wood", [0, -0.5, 0.9]);
  P.shade(Math.round(cx - gw / 2), gy + 3, gw, 3, -2);
  P.box(Math.round(cx - gw / 2), gy - Math.round(t * 0.4), gw, 1, "wood", [0, -0.8, 0.6], { tone: 1 });
  for (let x = Math.round(cx - gw / 2) + 1; x < cx + gw / 2 - 1; x += 3) P.box(x, gy - Math.round(t * 0.4) + 1, 1, Math.round(t * 0.4) - 1, "wood", [0, 0, 1], { tone: -1 });
  for (const f of [0.62, 0.84]) {
    const by = bodyTop + Math.round(Hb * f), bwid = Math.round(bwT + (bw0 - bwT) * f) + 2;
    P.box(Math.round(cx - bwid / 2), by, bwid, 2, "wood", [0, -0.6, 0.8], { tone: 0 });
    P.shade(Math.round(cx - bwid / 2), by + 2, bwid, 2, -2);
  }
  const wwid = Math.max(5, Math.round(t * 0.5)), whei = Math.round(wwid * 1.4);
  win(ctx, Math.round(cx - wwid / 2), gy + 8, wwid, whei, { lit: ctx.lit });
  door(ctx, Math.round(cx - L.dw / 2), L.baseY, L.dw, Math.min(L.dh, Hb - 8), { stone: true });
  // cap
  const ye = bodyTop, half = bwT / 2 + 4, apex = hubY - capUp;
  const cap: Span = (y) => (y < apex || y >= ye ? null : [cx - Math.max(0.8, ((y + 0.5 - apex) / (ye - apex)) * half), cx + Math.max(0.8, ((y + 0.5 - apex) / (ye - apex)) * half)]);
  const capNf: NF = (x) => {
    const u = clamp((x + 0.5 - cx) / half, -1, 1);
    return [u * 0.95, -0.45, sqrt(Math.max(0, 1 - u * u)) * 0.7 + 0.35];
  };
  paintRoof(ctx, ctx.cover === "tile" ? "shingle" : ctx.cover, ctx.roof, cap, apex, ye, capNf);
  P.shade(Math.round(cx - half), ye, Math.round(half * 2), 3, -2);
  // sails
  const th0 = Math.PI / 4 + 0.15 + ctx.spin;
  const x0 = Math.floor(cx - R) - 1, y0 = Math.floor(hubY - R) - 1;
  for (let y = y0; y <= hubY + R + 1; y++)
    for (let x = x0; x <= cx + R + 1; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - hubY;
      for (let k = 0; k < 4; k++) {
        const th = th0 + (k * Math.PI) / 2, cs = Math.cos(th), sn = Math.sin(th);
        const along = dx * cs + dy * sn, across = -dx * sn + dy * cs;
        if (along < R * 0.16 || along > R) continue;
        const bw = R * 0.26;
        if (across >= 0.6 && across <= 0.6 + bw && along >= R * 0.24) {
          const lat = Math.round(along) % 4 === 0 || Math.round(across) % 4 === 0 || across > bw + 0.1;
          P.px(x, y, lat ? "wood" : "sand", lat ? 1 : 3);
          break;
        }
        if (Math.abs(across) < 0.75) { P.px(x, y, "wood", 2); break; }
      }
    }
  P.ellipse(cx, hubY, Math.max(2.5, R * 0.1), Math.max(2.5, R * 0.1), "gold");
  P.px(Math.round(cx), Math.round(hubY) - 1, "gold", 4);
  if (ctx.o.wear) wearOverlay(ctx, { ...L, PAD: Math.round(cx - bw0 / 2), fw: bw0, wy: bodyTop });
  return L;
}

type Vec3 = [number, number, number];

// --- greenhouse: glass walls and roof over rows of plants -----------------------------------------
export function greenhouse(ctx: Ctx, fp: Footprint): Layout {
  const { t, trim } = ctx;
  const wallH = wallHeight(ctx, 1) - 2;
  const rh = Math.round(t * fp.d * 0.55);
  const L = layout(ctx, fp, wallH, rh, 0);
  const P = (ctx.P = new Painter(L.W, L.H, ctx.kit));
  const { PAD, fw, sw, wy, baseY, fh, ridgeY, eh } = L;
  const top = wy;
  const pane = Math.max(8, Math.round(t * 1.0));
  const framePx = (m: Material) => m;
  // interior: dark back, shelf, plants
  const inner0 = top + 2, inner1 = baseY - fh;
  P.rect(PAD + 2, inner0, fw - 4, inner1 - inner0, "foliage", 2);
  P.rect(PAD + 2, inner0, fw - 4, Math.round((inner1 - inner0) * 0.5), "water", 1);
  P.shade(PAD + 2, inner0, fw - 4, inner1 - inner0, -1);
  const benchY = inner1 - Math.round(t * 0.55);
  P.box(PAD + 2, benchY, fw - 4, 2, "wood", [0, -0.4, 0.9]);
  P.rect(PAD + 2, benchY + 2, fw - 4, 1, "wood", 0);
  const nP = Math.max(5, Math.floor((fw - 6) / (t * 0.6)));
  for (let i = 0; i < nP; i++) {
    const px = Math.round(PAD + 4 + ((i + 0.5) * (fw - 8)) / nP);
    const j = jit(i, 3, ctx.seed);
    const ph = Math.round(t * (0.5 + j * 0.5)), pr = Math.max(3, Math.round(t * 0.3));
    // potted plant on the bench
    P.box(px - 2, benchY - 4, 5, 4, "roof", [0, -0.2, 1], { tone: -1 });
    P.ellipse(px, benchY - 4 - ph / 2, pr, ph / 2 + 1, "foliage", { tone: j < 0.5 ? 0 : 1 });
    P.ellipse(px - 1, benchY - 5 - ph / 2, pr * 0.5, ph * 0.3, "foliage", { tone: 2 });
    const bloom = j < 0.34 ? "cloth2" : j < 0.67 ? "gold" : "blossom";
    for (let k = 0; k < 3; k++) P.px(px + Math.round((jit(i, k + 9, ctx.seed) - 0.5) * pr * 1.6), benchY - 5 - Math.round(ph * (0.4 + 0.5 * jit(i, k + 20, ctx.seed))), bloom, 3);
    // tall back plants
    if (i % 2 === 0) P.ellipse(px + 3, inner0 + (benchY - inner0) * 0.55, pr * 0.8, (benchY - inner0) * 0.4, "foliage", { tone: 0 });
  }
  // frames
  for (let x = PAD; x < PAD + fw; x += pane) P.box(x, top, 2, baseY - fh - top, trim, [-0.3, 0, 1], { tone: x === PAD ? 0 : -1 });
  P.box(PAD + fw - 2, top, 2, baseY - fh - top, trim, [0.4, 0, 1]);
  P.box(PAD, top, fw, 2, trim, [0, -0.5, 0.9], { tone: 1 });
  P.box(PAD, benchY - 1, 0, 0, trim, [0, 0, 1]);
  void framePx;
  // glass glints
  for (let x = PAD + 3; x < PAD + fw - 4; x += pane) {
    const gx = x + 2;
    P.rect(gx, top + 4, 1, 3, "water", 4);
    P.rect(gx + 1, top + 7, 1, 2, "water", 4);
    P.px(gx + 3, top + 4 + (x % 3), "water", 4);
  }
  // side wall: darker glass with posts
  if (sw > 0) {
    P.rect(PAD + fw, top, sw, wallH, "foliage", 0);
    P.shade(PAD + fw, top, sw, wallH, -3);
    for (let x = PAD + fw; x < PAD + fw + sw; x += pane) P.box(x, top, 2, wallH, trim, [0.5, 0, 0.6], { tone: -1 });
    P.rect(PAD + fw + 1, top + 4, 1, 3, "water", 3);
  }
  // door with glass
  const dw = L.dw, dh = L.dh;
  // glass door: a frame only, so the plants show through
  P.box(L.dx - 2, baseY - fh - dh - 2, dw + 4, 2, trim, [0, -0.5, 0.9], { tone: 1 });
  P.box(L.dx - 2, baseY - fh - dh, 2, dh, trim, [-0.4, 0, 1]);
  P.box(L.dx + dw, baseY - fh - dh, 2, dh, trim, [0.4, 0, 1]);
  P.box(L.dx + (dw >> 1), baseY - fh - dh, 1, dh, trim, [0, 0, 1], { tone: -1 });
  P.box(L.dx, baseY - fh - Math.round(dh * 0.38), dw, 2, trim, [0, 0, 1]);
  P.px(L.dx + (dw >> 1) + 2, baseY - fh - Math.round(dh * 0.5), "gold", 4);
  foundation(ctx, PAD - 1, baseY, fw + 2, fh, flat([0, 0, 1]));
  P.shade(PAD, baseY - fh, fw, 2, -1, "stone");
  // glass roof
  const yb = wy + eh;
  const span = outline(L.ex0, L.ex1, [[ridgeY, 2], [yb, 0]], [[ridgeY, Math.round(sw * 0.9)], [yb, 0]], ridgeY, yb);
  for (let y = ridgeY; y < yb; y++) {
    const s = span(y)!;
    for (let x = Math.ceil(s[0]); x < Math.floor(s[1]); x++) {
      const rung = (yb - 1 - y) % Math.max(7, Math.round(t * 0.7)) === 0;
      const streak = (x + y * 2) % 11 === 0;
      P.box(x, y, 1, 1, "water", [0, -0.45, 0.9], { tone: rung ? -1 : streak ? 2 : 0 });
    }
  }
  for (let x = L.ex0 + pane; x < L.ex1 - 2; x += pane) {
    for (let y = ridgeY + 2; y < yb; y++) {
      const s = span(y)!;
      if (x > s[0] + 1 && x < s[1] - 1) P.box(x, y, 1, 1, trim, [0, -0.5, 0.9], { tone: 0 });
    }
  }
  P.box(L.ex0 + 1, ridgeY, L.ex1 - L.ex0 - 2, 2, trim, [0, -1, 0.35], { tone: 1 });
  P.box(L.ex0, yb - 2, L.ex1 - L.ex0, 2, trim, [0, 0.4, 0.9], { tone: -1 });
  P.shade(PAD, yb, fw + sw, Math.max(2, Math.round(t * 0.1)), -2);
  if (ctx.o.ivy) ivy(ctx, L);
  if (ctx.o.wear) wearOverlay(ctx, L);
  return L;
}

// --- market stall: striped canopy, counter and goods ------------------------------------------------
export function marketStall(ctx: Ctx, fp: Footprint): Layout {
  const { t, c, trim } = ctx;
  const postH = richDoorHeight(ctx.kit) + 2;
  const canopyH = Math.round(t * 0.85);
  const L = layout(ctx, fp, postH, canopyH, 0, { sideless: true });
  const P = (ctx.P = new Painter(L.W, L.H, ctx.kit));
  const { baseY, ridgeY } = L;
  const x0 = L.PAD + 2, x1 = L.W - L.PAD - 2;
  const cy = ridgeY + canopyH;
  // back cloth and rear posts
  const rb = cy + 2;
  P.box(x0 + 4, rb, x1 - x0 - 8, baseY - rb - Math.round(c * 0.35), "cloth", [0, 0.1, 1], { tone: -1 });
  for (let x = x0 + 5; x < x1 - 5; x += 5) P.box(x, rb, 1, baseY - rb - Math.round(c * 0.35), "cloth", [0, 0.1, 1], { tone: -2 });
  for (const x of [x0 + 3, x1 - 5]) P.box(x, rb, 2, baseY - rb - 2, trim, [0, 0, 1], { tone: -1 });
  // counter
  const ch = Math.round(c * 0.5), cxa = x0 + 5, cxb = x1 - 5;
  P.box(cxa, baseY - ch, cxb - cxa, ch, "wood", [0, 0.1, 1]);
  for (let y = baseY - ch + 4; y < baseY; y += 4) P.rect(cxa, y, cxb - cxa, 1, "wood", 1);
  P.box(cxa - 1, baseY - ch - 2, cxb - cxa + 2, 3, "wood", [0, -0.7, 0.7], { tone: 1 });
  P.shade(cxa, baseY - ch + 1, cxb - cxa, 2, -2, "wood");
  // goods on the counter
  const gy = baseY - ch - 2, n = Math.max(3, Math.floor((cxb - cxa) / (t * 0.8)));
  const kinds: Material[] = ["accent", "gold", "foliage", "sand", "cloth2"];
  for (let i = 0; i < n; i++) {
    const gx = Math.round(cxa + 3 + ((i + 0.5) * (cxb - cxa - 6)) / n);
    const w = Math.max(6, Math.round(t * 0.6));
    P.box(gx - (w >> 1), gy - Math.round(t * 0.22), w, Math.round(t * 0.22), "wood", [0, -0.2, 1], { tone: -1 });
    const m = kinds[(i + Math.floor(jit(i, 4, ctx.seed) * 5)) % kinds.length];
    for (let k = -1; k <= 1; k++) P.ellipse(gx + k * (w / 3.2), gy - Math.round(t * 0.3) - (k === 0 ? 2 : 0), Math.max(2, w / 4), Math.max(2, w / 4), m);
    P.px(gx - 1, gy - Math.round(t * 0.3) - 3, m, 4);
  }
  // sacks and crate beside the stall
  P.ellipse(cxa - 2, baseY - ch * 0.4, 3.5, ch * 0.4, "sand");
  crate(ctx, cxb + 1, baseY, Math.max(5, Math.round(t * 0.38)));
  // front posts
  for (const x of [x0, x1 - 3]) {
    P.cylinder(x, cy, 3, baseY - cy + 1, trim);
    P.cylinder(x - 1, baseY - 1, 5, 2, "stone", { flat: 0.3 });
  }
  // canopy: slanted striped cloth with scalloped valance
  stripedCloth(ctx, L.ex0 + 1, L.ex1 - L.ex0 - 2, ridgeY, canopyH - Math.round(t * 0.2), ctx.o.awningMat, "ui", 0);
  const vy = ridgeY + canopyH - Math.round(t * 0.2);
  stripedCloth(ctx, L.ex0 + 1, L.ex1 - L.ex0 - 2, vy, Math.round(t * 0.22), ctx.o.awningMat, "ui", 1);
  P.box(L.ex0 + 1, ridgeY, L.ex1 - L.ex0 - 2, 1, ctx.o.awningMat, [0, -1, 0.35], { tone: 1 });
  // hanging lamp
  if (ctx.o.lanterns) wallLamp(ctx, Math.round(L.W / 2) - 1, vy + Math.round(t * 0.2) + 3, 1);
  return L;
}

// --- well-house: stone well under a small shingled roof ----------------------------------------------
export function wellHouse(ctx: Ctx, fp: Footprint): Layout {
  const { t, trim } = ctx;
  const ring = Math.round(t * 0.75), post = Math.round(t * 1.05);
  const rh = Math.round(t * 0.95);
  const L = layout(ctx, fp, ring + post, rh, 0, { sideless: true });
  const P = (ctx.P = new Painter(L.W, L.H, ctx.kit));
  const { baseY, ridgeY, eh } = L;
  const cx = L.W / 2, rw = Math.round(t * 1.45);
  const rimY = baseY - ring, rx = rw / 2;
  const nf = (x: number): Vec3 => {
    const u = clamp((x + 0.5 - cx) / rx, -1, 1);
    return [u * 0.95, 0.1, sqrt(Math.max(0, 1 - u * u)) + 0.15];
  };
  // back posts (behind the ring), then the stone cylinder
  paintTex(ctx, texture("stone", rw, ring, ctx.ts, ctx.seed), "stone", Math.round(cx - rx), rimY, nf, 1);
  P.ellipse(cx, rimY, rx, Math.max(3, rx * 0.3), "stone", { tone: 1 });
  P.ellipse(cx, rimY, rx - 3, Math.max(2, rx * 0.3 - 2), "water", { tone: -2, flat: 0.5 });
  P.ellipse(cx - 1, rimY, rx * 0.4, Math.max(1, rx * 0.12), "water", { tone: 0, flat: 0.5 });
  // posts and crank beam
  const roofBase = L.wy + eh;
  for (const x of [Math.round(cx - rx) + 1, Math.round(cx + rx) - 4]) P.cylinder(x, roofBase, 3, rimY - roofBase, trim);
  const beamY = roofBase + Math.round(t * 0.3);
  P.box(Math.round(cx - rx) + 1, beamY, rw - 2, 3, trim, [0, -0.5, 0.9]);
  P.rect(Math.round(cx) - 1, beamY + 3, 1, Math.round(t * 0.3), "leather", 2); // rope
  const by0 = beamY + 3 + Math.round(t * 0.3);
  P.cylinder(Math.round(cx) - 3, by0, 6, Math.round(t * 0.3), "wood");
  P.rect(Math.round(cx) - 3, by0 + 2, 6, 1, "metal", 2);
  P.rect(Math.round(cx) + 2, beamY - 1, 2, 5, "metal", 3); // crank handle
  // roof
  const hw = Math.min(Math.round(rx + t * 0.45), Math.floor(L.W / 2) - 3);
  const span: Span = outline(cx - hw, cx + hw, [[ridgeY, 1], [roofBase, 0]], [[ridgeY, 1], [roofBase, 0]], ridgeY, roofBase);
  paintRoof(ctx, ctx.cover, ctx.roof, span, ridgeY, roofBase, () => [0, -0.45, 0.9]);
  P.box(Math.ceil(cx - hw), ridgeY, hw * 2, 2, ctx.roof, [0, -1, 0.35], { tone: 1 });
  P.shade(Math.ceil(cx - hw), roofBase, hw * 2, 3, -2);
  if (ctx.o.ivy) {
    for (let i = 0; i < 6; i++) P.rect(Math.round(cx - rx) + 2 + i * 3, rimY + 2 + Math.floor(jit(i, 5, ctx.seed) * 3), 2, 2, "foliage", 2);
  }
  return L;
}

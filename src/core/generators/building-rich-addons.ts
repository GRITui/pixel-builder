import { glyph, GLYPH_H, GLYPH_W } from "../font";
import { colorIndex } from "../palette";
import { getPx, setPx } from "../sprite";
import type { Sprite } from "../types";
import { clamp, jit, type Ctx, type Layout } from "./building-rich";

/**
 * Rich building add-ons: small details that are layered over any style. Volumes still use the lit
 * Painter (barrels, crates, lamps); only text, cracks and sparkles use explicit levels.
 */

/** Text scale: big kits get 2x glyphs so signs stay readable. */
export const textScale = (ctx: Ctx) => (ctx.t >= 24 ? 2 : 1);

export interface Board { x: number; y: number; w: number; h: number }

export function boardSize(ctx: Ctx, text: string): { w: number; h: number } {
  const sc = textScale(ctx);
  const tw = text.length * (GLYPH_W + 1) * sc - sc;
  return { w: tw + 2 + 2 * sc, h: GLYPH_H * sc + 2 + 2 * sc };
}

/** A hung wooden sign with gold lettering (font.ts glyphs, scaled). Returns its box. */
export function signBoard(ctx: Ctx, cx: number, y: number, text: string, o: { chains?: number } = {}): Board {
  const { P } = ctx;
  const sc = textScale(ctx), { w, h } = boardSize(ctx, text);
  const x = Math.round(cx - w / 2);
  P.box(x, y, w, h, "wood", [0, -0.2, 1], { tone: -1 });
  P.box(x, y, w, 1, "wood", [0, -0.8, 0.6], { tone: 1 });
  P.box(x, y + h - 1, w, 1, "wood", [0, 0.6, 0.8], { tone: -2 });
  P.box(x, y, 1, h, "wood", [-0.6, 0, 1], { tone: 0 });
  // text
  let tx = x + 1 + sc;
  const ty = y + 1 + sc;
  for (const ch of text) {
    glyph(ch).forEach((row, j) => row.forEach((on, i) => on && P.rect(tx + i * sc, ty + j * sc, sc, sc, "gold", 4)));
    tx += (GLYPH_W + 1) * sc;
  }
  if (o.chains) for (const xx of [x + 1, x + w - 2]) P.rect(xx, y - o.chains, 1, o.chains, "metal", 2);
  return { x, y, w, h };
}

/** Wall lamp on a bracket; the glass is an emitter for the night pass. */
export function wallLamp(ctx: Ctx, x: number, y: number, side: -1 | 1) {
  const { P, t } = ctx;
  const h = Math.max(5, Math.round(t * 0.3)), w = Math.max(3, Math.round(t * 0.16));
  P.rect(x + (side > 0 ? -2 : w), y - 2, 2, 1, "metal", 2); // bracket arm
  P.box(x, y - 1, w, 1, "metal", [0, -0.8, 0.6], { tone: 1 }); // cap
  P.rect(x, y, w, h, "gold", 3);
  P.rect(x, y + (h >> 1), w, 1, "gold", 4);
  P.rect(x, y + h, w, 1, "metal", 1);
  if (w > 3) P.rect(x + (w >> 1), y, 1, h, "metal", 2);
  ctx.lights.push({ x: x + w / 2, y: y + h / 2, r: Math.round(t * 1.1) });
}

/** One lamp each side of the door. */
export function lanterns(ctx: Ctx, L: Layout) {
  const { t } = ctx;
  const y = L.baseY - L.dh + Math.round(t * 0.1);
  wallLamp(ctx, L.dx - Math.max(5, Math.round(t * 0.3)) - 2, y, 1);
  wallLamp(ctx, L.dx + L.dw + Math.max(5, Math.round(t * 0.3)), y, -1);
}

/** Ivy: a climbing vine up the corners with leaf clusters, deterministic from the seed. */
export function ivy(ctx: Ctx, L: Layout) {
  const { P, seed } = ctx;
  const top = L.wy + L.eh + 4, bot = L.baseY - L.fh;
  const vines = [L.PAD + 1, L.PAD + L.fw - 3, L.PAD + Math.round(L.fw * 0.34)];
  vines.forEach((x0, vi) => {
    if (vi === 2 && jit(vi, 3, seed) < 0.5) return;
    const reach = (0.55 + jit(vi, 1, seed) * 0.4) * (bot - top);
    let x = x0;
    for (let y = bot - 1; y > bot - reach; y--) {
      if (jit(y, vi, seed + 4) < 0.28) x = clamp(x + (jit(y, vi, seed + 5) < 0.5 ? -1 : 1), L.PAD, L.PAD + L.fw - 2);
      P.px(x, y, "foliage", 1);
      if (jit(y, vi, seed + 6) < 0.5) {
        // leaf cluster: a 3x2 clump with a lit leaf on top
        const lx = x - 1 + (jit(y, vi, seed + 7) < 0.5 ? -1 : 0);
        P.rect(lx, y - 1, 3, 2, "foliage", jit(y, vi, seed + 8) < 0.5 ? 2 : 3);
        P.px(lx + 1, y - 1, "foliage", 4);
        P.px(lx, y, "foliage", 1);
        if (jit(y, vi, seed + 9) < 0.1) P.px(lx + 2, y, "blossom", 3);
      }
    }
  });
  // dense mat at the foot
  for (let i = 0; i < Math.round(L.fw * 0.5); i++) {
    const x = L.PAD + 1 + Math.floor(jit(i, 21, seed) * (L.fw - 2));
    if (jit(i, 22, seed) < 0.45) P.rect(x, bot - 2 - Math.floor(jit(i, 23, seed) * 3), 2, 2, "foliage", 2);
  }
}

/** Cracks, rain stains and moss. Tone-only on the wall so the material ramp stays intact. */
export function wearOverlay(ctx: Ctx, L: Layout) {
  const { P, seed, t } = ctx;
  const top = L.wy + L.eh + 6, bot = L.baseY - L.fh - 1;
  const n = Math.max(2, Math.round(L.fw / (t * 2.2)));
  for (let k = 0; k < n; k++) {
    // crack: a short jagged vertical line
    let x = L.PAD + 4 + Math.floor(jit(k, 31, seed) * (L.fw - 8));
    let y = top + Math.floor(jit(k, 32, seed) * (bot - top) * 0.5);
    const len = Math.round(t * (0.5 + jit(k, 33, seed) * 0.5));
    for (let i = 0; i < len; i++) {
      P.shade(x, y, 1, 1, -2);
      y++;
      if (jit(i, k, seed + 34) < 0.4) x += jit(i, k, seed + 35) < 0.5 ? -1 : 1;
    }
    // stain streak below
    const sx = L.PAD + 3 + Math.floor(jit(k, 36, seed) * (L.fw - 6));
    const sy = top + Math.floor(jit(k, 37, seed) * (bot - top) * 0.4);
    P.shade(sx, sy, 2, Math.round(t * 0.9), -1);
  }
  // moss along the foundation and on the lower roof edge
  for (let x = L.PAD; x < L.PAD + L.fw + L.sw; x++) {
    const j = jit(x, 41, seed);
    if (j < 0.22) P.rect(x, L.baseY - L.fh - 1 + (j < 0.08 ? 1 : 0), 1, 2, "foliage", j < 0.1 ? 1 : 2);
  }
}

/** Barrel: rounded cylinder with hoops. */
export function barrel(ctx: Ctx, x: number, bottom: number, w: number, h: number) {
  const { P } = ctx;
  P.cylinder(x, bottom - h, w, h, "wood", { flat: 0.2 });
  P.rect(x, bottom - h + Math.round(h * 0.22), w, 1, "metal", 2);
  P.rect(x, bottom - Math.round(h * 0.25), w, 1, "metal", 2);
  P.rect(x + 1, bottom - h, w - 2, 1, "wood", 4);
}

/** Crate: boxed lid + X brace. */
export function crate(ctx: Ctx, x: number, bottom: number, s: number) {
  const { P } = ctx;
  P.box(x, bottom - s, s, s, "wood", [0, -0.2, 1], { tone: 0 });
  P.box(x, bottom - s, s, 2, "wood", [0, -0.8, 0.6], { tone: 1 });
  P.rect(x, bottom - 1, s, 1, "wood", 1);
  P.line(x + 1, bottom - s + 2, x + s - 2, bottom - 2, "wood", 1);
  P.line(x + s - 2, bottom - s + 2, x + 1, bottom - 2, "wood", 1);
}

/** Crates and barrels stacked beside the door, on the side with more room. */
export function yardProps(ctx: Ctx, L: Layout) {
  const { P, t, seed } = ctx;
  const leftRoom = L.dx - 4 - L.PAD, rightRoom = L.PAD + L.fw - (L.dx + L.dw + 4);
  const left = leftRoom >= rightRoom;
  const room = left ? leftRoom : rightRoom;
  const bw = Math.max(5, Math.round(t * 0.42)), bh = Math.round(t * 0.55), cs = Math.max(5, Math.round(t * 0.4));
  const bottom = L.baseY + Math.max(2, Math.round(t * 0.12));
  const edge = left ? L.dx - 6 : L.dx + L.dw + 6;
  const dir = left ? -1 : 1;
  let x = edge, used = 0;
  const kinds = [jit(1, 1, seed) < 0.5 ? "barrel" : "crate", "crate", "barrel"];
  for (const k of kinds) {
    const w = k === "barrel" ? bw : cs;
    if (used + w + 2 > Math.min(room, Math.round(t * 2.2))) break;
    const px = dir < 0 ? x - w : x;
    if (k === "barrel") barrel(ctx, px, bottom, w, bh); else crate(ctx, px, bottom, w);
    if (k === "crate" && used === 0) crate(ctx, px + (dir < 0 ? 1 : -1), bottom - cs, Math.max(4, cs - 2)); // stacked
    x += dir * (w + 1);
    used += w + 1;
  }
  // a sack
  if (room - used > bw + 2) {
    const sx = dir < 0 ? x - bw : x;
    P.ellipse(sx + bw / 2, bottom - bh * 0.4, bw / 2, bh * 0.4, "sand");
    P.rect(Math.floor(sx + bw / 2) - 1, bottom - Math.round(bh * 0.8), 2, 1, "leather", 2);
  }
}

/** Striped scalloped cloth (awnings, market stalls). `a` and `b` are the two stripe materials. */
export function stripedCloth(ctx: Ctx, x0: number, w: number, y: number, h: number, a: Parameters<Ctx["P"]["box"]>[4], b: Parameters<Ctx["P"]["box"]>[4], slope = 0) {
  const { P } = ctx;
  const sw = Math.max(3, Math.round(ctx.t * 0.17));
  for (let x = x0; x < x0 + w; x++) {
    const m = (Math.floor((x - x0) / sw) % 2 ? b : a);
    const sc = (x - x0) % sw;
    for (let j = 0; j < h; j++) {
      const scallop = j === h - 1 && (sc === 0 || sc === sw - 1);
      if (scallop) continue;
      P.box(x, y + j, 1, 1, m, [0, -0.5 + (j + slope) / h, 0.8 - j / (h * 3)], { tone: j === h - 1 ? -1 : 0 });
    }
  }
  P.shade(x0, y + h, w, Math.max(2, Math.round(ctx.t * 0.12)), -2);
}

/** Thai chofa: a curved gold horn rising from (x, y); `dir` flings it outward. */
export function chofa(ctx: Ctx, x: number, y: number, dir: -1 | 1, len: number) {
  const { P } = ctx;
  const lo = 2, hi = P.w - 3; // keep the 1px transparent margin after the outline
  const put = (px: number, py: number, lv: number) => { if (px >= lo && px <= hi) P.px(px, py, "gold", lv); };
  for (let i = 0; i < len; i++) {
    const cx = x + dir * Math.round((i * i) / (len * 1.4));
    put(cx, y - i, i > len * 0.6 ? 4 : 3);
    if (i < len * 0.4) put(cx + dir, y - i, 3);
  }
  put(x + dir * Math.round(len / 1.4), y - len, 4);
}

// ---------------------------------------------------------------------------
// Animation: puffs are drawn on the finished sprite (no outline), so frame 0 is always the idle look.
// ---------------------------------------------------------------------------
export const SMOKE_FRAMES = 6;

/** Chimney smoke: frame 0 is empty; frames 1..5 age one puff chain up and to the side, growing and fading. */
export function smoke(s: Sprite, at: { x: number; y: number }, frame: number, t: number) {
  if (frame <= 0) return;
  const age = frame - 1; // 0..4
  const rise = Math.max(2, Math.round(t * 0.13));
  const lite = colorIndex("stone", 4), mid = colorIndex("stone", 3), edge = colorIndex("stone", 2);
  const put = (x: number, y: number, v: number) => {
    if (x >= 1 && y >= 1 && x < s.w - 1 && y < s.h - 1 && getPx(s, x, y) === 0) setPx(s, x, y, v);
  };
  const blob = (cx: number, cy: number, r: number, fade: number) => {
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) {
        const d = Math.hypot(x, y);
        if (d > r + 0.2) continue;
        if (fade > 0 && (x + y + 64) % (fade + 1) === 0) continue; // dissolve
        put(cx + x, cy + y, d > r - 0.9 && r > 1 ? edge : x + y < 0 ? lite : mid);
      }
  };
  const base = Math.max(2, Math.round(t * 0.2));
  for (let k = 1; k >= 0; k--) {
    const a = age - k * 2; // a second, younger puff follows the first
    if (a < 0) continue;
    const r = base + Math.round(a * (0.3 + t * 0.03));
    const cx = at.x + Math.round(a * rise * 0.5) + (a % 2 ? 1 : 0) - (k ? 1 : 0), cy = at.y - Math.round(a * rise) - r;
    blob(cx, cy, r, a >= 3 ? 1 : 0);
  }
}

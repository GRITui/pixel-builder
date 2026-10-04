import { finalize } from "../enforce";
import { Painter } from "../painter";
import { colorIndex, colorIndexFine, normalizeDepth, type Material } from "../palette";
import { rng, valueNoise } from "../rng";
import { createSprite } from "../sprite";
import type { FrameSet, Sprite, StyleKit } from "../types";

/**
 * Water depth: shaded water tiles (shallow with a sandy bottom ... abyss), animated shore tiles
 * and the water props (lily pads, reeds, rocks, driftwood, bridges). Tiles are seamless and
 * un-outlined; props are outlined by `finalize` like every other prop.
 */

export const WATER_DEPTHS = 4;
export const WATER_PROP_KINDS = ["lily-pad", "reeds", "cattail", "river-rock", "driftwood", "small-bridge"] as const;
export const SHORE_OPTIONS = ["", "n", "e", "s", "w", "ne", "ns", "nw", "es", "ew", "sw", "nes", "new", "nsw", "esw", "nesw"];
const FRAMES = 4;
const TAU = 2 * Math.PI;

/** Water position t (0 dark .. 1 light) at each depth; the waves ride on top of this base. */
const BASE_T = [0.75, 0.5, 0.25, 0.06];

function shadeIndex(kit: StyleKit, m: Material, t: number): number {
  const D = normalizeDepth(kit.rampDepth);
  return D > 5 ? colorIndexFine(m, t, D) : colorIndex(m, Math.round(Math.max(0, Math.min(1, t)) * 4));
}

export interface WaterTileOpts {
  /** 0 shallow .. 3 abyss */
  depth: number;
  /** edges (letters of "nesw") where land meets this tile: animated foam line, wet bank */
  shore?: string;
  /** scatter small stones on the bank */
  rocks?: boolean;
}

/** Four animation frames of a depth-shaded water tile. Seamless: every term wraps at the tile size. */
export function waterDepthTile(T: number, seed: number, kit: StyleKit, o: WaterTileOpts): Sprite[] {
  const d = Math.max(0, Math.min(WATER_DEPTHS - 1, Math.round(o.depth)));
  const shore = o.shore ?? "";
  const r = rng(seed ^ 0x3a7e1);
  const warpN = valueNoise(seed, 2), sandN = valueNoise((seed + 9) >>> 0, 4);
  const fine = normalizeDepth(kit.rampDepth) > 5;
  const step = fine ? 0.125 : 0.25;
  const base = BASE_T[d];
  const sparkleN = [3, 2, 2, 1][d] + (T >= 24 ? 1 : 0);
  const sparkles = Array.from({ length: sparkleN }, () => ({ x: r.int(0, T - 1), y: r.int(0, T - 1), f: r.int(0, FRAMES - 1) }));
  const edges = (["n", "e", "s", "w"] as const).filter((e) => shore.includes(e));
  const sc = Math.max(1, T / 16);
  const stones = Array.from({ length: Math.max(2, Math.round(T / 5)) }, () => ({ a: r.int(0, T - 1), e: r.int(0, 1) }));
  const frames: Sprite[] = [];
  for (let f = 0; f < FRAMES; f++) {
    const s = createSprite(T, T);
    const ph = f / FRAMES;
    const put = (x: number, y: number, idx: number) => { if (x >= 0 && y >= 0 && x < T && y < T) s.data[y * T + x] = idx; };
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) {
        const warp = warpN((x * 2) / T, (y * 2) / T) * 2.4;
        const w1 = Math.sin(TAU * ((x / T) * 1 + (y / T) * 2 - ph) + warp);
        const w2 = Math.sin(TAU * ((x / T) * 2 - (y / T) * 1 + ph) + warp * 0.6);
        const v = w1 * 0.65 + w2 * 0.35;
        let t = base;
        t += v > 0.6 ? step : v < -0.6 && (d > 0 || fine) ? -step : 0;
        let idx = shadeIndex(kit, "water", t);
        if (d === 0) {
          // sandy bottom shows through the shallows; wave crests stay water-bright on top
          const sn = sandN((x * 4) / T, (y * 4) / T);
          if (sn > 0.7 && v < 0.55) idx = shadeIndex(kit, "sand", sn > 0.72 ? 0.8 : 0.55);
          else if (sn > 0.62 && (x + y) % 2 === 0 && v < 0.4) idx = shadeIndex(kit, "sand", 0.55);
        }
        put(x, y, idx);
      }
    for (const sp of sparkles) {
      if (sp.f === f) put(sp.x, sp.y, shadeIndex(kit, "water", d === 3 ? 0.5 : 1));
      else if ((sp.f + 1) % FRAMES === f && d < 3) put(sp.x, sp.y, shadeIndex(kit, "water", Math.min(1, base + 0.28)));
    }
    if (edges.length) {
      for (let y = 0; y < T; y++)
        for (let x = 0; x < T; x++) {
          // distance to the nearest land edge and where along that edge we are
          let e = Infinity, a = 0;
          for (const ed of edges) {
            const de = ed === "n" ? y : ed === "s" ? T - 1 - y : ed === "w" ? x : T - 1 - x;
            if (de < e) { e = de; a = ed === "n" || ed === "s" ? x : y; }
          }
          const line = Math.round((2.2 + 0.7 * Math.sin((TAU * 2 * a) / T) + 0.8 * Math.sin(TAU * (ph + a / T))) * sc);
          if (e < line - 1) put(x, y, shadeIndex(kit, "sand", 0.2));
          else if (e === line - 1) put(x, y, shadeIndex(kit, "sand", 0.4));
          else if (e === line) put(x, y, colorIndex("water", 4));
          else if (e === line + 1 && a % 2 === 0) put(x, y, shadeIndex(kit, "water", Math.min(1, base + 0.35)));
        }
      if (o.rocks)
        for (const st of stones) {
          for (const ed of edges) {
            const [x, y] = ed === "n" ? [st.a, st.e] : ed === "s" ? [st.a, T - 1 - st.e] : ed === "w" ? [st.e, st.a] : [T - 1 - st.e, st.a];
            put(x, y, colorIndex("stone", 2));
            if (T >= 16) put(x + (ed === "e" ? -1 : 1) * (ed === "n" || ed === "s" ? 1 : 0), y + (ed === "w" || ed === "e" ? 1 : 0), colorIndex("stone", 3));
          }
        }
    }
    frames.push(s);
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface WaterPropOpts {
  foliage: Material;
  trunk: Material;
  stone: Material;
  accent: Material;
  variant: number;
  flower: boolean;
  span: number;
}

interface PC {
  P: Painter;
  S: number;
  W: number;
  k: number;
  G: number;
  r: ReturnType<typeof rng>;
  o: WaterPropOpts;
  R: (n: number) => number;
  R1: (n: number) => number;
}

/** Ripple under a floating prop: reads on any background and gives the prop contact with the water. */
function ripple(c: PC, cx: number, cy: number, rx: number, ry: number, tone = -1) {
  c.P.ellipse(cx, cy, rx, ry, "water", { tone, flat: 1 });
}

function lilyPad(c: PC, f: number) {
  const { P, S, k, o } = c;
  const bob = f === 2 ? 1 : 0;
  const pad = (cx: number, cy: number, rx: number, ry: number, notch: number, tone: number) => {
    ripple(c, cx + 0.5, cy + 1, rx + 1.5 * k, ry + 1 * k);
    P.ellipse(cx, cy, rx, ry, o.foliage, { flat: 0.85, tone });
    // notch: wedge cut towards the edge, then a vein from the middle
    const ex = Math.cos(notch), ey = Math.sin(notch);
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = x + 0.5 - cx, dy = (y + 0.5 - cy) / (ry / rx);
        const along = dx * ex + dy * ey, across = Math.abs(-dx * ey + dy * ex);
        if (along > rx * 0.35 && across < (along - rx * 0.2) * 0.38) P.erase(x, y);
      }
    P.px(Math.round(cx - rx * 0.4), Math.round(cy - ry * 0.35), o.foliage, 4);
  };
  const cx = S / 2;
  pad(cx - 3 * k, S * 0.55 + bob, 9.5 * k, 6 * k, 0.5 + (o.variant % 3) * 1.2, 0);
  pad(cx + 6 * k, S * 0.34 + (f === 0 ? 0 : bob), 5 * k, 3.2 * k, 2.6, -1);
  if (o.flower) {
    const fx = Math.round(cx - 4 * k), fy = Math.round(S * 0.5 + bob);
    const m = o.accent;
    P.ellipse(fx + 0.5, fy, 3.2 * k, 2.8 * k, m, { tone: 0 });
    P.ellipse(fx + 0.5, fy - k, 1.8 * k, 1.8 * k, m, { tone: 1 });
    P.px(fx, fy - Math.round(k * 0.5), "gold", 4);
  }
}

function reeds(c: PC, f: number, cattail: boolean) {
  const { P, S, k, o, G } = c;
  const cx = S / 2;
  const off = [0, 1, 0, -1][f] * (k >= 1 ? 1 : 0.6);
  ripple(c, cx, G - 1.5 * k, 10 * k, 2.2 * k);
  const stalks: [number, number, number][] = cattail
    ? [[-6, 19, -1], [0, 24, 0], [6, 17, 1]]
    : [[-9, 13, -1], [-6, 21, -1], [-3, 16, 0], [0, 23, 0], [3, 18, 1], [6, 21, 1], [9, 12, 1]];
  stalks.forEach(([dx, h, lean], i) => {
    const x = Math.round(cx + dx * k), hh = h * k;
    const tipX = x + lean * 2.2 * k + off * (hh / (28 * k)) * 2;
    if (cattail) {
      P.line(x, G - 1, Math.round(tipX), Math.round(G - hh), "grass", i % 2 ? 2 : 3);
      const hx = Math.round(tipX), hy = Math.round(G - hh + 1.5 * k);
      P.ellipse(hx + 0.5, hy, Math.max(1, 1.6 * k), Math.max(1.5, 3.6 * k), o.trunk, { tone: -1 });
      P.px(hx, Math.round(hy - 3 * k), o.trunk, 1);
    } else {
      const hw = k >= 1 ? 1.1 : 0.6;
      P.poly([[x - hw, G], [x + hw + 0.5, G], [tipX, G - hh]], "grass", [lean * 0.6, -0.2, 1], { tone: i % 2 ? 0 : -1 });
    }
  });
  if (cattail) {
    // two leaves arching out
    for (const dx of [-3, 3]) {
      const x = Math.round(cx + dx * k), hh = 14 * k;
      P.poly([[x - 0.8, G], [x + 1.3, G], [x + Math.sign(dx) * 5 * k + off * 1.2, G - hh]], "grass", [dx * 0.1, -0.2, 1], { tone: -1 });
    }
  }
  void o;
}

function riverRock(c: PC, f: number) {
  const { P, S, k, o, G } = c;
  const cx = S / 2;
  const grow = [0, 0.8, 1.6, 0.8][f] * k;
  ripple(c, cx, G - 2 * k, 12 * k + grow, 3.2 * k + grow * 0.4, 1);
  ripple(c, cx, G - 2 * k, 10 * k, 2.4 * k, -1);
  P.ellipse(cx - 4 * k, G - 6 * k, 6 * k, 4.6 * k, o.stone, {});
  P.ellipse(cx + 5 * k, G - 4.5 * k, 4.6 * k, 3.4 * k, o.stone, { tone: -1 });
  P.ellipse(cx + 0.5 * k, G - 9.5 * k, 3.2 * k, 2.4 * k, o.stone, { tone: 1 });
  // wet line where the water meets the stone
  P.rect(Math.round(cx - 9 * k), Math.round(G - 2.2 * k), Math.max(2, Math.round(18 * k)), 1, "water", 3);
}

function driftwood(c: PC, f: number) {
  const { P, S, k, o, G } = c;
  const cx = S / 2;
  const bob = f === 1 || f === 2 ? 1 : 0;
  const y = G - 6 * k + bob;
  ripple(c, cx, G - 2.5 * k + bob, 13 * k, 3 * k);
  P.capsule(cx - 11 * k, y + k, cx + 11 * k, y - k, 2.8 * k, o.trunk, { tone: 1 });
  P.capsule(cx - 2 * k, y, cx + 3 * k, y - 8 * k, 1.1 * k, o.trunk, { tone: 0 });
  P.capsule(cx + 4 * k, y - 0.5 * k, cx + 8 * k, y - 5.5 * k, 0.9 * k, o.trunk, { tone: 0 });
  P.ellipse(cx + 11 * k, y - k, 1.6 * k, 2.6 * k, o.trunk, { tone: 2, flat: 1 });
  P.px(Math.round(cx + 11 * k), Math.round(y - k), o.trunk, 1);
  P.line(cx - 8 * k, y + 0.2, cx - 3 * k, y - 0.4, o.trunk, 1);
}

function bridge(c: PC) {
  const { S, k, o } = c;
  const W = c.W - 2;
  // 1px transparent margin: draw through a view shifted right by one
  const P = {
    rect: (x: number, y: number, w: number, h: number, m: Material, l: number) => c.P.rect(x + 1, y, w, h, m, l),
    box: (x: number, y: number, w: number, h: number, m: Material, n: [number, number, number], op: { tone?: number } = {}) => c.P.box(x + 1, y, w, h, m, n, op),
    px: (x: number, y: number, m: Material, l: number) => c.P.px(x + 1, y, m, l),
  };
  const stone = o.trunk === "stone";
  const m: Material = stone ? o.stone : o.trunk;
  const y0 = Math.round(S * 0.28), y1 = Math.round(S * 0.72);
  const rail = Math.max(1, Math.round(3 * k));
  // shadow on the water below
  P.rect(0, y1, W, Math.max(1, Math.round(2 * k)), "water", 0);
  P.rect(0, y0 - 1, W, 1, "water", 1);
  // deck
  P.box(0, y0, W, y1 - y0, m, [0, -0.15, 1]);
  const pw = Math.max(2, Math.round(4 * k));
  if (!stone) {
    for (let x = 0, i = 0; x < W; x += pw, i++) {
      if (i % 2) P.box(x, y0, Math.min(pw, W - x), y1 - y0, m, [0, -0.15, 1], { tone: -1 });
      if (x > 0) P.rect(x, y0 + rail, 1, y1 - y0 - 2 * rail, m, 0);
    }
  } else {
    const course = Math.max(3, Math.round(5 * k));
    for (let y = y0 + rail, row = 0; y < y1 - rail; y += course, row++) {
      P.rect(0, y, W, 1, m, 1);
      for (let x = row % 2 ? course : course * 1.5; x < W - 1; x += course * 2) P.rect(Math.round(x), y + 1, 1, Math.min(course - 1, y1 - rail - y - 1), m, 1);
    }
  }
  // parapets / rails along both long sides, posts at the ends
  P.box(0, y0, W, rail, m, [0, -0.6, 0.8], { tone: stone ? 1 : 0 });
  P.box(0, y1 - rail, W, rail, m, [0, 0.8, 0.6], { tone: -1 });
  const post = Math.max(2, Math.round(3 * k));
  for (const x of [0, W - post]) {
    P.box(x, y0 - Math.round(k), post, y1 - y0 + 2 * Math.round(k), m, [x === 0 ? -0.5 : 0.5, -0.3, 0.9], { tone: stone ? 0 : -1 });
    P.px(x + Math.floor(post / 2), y0 - Math.round(k), m, 4);
  }
  if (W > S) for (let x = S; x < W - 1; x += S) P.box(x - 1, y0 - Math.round(k), post - 1, y1 - y0 + 2 * Math.round(k), m, [0, -0.3, 0.9], { tone: -1 });
}

/** Idle frame plus an animation row for water props (bridges are static). */
export function waterPropRows(kind: string, kit: StyleKit, seed: number, o: WaterPropOpts, idleOnly: boolean): FrameSet[] {
  const S = kit.sizes.environment;
  const k = S / 32;
  const span = kind === "small-bridge" ? Math.max(1, Math.min(3, Math.round(o.span) || 1)) : 1;
  const W = S * span;
  const frameAt = (f: number): Sprite => {
    const P = new Painter(W, S, kit);
    const c: PC = { P, S, W, k, G: S - 3, r: rng(seed >>> 0), o, R: (n) => Math.round(n * k), R1: (n) => Math.max(1, Math.round(n * k)) };
    if (kind === "lily-pad") lilyPad(c, f);
    else if (kind === "reeds") reeds(c, f, false);
    else if (kind === "cattail") reeds(c, f, true);
    else if (kind === "river-rock") riverRock(c, f);
    else if (kind === "driftwood") driftwood(c, f);
    else bridge(c);
    return finalize(P.toSprite(), kit);
  };
  const idle = frameAt(0);
  if (idleOnly || kind === "small-bridge") return [{ name: "idle", frames: [idle] }];
  const name = kind === "reeds" || kind === "cattail" ? "sway" : kind === "river-rock" ? "ripple" : "bob";
  const frames = [idle, ...[1, 2, 3].map(frameAt)];
  // animation may not touch an edge the idle frame leaves free
  for (const fr of frames)
    for (let y = 0; y < fr.h; y++)
      for (let x = 0; x < fr.w; x++)
        if ((x === 0 || y === 0 || x === fr.w - 1 || y === fr.h - 1) && !idle.data[y * fr.w + x]) fr.data[y * fr.w + x] = 0;
  return [{ name: "idle", frames: [idle] }, { name, frames }];
}

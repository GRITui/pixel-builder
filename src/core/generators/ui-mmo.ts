// MMO HUD skins for the ui generator: glossy bars, unit frame, minimap, skill bar, chat, quest
// tracker, tooltip, nameplate and damage numbers. Frames and bars use explicit ramp levels (like the
// wood UI); the portrait and gem icons are lit with the Painter so they share the kit's light.
import { drawText, glyph, GLYPH_H, textWidth } from "../font";
import { Painter } from "../painter";
import { colorIndex, decodeIndex, type Material } from "../palette";
import { blit, bounds, getPx, setPx } from "../sprite";
import type { Sprite, StyleKit } from "../types";
import { characterGenerator } from "./character";
import { defaults, type Params } from "./types";

export const UI_SKINS = ["wood", "mmo-gold", "mmo-stone", "mmo-dark"] as const;
export type UiSkin = (typeof UI_SKINS)[number];
export const MMO_KINDS = ["unit-frame", "minimap-frame", "skill-bar", "chat-panel", "quest-tracker", "tooltip", "nameplate", "damage-numbers"] as const;
export const MMO_NAMES = ["HERO", "KNIGHT", "MAGE", "ROGUE", "PRIEST", "SLIME", "MUSHROOM", "WOLF", "BAT", "SKELETON", "BOSS"] as const;
export const MMO_TONES = ["white", "yellow", "red", "green"] as const;
export const MMO_RARITY = ["common", "uncommon", "rare", "epic", "legendary"] as const;
export const MMO_PORTRAITS = ["none", "silhouette", "hero"] as const;

export interface Skin {
  rim: Material;
  hi: number;
  mid: number;
  lo: number;
  /** rivet colour */
  stud: [Material, number];
  text: [Material, number];
  /** [material, level] of the recessed well */
  well: number;
}

const SKINS: Record<string, Skin> = {
  "mmo-gold": { rim: "gold", hi: 4, mid: 3, lo: 2, stud: ["gold", 4], text: ["gold", 4], well: 1 },
  "mmo-stone": { rim: "stone", hi: 4, mid: 3, lo: 1, stud: ["stone", 4], text: ["ui", 4], well: 1 },
  "mmo-dark": { rim: "metal", hi: 3, mid: 2, lo: 1, stud: ["gold", 3], text: ["ui", 4], well: 0 },
};
export const isMmoSkin = (s: string): boolean => s in SKINS;
export const skinOf = (s: string): Skin => SKINS[s] ?? SKINS["mmo-gold"];

const WELL: Material = "ui";
const TONE_MAT: Record<string, Material> = { white: "ui", yellow: "gold", red: "cloth2", green: "foliage" };
const RARITY_MAT: Record<string, Material> = { common: "ui", uncommon: "foliage", rare: "water", epic: "accent", legendary: "gold" };

type Rect = { x: number; y: number; w: number; h: number };

// ---------------------------------------------------------------- primitives
interface FrameOpts {
  rim?: 1 | 2;
  round?: boolean;
  /** well level override (lighter = raised, e.g. hovered button) */
  well?: number;
  /** invert the bevel (pressed) */
  sunk?: boolean;
}

/** Ink outline, beveled rim in the skin metal, ink liner and a recessed well. Returns the well rect. */
export function mmoFrame(P: Painter, x: number, y: number, w: number, h: number, sk: Skin, o: FrameOpts = {}): Rect {
  const rimW = o.rim ?? 2;
  const side = P.lightSide;
  const hi = o.sunk ? sk.lo : sk.hi, lo = o.sunk ? sk.hi : sk.lo;
  P.rect(x, y, w, h, "ink", 0);
  // layer 0: lit top/lit side, shaded bottom/shade side
  P.rect(x + 1, y + 1, w - 2, h - 2, sk.rim, lo);
  P.rect(x + 1, y + 1, w - 2, 1, sk.rim, hi);
  if (side <= 0) P.rect(x + 1, y + 1, 1, h - 3, sk.rim, hi);
  else P.rect(x + w - 2, y + 1, 1, h - 3, sk.rim, hi);
  if (rimW === 2) {
    P.rect(x + 2, y + 2, w - 4, h - 4, sk.rim, sk.mid);
    P.rect(x + 3, y + 3, w - 6, h - 6, "ink", 0);
  }
  const inset = rimW + 1;
  const well: Rect = { x: x + inset, y: y + inset, w: w - inset * 2, h: h - inset * 2 };
  const wl = o.well ?? sk.well;
  if (well.w > 0 && well.h > 0) {
    P.rect(well.x, well.y, well.w, well.h, WELL, wl);
    P.rect(well.x, well.y, well.w, 1, WELL, Math.max(0, wl - 1)); // inner shadow under the lip
    P.rect(well.x, well.y, 1, well.h, WELL, Math.max(0, wl - 1));
  }
  if (rimW === 2 && w >= 14 && h >= 14)
    for (const [cx, cy] of [[x + 2, y + 2], [x + w - 3, y + 2], [x + 2, y + h - 3], [x + w - 3, y + h - 3]]) P.px(cx, cy, ...sk.stud);
  if (o.round) {
    P.erase(x, y); P.erase(x + w - 1, y); P.erase(x, y + h - 1); P.erase(x + w - 1, y + h - 1);
  }
  return well;
}

/** Flat disc with explicit level (badge outlines, gem sockets). */
function disc(P: Painter, cx: number, cy: number, r: number, m: Material, lv: number) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) P.px(x, y, m, lv);
}

/** Row levels for a glossy fill: soft top, 1px shine, body, shaded belly, dark floor. */
function glossLevels(h: number): number[] {
  const out: number[] = [];
  const shine = h >= 5 ? 1 : 0;
  for (let j = 0; j < h; j++) {
    if (j === shine) out.push(4);
    else if (h >= 3 && j === h - 1) out.push(1);
    else if (j >= Math.ceil(h * 0.55)) out.push(2);
    else out.push(3);
  }
  return out;
}

/** Glossy gradient fill; the leading end is rounded back to `bg` and given a bright edge. */
function glossFill(P: Painter, x: number, y: number, w: number, h: number, m: Material, bg: [Material, number], round = true) {
  if (w <= 0 || h <= 0) return;
  const lv = glossLevels(h);
  for (let j = 0; j < h; j++) P.rect(x, y + j, w, 1, m, lv[j]);
  if (h >= 5) {
    // shine stops 1px short of both ends so it reads as a curved highlight
    P.px(x, y + 1, m, 3);
    if (w > 2) P.px(x + w - 1, y + 1, m, 3);
  }
  if (w >= 4 && h >= 4 && round) {
    P.px(x + w - 1, y, ...bg); P.px(x + w - 1, y + h - 1, ...bg);
  }
  if (w >= 3) P.rect(x + w - 1, y + 1, 1, Math.max(1, h - 2), m, Math.max(1, lv[Math.min(h - 1, 2)] - 1)); // leading edge
}

/** Recessed trough for a bar (dark with a shadow row). */
function trough(P: Painter, r: Rect, sk: Skin) {
  P.rect(r.x, r.y, r.w, r.h, WELL, 1);
  P.rect(r.x, r.y, r.w, 1, WELL, 0);
  void sk;
}

const pct = (v: unknown, d: number) => {
  const n = Number(v);
  return Math.max(0, Math.min(100, Number.isFinite(n) ? n : d)) / 100;
};

// ---------------------------------------------------------------- bar (skin versions of the base kind)
/** Capped glossy bar; fill row spans the whole channel so callers can crop it by percentage. */
export function mmoBar(kit: StyleKit, sk: Skin, w: number, h: number, accent: Material): { frame: Sprite; fill: Sprite; fillRect: Rect } {
  const capX = w >= 24 ? 3 : 2;
  const fx = capX, fy = 2, fw = w - capX * 2, fh = h - 4;
  const F = new Painter(w, h, kit);
  mmoFrame(F, 0, 0, w, h, sk, { rim: 1, round: true });
  trough(F, { x: fx, y: fy, w: fw, h: fh }, sk);
  if (capX === 3) for (const cx of [1, w - 3]) { // metal end caps with a stud
    F.rect(cx, 1, 2, h - 2, sk.rim, sk.mid);
    F.rect(cx, 1, 2, 1, sk.rim, sk.hi);
    F.px(cx + (cx < 2 ? 0 : 1), h >> 1, ...sk.stud);
  }
  const G = new Painter(w, h, kit);
  glossFill(G, fx, fy, fw, fh, accent, [WELL, 1], false);
  return { frame: F.toSprite(), fill: G.toSprite(), fillRect: { x: fx, y: fy, w: fw, h: fh } };
}

/** Bar with the fill baked in at `frac` (for composites). */
function barAt(P: Painter, x: number, y: number, w: number, h: number, sk: Skin, accent: Material, frac: number, capped = true) {
  const capX = capped && w >= 24 ? 3 : 2;
  const fx = x + capX, fy = y + 2, fw = w - capX * 2, fh = h - 4;
  mmoFrame(P, x, y, w, h, sk, { rim: 1, round: true });
  trough(P, { x: fx, y: fy, w: fw, h: fh }, sk);
  if (capX === 3) for (const cx of [x + 1, x + w - 3]) {
    P.rect(cx, y + 1, 2, h - 2, sk.rim, sk.mid);
    P.rect(cx, y + 1, 2, 1, sk.rim, sk.hi);
  }
  const filled = Math.round(fw * frac);
  glossFill(P, fx, fy, filled, fh, accent, [WELL, 1]);
}

// ---------------------------------------------------------------- generic skinned kinds
export function mmoPanel(kit: StyleKit, sk: Skin, w: number, h: number, kind: "panel" | "slot" | "icon-frame"): Sprite {
  const P = new Painter(w, h, kit);
  if (kind === "slot") mmoFrame(P, 0, 0, w, h, sk, { rim: 1, round: true, well: 0, sunk: true });
  else if (kind === "icon-frame") mmoFrame(P, 0, 0, w, h, sk, { rim: 2, round: true, well: 0 });
  else mmoFrame(P, 0, 0, w, h, sk, { rim: 2, round: true });
  return P.toSprite();
}

export function mmoButton(kit: StyleKit, sk: Skin, w: number, h: number, state: "normal" | "hover" | "pressed"): Sprite {
  const P = new Painter(w, h, kit);
  const shift = state === "hover" ? 1 : state === "pressed" ? -1 : 0;
  const well = mmoFrame(P, 0, 0, w, h, sk, { rim: 1, round: true, well: 1, sunk: state === "pressed" });
  // glossy face in the skin metal: shine row, body, belly
  const lv = glossLevels(well.h);
  for (let j = 0; j < well.h; j++) P.rect(well.x, well.y + j, well.w, 1, sk.rim, Math.max(0, Math.min(4, lv[j] + shift - (sk.hi < 4 ? 1 : 0))));
  const dy = state === "pressed" ? 1 : 0;
  const len = Math.max(4, Math.min(well.w - 4, Math.round(well.w * 0.5)));
  const lx = Math.round(w / 2 - len / 2), ly = Math.round(h / 2) - 1 + dy;
  const dark = sk.rim !== "metal";
  P.rect(lx, ly, len, 2, dark ? "ink" : "ui", dark ? 0 : 4);
  P.rect(lx, ly + 1, len, 1, dark ? "ink" : "ui", dark ? 1 : 3);
  return P.toSprite();
}

// ---------------------------------------------------------------- portrait
function portraitSprite(kit: StyleKit, kind: string, seed: number, size: number): Sprite {
  const Q = new Painter(size, size, kit);
  Q.rect(0, 0, size, size, "cloth", 1);
  Q.rect(0, 0, size, 1, "cloth", 0);
  Q.ellipse(size / 2, size * 0.45, size * 0.46, size * 0.46, "cloth", { flat: 0.55, tone: -1 }); // soft backdrop glow
  if (kind === "silhouette") {
    const cx = size / 2;
    Q.ellipse(cx, size + 1, size * 0.48, size * 0.42, "cloth2");
    Q.cylinder(Math.round(cx - 2), Math.round(size * 0.52), 4, 4, "skin", { tone: -1 });
    Q.ellipse(cx, size * 0.4, size * 0.24, size * 0.27, "skin");
    Q.ellipse(cx, size * 0.3, size * 0.27, size * 0.2, "hair", { tone: -1 });
    Q.px(Math.round(cx - 2), Math.round(size * 0.42), "ink", 0);
    Q.px(Math.round(cx + 1), Math.round(size * 0.42), "ink", 0);
  }
  const out = Q.toSprite();
  if (kind === "hero") {
    const g = characterGenerator;
    const rows = g.generate({ ...defaults(g), headwear: "none" }, kit, seed).rows;
    const src = (rows.find((r) => r.name.includes("down")) ?? rows[0]).frames[0];
    const b = bounds(src);
    if (b) {
      // bust crop: centred on the head, starting at the top of the hair
      const cx = Math.round((b.x0 + b.x1) / 2), x0 = cx - (size >> 1), y0 = b.y0 - 1;
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const v = getPx(src, x0 + x, y0 + y);
          if (v) setPx(out, x, y, v);
        }
    }
  }
  return out;
}

// ---------------------------------------------------------------- unit frame
export const UNIT_W = 80, UNIT_H = 30;

export function drawUnitFrame(kit: StyleKit, skinId: string, p: Params, seed: number, width: number): Sprite {
  const sk = skinOf(skinId);
  const W = width, H = UNIT_H;
  const P = new Painter(W, H, kit);
  const name = String(p.name), px0 = 29, bw = W - px0;
  // name plate
  mmoFrame(P, px0, 0, bw, 10, sk, { rim: 1, round: true });
  barAt(P, px0, 11, bw, 8, sk, "cloth2", pct(p.hp, 75));
  barAt(P, px0, 19, bw, 8, sk, "cloth", pct(p.mp, 60));
  // slim XP strip
  P.rect(px0, 27, bw, 3, "ink", 0);
  P.rect(px0 + 1, 28, bw - 2, 1, WELL, 1);
  P.rect(px0 + 1, 28, Math.round((bw - 2) * pct(p.xp, 35)), 1, "accent", 4);
  mmoFrame(P, 0, 0, 28, 28, sk, { rim: 2, round: true, well: 0 });
  drawText(P, px0 + 3, 3, name.slice(0, Math.floor((bw - 6 + 1) / 4)), sk.text[0], sk.text[1]);
  const out = P.toSprite();
  const portrait = String(p.portrait);
  if (portrait !== "none") blit(out, portraitSprite(kit, portrait, seed, 20), 4, 4);
  // level badge: lit gold dome, ink ring, dark numerals
  const B = new Painter(13, 13, kit);
  disc(B, 6.5, 6.5, 6.4, "ink", 0);
  B.ellipse(6.5, 6.5, 5.4, 5.4, sk.rim === "metal" ? "gold" : sk.rim, { flat: 0.3 });
  const lvl = String(Math.round(Math.max(1, Math.min(99, Number(p.level)))));
  drawText(B, Math.round(6.5 - textWidth(lvl) / 2), 4, lvl, "ink", 0);
  blit(out, B.toSprite(), 18, 17);
  return out;
}

// ---------------------------------------------------------------- minimap
export function drawMinimap(kit: StyleKit, skinId: string, size: number, round: boolean): { sprite: Sprite; map: Rect & { round: boolean } } {
  const sk = skinOf(skinId);
  const P = new Painter(size, size, kit);
  const c = size / 2, R = size / 2;
  const inset = size >= 40 ? 5 : 4;
  let map: Rect;
  if (!round) {
    map = mmoFrame(P, 0, 0, size, size, sk, { rim: 2, round: true, well: 1 });
  } else {
    P.ellipse(c, c, R, R, sk.rim, { flat: 0.6 });
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
        if (d > R - 0.9 && d <= R) P.px(x, y, "ink", 0); // outer line
        else if (d >= R - inset && d < R - inset + 1) P.px(x, y, "ink", 0); // liner
        else if (d < R - inset) P.px(x, y, WELL, 1);
      }
    map = { x: inset, y: inset, w: size - inset * 2, h: size - inset * 2 };
  }
  // map window: rolling terrain, a pond and a path so the glass reads as a world view
  const inside = (x: number, y: number) => !round || Math.hypot(x + 0.5 - c, y + 0.5 - c) < R - inset;
  for (let y = map.y; y < map.y + map.h; y++)
    for (let x = map.x; x < map.x + map.w; x++) {
      if (!inside(x, y)) continue;
      const v = Math.sin(x * 0.55) + Math.cos(y * 0.5) + Math.sin((x + y) * 0.3);
      const pond = Math.hypot(x - c * 0.55, y - c * 1.3) < size * 0.14;
      const path = Math.abs(y - (c + 3 + Math.sin(x * 0.25) * 3)) < 1.3 && x > c;
      if (pond) P.px(x, y, "water", 2);
      else if (path) P.px(x, y, "dirt", 3);
      else P.px(x, y, "foliage", v > 0.9 ? 2 : v < -1.1 ? 0 : 1);
    }
  // inner shadow under the lip
  for (let i = 0; i < size; i++) for (const [x, y] of [[i, map.y], [map.x, i]])
    if (x >= map.x && x < map.x + map.w && y >= map.y && y < map.y + map.h && inside(x, y)) P.px(x, y, "foliage", 0);
  // player arrow with ink outline, compass stud on the rim
  const ax = Math.floor(c), ay = Math.floor(c);
  P.rect(ax - 2, ay - 1, 5, 4, "ink", 0);
  P.px(ax, ay - 2, "ink", 0);
  P.rect(ax - 1, ay, 3, 2, "ui", 4);
  P.px(ax, ay - 1, "ui", 4);
  P.px(ax - 1, ay + 1, "ui", 3); P.px(ax + 1, ay + 1, "ui", 3);
  P.rect(ax - 1, 0, 3, 2, "ink", 0);
  P.px(ax, 0, ...sk.stud); P.px(ax, 1, ...sk.stud);
  return { sprite: P.toSprite(), map: { ...map, round } };
}

// ---------------------------------------------------------------- skill bar
const KEYS = "1234567890-=";
const GEMS: Material[] = ["cloth2", "water", "foliage", "gold", "accent", "cloth", "roof", "metal", "sand", "grass", "stone", "leather"];
export const SLOT = 20;

function dimPixel(s: Sprite, x: number, y: number, by: number) {
  const d = decodeIndex(getPx(s, x, y));
  if (d) setPx(s, x, y, colorIndex(d.mat, Math.max(0, d.level - by)));
}

/** Darken the clockwise-from-12 sweep covering `frac` (0..1) of a slot's well. */
function sweep(s: Sprite, r: Rect, frac: number) {
  if (frac <= 0) return;
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      let a = Math.atan2(x + 0.5 - cx, -(y + 0.5 - cy));
      if (a < 0) a += Math.PI * 2;
      if (a >= (1 - frac) * Math.PI * 2 - 1e-6 || frac >= 1) dimPixel(s, x, y, 2);
    }
}

function slotAt(P: Painter, x: number, y: number, sk: Skin, i: number, icons: boolean, key: boolean) {
  const well = mmoFrame(P, x, y, SLOT, SLOT, sk, { rim: 1, round: true, well: 0, sunk: true });
  if (icons) {
    const m = GEMS[i % GEMS.length], cx = well.x + well.w / 2, cy = well.y + well.h / 2;
    disc(P, cx, cy, 5.8, "ink", 0);
    P.ellipse(cx, cy, 4.8, 4.8, m);
    P.px(Math.floor(cx - 2), Math.floor(cy - 2), m, 4); // glint
  }
  if (key) {
    const ch = KEYS[i % KEYS.length];
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1]]) drawText(P, x + SLOT - 5 + dx, y + SLOT - 7 + dy, ch, "ink", 0);
    drawText(P, x + SLOT - 5, y + SLOT - 7, ch, "ui", 4);
  }
  return well;
}

export function drawSkillBar(kit: StyleKit, skinId: string, n: number, cooldown: number): { bar: Sprite; sweepFrames: Sprite[]; wells: Rect[] } {
  const sk = skinOf(skinId);
  const gap = 2, pad = 3;
  const W = pad * 2 + n * SLOT + (n - 1) * gap, H = SLOT + pad * 2;
  const P = new Painter(W, H, kit);
  mmoFrame(P, 0, 0, W, H, sk, { rim: 1, round: true, well: 0 });
  const wells: Rect[] = [];
  for (let i = 0; i < n; i++) wells.push(slotAt(P, pad + i * (SLOT + gap), pad, sk, i, true, true));
  const bar = P.toSprite();
  if (cooldown > 0 && n > 1) sweep(bar, wells[1], cooldown / 8);
  const sweepFrames: Sprite[] = [];
  for (let k = 0; k <= 8; k++) {
    const S = new Painter(SLOT, SLOT, kit);
    const w = slotAt(S, 0, 0, sk, 0, true, true);
    const sp = S.toSprite();
    sweep(sp, w, k / 8);
    sweepFrames.push(sp);
  }
  return { bar, sweepFrames, wells };
}

// ---------------------------------------------------------------- chat
const CHAT_LINES: [string, Material, number][] = [
  ["SYSTEM: QUEST DONE", "gold", 4],
  ["WORLD: RAID TONIGHT?", "ui", 4],
  ["PARTY: ON MY WAY", "water", 4],
  ["LYRA: THANKS!", "foliage", 4],
  ["WORLD: WTS POTIONS", "ui", 3],
  ["PARTY: PULL WOLVES", "water", 4],
];

export function drawChat(kit: StyleKit, skinId: string, w: number, h: number): Sprite {
  const sk = skinOf(skinId);
  const P = new Painter(w, h, kit);
  const well = mmoFrame(P, 0, 0, w, h, sk, { rim: 2, round: true, well: 1 });
  // translucent look: dark checkerboard over the panel colour, fading out toward the top
  for (let y = well.y + 1; y < well.y + well.h; y++)
    for (let x = well.x; x < well.x + well.w; x++) if ((x + y) % 2 === 0) P.px(x, y, WELL, 0);
  const inputH = 9;
  const iy = well.y + well.h - inputH - 1;
  P.rect(well.x, iy - 1, well.w, 1, "ink", 0);
  P.rect(well.x, iy, well.w, inputH + 1, WELL, 0);
  P.rect(well.x + 1, iy + 1, well.w - 2, inputH - 1, WELL, 1);
  drawText(P, well.x + 3, iy + 2, ">", sk.text[0], sk.text[1]);
  P.rect(well.x + 8, iy + 2, 1, 5, "ui", 4); // caret
  const maxChars = Math.floor((well.w - 4 + 1) / 4);
  const rows = Math.max(0, Math.floor((iy - 2 - (well.y + 1)) / 7));
  const lines = CHAT_LINES.slice(0, rows);
  lines.forEach(([t, m, lv], i) => {
    const y = iy - 2 - (lines.length - i) * 7 + 2;
    drawText(P, well.x + 2, y + 1, t.slice(0, maxChars), "ink", 0);
    drawText(P, well.x + 2, y, t.slice(0, maxChars), m, lv);
  });
  return P.toSprite();
}

// ---------------------------------------------------------------- quest tracker
export function drawQuestTracker(kit: StyleKit, skinId: string): Sprite {
  const sk = skinOf(skinId);
  const W = 76, H = 46;
  const P = new Painter(W, H, kit);
  const well = mmoFrame(P, 0, 0, W, H, sk, { rim: 2, round: true, well: 1 });
  drawText(P, well.x + 2, well.y + 2, "QUESTS", sk.text[0], sk.text[1]);
  P.rect(well.x + 1, well.y + 9, well.w - 2, 1, sk.rim, sk.lo);
  P.rect(well.x + 1, well.y + 10, well.w - 2, 1, "ink", 0);
  const quests: [string, boolean][] = [["SLAY SLIMES 3/5", false], ["FIND THE KEY", false], ["TALK TO MAYOR", true]];
  quests.forEach(([t, done], i) => {
    const y = well.y + 13 + i * 8;
    if (done) { // green tick
      P.px(well.x + 2, y + 3, "foliage", 4); P.px(well.x + 3, y + 4, "foliage", 4);
      P.px(well.x + 4, y + 3, "foliage", 4); P.px(well.x + 5, y + 2, "foliage", 4); P.px(well.x + 6, y + 1, "foliage", 4);
    } else {
      P.rect(well.x + 3, y + 1, 2, 3, "gold", 4);
      P.px(well.x + 3, y + 3, "gold", 3); P.px(well.x + 4, y + 3, "gold", 3);
    }
    drawText(P, well.x + 8, y, t, "ui", done ? 3 : 4);
  });
  return P.toSprite();
}

// ---------------------------------------------------------------- tooltip
export function drawTooltip(kit: StyleKit, skinId: string, rarity: string, name: string, w: number, h: number): Sprite {
  const sk = skinOf(skinId);
  const P = new Painter(w, h, kit);
  const well = mmoFrame(P, 0, 0, w, h, sk, { rim: 1, round: true, well: 0 });
  const rm = RARITY_MAT[rarity] ?? "ui";
  P.rect(well.x, well.y, well.w, 1, rm, 3); // rarity strip
  drawText(P, well.x + 3, well.y + 3, name.slice(0, Math.floor((well.w - 6 + 1) / 4)), rm, 4);
  P.rect(well.x + 2, well.y + 10, well.w - 4, 1, "ui", 1);
  drawText(P, well.x + 3, well.y + 12, "LV 12", "ui", 3);
  drawText(P, well.x + 3, well.y + 19, "ATK +12", "foliage", 4);
  if (h >= 36) drawText(P, well.x + 3, well.y + 26, "DEF +4", "foliage", 4);
  return P.toSprite();
}

// ---------------------------------------------------------------- nameplate
function outlined(P: Painter, x: number, y: number, text: string, m: Material, lv: number) {
  for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) drawText(P, x + dx, y + dy, text, "ink", 0);
  drawText(P, x, y, text, m, lv);
}

export function drawNameplate(kit: StyleKit, skinId: string, name: string, level: number, tone: string, hp: number): Sprite {
  const sk = skinOf(skinId);
  const text = `${name} LV${level}`.slice(0, 14);
  const W = Math.max(30, textWidth(text) + 4), H = 15;
  const P = new Painter(W, H, kit);
  outlined(P, Math.floor((W - textWidth(text)) / 2), 2, text, TONE_MAT[tone] ?? "ui", 4);
  const bw = W - 4;
  mmoFrame(P, 2, 9, bw, 6, sk, { rim: 1, round: false, well: 1 });
  P.rect(4, 11, bw - 4, 2, WELL, 1);
  const f = Math.round((bw - 4) * hp);
  if (f > 0) { P.rect(4, 11, f, 1, "cloth2", 4); P.rect(4, 12, f, 1, "cloth2", 2); }
  return P.toSprite();
}

// ---------------------------------------------------------------- damage numbers
function bigText(P: Painter, x: number, y: number, text: string, m: Material, s: number, lv = 4) {
  let cx = x;
  for (const ch of text) {
    glyph(ch).forEach((row, j) => row.forEach((on, i) => {
      if (!on) return;
      for (let k = 0; k < s; k++) for (let l = 0; l < s; l++) P.px(cx + i * s + l, y + j * s + k, m, lv === 4 && s > 1 && j >= 3 ? 3 : lv);
    }));
    cx += (3 + 1) * s;
  }
}

/** Floating number pop: rises over 4 frames. Crit = 2x glyphs. */
export function drawDamage(kit: StyleKit, amount: number, tone: string, crit: boolean): Sprite[] {
  const m = TONE_MAT[tone] ?? "ui";
  const s = crit ? 2 : 1;
  const text = amount <= 0 ? "MISS" : `${tone === "green" ? "+" : ""}${Math.round(amount)}`;
  const W = textWidth(text) * s + (crit ? 4 : 2) + 2, H = GLYPH_H * s + 2 + 2 + 6;
  const frames: Sprite[] = [];
  for (const rise of [0, 2, 4, 5]) {
    const P = new Painter(W, H, kit);
    const x = 1 + (crit ? 1 : 0), y = H - 3 - GLYPH_H * s - rise;
    // outline: glyph stamped in ink around (1px), then the coloured face with a darker lower half
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]])
      bigText(P, x + dx, y + dy, text, "ink", s, 0);
    bigText(P, x, y, text, m, s);
    frames.push(P.toSprite());
  }
  return frames;
}

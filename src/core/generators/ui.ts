import { finalize } from "../enforce";
import { drawText, textWidth } from "../font";
import { Painter } from "../painter";
import type { Material } from "../palette";
import { rng } from "../rng";
import { blit } from "../sprite";
import type { FrameSet, Sprite, StyleKit } from "../types";
import { drawChat, drawDamage, drawMinimap, drawNameplate, drawQuestTracker, drawSkillBar, drawTooltip, drawUnitFrame, isMmoSkin, skinOf, mmoBar, mmoButton, mmoPanel, MMO_KINDS, MMO_NAMES, MMO_PORTRAITS, MMO_RARITY, MMO_TONES, UI_SKINS } from "./ui-mmo";
import { mat, num, PAINT, str, type GenResult, type Generator } from "./types";

export const UI_KINDS = ["button", "panel", "slot", "bar", "icon-frame", "cursor", "tab", "checkbox", "dialog-arrow", "clock", "time-panel", "weather-icon", "season-icon", "date-panel", ...MMO_KINDS] as const;
export const UI_STYLES = ["bevel", "flat", "inset", "ornate"] as const;
type Style = (typeof UI_STYLES)[number];

/** [material, ramp level] — UI uses explicit levels so bevels stay crisp on every palette. */
type C = [Material, number];

const UI_MATS: Material[] = ["ui", ...PAINT];

/** Auto size, min and max for each sized kind (design grid = 16px UI size). */
const SIZES: Record<string, { w: number; h: number; minW: number; maxW: number; minH: number; maxH: number }> = {
  button: { w: 48, h: 16, minW: 16, maxW: 128, minH: 10, maxH: 40 },
  panel: { w: 48, h: 40, minW: 16, maxW: 192, minH: 16, maxH: 192 },
  slot: { w: 18, h: 18, minW: 10, maxW: 64, minH: 10, maxH: 64 },
  bar: { w: 48, h: 8, minW: 16, maxW: 192, minH: 5, maxH: 24 },
  "icon-frame": { w: 20, h: 20, minW: 12, maxW: 64, minH: 12, maxH: 64 },
  tab: { w: 32, h: 14, minW: 16, maxW: 96, minH: 10, maxH: 32 },
  checkbox: { w: 12, h: 12, minW: 8, maxW: 32, minH: 8, maxH: 32 },
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

function sizeFor(kind: string, p: Record<string, unknown>, kit: StyleKit): [number, number] {
  const s = SIZES[kind];
  const k = kit.sizes.ui / 16;
  const rw = Number(p.width), rh = Number(p.height);
  const w = Number.isFinite(rw) && rw > 0 ? rw : Math.round(s.w * k);
  const h = Number.isFinite(rh) && rh > 0 ? rh : Math.round(s.h * k);
  return [clamp(w, s.minW, s.maxW), clamp(h, s.minH, s.maxH)];
}

interface Surface {
  border: C;
  fill: C;
  hi: C;
  lo: C;
  /** false = sunken: the light and shadow edges swap. */
  raised: boolean;
  /** knock the 4 outer corner pixels out for a rounded look. */
  round: boolean;
  /** lighter colour for the lit upper half of the body (2-tone). */
  top?: C;
}

/**
 * Bevelled rectangle: 1px ink border, 1px light edge on the side the kit's light comes from,
 * 1px shadow edge opposite, flat fill. Sunken surfaces swap the edges.
 */
function surface(P: Painter, x: number, y: number, w: number, h: number, s: Surface) {
  const side = P.lightSide;
  const hi = s.raised ? s.hi : s.lo, lo = s.raised ? s.lo : s.hi;
  P.rect(x, y, w, h, ...s.border);
  P.rect(x + 1, y + 1, w - 2, h - 2, ...s.fill);
  if (s.top && h >= 8) P.rect(x + 1, y + 1, w - 2, Math.floor((h - 2) / 2), ...s.top);
  if (side !== 0 && h > 4) {
    P.rect(x + 1, y + 2, 1, h - 4, ...(side < 0 ? hi : lo)); // left column
    P.rect(x + w - 2, y + 2, 1, h - 4, ...(side < 0 ? lo : hi)); // right column
  }
  P.rect(x + 1, y + 1, w - 2, 1, ...hi); // top row (lit)
  P.rect(x + 1, y + h - 2, w - 2, 1, ...lo); // bottom row (shade)
  if (s.round) {
    P.erase(x, y); P.erase(x + w - 1, y); P.erase(x, y + h - 1); P.erase(x + w - 1, y + h - 1);
  }
}

/** A gold double rim with corner studs; interior inset by `ornateInset`. */
const ORNATE_INSET = 4;
function ornate(P: Painter, x: number, y: number, w: number, h: number, accent: Material, inner: C, innerRaised: boolean, ink: Material) {
  surface(P, x, y, w, h, { border: [ink, 0], fill: [accent, 3], hi: [accent, 4], lo: [accent, 2], raised: true, round: true });
  surface(P, x + 2, y + 2, w - 4, h - 4, { border: [ink, 0], fill: inner, hi: [inner[0], Math.min(4, inner[1] + 1)], lo: [inner[0], Math.max(0, inner[1] - 1)], raised: innerRaised, round: false });
  // corner studs
  for (const [cx, cy] of [[x + 1, y + 1], [x + w - 2, y + 1], [x + 1, y + h - 2], [x + w - 2, y + h - 2]]) P.px(cx, cy, accent, 4);
  // brass gussets where the inner frame meets the rim (inside the 4px corner)
  if (w >= 10 && h >= 10)
    for (const [cx, cy] of [[x + 2, y + 2], [x + w - 3, y + 2], [x + 2, y + h - 3], [x + w - 3, y + h - 3]]) P.px(cx, cy, accent, 2);
}

/** Inner border line + darker inset area inside a surface (uniform along each edge, so 9-slice safe). */
function insetWell(P: Painter, x: number, y: number, w: number, h: number, m: Material, base: number) {
  if (w < 10 || h < 10) return;
  const side = P.lightSide;
  const wx = x + 2, wy = y + 2, ww = w - 4, wh = h - 4;
  const lit = Math.max(0, base - 2), edge = Math.min(4, base + 1);
  P.rect(wx, wy, ww, wh, m, Math.max(0, base - 1));
  P.rect(wx, wy, ww, 1, m, lit); // lip shadow on the lit (top) side
  P.rect(wx, wy + wh - 1, ww, 1, m, edge); // catch-light at the bottom
  P.rect(side > 0 ? wx + ww - 1 : wx, wy, 1, wh, m, lit);
  P.rect(side > 0 ? wx : wx + ww - 1, wy + 1, 1, wh - 2, m, side === 0 ? lit : edge);
}

/** Centred "label bar": one or two short rounded strokes standing in for text; shifts when pressed. */
function label(P: Painter, cx: number, cy: number, maxLen: number, m: Material, seed: number, lvl = 4, shadow: number | false = 0, twoLine = false) {
  const r = rng(seed);
  const len1 = Math.max(4, Math.min(maxLen, Math.round(maxLen * (0.6 + r.next() * 0.15))));
  const stroke = (len: number, y: number) => {
    const x = Math.round(cx - len / 2);
    if (shadow !== false) P.rect(x + 1, y + 1, len - 1, 1, m, shadow);
    P.rect(x, y, len, 1, m, lvl);
    P.px(x, y, m, lvl === 0 ? 1 : Math.max(1, lvl - 1)); // rounded ends
    P.px(x + len - 1, y, m, lvl === 0 ? 1 : Math.max(1, lvl - 1));
  };
  if (twoLine) {
    stroke(len1, cy - 1);
    stroke(Math.max(3, Math.round(len1 * 0.55)), cy + 2);
  } else stroke(len1, cy);
}

interface Ctx {
  kit: StyleKit;
  m: Material;
  a: Material;
  style: Style;
  seed: number;
}

// ---------------------------------------------------------------- button
function drawButton(c: Ctx, w: number, h: number, state: "normal" | "hover" | "pressed"): Sprite {
  const P = new Painter(w, h, c.kit);
  const { m, a, style } = c;
  const hover = state === "hover";
  const pressed = state === "pressed";
  const l = hover ? 1 : 0; // hover lifts the whole ramp one step; label stays at the top of the ramp for contrast
  const base: C = [m, (style === "inset" ? 1 : 2) + l];
  const top: C = [m, Math.min(4, base[1] + 1)];
  const raised = !pressed && style !== "inset";
  const dy = pressed ? 1 : 0;
  if (style === "ornate") {
    ornate(P, 0, 0, w, h, a, [m, 2 + l], raised, m);
  } else if (style === "flat") {
    const f = pressed ? base : top;
    surface(P, 0, 0, w, h, { border: [m, 0], fill: pressed ? base : base, top: pressed ? undefined : top, hi: f, lo: base, raised: true, round: true });
  } else {
    surface(P, 0, 0, w, h, {
      border: [m, 0], fill: base, top: pressed || !raised ? undefined : top,
      hi: [m, Math.min(4, 3 + l)], lo: [m, 1 + l - (hover ? 1 : 0)], raised, round: true,
    });
  }
  const inner = style === "ornate" ? ORNATE_INSET : 3;
  const pips = w >= 24;
  const maxLen = w - inner * 2 - 2 - (pips ? 8 : 0);
  label(P, Math.floor(w / 2), Math.floor(h / 2) - 1 + dy, maxLen, style === "ornate" && !hover ? a : m, c.seed, hover ? 0 : 4, hover ? 4 : 0, h >= 14);
  if (pips) {
    // accent rivet at each end of the button (lights up on hover)
    const my = Math.floor(h / 2) - 1 + dy + (h >= 14 ? 0 : 0);
    for (const px of [inner + 1, w - inner - 3]) {
      P.rect(px, my, 2, 1, a, 4);
      P.rect(px, my + 1, 2, 1, a, hover ? 3 : 2);
    }
  }
  return P.toSprite();
}

// ---------------------------------------------------------------- panel / slot / icon-frame
function drawFrame(c: Ctx, w: number, h: number, kind: "panel" | "slot" | "icon-frame"): Sprite {
  const P = new Painter(w, h, c.kit);
  const { m, a, style } = c;
  if (kind === "slot") {
    // slots are recessed by nature; style tweaks the depth/trim
    if (style === "ornate") ornate(P, 0, 0, w, h, a, [m, 1], false, m);
    else if (style === "flat") surface(P, 0, 0, w, h, { border: [m, 0], fill: [m, 1], hi: [m, 1], lo: [m, 1], raised: true, round: true });
    else if (style === "inset") surface(P, 0, 0, w, h, { border: [m, 0], fill: [m, 0], hi: [m, 2], lo: [m, 1], raised: false, round: true });
    else surface(P, 0, 0, w, h, { border: [m, 0], fill: [m, 1], hi: [m, 3], lo: [m, 0], raised: false, round: true });
    return P.toSprite();
  }
  if (kind === "icon-frame") {
    // metallic accent ring around a dark well
    const ring = style === "flat" ? 3 : 3;
    surface(P, 0, 0, w, h, { border: [m, 0], fill: [a, ring], hi: [a, 4], lo: [a, 2], raised: style !== "inset", round: true });
    surface(P, 2, 2, w - 4, h - 4, { border: [a, style === "flat" ? 2 : 1], fill: [m, 1], hi: [m, 2], lo: [m, 0], raised: false, round: false });
    if (style === "ornate") for (const [cx, cy] of [[1, 1], [w - 2, 1], [1, h - 2], [w - 2, h - 2]]) P.px(cx, cy, a, 4);
    return P.toSprite();
  }
  // panel
  if (style === "ornate") ornate(P, 0, 0, w, h, a, [m, 3], true, m);
  else if (style === "flat") surface(P, 0, 0, w, h, { border: [m, 0], fill: [m, 3], hi: [m, 3], lo: [m, 3], raised: true, round: true });
  else if (style === "inset") surface(P, 0, 0, w, h, { border: [m, 0], fill: [m, 2], hi: [m, 3], lo: [m, 0], raised: false, round: true });
  else surface(P, 0, 0, w, h, { border: [m, 0], fill: [m, 3], hi: [m, 4], lo: [m, 1], raised: true, round: true });
  if (style !== "ornate") insetWell(P, 0, 0, w, h, m, style === "inset" ? 2 : 3);
  else insetWell(P, 2, 2, w - 4, h - 4, m, 3);
  return P.toSprite();
}

function nineSlice(style: Style, w: number, h: number) {
  const want = style === "ornate" ? ORNATE_INSET : 3;
  const s = Math.max(1, Math.min(want, Math.floor((Math.min(w, h) - 1) / 2)));
  return { left: s, top: s, right: s, bottom: s };
}

// ---------------------------------------------------------------- bar
/** Ornate bars need a taller channel: default their auto height to 10px. */
function ornateBarP(p: Record<string, unknown>, style: Style): Record<string, unknown> {
  return style === "ornate" && !(Number(p.height) > 0) ? { ...p, height: 10 } : p;
}
function drawBar(c: Ctx, w: number, h: number): { frame: Sprite; fill: Sprite; fillRect: { x: number; y: number; w: number; h: number } } {
  const { m, a, style } = c;
  const pad = style === "ornate" && h >= 10 ? 3 : 2;
  const fx = pad, fy = pad, fw = w - pad * 2, fh = h - pad * 2;
  const F = new Painter(w, h, c.kit);
  if (style === "ornate") ornate(F, 0, 0, w, h, a, [m, 0], false, m);
  else if (style === "flat") surface(F, 0, 0, w, h, { border: [m, 0], fill: [m, 1], hi: [m, 1], lo: [m, 1], raised: true, round: true });
  else if (style === "inset") surface(F, 0, 0, w, h, { border: [m, 0], fill: [m, 0], hi: [m, 2], lo: [m, 1], raised: false, round: true });
  else surface(F, 0, 0, w, h, { border: [m, 0], fill: [m, 1], hi: [m, 3], lo: [m, 0], raised: false, round: true });
  // empty trough so the fill sits in a visible channel
  F.rect(fx, fy, fw, fh, m, 0);
  const T = F.toSprite();
  const G = new Painter(w, h, c.kit);
  if (fw > 0 && fh > 0) {
    G.rect(fx, fy, fw, fh, a, 3);
    G.rect(fx, fy, fw, 1, a, 4); // lit top
    if (fh >= 3) G.rect(fx, fy + fh - 1, fw, 1, a, 2); // shaded bottom
    if (fh >= 5) G.rect(fx, fy + fh - 2, fw, 1, a, 2);
    // lit end cap on the side facing the light
    const capX = G.lightSide <= 0 ? fx : fx + fw - 1;
    if (fw > 2) G.rect(capX, fy, 1, fh, a, 4);
  }
  return { frame: T, fill: G.toSprite(), fillRect: { x: fx, y: fy, w: fw, h: fh } };
}

// ---------------------------------------------------------------- cursor
const CURSOR = [
  "X...........",
  "XX..........",
  "XOX.........",
  "XOOX........",
  "XOOOX.......",
  "XOOOOX......",
  "XOOOOOX.....",
  "XOOOOOOX....",
  "XOOOOOOOX...",
  "XOOOOOXXXX..",
  "XOOXOOX.....",
  "XOX.XOOX....",
  "XX..XOOX....",
  "X....XOOX...",
  ".....XOOX...",
  "......XX....",
];

function drawCursor(c: Ctx): Sprite {
  const P = new Painter(12, 16, c.kit);
  const m = c.m;
  const flip = P.lightSide > 0;
  CURSOR.forEach((row, y) => {
    for (let x = 0; x < 12; x++) {
      const ch = row[x];
      if (ch === ".") continue;
      if (ch === "X") { P.px(x, y, m, 0); continue; }
      // fill: shadow on the side away from the light
      const away = row[flip ? x - 1 : x + 1];
      P.px(x, y, m, away === "X" && x > 1 ? 3 : 4);
    }
  });
  if (c.style === "ornate") P.px(1, 1, c.a, 3); // tiny coloured tip
  return P.toSprite();
}

// ---------------------------------------------------------------- tab
function drawTab(c: Ctx, w: number, h: number, active: boolean): Sprite {
  const P = new Painter(w, h, c.kit);
  const { m, a } = c;
  const top = active ? 0 : 2;
  const fill: C = [m, active ? 2 : 1];
  const hi: C = [m, active ? 3 : 2], lo: C = [m, active ? 1 : 0];
  surface(P, 0, top, w, h - top, { border: [m, 0], fill, hi, lo, raised: true, round: true });
  // open the bottom so the active tab merges with the panel below; inactive keeps a closed base
  if (active) {
    P.rect(1, h - 1, w - 2, 1, ...fill);
    P.rect(1, h - 2, w - 2, 1, ...fill);
    if (c.style === "ornate") P.rect(1, top + 1, w - 2, 1, a, 4);
  }
  label(P, Math.floor(w / 2), top + Math.floor((h - top) / 2) - 1, w - 8, m, c.seed, active ? 4 : 3, active ? 0 : false);
  return P.toSprite();
}

// ---------------------------------------------------------------- checkbox
function drawCheckbox(c: Ctx, n: number, on: boolean): Sprite {
  const P = new Painter(n, n, c.kit);
  const { m, a, style } = c;
  if (style === "ornate") ornate(P, 0, 0, n, n, a, [m, 1], false, m);
  else if (style === "flat") surface(P, 0, 0, n, n, { border: [m, 0], fill: [m, 1], hi: [m, 1], lo: [m, 1], raised: true, round: true });
  else surface(P, 0, 0, n, n, { border: [m, 0], fill: [m, 1], hi: [m, 3], lo: [m, 0], raised: false, round: true });
  if (on) {
    const s = n / 12;
    const pt = (x: number, y: number): [number, number] => [Math.round(x * s), Math.round(y * s)];
    const [x0, y0] = pt(3, 6), [x1, y1] = pt(5, 8), [x2, y2] = pt(9, 3);
    for (const dy of [0, 1]) {
      P.line(x0, y0 + dy, x1, y1 + dy, a, dy ? 3 : 4);
      P.line(x1, y1 + dy, x2, y2 + dy, a, dy ? 3 : 4);
    }
  }
  return P.toSprite();
}

// ---------------------------------------------------------------- dialog arrow
function drawArrow(c: Ctx, bounce: number): Sprite {
  const W = 11, H = 9;
  const P = new Painter(W, H, c.kit);
  const m = c.style === "ornate" ? c.a : c.m;
  const y0 = 1 + bounce;
  const flip = P.lightSide > 0;
  for (let r = 0; r < 5; r++) {
    const half = 4 - r; // triangle pointing down: 9,7,5,3,1
    const x0 = 5 - half, x1 = 5 + half;
    P.rect(x0, y0 + r, x1 - x0 + 1, 1, m, 0);
    if (r >= 1 && r <= 3) {
      P.rect(x0 + 1, y0 + r, x1 - x0 - 1, 1, m, 4);
      P.px(flip ? x1 - 1 : x0 + 1, y0 + r, m, 4);
      P.px(flip ? x0 + 1 : x1 - 1, y0 + r, m, 3);
    }
  }
  P.rect(1, y0, 9, 1, m, 0);
  return P.toSprite();
}

// ---------------------------------------------------------------- farm HUD (clock, time, weather, season, date)
export const WEATHERS = ["sunny", "cloudy", "rain", "storm", "snow", "windy"] as const;
export const SEASONS = ["spring", "summer", "fall", "winter"] as const;
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const pad2 = (n: number) => String(Math.max(0, Math.round(n))).padStart(2, "0");

/** Icons are lit volumes plus an outline, drawn inside a 16px canvas with a 1px margin. */
function icon(P: Painter, kit: StyleKit): Sprite {
  return finalize(P.toSprite(), kit);
}

function sunDisc(P: Painter, cx: number, cy: number, r: number, f: number) {
  P.ellipse(cx, cy, r, r, "gold", { flat: 0.2 });
  const far = r + 2.5;
  const dirs: [number, number][] = f % 2 ? [[0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dy] of dirs) {
    const x = Math.round(cx - 0.5 + dx * far), y = Math.round(cy - 0.5 + dy * far);
    P.rect(x, y, dx && !dy ? 2 : 1, dy && !dx ? 2 : 1, "gold", 4);
  }
  P.px(Math.round(cx - r * 0.5 - 1), Math.round(cy - r * 0.5 - 1), "gold", 4);
}

function cloudShape(P: Painter, x: number, y: number, m: Material, tone = 0) {
  P.ellipse(x + 4.5, y + 6, 3, 2.8, m, { tone });
  P.ellipse(x + 8, y + 4.5, 3.6, 3.4, m, { tone });
  P.ellipse(x + 11, y + 7, 2.8, 2.4, m, { tone });
  P.box(x + 3, y + 7, 9, 3, m, [0, 0.3, 1], { tone });
}

/** Compact cloud (rows 1-6) that leaves room for a gap row and falling pieces beneath it. */
function smallCloud(P: Painter, m: Material, tone = 0) {
  P.ellipse(5, 5, 2.8, 2.3, m, { tone });
  P.ellipse(8.5, 3.9, 3.4, 2.9, m, { tone });
  P.ellipse(11.5, 5.4, 2.6, 2.1, m, { tone });
  P.box(4, 5, 9, 2, m, [0, 0.3, 1], { tone });
}

/** One falling piece: the outline makes it a 3px-wide blob, so pieces sit 4px apart to stay separate (also at 4 tones). */
function drop(P: Painter, x: number, y: number, m: Material, tall: boolean) {
  P.px(x, y, m, 4);
  if (tall) P.px(x, y + 1, m, 3);
}

function drawWeather(c: Ctx, weather: string, f: number): Sprite {
  const P = new Painter(16, 16, c.kit);
  const cloud = c.m;
  switch (weather) {
    case "sunny":
      sunDisc(P, 8, 8, 3.6, f);
      break;
    case "cloudy":
      cloudShape(P, 1, 0, cloud, 0);
      cloudShape(P, 1, 4, cloud, 1);
      break;
    case "rain":
      smallCloud(P, cloud, 0);
      for (let i = 0; i < 3; i++) drop(P, 3 + i * 4, 11 + ((f + i) % 2), "water", (f + i) % 2 === 0);
      break;
    case "storm":
      smallCloud(P, cloud, -1);
      // bolt hangs from the cloud; a drop on each side
      for (const [x, y] of [[9, 8], [10, 8], [8, 9], [9, 9], [8, 10], [9, 10], [10, 10], [9, 11], [10, 11], [9, 12]]) P.px(x, y, "gold", 4);
      drop(P, 3, 11 + f, "water", true);
      drop(P, 13, 12 - f, "water", true);
      break;
    case "snow":
      smallCloud(P, cloud, 1);
      [[3, 11], [7, 12], [11, 11]].forEach(([x, y]) => P.px(x, y + (f ? (y === 11 ? 1 : -1) : 0), "sand", 4));
      break;
    default: {
      // windy: three gusts four rows apart (outlines would merge at 3), each ending in a small hook
      const sh = f % 2;
      const gust = (x0: number, x1: number, y: number, up: boolean) => {
        P.line(x0 + sh, y, x1 + sh, y, "water", 4);
        P.px(x1 + 1 + sh, y + (up ? -1 : 1), "water", 3);
      };
      gust(2, 9, 3, true); gust(1, 12, 7, true); gust(3, 8, 11, false);
    }
  }
  return icon(P, c.kit);
}

function drawSeason(c: Ctx, season: string): Sprite {
  const P = new Painter(16, 16, c.kit);
  switch (season) {
    case "spring": {
      const petals: [number, number][] = [[0, -3], [2.9, -0.9], [1.8, 2.4], [-1.8, 2.4], [-2.9, -0.9]];
      for (const [dx, dy] of petals) P.ellipse(8 + dx, 8 + dy, 2.4, 2.4, "cloth2", { flat: 0.2 });
      P.ellipse(8, 8, 1.5, 1.5, "gold", { flat: 0.3 });
      P.px(8, 7, "gold", 4);
      break;
    }
    case "summer":
      sunDisc(P, 8, 8, 3.6, 0);
      break;
    case "fall":
      P.poly([[8, 2], [11.5, 5], [12.5, 9], [10, 12.5], [8, 13], [6, 12.5], [3.5, 9], [4.5, 5]], "roof", [0.1, -0.2, 1]);
      P.line(8, 4, 8, 12, "roof", 0);
      P.line(8, 7, 10, 5, "roof", 1); P.line(8, 7, 6, 5, "roof", 1);
      P.line(8, 10, 10, 8, "roof", 1); P.line(8, 10, 6, 8, "roof", 1);
      P.line(8, 13, 8, 14, "leather", 2);
      break;
    default:
      // clean 9x9 flake: axes plus four isolated diagonal tips, symmetric about (8, 8)
      for (let i = -4; i <= 4; i++) { P.px(8 + i, 8, "water", 4); P.px(8, 8 + i, "water", 4); }
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) P.px(8 + sx * 2, 8 + sy * 2, "water", 3);
  }
  return icon(P, c.kit);
}

function drawClock(c: Ctx, hour: number, minute: number, tint: boolean): Sprite {
  const P = new Painter(16, 16, c.kit);
  const night = tint && (hour < 6 || hour >= 19);
  P.ellipse(8, 8, 6.6, 6.6, c.a, { flat: 0.3 });
  P.ellipse(8, 8, 5, 5, c.m, { flat: 1, tone: night ? -2 : 1 });
  const hand = night ? "sand" : "ink", lvl = night ? 4 : 0;
  const hr = (((hour % 12) + minute / 60) / 12) * Math.PI * 2, mn = (minute / 60) * Math.PI * 2;
  const tip = (r: number, a: number): [number, number] => [Math.round(7.5 + Math.sin(a) * r), Math.round(7.5 - Math.cos(a) * r)];
  const [hx, hy] = tip(2.6, hr), [mx, my] = tip(4, mn);
  P.line(7, 7, mx, my, hand, night ? 3 : 1);
  P.line(7, 7, hx, hy, hand, lvl);
  P.rect(7, 7, 2, 2, c.a, 4);
  return icon(P, c.kit);
}

/** Text colour that contrasts with the panel fill for the chosen style. */
const textLevel = (style: Style) => (style === "inset" ? 4 : 0);

function panelBase(P: Painter, c: Ctx, w: number, h: number) {
  const { m, a, style } = c;
  if (style === "ornate") { ornate(P, 0, 0, w, h, a, [m, 3], true, m); return; }
  if (style === "flat") surface(P, 0, 0, w, h, { border: [m, 0], fill: [m, 3], hi: [m, 3], lo: [m, 3], raised: true, round: true });
  else if (style === "inset") surface(P, 0, 0, w, h, { border: [m, 0], fill: [m, 1], hi: [m, 2], lo: [m, 0], raised: false, round: true });
  else surface(P, 0, 0, w, h, { border: [m, 0], fill: [m, 3], hi: [m, 4], lo: [m, 1], raised: true, round: true });
}

function drawTimePanel(c: Ctx, hour: number, minute: number, colon: boolean): Sprite {
  const text = `${pad2(hour)}${colon ? ":" : " "}${pad2(minute)}`;
  const w = textWidth(text) + 10, h = 13;
  const P = new Painter(w, h, c.kit);
  panelBase(P, c, w, h);
  drawText(P, 5, 4, text, c.m, textLevel(c.style));
  return P.toSprite();
}

function drawDatePanel(c: Ctx, day: number, weekday: string, season: string): Sprite {
  const w = 40, h = 22;
  const P = new Painter(w, h, c.kit);
  panelBase(P, c, w, h);
  const lvl = textLevel(c.style);
  drawText(P, 21, 5, weekday.slice(0, 3).toUpperCase(), c.m, lvl);
  drawText(P, 21, 12, pad2(day), c.m, lvl);
  const out = P.toSprite();
  // the season icon carries its own outline, so blit it after quantising
  blit(out, drawSeason(c, season), 3, 3);
  return out;
}

// ---------------------------------------------------------------- generator
export const uiGenerator: Generator = {
  id: "ui",
  category: "ui",
  label: "UI element",
  description:
    "Game UI pieces: button (normal/hover/pressed rows), 9-slice panel, inventory slot, progress bar (frame + fill rows), icon-frame, cursor, tab (inactive/active), checkbox (off/on), dialog-arrow, plus farm HUD: clock (params hour, minute), time-panel (HH:MM), weather-icon (weather sunny|cloudy|rain|storm|snow|windy), season-icon (season), date-panel (day, weekday, season). Style: bevel, flat, inset or ornate. width/height 0 = automatic size.",
  params: [
    { key: "kind", label: "Kind", type: "select", options: [...UI_KINDS], default: "button" },
    { key: "material", label: "Material", type: "material", options: UI_MATS, default: "ui" },
    { key: "accent", label: "Accent (trim, fill, check)", type: "material", options: UI_MATS, default: "gold" },
    { key: "style", label: "Style", type: "select", options: [...UI_STYLES], default: "bevel" },
    { key: "width", label: "Width px (0 = auto)", type: "number", min: 0, max: 192, step: 1, default: 0 },
    { key: "height", label: "Height px (0 = auto)", type: "number", min: 0, max: 192, step: 1, default: 0 },
    { key: "hour", label: "Hour 0-23 (clock, time-panel)", type: "number", min: 0, max: 23, step: 1, default: 12 },
    { key: "minute", label: "Minute 0-59 (clock, time-panel)", type: "number", min: 0, max: 59, step: 1, default: 0 },
    { key: "tint", label: "Night tint on the clock", type: "bool", default: true },
    { key: "weather", label: "Weather (weather-icon)", type: "select", options: [...WEATHERS], default: "sunny" },
    { key: "season", label: "Season (season-icon, date-panel)", type: "select", options: [...SEASONS], default: "spring" },
    { key: "day", label: "Day 1-31 (date-panel)", type: "number", min: 1, max: 31, step: 1, default: 1 },
    { key: "weekday", label: "Weekday (date-panel)", type: "select", options: [...WEEKDAYS], default: "mon" },
    { key: "skin", label: "Skin (wood = classic; mmo-* = glossy MMO HUD, also skins button/panel/slot/bar)", type: "select", options: [...UI_SKINS], default: "wood" },
    { key: "name", label: "Name (unit-frame, tooltip, nameplate)", type: "select", options: [...MMO_NAMES], default: "HERO" },
    { key: "level", label: "Level 1-99 (unit-frame badge, nameplate)", type: "number", min: 1, max: 99, step: 1, default: 12 },
    { key: "hp", label: "HP % (unit-frame, nameplate)", type: "number", min: 0, max: 100, step: 1, default: 75 },
    { key: "mp", label: "MP % (unit-frame)", type: "number", min: 0, max: 100, step: 1, default: 60 },
    { key: "xp", label: "XP % (unit-frame)", type: "number", min: 0, max: 100, step: 1, default: 35 },
    { key: "portrait", label: "Portrait (unit-frame): none, silhouette or hero (head crop of the character generator)", type: "select", options: [...MMO_PORTRAITS], default: "silhouette" },
    { key: "shape", label: "Minimap shape", type: "select", options: ["round", "square"], default: "round" },
    { key: "slots", label: "Skill-bar slots", type: "number", min: 1, max: 12, step: 1, default: 6 },
    { key: "cooldown", label: "Skill-bar cooldown sweep 0-8 (slot 2); a 'sweep' row has all 9 steps", type: "number", min: 0, max: 8, step: 1, default: 0 },
    { key: "rarity", label: "Tooltip rarity", type: "select", options: [...MMO_RARITY], default: "rare" },
    { key: "tone", label: "Damage-number / nameplate tone", type: "select", options: [...MMO_TONES], default: "white" },
    { key: "amount", label: "Damage amount (0 = MISS)", type: "number", min: 0, max: 99999, step: 1, default: 128 },
    { key: "crit", label: "Critical (2x glyphs)", type: "bool", default: false },
  ],
  generate(p, kit, seed): GenResult {
    const kind = (UI_KINDS as readonly string[]).includes(str(p, "kind")) ? str(p, "kind") : "button";
    const style = ((UI_STYLES as readonly string[]).includes(str(p, "style")) ? str(p, "style") : "bevel") as Style;
    const c: Ctx = { kit, m: mat(p, "material"), a: mat(p, "accent"), style, seed };
    const one = (name: string, s: Sprite): FrameSet => ({ name, frames: [s] });
    const skin = isMmoSkin(str(p, "skin")) ? str(p, "skin") : "wood";
    const dim = (d: [number, number], lo: number, hi: number): [number, number] => {
      const w = Number(p.width), h = Number(p.height);
      return [clamp(w > 0 ? w : d[0], lo, hi), clamp(h > 0 ? h : d[1], lo, hi)];
    };

    // glossy MMO kinds (the skin param is ignored by them: they are always mmo-*, default mmo-gold)
    const sk = skin === "wood" ? "mmo-gold" : skin;
    switch (kind) {
      case "unit-frame": {
        const [w] = dim([80, 30], 56, 160);
        return { rows: [one("normal", drawUnitFrame(kit, sk, p, seed, w))], fps: 1 };
      }
      case "minimap-frame": {
        const [w] = dim([44, 44], 24, 96);
        const m = drawMinimap(kit, sk, w, str(p, "shape") !== "square");
        return { rows: [one("normal", m.sprite)], fps: 1, meta: { mapRect: m.map } };
      }
      case "skill-bar": {
        const n = clamp(num(p, "slots"), 1, 12);
        const s = drawSkillBar(kit, sk, n, clamp(num(p, "cooldown"), 0, 8));
        return { rows: [one("bar", s.bar), { name: "sweep", frames: s.sweepFrames }], fps: 8, meta: { slots: s.wells } };
      }
      case "chat-panel": {
        const [w, h] = dim([96, 56], 48, 192);
        return { rows: [one("normal", drawChat(kit, sk, w, Math.max(32, h)))], fps: 1, meta: { nineSlice: { left: 4, top: 4, right: 4, bottom: 4 } } };
      }
      case "quest-tracker":
        return { rows: [one("normal", drawQuestTracker(kit, sk))], fps: 1 };
      case "tooltip": {
        const [w, h] = dim([56, 36], 40, 128);
        return { rows: [one("normal", drawTooltip(kit, sk, str(p, "rarity"), str(p, "name"), w, Math.max(30, h)))], fps: 1 };
      }
      case "nameplate":
        return { rows: [one("normal", drawNameplate(kit, sk, str(p, "name"), Math.round(num(p, "level")), str(p, "tone"), Number(p.hp) / 100))], fps: 1 };
      case "damage-numbers":
        return { rows: [{ name: "pop", frames: drawDamage(kit, num(p, "amount"), str(p, "tone"), Boolean(p.crit)) }], fps: 10 };
    }
    if (skin !== "wood") {
      switch (kind) {
        case "bar": {
          const [w, h] = sizeFor(kind, p, kit);
          const b = mmoBar(kit, skinOf(skin), w, h, mat(p, "accent") === "gold" ? "cloth2" : mat(p, "accent"));
          return { rows: [one("frame", b.frame), one("fill", b.fill)], fps: 1, meta: { fillRect: b.fillRect } };
        }
        case "panel":
        case "slot":
        case "icon-frame": {
          const [w, h] = sizeFor(kind, p, kit);
          return { rows: [one("normal", mmoPanel(kit, skinOf(skin), w, h, kind))], fps: 1, meta: { nineSlice: { left: 3, top: 3, right: 3, bottom: 3 } } };
        }
        case "button": {
          const [w, h] = sizeFor(kind, p, kit);
          return { rows: (["normal", "hover", "pressed"] as const).map((st) => one(st, mmoButton(kit, skinOf(skin), w, h, st))), fps: 1 };
        }
      }
    }
    switch (kind) {
      case "button": {
        const [w, h] = sizeFor(kind, p, kit);
        return { rows: (["normal", "hover", "pressed"] as const).map((st) => one(st, drawButton(c, w, h, st))), fps: 1 };
      }
      case "panel":
      case "slot":
      case "icon-frame": {
        const [w, h] = sizeFor(kind, p, kit);
        return { rows: [one("normal", drawFrame(c, w, h, kind))], fps: 1, meta: { nineSlice: nineSlice(style, w, h) } };
      }
      case "bar": {
        const [w, h] = sizeFor(kind, ornateBarP(p, style), kit);
        const b = drawBar(c, w, h);
        return { rows: [one("frame", b.frame), one("fill", b.fill)], fps: 1, meta: { fillRect: b.fillRect } };
      }
      case "cursor":
        return { rows: [one("normal", drawCursor(c))], fps: 1, meta: { hotspot: { x: 0, y: 0 } } };
      case "tab": {
        const [w, h] = sizeFor(kind, p, kit);
        return { rows: [one("inactive", drawTab(c, w, h, false)), one("active", drawTab(c, w, h, true))], fps: 1 };
      }
      case "checkbox": {
        const [w, h] = sizeFor(kind, p, kit);
        const n = Math.min(w, h);
        return { rows: [one("off", drawCheckbox(c, n, false)), one("on", drawCheckbox(c, n, true))], fps: 1 };
      }
      case "clock":
        return { rows: [one("normal", drawClock(c, num(p, "hour"), num(p, "minute"), Boolean(p.tint)))], fps: 1 };
      case "time-panel": {
        const h = num(p, "hour"), mi = num(p, "minute");
        return { rows: [{ name: "normal", frames: [drawTimePanel(c, h, mi, true), drawTimePanel(c, h, mi, false)] }], fps: 1 };
      }
      case "weather-icon": {
        const wx = (WEATHERS as readonly string[]).includes(str(p, "weather")) ? str(p, "weather") : "sunny";
        return { rows: [{ name: "idle", frames: [0, 1].map((f) => drawWeather(c, wx, f)) }], fps: 2 };
      }
      case "season-icon": {
        const se = (SEASONS as readonly string[]).includes(str(p, "season")) ? str(p, "season") : "spring";
        return { rows: [one("normal", drawSeason(c, se))], fps: 1 };
      }
      case "date-panel": {
        const se = (SEASONS as readonly string[]).includes(str(p, "season")) ? str(p, "season") : "spring";
        return { rows: [one("normal", drawDatePanel(c, Math.round(num(p, "day")), str(p, "weekday"), se))], fps: 1 };
      }
      default:
        return { rows: [{ name: "idle", frames: [drawArrow(c, 0), drawArrow(c, 1)] }], fps: 3 };
    }
  },
};

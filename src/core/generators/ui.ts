import { Painter } from "../painter";
import type { Material } from "../palette";
import { rng } from "../rng";
import type { FrameSet, Sprite, StyleKit } from "../types";
import { mat, PAINT, str, type GenResult, type Generator } from "./types";

export const UI_KINDS = ["button", "panel", "slot", "bar", "icon-frame", "cursor", "tab", "checkbox", "dialog-arrow"] as const;
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

// ---------------------------------------------------------------- generator
export const uiGenerator: Generator = {
  id: "ui",
  category: "ui",
  label: "UI element",
  description:
    "Game UI pieces: button (normal/hover/pressed rows), 9-slice panel, inventory slot, progress bar (frame + fill rows), icon-frame, cursor, tab (inactive/active), checkbox (off/on), dialog-arrow. Style: bevel, flat, inset or ornate. width/height 0 = automatic size.",
  params: [
    { key: "kind", label: "Kind", type: "select", options: [...UI_KINDS], default: "button" },
    { key: "material", label: "Material", type: "material", options: UI_MATS, default: "ui" },
    { key: "accent", label: "Accent (trim, fill, check)", type: "material", options: UI_MATS, default: "gold" },
    { key: "style", label: "Style", type: "select", options: [...UI_STYLES], default: "bevel" },
    { key: "width", label: "Width px (0 = auto)", type: "number", min: 0, max: 192, step: 1, default: 0 },
    { key: "height", label: "Height px (0 = auto)", type: "number", min: 0, max: 192, step: 1, default: 0 },
  ],
  generate(p, kit, seed): GenResult {
    const kind = (UI_KINDS as readonly string[]).includes(str(p, "kind")) ? str(p, "kind") : "button";
    const style = ((UI_STYLES as readonly string[]).includes(str(p, "style")) ? str(p, "style") : "bevel") as Style;
    const c: Ctx = { kit, m: mat(p, "material"), a: mat(p, "accent"), style, seed };
    const one = (name: string, s: Sprite): FrameSet => ({ name, frames: [s] });

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
      default:
        return { rows: [{ name: "idle", frames: [drawArrow(c, 0), drawArrow(c, 1)] }], fps: 3 };
    }
  },
};

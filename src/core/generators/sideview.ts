// Side-view (platformer) pieces: ground autotile set, one-way platform, ladder, 45 degree slopes,
// a facade building and parallax background layers. Everything uses the kit's tile size and the lit
// Painter, so it lines up with the side humanoid (`humanoid-side`) and the `sidelevel` map.
//
// Tiles are not outlined. They are opaque except for the rounded outer corners of the edge tiles,
// the slope's empty half, the platform and the ladder. `ground-top`, `ground-fill` and the walls
// tile horizontally / vertically (noise lattices and scatter positions wrap on the tile size).
// Background layers tile left-right: ridges are sums of sines with whole periods, trees and clouds
// are drawn again one canvas width to either side.
import { finalize } from "../enforce";
import { proportions } from "../kit";
import { Painter } from "../painter";
import { colorIndex, type Material } from "../palette";
import { hashString, rng, valueNoise, type Rng } from "../rng";
import { createSprite, setPx } from "../sprite";
import type { Sprite, StyleKit } from "../types";
import { bool, mat, num, str, type GenResult, type Generator, type Params } from "./types";

export const GROUND_TILE_KINDS = [
  "ground-top", "ground-edge-left", "ground-edge-right", "ground-fill", "ground-wall-left", "ground-wall-right",
  "ground-inner-left", "ground-inner-right", "slope-up", "slope-down",
] as const;
export const SIDE_KINDS = [...GROUND_TILE_KINDS, "platform", "ladder", "building", "bg-sky", "bg-hills", "bg-trees"] as const;
export type SideKind = (typeof SIDE_KINDS)[number];

const GROUNDS: Material[] = ["grass", "foliage", "sand", "stone", "dirt"];
const SOILS: Material[] = ["dirt", "stone", "sand", "wood"];
const WALLS: Material[] = ["wood", "stone", "sand", "dirt", "leather", "metal", "cloth2"];
const ROOFS: Material[] = ["roof", "wood", "foliage", "stone", "cloth", "cloth2", "accent", "gold", "metal", "sand"];

const wrap = (n: number, T: number) => ((Math.round(n) % T) + T) % T;
const clampL = (l: number) => Math.max(0, Math.min(4, l));
/** Pixel-level writer for texture work (the lit Painter does the volumes). */
function canvas(w: number, h: number) {
  const s = createSprite(w, h);
  const put = (x: number, y: number, m: Material, level: number) => setPx(s, x, y, colorIndex(m, clampL(level)));
  const clear = (x: number, y: number) => setPx(s, x, y, 0);
  return { s, put, clear };
}

interface TileStyle { ground: Material; soil: Material; flat: boolean; lightSide: -1 | 1; seed: number }

/** Dirt that wraps on both axes: two noise lattices plus a few pebbles. */
function soil(T: number, st: TileStyle, put: (x: number, y: number, m: Material, l: number) => void) {
  const big = valueNoise(st.seed, 2), small = valueNoise(st.seed + 1, 4);
  // flat kits (few tones) keep soil in the two darkest levels so the grass cap stays the lightest thing
  const lo = 1, mid = 2, hi = st.flat ? 2 : 3;
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) {
      const v = 0.5 * big((x * 2) / T, (y * 2) / T) + 0.5 * small((x * 4) / T, (y * 4) / T);
      put(x, y, st.soil, st.flat ? (v < 0.4 ? lo : mid) : v > 0.7 ? hi : v < 0.26 ? lo : mid);
    }
  const r = rng(st.seed + 7);
  const pebbles = Math.max(1, Math.round((T * T) / 128));
  for (let i = 0; i < pebbles; i++) {
    const x = r.int(0, T - 1), y = r.int(0, T - 1);
    put(wrap(x, T), wrap(y, T), "stone", st.flat ? 2 : 3);
    put(wrap(x + 1, T), wrap(y, T), "stone", 2);
    put(wrap(x, T), wrap(y + 1, T), st.soil, 1);
  }
}

function capDepth(T: number) { return Math.max(3, Math.round(T * 0.3)); }

/** Per-column grass depth: a ragged underside with period T so the cap tiles sideways. */
function capProfile(T: number, seed: number): number[] {
  const r = rng(seed + 31), cap = capDepth(T);
  const out: number[] = [];
  let prev = 0;
  for (let x = 0; x < T; x++) {
    const d = r.chance(0.4) ? 1 : 0;
    out.push(cap - 1 + (d && prev === 0 ? 1 : 0));
    prev = d && prev === 0 ? 1 : 0;
  }
  return out;
}

function drawCap(T: number, st: TileStyle, put: (x: number, y: number, m: Material, l: number) => void, extra: (x: number) => number = () => 0) {
  const prof = capProfile(T, st.seed);
  for (let x = 0; x < T; x++) {
    const depth = prof[x] + extra(x);
    for (let y = 0; y < depth; y++) put(x, y, st.ground, y === 0 ? 4 : 3);
    put(x, depth, st.soil, 1); // contact shadow under the lip
    if (x % 4 === 2) put(x, 1, st.ground, 2); // blade gaps
  }
}

/** One-pixel lit edge on the side facing the light, dark edge on the other. */
function sideRim(T: number, st: TileStyle, put: (x: number, y: number, m: Material, l: number) => void, side: -1 | 1, y0 = 0) {
  const x = side < 0 ? 0 : T - 1;
  const lit = side === st.lightSide;
  for (let y = y0; y < T; y++) put(x, y, st.soil, lit ? (st.flat ? 2 : 3) : 1);
}

function groundTile(kind: SideKind, T: number, st: TileStyle): Sprite {
  const { s, put, clear } = canvas(T, T);
  soil(T, st, put);
  const cap = capDepth(T), R = Math.max(2, Math.round(T * 0.25));
  const round = (side: -1 | 1) => {
    for (let y = 0; y < R; y++)
      for (let x = 0; x < R; x++) {
        if (Math.hypot(R - x - 0.5, R - y - 0.5) <= R) continue;
        clear(side < 0 ? x : T - 1 - x, y);
      }
  };
  switch (kind) {
    case "ground-fill": break;
    case "ground-top": drawCap(T, st, put); break;
    case "ground-edge-left":
    case "ground-edge-right": {
      const side = kind === "ground-edge-left" ? -1 : 1;
      // the cap wraps one pixel further down over the face and the soil gets a lit/dark rim
      drawCap(T, st, put, (x) => ((side < 0 ? x : T - 1 - x) === 0 ? 1 : 0));
      sideRim(T, st, put, side, cap + 1);
      round(side);
      break;
    }
    case "ground-wall-left": sideRim(T, st, put, -1); break;
    case "ground-wall-right": sideRim(T, st, put, 1); break;
    case "ground-inner-left":
    case "ground-inner-right": {
      // concave corner: grass hugging the foot of the wall that rises above this tile
      const side = kind === "ground-inner-left" ? -1 : 1;
      for (let y = 0; y < cap; y++)
        for (let x = 0; x < cap; x++) if (x + y < cap + 1) put(side < 0 ? x : T - 1 - x, y, st.ground, y === 0 && x < 2 ? 4 : 3);
      break;
    }
    case "slope-up":
    case "slope-down": {
      const up = kind === "slope-up";
      for (let x = 0; x < T; x++) {
        const top = up ? T - 1 - x : x; // 45 degrees: one pixel per column
        for (let y = 0; y < top; y++) clear(x, y);
        for (let y = top; y < Math.min(T, top + cap); y++) put(x, y, st.ground, y === top ? 4 : 3);
        if (top + cap < T) put(x, top + cap, st.soil, 1);
      }
      break;
    }
    default: break;
  }
  return s;
}

function platformTile(T: number, cols: number, wood: Material, kit: StyleKit): Sprite {
  const W = T * cols, H = T;
  const P = new Painter(W, H, kit);
  const th = Math.max(3, Math.round(T * 0.3));
  P.box(0, 0, W, 2, wood, [0, -0.8, 0.6]); // lit top face
  P.box(0, 2, W, th - 2, wood, [0, 0, 1]);
  P.box(0, th - 1, W, 1, wood, [0, 0.3, 0.9], { tone: -1 });
  for (let x = T / 2; x < W; x += T) P.rect(x, 2, 1, th - 2, wood, 1); // plank seams, once per tile so it repeats
  // a brace under the middle of every tile (silhouette cue that it is a ledge, not a wall)
  for (let c = 0; c < cols; c++) {
    const cx = c * T + Math.floor(T / 2), b = Math.max(2, Math.round(T * 0.22));
    P.poly([[cx - b, th], [cx + b, th], [cx, th + b]], wood, [0, 0.2, 1], { tone: -1 });
  }
  return finalize(P.toSprite(), kit, { outline: false });
}

function ladderTile(T: number, rows: number, wood: Material, kit: StyleKit): Sprite {
  const H = T * rows;
  const P = new Painter(T, H, kit);
  const rx = Math.max(1, Math.round(T * 0.2)), rw = Math.max(2, Math.round(T * 0.13));
  P.cylinder(rx, 0, rw, H, wood);
  P.cylinder(T - rx - rw, 0, rw, H, wood);
  // rungs every 4px divide T (16, 24...), so ladders stack without a seam
  for (let y = 1; y < H; y += 4) {
    P.box(rx + rw, y, T - 2 * (rx + rw), 1, wood, [0, -0.7, 0.7], { tone: 1 });
    P.box(rx + rw, y + 1, T - 2 * (rx + rw), 1, wood, [0, 0.5, 0.8], { tone: -2 });
  }
  return finalize(P.toSprite(), kit, { outline: false });
}

/** Front-on house for a platformer: gable roof, door on the ground line, lit windows, chimney. */
function facade(p: Params, kit: StyleKit, seed: number): Sprite {
  const r = rng(seed);
  const pr = proportions(kit), T = kit.sizes.tile;
  const wall = mat(p, "wall"), roof = mat(p, "roof"), trim = mat(p, "trim");
  const floors = Math.max(1, Math.min(3, Math.round(num(p, "floors"))));
  const wallW = Math.max(5, Math.round(num(p, "cols"))) * T;
  const ov = Math.max(2, Math.round(T * 0.25)), th = Math.max(2, Math.round(T * 0.22));
  const storyH = pr.story, wallH = floors * storyH;
  const roofH = Math.round(wallW * 0.3), fnd = 2;
  const W = wallW + 2 * ov + 2, H = 1 + roofH + Math.round(ov * 0.6) + wallH + fnd + 2;
  const x0 = 1 + ov, cx = W / 2;
  const groundY = H - 1 - fnd, wallTop = groundY - wallH; // wall spans wallTop..groundY-1
  const P = new Painter(W, H, kit);
  // wall, gable and planks
  P.box(x0, wallTop, wallW, wallH, wall, [0, 0, 1]);
  P.poly([[x0, wallTop], [x0 + wallW, wallTop], [cx, wallTop - roofH]], wall, [0, 0, 1]);
  for (let y = wallTop - roofH + 3; y < groundY; y += 3) {
    const half = y < wallTop ? ((y - (wallTop - roofH)) / roofH) * (wallW / 2) : wallW / 2;
    P.box(Math.ceil(cx - half) + (y < wallTop ? 1 : 0), y, Math.max(0, Math.floor(half * 2) - (y < wallTop ? 2 : 0)), 1, wall, [0, 0, 1], { tone: -1 });
  }
  // storey beams and corner posts
  for (let f = 1; f < floors; f++) P.box(x0, wallTop + f * storyH - 1, wallW, 2, trim, [0, -0.3, 1], { tone: -1 });
  P.cylinder(x0, wallTop, 2, wallH, trim, { tone: -1 });
  P.cylinder(x0 + wallW - 2, wallTop, 2, wallH, trim, { tone: -1 });
  // foundation
  P.box(x0 - 1, groundY, wallW + 2, fnd, "stone", [0, -0.2, 1]);
  // roof bands along both slopes, light side facing the lit pitch
  const a = [x0 - ov, wallTop], b = [x0 + wallW + ov, wallTop], c = [cx, wallTop - roofH - Math.round(ov * 0.6)];
  P.poly([[a[0], a[1]], [c[0], c[1]], [c[0], c[1] + th + 1], [a[0] + th * 2, a[1]]], roof, [-0.5, -0.7, 0.55]);
  P.poly([[b[0], b[1]], [c[0], c[1]], [c[0], c[1] + th + 1], [b[0] - th * 2, b[1]]], roof, [0.5, -0.7, 0.55], { tone: -1 });
  P.box(a[0], a[1], b[0] - a[0], 1, roof, [0, 0.4, 0.8], { tone: -2 }); // eave shadow
  // door and step
  const dh = Math.min(pr.door, storyH - 3), dw = pr.doorW;
  const dx = Math.round(x0 + wallW * (r.chance(0.5) ? 0.22 : 0.62));
  P.box(dx - 1, groundY - dh - 1, dw + 2, dh + 1, trim, [0, 0, 1], { tone: 1 });
  P.box(dx, groundY - dh, dw, dh, trim, [0, 0, 1], { tone: -1 });
  P.px(dx + dw - 2, groundY - Math.round(dh * 0.45), "gold", 4);
  P.box(dx - 2, groundY - 1, dw + 4, 1, "stone", [0, -0.5, 0.8], { tone: 1 });
  // windows
  const win = pr.window, lit = bool(p, "lit_windows");
  const slots = Math.max(1, Math.floor((wallW - 8) / (win + 6)));
  for (let f = 0; f < floors; f++) {
    const wy = wallTop + f * storyH + Math.round((storyH - win) / 2);
    for (let i = 0; i < slots; i++) {
      const wx = Math.round(x0 + 4 + i * ((wallW - 8 - win) / Math.max(1, slots - 1)));
      if (f === floors - 1 && wx + win > dx - 2 && wx < dx + dw + 2) continue; // ground floor keeps the door clear
      P.box(wx - 1, wy - 1, win + 2, win + 2, trim, [0, 0, 1], { tone: 1 });
      P.box(wx, wy, win, win, lit ? "gold" : "water", [0, 0, 1], );
      P.rect(wx + Math.floor(win / 2), wy, 1, win, trim, 2);
      P.rect(wx, wy + Math.floor(win / 2), win, 1, trim, 2);
      P.box(wx - 1, wy + win + 1, win + 2, 1, trim, [0, -0.5, 0.8], { tone: -1 });
    }
  }
  // attic window in the gable
  const aw = Math.max(2, Math.round(win * 0.7));
  P.ellipse(cx, wallTop - Math.round(roofH * 0.38), aw / 2 + 1, aw / 2 + 1, trim, { tone: 1 });
  P.ellipse(cx, wallTop - Math.round(roofH * 0.38), aw / 2, aw / 2, lit ? "gold" : "water", { flat: 1 });
  // chimney on the shaded pitch
  if (bool(p, "chimney")) {
    const chx = Math.round(cx + wallW * 0.2), chW = Math.max(3, Math.round(T * 0.35));
    const slopeY = Math.round(wallTop - roofH * (1 - (chx - cx) / (wallW / 2)));
    P.box(chx, slopeY - Math.round(T * 0.7), chW, Math.round(T * 0.7) + 3, "stone", [0.2, 0, 1]);
    P.box(chx - 1, slopeY - Math.round(T * 0.7) - 1, chW + 2, 2, "stone", [0, -0.5, 0.8], { tone: 1 });
  }
  return finalize(P.toSprite(), kit);
}

// ---------------------------------------------------------------------------
// Parallax layers, W x H = cols x rows tiles, tiling left-right.
// ---------------------------------------------------------------------------

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

function sky(W: number, H: number, kit: StyleKit, r: Rng, sky: Material): Sprite {
  const P = new Painter(W, H, kit);
  const cloud = Math.max(4, Math.round(H * 0.07));
  // gradient: deep at the top, pale at the horizon; the ordered dither is what makes it a gradient, so it ignores kit.dither (W is a multiple of 4, so it wraps)
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1), v = 2 + 2 * t;
    for (let x = 0; x < W; x++) {
      const f = v - Math.floor(v), blend = Math.max(0, (f - 0.55) / 0.45); // flat bands, dithered only near the seam
      const l = Math.floor(v) + (blend > BAYER4[(y & 3) * 4 + (x & 3)] ? 1 : 0);
      P.px(x, y, sky, Math.min(4, l));
    }
  }
  const n = Math.max(2, Math.round(W / (cloud * 9)));
  for (let i = 0; i < n; i++) {
    const cx = ((i + r.next() * 0.6) / n) * W, cy = H * (0.12 + 0.35 * r.next()), s = cloud * (0.8 + 0.5 * r.next());
    for (const off of [-W, 0, W]) {
      const x = cx + off;
      P.ellipse(x, cy, s * 1.5, s * 0.55, "ui", { flat: 0.2 });
      P.ellipse(x - s * 0.7, cy + s * 0.15, s * 0.9, s * 0.45, "ui", { flat: 0.2 });
      P.ellipse(x + s * 0.8, cy + s * 0.2, s * 0.8, s * 0.4, "ui", { flat: 0.2 });
      P.ellipse(x + s * 0.1, cy - s * 0.35, s * 0.8, s * 0.55, "ui", { flat: 0.2 });
    }
  }
  return finalize(P.toSprite(), kit, { outline: false });
}

/** Ridge line with whole sine periods across the width, so x=0 follows x=W-1 without a jump. */
function ridge(W: number, r: Rng, base: number, a1: number, a2: number, k1: number, k2: number): number[] {
  const p1 = r.next() * Math.PI * 2, p2 = r.next() * Math.PI * 2;
  return Array.from({ length: W }, (_, x) => Math.round(base - a1 * Math.sin((2 * Math.PI * k1 * x) / W + p1) - a2 * Math.sin((2 * Math.PI * k2 * x) / W + p2)));
}

function paintRidge(P: Painter, top: number[], H: number, m: Material, tone: number) {
  const W = top.length;
  for (let x = 0; x < W; x++) {
    const slope = (top[(x + 3) % W] - top[(x + W - 3) % W]) / 6;
    P.box(x, top[x], 1, H - top[x], m, [0, -0.75, 0.75], { tone });
    // lit crest (2px), and a darker flank under it where the ridge falls away from the light
    P.box(x, top[x], 1, 2, m, [0, -1, 0.3], { tone: tone + 1 });
    if (slope > 0.45) P.box(x, top[x] + 2, 1, Math.min(H - top[x] - 2, 3 + Math.round(slope * 2)), m, [0.4, -0.2, 0.9], { tone: tone - 1 });
  }
}

function hills(W: number, H: number, kit: StyleKit, r: Rng, far: Material, near: Material): Sprite {
  const P = new Painter(W, H, kit);
  const k = Math.max(1, Math.round(W / (kit.sizes.tile * 10)));
  // few-tone kits keep backdrops one step darker so the foreground (hero, ground) is the lightest thing
  const dim = kit.shadeSteps <= 3 ? -1 : 0;
  paintRidge(P, ridge(W, r, H * 0.62, H * 0.12, H * 0.04, k + 1, 3 * k + 1), H, far, dim);
  paintRidge(P, ridge(W, r, H * 0.8, H * 0.07, H * 0.025, 2 * k, 5 * k), H, near, -1 + dim);
  return finalize(P.toSprite(), kit, { outline: false });
}

function treeLine(W: number, H: number, kit: StyleKit, r: Rng, leaf: Material, trunk: Material): Sprite {
  const P = new Painter(W, H, kit);
  const T = kit.sizes.tile;
  const dim = kit.shadeSteps <= 3 ? -1 : 0; // backdrop stays darker than the foreground in few-tone kits
  const G = H - Math.max(3, Math.round(T * 0.4)); // ground line of the layer
  const n = Math.max(3, Math.round(W / (T * 2.6)));
  const kinds: ("pine" | "oak")[] = [];
  for (let i = 0; i < n; i++) kinds.push(r.chance(0.55) ? "pine" : "oak");
  for (let i = 0; i < n; i++) {
    const cx = ((i + 0.2 + 0.6 * r.next()) / n) * W, h = H * (0.3 + 0.22 * r.next()), w = h * (0.4 + 0.1 * r.next());
    for (const off of [-W, 0, W]) {
      const x = cx + off;
      if (kinds[i] === "pine") {
        P.cylinder(Math.round(x - 2), Math.round(G - h * 0.16), 4, Math.round(h * 0.16) + 2, trunk, { tone: -1 + dim });
        const layers = 4;
        for (let l = 0; l < layers; l++) {
          const top = G - h + (l * h * 0.72) / layers, bot = top + (h * 0.5) / layers * 1.9, half = w * (0.35 + (0.65 * (l + 1)) / layers) / 1.6;
          P.poly([[x, top], [x + half, bot], [x - half, bot]], leaf, [0, -0.35, 0.9], { tone: -1 + dim });
          P.poly([[x, top], [x, bot], [x - half, bot]], leaf, [-0.6, -0.4, 0.7], { tone: dim });
        }
      } else {
        P.cylinder(Math.round(x - 2), Math.round(G - h * 0.5), 4, Math.round(h * 0.5) + 2, trunk, { tone: -1 + dim });
        P.ellipse(x, G - h * 0.62, w * 0.62, h * 0.34, leaf, { tone: dim });
        P.ellipse(x - w * 0.32, G - h * 0.5, w * 0.4, h * 0.22, leaf, { tone: dim });
        P.ellipse(x + w * 0.34, G - h * 0.52, w * 0.38, h * 0.2, leaf, { tone: -1 + dim });
      }
    }
  }
  P.box(0, G, W, H - G, leaf, [0, -0.8, 0.55], { tone: -1 + dim }); // hedge / ground strip under the trunks
  P.box(0, G, W, 1, leaf, [0, -1, 0.3], { tone: dim });
  return finalize(P.toSprite(), kit, { outline: false });
}

export const sideviewGenerator: Generator = {
  id: "sideview",
  category: "environment",
  label: "Side view",
  description:
    "Side-view (platformer) pieces for the 'kit-side' camera: ground tiles (top, edge-left/right, fill, wall, inner corners), 45-degree slopes, a one-way platform, a ladder, a front-on building and horizontally tiling parallax layers (sky, hills, trees).",
  params: [
    { key: "kind", label: "Kind", type: "select", options: [...SIDE_KINDS], default: "ground-top" },
    { key: "ground", label: "Grass / cap", type: "material", options: GROUNDS, default: "grass" },
    { key: "soil", label: "Soil", type: "material", options: SOILS, default: "dirt" },
    { key: "wood", label: "Platform / ladder wood", type: "material", options: ["wood", "leather", "metal", "stone"], default: "wood" },
    { key: "wall", label: "Building walls", type: "material", options: WALLS, default: "sand" },
    { key: "roof", label: "Building roof", type: "material", options: ROOFS, default: "roof" },
    { key: "trim", label: "Building trim", type: "material", options: ["wood", "stone", "metal", "leather", "dirt"], default: "wood" },
    { key: "sky", label: "Sky", type: "material", options: ["water", "cloth", "accent", "cloth2", "ui"], default: "water" },
    { key: "far", label: "Far hills", type: "material", options: ["stone", "water", "cloth", "accent", "metal"], default: "stone" },
    { key: "foliage", label: "Trees / near hills", type: "material", options: ["foliage", "grass", "stone", "cloth", "accent"], default: "foliage" },
    { key: "cols", label: "Width in tiles (platform, building, layers)", type: "number", min: 1, max: 24, step: 1, default: 10 },
    { key: "rows", label: "Height in tiles (ladder, layers)", type: "number", min: 1, max: 16, step: 1, default: 9 },
    { key: "floors", label: "Building floors", type: "number", min: 1, max: 3, step: 1, default: 1 },
    { key: "lit_windows", label: "Lit windows", type: "bool", default: true },
    { key: "chimney", label: "Chimney", type: "bool", default: true },
    { key: "variant", label: "Variant", type: "number", min: 0, max: 9, step: 1, default: 0 },
  ],
  generate(p, kit, seed): GenResult {
    const kind = str(p, "kind") as SideKind;
    const T = kit.sizes.tile;
    const variant = Math.max(0, Math.min(9, Math.round(num(p, "variant") || 0)));
    const mixed = (seed + hashString(kind) + variant * 7919) >>> 0;
    const one = (s: Sprite): GenResult => ({ rows: [{ name: "idle", frames: [s] }], fps: 1 });
    const cols = Math.max(1, Math.round(num(p, "cols"))), rows = Math.max(1, Math.round(num(p, "rows")));
    // ground tiles share one seed so top / fill / walls carry the same soil and stack seamlessly
    const st: TileStyle = { ground: mat(p, "ground"), soil: mat(p, "soil"), flat: kit.shadeSteps <= 3, lightSide: kit.lightDir === "top-right" ? 1 : -1, seed: (seed + variant * 7919) >>> 0 };
    if ((GROUND_TILE_KINDS as readonly string[]).includes(kind)) return one(groundTile(kind, T, st));
    if (kind === "platform") return one(platformTile(T, cols, mat(p, "wood"), kit));
    if (kind === "ladder") return one(ladderTile(T, rows, mat(p, "wood"), kit));
    if (kind === "building") return one(facade({ ...p, cols: Math.max(5, cols) }, kit, mixed));
    const r = rng(mixed);
    const W = Math.max(4, cols) * T, H = Math.max(4, rows) * T;
    if (kind === "bg-sky") return one(sky(W, H, kit, r, mat(p, "sky")));
    if (kind === "bg-hills") return one(hills(W, H, kit, r, mat(p, "far"), mat(p, "foliage")));
    return one(treeLine(W, H, kit, r, mat(p, "foliage"), "wood"));
  },
};

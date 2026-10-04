import { finalize } from "../enforce";
import { Painter } from "../painter";
import type { Material } from "../palette";
import { proportions } from "../kit";
import { rng, type Rng } from "../rng";
import type { StyleKit } from "../types";
import { bool, mat, num, str, type GenResult, type Generator, type Params } from "./types";

const WALLS: Material[] = ["wood", "stone", "sand", "dirt", "leather", "metal", "ui"];
const ROOFS: Material[] = ["roof", "wood", "foliage", "stone", "cloth", "cloth2", "accent", "gold", "metal", "sand"];

/** Shade a cone/spire column by column so it reads round like the painter's cylinders. */
function cone(P: Painter, cx: number, baseY: number, halfW: number, h: number, m: Material) {
  for (let x = Math.floor(cx - halfW); x <= Math.ceil(cx + halfW); x++) {
    const u = (x + 0.5 - cx) / halfW;
    if (Math.abs(u) > 1) continue;
    const colH = Math.round(h * (1 - Math.abs(u)));
    if (colH <= 0) continue;
    P.box(x, baseY - colH, 1, colH, m, [u, -0.5, Math.sqrt(1 - u * u) + 0.2]);
  }
}

function wallTexture(P: Painter, x: number, y: number, w: number, h: number, m: Material, r: Rng) {
  const plank = m === "wood" || m === "leather";
  if (plank) {
    for (let yy = y + 2; yy < y + h; yy += 3) P.box(x, yy, w, 1, m, [0, 0, 1], { tone: -1 });
  } else {
    for (let yy = y + 2, row = 0; yy < y + h; yy += 3, row++) {
      P.box(x, yy, w, 1, m, [0, 0, 1], { tone: -1 });
      for (let xx = x + (row % 2 ? 2 : 5); xx < x + w; xx += 6) P.box(xx, yy - 2, 1, 2, m, [0, 0, 1], { tone: -1 });
    }
    for (let i = 0; i < w / 4; i++) P.box(x + r.int(0, w - 1), y + r.int(0, h - 1), 1, 1, m, [0, 0, 1], { tone: 1 });
  }
}

/** One column of corrugated sheet: 2px-wide ribs alternate ramp levels 2/3, a dark eave-shadow row closes the bottom. */
function corrColumn(P: Painter, roof: Material, x: number, i: number, top: number, wy: number) {
  const h = wy + 1 - top;
  if (h <= 0) return;
  P.rect(x, top, 1, h, roof, (i >> 1) % 2 ? 3 : 2);
  P.px(x, wy, roof, 1);
  if (h > 3) P.px(x, wy - 1, roof, (i >> 1) % 2 ? 2 : 1);
}

/**
 * Pitched roof face (gable or hip): front slope, lit upper strip, then either
 * staggered shingle courses or, for `corr`, vertical zinc corrugation: columns
 * alternate normals so the ridges catch the kit light.
 */
function pitchedRoof(P: Painter, roof: Material, rx0: number, rx1: number, wy: number, rh: number, inset: number, k: number, corr: boolean) {
  if (corr) {
    for (let x = rx0; x < rx1; x++) {
      const e = Math.min(x - rx0 + 0.5, rx1 - x - 0.5);
      const top = Math.round(wy - rh + (inset > 0 && e < inset ? rh * (1 - e / inset) : 0));
      corrColumn(P, roof, x, x - rx0, top, wy);
    }
    P.box(rx0 + inset, wy - rh, Math.max(1, rx1 - rx0 - 2 * inset), 1, roof, [0, -1, 0.3], { tone: 1 }); // ridge cap
    return;
  }
    // lower slope faces viewer, upper slope faces sky (lighter)
    P.poly([[rx0, wy + 1], [rx1, wy + 1], [rx1 - inset, wy - rh], [rx0 + inset, wy - rh]], roof, [0, -0.35, 0.95]);
    P.poly([[rx0 + inset, wy - rh], [rx1 - inset, wy - rh], [rx1 - inset - 1, wy - rh - Math.round(3 * k)], [rx0 + inset + 1, wy - rh - Math.round(3 * k)]], roof, [0, -1, 0.3]);
    // staggered shingle courses: a dark seam per course with gaps, offset every other row
    const tileW = Math.max(3, Math.round(5 * k));
    for (let yy = wy - rh + 3, row = 0; yy <= wy; yy += 3, row++) {
      const t = (wy - yy) / rh;
      const a = Math.ceil(rx0 + inset * t), b = Math.floor(rx1 - inset * t);
      P.box(a, yy, b - a, 1, roof, [0, 0.2, 1], { tone: -1 });
      for (let xx = a + (row % 2 ? Math.floor(tileW / 2) : 0); xx < b; xx += tileW) P.box(xx, yy - 2, 1, 2, roof, [0, 0.2, 1], { tone: -1 });
    }
}

/** Steep triangular gable seen end-on: each column is lit by its slope, so the two pitches split light and shade. */
function gableRoof(P: Painter, roof: Material, rx0: number, rx1: number, wy: number, rh: number, k: number, corr: boolean) {
  const cx = (rx0 + rx1) / 2, half = (rx1 - rx0) / 2;
  const tops: number[] = [];
  for (let x = rx0; x < rx1; x++) {
    const u = (x + 0.5 - cx) / half;
    const top = Math.round(wy + 1 - rh * (1 - Math.abs(u)));
    tops.push(top);
    if (corr) corrColumn(P, roof, x, x - rx0, top, wy);
    else P.box(x, top, 1, wy + 1 - top, roof, [u * 0.9, -0.35, 0.8]);
  }
  if (!corr) {
    const tileW = Math.max(3, Math.round(5 * k));
    for (let yy = wy - 2, row = 0; yy > wy - rh; yy -= 3, row++)
      for (let x = rx0; x < rx1; x++) {
        if (tops[x - rx0] > yy) continue;
        if ((x - rx0 + (row % 2 ? Math.floor(tileW / 2) : 0)) % tileW === 0) P.box(x, yy - 2, 1, 2, roof, [0, 0.2, 1], { tone: -1 });
        P.box(x, yy, 1, 1, roof, [0, 0.2, 1], { tone: -1 });
      }
  }
  // bargeboards along both rake edges
  for (let x = rx0; x < rx1; x++) P.box(x, tops[x - rx0], 1, 1, roof, [0, -1, 0.4], { tone: 1 });
  if (!corr) P.box(rx0, wy, rx1 - rx0, 1, roof, [0, 1, 0.3], { tone: -1 });
}

/**
 * Raised house on wooden posts: the open ground floor is one character tall
 * (proportions.door + headroom), a deck with a veranda rail sits on top, with
 * stairs or a ladder on the veranda side and a steep roof over the cabin.
 */
/** Stilt-house default (auto style + brick roof) is zinc; an explicit roof material wins. */
const corr0 = (p: Params) => (str(p, "roof_style") === "auto" || str(p, "roof_style") === "corrugated") && mat(p, "roof") === "roof";

function stiltHouse(p: Params, kit: StyleKit, r: Rng): GenResult {
  const S = kit.sizes.building;
  const k = S / 64;
  const pr = proportions(kit);
  const wall = mat(p, "wall"), trim = mat(p, "trim");
  const roof = corr0(p) ? "metal" : mat(p, "roof");
  const ladder = str(p, "access") === "ladder";
  const rs = str(p, "roof_style");
  const corr = rs === "corrugated" || rs === "auto"; // stilt houses default to zinc sheet
  const hip = rs === "hip";
  const side = r.chance(0.5) ? 1 : -1; // which end the stairs leave the veranda
  const gh = pr.door; // clear height under the floor: one door tall
  const fb = Math.max(2, Math.round(2.5 * k)); // floor beam
  const wh = pr.story;
  const run = ladder ? 0 : Math.round(gh * 0.75);
  const frac = str(p, "width") === "narrow" ? 0.75 : str(p, "width") === "wide" ? 1 : 0.9;
  const deckW = Math.round((S - 8 - run) * frac);
  const total = deckW + run;
  const left = Math.round((S - total) / 2);
  const x0 = side === 1 ? left : left + run, x1 = x0 + deckW;
  const bw = Math.round(deckW * 0.64);
  const over = Math.max(2, Math.round(3 * k));
  const bx = side === 1 ? x0 + over : x1 - over - bw;
  const rh = Math.max(6, Math.round(Math.min(bw * 0.8, wh * 1.35)));
  const topPad = Math.round(3 * k);
  const H = gh + fb + wh + rh + topPad + 3;
  const P = new Painter(S, H, kit);
  const G = H - 1; // ground line (exclusive)
  const yF = G - gh - fb; // deck top
  const wy = yF - wh; // eaves
  const pw = Math.max(2, Math.round(2.5 * k));

  // dark underside + braces sit behind the posts
  P.box(x0, yF + fb, deckW, Math.max(2, Math.round(2 * k)), trim, [0, 0.8, 0.3], { tone: -2 });
  const np = deckW >= 40 ? 4 : 3;
  const px = (i: number) => Math.round(x0 + 1 + (i * (deckW - pw - 2)) / (np - 1));
  const bi = Math.floor((np - 1) / 2);
  P.line(px(bi) + 1, yF + fb + 2, px(bi + 1) + 1, G - 4, trim, 1);
  P.line(px(bi + 1) + 1, yF + fb + 2, px(bi) + 1, G - 4, trim, 1);
  for (let i = 0; i < np; i++) {
    const x = px(i);
    P.cylinder(x, yF + fb, pw, G - yF - fb, trim, { tone: i % 2 && r.chance(0.5) ? -1 : 0 });
    P.cylinder(x - 1, G - 2, pw + 2, 2, "stone", { flat: 0.3 }); // footing
  }

  // access: stairs descend outward from the veranda end, or a ladder leans on it
  const e = side === 1 ? x1 : x0;
  const rail = Math.max(5, Math.round(pr.door * 0.36));
  if (ladder) {
    const lw = Math.max(4, Math.round(5 * k));
    const lo = side === 1 ? e - lw - 1 : e + 1;
    for (let y = G - 3; y > yF + fb; y -= 3) P.box(lo, y, lw, 1, trim, [0, -0.6, 0.8], { tone: 1 });
    P.box(lo - 1, yF - rail + 2, 1, G - yF + rail - 2, trim, [-0.5, 0, 1]);
    P.box(lo + lw, yF - rail + 2, 1, G - yF + rail - 2, trim, [0.5, 0, 1], { tone: -1 });
  } else {
    const n = Math.max(4, Math.round(gh / 3.2));
    const tw = Math.ceil(run / n) + 2;
    // 2px stringer (clear of the canvas margin), then treads: lit nosing over a shaded riser
    const endY = G - 2;
    for (let t = 0; t < 2; t++) P.line(e, yF + fb + t, e + side * run, endY - 1 + t, trim, 1);
    for (let i = 0; i < n; i++) {
      const xi = e + side * Math.round(((i + 0.5) * run) / n);
      const yi = yF + fb + Math.round(((i + 0.5) * (endY - yF - fb - 1)) / n);
      const x = side === 1 ? xi : xi - tw + 1;
      P.rect(x, yi, tw, 1, trim, 4);
      P.rect(x, yi + 1, tw, 1, trim, 2);
    }
    // handrail parallels the slope on the outer side
    P.line(e, yF - rail, e + side * run, G - rail - 2, trim, 3);
    P.box(e + side * run - (side === 1 ? 0 : 0), G - rail - 2, 1, rail, trim, [side * 0.5, 0, 1], { tone: -1 });
  }

  // deck: lit top edge, shaded front board
  P.box(x0 - 1, yF, deckW + 2, fb, trim, [0, -0.5, 0.9]);
  P.box(x0 - 1, yF, deckW + 2, 1, trim, [0, -1, 0.5], { tone: 1 });
  for (let x = x0 + 3; x < x1 - 1; x += 5) P.px(x, yF + fb - 1, trim, 1);

  // cabin
  P.box(bx, wy, bw, wh, wall, [0, 0.1, 1]);
  wallTexture(P, bx, wy, bw, wh, wall, r);
  P.box(bx, wy, 2, wh, trim, [-0.4, 0, 1]);
  P.box(bx + bw - 2, wy, 2, wh, trim, [0.4, 0, 1]);
  const dw = pr.doorW, dh = Math.min(pr.door, wh - 4);
  const dx = side === 1 ? bx + bw - dw - 3 : bx + 3;
  P.box(dx - 1, yF - dh - 1, dw + 2, dh + 1, trim, [0, 0, 1], { tone: -1 });
  P.box(dx, yF - dh, dw, dh, trim, [0, 0, 1], { tone: -1 });
  for (let xx = dx + 2; xx < dx + dw - 1; xx += 3) P.box(xx, yF - dh, 1, dh, trim, [0, 0, 1], { tone: -2 });
  P.px(side === 1 ? dx + dw - 2 : dx + 1, yF - Math.round(dh / 2), "gold", 3);
  const winW = pr.window, winH = Math.round(pr.window * 1.15);
  const wxs = side === 1 ? [bx + 3, dx - 2] : [dx + dw + 2, bx + bw - 3];
  if (wxs[1] - wxs[0] >= winW + 3) {
    const x = Math.round((wxs[0] + wxs[1] - winW) / 2), y = wy + Math.round(wh * 0.28);
    P.box(x - 1, y - 1, winW + 2, winH + 2, trim, [0, -0.3, 1]);
    const lit = bool(p, "lit_windows");
    P.rect(x, y, winW, winH, lit ? "gold" : "water", lit ? 3 : 1);
    if (lit) P.rect(x, y, Math.ceil(winW / 2), Math.ceil(winH / 2), "gold", 4);
    else P.px(x, y, "water", 4);
    if (winW >= 4) P.rect(x + Math.floor(winW / 2), y, 1, winH, trim, 1);
  }

  // steep roof
  const rx0 = bx - over, rx1 = bx + bw + over;
  const inset = hip ? Math.round(rh * 0.5) : 0;
  if (hip) pitchedRoof(P, roof, rx0, rx1, wy, rh, inset, k, corr);
  else gableRoof(P, roof, rx0, rx1, wy, rh, k, corr);
  P.box(bx, wy + 1, bw, 2, wall, [0, 1, 0.3], { tone: -1 });

  // veranda rail on the open part of the deck, leaving the stair mouth free
  const vx0 = side === 1 ? bx + bw : x0 + (ladder ? 0 : 0);
  const vx1 = side === 1 ? x1 : bx;
  const gap = ladder ? 0 : 3;
  const ra = side === 1 ? vx0 : vx0 + gap, rb = side === 1 ? vx1 - gap : vx1;
  if (rb - ra > 4) {
    P.box(ra, yF - rail, rb - ra, 2, trim, [0, -0.7, 0.7], { tone: 1 });
    P.box(ra, yF - 2, rb - ra, 1, trim, [0, 0, 1], { tone: -1 });
    for (let x = ra + 1; x < rb - 1; x += 3) P.box(x, yF - rail + 2, 1, rail - 3, trim, [0, 0, 1]);
    P.box(ra, yF - rail, 2, rail, trim, [-0.4, 0, 1]);
    P.box(rb - 2, yF - rail, 2, rail, trim, [0.4, 0, 1]);
  }
  return { rows: [{ name: "idle", frames: [finalize(P.toSprite(), kit)] }], fps: 1 };
}

export const buildingGenerator: Generator = {
  id: "building",
  category: "building",
  label: "Building",
  description: "Front-facing 3/4 view building: cottage, shop, tower, keep, barn or raised stilt-house (open ground floor, stairs/ladder, veranda) with wall/roof materials, floors, windows, chimney.",
  params: [
    { key: "style", label: "Style", type: "select", options: ["cottage", "shop", "tower", "keep", "barn", "stilt-house"], default: "cottage" },
    { key: "wall", label: "Walls", type: "material", options: WALLS, default: "wood" },
    { key: "roof", label: "Roof", type: "material", options: ROOFS, default: "roof" },
    { key: "roof_style", label: "Roof style", type: "select", options: ["auto", "gable", "hip", "flat", "dome", "spire", "corrugated"], default: "auto" },
    { key: "floors", label: "Floors", type: "number", min: 1, max: 3, default: 1 },
    { key: "width", label: "Width", type: "select", options: ["narrow", "normal", "wide"], default: "normal" },
    { key: "lit_windows", label: "Lit windows", type: "bool", default: true },
    { key: "chimney", label: "Chimney", type: "bool", default: true },
    { key: "access", label: "Stilt-house access", type: "select", options: ["stairs", "ladder"], default: "stairs" },
    { key: "trim", label: "Trim / door", type: "material", options: ["wood", "stone", "metal", "gold", "leather", "dirt"], default: "wood" },
  ],
  generate(p, kit, seed) {
    const r = rng(seed);
    const S = kit.sizes.building;
    const k = S / 64;
    const pr = proportions(kit);
    const style = str(p, "style");
    if (style === "stilt-house") return stiltHouse(p, kit, r);
    const wall = mat(p, "wall"), roof = mat(p, "roof"), trim = mat(p, "trim");
    let roofStyle = str(p, "roof_style");
    if (roofStyle === "auto") roofStyle = "gable";
    const floors = num(p, "floors");
    const tower = style === "tower";
    const widthFrac = tower ? 0.42 : str(p, "width") === "narrow" ? 0.55 : str(p, "width") === "wide" ? 0.9 : 0.72;
    const ww = Math.round((S - 6) * widthFrac);
    const wx = Math.round((S - ww) / 2);
    const storyH = pr.story;
    const wh = storyH * floors + (tower ? Math.round(storyH * 0.4) : 0);
    // corrugated sheeting is a gable/hip surface treatment; towers and domes keep their own shapes
    const corr = roofStyle === "corrugated";
    if (corr) roofStyle = "gable";
    if (tower && roofStyle === "gable") roofStyle = "spire";
    const over = Math.max(1, Math.round(3 * k));
    const rh = roofStyle === "flat" ? Math.max(3, Math.round(4 * k)) : Math.round(Math.min(ww * (tower ? 0.9 : 0.36), storyH * (tower ? 1.4 : 0.8)));
    // The canvas is kit.sizes.building wide; it grows taller when floors + roof need the room.
    const H = Math.max(S, wh + rh + Math.round(14 * k) + 4);
    const P = new Painter(S, H, kit);
    const baseY = H - 2;
    const wy = baseY - wh;
    const rx0 = wx - over, rx1 = wx + ww + over;
    // a dome sits behind the facade, so it is painted first and the walls cover its lower half
    if (roofStyle === "dome") P.ellipse((rx0 + rx1) / 2, wy + 1, (rx1 - rx0) / 2, rh, roof);

    // walls
    if (tower) P.cylinder(wx, wy, ww, wh, wall, { flat: 0.3 });
    else P.box(wx, wy, ww, wh, wall, [0, 0.1, 1]);
    wallTexture(P, wx, wy, ww, wh, wall, r);
    // foundation
    P.box(wx - 1, baseY - Math.max(2, Math.round(3 * k)), ww + 2, Math.max(2, Math.round(3 * k)) + 1, "stone", [0, 0, 1], { tone: -1 });
    // corner posts
    if (!tower && (wall === "wood" || style === "barn")) {
      P.box(wx, wy, Math.max(1, Math.round(2 * k)), wh, trim, [-0.4, 0, 1]);
      P.box(wx + ww - Math.max(1, Math.round(2 * k)), wy, Math.max(1, Math.round(2 * k)), wh, trim, [0.4, 0, 1]);
    }

    // door
    const dw = style === "barn" ? Math.round(pr.doorW * 1.7) : pr.doorW;
    const dh = style === "barn" ? Math.round(pr.door * 1.05) : pr.door;
    const dx = Math.round(S / 2 - dw / 2) + (style === "shop" ? -Math.round(ww / 5) : 0);
    P.box(dx - 1, baseY - dh - 1, dw + 2, dh + 1, trim, [0, 0, 1], { tone: -1 });
    P.box(dx, baseY - dh, dw, dh, trim, [0, 0, 1]);
    for (let xx = dx + 2; xx < dx + dw - 1; xx += 3) P.box(xx, baseY - dh, 1, dh, trim, [0, 0, 1], { tone: -1 });
    P.px(dx + dw - 2, baseY - Math.round(dh / 2), "gold", 3);
    if (style === "barn") P.line(dx, baseY - dh, dx + dw - 1, baseY - 1, trim, 1), P.line(dx + dw - 1, baseY - dh, dx, baseY - 1, trim, 1);

    // windows
    const winW = pr.window, winH = Math.round(pr.window * 1.15);
    const lit = bool(p, "lit_windows");
    const drawWindow = (x: number, y: number) => {
      P.box(x - 1, y - 1, winW + 2, winH + 2, trim, [0, -0.3, 1]);
      P.rect(x, y, winW, winH, lit ? "gold" : "water", lit ? 3 : 1);
      if (lit) P.rect(x, y, Math.ceil(winW / 2), Math.ceil(winH / 2), "gold", 4);
      else P.px(x, y, "water", 4);
      if (winW >= 4) P.rect(x + Math.floor(winW / 2), y, 1, winH, trim, 1), P.rect(x, y + Math.floor(winH / 2), winW, 1, trim, 1);
      P.box(x - 1, y + winH + 1, winW + 2, 1, trim, [0, -0.6, 0.8], { tone: 1 }); // sill
    };
    for (let f = 0; f < floors; f++) {
      const y = baseY - storyH * (f + 1) + Math.round(3 * k);
      if (f === 0 && !tower) {
        // one window centred in each wall span left/right of the door, if it fits with a margin
        const spans: [number, number][] = [[wx + 2, dx - 2], [dx + dw + 2, wx + ww - 2]];
        for (const [a, b] of spans) if (b - a >= winW + 4) drawWindow(Math.round((a + b - winW) / 2), y + Math.round(1 * k));
        if (style === "shop") {
          // awning + sign
          const ay = baseY - dh - Math.round(5 * k);
          for (let xx = wx - 1; xx < wx + ww + 1; xx++) P.box(xx, ay, 1, Math.round(4 * k), ((xx - wx) >> 2) % 2 ? "cloth2" : "ui", [0, -0.6, 0.8]);
          P.box(S / 2 - Math.round(8 * k), ay - Math.round(6 * k), Math.round(16 * k), Math.round(5 * k), "wood", [0, 0, 1]);
        }
      } else if (!(tower && f === 0)) {
        const n = tower ? 1 : Math.max(1, Math.floor(ww / (12 * k)));
        for (let i = 0; i < n; i++) drawWindow(Math.round(wx + ((i + 0.5) * ww) / n - winW / 2), y);
      }
    }

    // roof
    if (roofStyle === "gable" || roofStyle === "hip") {
      const inset = roofStyle === "hip" ? Math.round(rh * 0.6) : 0;
      pitchedRoof(P, roof, rx0, rx1, wy, rh, inset, k, corr);
      if (roofStyle === "gable") {
        P.box(rx0, wy - rh, 1, rh + 2, roof, [-1, 0, 0.4]);
        P.box(rx1 - 1, wy - rh, 1, rh + 2, roof, [1, 0, 0.4]);
      }
    } else if (roofStyle === "flat") {
      P.box(rx0, wy - rh, rx1 - rx0, rh, roof, [0, -0.8, 0.6]);
      for (let xx = rx0; xx < rx1; xx += 4) P.box(xx, wy - rh - 2, 2, 2, roof, [0, -0.5, 0.8]);
    } else if (roofStyle === "dome") {
      P.box(rx0, wy - 1, rx1 - rx0, 2, trim, [0, 0, 1]);
    } else {
      cone(P, (rx0 + rx1) / 2, wy + 2, (rx1 - rx0) / 2, rh + Math.round(8 * k), roof);
      P.px(Math.round((rx0 + rx1) / 2), wy - rh - Math.round(9 * k), "gold", 4);
    }
    if (roofStyle === "gable" || roofStyle === "hip") P.box(wx, wy + 1, ww, Math.max(1, Math.round(2 * k)), wall, [0, 1, 0.3], { tone: -1 });
    if (bool(p, "chimney") && !tower && roofStyle !== "dome" && roofStyle !== "spire") {
      const cw = Math.max(3, Math.round(5 * k));
      const cx = Math.round(wx + ww * 0.72);
      const top = wy - rh - Math.round(5 * k);
      const ch = Math.round(9 * k);
      if (corr) {
        // stovepipe: round metal with a capped rim
        P.cylinder(cx, top, Math.max(3, cw - 1), ch, "metal", { flat: 0.3 });
        P.box(cx - 1, top - 1, Math.max(3, cw - 1) + 2, 1, "metal", [0, -1, 0.5], { tone: -1 });
      } else {
        P.box(cx, top, cw, ch, "stone", [0.2, 0, 1]);
        for (let yy = top + 2; yy < top + ch; yy += 3) P.box(cx, yy, cw, 1, "stone", [0, 0, 1], { tone: -1 });
        P.box(cx - 1, top - 1, cw + 2, Math.max(1, Math.round(2 * k)), "stone", [0, -1, 0.5]);
        P.box(cx - 1, top + Math.max(1, Math.round(2 * k)) - 1, cw + 2, 1, "stone", [0, 1, 0.3], { tone: -1 });
      }
    }
    if (style === "keep") {
      for (let xx = wx; xx < wx + ww; xx += Math.round(6 * k)) P.box(xx, wy - rh - Math.round(4 * k), Math.round(3 * k), Math.round(4 * k), wall, [0, -0.4, 1]);
    }
    return { rows: [{ name: "idle", frames: [finalize(P.toSprite(), kit)] }], fps: 1 };
  },
};

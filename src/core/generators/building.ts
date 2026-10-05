import { finalize } from "../enforce";
import { Painter } from "../painter";
import type { Material } from "../palette";
import { proportions } from "../kit";
import { buildingFootprint } from "../footprint";
import { rng, type Rng } from "../rng";
import type { StyleKit } from "../types";
import { isoBuildingResult } from "./isoworld";
import { richBuildingResult, SIGN_OPTIONS, TRI } from "./building-rich-render";
import { bool, mat, num, str, type GenResult, type Generator, type Params } from "./types";

const WALLS: Material[] = ["wood", "stone", "sand", "dirt", "leather", "metal", "ui", "cloth2"];
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
  const deckW = Math.round((S - 10 - run) * frac);
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

/** Louvred window: trim frame, horizontal slats; lit windows glow between the slats. */
function louvre(P: Painter, trim: Material, x: number, y: number, w: number, h: number, lit: boolean) {
  P.box(x - 1, y - 1, w + 2, h + 2, trim, [0, -0.3, 1]);
  for (let yy = y; yy < y + h; yy++) P.rect(x, yy, w, 1, (yy - y) % 2 ? trim : lit ? "gold" : trim, (yy - y) % 2 ? 3 : lit ? 3 : 0);
  if (w >= 5) P.rect(x + Math.floor(w / 2), y, 1, h, trim, 1);
}

/**
 * Two-storey "half-brick, half-wood" house (Thai ban khrueng tuek khrueng mai): a rendered
 * masonry ground floor with a vent-block band, a plank upper floor with louvred windows, a
 * side-gable roof over the main block and a front-facing gable wing whose upper floor is an
 * open balcony on posts above a shaded porch.
 */
function halfBrickHouse(p: Params, kit: StyleKit, r: Rng): GenResult {
  const S = kit.sizes.building;
  const k = S / 64;
  // two storeys at character scale only read as a house when spread wide, so this style is 1.5x building width
  const W = Math.round(S * 1.5);
  const pr = proportions(kit);
  const upper = mat(p, "wall"), trim = mat(p, "trim");
  const lower: Material = upper === "sand" ? "stone" : "sand";
  const roof = corr0(p) ? "metal" : mat(p, "roof");
  const rs = str(p, "roof_style");
  const corr = rs === "corrugated" || rs === "auto";
  const lit = bool(p, "lit_windows");
  const frac = str(p, "width") === "narrow" ? 0.8 : str(p, "width") === "wide" ? 1 : 0.92;
  const over = Math.max(2, Math.round(3 * k));
  const tw = Math.round((W - 4 - 2 * over) * frac);
  const left = Math.round((W - tw) / 2);
  const flip = r.chance(0.5); // wing on the right or left
  const mainW = Math.round(tw * 0.58), wingW = tw - mainW;
  const mainX = flip ? left + wingW : left, wingX = flip ? left : left + mainW;
  const gh = pr.door + Math.round(4 * k), uh = pr.door + Math.round(3 * k);
  const fb = Math.max(2, Math.round(2 * k));
  const hw = wingW / 2 + over;
  const rhW = Math.max(6, Math.min(Math.round(hw * 0.75), Math.round(uh * 0.7)));
  const rhM = Math.max(5, Math.round(rhW * 0.7));
  const H = gh + fb + uh + rhW + 3;
  const P = new Painter(W, H, kit);
  const G = H - 1;
  const yF = G - gh; // top of the ground floor
  const wy = yF - fb - uh; // eaves

  // --- ground floor: rendered blocks, darker damp plinth, vent-block band under the beam
  const masonry = (x: number, w: number, tone: number) => {
    P.box(x, yF, w, gh, lower, [0, 0.1, 1], { tone });
    // staggered block joints, faint so the render still reads smooth
    for (let yy = yF + 5, row = 0; yy < G - 2; yy += 5, row++)
      for (let xx = x + (row % 2 ? 2 : 6); xx < x + w - 1; xx += 8) { P.box(xx, yy, Math.min(5, x + w - 1 - xx), 1, lower, [0, 0, 1], { tone: tone - 1 }); P.px(xx - 1, yy - 2, lower, 2 + tone); }
    P.box(x, G - 2, w, 2, lower, [0, 0, 1], { tone: tone - 1 });
    for (let xx = x + 2; xx < x + w - 2; xx += 3) P.box(xx, yF + 2, 2, 1, lower, [0, 0, 1], { tone: tone - 2 });
  };
  masonry(mainX, mainW, 0);
  masonry(wingX, wingW, -1); // under the balcony, in shade
  const winW = pr.window + 1, winH = Math.round(pr.window * 1.4);
  const nGW = mainW >= winW * 3 + 8 ? 2 : 1;
  for (let i = 0; i < nGW; i++) louvre(P, trim, Math.round(mainX + ((i + 1) * mainW) / (nGW + 1) - winW / 2), yF + Math.round(gh * 0.32), winW, winH, lit);
  const dw = pr.doorW, dh = Math.min(pr.door, gh - 5);
  const dx = Math.round(wingX + wingW / 2 - dw / 2);
  P.box(dx - 1, G - dh - 1, dw + 2, dh + 1, trim, [0, 0, 1]);
  P.rect(dx, G - dh, dw, dh, trim, 0);
  P.rect(dx, G - dh, 1, dh, trim, 1);

  // --- upper floor: horizontal planks, corner boards, louvred shutters
  P.box(mainX, wy, mainW, uh, upper, [0, 0.1, 1]);
  wallTexture(P, mainX, wy, mainW, uh, upper, r);
  P.box(wingX, wy, wingW, uh, upper, [0, 0.1, 1], { tone: -2 }); // recessed balcony wall under the gable
  for (let yy = wy + 2; yy < yF - fb; yy += 3) P.rect(wingX, yy, wingW, 1, upper, 0);
  for (const x of [mainX, mainX + mainW - 2]) P.box(x, wy, 2, uh, trim, [x === mainX ? -0.4 : 0.4, 0, 1]);
  const uwH = Math.round(uh * 0.5);
  const nUW = mainW >= winW * 3 + 8 ? 2 : 1;
  for (let i = 0; i < nUW; i++) louvre(P, trim, Math.round(mainX + ((i + 1) * mainW) / (nUW + 1) - winW / 2), wy + Math.round(uh * 0.3), winW, uwH, lit);
  const bdh = Math.min(pr.door, uh - 4);
  P.box(dx - 1, yF - fb - bdh - 1, dw + 2, bdh + 1, trim, [0, -0.3, 1]);
  P.box(dx, yF - fb - bdh, dw, bdh, trim, [0, 0, 1], { tone: -1 });
  for (let xx = dx + 2; xx < dx + dw - 1; xx += 3) P.box(xx, yF - fb - bdh, 1, bdh, trim, [0, 0, 1], { tone: -2 });

  // floor beam / balcony slab
  P.box(left, yF - fb, tw, fb, trim, [0, -0.4, 0.9]);
  P.box(wingX, yF - fb, wingW, 1, trim, [0, -1, 0.5], { tone: 1 });

  // balcony rail with close balusters, then the posts that carry the wing roof down to the ground
  const rail = Math.max(5, Math.round(pr.door * 0.36));
  const ry = yF - fb - rail;
  P.box(wingX, ry, wingW, 2, trim, [0, -0.7, 0.7], { tone: 1 });
  for (let x = wingX + 1; x < wingX + wingW - 1; x += 2) P.box(x, ry + 2, 1, rail - 2, trim, [0, 0, 1]);
  const pw = Math.max(2, Math.round(2 * k));
  for (const x of [wingX, wingX + wingW - pw]) {
    P.cylinder(x, wy, pw, G - wy, trim);
    P.cylinder(x - 1, G - 2, pw + 2, 2, "stone", { flat: 0.3 });
  }

  // --- roofs: side-gable over the main block, front gable over the wing (drawn on top)
  const ma = flip ? wingX + wingW - 2 : mainX - over, mb = flip ? mainX + mainW + over : wingX + 2;
  // the outer end slopes down like a gable end seen at 3/4
  const ins = Math.round(rhM * 0.9);
  for (let x = ma; x < mb; x++) {
    const e = flip ? mb - 1 - x : x - ma;
    const top = Math.round(wy - rhM + (e < ins ? rhM * (1 - (e + 0.5) / ins) : 0));
    if (corr) corrColumn(P, roof, x, x - ma, top, wy);
    else {
      P.box(x, top, 1, wy + 1 - top, roof, [0, -0.35, 0.95]);
      for (let yy = wy - 1; yy > top; yy -= 3) P.box(x, yy, 1, 1, roof, [0, 0.2, 1], { tone: -1 });
    }
    P.box(x, top, 1, 1, roof, [0, -1, 0.4], { tone: 1 });
  }
  P.box(mainX, wy + 1, mainW, 2, upper, [0, 1, 0.3], { tone: -2 }); // eave shadow
  const ga = wingX - over, gb = wingX + wingW + over, cx = (ga + gb) / 2;
  const band = Math.max(2, Math.round(3 * k));
  for (let x = ga; x < gb; x++) {
    const u = (x + 0.5 - cx) / hw;
    const top = Math.round(wy + 1 - rhW * (1 - Math.abs(u)));
    if (top > wy) continue;
    // pediment: shaded boards with vent slats, then the roof sheet along the rake
    P.box(x, top, 1, wy + 1 - top, upper, [0, 0.2, 1], { tone: -2 });
    for (let yy = wy - 2; yy > top + band; yy -= 2) if (Math.abs(u) < 0.55) P.px(x, yy, upper, 0);
    const bh = Math.min(band, wy + 1 - top);
    if (corr) P.rect(x, top, 1, bh, roof, ((x - ga) >> 1) % 2 ? 3 : 2);
    else P.box(x, top, 1, bh, roof, [u * 0.9, -0.35, 0.8]);
    P.box(x, top, 1, 1, roof, [0, -1, 0.4], { tone: 1 });
  }
  P.box(ga + 1, wy, gb - ga - 2, 1, trim, [0, 1, 0.3], { tone: -1 }); // tie beam
  return { rows: [{ name: "idle", frames: [finalize(P.toSprite(), kit)] }], fps: 1 };
}

// ---------------------------------------------------------------------------
// Farm buildings: farmhouse (small/medium/large), large gambrel barn, coop.
// ---------------------------------------------------------------------------

function plainDoor(P: Painter, x: number, baseY: number, w: number, h: number, trim: Material) {
  P.box(x - 1, baseY - h - 1, w + 2, h + 1, trim, [0, 0, 1], { tone: -1 });
  P.box(x, baseY - h, w, h, trim, [0, 0, 1]);
  for (let xx = x + 2; xx < x + w - 1; xx += 3) P.box(xx, baseY - h, 1, h, trim, [0, 0, 1], { tone: -1 });
  P.px(x + w - 2, baseY - Math.round(h / 2), "gold", 3);
}

function farmWindow(P: Painter, x: number, y: number, w: number, h: number, trim: Material, lit: boolean) {
  P.box(x - 1, y - 1, w + 2, h + 2, trim, [0, -0.3, 1]);
  P.rect(x, y, w, h, lit ? "gold" : "water", lit ? 3 : 1);
  if (lit) P.rect(x, y, Math.ceil(w / 2), Math.ceil(h / 2), "gold", 4);
  else P.px(x, y, "water", 4);
  if (w >= 4) P.rect(x + Math.floor(w / 2), y, 1, h, trim, 1), P.rect(x, y + Math.floor(h / 2), w, 1, trim, 1);
  P.box(x - 1, y + h + 1, w + 2, 1, trim, [0, -0.6, 0.8], { tone: 1 });
}

function flowerBox(P: Painter, x: number, y: number, w: number) {
  P.box(x - 1, y, w + 2, 2, "wood", [0, -0.5, 0.8], { tone: -1 });
  for (let xx = x; xx < x + w; xx += 2) P.px(xx, y - 1, xx % 4 === 0 ? "cloth2" : "foliage", 3);
}

/**
 * Farmhouse. small: one-storey cottage with a porch over the door; medium: loft
 * under a taller roof with a dormer; large: two storeys (1.5x canvas) with a
 * wraparound porch that reaches past the walls.
 */
function farmhouse(p: Params, kit: StyleKit, seed: number, size: string): Painter {
  const r = rng(seed);
  const S = kit.sizes.building;
  const k = S / 64;
  const pr = proportions(kit);
  const wall = mat(p, "wall"), roof = mat(p, "roof"), trim = mat(p, "trim");
  const lit = bool(p, "lit_windows");
  const large = size === "large", med = size === "medium";
  const W = large ? Math.round(S * 1.5) : S;
  const ext = large ? Math.round(W * 0.09) : 0;
  const ww = large ? Math.round(W * 0.6) : Math.round((S - 8) * (med ? 0.8 : 0.7));
  const wx = Math.round((W - ww) / 2);
  const wh = pr.story * (large ? 2 : 1);
  const over = Math.max(1, Math.round(3 * k));
  const rh = Math.round(Math.min(ww * (med ? 0.42 : 0.34), pr.story * (med ? 1.25 : 0.9)));
  const H = wh + rh + Math.round(10 * k) + 6;
  const P = new Painter(W, H, kit);
  const baseY = H - 2;
  const wy = baseY - wh;
  const rx0 = wx - over, rx1 = wx + ww + over;
  const dw = pr.doorW, dh = pr.door;
  const dx = Math.round(W / 2 - dw / 2);
  const winW = pr.window, winH = Math.round(pr.window * 1.15);

  P.box(wx, wy, ww, wh, wall, [0, 0.1, 1]);
  wallTexture(P, wx, wy, ww, wh, wall, r);
  const fh = Math.max(2, Math.round(3 * k));
  P.box(wx - 1, baseY - fh, ww + 2, fh + 1, "stone", [0, 0, 1], { tone: -1 });
  const cp = Math.max(1, Math.round(2 * k));
  P.box(wx, wy, cp, wh, trim, [-0.4, 0, 1]);
  P.box(wx + ww - cp, wy, cp, wh, trim, [0.4, 0, 1]);
  if (large) P.box(wx, baseY - pr.story - 1, ww, 1, trim, [0, -0.4, 1], { tone: -1 });

  // gable end facing us, then the eave shadow
  gableRoof(P, roof, rx0, rx1, wy, rh, k, false);
  P.box(wx, wy + 1, ww, Math.max(1, Math.round(2 * k)), wall, [0, 1, 0.3], { tone: -1 });
  if (bool(p, "chimney")) {
    const cw = Math.max(3, Math.round(5 * k));
    const cx = Math.round(wx + ww * 0.82);
    const top = wy - Math.round(rh * 0.55);
    P.box(cx, top, cw, Math.round(9 * k), "stone", [0.2, 0, 1]);
    P.box(cx - 1, top - 1, cw + 2, Math.max(1, Math.round(2 * k)), "stone", [0, -1, 0.5]);
  }
  if (med) {
    const dwid = winW + 6, dhgt = winH + 4;
    const ddx = Math.round(W / 2 - dwid / 2), dby = wy - Math.max(2, Math.round(rh * 0.1));
    const top = dby - dhgt;
    P.box(ddx, top, dwid, dhgt, wall, [0, 0, 1]);
    P.poly([[ddx - 1, top + 1], [ddx + dwid + 1, top + 1], [ddx + dwid / 2, top - Math.max(3, Math.round(5 * k))]], roof, [0, -0.5, 0.9]);
    farmWindow(P, ddx + 3, top + 2, winW, winH, trim, lit);
  }

  plainDoor(P, dx, baseY - fh + 1, dw, dh, trim);
  const gy = baseY - Math.round(dh * 0.78);
  for (const [a, b] of [[wx + 2, dx - 2], [dx + dw + 2, wx + ww - 2]] as [number, number][]) {
    if (b - a < winW + 4) continue;
    const x = Math.round((a + b - winW) / 2);
    farmWindow(P, x, gy, winW, winH, trim, lit);
    if (bool(p, "flower_box")) flowerBox(P, x, gy + winH + 2, winW);
  }
  if (large) {
    const n = Math.max(2, Math.floor(ww / (13 * k)));
    for (let i = 0; i < n; i++) farmWindow(P, Math.round(wx + ((i + 0.5) * ww) / n - winW / 2), wy + Math.round(8 * k), winW, winH, trim, lit);
  }

  // porch: deck, shed roof band, posts, rail
  const px0 = large ? wx - ext : Math.max(wx + 1, dx - Math.round((med ? 9 : 6) * k));
  const px1 = large ? wx + ww + ext : Math.min(wx + ww - 1, dx + dw + Math.round((med ? 9 : 6) * k));
  const bandH = Math.max(3, Math.round(4 * k));
  const bandY = baseY - dh - Math.round(5 * k) - bandH;
  const deckH = Math.max(2, Math.round(2 * k));
  const under = baseY - deckH - bandY - bandH + 1;
  if (large) for (const x of [px0, wx + ww]) P.box(x, bandY + bandH, ext, under, wall, [0, 0, 0.8], { tone: -1 });
  P.box(px0 - 1, baseY - deckH + 1, px1 - px0 + 2, deckH, trim, [0, -0.6, 0.9]);
  const railH = Math.max(3, Math.round(dh * 0.2));
  const postW = Math.max(1, Math.round(1.5 * k));
  if (large) {
    P.box(px0, baseY - deckH - railH + 1, px1 - px0, 1, trim, [0, -0.5, 1]);
    for (let xx = px0 + 2; xx < px1 - 1; xx += 3) if (xx < dx - 1 || xx > dx + dw) P.box(xx, baseY - deckH - railH + 2, 1, railH - 2, trim, [0, 0, 1], { tone: -1 });
  }
  const nPosts = Math.max(2, Math.round((px1 - px0) / Math.round(24 * k)) + 1);
  for (let i = 0; i < nPosts; i++) {
    const xx = Math.round(px0 + ((px1 - px0 - postW) * i) / (nPosts - 1));
    P.box(xx, bandY + bandH, postW + 1, under, trim, [xx < W / 2 ? -0.4 : 0.4, 0, 1]);
  }
  P.poly([[px0 - 1, bandY], [px1 + 1, bandY], [px1 + 2, bandY + bandH], [px0 - 2, bandY + bandH]], roof, [0, -0.45, 0.9]);
  P.box(px0 - 2, bandY + bandH - 1, px1 - px0 + 4, 1, roof, [0, 0.2, 1], { tone: -1 });
  return P;
}

/** Large gambrel barn: the end wall follows the two-pitch outline, with big double doors and a hayloft door. */
function largeBarn(p: Params, kit: StyleKit): Painter {
  const S = kit.sizes.building;
  const k = S / 64;
  const pr = proportions(kit);
  const wall = mat(p, "wall"), roof = mat(p, "roof"), trim = mat(p, "trim");
  const lit = bool(p, "lit_windows");
  const W = Math.round(S * 1.5);
  const wx = Math.round(5 * k); // equal margins either side keep the outline mirror-symmetric
  const ww = W - 2 * wx;
  const wallH = Math.round(pr.story * 1.45);
  const k1 = Math.round(ww * 0.11), k2 = Math.round(ww * 0.13);
  const in1 = Math.round(ww * 0.12), in2 = Math.round(ww * 0.3);
  const H = wallH + k1 + k2 + Math.round(8 * k);
  const P = new Painter(W, H, kit);
  const baseY = H - 2;
  const wy = baseY - wallH;
  const pts: [number, number][] = [
    [wx, baseY], [wx, wy], [wx + in1, wy - k1], [wx + in2, wy - k1 - k2],
    [wx + ww - in2, wy - k1 - k2], [wx + ww - in1, wy - k1], [wx + ww, wy], [wx + ww, baseY],
  ];
  const topY = (x: number) => {
    for (let i = 1; i < 6; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      if (x >= ax && x <= bx && bx > ax) return ay + ((by - ay) * (x - ax)) / (bx - ax);
    }
    return wy;
  };
  P.poly(pts, wall, [0, 0.1, 1]);
  // vertical siding boards that follow the outline
  for (let xx = wx + 3; xx < wx + ww - 1; xx += 4) {
    const t = Math.ceil(topY(xx + 0.5)) + 2;
    P.box(xx, t, 1, baseY - t, wall, [0, 0, 1], { tone: -1 });
  }
  const fh = Math.max(2, Math.round(3 * k));
  P.box(wx - 1, baseY - fh, ww + 2, fh + 1, "stone", [0, 0, 1], { tone: -1 });
  P.box(wx, wy, ww, 1, trim, [0, -0.4, 1], { tone: -1 });
  const cp = Math.max(1, Math.round(2 * k));
  P.box(wx, wy, cp, wallH, trim, [-0.4, 0, 1]);
  P.box(wx + ww - cp, wy, cp, wallH, trim, [0.4, 0, 1]);

  // roof edge boards along both pitches, with a trim line beneath
  const th = Math.max(2, Math.round(2 * k));
  for (let i = 1; i < 4; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const [cx, cy] = pts[7 - i], [ex, ey] = pts[6 - i];
    for (let t = 0; t < th; t++) {
      P.line(ax - 1, ay - 1 - t, bx, by - 1 - t, roof, i === 3 ? 2 : 1);
      P.line(cx, cy - 1 - t, ex - 1, ey - 1 - t, roof, i === 3 ? 2 : 1);
    }
    P.line(ax, ay, bx, by, trim, 3);
    P.line(cx - 1, cy, ex - 1, ey, trim, 3);
  }

  // big double doors with X braces
  const dw = Math.round(pr.doorW * 3), dh = Math.round(pr.door * 1.25);
  const dx = Math.round(W / 2 - dw / 2);
  P.box(dx - 2, baseY - dh - 2, dw + 4, dh + 2, trim, [0, 0, 1], { tone: -1 });
  P.box(dx, baseY - dh, dw, dh, wall, [0, 0, 1], { tone: -1 });
  const half = Math.floor(dw / 2);
  for (const lx of [dx, dx + half + 1]) {
    const lw = half - 1;
    P.box(lx, baseY - dh, lw, 1, trim, [0, -0.4, 1]);
    P.box(lx, baseY - 1, lw, 1, trim, [0, 0.4, 1]);
    P.box(lx, baseY - dh, 1, dh, trim, [-0.4, 0, 1]);
    P.box(lx + lw - 1, baseY - dh, 1, dh, trim, [0.4, 0, 1]);
    P.line(lx, baseY - dh, lx + lw - 1, baseY - 1, trim, 1);
    P.line(lx + lw - 1, baseY - dh, lx, baseY - 1, trim, 1);
  }
  P.rect(dx + half, baseY - dh, 1 + (dw % 2), dh, trim, 0);
  P.px(dx + half - 2, baseY - Math.round(dh / 2), "gold", 3);
  P.px(dx + half + 2, baseY - Math.round(dh / 2), "gold", 3);
  // hayloft door
  const hw = Math.max(4, Math.round(pr.doorW * 1.05)), hh = Math.max(5, Math.round(pr.door * 0.5));
  const hx = Math.round(W / 2 - hw / 2), hy = wy - k1 + Math.round(hh * 0.2) - Math.round(hh * 0.8);
  P.box(hx - 1, hy - 1, hw + 2, hh + 2, trim, [0, 0, 1]);
  P.rect(hx, hy, hw, hh, lit ? "gold" : "wood", lit ? 2 : 0);
  P.line(hx, hy, hx + hw - 1, hy + hh - 1, trim, 1);
  P.line(hx + hw - 1, hy, hx, hy + hh - 1, trim, 1);
  P.px(Math.round(W / 2), hy - 3, "metal", 3); // hay hook
  const winW = pr.window, winH = Math.round(pr.window * 1.15);
  const wyy = baseY - Math.round(dh * 0.8);
  for (const x of [Math.round((wx + dx) / 2 - winW / 2 + 1), Math.round((dx + dw + wx + ww) / 2 - winW / 2)]) farmWindow(P, x, wyy, winW, winH, trim, lit);
  return P;
}

/** Chicken coop. small: raised box with ramp, pop door and nesting box; large: walk-in coop (human door) with a fenced run. */
function coop(p: Params, kit: StyleKit, size: string): Painter {
  const S = kit.sizes.building;
  const k = S / 64;
  const pr = proportions(kit);
  const wall = mat(p, "wall"), roof = mat(p, "roof"), trim = mat(p, "trim");
  const large = size === "large";
  const W = large ? S : Math.round(S * 0.6);
  const bh = Math.round(pr.door * (large ? 1.12 : 0.5));
  const legH = large ? 2 : Math.max(2, Math.round(pr.door * 0.22));
  const ww = Math.round(W * (large ? 0.44 : 0.56));
  const rh = Math.max(3, Math.round(bh * (large ? 0.42 : 0.5)));
  const nestW = Math.max(3, Math.round(W * (large ? 0.1 : 0.16)));
  const H = bh + legH + rh + 6 + Math.round(2 * k);
  const P = new Painter(W, H, kit);
  const baseY = H - 2;
  const bx = W - 4 - nestW - ww;
  const floorY = baseY - legH;
  const by = floorY - bh;
  const over = Math.max(1, Math.round(2 * k));

  if (large) {
    const fx0 = 2, fx1 = bx - 1;
    const fh = Math.round(pr.door * 0.5);
    P.box(fx0, baseY - 1, fx1 - fx0, 2, "dirt", [0, -0.5, 0.8], { tone: -1 });
    for (let xx = fx0 + 1; xx < fx1; xx += 2) P.box(xx, baseY - fh, 1, fh - 1, trim, [0, 0, 1], { tone: -1 });
    P.box(fx0, baseY - fh, fx1 - fx0, 1, trim, [0, -0.5, 1]);
    P.box(fx0, baseY - Math.round(fh * 0.4), fx1 - fx0, 1, trim, [0, -0.5, 1], { tone: -1 });
    for (let xx = fx0; xx <= fx1 - 1; xx += Math.max(8, Math.round(12 * k))) P.box(xx, baseY - fh - 1, 2, fh + 1, trim, [xx < 3 ? -0.4 : 0.1, 0, 1]);
    P.box(fx1 - 2, baseY - fh - 1, 2, fh + 1, trim, [0.4, 0, 1]);
  }
  if (!large) {
    P.box(bx + 1, floorY, 2, legH + 1, trim, [-0.4, 0, 1]);
    P.box(bx + ww - 3, floorY, 2, legH + 1, trim, [0.4, 0, 1]);
  } else P.box(bx - 1, floorY, ww + 2, legH + 1, "stone", [0, 0, 1], { tone: -1 });
  P.box(bx, by, ww, bh, wall, [0, 0.1, 1]);
  for (let yy = by + 2; yy < floorY; yy += 3) P.box(bx, yy, ww, 1, wall, [0, 0, 1], { tone: -1 });
  P.box(bx, by, 1, bh, trim, [-0.4, 0, 1]);
  P.box(bx + ww - 1, by, 1, bh, trim, [0.4, 0, 1]);
  // nesting box on the right with its own lid
  const nh = Math.max(3, Math.round(bh * (large ? 0.45 : 0.62)));
  const ny = floorY - nh - (large ? 3 : 0);
  P.box(bx + ww, ny, nestW, nh, wall, [0.3, 0, 1], { tone: -1 });
  P.box(bx + ww - 1, ny - 2, nestW + 3, 2, roof, [0.3, -0.7, 0.8]);
  P.box(bx + ww + 1, ny + 1, Math.max(1, nestW - 2), Math.max(1, Math.floor(nh / 2)), trim, [0, 0, 1], { tone: -1 });
  gableRoof(P, roof, bx - over, bx + ww + over, by, rh, k, false);
  // pop door + ramp
  const cdw = Math.max(2, Math.round(pr.doorW * 0.4)), cdh = Math.max(3, Math.round(pr.door * 0.32));
  const cdx = bx + Math.max(2, Math.round(ww * 0.14));
  P.box(cdx - 1, floorY - cdh - 1, cdw + 2, cdh + 1, trim, [0, 0, 1]);
  P.rect(cdx, floorY - cdh, cdw, cdh, "wood", 0);
  const rl = Math.max(4, Math.min(legH * 3 + (large ? 8 : 2), cdx - 2));
  for (let t = 0; t < 2; t++) P.line(cdx - rl, baseY - 1 - t, cdx, floorY - 1 - t, trim, 2 + t);
  for (let i = 2; i < rl - 1; i += 3) P.px(cdx - rl + i, baseY - 2 - Math.round((i / rl) * (legH - 1)), trim, 0);
  if (large) {
    const dw = pr.doorW, dh = pr.door;
    plainDoor(P, bx + ww - dw - Math.max(3, Math.round(ww * 0.12)), baseY - legH + 1, dw, dh, trim);
  }
  return P;
}

export const buildingGenerator: Generator = {
  id: "building",
  category: "building",
  label: "Building",
  description: "Front-facing 3/4 view building: cottage, shop, tower, keep, barn raised stilt-house (open ground floor, stairs/ladder, veranda) or two-storey half-brick house (masonry ground floor, wooden upper floor, gabled balcony wing) with wall/roof materials, floors, windows, chimney.",
  params: [
    { key: "style", label: "Style", type: "select", options: ["cottage", "shop", "tower", "keep", "barn", "stilt-house", "half-brick", "farmhouse", "coop", "inn", "blacksmith", "temple", "windmill", "greenhouse", "market-stall", "well-house"], default: "cottage" },
    // medium is today's output for every older style; barn small and medium are the same classic barn, large is the gambrel barn.
    { key: "size", label: "Size", type: "select", options: ["small", "medium", "large"], default: "medium" },
    { key: "wall", label: "Walls", type: "material", options: WALLS, default: "wood" },
    { key: "roof", label: "Roof", type: "material", options: ROOFS, default: "roof" },
    { key: "roof_style", label: "Roof style", type: "select", options: ["auto", "gable", "hip", "flat", "dome", "spire", "corrugated"], default: "auto" },
    { key: "floors", label: "Floors", type: "number", min: 1, max: 3, default: 1 },
    { key: "width", label: "Width", type: "select", options: ["narrow", "normal", "wide"], default: "normal" },
    { key: "lit_windows", label: "Lit windows", type: "bool", default: true },
    { key: "chimney", label: "Chimney", type: "bool", default: true },
    { key: "access", label: "Stilt-house access", type: "select", options: ["stairs", "ladder"], default: "stairs" },
    { key: "trim", label: "Trim / door", type: "material", options: ["wood", "stone", "metal", "gold", "leather", "dirt", "sand"], default: "wood" },
    { key: "flower_box", label: "Flower boxes (farmhouse)", type: "bool", default: true },
    { key: "look", label: "Look", type: "select", options: ["classic", "rich"], default: "classic" },
    // Rich-look details (ignored by classic). auto = the style's own default.
    { key: "tier", label: "Upgrade tier (rich farmhouse/barn/coop; 0 = from size)", type: "number", min: 0, max: 3, default: 0 },
    { key: "porch", label: "Porch hood", type: "select", options: TRI, default: "auto" },
    { key: "balcony", label: "Balcony", type: "select", options: TRI, default: "auto" },
    { key: "awning", label: "Striped awning", type: "select", options: TRI, default: "auto" },
    { key: "awning_color", label: "Awning colour", type: "material", options: ["cloth2", "cloth", "accent", "foliage", "water", "gold"], default: "cloth2" },
    { key: "sign", label: "Sign text", type: "select", options: SIGN_OPTIONS, default: "auto" },
    { key: "lanterns", label: "Wall lanterns", type: "select", options: TRI, default: "auto" },
    { key: "flower_boxes", label: "Window flower boxes", type: "select", options: TRI, default: "auto" },
    { key: "ivy", label: "Ivy", type: "select", options: TRI, default: "auto" },
    { key: "wear", label: "Wear (cracks, stains, moss)", type: "select", options: TRI, default: "auto" },
    { key: "yard", label: "Yard props (crates, barrels)", type: "select", options: TRI, default: "auto" },
    { key: "hayloft", label: "Hayloft door (barn)", type: "select", options: TRI, default: "auto" },
    { key: "gable", label: "Gable (stilt-house, half-brick, any rich roof)", type: "select", options: ["western", "thai"], default: "western" },
  ],
  generate(p, kit, seed) {
    const res = generateSprite(p, kit, seed);
    if (kit.camera === "iso") return res; // iso meta already names its own footprint
    const fp = buildingFootprint(str(p, "style"), str(p, "size"), kit, num(p, "tier"));
    return { ...res, meta: { ...res.meta, footprint: fp, door: fp.door, entry: fp.entry } };
  },
};

function generateSprite(p: Params, kit: StyleKit, seed: number): GenResult {
  {
    if (kit.camera === "iso") return isoBuildingResult(p, kit, seed);
    if (str(p, "look") === "rich") return richBuildingResult(p, kit, seed);
    const r = rng(seed);
    const S = kit.sizes.building;
    const k = S / 64;
    const pr = proportions(kit);
    const style = str(p, "style");
    if (style === "stilt-house") return stiltHouse(p, kit, r);
    if (style === "half-brick") return halfBrickHouse(p, kit, r);
    const size = str(p, "size");
    if (style === "farmhouse" || style === "coop" || (style === "barn" && size === "large")) {
      const P = style === "coop" ? coop(p, kit, size) : style === "barn" ? largeBarn(p, kit) : farmhouse(p, kit, seed, size);
      return { rows: [{ name: "idle", frames: [finalize(P.toSprite(), kit)] }], fps: 1 };
    }
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
  }
}

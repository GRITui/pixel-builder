// Isometric variants of the `building` generator (kit.camera === "iso").
//
// Every style is an iso box on an n x n diamond footprint with two visible walls (SW lit, SE shaded,
// from the kit's one light) and one of the roof types gable / hip / flat / dome / spire / corrugated.
// Anchor contract (same as iso props): the sprite is centred on the footprint and its bottom is the
// footprint's bottom vertex, so `isoPropOrigin` puts the footprint exactly on the grid when the
// building is stored on the footprint's bottom-most cell.
import { finalize } from "../enforce";
import { proportions } from "../kit";
import { Painter } from "../painter";
import type { Material } from "../palette";
import { rng } from "../rng";
import { createSprite } from "../sprite";
import type { Sprite, StyleKit } from "../types";
import { ISO_PROP_MARGIN, isoTileW, N, TOP, WALL_SE, WALL_SW, type Vec3 } from "./iso";
import { bool, mat, num, str, type GenResult, type Params } from "./types";

export type IsoRoof = "gable" | "hip" | "flat" | "dome" | "spire" | "corrugated";
type Pt = [number, number];

/** Footprint cells per side for [small, medium, large]. */
const FOOTPRINT: Record<string, [number, number, number]> = {
  cottage: [1, 2, 3], shop: [1, 2, 3], tower: [1, 1, 2], keep: [2, 2, 3], barn: [2, 2, 3],
  farmhouse: [1, 2, 3], coop: [1, 1, 2], "stilt-house": [1, 2, 2], "half-brick": [2, 2, 3],
};
const AUTO_ROOF: Record<string, IsoRoof> = { tower: "spire", keep: "flat", "stilt-house": "hip" };

export const isoFootprint = (style: string, size: string) => (FOOTPRINT[style] ?? FOOTPRINT.cottage)[Math.max(0, ["small", "medium", "large"].indexOf(size))];

/** Drop empty rows above the art so the sprite is only as tall as the building (the bottom anchor never moves). */
function cropTop(s: Sprite, keep: number): Sprite {
  let y0 = 0;
  while (y0 < s.h && s.data.slice(y0 * s.w, (y0 + 1) * s.w).every((v) => v === 0)) y0++;
  const cut = Math.max(0, y0 - keep);
  if (!cut) return s;
  const out = createSprite(s.w, s.h - cut);
  out.data = s.data.slice(cut * s.w);
  return out;
}

export function isoBuildingStyled(kit: StyleKit, p: Params, seed: number): Sprite {
  const pr = proportions(kit);
  const T = isoTileW(kit), TH = T / 2, k = T / 32;
  const r = rng(seed * 59 + 3);
  const style = str(p, "style"), size = str(p, "size");
  const n = isoFootprint(style, size);
  const wall = mat(p, "wall"), roof = mat(p, "roof"), trim = mat(p, "trim");
  let roofStyle = str(p, "roof_style") as IsoRoof | "auto";
  if (roofStyle === "auto") roofStyle = AUTO_ROOF[style] ?? "gable";
  const corr = roofStyle === "corrugated";
  const lit = bool(p, "lit_windows");
  const tower = style === "tower", keep = style === "keep", barn = style === "barn", coop = style === "coop", stilt = style === "stilt-house", brick = style === "half-brick", shop = style === "shop";

  const story = pr.door + 2;
  const floors = brick ? Math.max(2, num(p, "floors")) : Math.max(1, Math.round(num(p, "floors")));
  const wh = Math.round(coop ? story * 0.55 : tower ? story * (1.5 + 0.6 * floors) : barn ? story * 1.1 : keep ? story * (0.9 + 0.5 * floors) : story * (1 + 0.85 * (floors - 1)));
  const lift = stilt ? Math.round(T * 0.3) : 0;
  const ov = 3 * k, ovc = ov / (T / 2); // roof overhang in px and in cells
  const rhBase = Math.round(T * (0.2 + 0.1 * n) * (barn ? 1.2 : coop ? 0.8 : 1));
  const rh = roofStyle === "flat" ? 0 : roofStyle === "dome" ? Math.round(n * T * 0.34) : roofStyle === "spire" ? Math.round(T * (0.55 + 0.22 * n)) : roofStyle === "hip" ? Math.round(rhBase * 0.9) : rhBase;
  const pad = stilt ? Math.round(9 * k) : 0;
  const W = n * T + 2 * Math.round(ov + 3) + pad;
  const top = lift + wh + rh + 14 + Math.round(T * 0.4);
  const bottomMargin = 2; // outline row + the transparent margin
  const Hc = top + n * TH + bottomMargin;
  const P = new Painter(W, Hc, kit);
  const ox = Math.round((W - pad) / 2), oy = top;
  // world -> screen: u runs SE, v runs SW (in cells), z is pixels up
  const S = (u: number, v: number, z: number): Pt => [ox + ((u - v) * T) / 2, oy + ((u + v) * TH) / 2 - z];
  const quad = (pts: Pt[], m: Material, nrm: Vec3, tone = 0) => P.poly(pts, m, nrm, { tone });
  // a rectangle on a visible wall: face "sw" runs along u at v = n, face "se" along v at u = n
  const on = (face: "sw" | "se", a0: number, a1: number, z0: number, z1: number, m: Material, tone = 0) => {
    const f = (a: number, z: number): Pt => (face === "sw" ? S(a, n, z) : S(n, a, z));
    quad([f(a0, z0), f(a1, z0), f(a1, z1), f(a0, z1)], m, face === "sw" ? WALL_SW : WALL_SE, tone);
  };
  const pt = (face: "sw" | "se", a: number, z: number): Pt => (face === "sw" ? S(a, n, z) : S(n, a, z));

  // ---- stilts, then the walls
  if (stilt) {
    const posts: Pt[] = [];
    for (let i = 0; i <= n * 2; i++) { posts.push(S(i / 2, n, 0)); if (i < n * 2) posts.push(S(n, i / 2, 0)); }
    for (const [x, y] of posts) P.box(Math.round(x) - 1, Math.round(y) - lift, 2, lift + 1, "wood", WALL_SW, { tone: -1 });
    // the SE row of posts is in shade
    for (let i = 0; i < n * 2; i++) { const [x, y] = S(n, i / 2, 0); P.box(Math.round(x), Math.round(y) - lift, 1, lift + 1, "wood", WALL_SE, { tone: -1 }); }
  }
  const z0 = lift;
  const lowStone = brick ? Math.round(story * 0.9) : 0;
  const wallFace = (face: "sw" | "se") => {
    if (brick) {
      on(face, 0, n, z0, z0 + lowStone, "stone", 0);
      on(face, 0, n, z0 + lowStone, z0 + wh, wall, 0);
      on(face, 0, n, z0 + lowStone - 1, z0 + lowStone + 1, trim, -1); // plate between the floors
    } else on(face, 0, n, z0, z0 + wh, wall);
  };
  wallFace("sw");
  wallFace("se");
  // course lines (details only): planks run level, masonry gets staggered joints
  const masonry = (m: Material) => m !== "wood" && m !== "leather";
  const course = (face: "sw" | "se", zFrom: number, zTo: number, m: Material) => {
    const a = pt(face, face === "sw" ? 0.02 : n - 0.02, 0), b = pt(face, face === "sw" ? n - 0.02 : 0.02, 0);
    const nrm = face === "sw" ? WALL_SW : WALL_SE;
    let row = 0;
    for (let z = zFrom + 4; z < zTo; z += 4, row++) {
      const dy = -z;
      for (let x = Math.ceil(Math.min(a[0], b[0])); x < Math.max(a[0], b[0]); x++) {
        const y = Math.round(a[1] + ((b[1] - a[1]) * (x + 0.5 - a[0])) / (b[0] - a[0]) + dy);
        P.box(x, y, 1, 1, m, nrm, { tone: -1 });
        if (masonry(m) && (x + row * 3) % 7 === 0) P.box(x, y - 1, 1, 1, m, nrm, { tone: -1 });
      }
    }
  };
  for (const f of ["sw", "se"] as const) {
    if (brick) { course(f, z0, z0 + lowStone, "stone"); course(f, z0 + lowStone, z0 + wh, wall); } else course(f, z0, z0 + wh, wall);
  }
  // base trim (skipped when the house stands on stilts)
  if (!stilt) { on("sw", 0, n, 0, 2, "stone"); on("se", 0, n, 0, 2, "stone"); } else { on("sw", 0, n, z0 - 2, z0, trim, -1); on("se", 0, n, z0 - 2, z0, trim, -1); }

  // ---- door (SW wall) and style dressing
  const um = shop ? n * 0.32 : n / 2;
  const dwc = Math.min(barn ? 0.62 : 0.42, (barn ? 1.25 : keep ? 0.7 : coop ? 0.3 : 0.5) / n * (n > 1 ? 1 : 1.1) * (n > 2 ? 1.3 : 1));
  const dz = Math.min(wh - 3, coop ? Math.round(wh * 0.62) : barn ? Math.round(pr.door * 1.05) : pr.door - 2);
  if (!(tower && false)) {
    const a0 = um - dwc / 2, a1 = um + dwc / 2;
    if (keep) {
      on("sw", a0 - 0.04, a1 + 0.04, z0, z0 + dz + 2, "stone", -1); // arch frame
      on("sw", a0, a1, z0, z0 + dz, "wood", -2);
      for (let x = a0; x < a1; x += 0.16) { const [px, py] = pt("sw", x + 0.05, z0 + dz - 2); P.px(Math.round(px), Math.round(py), "metal", 1); }
    } else {
      on("sw", a0 - 0.04, a1 + 0.04, z0, z0 + dz + 1, trim, -1);
      on("sw", a0, a1, z0, z0 + dz, coop ? "dirt" : "wood", -1);
      if (barn) {
        // X brace across the double door
        const [ax, ay] = pt("sw", a0, z0 + dz), [bx, by] = pt("sw", a1, z0), [cx, cy] = pt("sw", a0, z0), [dx, dy] = pt("sw", a1, z0 + dz);
        P.line(ax, ay, bx, by, trim, 1); P.line(cx, cy, dx, dy, trim, 1);
        const [mx, my] = pt("sw", (a0 + a1) / 2, z0); P.rect(mx, my - dz, 1, dz, "wood", 0);
      }
      const [kx, ky] = pt("sw", a1 - 0.08, z0 + dz / 2);
      P.px(Math.round(kx), Math.round(ky), "gold", 3);
    }
    if (coop) {
      // ramp down from the pop door
      const [rx0, ry0] = pt("sw", a0, z0), [rx1, ry1] = pt("sw", a1, z0);
      P.poly([[rx0, ry0 - 1], [rx1, ry1 - 1], [rx1 - 2, ry1 + 3], [rx0 - 2, ry0 + 3]], trim, TOP, { tone: 0 });
    }
  }
  const win = (face: "sw" | "se", c: number, zBase: number, wcells = 0.2) => {
    const zw0 = zBase, zw1 = zBase + Math.round(pr.window * 1.2);
    if (zw1 > z0 + wh - 2) return;
    const nr = face === "sw" ? WALL_SW : WALL_SE;
    const f = (a: number, z: number): Pt => pt(face, a, z);
    on(face, c - wcells - 0.03, c + wcells + 0.03, zw0 - 1, zw1 + 1, trim, -1);
    const pts: Pt[] = [f(c - wcells, zw0), f(c + wcells, zw0), f(c + wcells, zw1), f(c - wcells, zw1)];
    P.poly(pts, lit ? "gold" : "water", nr, { tone: lit ? 1 : 0 });
    const mid: Pt = [(pts[0][0] + pts[2][0]) / 2, (pts[0][1] + pts[2][1]) / 2];
    P.px(Math.round(mid[0]), Math.round(mid[1]), lit ? "gold" : "water", 4);
    on(face, c - wcells - 0.05, c + wcells + 0.05, zw0 - 2, zw0 - 1, trim, 1); // sill
  };
  const floorWindows = (f: number) => {
    const zb = z0 + (f === 0 ? Math.round(wh * 0.42) : Math.round(story * (1 + 0.85 * (f - 1)) + wh * 0.0) + Math.round(story * 0.35));
    const fz = brick ? (f === 0 ? z0 + Math.round(story * 0.3) : z0 + lowStone + Math.round(story * 0.3)) : zb;
    if (tower) { win("sw", n / 2, z0 + Math.round(story * (0.6 + 0.8 * f)), 0.1); return; }
    if (f === 0 && n === 1 && !shop) win("sw", 0.2, fz, 0.1);
    else if (n >= 2 || f > 0) {
      const cnt = Math.max(1, n * 2 - 1);
      for (let i = 0; i < cnt; i++) {
        const c = ((i + 0.5) * n) / cnt;
        if (f === 0 && Math.abs(c - um) < dwc / 2 + 0.22) continue;
        win("sw", c, fz);
      }
    }
    if (!(coop && f === 0)) win("se", n / 2, fz, n > 2 ? 0.18 : 0.2);
    if (n >= 3) win("se", n * 0.2, fz); if (n >= 3) win("se", n * 0.8, fz);
  };
  if (!keep && !coop && !barn) for (let f = 0; f < floors; f++) floorWindows(f);
  if (keep) {
    // arrow slits
    for (let i = 0; i < n * 2; i++) { const c = ((i + 0.5) * n) / (n * 2); if (Math.abs(c - um) < 0.5) continue; on("sw", c - 0.03, c + 0.03, z0 + Math.round(wh * 0.5), z0 + Math.round(wh * 0.5) + 7, "ink", 0); }
    on("se", n / 2 - 0.03, n / 2 + 0.03, z0 + Math.round(wh * 0.5), z0 + Math.round(wh * 0.5) + 7, "ink", 0);
  }
  if (coop) win("se", n / 2, z0 + Math.round(wh * 0.3), 0.14);
  if (barn) {
    // hay-loft hatch under the gable of the SE wall
    on("se", n / 2 - 0.16, n / 2 + 0.16, z0 + wh - 10, z0 + wh - 3, trim, -1);
    on("se", n / 2 - 0.12, n / 2 + 0.12, z0 + wh - 9, z0 + wh - 4, "ink", 0);
  }
  if (style === "farmhouse" && bool(p, "flower_box") && n >= 1 && !tower) {
    for (let i = 0; i < Math.max(1, n * 2 - 1); i++) {
      const c = ((i + 0.5) * n) / Math.max(1, n * 2 - 1);
      if (Math.abs(c - um) < dwc / 2 + 0.22 || (n === 1)) continue;
      const zb = z0 + Math.round(wh * 0.42) - 4;
      on("sw", c - 0.22, c + 0.22, zb, zb + 2, "wood", 0);
      for (const dc of [-0.14, 0, 0.14]) { const [fx, fy] = pt("sw", c + dc, zb + 3); P.px(Math.round(fx), Math.round(fy), "cloth2", 3); }
    }
  }
  if (stilt) {
    // access: a ladder or a flight of stairs on the SE wall, up to the deck
    const vTop = n * 0.78;
    if (str(p, "access") === "ladder") {
      for (const dv of [0, 0.22]) { const [a, b] = S(n + 0.04, vTop - dv, 0), [c, d] = S(n + 0.04, vTop - dv, lift + 3); P.line(a, b, c, d, "wood", 1); }
      for (let z = 2; z < lift + 2; z += 3) { const [a, b] = S(n + 0.04, vTop, z), [c, d] = S(n + 0.04, vTop - 0.22, z); P.line(a, b, c, d, "wood", 2); }
    } else {
      const A = S(n + 0.34, n * 0.98, 0), B = S(n + 0.34, n * 0.3, lift + 1);
      P.poly([A, B, [B[0], B[1] + 3], [A[0], A[1] + 3]], "wood", TOP, { tone: -1 });
      const steps = Math.max(3, lift >> 1);
      for (let i = 0; i <= steps; i++) { const t = i / steps; P.rect(Math.round(A[0] + (B[0] - A[0]) * t), Math.round(A[1] + (B[1] - A[1]) * t), 2, 1, "wood", 3); }
      P.line(A[0], A[1] - 4, B[0], B[1] - 4, "wood", 2);
    }
    // railed deck lip along the front
    on("sw", 0, n, z0 - 3, z0 - 1, trim, 1);
  }

  // ---- roofs
  const eaveZ = z0 + wh - 2;
  const topZ = z0 + wh;
  const pitchOf = (run: number) => Math.atan2(rh, run);
  const gableRun = (n / 2) * (T / 2) * 1.2;
  if (roofStyle === "gable" || corr) {
    quad([S(n, 0, topZ), S(n, n, topZ), S(n, n / 2, topZ + rh)], wall, WALL_SE, -1); // gable end
    const pitch = pitchOf(gableRun);
    const rn = N(0, Math.cos(pitch), Math.sin(pitch));
    const eave: Pt[] = [S(-ovc, n + ovc, eaveZ), S(n + ovc, n + ovc, eaveZ)];
    const ridge: Pt[] = [S(-ovc, n / 2, topZ + rh), S(n + ovc, n / 2, topZ + rh)];
    quad([eave[0], eave[1], ridge[1], ridge[0]], roof, rn);
    if (corr) {
      const steps = Math.round((n * T) / 3);
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const ax = eave[0][0] + (eave[1][0] - eave[0][0]) * t, ay = eave[0][1] + (eave[1][1] - eave[0][1]) * t;
        const bx = ridge[0][0] + (ridge[1][0] - ridge[0][0]) * t, by = ridge[0][1] + (ridge[1][1] - ridge[0][1]) * t;
        P.line(ax, ay, bx, by, roof, i % 2 ? 3 : 1);
      }
    } else shingles(P, eave, ridge, roof, rn);
    quad([eave[0], eave[1], [eave[1][0], eave[1][1] + 2], [eave[0][0], eave[0][1] + 2]], roof, WALL_SW, -1);
    P.line(ridge[0][0], ridge[0][1], ridge[1][0], ridge[1][1], roof, 4);
    P.line(eave[1][0], eave[1][1], ridge[1][0], ridge[1][1], trim, 2); // rake board
  } else if (roofStyle === "hip") {
    const a = Math.min(0.3, n * 0.3), b = n - a;
    const pitch = pitchOf(gableRun);
    const rnS = N(0, Math.cos(pitch), Math.sin(pitch)), rnE = N(Math.cos(pitch), 0, Math.sin(pitch));
    const eL = S(-ovc, n + ovc, eaveZ), eB = S(n + ovc, n + ovc, eaveZ), eR = S(n + ovc, -ovc, eaveZ);
    const rL = S(a, n / 2, topZ + rh), rR = S(b, n / 2, topZ + rh);
    quad([eL, eB, rR, rL], roof, rnS);
    quad([eB, eR, rR], roof, rnE);
    shingles(P, [eL, eB], [rL, rR], roof, rnS);
    quad([eL, eB, [eB[0], eB[1] + 2], [eL[0], eL[1] + 2]], roof, WALL_SW, -1);
    quad([eB, eR, [eR[0], eR[1] + 2], [eB[0], eB[1] + 2]], roof, WALL_SE, -1);
    P.line(rL[0], rL[1], rR[0], rR[1], roof, 4);
    P.line(eB[0], eB[1], rR[0], rR[1], roof, 1); // hip rafter (the valley between the two slopes)
  } else if (roofStyle === "flat") {
    const par = keep ? 4 : 3;
    // inner roof surface, then the parapet / battlements in front of it
    quad([S(0, 0, topZ), S(n, 0, topZ), S(n, n, topZ), S(0, n, topZ)], roof, TOP, -1);
    const rim = (face: "sw" | "se") => {
      if (keep) {
        const cnt = n * 3;
        for (let i = 0; i < cnt; i++) if (i % 2 === 0) on(face, (i * n) / cnt, ((i + 1) * n) / cnt, topZ, topZ + par + 1, wall, 0);
        on(face, 0, n, topZ, topZ + 1, wall, -1);
      } else on(face, 0, n, topZ, topZ + par, wall, 1);
    };
    // back parapet pieces peek over the top edge
    quad([S(0, 0, topZ), S(n, 0, topZ), S(n, 0, topZ + par), S(0, 0, topZ + par)], wall, WALL_SW, -1);
    quad([S(0, 0, topZ), S(0, n, topZ), S(0, n, topZ + par), S(0, 0, topZ + par)], wall, WALL_SE, -1);
    rim("sw"); rim("se");
    // roof hatch / skylight
    const [hx, hy] = S(n * 0.5, n * 0.4, topZ);
    P.box(Math.round(hx) - 2, Math.round(hy) - 2, 4, 2, trim, WALL_SW);
    P.box(Math.round(hx) + 2, Math.round(hy) - 2, 2, 2, trim, WALL_SE);
  } else if (roofStyle === "dome") {
    // drum cap, then the dome (painted over the wall's top edge, the front walls are redrawn on top)
    const c = S(n / 2, n / 2, topZ);
    const rx = (n * T) / 2 + ov - 1;
    quad([S(0, 0, topZ), S(n, 0, topZ), S(n, n, topZ), S(0, n, topZ)], trim, TOP, 0);
    const dr = rx * 0.86, hh = rh * 0.7; // dome radius and height above the cap
    for (let y = Math.floor(c[1] - hh - 1); y <= Math.ceil(c[1] + dr * 0.5 + 1); y++)
      for (let x = Math.floor(c[0] - dr - 1); x <= Math.ceil(c[0] + dr + 1); x++) {
        const dx = (x + 0.5 - c[0]) / dr, dy = y + 0.5 - c[1];
        if (dy < 0) {
          const ey = dy / hh, d2 = dx * dx + ey * ey;
          if (d2 <= 1) P.box(x, y, 1, 1, roof, [dx, ey, Math.sqrt(1 - d2)]);
        } else {
          const ey = dy / (dr * 0.5), d2 = dx * dx + ey * ey;
          if (d2 <= 1) P.box(x, y, 1, 1, roof, [dx * 0.9, 0.3 * ey, 0.9]);
        }
      }
    for (let x = Math.ceil(c[0] - dr * 0.7); x < c[0] + dr * 0.7; x += 4) P.px(x, Math.round(c[1] - hh * 0.6 * Math.sqrt(Math.max(0, 1 - ((x - c[0]) / dr) ** 2)) - 1), roof, 1);
    P.px(Math.round(c[0]), Math.round(c[1] - hh - 1), "gold", 4);
    P.px(Math.round(c[0]), Math.round(c[1] - hh - 2), "gold", 3);
  } else {
    // spire: a four-sided pyramid; only the two front faces are visible
    const apex = S(n / 2, n / 2, topZ + rh);
    const run = (n * T) / 2;
    const pitch = Math.atan2(rh, run * 0.7);
    const fl = S(-ovc, n + ovc, topZ - 1), fb = S(n + ovc, n + ovc, topZ - 1), fr = S(n + ovc, -ovc, topZ - 1);
    quad([fl, fb, apex], roof, N(0, Math.cos(pitch), Math.sin(pitch)));
    quad([fb, fr, apex], roof, N(Math.cos(pitch), 0, Math.sin(pitch)));
    P.line(fb[0], fb[1], apex[0], apex[1], roof, 1);
    quad([fl, fb, [fb[0], fb[1] + 2], [fl[0], fl[1] + 2]], roof, WALL_SW, -1);
    quad([fb, fr, [fr[0], fr[1] + 2], [fb[0], fb[1] + 2]], roof, WALL_SE, -1);
    P.px(Math.round(apex[0]), Math.round(apex[1]) - 1, "gold", 4);
    P.px(Math.round(apex[0]), Math.round(apex[1]) - 2, "gold", 3);
    P.px(Math.round(apex[0]), Math.round(apex[1]) - 3, "gold", 2);
  }

  if (shop) {
    // striped awning over the door and a hanging sign on the SE wall
    const a0 = um - 0.44, a1 = um + 0.44, az = z0 + dz - 8;
    const nStripe = 6;
    for (let i = 0; i < nStripe; i++) {
      const u0 = a0 + ((a1 - a0) * i) / nStripe, u1 = a0 + ((a1 - a0) * (i + 1)) / nStripe;
      const out = 0.18;
      P.poly([S(u0, n, az + 8), S(u1, n, az + 8), S(u1, n + out, az + 2), S(u0, n + out, az + 2)], i % 2 ? "cloth2" : "ui", [0, -0.6, 0.8]);
    }
    on("se", n * 0.52, n * 0.82, z0 + Math.round(wh * 0.6), z0 + Math.round(wh * 0.6) + 6, "wood", 0);
    on("se", n * 0.55, n * 0.79, z0 + Math.round(wh * 0.6) + 2, z0 + Math.round(wh * 0.6) + 4, "gold", 1);
  }
  // ---- chimney (on pitched roofs; zinc stovepipe on corrugated)
  if (bool(p, "chimney") && !tower && !keep && (roofStyle === "gable" || roofStyle === "hip" || corr)) {
    const [cx, cy] = S(n * 0.3, n * 0.58, z0 + wh + Math.round(rh * 0.62));
    if (corr) {
      P.cylinder(Math.round(cx) - 1, Math.round(cy) - 8, 3, 9, "metal", { flat: 0.3 });
      P.box(Math.round(cx) - 2, Math.round(cy) - 9, 5, 1, "metal", TOP, { tone: -1 });
    } else {
      P.box(Math.round(cx) - 2, Math.round(cy) - 7, 5, 8, "stone", WALL_SW);
      P.box(Math.round(cx) + 1, Math.round(cy) - 7, 2, 8, "stone", WALL_SE);
      P.box(Math.round(cx) - 3, Math.round(cy) - 8, 7, 2, "stone", TOP, { tone: 1 });
    }
  }
  void r;
  P.erase(0, Hc - bottomMargin, W, bottomMargin); // nothing may reach the outline row or the margin below the footprint
  const sprite = cropTop(P.toSprite(), 2);
  return finalize(sprite, kit);
}

function shingles(P: Painter, eave: Pt[], ridge: Pt[], roof: Material, rn: Vec3) {
  for (let i = 1; i < 4; i++) {
    const t = i / 4;
    const x0 = eave[0][0] + (ridge[0][0] - eave[0][0]) * t, y0 = eave[0][1] + (ridge[0][1] - eave[0][1]) * t;
    const x1 = eave[1][0] + (ridge[1][0] - eave[1][0]) * t, y1 = eave[1][1] + (ridge[1][1] - eave[1][1]) * t;
    const steps = Math.round(Math.abs(x1 - x0));
    for (let s = 0; s < steps; s += 2 + (i % 2)) { const f = s / steps; P.box(Math.round(x0 + (x1 - x0) * f), Math.round(y0 + (y1 - y0) * f), 1, 1, roof, rn, { tone: -1 }); }
  }
}

export { ISO_PROP_MARGIN };

/** The `building` generator's result under an iso kit (one frame; meta names the footprint for map placement). */
export function isoBuildingResult(p: Params, kit: StyleKit, seed: number): GenResult {
  const n = isoFootprint(str(p, "style"), str(p, "size"));
  return { rows: [{ name: "idle", frames: [isoBuildingStyled(kit, p, seed)] }], fps: 1, meta: { camera: "iso", footprint: n } };
}

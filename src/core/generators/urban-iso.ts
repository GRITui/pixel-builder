// Urban night set (#99), part 2: street ground tiles, buildings (konbini, izakaya, apartment, house) and the
// `iso-street` map that lays out a crossroads with the whole set. Kit: `kit-iso` (any iso tile width scales with T/32).
//
// Buildings use the iso-building anchor contract (bottom vertex of the footprint = bottom of the sprite minus the
// outline/margin rows). Lit glass, signs and lanterns are drawn with explicit ramp levels so they stay bright; the
// emitters are returned in `lights` (sprite px) and stored on the map's tiles for the lighting lane.
import { finalize } from "../enforce";
import { proportions } from "../kit";
import { Painter } from "../painter";
import { colorIndex, type Material } from "../palette";
import { rng, type Rng } from "../rng";
import { blit, createSprite } from "../sprite";
import { emptyTileMap, ensureTile } from "../tilemap";
import type { Sprite, StyleKit, TileMap } from "../types";
import type { LitObject } from "../lighting";
import { diamondRows, isoCell, isoTileW, ISO_PROP_MARGIN, TOP, WALL_SE, WALL_SW, type Vec3 } from "./iso";
import { isoPropOrigin, renderIsoMap } from "./isomap";
import { chochin, drawWire, IsoDraw, light, neonSignAt, urbanProp, type UrbanLight, type UrbanResult } from "./urban";
import { num, str, type Generator, type Params } from "./types";

type V3 = [number, number, number];

// -------------------------------------------------------------------------- ground tiles

export const URBAN_TILE_KINDS = ["asphalt", "line", "crosswalk", "sidewalk", "lot", "manhole"] as const;
export type UrbanTileKind = (typeof URBAN_TILE_KINDS)[number];
export interface UrbanTileOpts { side?: "none" | "ne" | "nw" | "se" | "sw"; axis?: "se" | "sw"; kerb?: number; tenji?: boolean }
export const KERB = { ne: 1, nw: 2, se: 4, sw: 8 } as const;

const hash2 = (x: number, y: number, s: number): number => {
  let h = Math.imul(x + 0x9e37, 0x85ebca6b) ^ Math.imul(y + 0x7f4a, 0xc2b2ae35) ^ Math.imul(s + 1, 0x27d4eb2f);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
};
export const kerbRaise = (kit: StyleKit) => Math.max(1, Math.round((isoTileW(kit) / 32) * 2));

/** One street tile. Roads are T x T/2; sidewalks and lots are raised by `kerbRaise` (walls hang under the SE/SW edges). Never outlined. */
export function urbanTile(kit: StyleKit, kind: UrbanTileKind, seed: number, variant: number, o: UrbanTileOpts = {}): Sprite {
  const T = isoTileW(kit), TH = T / 2, k = T / 32, raised = kind === "sidewalk" || kind === "lot";
  const H = raised ? kerbRaise(kit) : 0;
  const P = new Painter(T, TH + H, kit);
  const rows = diamondRows(T);
  const sd = seed * 977 + variant * 131 + URBAN_TILE_KINDS.indexOf(kind) * 7919;
  const road = kind === "asphalt" || kind === "line" || kind === "crosswalk" || kind === "manhole";
  const base: Material = "stone", baseTone = road ? -3 : kind === "lot" ? -1 : 0;
  const kerb = o.kerb ?? 0;
  const dash = o.side && o.side !== "none" ? o.side : null;
  const cell = 8 * k; // half a cell side in world px
  rows.forEach(([x0, x1], y) => {
    for (let x = x0; x < x1; x++) {
      const dx = (x + 0.5 - T / 2) / k, dy = (y + 0.5 - TH / 2) / k;
      const u = (dx + 2 * dy) / 2, v = (2 * dy - dx) / 2; // world px from the cell centre (each within +-8)
      const nu = u + 8, nv = v + 8; // 0..16 from the NW corner along both axes
      let tone = baseTone, m: Material = base, fixed = -1;
      const n = hash2(x, y, sd);
      if (road) {
        if (n < 0.04) tone -= 1; else if (n > 0.95) tone += 1;
        if (kind === "crosswalk") {
          const t = (o.axis === "sw" ? nu : nv) % 8; // stripes run along the traffic axis, repeat across it
          if (t >= 1.5 && t < 6.5) { m = "ui"; fixed = n < 0.12 ? 3 : 4; }
        } else if (kind === "line" && dash) {
          const along = dash === "ne" || dash === "sw" ? nu : nv, across = dash === "ne" ? nv : dash === "sw" ? 16 - nv : dash === "nw" ? nu : 16 - nu;
          if (across < 1.6 && along % 16 < 9) { m = "ui"; fixed = 4; }
        }
        // gutter shade along the kerb is handled by the sidewalk wall; tyre-wear stripes keep the asphalt from looking flat
      } else {
        // slabs: 4 squares per cell, seams on the cell edges and through the centre
        const seam = kind === "sidewalk" ? nu % 8 < 1 || nv % 8 < 1 : nu % 16 < 1 || nv % 16 < 1;
        const slab = Math.floor(nu / 8) + Math.floor(nv / 8) * 2;
        const sv = kind === "lot" ? 0.5 : hash2(slab, (variant + 3) * 5, seed + 17);
        if (seam) tone -= 1; else { if (sv < 0.14) tone -= 1; else if (sv > 0.9) tone += 1; if (n < 0.03) tone -= 1; else if (n > 0.97) tone += 1; }
        // kerb lip (lit edge) and tactile paving (yellow tenji strip with bumps) along road-facing edges
        const dist = (bit: number, d: number) => ((kerb & bit) ? d : 99);
        const dEdge = Math.min(dist(KERB.ne, 16 - nv), dist(KERB.nw, nu), dist(KERB.se, 16 - nu), dist(KERB.sw, nv));
        if (dEdge < 1.4) tone = 2;
        else if (o.tenji && dEdge < 5.2) {
          m = "gold"; tone = 0;
          fixed = (Math.floor(nu / 2) + Math.floor(nv / 2)) % 2 === 0 ? 4 : 2;
          if (dEdge < 2) fixed = 2;
        }
      }
      if (fixed >= 0) P.px(x, y, m, fixed); else P.box(x, y, 1, 1, m, TOP, { tone });
    }
  });
  void cell;
  if (kind === "manhole") {
    P.ellipse(T / 2, TH / 2, 5 * k, 2.6 * k, "metal", { tone: -2 });
    P.ellipse(T / 2, TH / 2, 3.6 * k, 1.8 * k, "metal", { tone: -1 });
    for (let i = -2; i <= 2; i++) P.px(Math.floor(T / 2 + i * 1.5 * k), Math.floor(TH / 2), "metal", 1);
    P.px(Math.floor(T / 2 - 4 * k), Math.floor(TH / 2 - 1), "metal", 3);
  }
  if (H > 0) {
    const inside = (x: number, y: number) => y >= 0 && y < TH && x >= rows[y][0] && x < rows[y][1];
    for (let x = 0; x < T; x++) {
      let yb = -1;
      for (let y = 0; y < TH; y++) if (inside(x, y)) yb = y;
      if (yb < 0) continue;
      const nrm = x < T / 2 ? WALL_SW : WALL_SE;
      for (let j = 1; j <= H; j++) P.box(x, yb + j, 1, 1, "stone", nrm, { tone: j === H ? -1 : 0 });
    }
  }
  return finalize(P.toSprite(), kit, { outline: false });
}

// -------------------------------------------------------------------------- buildings

export const URBAN_BUILDING_STYLES = ["konbini", "izakaya", "apartment", "house"] as const;
export type UrbanBuildingStyle = (typeof URBAN_BUILDING_STYLES)[number];
export interface UrbanBuildingOpts { style: UrbanBuildingStyle; size: number; floors: number; front: "sw" | "se" | "both"; wall: Material; neon: "none" | "pink" | "cyan"; lit: boolean; variant: number }

const GOODS: Material[] = ["cloth2", "cloth", "foliage", "accent", "gold", "leather", "ui", "blossom"];
type Face = "sw" | "se";

export function urbanBuilding(kit: StyleKit, p: Partial<UrbanBuildingOpts> | Params, seed: number): UrbanResult & { footprint: number } {
  const q = p as Record<string, unknown>;
  const style = ((URBAN_BUILDING_STYLES as readonly string[]).includes(String(q.style)) ? q.style : "konbini") as UrbanBuildingStyle;
  const n = Math.max(1, Math.min(3, Math.round(Number(q.size ?? 2))));
  const floors = Math.max(1, Math.min(6, Math.round(Number(q.floors ?? (style === "apartment" ? 4 : style === "konbini" ? 1 : 2)))));
  const front = (q.front === "se" || q.front === "both" ? q.front : "sw") as "sw" | "se" | "both";
  const wall = (q.wall ?? (style === "izakaya" ? "wood" : style === "house" ? "sand" : "stone")) as Material;
  const neon = (q.neon === "pink" || q.neon === "cyan" ? q.neon : "none") as "none" | "pink" | "cyan";
  const lit = q.lit === undefined ? true : Boolean(q.lit);
  const variant = Math.round(Number(q.variant ?? 0));
  const r = rng(seed * 59 + variant * 7 + 3);
  const T = isoTileW(kit), k = T / 32, TH = T / 2, L = 16 * n; // L: footprint side in world px (k = 1)
  const pr = proportions(kit);
  void pr;
  const fh = style === "apartment" ? 30 : 28;                      // upper floor height
  const gh = style === "konbini" ? 42 : style === "izakaya" ? 32 : style === "apartment" ? 32 : 32; // ground floor top
  const H = gh + (floors - 1) * fh;
  const roofRise = style === "izakaya" || style === "house" ? 11 + 3 * n : 0;
  const zTop = H + roofRise + (style === "konbini" ? 14 : 12) + (neon !== "none" ? 4 : 0);
  const W = Math.round(n * T + 26 * k) + (Math.round(n * T + 26 * k) % 2);
  const oy = Math.ceil(zTop * k) + 4, Hc = oy + Math.round(n * TH) + 2;
  const P = new Painter(W, Hc, kit), D = new IsoDraw(P, W / 2, oy, k);
  const L_: UrbanLight[] = [];
  const pushLight = (pt: [number, number], rr: number, kind: UrbanLight["kind"], m: Material) => L_.push(light(kit, pt[0], pt[1], Math.round(rr * k), kind, m));

  // ---- face helpers: a runs left to right on screen, d is the offset out of the wall
  const A = (f: Face, a: number, z: number, d = 0): V3 => (f === "sw" ? [a, L + d, z] : [L + d, L - a, z]);
  const shade = (f: Face, lvl: number) => (f === "se" ? Math.max(0, lvl - 1) : lvl);
  const lit_ = (f: Face, a0: number, a1: number, z0: number, z1: number, m: Material, tone = 0, d = 0) =>
    f === "sw" ? D.sw(a0, a1, L + d, z0, z1, m, tone) : D.se(L + d, L - a1, L - a0, z0, z1, m, tone);
  const fix = (f: Face, a0: number, a1: number, z0: number, z1: number, m: Material, lvl: number, d = 0, emit = false) => {
    const l = emit ? lvl : shade(f, lvl);
    if (f === "sw") D.fsw(a0, a1, L + d, z0, z1, m, l); else D.fse(L + d, L - a1, L - a0, z0, z1, m, l);
  };
  const dot = (f: Face, a: number, z: number, m: Material, lvl: number, d = 0, emit = false) => { const [u, v, zz] = A(f, a, z, d); D.px(u, v, zz, m, emit ? lvl : shade(f, lvl)); };
  const bx = (f: Face, a0: number, a1: number, d: number, z0: number, z1: number, m: Material, o: { tone?: number; sw?: number; se?: number; top?: number } = {}) =>
    f === "sw" ? D.box(a0, a1, L, L + d, z0, z1, m, o) : D.box(L, L + d, L - a1, L - a0, z0, z1, m, o);
  const scr = (f: Face, a: number, z: number, d = 0): [number, number] => D.at(...A(f, a, z, d));

  const window_ = (f: Face, a: number, z: number, w: number, h: number, state: "warm" | "tv" | "dim" | "dark", sill = true, trim: Material = "metal") => {
    lit_(f, a - w / 2 - 1, a + w / 2 + 1, z - 1, z + h + 1, trim, -1);
    if (state === "dark") { fix(f, a - w / 2, a + w / 2, z, z + h, "cloth", 1); fix(f, a - w / 2, a - w / 2 + 2, z + h - 3, z + h, "cloth", 2); }
    else if (state === "tv") { fix(f, a - w / 2, a + w / 2, z, z + h, "cloth", 3, 0, true); fix(f, a - w / 2, a + w / 2, z + h * 0.55, z + h, "cloth", 4, 0, true); }
    else {
      const base = state === "warm" ? 3 : 2;
      fix(f, a - w / 2, a + w / 2, z, z + h, "gold", base, 0, true);
      fix(f, a - w / 2, a + w / 2, z + h * 0.6, z + h, "gold", base + 1, 0, true);
      if (state === "warm") for (let i = 0; i < w - 2; i += 3) fix(f, a - w / 2 + i + 0.5, a - w / 2 + i + 1.5, z + 1, z + h * 0.55, "leather", 4, 0, true); // curtain folds
    }
    fix(f, a - 0.4, a + 0.6, z, z + h, trim, 2); // mullion
    if (sill) lit_(f, a - w / 2 - 1.5, a + w / 2 + 1.5, z - 2, z - 1, "stone", 1);
    if (state === "warm" || (state === "tv" && (a | 0) % 2 === 0)) { const c = scr(f, a, z + h / 2); pushLight(c, state === "tv" ? 8 : 9, "window", state === "tv" ? "cloth" : "gold"); }
  };
  const pickState = (): "warm" | "tv" | "dim" | "dark" => { const x = r.next(); return !lit ? "dark" : x < 0.5 ? "warm" : x < 0.62 ? "tv" : x < 0.72 ? "dim" : "dark"; };
  const acUnit = (f: Face, a: number, z: number, w = 9) => {
    bx(f, a, a + w, 4, z, z + 7, "metal", { tone: 1 });
    fix(f, a + 1.2, a + w - 1.2, z + 1, z + 6, "ink", 2, 4);
    for (let i = 0; i < 3; i++) fix(f, a + 1.2, a + w - 1.2, z + 1.5 + i * 1.7, z + 2.2 + i * 1.7, "metal", 3, 4);
    fix(f, a + 1, a + 2, z - 2, z, "metal", 1, 1); fix(f, a + w - 2, a + w - 1, z - 2, z, "metal", 1, 1);
  };
  /** A balcony: slab, railing posts and a few hanging pieces of laundry. */
  const balcony = (f: Face, a0: number, a1: number, z: number, withAc: boolean) => {
    bx(f, a0, a1, 5, z, z + 2.5, "stone", { tone: 0 });
    for (let a = a0 + 0.5; a < a1; a += 2.5) fix(f, a, a + 0.9, z + 2.5, z + 11, "metal", 2, 5);
    fix(f, a0, a1, z + 10.4, z + 11.6, "metal", 3, 5);
    if (r.chance(0.55)) { const a = a0 + 2 + r.int(0, Math.max(0, Math.floor(a1 - a0 - 7))), m = GOODS[r.int(0, 3)]; fix(f, a, a + 4, z + 4, z + 10.4, m, 3, 4.5); fix(f, a, a + 4, z + 9.2, z + 10.4, m, 4, 4.5); }
    if (withAc) acUnit(f, a1 - 10, z + 2.5, 8);
  };

  // ---- walls: both faces, with floor lines and a stone plinth
  for (const f of ["sw", "se"] as Face[]) {
    lit_(f, 0, L, 0, H, wall, 0);
    lit_(f, 0, L, 0, 2, "stone", -1);
    if (style === "izakaya") { for (let z = 6; z < gh - 2; z += 4) lit_(f, 0, L, z, z + 1, wall, -1); }
    if (style === "apartment" || style === "house") for (let i = 1; i < floors; i++) lit_(f, 0, L, gh + (i - 1) * fh - 1.5, gh + (i - 1) * fh + 0.5, wall, -1);
  }

  const storeShelves = (f: Face, a0: number, a1: number, z0: number, z1: number) => {
    fix(f, a0, a1, z0, z1, "sand", 4, 0, true);
    fix(f, a0, a1, z0, z0 + 1.5, "sand", 3, 0, true);
    fix(f, a0, a1, z1 - 1.5, z1, "ui", 4, 0, true); // ceiling light strip
    for (let zi = z0 + 5; zi < z1 - 5; zi += 7) {
      for (let a = a0 + 1; a < a1 - 2; a += 2 + r.int(0, 2)) { if (r.chance(0.18)) continue; const m = GOODS[r.int(0, GOODS.length - 1)]; fix(f, a, a + 1.6, zi + 1, zi + 4.6, m, 3, 0, true); dot(f, a, zi + 4, m, 4, 0, true); }
      fix(f, a0, a1, zi, zi + 1, "metal", 2, 0, true);
    }
  };

  const faces: Face[] = front === "both" ? ["sw", "se"] : [front];
  const other: Face = front === "sw" ? "se" : "sw";

  if (style === "konbini") {
    for (const f of faces) {
      const door = f === (front === "se" ? "se" : "sw");
      lit_(f, 1, L - 1, 2, 31, "ink", 0, 0);
      storeShelves(f, 2, L - 2, 3, 30);
      for (const a of [1.5, L / 3 + 1, L - 1.5]) fix(f, a - 0.5, a + 0.5, 2, 31, "metal", 3, 0.2);
      if (door) { fix(f, L - 15, L - 5, 3, 29, "sand", 4, 0.3, true); fix(f, L - 15, L - 14.2, 3, 29, "metal", 3, 0.4); fix(f, L - 5.8, L - 5, 3, 29, "metal", 3, 0.4); fix(f, L - 10.4, L - 9.6, 3, 29, "metal", 2, 0.4); fix(f, L - 10, L - 9, 12, 17, "metal", 3, 0.5); fix(f, L - 11.2, L - 10.6, 12, 17, "metal", 3, 0.5); fix(f, L - 15, L - 5, 28, 29, "metal", 3, 0.4); }
      // fascia: a sign box standing proud with green / white / blue stripes and a logo
      bx(f, -1, L + 1, 2, 31, 42, "ui", { tone: 0 });
      fix(f, -1, L + 1, 30, 31, "ink", 1, 1);
      fix(f, -1, L + 1, 39.5, 42, "foliage", 3, 2); fix(f, -1, L + 1, 38.5, 39.5, "ui", 4, 2);
      fix(f, -1, L + 1, 36, 38.5, "cloth", 3, 2); fix(f, -1, L + 1, 31, 36, "ui", 4, 2);
      for (let a = 3, i = 0; a < L - 4; a += 3 + (i++ % 2)) { fix(f, a, a + 2, 32.2, 34.8, "cloth", 2, 2); if (i % 3 === 1) fix(f, a, a + 2, 32.2, 33.2, "foliage", 3, 2); }
      pushLight(scr(f, L / 2, 36, 2), 18, "sign", "sand");
    }
    if (front !== "both") {
      // side wall: ductwork, AC units and a lit window
      window_(other, L * 0.3, 10, 8, 12, pickState());
      acUnit(other, L * 0.55, 18, 9); acUnit(other, L * 0.55, 8, 9);
      fix(other, L - 5, L - 4, 3, H, "metal", 2, 1.2);
      fix(other, 3, L * 0.5 - 3, H - 8, H - 3, "stone", 1, 0.5);
    }
    if (floors > 1) {
      for (const f of faces.concat(front === "both" ? [] : [other])) for (let i = 1; i < floors; i++) {
        const z = gh + (i - 1) * fh + 7;
        for (let j = 0; j < n * 2 - 1 + (n === 1 ? 1 : 0); j++) window_(f, ((j + 0.5) * L) / Math.max(1, n * 2 - 1 + (n === 1 ? 1 : 0)), z, 8, 13, pickState());
      }
    }
  } else if (style === "izakaya") {
    for (const f of faces.concat(front === "both" ? [] : [other])) {
      const isFront = f !== other || front === "both";
      lit_(f, 0, L, 2, gh - 1, "wood", -1);
      for (let a = 4; a < L; a += 4) fix(f, a, a + 0.8, 3, gh - 2, "wood", 1, 0.2);
      if (isFront) {
        // koushi window (lattice over warm light) and a sliding door with a noren
        const w0 = 3, w1 = L * 0.45;
        fix(f, w0, w1, 8, gh - 8, "ink", 1, 0.1);
        fix(f, w0 + 0.8, w1 - 0.8, 8.8, gh - 8.8, "gold", 3, 0.2, true); fix(f, w0 + 0.8, w1 - 0.8, gh - 15, gh - 8.8, "gold", 4, 0.2, true);
        for (let a = w0 + 0.8; a < w1; a += 2.5) fix(f, a, a + 0.8, 8, gh - 8, "wood", 2, 0.4);
        for (let z = 11; z < gh - 8; z += 3.6) fix(f, w0, w1, z, z + 0.8, "wood", 2, 0.4);
        pushLight(scr(f, (w0 + w1) / 2, 17, 0.2), 14, "window", "gold");
        const d0 = L * 0.58, d1 = L - 4;
        fix(f, d0, d1, 2, gh - 4, "wood", 0, 0.1);
        fix(f, d0 + 1, d1 - 1, 4, gh - 6, "gold", 3, 0.3, true);
        for (let a = d0 + 1; a < d1 - 1; a += 3) fix(f, a, a + 0.7, 4, gh - 6, "wood", 2, 0.5);
        for (let z = 6; z < gh - 6; z += 4) fix(f, d0 + 1, d1 - 1, z, z + 0.7, "wood", 2, 0.5);
        pushLight(scr(f, (d0 + d1) / 2, 14, 0.3), 12, "window", "gold");
        // noren: three cloth strips with a gap, dark blue with a pale mark
        for (const [na, nb] of [[d0 - 0.5, d0 + (d1 - d0) / 3], [d0 + (d1 - d0) / 3 + 1, d0 + (2 * (d1 - d0)) / 3], [d0 + (2 * (d1 - d0)) / 3 + 1, d1 + 0.5]] as [number, number][]) {
          fix(f, na, nb, 16, 27, "cloth", 2, 1.2); fix(f, na, nb, 16, 17, "cloth", 1, 1.2);
          fix(f, (na + nb) / 2 - 0.5, (na + nb) / 2 + 0.8, 20, 24, "ui", 4, 1.3, true); fix(f, (na + nb) / 2 - 1.5, (na + nb) / 2 + 1.8, 22, 23, "ui", 4, 1.3, true);
        }
        fix(f, d0 - 1, d1 + 1, 26.5, 28, "wood", 0, 1.2);
      }
      // tiled pent roof over the ground floor
      const [pa, pb] = [-2, L + 2];
      const q: V3[] = f === "sw" ? [[pa, L + 7, gh - 3], [pb, L + 7, gh - 3], [pb, L - 1, gh + 3], [pa, L - 1, gh + 3]] : [[L + 7, L - pb, gh - 3], [L + 7, L - pa, gh - 3], [L - 1, L - pa, gh + 3], [L - 1, L - pb, gh + 3]];
      D.poly(q, "metal", f === "sw" ? [0, -0.45, 0.85] : [0.45, 0, 0.85], -1);
      for (let a = pa + 2; a < pb; a += 3) { const l0 = A(f, a, gh - 3, 7), l1 = A(f, a, gh + 3, -1); D.line(l0, l1, "metal", f === "sw" ? 1 : 0); }
      D.line(A(f, pa, gh - 3, 7), A(f, pb, gh - 3, 7), "ink", 1);
      // chochin lanterns hang from the eave
      if (isFront) for (let a = 5; a < L - 2; a += (L - 8) / 2) { const [x, y] = scr(f, a, gh - 3, 7); const c = chochin(P, x, y + 1, Math.max(0.7, k)); pushLight([c.x, c.y], 13, "lantern", "cloth2"); }
    }
    for (const f of faces.concat(front === "both" ? [] : [other])) if (floors > 1) for (let i = 1; i < floors; i++) {
      const z = gh + (i - 1) * fh + 6;
      const cnt = n * 2 - 1 || 1;
      for (let j = 0; j < cnt; j++) {
        const a = ((j + 0.5) * L) / cnt;
        lit_(f, a - 6, a + 6, z - 2, z + 15, "wood", -1);
        fix(f, a - 5, a + 5, z - 1, z + 14, "ink", 1);
        const st = pickState() === "dark" && lit ? "warm" : pickState();
        fix(f, a - 4.5, a + 4.5, z, z + 13, st === "dark" ? "cloth" : "gold", st === "dark" ? 1 : st === "dim" ? 2 : 3, 0.1, st !== "dark");
        for (let b = a - 4.5; b < a + 4.5; b += 3) { fix(f, b, b + 0.7, z, z + 13, "wood", 2, 0.3); }
        fix(f, a - 4.5, a + 4.5, z + 6, z + 6.8, "wood", 2, 0.3);
        if (st !== "dark") pushLight(scr(f, a, z + 6, 0.1), 10, "window", "gold");
      }
    }
  } else if (style === "apartment") {
    for (const f of faces.concat(front === "both" ? [] : [other])) {
      const isFront = f !== other || front === "both";
      for (let i = 0; i < floors; i++) {
        const z0 = i === 0 ? 0 : gh + (i - 1) * fh;
        if (i === 0) {
          if (isFront) {
            // entrance: glass door with a canopy, mailboxes, a lit hall window
            const d0 = L / 2 - 5, d1 = L / 2 + 5;
            lit_(f, d0 - 1, d1 + 1, 2, 25, "metal", -1);
            fix(f, d0, d1, 3, 24, "gold", 3, 0.2, true); fix(f, d0, d1, 15, 24, "gold", 4, 0.2, true); fix(f, (d0 + d1) / 2 - 0.4, (d0 + d1) / 2 + 0.4, 3, 24, "metal", 2, 0.3);
            bx(f, d0 - 3, d1 + 3, 5, 25, 27, "stone", { tone: 0 });
            pushLight(scr(f, (d0 + d1) / 2, 14, 0.2), 12, "window", "gold");
            for (let b = 0; b < 3; b++) { const a = 3 + b * 3; if (a + 2 < d0 - 1) fix(f, a, a + 2.2, 8, 12, "metal", 3, 0.3); }
            window_(f, L - 6, 10, 7, 12, "warm");
          } else { for (let j = 0; j < n; j++) window_(f, ((j + 0.5) * L) / n, 9, 8, 12, pickState()); }
          continue;
        }
        const cnt = Math.max(2, n * 2 - 1);
        for (let j = 0; j < cnt; j++) {
          const a = ((j + 0.5) * L) / cnt;
          window_(f, a, z0 + 9, 9, 13, pickState(), false);
          if (j % 2 === 0 || n === 1) balcony(f, a - 8, a + 8, z0 + 4, r.chance(0.4));
        }
      }
    }
  } else {
    // house: door with porch light, a window, a balcony upstairs
    for (const f of faces.concat(front === "both" ? [] : [other])) {
      const isFront = f !== other || front === "both";
      if (isFront) {
        const d0 = L * 0.3, d1 = d0 + 9;
        lit_(f, d0 - 1, d1 + 1, 2, 27, "wood", -1); fix(f, d0, d1, 3, 26, "wood", 1, 0.2);
        for (let z = 6; z < 26; z += 5) fix(f, d0, d1, z, z + 0.7, "wood", 3, 0.3);
        dot(f, d1 - 1.5, 14, "gold", 4, 0.4, true);
        const pl = scr(f, d1 + 3, 22, 1);
        P.px(Math.floor(pl[0]), Math.floor(pl[1]), "gold", 4); P.px(Math.floor(pl[0]), Math.floor(pl[1]) + 1, "gold", 3);
        pushLight(pl, 10, "lamp", "gold");
        window_(f, L - 7, 9, 9, 13, "warm");
      } else window_(f, L / 2, 9, 9, 13, pickState());
      for (let i = 1; i < floors; i++) {
        const z = gh + (i - 1) * fh;
        window_(f, isFront ? L * 0.3 + 4 : L * 0.3, z + 7, 9, 13, pickState(), false);
        window_(f, L * 0.72, z + 7, 11, 13, pickState(), false);
        if (isFront) balcony(f, L * 0.55, L - 1, z + 2, true);
      }
    }
  }

  // ---- neon kanji sign on the corner
  if (neon !== "none") {
    const hue: Material = neon === "pink" ? "blossom" : "water";
    const f: Face = front === "se" ? "se" : "sw";
    const aV = f === "sw" ? L - 3.5 : L - 3.5;
    neonSignAt(D, f, aV, L, Math.min(H - 30, gh + 2), 32, hue, seed, 3);
    const c = scr(f, f === "sw" ? aV : L - aV, Math.min(H - 30, gh + 2) + 16, 3);
    pushLight(c, 16, "sign", hue);
  }

  // ---- roof
  if (style === "konbini" || style === "apartment") {
    const par = style === "konbini" ? 3 : 4;
    D.top(0, L, 0, L, H, "stone", -1);
    D.sw(0, L, 0, H, H + par, wall, -1); D.se(0, 0, L, H, H + par, wall, -1);
    // front parapets drawn after the rooftop clutter would hide it, so clutter sits behind them
    for (const [cu, cv] of [[L * 0.28, L * 0.3], [L * 0.62, L * 0.4]] as [number, number][]) { D.box(cu, cu + 7, cv, cv + 5, H, H + 6, "metal", { tone: 1 }); D.fsw(cu + 1, cu + 6, cv + 5, H + 1.2, H + 5, "ink", 2); }
    if (style === "apartment") { D.box(L * 0.55, L * 0.55 + 8, L * 0.55, L * 0.55 + 9, H, H + 11, "stone", { tone: 0 }); D.fsw(L * 0.55 + 2, L * 0.55 + 6, L * 0.55 + 9, H, H + 6, "metal", 2); }
    D.sw(0, L, L, H, H + par, wall, 1); D.se(L, 0, L, H, H + par, wall, 1);
    D.sw(0, L, L, H + par - 1, H + par, "stone", 2); D.se(L, 0, L, H + par - 1, H + par, "stone", 1);
  } else {
    // hip roof, grey kawara with courses
    const ov = 3, z0 = H - 2, rz = H + roofRise;
    const e0: V3 = [-ov, L + ov, z0], e1: V3 = [L + ov, L + ov, z0], e2: V3 = [L + ov, -ov, z0];
    const a = Math.min(8, L * 0.25), r0: V3 = [a, L / 2, rz], r1: V3 = [L - a, L / 2, rz];
    const roofM: Material = style === "house" ? "metal" : "stone";
    D.poly([e0, e1, r1, r0], roofM, [0, -0.5, 0.86], -1);
    D.poly([e1, e2, r1], roofM, [0.5, 0, 0.86], -2);
    for (let i = 1; i < 5; i++) { const t = i / 5; const m0: V3 = [e0[0] + (r0[0] - e0[0]) * t, e0[1] + (r0[1] - e0[1]) * t, e0[2] + (r0[2] - e0[2]) * t], m1: V3 = [e1[0] + (r1[0] - e1[0]) * t, e1[1] + (r1[1] - e1[1]) * t, e1[2] + (r1[2] - e1[2]) * t]; D.line(m0, m1, roofM, 1); }
    D.line(r0, r1, roofM, 4); D.line(e1, r1, roofM, 2);
    D.sw(-ov, L + ov, L + ov, z0 - 2, z0, "ink", 1); D.se(L + ov, -ov, L + ov, z0 - 2, z0, "ink", 0);
  }

  P.erase(0, Hc - 2, W, 2);
  const sprite = finalize(P.toSprite(), kit);
  return { sprite, lights: L_, footprint: n };
}

// -------------------------------------------------------------------------- generators

export const urbanTileGenerator: Generator = {
  id: "urban-tile",
  category: "environment",
  label: "Urban street tile (iso)",
  description: "Isometric street ground tile for the 'kit-iso' camera: asphalt, line (dashed centre line hugging one cell edge: side ne|nw|se|sw), crosswalk (zebra bars along the traffic axis: axis se|sw), sidewalk (square slabs; kerb = bitmask of road-facing edges 1 ne, 2 nw, 4 se, 8 sw; tenji = yellow tactile strip), lot (plain concrete) and manhole. Sidewalks/lots are raised 2px (walls under the SE/SW edges). Never outlined.",
  params: [
    { key: "kind", label: "Tile", type: "select", options: [...URBAN_TILE_KINDS], default: "asphalt" },
    { key: "side", label: "Line side", type: "select", options: ["none", "ne", "nw", "se", "sw"], default: "none" },
    { key: "axis", label: "Crosswalk axis", type: "select", options: ["se", "sw"], default: "se" },
    { key: "kerb", label: "Kerb edges (bitmask 1 ne, 2 nw, 4 se, 8 sw)", type: "number", min: 0, max: 15, step: 1, default: 0 },
    { key: "tenji", label: "Tactile paving strip", type: "bool", default: false },
    { key: "variant", label: "Variant", type: "number", min: 0, max: 3, step: 1, default: 0 },
  ],
  generate(p: Params, kit: StyleKit, seed: number) {
    const s = urbanTile(kit, str(p, "kind") as UrbanTileKind, seed, num(p, "variant"), { side: str(p, "side") as never, axis: str(p, "axis") as never, kerb: num(p, "kerb"), tenji: Boolean(p.tenji) });
    return { rows: [{ name: "idle", frames: [s] }], fps: 1, meta: { camera: "iso" } };
  },
};

export const urbanBuildingGenerator: Generator = {
  id: "urban-building",
  category: "building",
  label: "Urban building (iso)",
  description: "Isometric Japanese street building for the 'kit-iso' camera, anchored like iso-building (bottom vertex of the n x n footprint; place on the footprint's bottom-most cell). Styles: konbini (bright store with shelves behind glass, striped fascia, AC units), izakaya (wood front, noren, koushi window, tiled eave, hanging chochin lanterns), apartment (lit windows, balconies, rooftop kit), house (porch light, balcony, hip roof). `front` picks the face with the entrance (sw lit, se shaded, both = corner store). `neon` adds a vertical kanji sign (pink or cyan). Emitters are reported in meta.lights [{x,y,r,kind,color,material}] in sprite px.",
  params: [
    { key: "style", label: "Style", type: "select", options: [...URBAN_BUILDING_STYLES], default: "konbini" },
    { key: "size", label: "Footprint (cells per side)", type: "number", min: 1, max: 3, step: 1, default: 2 },
    { key: "floors", label: "Floors", type: "number", min: 1, max: 6, step: 1, default: 2 },
    { key: "front", label: "Front face", type: "select", options: ["sw", "se", "both"], default: "sw" },
    { key: "wall", label: "Wall", type: "material", options: ["stone", "sand", "wood", "cloth", "metal", "dirt"], default: "stone" },
    { key: "neon", label: "Neon kanji sign", type: "select", options: ["none", "pink", "cyan"], default: "none" },
    { key: "lit_windows", label: "Lit windows", type: "bool", default: true },
    { key: "variant", label: "Variant", type: "number", min: 0, max: 5, step: 1, default: 0 },
  ],
  generate(p: Params, kit: StyleKit, seed: number) {
    const res = urbanBuilding(kit, { ...p, lit: Boolean(p.lit_windows) }, seed);
    return { rows: [{ name: "idle", frames: [res.sprite] }], fps: 1, meta: { camera: "iso", footprint: res.footprint, lights: res.lights } };
  },
};

// -------------------------------------------------------------------------- street map

export interface StreetPlan {
  cols: number; rows: number;
  /** west-most road column / north-most road row of the 2-wide roads */
  cc: number; rc: number;
  road: boolean[]; sidewalk: boolean[];
}
export function planStreet(cols: number, rows: number): StreetPlan {
  const cc = Math.round(cols * 0.5), rc = Math.round(rows * 0.5);
  const road = new Array(cols * rows).fill(false), sidewalk = new Array(cols * rows).fill(false);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (c === cc || c === cc + 1 || r === rc || r === rc + 1) road[r * cols + c] = true;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    if (road[i]) continue;
    const near = (dc: number, dr: number) => { const x = c + dc, y = r + dr; return x >= 0 && y >= 0 && x < cols && y < rows && road[y * cols + x]; };
    if (near(1, 0) || near(-1, 0) || near(0, 1) || near(0, -1)) sidewalk[i] = true;
    else if ((c === cc - 1 || c === cc + 2) && (r === rc - 1 || r === rc + 2)) sidewalk[i] = true; // corner cells
  }
  return { cols, rows, cc, rc, road, sidewalk };
}

export interface StreetMeta { cc: number; rc: number; lights: { x: number; y: number; r: number; kind: string; color?: string }[]; buildings: { style: string; c: number; r: number; size: number }[] }

/** Offset of the rendered iso map image relative to the tile grid (props that poke out of the diamond grow the canvas). */
function mapOffset(tm: TileMap): [number, number] {
  let minX = 0, minY = 0;
  const T = tm.tile;
  for (let r = 0; r < tm.rows; r++) for (let c = 0; c < tm.cols; c++) {
    const i = r * tm.cols + c, g = tm.tiles[tm.ground[i]], d = tm.tiles[tm.deco[i]];
    const { bottom } = isoCell(c, r, tm.rows, T);
    if (d) { const [dx, dy] = isoPropOrigin(tm, c, r, d.sprite); minX = Math.min(minX, dx); minY = Math.min(minY, dy); }
    if (g) minY = Math.min(minY, bottom - g.sprite.h);
  }
  return [minX, minY];
}

/** The deco objects of an iso street map in image px (as rendered by `renderIsoMap`), with their emitters, ready for `applyLighting`. */
export function streetLitObjects(tm: TileMap): LitObject[] {
  const [minX, minY] = mapOffset(tm), out: LitObject[] = [];
  tm.deco.forEach((t, i) => {
    const tile = tm.tiles[t];
    if (t < 0 || !tile) return;
    const c = i % tm.cols, r = Math.floor(i / tm.cols), [dx, dy] = isoPropOrigin(tm, c, r, tile.sprite);
    out.push({ sprite: tile.sprite, x: dx - minX, y: dy - minY, name: tile.name, lights: tile.lights ?? [] });
  });
  return out.sort((a, b) => a.y + a.sprite.h - (b.y + b.sprite.h) || a.x - b.x);
}

interface Placed { kind: "prop" | "building"; name: string; c: number; r: number; res: UrbanResult }

export function buildStreet(kit: StyleKit, cols: number, rows: number, seed: number, density: number): { tm: TileMap; meta: StreetMeta; image: Sprite; objects: LitObject[] } {
  const T = isoTileW(kit), plan = planStreet(cols, rows), { cc, rc } = plan;
  const tm = emptyTileMap(cols, rows, T);
  tm.orientation = "isometric";
  const raise = kerbRaise(kit);
  tm.heights = new Array(cols * rows).fill(0);
  const I = (c: number, r: number) => r * cols + c;
  const isRoad = (c: number, r: number) => c >= 0 && r >= 0 && c < cols && r < rows && plan.road[I(c, r)];
  const R = rng(seed * 313 + 7);
  const padTo = (s: Sprite, h: number) => { if (s.h === h) return s; const o = createSprite(T, h); blit(o, s, 0, h - s.h); return o; };
  // ---- ground
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = I(c, r), v = (c * 7 + r * 13 + (c ^ r)) % 4, inter = (c === cc || c === cc + 1) && (r === rc || r === rc + 1);
    let kind: UrbanTileKind = "asphalt", o: UrbanTileOpts = {};
    if (plan.sidewalk[i]) {
      kind = "sidewalk";
      const kerb = (isRoad(c, r - 1) ? KERB.ne : 0) | (isRoad(c - 1, r) ? KERB.nw : 0) | (isRoad(c + 1, r) ? KERB.se : 0) | (isRoad(c, r + 1) ? KERB.sw : 0);
      o = { kerb, tenji: kerb !== 0 };
    } else if (!plan.road[i]) kind = "lot";
    else if (!inter) {
      const uRoad = r === rc || r === rc + 1, vRoad = c === cc || c === cc + 1;
      if (uRoad && !vRoad) { // the arm along the SE axis
        if (c === cc - 1 || c === cc + 2) { kind = "crosswalk"; o = { axis: "se" }; }
        else { kind = "line"; o = { side: r === rc ? "sw" : "ne" }; }
      } else if (vRoad && !uRoad) {
        if (r === rc - 1 || r === rc + 2) { kind = "crosswalk"; o = { axis: "sw" }; }
        else { kind = "line"; o = { side: c === cc ? "se" : "nw" }; }
      }
      if (c === cc - 3 && r === rc + 1) { kind = "manhole"; o = {}; }
    }
    const key = `${kind}-${o.side ?? o.axis ?? ""}-${o.kerb ?? 0}-${o.tenji ? 1 : 0}-${v}`;
    const idx = tm.tiles.findIndex((t) => t.name === key);
    const raised = kind === "sidewalk" || kind === "lot";
    tm.ground[i] = idx >= 0 ? idx : ensureTile(tm, key, padTo(urbanTile(kit, kind, seed, v, o), T / 2 + raise), false);
    tm.heights[i] = raised ? raise : 0;
  }
  // ---- placement helpers
  const placed: Placed[] = [];
  const buildings: StreetMeta["buildings"] = [];
  const taken = new Set<number>();
  const put = (kind: "prop" | "building", name: string, c: number, r: number, res: UrbanResult) => {
    if (c < 0 || r < 0 || c >= cols || r >= rows) return;
    tm.deco[I(c, r)] = ensureTile(tm, name, res.sprite, true);
    tm.tiles[tm.deco[I(c, r)]].lights = res.lights;
    placed.push({ kind, name, c, r, res });
  };
  const prop = (kind: string, c: number, r: number, variant = 0) => { if (taken.has(I(c, r)) || c < 0 || r < 0 || c >= cols || r >= rows) return; taken.add(I(c, r)); put("prop", `urban-${kind}-${variant}`, c, r, urbanProp(kit, kind, seed + c * 3 + r, variant)); };
  const building = (style: UrbanBuildingStyle, c: number, r: number, n: number, o: Partial<UrbanBuildingOpts>, s2: number) => {
    if (c < 0 || r < 0 || c + n > cols || r + n > rows) return;
    const res = urbanBuilding(kit, { style, size: n, ...o }, seed + s2);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) taken.add(I(c + i, r + j));
    put("building", `urban-${style}-${s2}`, c + n - 1, r + n - 1, res);
    buildings.push({ style, c, r, size: n });
  };
  // ---- buildings: the four blocks around the crossroads
  const w = cc - 1, s = rc - 1; // last cell before the sidewalk ring on the west / north side
  building("konbini", w - 2, s - 2, 2, { front: "both", floors: 2 }, 1);
  building("izakaya", w - 4, s - 2, 2, { front: "sw", floors: 2, neon: "pink" }, 2);
  building("apartment", w - 6, s - 2, 2, { front: "sw", floors: 4, neon: "cyan" }, 3);
  building("apartment", w - 2, s - 4, 2, { front: "se", floors: 4 }, 4);
  building("house", w - 2, s - 6, 2, { front: "se", floors: 2 }, 5);
  building("apartment", cc + 3, s - 2, 2, { front: "sw", floors: 4, wall: "sand", neon: "cyan" }, 6);
  building("house", cc + 5, s - 2, 2, { front: "sw", floors: 2 }, 7);
  building("izakaya", cc + 3, s - 4, 2, { front: "sw", floors: 2 }, 8);
  building("house", w - 2, rc + 3, 2, { front: "se", floors: 2 }, 9);
  building("apartment", w - 2, rc + 5, 2, { front: "se", floors: 3, wall: "sand" }, 10);
  building("house", cc + 4, rc + 4, 2, { front: "sw", floors: 1 }, 11);
  building("izakaya", cc + 6, rc + 4, 2, { front: "sw", floors: 1 }, 12);
  building("house", w - 2, rc + 7, 2, { front: "se", floors: 1 }, 13);
  // ---- sidewalk dressing along the two back sidewalks
  const rowN = rc - 1, colW = cc - 1, rowS = rc + 2, colE = cc + 2;
  prop("vending", w - 1, rowN, 0); prop("recycle-box", w - 2, rowN, 0); prop("vending", w - 3, rowN, 1);
  prop("bicycle", w - 5, rowN, 0); prop("bins", w - 4, rowN, 2); 
  prop("potted-plant", w - 7, rowN, 0); prop("chochin-stand", w - 8, rowN, 0);
  prop("utility-pole", colW, 1); prop("utility-pole", colW, 4); prop("utility-pole", colE + 0, 2); prop("utility-pole", colE + 0, 5); prop("a-frame-sign", colW, s - 1, 1);
  prop("cat", colW, s - 2, 1); prop("weeds", colW, s - 5, 0); prop("weeds", cc - 1 - 3, rc + 2, 2); prop("weeds", colE + 2, rowS + 1, 1); prop("weeds", colW, rowS + 5, 2); prop("potted-plant", colW, s - 7, 2); prop("bicycle", colW, s - 4, 1);
  prop("street-lamp", colW, rowS, 0); prop("mailbox", colE, rowN, 0);
  prop("yatai", colE + 1, rowN, 0); prop("bins", colE + 4, rowN, 1); prop("vending", colE + 2, rowN, 2); prop("potted-plant", colE + 5, rowN, 1); prop("a-frame-sign", colE + 3, rowN, 0);
  prop("weeds", w - 3, rowN, 1); prop("weeds", colE + 6, rowN, 2); prop("crates", colE + 6, rowN, 0); prop("neon-sign", colW, rowS + 1, 1);
  prop("street-lamp", colE, rowS, 1); prop("utility-pole", colE, rowS + 3); prop("utility-pole", colE, rowS + 6 > rows - 1 ? rows - 1 : rowS + 6);
  prop("vending", w - 1, rowS, 0); prop("recycle-box", w - 2, rowS, 1);
  prop("bins", colW, rowS + 2, 3); prop("potted-plant", colW, rowS + 4, 0); prop("cat", colE + 1, rowS, 0); prop("weeds", colW, rowS + 3, 1);
  prop("kei-car", cc + 4, rc, 0); prop("kei-car", cc + 5, rc + 1, 1);
  void density; void R;
  // ---- render + wires between neighbouring poles
  const image = renderIsoMap(tm);
  const objects = streetLitObjects(tm);
  const poles = objects.filter((o) => o.name.startsWith("urban-utility-pole"));
  const k = T / 32, ins = [-13, -5, 5, 13];
  const at = (o: LitObject, s: number, zup: number): [number, number] => [o.x + o.sprite.w / 2 + s * k, o.y + o.sprite.h - ISO_PROP_MARGIN - T / 4 + (s * k) / 2 - zup * k];
  const wire = 1 + 0; void wire;
  for (let i = 0; i < poles.length; i++) for (let j = i + 1; j < poles.length; j++) {
    const a = poles[i], b = poles[j];
    const ddx = b.x - a.x, ddy = b.y - a.y;
    if (Math.abs(ddx + 2 * ddy) > 4 || Math.abs(ddx) > T * 3 || ddx === 0) continue; // only poles along the same SW-running sidewalk
    for (const s of ins) for (const z of [84, 75]) drawWire(image, at(a, s, z), at(b, s, z), 3 * k, colorIndex("ink", 2));
  }
  return { tm, meta: { cc, rc, lights: objects.flatMap((o) => (o.lights ?? []).map((l) => ({ ...l, x: l.x + o.x, y: l.y + o.y }))) as StreetMeta["lights"], buildings }, image, objects };
}

export const isoStreetGenerator: Generator = {
  id: "iso-street",
  category: "map",
  label: "Iso street (urban night set)",
  description: "Isometric Japanese street corner for the 'kit-iso' camera: a 2-lane crossroads with zebra crossings, centre lines, kerbs, tactile paving and square-slab sidewalks, four corner blocks of konbini / izakaya / apartments / houses, vending machines, chochin lanterns, utility poles with wires, street lamps, bins, bicycles, plants, weeds, cats, a yatai cart and parked cars. Deterministic by seed. meta.lights lists every emitter in map image px ({x,y,r,kind,color}); `tilemap` tiles carry their own lights.",
  params: [
    { key: "cols", label: "Width (cells)", type: "number", min: 14, max: 24, step: 1, default: 16 },
    { key: "rows", label: "Height (cells)", type: "number", min: 14, max: 24, step: 1, default: 16 },
    { key: "props", label: "Prop density (0-1)", type: "number", min: 0, max: 1, step: 0.1, default: 1 },
  ],
  generate(p: Params, kit: StyleKit, seed: number) {
    const { tm, meta, image } = buildStreet(kit, Math.round(num(p, "cols")), Math.round(num(p, "rows")), seed, num(p, "props"));
    return { rows: [{ name: "map", frames: [image] }], fps: 1, tilemap: tm, meta: { camera: "iso", ...meta } };
  },
};

export type { Rng, Vec3 };

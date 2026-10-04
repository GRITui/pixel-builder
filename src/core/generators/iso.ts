// Isometric (2:1 dimetric) generators for the `kit-iso` camera: ground tiles, props and a house.
//
// Geometry: a ground cell is a diamond `T` wide and `T/2` tall. The world x axis runs down-right
// (SE), the y axis down-left (SW). Faces are described with the lit Painter through screen-space
// normals, so a top face, the left (SW) wall and the right (SE) wall pick three different shades
// from the kit's one light, exactly like every other asset.
//
// Tiling: the diamond mask uses row widths 2, 6, 10, ... , T-2, T-2, ... , 2 (period T/2 per row
// pair), so tiles placed at (+-T/2, +-T/4) partition the plane with no gap and no overlap. Nothing
// is outlined on tiles; their edges meet by shade difference alone.
import { finalize } from "../enforce";
import { proportions, resolveRamps } from "../kit";
import { Painter } from "../painter";
import type { Material } from "../palette";
import { rng } from "../rng";
import type { Sprite, StyleKit } from "../types";
import { bool, mat, num, str, type Generator, type Params } from "./types";

type Vec3 = [number, number, number];

const E = Math.PI / 6;
/** Screen-space normal (x right, y down, z toward viewer) of a world direction (x = SE, y = SW, z = up). */
const N = (wx: number, wy: number, wz: number): Vec3 => [(wx - wy) * Math.SQRT1_2, (wx + wy) * Math.SQRT1_2 * Math.sin(E) - wz * Math.cos(E), (wx + wy) * Math.SQRT1_2 * Math.cos(E) + wz * Math.sin(E)];
const TOP = N(0, 0, 1);
/** Wall facing down-left (lit by a top-left light) and wall facing down-right (shaded). */
const WALL_SW = N(0, 1, 0);
const WALL_SE = N(1, 0, 0);

/** Transparent rows props keep under their foot (the 1px margin); map renderers shift props down by this. */
export const ISO_PROP_MARGIN = 1;
/** Pixels per raised level of a block tile (at tile width 32). */
const levelPx = (T: number) => Math.round(T / 4);

/** Diamond width for a kit: a multiple of 8 so the half-height rows divide evenly. */
export const isoTileW = (kit: StyleKit) => Math.max(16, Math.round(kit.sizes.tile / 8) * 8);

/** Row extents [x0, x1) of the diamond top face (see header: this exact mask tiles seamlessly). */
export function diamondRows(T: number): [number, number][] {
  const TH = T / 2, half = TH / 2;
  return Array.from({ length: TH }, (_, y) => {
    const w = y < half ? 4 * y + 2 : 4 * (TH - 1 - y) + 2;
    return [(T - w) / 2, (T + w) / 2] as [number, number];
  });
}

/** Screen position of a map cell: centre x and the y of its top and bottom vertex, in an `rows`-high map. */
export function isoCell(c: number, r: number, rows: number, T: number) {
  const top = ((c + r) * T) / 4;
  return { cx: ((c - r + rows) * T) / 2, top, bottom: top + T / 2 };
}

function isMono(kit: StyleKit): boolean {
  const r = resolveRamps(kit);
  return r.grass[3] === r.water[3] && r.grass[3] === r.dirt[3];
}

export type IsoTileKind = "grass" | "dirt" | "sand" | "water" | "stone";
const TILE_KINDS: IsoTileKind[] = ["grass", "dirt", "sand", "water", "stone"];
const TOP_MAT: Record<IsoTileKind, Material> = { grass: "grass", dirt: "dirt", sand: "sand", water: "water", stone: "stone" };

/** One ground tile: `T` x `T/2 + height` (the diamond sits on top, the walls hang below it). */
export function isoTile(kit: StyleKit, kind: IsoTileKind, seed: number, variant: number, height: number, side: Material = "dirt"): Sprite {
  const T = isoTileW(kit), TH = T / 2;
  const H = kind === "water" ? 0 : Math.max(0, Math.round(height)) * levelPx(T);
  const P = new Painter(T, TH + H, kit);
  const r = rng(seed * 977 + variant * 131 + TILE_KINDS.indexOf(kind) * 7919);
  const rows = diamondRows(T);
  const top = TOP_MAT[kind];
  const sideM: Material = kind === "grass" ? side : top;
  const inside = (x: number, y: number) => y >= 0 && y < TH && x >= rows[y][0] && x < rows[y][1];
  // On monochrome palettes (handheld) every material shares one ramp, so ground kinds are told apart by shade.
  const baseTone = isMono(kit) ? { grass: 0, dirt: -1, sand: 1, water: -1, stone: 0 }[kind] : 0;
  const dot = (x: number, y: number, m: Material, tone: number, n: Vec3 = TOP) => { if (inside(x, y)) P.box(x, y, 1, 1, m, n, { tone: tone + baseTone }); };

  rows.forEach(([x0, x1], y) => P.box(x0, y, x1 - x0, 1, top, TOP, { tone: baseTone }));


  const specks = Math.round(T / 3);
  if (kind === "grass") {
    for (let i = 0; i < specks; i++) {
      const x = r.int(2, T - 3), y = r.int(1, TH - 3);
      if (!inside(x - 1, y) || !inside(x + 1, y + 1)) continue;
      dot(x, y, top, 1);
      dot(x, y + 1, top, -1);
    }
    if (variant % 4 === 3) { const x = r.int(8, T - 9), y = r.int(3, TH - 5); if (inside(x, y)) P.px(x, y, "gold", 3); }
  } else if (kind === "dirt") {
    for (let i = 0; i < specks; i++) dot(r.int(1, T - 2), r.int(0, TH - 1), top, r.chance(0.6) ? -1 : 1);
  } else if (kind === "sand") {
    for (let i = 0; i < Math.round(specks / 2); i++) dot(r.int(1, T - 2), r.int(0, TH - 1), top, -1);
    // a short ripple along the SE axis (slope 1:2)
    const x = r.int(T / 4, T / 2), y = r.int(3, TH - 6);
    for (let i = 0; i < 6; i++) dot(x + i, y + (i >> 1), top, 1);
  } else if (kind === "stone") {
    // four slabs: seams along both iso axes through the centre, shifted a little per variant
    const sh = (variant % 3) - 1;
    for (let y = 0; y < TH; y++)
      for (let x = rows[y][0]; x < rows[y][1]; x++) {
        const a = Math.round((x + 0.5 - T / 2) / 2 + (y + 0.5 - TH / 2)) + sh, b = Math.round((x + 0.5 - T / 2) / 2 - (y + 0.5 - TH / 2)) + sh;
        if (a === 0 || b === 0) dot(x, y, top, -1);
      }
    for (let i = 0; i < specks / 2; i++) dot(r.int(1, T - 2), r.int(0, TH - 1), top, r.chance(0.5) ? 1 : -1);
  } else {
    // water: short ripples
    for (let i = 0; i < 4; i++) {
      const x = r.int(4, T - 8), y = r.int(2, TH - 3);
      for (let k = 0; k < 3; k++) dot(x + k, y, top, 1);
    }
    for (let i = 0; i < 3; i++) dot(r.int(3, T - 4), r.int(1, TH - 2), top, -1);
  }

  if (H > 0) {
    const bottomOf = (x: number) => { let b = -1; for (let y = 0; y < TH; y++) if (inside(x, y)) b = y; return b; };
    for (let x = 0; x < T; x++) {
      const yb = bottomOf(x);
      if (yb < 0) continue;
      const n = x < T / 2 ? WALL_SW : WALL_SE;
      for (let j = 1; j <= H; j++) {
        // grass overhangs the top two rows of the soil; the last row is a contact shadow
        const lip = kind === "grass" && j <= (H >= 6 ? 2 : 1);
        P.box(x, yb + j, 1, 1, lip ? "grass" : sideM, n, { tone: lip ? -1 : j === H && H >= 6 ? -1 : r.chance(0.07) ? -1 : 0 });
      }
    }
  }
  // tiles are never outlined (they must meet their neighbours edge to edge)
  return finalize(P.toSprite(), kit, { outline: false });
}

// ---------------------------------------------------------------- props

export const ISO_PROP_KINDS = ["tree", "pine", "rock", "bush", "fence-se", "fence-sw", "post"] as const;
export type IsoPropKind = (typeof ISO_PROP_KINDS)[number];

/** Canvas for a prop standing on one cell: width T (or `wide`), foot = the cell centre, 1px margin below. */
function propCanvas(kit: StyleKit, h: number) {
  const T = isoTileW(kit);
  return { T, TH: T / 2, P: new Painter(T, h, kit), foot: [T / 2, h - ISO_PROP_MARGIN - T / 4] as [number, number] };
}

export function isoProp(kit: StyleKit, kind: IsoPropKind, seed: number, variant: number, p: { leaf: Material; wood: Material; stone: Material }): Sprite {
  const pr = proportions(kit);
  const r = rng(seed * 313 + variant * 17 + 5);
  const T = isoTileW(kit), TH = T / 2;
  const cell = TH + ISO_PROP_MARGIN;
  if (kind === "tree") {
    const th = Math.round(pr.tree * 0.9), h = th + cell;
    const { P, foot } = propCanvas(kit, h);
    const [fx, fy] = foot;
    const tw = Math.max(3, Math.round(T / 7)), trunkH = Math.round(th * 0.28);
    P.cylinder(Math.round(fx - tw / 2), fy - trunkH, tw, trunkH + 1, p.wood);
    // root flare
    P.box(Math.round(fx - tw / 2) - 1, fy - 1, tw + 2, 2, p.wood, WALL_SW, { tone: -1 });
    const cy = fy - trunkH - (th - trunkH) * 0.4, ry = (th - trunkH) * 0.6, rx = T * 0.44;
    P.ellipse(fx - rx * 0.42, cy + ry * 0.18, rx * 0.62, ry * 0.62, p.leaf, { tone: -1 });
    P.ellipse(fx + rx * 0.42, cy + ry * 0.2, rx * 0.6, ry * 0.6, p.leaf, { tone: -1 });
    P.ellipse(fx, cy, rx * 0.8, ry * 0.9, p.leaf);
    for (let i = 0; i < 4 + (variant % 3); i++) P.box(Math.round(fx + r.int(-6, 6)), Math.round(cy + r.int(-5, 5)), 2, 1, p.leaf, TOP, { tone: 1 });
    return finalize(P.toSprite(), kit);
  }
  if (kind === "pine") {
    const th = Math.round(pr.tree * 0.95), h = th + cell;
    const { P, foot } = propCanvas(kit, h);
    const [fx, fy] = foot;
    P.cylinder(Math.round(fx - 1.5), fy - Math.round(th * 0.2), 3, Math.round(th * 0.2) + 1, p.wood);
    const tiers = 3, tierH = Math.round((th * 0.9) / tiers + 2);
    for (let i = 0; i < tiers; i++) {
      const by = fy - Math.round(th * 0.14) - i * Math.round((th * 0.78) / tiers), hw = Math.round(T * 0.4 - i * T * 0.1);
      // each tier: a lit left half and a shaded right half so the cone reads as a volume
      P.poly([[fx, by - tierH], [fx - hw, by], [fx, by + 2]], p.leaf, WALL_SW, { tone: 0 });
      P.poly([[fx, by - tierH], [fx, by + 2], [fx + hw, by]], p.leaf, WALL_SE, { tone: 0 });
    }
    return finalize(P.toSprite(), kit);
  }
  if (kind === "rock") {
    const rh = Math.round(T * 0.42), h = rh + cell;
    const { P, foot } = propCanvas(kit, h);
    const [fx, fy] = foot;
    P.ellipse(fx - 4, fy - 3, T * 0.22, rh * 0.4, p.stone, { tone: -1 });
    P.ellipse(fx + 2, fy - rh * 0.4, T * 0.33, rh * 0.5, p.stone);
    P.box(Math.round(fx - 1), Math.round(fy - rh * 0.75), 3, 1, p.stone, TOP, { tone: 1 });
    return finalize(P.toSprite(), kit);
  }
  if (kind === "bush") {
    const bh = Math.round(T * 0.5), h = bh + cell;
    const { P, foot } = propCanvas(kit, h);
    const [fx, fy] = foot;
    P.ellipse(fx - T * 0.18, fy - 4, T * 0.22, bh * 0.38, p.leaf, { tone: -1 });
    P.ellipse(fx + T * 0.2, fy - 4, T * 0.21, bh * 0.36, p.leaf, { tone: -1 });
    P.ellipse(fx, fy - bh * 0.42, T * 0.3, bh * 0.45, p.leaf);
    if (variant % 2) for (let i = 0; i < 3; i++) P.px(Math.round(fx + r.int(-6, 6)), Math.round(fy - bh * 0.4 + r.int(-3, 3)), "cloth2", 3);
    return finalize(P.toSprite(), kit);
  }
  // fences: a segment through the cell centre between the midpoints of two opposite cell edges
  const hp = Math.max(8, Math.round(pr.figure * 0.42)), h = hp + cell + 2;
  const { P, foot } = propCanvas(kit, h);
  const [fx, fy] = foot;
  const se = kind === "fence-se";
  if (kind === "post") {
    P.box(fx - 1, fy - hp, 3, hp + 1, p.wood, WALL_SW);
    P.box(fx + 1, fy - hp, 1, hp + 1, p.wood, WALL_SE);
    P.box(fx - 1, fy - hp, 3, 1, p.wood, TOP, { tone: 1 });
    return finalize(P.toSprite(), kit);
  }
  // ends of the segment: NW/SE edge midpoints (se) or NE/SW edge midpoints (sw)
  const a: [number, number] = se ? [fx - T / 4, fy - TH / 4] : [fx + T / 4, fy - TH / 4];
  const b: [number, number] = se ? [fx + T / 4, fy + TH / 4] : [fx - T / 4, fy + TH / 4];
  const n = se ? WALL_SW : WALL_SE;
  const rail = (z: number) => P.poly([[a[0], a[1] - z - 2], [b[0], b[1] - z - 2], [b[0], b[1] - z], [a[0], a[1] - z]], p.wood, n, { tone: 0 });
  // far post first so the rails cross in front of it
  const post = (c: [number, number]) => {
    P.box(Math.round(c[0]) - 1, Math.round(c[1]) - hp, 3, hp + 1, p.wood, n);
    P.box(Math.round(c[0]) - 1, Math.round(c[1]) - hp, 3, 1, p.wood, TOP, { tone: 1 });
  };
  post(se ? a : b);
  rail(Math.round(hp * 0.7));
  rail(Math.round(hp * 0.3));
  post(se ? b : a);
  return finalize(P.toSprite(), kit);
}

// ---------------------------------------------------------------- building

/** Box house on an `n` x `n` cell footprint with a gable roof; the SW wall (long side, lit) and the SE gable wall (shaded) are visible. */
export function isoBuilding(kit: StyleKit, n: number, seed: number, wall: Material, roof: Material, trim: Material, lit: boolean, chimney: boolean): Sprite {
  const pr = proportions(kit);
  const T = isoTileW(kit), TH = T / 2;
  const r = rng(seed * 59 + 3);
  const wh = pr.door + 3, rh = Math.round(n * T * 0.28) + 2, over = 3;
  const W = n * T + 2 * over + 2;
  const top = rh + wh + (chimney ? 4 : 0) + over + 2;
  const Hc = top + n * TH + ISO_PROP_MARGIN + 2;
  const P = new Painter(W, Hc, kit);
  const ox = W / 2, oy = top;
  // world -> screen: u runs SE, v runs SW (in cells), z is pixels up
  const S = (u: number, v: number, z: number): [number, number] => [ox + ((u - v) * T) / 2, oy + ((u + v) * TH) / 2 - z];
  const quad = (pts: [number, number][], m: Material, nrm: Vec3, tone = 0) => P.poly(pts, m, nrm, { tone });

  // walls
  quad([S(0, n, 0), S(n, n, 0), S(n, n, wh), S(0, n, wh)], wall, WALL_SW);
  quad([S(n, n, 0), S(n, 0, 0), S(n, 0, wh), S(n, n, wh)], wall, WALL_SE);
  // plank / course lines on both walls (explicit tone, details only)
  const course = (u0: number, v0: number, u1: number, v1: number, nrm: Vec3) => {
    for (let z = 4; z < wh; z += 4) {
      const [x0, y0] = S(u0, v0, z), [x1, y1] = S(u1, v1, z);
      for (let x = Math.ceil(Math.min(x0, x1)); x < Math.max(x0, x1); x++) P.box(x, Math.round(y0 + ((y1 - y0) * (x + 0.5 - x0)) / (x1 - x0)), 1, 1, wall, nrm, { tone: -1 });
    }
  };
  course(0.02, n, n - 0.02, n, WALL_SW);
  course(n, n - 0.02, n, 0.02, WALL_SE);
  // base trim
  quad([S(0, n, 0), S(n, n, 0), S(n, n, 2), S(0, n, 2)], "stone", WALL_SW);
  quad([S(n, n, 0), S(n, 0, 0), S(n, 0, 2), S(n, n, 2)], "stone", WALL_SE);

  // door centred on the SW wall; windows either side (SW) and one on the SE gable wall
  const dw = Math.max(0.28, 0.5 / n * 0.9) * (n > 1 ? 1 : 1.1), dz = pr.door - 2;
  const um = n / 2;
  quad([S(um - dw / 2 - 0.04, n, 0), S(um + dw / 2 + 0.04, n, 0), S(um + dw / 2 + 0.04, n, dz + 1), S(um - dw / 2 - 0.04, n, dz + 1)], trim, WALL_SW, -1);
  quad([S(um - dw / 2, n, 0), S(um + dw / 2, n, 0), S(um + dw / 2, n, dz), S(um - dw / 2, n, dz)], "wood", WALL_SW, -1);
  const [kx, ky] = S(um + dw / 2 - 0.08, n, dz / 2);
  P.px(kx, ky, "gold", 3);
  const win = (u: number, v: number, face: "sw" | "se") => {
    const ww = 0.2, z0 = Math.round(wh * 0.45), z1 = z0 + Math.round(pr.window * 1.2);
    const f = (a: number, z: number): [number, number] => (face === "sw" ? S(a, n, z) : S(n, a, z));
    const nr = face === "sw" ? WALL_SW : WALL_SE;
    const c = face === "sw" ? u : v;
    quad([f(c - ww - 0.03, z0 - 1), f(c + ww + 0.03, z0 - 1), f(c + ww + 0.03, z1 + 1), f(c - ww - 0.03, z1 + 1)], trim, nr, -1);
    const pts: [number, number][] = [f(c - ww, z0), f(c + ww, z0), f(c + ww, z1), f(c - ww, z1)];
    const lo = pts[0], hi = pts[2];
    P.poly(pts, lit ? "gold" : "water", nr, { tone: lit ? 1 : 0 });
    P.px(Math.round((lo[0] + hi[0]) / 2), Math.round((lo[1] + hi[1]) / 2), lit ? "gold" : "water", 4);
  };
  win(um / 2 - 0.03 * n, 0, "sw");
  if (n >= 2) win(n - um / 2 + 0.03 * n, 0, "sw");
  win(0, n / 2, "se");

  // gable end (SE wall): triangle above the wall, then the SW roof slope in front
  const ov = over / (T / 2); // overhang in cells
  quad([S(n, -0.0, wh), S(n, n, wh), S(n, n / 2, wh + rh)], wall, WALL_SE, -1);
  // roof: slope facing SW; normal tilted from the wall normal toward the sky
  const pitch = Math.atan2(rh, (n / 2) * (T / 2) * 1.2);
  const rn = N(0, Math.cos(pitch), Math.sin(pitch));
  const eave: [number, number][] = [S(-ov, n + ov, wh - 2), S(n + ov, n + ov, wh - 2)];
  const ridge: [number, number][] = [S(-ov, n / 2, wh + rh), S(n + ov, n / 2, wh + rh)];
  quad([eave[0], eave[1], ridge[1], ridge[0]], roof, rn);
  // shingle rows parallel to the eave
  for (let i = 1; i < 4; i++) {
    const t = i / 4;
    const x0 = eave[0][0] + (ridge[0][0] - eave[0][0]) * t, y0 = eave[0][1] + (ridge[0][1] - eave[0][1]) * t;
    const x1 = eave[1][0] + (ridge[1][0] - eave[1][0]) * t, y1 = eave[1][1] + (ridge[1][1] - eave[1][1]) * t;
    const steps = Math.round(Math.abs(x1 - x0));
    for (let s = 0; s < steps; s += 2 + (i % 2)) { const f = s / steps; P.box(Math.round(x0 + (x1 - x0) * f), Math.round(y0 + (y1 - y0) * f), 1, 1, roof, rn, { tone: -1 }); }
  }
  // eave fascia (a shaded strip under the roof edge) and ridge cap
  quad([eave[0], eave[1], [eave[1][0], eave[1][1] + 2], [eave[0][0], eave[0][1] + 2]], roof, WALL_SW, -1);
  P.line(ridge[0][0], ridge[0][1], ridge[1][0], ridge[1][1], roof, 4);
  // rake board along the gable edge (SE end)
  P.line(eave[1][0], eave[1][1], ridge[1][0], ridge[1][1], trim, 2);
  if (chimney) {
    const [cx, cy] = S(n * 0.28, n * 0.62, wh + Math.round(rh * 0.7));
    P.box(Math.round(cx) - 2, Math.round(cy) - 7, 5, 8, "stone", WALL_SW);
    P.box(Math.round(cx) + 1, Math.round(cy) - 7, 2, 8, "stone", WALL_SE);
    P.box(Math.round(cx) - 3, Math.round(cy) - 8, 7, 2, "stone", TOP, { tone: 1 });
    void r;
  }
  return finalize(P.toSprite(), kit);
}

// ---------------------------------------------------------------- generators

const SOLID: Material[] = ["wood", "stone", "sand", "dirt", "leather", "metal", "cloth2"];
const ROOFS: Material[] = ["roof", "wood", "foliage", "stone", "cloth", "cloth2", "accent", "sand"];

export const isoTileGenerator: Generator = {
  id: "iso-tile",
  category: "environment",
  label: "Iso ground tile",
  description: "Isometric (2:1 dimetric) ground tile for the 'kit-iso' camera: a diamond (tile width x half height) of grass, dirt, sand, water or stone that tiles seamlessly in a diamond grid, optionally raised 1-2 levels as a lit block (left wall lit, right wall shaded). `variant` 0-3 gives different textures for the same kind.",
  params: [
    { key: "kind", label: "Ground", type: "select", options: TILE_KINDS, default: "grass" },
    { key: "height", label: "Raised levels (0 = flat; not for water)", type: "number", min: 0, max: 2, step: 1, default: 0 },
    { key: "variant", label: "Variant", type: "number", min: 0, max: 3, step: 1, default: 0 },
    { key: "side", label: "Side material of raised grass", type: "material", options: ["dirt", "stone", "sand", "wood"], default: "dirt" },
  ],
  generate(p: Params, kit: StyleKit, seed: number) {
    const s = isoTile(kit, str(p, "kind") as IsoTileKind, seed, num(p, "variant"), num(p, "height"), mat(p, "side"));
    return { rows: [{ name: "idle", frames: [s] }], fps: 1 };
  },
};

export const isoPropGenerator: Generator = {
  id: "iso-prop",
  category: "environment",
  label: "Iso prop",
  description: "Isometric prop standing on one diamond cell (foot at the cell centre): tree, pine, rock, bush, fence segments along the two iso axes (fence-se runs down-right, fence-sw down-left) and a fence post. For the 'kit-iso' camera.",
  params: [
    { key: "kind", label: "Prop", type: "select", options: [...ISO_PROP_KINDS], default: "tree" },
    { key: "variant", label: "Variant", type: "number", min: 0, max: 5, step: 1, default: 0 },
    { key: "leaf", label: "Foliage", type: "material", options: ["foliage", "grass", "sand", "cloth2"], default: "foliage" },
    { key: "wood", label: "Wood", type: "material", options: ["wood", "leather", "stone", "metal"], default: "wood" },
    { key: "stone", label: "Stone", type: "material", options: ["stone", "dirt", "sand", "metal"], default: "stone" },
  ],
  generate(p: Params, kit: StyleKit, seed: number) {
    const s = isoProp(kit, str(p, "kind") as IsoPropKind, seed, num(p, "variant"), { leaf: mat(p, "leaf"), wood: mat(p, "wood"), stone: mat(p, "stone") });
    return { rows: [{ name: "idle", frames: [s] }], fps: 1 };
  },
};

export const isoBuildingGenerator: Generator = {
  id: "iso-building",
  category: "building",
  label: "Iso house",
  description: "Isometric box house for the 'kit-iso' camera: a gable-roofed house on an n x n cell footprint showing two walls (lit left, shaded right), door, windows and optional chimney. Anchor = the bottom corner of the footprint, so in a map place it on the footprint's bottom-most cell.",
  params: [
    { key: "size", label: "Footprint (cells per side)", type: "number", min: 1, max: 3, step: 1, default: 2 },
    { key: "wall", label: "Walls", type: "material", options: SOLID, default: "sand" },
    { key: "roof", label: "Roof", type: "material", options: ROOFS, default: "roof" },
    { key: "trim", label: "Trim", type: "material", options: SOLID, default: "wood" },
    { key: "lit_windows", label: "Lit windows", type: "bool", default: true },
    { key: "chimney", label: "Chimney", type: "bool", default: true },
  ],
  generate(p: Params, kit: StyleKit, seed: number) {
    const s = isoBuilding(kit, Math.round(num(p, "size")), seed, mat(p, "wall"), mat(p, "roof"), mat(p, "trim"), bool(p, "lit_windows"), bool(p, "chimney"));
    return { rows: [{ name: "idle", frames: [s] }], fps: 1, meta: { camera: "iso", footprint: Math.round(num(p, "size")) } };
  },
};

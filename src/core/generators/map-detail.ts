import { colorIndex, decodeIndex, fineSlotIndex, normalizeDepth, type Material } from "../palette";
import { rng, valueNoise } from "../rng";
import { cloneSprite } from "../sprite";
import type { Sprite, StyleKit, TileMap } from "../types";
import { ensureTile } from "../tilemap";

/**
 * Ground detail pass (opt-in `detail` param): palette-locked colour variation from noise plus tiny
 * decals (grass tufts, petals, pebbles, leaf litter, cracks). Every cell gets its own tile (the
 * decals differ), so run it last; variation uses map-wide pixel coordinates, so it is seamless
 * across tile borders and decals stay 1px inside their tile.
 */
export const DETAIL_LEVELS = ["off", "low", "medium", "high"] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];

const KINDS = new Set(["grass", "dirt", "sand", "snow"]);
// materials the ground tiles are painted with (snow is the "ui" ramp)
const GROUNDS = new Set(["grass", "dirt", "sand", "ui"]);
const PER_TILE: Record<string, [number, number]> = { low: [0, 1], medium: [1, 3], high: [3, 6] };
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Shift a palette index along its ramp by `delta` classic levels (half a level in deep kits, where fine shades exist). */
function shift(idx: number, delta: number, deep: boolean): number {
  const d = decodeIndex(idx);
  if (!d || !GROUNDS.has(d.mat)) return idx;
  // position in half-levels: classic level L is 2L, the fine shade after level k is 2k+1
  const cur = d.fine !== undefined ? d.fine * 2 + 1 : d.level * 2;
  const next = Math.max(0, Math.min(8, cur + (deep ? delta : delta * 2)));
  return next % 2 === 0 ? colorIndex(d.mat, next / 2) : fineSlotIndex(d.mat, (next - 1) / 2);
}

/** `forest` is the dense-woodland tuning (kept exactly); `open` is gentler, for farm / meadow / rice-village / island. */
export type DetailProfile = "forest" | "open";
const PER_TILE_OPEN: Record<string, [number, number]> = { low: [0, 1], medium: [1, 2], high: [2, 4] };

export function applyGroundDetail(tm: TileMap, kit: StyleKit, seed: number, level: string, opts: { maples?: number[]; skip?: Set<number>; profile?: DetailProfile } = {}): void {
  if (opts.profile === "open") return applyOpenDetail(tm, kit, seed, level, opts.skip);
  const range = PER_TILE[level];
  if (!range) return;
  const { cols, rows, tile: T } = tm;
  const deep = normalizeDepth(kit.rampDepth) > 5;
  const low = valueNoise((seed ^ 0xd37a) >>> 0, 16), mid = valueNoise((seed ^ 0xd41b) >>> 0, 16);
  const r = rng((seed ^ 0xdec41) >>> 0);
  const maples = new Set(opts.maples ?? []);
  const scale = Math.max(1, Math.round(T / 16));
  // fallen leaves lie around the foot of each maple
  const litter = new Map<number, number>();
  for (const m of maples) {
    const mx = m % cols, my = Math.floor(m / cols);
    for (let dy = 0; dy <= 2; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const x = mx + dx, y = my + dy;
        if (x >= 0 && y >= 0 && x < cols && y < rows) litter.set(y * cols + x, (litter.get(y * cols + x) ?? 0) + (Math.abs(dx) <= 1 ? 3 : 2));
      }
  }

  const done = new Map<number, number>();
  for (let i = 0; i < cols * rows; i++) {
    const idx = tm.ground[i];
    const name = tm.tiles[idx]?.name ?? "";
    const kind = name.split("-")[0];
    if (!KINDS.has(kind) || opts.skip?.has(i)) continue;
    const cx = i % cols, cy = Math.floor(i / cols);
    const sp = cloneSprite(tm.tiles[idx].sprite);
    // colour variation: sunlit and shaded patches in neighbouring ramp shades, dithered at the edges
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) {
        const gx = cx * T + x, gy = cy * T + y;
        const v = low(gx / (T * 3.2), gy / (T * 3.2)) * 0.65 + mid(gx / (T * 0.9), gy / (T * 0.9)) * 0.35 + (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * 0.07;
        // 4-tone kits have no spare shades: patches would just be noise there
        const delta = kit.shadeSteps <= 3 ? 0 : v > 0.62 ? 1 : v < 0.36 ? -1 : 0;
        if (delta) sp.data[y * T + x] = shift(sp.data[y * T + x], delta, deep);
      }
    const n = r.int(range[0], range[1]);
    for (let k = 0; k < n; k++) decal(sp, kind, r, scale);
    const leaves = litter.get(i) ?? 0;
    for (let k = 0; k < leaves * (level === "low" ? 1 : level === "medium" ? 1 : 2); k++) leaf(sp, r, scale, kind);
    done.set(i, ensureTile(tm, `${kind}-d${cx}-${cy}`, sp, false));
  }
  for (const [i, t] of done) tm.ground[i] = t;
}

const isGround = (sp: Sprite, x: number, y: number) => {
  const d = decodeIndex(sp.data[y * sp.w + x]);
  return !!d && GROUNDS.has(d.mat);
};

/** Put a pixel only on ground pixels (never on foam, water or outlines); 1px inside the tile. */
function dot(sp: Sprite, x: number, y: number, mat: Material, lvl: number) {
  if (x < 1 || y < 1 || x >= sp.w - 1 || y >= sp.h - 1 || !isGround(sp, x, y)) return;
  sp.data[y * sp.w + x] = colorIndex(mat, lvl);
}

function decal(sp: Sprite, kind: string, r: ReturnType<typeof rng>, s: number) {
  const x = r.int(2, sp.w - 3 - s), y = r.int(3 + s, sp.h - 3);
  const roll = r.next();
  if (kind === "grass") {
    if (roll < 0.5) {
      // tuft: three blades leaning out of a dark base
      const h = 2 + s;
      for (let k = 0; k < h; k++) dot(sp, x, y - k, "grass", k === h - 1 ? 4 : 3);
      for (let k = 0; k < h - 1; k++) { dot(sp, x - 1, y - k, "grass", k === h - 2 ? 3 : 2); dot(sp, x + 1, y - k, "grass", k === h - 2 ? 4 : 2); }
      dot(sp, x, y + 1, "grass", 0);
    } else if (roll < 0.72) {
      // petals: a bright flower head with a green dot beside it
      const m = (["cloth2", "gold", "accent", "ui"] as Material[])[r.int(0, 3)];
      dot(sp, x, y, m, m === "ui" ? 4 : 3);
      if (s > 1) dot(sp, x + 1, y, m, m === "ui" ? 3 : 4);
      dot(sp, x, y + 1, "grass", 1);
    } else if (roll < 0.86) pebble(sp, x, y, s);
    else leaf(sp, r, s, kind);
  } else if (kind === "dirt") {
    if (roll < 0.55) pebble(sp, x, y, s);
    else if (roll < 0.85) { for (let k = 0; k < 3 + s; k++) dot(sp, x + k, y + (k % 2), "dirt", 0); }
    else leaf(sp, r, s, kind);
  } else if (kind === "sand") {
    if (roll < 0.6) pebble(sp, x, y, s);
    else { dot(sp, x, y, "sand", 0); dot(sp, x + 1, y, "sand", 0); dot(sp, x, y - 1, "sand", 4); }
  } else {
    dot(sp, x, y, "ui", 4);
    dot(sp, x + 1, y + 1, "ui", 1);
  }
}

function pebble(sp: Sprite, x: number, y: number, s: number) {
  for (let k = 0; k < 1 + s; k++) dot(sp, x + k, y, "stone", k === 0 ? 3 : 2);
  dot(sp, x, y - 1, "stone", 4);
  for (let k = 0; k < 1 + s; k++) dot(sp, x + k, y + 1, "stone", 1);
}

/** A fallen leaf: a 2px warm fleck, autumn colours on grass and dirt. */
function leaf(sp: Sprite, r: ReturnType<typeof rng>, s: number, kind: string) {
  if (kind !== "grass" && kind !== "dirt") return;
  const x = r.int(2, sp.w - 4), y = r.int(2, sp.h - 3);
  const m = (["cloth2", "gold", "roof"] as Material[])[r.int(0, 2)];
  dot(sp, x, y, m, 3);
  dot(sp, x + 1, y + (r.next() < 0.5 ? 0 : 1), m, m === "roof" ? 2 : 4);
  if (s > 1) dot(sp, x + 2, y, m, 2);
}

// ---------------------------------------------------------------- open profile

const OPEN_PATCHES: Record<string, number> = { low: 0.5, medium: 0.8, high: 1 };

/**
 * Open-land detail: small, soft sunlit and shaded patches (one ramp step either way, dithered
 * edges, scale tied to the tile), worn path borders, clover, petals near flowers and hay near barns.
 */
function applyOpenDetail(tm: TileMap, kit: StyleKit, seed: number, level: string, skip?: Set<number>): void {
  const range = PER_TILE_OPEN[level];
  if (!range) return;
  const { cols, rows, tile: T } = tm;
  const deep = normalizeDepth(kit.rampDepth) > 5;
  const amount = OPEN_PATCHES[level];
  const broad = valueNoise((seed ^ 0x51a7) >>> 0, 16), fine = valueNoise((seed ^ 0x9c3d) >>> 0, 16);
  const r = rng((seed ^ 0x0be11) >>> 0);
  const scale = Math.max(1, Math.round(T / 16));
  const kindAt = (i: number) => (tm.tiles[tm.ground[i]]?.name ?? "").split("-")[0];
  const decoKind = (i: number) => (tm.tiles[tm.deco[i]]?.name ?? "").replace(/-\d+$/, "");
  const near = new Map<string, Map<number, number>>(); // prop kind -> cell -> weight
  const spread = (kind: string, dx0: number, dx1: number, dy0: number, dy1: number, w: number, on: (k: string) => boolean) => {
    for (let i = 0; i < cols * rows; i++) {
      if (!on(decoKind(i))) continue;
      const x = i % cols, y = Math.floor(i / cols);
      for (let dy = dy0; dy <= dy1; dy++) for (let dx = dx0; dx <= dx1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const m = near.get(kind) ?? new Map<number, number>();
        m.set(ny * cols + nx, (m.get(ny * cols + nx) ?? 0) + w);
        near.set(kind, m);
      }
    }
  };
  spread("hay", -2, 2, 0, 1, 2, (k) => k === "barn" || k === "coop");
  spread("petal", -1, 1, -1, 1, 2, (k) => k === "flowers");

  const done = new Map<number, number>();
  for (let i = 0; i < cols * rows; i++) {
    const idx = tm.ground[i];
    const kind = kindAt(i);
    if (!KINDS.has(kind) || skip?.has(i)) continue;
    const cx = i % cols, cy = Math.floor(i / cols);
    const sp = cloneSprite(tm.tiles[idx].sprite);
    const base = sp.data.slice();
    for (let y = 0; y < T; y++)
      for (let x = 0; x < T; x++) {
        const gx = cx * T + x, gy = cy * T + y;
        // broad drifts plus finer speckle; the Bayer term dithers every patch edge
        const v = broad(gx / (T * 1.0), gy / (T * 1.0)) * 0.5 + fine(gx / (T * 0.4), gy / (T * 0.4)) * 0.5 + (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * 0.1;
        const hi = 0.74 - 0.05 * amount, lo = 0.2 + 0.03 * amount;
        const delta = kit.shadeSteps <= 3 ? 0 : v > hi ? 1 : v < lo ? -1 : 0;
        if (delta && (kind !== "dirt" || delta > 0 || BAYER[(y & 3) * 4 + (x & 3)] < 4)) sp.data[y * T + x] = shift(sp.data[y * T + x], delta, deep);
      }
    if (kind === "dirt") wornEdges(sp, base, tm, i, kindAt, T, deep);
    const n = r.int(range[0], range[1]);
    for (let k = 0; k < n; k++) openDecal(sp, base, kind, r, scale, deep);
    if (kind === "grass") {
      for (let k = 0; k < (near.get("petal")?.get(i) ?? 0) * (level === "low" ? 1 : 2); k++) petal(sp, r, scale);
      for (let k = 0; k < (near.get("hay")?.get(i) ?? 0) * (level === "low" ? 2 : 3); k++) hay(sp, r, scale);
    } else if (kind === "dirt") {
      for (let k = 0; k < (near.get("hay")?.get(i) ?? 0) * 2; k++) hay(sp, r, scale);
    }
    done.set(i, ensureTile(tm, `${kind}-d${cx}-${cy}`, sp, false));
  }
  for (const [i, t] of done) tm.ground[i] = t;
}

/** Footpath borders: a darker rut hugging the edge with a lit, dithered lip just inside it. */
function wornEdges(sp: Sprite, base: ArrayLike<number>, tm: TileMap, i: number, kindAt: (i: number) => string, T: number, deep: boolean) {
  const { cols, rows } = tm;
  const cx = i % cols, cy = Math.floor(i / cols);
  const open = (dx: number, dy: number) => {
    const x = cx + dx, y = cy + dy;
    if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
    const k = kindAt(y * cols + x);
    return k === "grass" || k === "sand" || k === "snow";
  };
  const sides: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];
  for (const [dx, dy] of sides) {
    if (!open(dx, dy)) continue;
    for (let t = 0; t < T; t++) {
      const x = dx === 0 ? t : dx < 0 ? 0 : T - 1, y = dy === 0 ? t : dy < 0 ? 0 : T - 1;
      const x2 = dx === 0 ? t : dx < 0 ? 1 : T - 2, y2 = dy === 0 ? t : dy < 0 ? 1 : T - 2;
      // every other pixel along the border, so it frays instead of drawing a line
      if (t % 2 === 0 && isGround(sp, x, y)) sp.data[y * T + x] = shift(base[y * T + x], -1, deep);
      else if (t % 3 === 1 && isGround(sp, x2, y2)) sp.data[y2 * T + x2] = shift(base[y2 * T + x2], 1, deep);
    }
  }
}

function openDecal(sp: Sprite, base: Uint8Array | number[], kind: string, r: ReturnType<typeof rng>, s: number, deep: boolean) {
  const x = r.int(2, sp.w - 3 - s), y = r.int(3 + s, sp.h - 3);
  const roll = r.next();
  const lift = (px: number, py: number, d: number) => {
    if (px < 1 || py < 1 || px >= sp.w - 1 || py >= sp.h - 1 || !isGround(sp, px, py)) return;
    sp.data[py * sp.w + px] = shift(base[py * sp.w + px], d, deep);
  };
  if (kind === "grass") {
    if (roll < 0.45) {
      // soft tuft: blades one step lighter, a one-step shadow under them
      const h = 1 + s;
      for (let k = 0; k < h; k++) lift(x, y - k, 1);
      lift(x - 1, y - 1, 1);
      lift(x + 1, y - h + 1, 1);
      lift(x, y + 1, -1);
    } else if (roll < 0.75) {
      // clover patch: a small plus of the lighter shade with a bright heart
      lift(x, y, 1); lift(x - 1, y, 1); lift(x + 1, y, 1); lift(x, y - 1, 1); lift(x, y + 1, 1);
    } else if (roll < 0.9) pebble(sp, x, y, s);
    else petal(sp, r, s);
  } else if (kind === "dirt") {
    if (roll < 0.6) pebble(sp, x, y, s);
    else for (let k = 0; k < 2 + s; k++) lift(x + k, y + (k % 2), -1);
  } else if (kind === "sand") {
    if (roll < 0.5) pebble(sp, x, y, s);
    else { lift(x, y, -1); lift(x + 1, y, -1); lift(x, y - 1, 1); }
  } else {
    lift(x, y, 1);
    lift(x + 1, y + 1, -1);
  }
}

function petal(sp: Sprite, r: ReturnType<typeof rng>, s: number) {
  const x = r.int(2, sp.w - 3 - s), y = r.int(2, sp.h - 3);
  const m = (["cloth2", "gold", "accent", "ui"] as Material[])[r.int(0, 3)];
  dot(sp, x, y, m, m === "ui" ? 4 : 3);
  if (s > 1) dot(sp, x + 1, y, m, m === "ui" ? 3 : 4);
}

/** Straw: a short pale stalk (gold) with a darker sand fleck. */
function hay(sp: Sprite, r: ReturnType<typeof rng>, s: number) {
  const x = r.int(2, sp.w - 4 - s), y = r.int(2, sp.h - 3);
  const len = 2 + s;
  for (let k = 0; k < len; k++) dot(sp, x + k, y - (k > 1 ? 1 : 0), "gold", k === 0 ? 2 : 3);
  dot(sp, x + 1, y + 1, "sand", 1);
}

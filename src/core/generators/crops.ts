import { finalize } from "../enforce";
import { Painter } from "../painter";
import type { Material } from "../palette";
import { rng, type Rng } from "../rng";
import type { FrameSet, Sprite, StyleKit } from "../types";
import { num, str, type Generator, type Params } from "./types";

export const CROP_SPECIES = ["wheat", "corn", "carrot", "cabbage", "tomato", "pumpkin", "strawberry", "rice", "sunflower"] as const;
export const CROP_STAGES = ["seed", "sprout", "growing", "ready", "withered"] as const;
export type CropSpecies = (typeof CROP_SPECIES)[number];
export type CropStage = (typeof CROP_STAGES)[number];

const SWAY = [0, 1, 0, -1];

/** Species that rise above the tile at a given stage (canvas 1.5 tiles tall, bottom-anchored like trees). */
export function cropIsTall(species: CropSpecies, stage: CropStage): boolean {
  if (species === "corn" || species === "sunflower") return stage === "growing" || stage === "ready" || stage === "withered";
  if (species === "wheat") return stage === "ready";
  return false;
}

/**
 * Drawing context. All coordinates are in a 16-unit tile (the canvas is 16 or 24 units tall) and are
 * scaled to the kit tile size, so one description serves 16, 24 and 32 px tiles.
 */
class Ctx {
  readonly gy: number;
  constructor(readonly p: Painter, readonly k: number, readonly H: number, private amp: number, readonly dry: boolean, readonly r: Rng) {
    this.gy = H - 4.5;
  }
  /** Horizontal sway at height y: nothing at the soil, full at the top. */
  sw(y: number) { return (this.amp * Math.max(0, this.gy - y)) / (this.H > 16 ? 12 : 8); }
  ell(cx: number, cy: number, rx: number, ry: number, m: Material, tone = 0, sway = true) {
    const x = cx + (sway ? this.sw(cy) : 0);
    this.p.ellipse(x * this.k, cy * this.k, rx * this.k, ry * this.k, m, { tone });
  }
  /** Stem or blade from a rooted base to a swaying tip. */
  cap(ax: number, ay: number, bx: number, by: number, rad: number, m: Material, tone = 0) {
    this.p.capsule((ax + this.sw(ay)) * this.k, ay * this.k, (bx + this.sw(by)) * this.k, by * this.k, rad * this.k, m, { tone });
  }
  dot(x: number, y: number, m: Material, lvl: number) {
    this.p.px(Math.floor((x + this.sw(y)) * this.k), Math.floor(y * this.k), m, lvl);
  }
  /** Green, or dry straw when withered. */
  leaf(m: Material = "foliage"): Material { return this.dry ? "sand" : m; }
  mound() {
    this.p.ellipse(8 * this.k, (this.gy + 0.5) * this.k, 5.8 * this.k, 2.2 * this.k, "dirt", { tone: -1 });
    this.p.ellipse(7.2 * this.k, (this.gy + 0.2) * this.k, 3.2 * this.k, 1.2 * this.k, "dirt", { tone: 0 });
  }
}

type Draw = (c: Ctx, stage: CropStage) => void;

const si = (stage: CropStage) => CROP_STAGES.indexOf(stage);
const rise = (stage: CropStage) => (stage === "sprout" ? 0 : stage === "growing" ? 1 : 2);

/** Rows of thin stalks with a head (wheat, rice). */
function stalks(c: Ctx, n: number, x0: number, x1: number, h: number, jitter: number, m: Material, head: (x: number, y: number, lean: number) => void, bend = 0) {
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * i) / Math.max(1, n - 1) + (c.r.next() - 0.5) * 0.8;
    const top = c.gy - h + (i % 2) * jitter + c.r.next() * 0.8;
    const lean = (i - (n - 1) / 2) * 0.35 + bend;
    c.cap(x, c.gy, x + lean, top, 0.55, m, i % 2 ? -1 : 0);
    head(x + lean, top, lean);
  }
}

const wheat: Draw = (c, stage) => {
  const n = [0, 3, 4, 5, 4][si(stage)];
  const h = [0, 4.5, 8, 11.5, 6][si(stage)];
  const dry = stage === "withered";
  stalks(c, n, 5.4, 10, h, 1.6, c.leaf("grass"), (x, y, lean) => {
    if (stage === "ready" || dry) {
      const m: Material = dry ? "leather" : "gold";
      c.cap(x, y + 0.4, x + lean * 0.4 + (dry ? 1.2 : 0), y - 3, 0.8, m, dry ? 0 : 1);
      c.dot(x + (dry ? 1.2 : 0.2), y - 3.6, m, 4);
    }
  }, dry ? 0.5 : 0);
};

const rice: Draw = (c, stage) => {
  const n = [0, 4, 6, 6, 5][si(stage)];
  const h = [0, 3.5, 6.5, 8.5, 6][si(stage)];
  const dry = stage === "withered";
  stalks(c, n, 5, 10, h, 1, c.leaf("grass"), (x, y) => {
    if (stage === "ready" || dry) {
      const m: Material = dry ? "leather" : "gold";
      // grain panicle arching over under its own weight
      c.cap(x, y, x + 1.6, y + 0.4, 0.8, m, 0);
      c.cap(x + 1.6, y + 0.4, x + 2, y + 3, 0.7, m, -1);
    }
  }, stage === "ready" ? -0.2 : 0);
  if (!dry) { c.dot(4, c.gy + 1, "water", 3); c.dot(11.5, c.gy + 1.4, "water", 3); }
};

const corn: Draw = (c, stage) => {
  const r = rise(stage);
  const dry = stage === "withered";
  const top = c.gy - [0, 5, 10, 14.5, 10][si(stage)];
  const bend = dry ? 1.5 : 0;
  c.cap(8, c.gy + 0.5, 8 + bend, top, 1.0, dry ? "leather" : "foliage", 0);
  const blades = r === 0 ? 1 : r === 1 ? 2 : 3;
  for (let i = 0; i < blades; i++) {
    const y = c.gy - 2 - i * 3.6;
    const dir = i % 2 ? 1 : -1;
    c.cap(8, y, 8 + dir * (dry ? 3.2 : 4.2), y + (dry ? 2.5 : -2.2), 0.8, c.leaf("grass"), i % 2 ? 0 : 1);
    if (r > 0) c.cap(8, y - 1.8, 8 - dir * 3.4, y + (dry ? -0.3 : -3.6), 0.7, c.leaf("foliage"), -1);
  }
  if (stage === "ready") {
    c.ell(10.2, c.gy - 8.6, 1.5, 2.9, "gold", 0);
    c.ell(5.8, c.gy - 5.4, 1.4, 2.6, "gold", 0);
    c.cap(8, top, 8, top - 2.5, 0.5, "sand", 1); // tassel
    c.cap(8, top, 6.5, top - 1.4, 0.4, "sand", 1);
  } else if (stage === "growing") c.cap(8, top, 8, top - 1.5, 0.5, "grass", 1);
  else if (dry) c.cap(8 + bend, top, 8 + bend + 1.8, top + 2, 0.5, "sand", -1);
};

const sunflower: Draw = (c, stage) => {
  const dry = stage === "withered";
  const top = c.gy - [0, 5, 8.5, 10.5, 8][si(stage)];
  const bend = dry ? 0.8 : 0;
  c.cap(8, c.gy + 0.5, 8 + bend, top, 0.95, dry ? "leather" : "foliage", 0);
  const pairs = rise(stage) === 0 ? 1 : 2;
  for (let i = 0; i < pairs; i++) {
    const y = c.gy - 2.5 - i * 4;
    c.ell(5.2, y + (dry ? 1 : -0.8), 2.4, 1.3, c.leaf("foliage"), 0);
    c.ell(10.8, y + (dry ? 0.5 : -0.2), 2.4, 1.3, c.leaf("grass"), -1);
  }
  if (stage === "growing") c.ell(8, top - 0.6, 1.9, 1.9, "foliage", 1);
  if (stage === "ready") {
    c.ell(8, top - 1.4, 4.8, 4.8, "gold", 1);
    c.ell(8, top - 1.4, 3.3, 3.3, "gold", -1);
    c.ell(8, top - 1.4, 2.5, 2.5, "leather", -1);
  }
  if (dry) {
    c.ell(8 + bend + 1, top + 1.2, 3.2, 3.2, "leather", -1);
    c.ell(8 + bend + 1, top + 1.4, 2.2, 2.2, "wood", -1);
  }
};

const carrot: Draw = (c, stage) => {
  const r = rise(stage);
  const dry = stage === "withered";
  const fronds = stage === "sprout" ? 2 : stage === "growing" ? 4 : 5;
  const len = stage === "sprout" ? 4 : stage === "growing" ? 6.5 : 8;
  if (stage === "ready") c.ell(8, c.gy - 0.2, 2.5, 2.2, "cloth2", 1);
  for (let i = 0; i < fronds; i++) {
    const t = i / (fronds - 1) - 0.5;
    const l = len - Math.abs(t) * 3;
    const tipx = 8 + t * (dry ? 10 : 7.5);
    c.cap(8, c.gy - 0.5, tipx, c.gy - (dry ? l * 0.45 : l), 0.6, dry ? "leather" : i % 2 ? "grass" : "foliage", i % 2 ? 0 : -1);
    if (!dry && r > 0) c.ell(tipx, c.gy - l - 0.2, 1.1, 1.1, "grass", 1);
  }
  if (stage === "ready") c.dot(7, c.gy - 0.8, "cloth2", 4);
};

const cabbage: Draw = (c, stage) => {
  const dry = stage === "withered";
  const rr = [0, 2.3, 3.6, 4.4, 3.8][si(stage)];
  if (stage === "sprout") {
    c.ell(6.2, c.gy - 1.4, 1.8, 1.2, "grass", 0);
    c.ell(9.8, c.gy - 1.4, 1.8, 1.2, "foliage", 0);
    return;
  }
  c.ell(8, c.gy - rr * 0.65, rr, rr * 0.82, dry ? "leather" : "foliage", dry ? 0 : -1);
  if (!dry) {
    c.ell(8, c.gy - rr * 0.8, rr * 0.7, rr * 0.62, "grass", 0);
    if (stage === "ready") {
      c.ell(8.3, c.gy - rr * 0.9, rr * 0.4, rr * 0.35, "grass", 2);
      c.p.line(5.8 * c.k, (c.gy - 3.6) * c.k, 7.4 * c.k, (c.gy - 5.2) * c.k, "foliage", 4);
    }
    c.ell(8 - rr * 0.95, c.gy - 0.8, rr * 0.4, 1, "foliage", -1);
    c.ell(8 + rr * 0.95, c.gy - 0.8, rr * 0.4, 1, "foliage", -1);
  } else {
    c.ell(8, c.gy - rr * 0.8, rr * 0.55, rr * 0.45, "sand", -1);
  }
};

const tomato: Draw = (c, stage) => {
  const dry = stage === "withered";
  const h = [0, 3.5, 6.5, 7.5, 6][si(stage)];
  if (stage === "sprout") {
    c.ell(6.3, c.gy - 1.6, 1.8, 1.1, "grass", 0);
    c.ell(9.7, c.gy - 2, 1.8, 1.1, "foliage", 0);
    return;
  }
  c.cap(8, c.gy + 0.4, 8, c.gy - h - 1, 0.55, "wood", 0); // stake
  const clumps: [number, number, number][] = [[8, h * 0.78, 3.4], [5.4, h * 0.45, 2.7], [10.8, h * 0.4, 2.8], [8, h * 0.18, 3.3]];
  for (const [x, y, rad] of clumps) c.ell(x, c.gy - y, rad, rad * 0.8, dry ? "sand" : "foliage", dry ? -1 : 0);
  if (!dry) c.ell(7.4, c.gy - h * 0.84, 1.8, 1.4, "grass", 1);
  if (stage === "growing") { c.dot(5, c.gy - h * 0.5, "gold", 3); c.dot(11, c.gy - h * 0.6, "gold", 3); c.ell(6.5, c.gy - 2.4, 0.9, 0.9, "grass", 1); }
  if (stage === "ready") {
    for (const [x, y] of [[5.2, 3.6], [10.8, 5.4], [7.4, 6.6], [9.6, 2.2]]) {
      c.ell(x, c.gy - y, 1.6, 1.6, "cloth2", 0);
      c.dot(x - 0.6, c.gy - y - 0.9, "cloth2", 4);
    }
  }
  if (dry) {
    c.ell(5.6, c.gy - 2.2, 1.3, 1.3, "leather", -1);
    c.ell(10.6, c.gy - 4.5, 1.2, 1.2, "leather", -1);
  }
};

const pumpkin: Draw = (c, stage) => {
  const dry = stage === "withered";
  const lw = [0, 1.7, 2.8, 3.1, 2.8][si(stage)];
  if (stage === "sprout") {
    c.ell(6.3, c.gy - 1.4, 1.9, 1.2, "grass", 0);
    c.ell(9.7, c.gy - 1.8, 1.9, 1.2, "foliage", 0);
    return;
  }
  c.p.line(3.2 * c.k, (c.gy - 0.8) * c.k, 12.8 * c.k, (c.gy - 1.3) * c.k, dry ? "leather" : "grass", 1);
  c.ell(5.2, c.gy - 2.4, lw, lw * 0.75, c.leaf("foliage"), 0);
  c.ell(10.8, c.gy - 2.8, lw, lw * 0.75, c.leaf("grass"), -1);
  if (stage === "growing") {
    c.ell(8, c.gy - 2.2, 2.2, 2, "grass", 1);
    c.dot(11.5, c.gy - 6, "gold", 4); c.dot(12.5, c.gy - 6, "gold", 3);
  }
  if (stage === "ready") {
    c.ell(8, c.gy - 3.2, 4.5, 3.4, "gold", -1);
    c.ell(8, c.gy - 3.4, 3.1, 3.6, "gold", 0);
    c.ell(5.8, c.gy - 3.3, 2.3, 3.2, "gold", -1);
    c.p.line(8 * c.k, (c.gy - 6.4) * c.k, 8 * c.k, (c.gy - 1.2) * c.k, "gold", 1);
    c.cap(8, c.gy - 6.6, 8.4, c.gy - 8.6, 0.8, "leather", 0);
  }
  if (dry) {
    c.ell(8, c.gy - 2, 3.2, 2.2, "leather", -1);
    c.ell(7.6, c.gy - 2.2, 1.6, 1.5, "wood", -1);
  }
};

const strawberry: Draw = (c, stage) => {
  const dry = stage === "withered";
  if (stage === "sprout") {
    c.ell(6.5, c.gy - 1.5, 1.7, 1.2, "grass", 0);
    c.ell(9.5, c.gy - 1.5, 1.7, 1.2, "foliage", 0);
    c.dot(8, c.gy - 2.3, "grass", 4);
    return;
  }
  const sizes = stage === "growing" ? 1 : 1.25;
  const lobes: [number, number, number, Material, number][] = [[5.4, 1.6, 2.8, "foliage", -1], [10.6, 1.6, 2.8, "grass", -1], [8, 3.2, 3.2, "grass", 0], [4.6, 3.6, 1.9, "foliage", 0], [11.4, 3.8, 1.9, "foliage", 0]];
  for (const [x, y, rad, m, t] of lobes) c.ell(x, c.gy - y * sizes, rad * (stage === "growing" ? 0.85 : 1), rad * 0.72, c.leaf(m), t);
  if (stage === "growing") for (const [x, y] of [[6.3, 4.4], [10.2, 3.6]]) c.dot(x, c.gy - y, "ui", 4);
  if (stage === "ready") {
    for (const [x, y] of [[4.4, 0.4], [11.6, 0.6], [8, -0.1]] as const) {
      c.ell(x, c.gy + y, 1.7, 1.9, "cloth2", 0);
      c.dot(x - 0.7, c.gy + y - 1, "cloth2", 4);
      c.dot(x + 0.4, c.gy + y + 0.2, "gold", 3);
    }
    c.ell(6.2, c.gy - 3.2, 1.2, 1.2, "cloth2", 0);
  }
  if (dry) for (const [x, y] of [[5, 1], [11, 1.4]] as const) c.ell(x, c.gy - y, 1.2, 1.2, "leather", -1);
};

const DRAW: Record<CropSpecies, Draw> = { wheat, corn, carrot, cabbage, tomato, pumpkin, strawberry, rice, sunflower };

function seedStage(c: Ctx, species: CropSpecies) {
  // a few seeds in a ridge of turned earth; the seed colour hints at the species
  const seedMat: Material = species === "strawberry" || species === "tomato" ? "cloth2" : species === "sunflower" || species === "pumpkin" ? "ui" : "sand";
  for (const [x, y] of [[5.4, 0.3], [8.2, -0.4], [10.8, 0.5]] as const) {
    c.p.px(Math.floor(x * c.k), Math.floor((c.gy + y) * c.k), seedMat, 4);
    if (c.k > 1) c.p.px(Math.floor(x * c.k) + 1, Math.floor((c.gy + y) * c.k), seedMat, 3);
  }
  c.p.line(4.2 * c.k, (c.gy + 1.6) * c.k, 11.8 * c.k, (c.gy + 1.4) * c.k, "dirt", 4);
}

function render(species: CropSpecies, stage: CropStage, kit: StyleKit, seed: number, variant: number, sway: number): Sprite {
  const T = kit.sizes.tile, k = T / 16;
  const H = cropIsTall(species, stage) ? 24 : 16;
  const p = new Painter(T, Math.round(H * k), kit);
  const c = new Ctx(p, k, H, sway * 1.2, stage === "withered", rng(seed * 7919 + variant * 104729 + 1));
  c.mound();
  if (stage === "seed") seedStage(c, species);
  else DRAW[species](c, stage);
  return finalize(p.toSprite(), kit);
}

export const cropsGenerator: Generator = {
  id: "crop",
  category: "environment",
  label: "Crops (growth stages)",
  description:
    "Top-down farm crops on a one-tile footprint with growth stages. Species wheat, corn, carrot, cabbage, tomato, pumpkin, strawberry, rice, sunflower; stage seed, sprout, growing, ready (harvestable produce) or withered. Corn, sunflower and ripe wheat rise above the tile (bottom-anchored). Rows: idle, sway.",
  params: [
    { key: "species", label: "Species", type: "select", options: [...CROP_SPECIES], default: "wheat" },
    { key: "stage", label: "Growth stage", type: "select", options: [...CROP_STAGES], default: "ready" },
    { key: "variant", label: "Variant", type: "number", min: 0, max: 9, step: 1, default: 0 },
  ],
  generate(p: Params, kit: StyleKit, seed: number) {
    const species = str(p, "species") as CropSpecies;
    const stage = str(p, "stage") as CropStage;
    const variant = num(p, "variant");
    const idle = render(species, stage, kit, seed, variant, 0);
    const sway = SWAY.map((s) => render(species, stage, kit, seed, variant, s));
    const rows: FrameSet[] = [{ name: "idle", frames: [idle] }, { name: "sway", frames: sway }];
    return { rows, fps: 4 };
  },
};

export interface CropFieldCell { x: number; y: number; species?: CropSpecies; stage?: CropStage; variant?: number; irrigation?: boolean }
export interface CropFieldOpts {
  seed?: number;
  /** Cells per row when `cells` is a count (default 6). */
  cols?: number;
  /** Edge that carries an irrigation channel (cells with `irrigation: true` and no crop). */
  channel?: "none" | "top" | "bottom" | "left" | "right";
  /** Relative weight of each base stage per row, seed to withered. Default favours growing and ready. */
  mix?: number[];
}

/**
 * Lay a field out in rows. `cells` is a count (laid out `opts.cols` wide) or {cols, rows}. Each row is one
 * species at one base growth stage with the odd cell a stage ahead or behind, as farmed rows look.
 * `species` is one name or a list cycled per row. Pure and deterministic in `opts.seed`.
 */
export function cropField(cells: number | { cols: number; rows: number }, species: CropSpecies | readonly CropSpecies[], opts: CropFieldOpts = {}): CropFieldCell[] {
  const r = rng(opts.seed ?? 1);
  const cols = typeof cells === "number" ? Math.max(1, Math.min(cells, opts.cols ?? 6)) : cells.cols;
  const total = typeof cells === "number" ? cells : cells.cols * cells.rows;
  const rows = typeof cells === "number" ? Math.ceil(total / cols) : cells.rows;
  const list: readonly CropSpecies[] = typeof species === "string" ? [species] : species;
  const mix = opts.mix ?? [1, 2, 4, 5, 0.4];
  const sum = mix.reduce((a, b) => a + b, 0);
  const channel = opts.channel ?? "none";
  const out: CropFieldCell[] = [];
  let n = 0;
  for (let y = 0; y < rows; y++) {
    let t = r.next() * sum, base = 0;
    for (let i = 0; i < mix.length; i++) { t -= mix[i]; if (t <= 0) { base = i; break; } }
    const sp = list[y % list.length];
    for (let x = 0; x < cols && n < total; x++, n++) {
      const edge = (channel === "top" && y === 0) || (channel === "bottom" && y === rows - 1) || (channel === "left" && x === 0) || (channel === "right" && x === cols - 1);
      if (edge) { out.push({ x, y, irrigation: true }); continue; }
      const drift = r.chance(0.18) ? (r.chance(0.5) ? 1 : -1) : 0;
      const stage = CROP_STAGES[Math.max(0, Math.min(CROP_STAGES.length - 1, base + drift))];
      out.push({ x, y, species: sp, stage, variant: r.int(0, 3) });
    }
  }
  return out;
}

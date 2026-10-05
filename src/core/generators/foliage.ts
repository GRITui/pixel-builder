import { finalize } from "../enforce";
import { Painter } from "../painter";
import { colorIndex, decodeIndex, type Material } from "../palette";
import { rng, type Rng } from "../rng";
import type { FrameSet, Sprite, StyleKit } from "../types";
import { num, str, mat, type Generator, type Params } from "./types";

export const FOLIAGE_SPECIES = ["oak", "willow", "maple-autumn", "birch", "fruit-tree", "pine-hd", "sakura"] as const;
export const FOLIAGE_SIZES = ["small", "medium", "large"] as const;
export const FOLIAGE_SEASONS = ["spring", "summer", "fall", "winter"] as const;
export const FOLIAGE_PX: Record<string, number> = { small: 48, medium: 64, large: 96 };
const SWAY_FRAMES = 4;

type Species = (typeof FOLIAGE_SPECIES)[number];
type Season = (typeof FOLIAGE_SEASONS)[number];

interface Lobe { dx: number; dy: number; r: number; tone: number }
interface Cluster {
  x: number; y: number; r: number; z: number; tone: number; mat: Material;
  lobes: Lobe[]; phase: number; weight: number;
  tufts: { dx: number; dy: number }[];
  glints: { dx: number; dy: number }[];
  fruit?: { dx: number; dy: number };
  flat: number; // 1 = round blob, <1 = flattened (pine skirts)
}
interface Branch { ax: number; ay: number; bx: number; by: number; r: number; to: number }
interface Strand { x: number; len: number; phase: number; dark: boolean }
interface Model {
  W: number; G: number; cx: number;
  core: { x: number; y: number; rx: number; ry: number } | null;
  trunk: { w: number; top: number; lean: number; mat: Material; birch: boolean; flare: number };
  clusters: Cluster[]; branches: Branch[]; strands: Strand[];
  mats: Material[]; leaf: Material; fruit: Material | null; snow: boolean; evergreen: boolean;
  particles: { x: number; y: number; ph: number; mat: Material }[];
  holes: { x: number; y: number }[];
}

/** Per species and season: which materials paint the crown and what dusts it. */
interface Tint { main: Material; alt: Material; deep: Material; sparse: boolean; snow: boolean; specks?: { mat: Material; chance: number } }

function tint(species: Species, season: Season, leaf: Material): Tint {
  const alt: Material = leaf === "foliage" ? "grass" : leaf;
  const winter = season === "winter";
  if (species === "pine-hd") return { main: leaf, alt: leaf === "foliage" ? "foliage" : leaf, deep: leaf, sparse: false, snow: winter };
  if (species === "sakura") {
    if (winter) return { main: "ui", alt: "stone", deep: "wood", sparse: true, snow: true };
    if (season === "fall") return { main: "cloth2", alt: "gold", deep: "roof", sparse: false, snow: false };
    if (season === "spring") return { main: "blossom", alt: "blossom", deep: "blossom", sparse: false, snow: false, specks: { mat: "ui", chance: 0.3 } };
    return { main: "blossom", alt: "blossom", deep: "blossom", sparse: false, snow: false, specks: { mat: "ui", chance: 0.25 } };
  }
  if (species === "maple-autumn") {
    if (winter) return { main: "ui", alt: "stone", deep: "wood", sparse: true, snow: true };
    if (season === "spring") return { main: alt, alt: "gold", deep: leaf, sparse: false, snow: false, specks: { mat: "roof", chance: 0.18 } };
    if (season === "summer") return { main: "cloth2", alt: "gold", deep: "roof", sparse: false, snow: false, specks: { mat: leaf, chance: 0.15 } };
    return { main: "cloth2", alt: "gold", deep: "roof", sparse: false, snow: false, specks: { mat: "roof", chance: 0.2 } };
  }
  if (winter) return { main: "ui", alt: "stone", deep: "wood", sparse: true, snow: true };
  if (season === "fall") return { main: "gold", alt: "cloth2", deep: "roof", sparse: false, snow: false, specks: { mat: "leather", chance: 0.15 } };
  if (season === "spring") return { main: alt, alt: leaf, deep: leaf, sparse: false, snow: false, specks: { mat: species === "birch" ? "gold" : "skin", chance: 0.22 } };
  return { main: leaf, alt, deep: leaf, sparse: false, snow: false };
}

interface Spec {
  core: [number, number, number, number]; // cx, cy, rx, ry as fractions of the canvas
  trunkW: number; trunkTop: number; n: [number, number, number]; rK: number; lean: number; branches: number;
}
const SPECS: Record<Exclude<Species, "pine-hd">, Spec> = {
  oak: { core: [0.5, 0.35, 0.44, 0.29], trunkW: 0.13, trunkTop: 0.56, n: [14, 24, 38], rK: 1.45, lean: 0.01, branches: 5 },
  "fruit-tree": { core: [0.5, 0.38, 0.37, 0.27], trunkW: 0.1, trunkTop: 0.6, n: [12, 20, 30], rK: 1.45, lean: -0.01, branches: 4 },
  "maple-autumn": { core: [0.5, 0.36, 0.4, 0.3], trunkW: 0.1, trunkTop: 0.58, n: [14, 24, 36], rK: 1.35, lean: 0.015, branches: 5 },
  birch: { core: [0.5, 0.34, 0.3, 0.31], trunkW: 0.08, trunkTop: 0.5, n: [12, 22, 34], rK: 1.35, lean: -0.02, branches: 4 },
  sakura: { core: [0.5, 0.34, 0.46, 0.25], trunkW: 0.095, trunkTop: 0.54, n: [14, 26, 38], rK: 1.4, lean: 0.045, branches: 6 },
  willow: { core: [0.5, 0.3, 0.4, 0.2], trunkW: 0.12, trunkTop: 0.42, n: [12, 20, 30], rK: 1.4, lean: -0.02, branches: 5 },
};

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function makeLobes(r: Rng, rad: number, spiky: boolean): Lobe[] {
  const count = rad > 3.5 ? (spiky ? 4 : 3) : 2;
  const lobes: Lobe[] = [];
  for (let i = 0; i < count; i++) {
    const a = i < 2 ? Math.PI * (1.1 + 0.8 * r.next()) : Math.PI * 2 * r.next();
    const d = rad * (0.5 + 0.25 * r.next());
    lobes.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d * 0.9, r: rad * (spiky ? 0.45 : 0.5) * (0.9 + 0.3 * r.next()), tone: r.chance(0.3) ? 1 : 0 });
  }
  return lobes;
}

/** Best-candidate sampling: evenly spread points that still crowd the crown edge. */
function scatter(r: Rng, n: number, ell: { x: number; y: number; rx: number; ry: number }): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    let best: [number, number] = [ell.x, ell.y], bestD = -1;
    for (let k = 0; k < 14; k++) {
      const a = r.next() * Math.PI * 2, d = Math.pow(r.next(), 0.42);
      const p: [number, number] = [ell.x + Math.cos(a) * d * ell.rx, ell.y + Math.sin(a) * d * ell.ry];
      const md = pts.reduce((m, q) => Math.min(m, Math.hypot(p[0] - q[0], p[1] - q[1])), 99);
      if (md > bestD) { bestD = md; best = p; }
    }
    pts.push(best);
  }
  return pts;
}

function buildModel(species: Species, W: number, sizeIdx: number, season: Season, leaf: Material, fruitMat: Material, seed: number, variant: number): Model {
  const r = rng(seed * 7919 + variant * 104729 + FOLIAGE_SPECIES.indexOf(species) * 31 + 5);
  const t = tint(species, season, leaf);
  const G = W - 5;
  const cx = W / 2;
  const clusters: Cluster[] = [];
  const mats = [...new Set<Material>([t.main, t.alt, t.deep, ...(t.specks ? [t.specks.mat] : [])])];
  const mk = (x: number, y: number, rad: number, z: number, tone: number, m: Material, flat = 1): Cluster => ({
    x, y, r: rad, z, tone, mat: m, flat, phase: r.next() * Math.PI * 2, weight: 1,
    lobes: makeLobes(r, rad, species === "maple-autumn"),
    tufts: [], glints: [],
  });
  const model: Model = {
    W, G, cx, core: null,
    trunk: { w: 0, top: 0, lean: 0, mat: species === "birch" ? "stone" : "wood", birch: species === "birch", flare: 0.8 },
    clusters, branches: [], strands: [], mats, leaf: t.main, fruit: species === "fruit-tree" ? fruitMat : null,
    snow: t.snow, evergreen: species === "pine-hd", particles: [], holes: [],
  };

  if (species === "pine-hd") {
    const tiers = [4, 5, 7][sizeIdx];
    const tw = Math.max(3, Math.round(W * 0.09));
    model.trunk = { ...model.trunk, w: tw, top: Math.round(W * 0.5), lean: 0, flare: 0.7 };
    const top = W * 0.07, bottom = W * 0.82;
    const rad = W * [0.075, 0.07, 0.065][sizeIdx];
    for (let i = tiers - 1; i >= 0; i--) {
      const f = i / (tiers - 1);
      const hw = W * (0.1 + 0.33 * Math.pow(f, 0.85));
      const yc = top + (bottom - top) * (0.1 + 0.9 * f) - rad * 0.4;
      const m = Math.max(2, Math.round((hw * 2) / (rad * 1.25)));
      for (let j = 0; j < m; j++) {
        const u = m === 1 ? 0 : (j / (m - 1)) * 2 - 1;
        const x = cx + u * (hw - rad * 0.6) + (r.next() - 0.5) * rad * 0.4;
        const y = yc + Math.abs(u) * rad * 0.9 + (r.next() - 0.5) * rad * 0.35;
        const c = mk(x, y, rad * (1 - 0.18 * Math.abs(u)) * (0.9 + 0.2 * r.next()), 1 - f, clamp(Math.round(1.2 - 1.4 * f + (u < 0 ? 0.4 : -0.2) * 0), -1, 1), r.chance(0.15) ? t.alt : t.main, 0.8);
        c.weight = 0.4 + 0.9 * (1 - f);
        clusters.push(c);
      }
      // tiers drawn bottom first
    }
    model.core = null;
  } else {
    const sp = SPECS[species];
    const [fx, fy, frx, fry] = sp.core;
    const core = { x: fx * W, y: fy * W, rx: frx * W, ry: fry * W };
    model.core = core;
    let n = sp.n[sizeIdx];
    if (t.sparse) n = Math.max(8, Math.round(n * 0.3));
    const area = Math.PI * core.rx * core.ry;
    const baseR = sp.rK * (t.sparse ? 0.55 : 1) * Math.sqrt(area / (n * Math.PI));
    const pts = scatter(r, n, core);
    const trunkW = Math.max(3, Math.round(sp.trunkW * W));
    model.trunk = { ...model.trunk, w: trunkW, top: Math.round(sp.trunkTop * W), lean: sp.lean * W, flare: species === "birch" ? 0.45 : 0.85 };
    for (const [px, py] of pts) {
      const rad = baseR * (0.78 + 0.45 * r.next());
      const x = clamp(px, 3 + rad * 1.5, W - 4 - rad * 1.5), y = clamp(py, 3 + rad * 1.5, G - rad);
      const ny = (y - core.y) / core.ry, nx = Math.abs(x - core.x) / core.rx;
      const z = clamp(0.5 + ny * 0.32 - nx * 0.12 + (r.next() - 0.5) * 0.45, 0, 1);
      const zt = z < 0.28 ? -2 : z < 0.52 ? -1 : z < 0.8 ? 0 : 1;
      const ht = ny < -0.35 ? 1 : ny > 0.55 ? -1 : 0;
      const top = ny < -0.2 && r.chance(0.5);
      const m = r.chance(top ? 0.38 : 0.12) ? t.alt : t.main;
      const c = mk(x, y, rad, z, clamp(zt + ht, -2, 1), m);
      c.weight = clamp(1 - (y / G) * 0.5, 0.35, 1);
      clusters.push(c);
    }
    // willow: lower the outer clusters so the crown drapes
    if (species === "willow") for (const c of clusters) if (Math.abs(c.x - core.x) > core.rx * 0.5) c.y += core.ry * 0.5 * (Math.abs(c.x - core.x) / core.rx);
    // the trunk forks into limbs that reach clusters on the way out
    const sorted = [...clusters.keys()].sort((a, b) => clusters[b].y - clusters[a].y);
    const fork = { x: cx + model.trunk.lean, y: model.trunk.top };
    const picks = sorted.slice(0, Math.min(sorted.length, sp.branches * 2 + 6)).filter((_, i) => t.sparse || i % 2 === 0).slice(0, t.sparse ? sp.branches * 2 : sp.branches);
    picks.sort((a, b) => clusters[a].x - clusters[b].x);
    for (const i of picks) {
      const c = clusters[i];
      model.branches.push({ ax: fork.x, ay: fork.y + 1, bx: c.x, by: c.y + c.r * 0.5, r: Math.max(0.9, trunkW * (t.sparse ? 0.2 : 0.17)), to: i });
    }
    // dark pockets between clusters where the crown is deep
    const holeN = t.sparse ? 0 : Math.round(n / 4);
    for (let i = 0; i < holeN; i++) {
      const a = r.next() * Math.PI * 2, d = Math.sqrt(r.next()) * 0.7;
      model.holes.push({ x: core.x + Math.cos(a) * d * core.rx, y: core.y + Math.sin(a) * d * core.ry * 0.9 });
    }
    if (species === "willow") {
      const count = [9, 13, 20][sizeIdx];
      for (let i = 0; i < count; i++) {
        const u = (i + 0.5) / count;
        model.strands.push({ x: core.x - core.rx * 1.02 + u * core.rx * 2.04 + (r.next() - 0.5) * 1.2, len: W * (0.14 + 0.24 * Math.sin(Math.PI * u) * (0.6 + 0.5 * r.next())), phase: r.next() * 6.28, dark: r.chance(0.4) });
      }
    }
  }

  // surface detail that travels with each cluster
  for (const c of clusters) {
    const rad = c.r;
    if (rad > 3 && !model.evergreen) {
      const away = Math.atan2(c.y - (model.core?.y ?? c.y), c.x - (model.core?.x ?? c.x));
      for (let k = 0; k < 2; k++) if (r.chance(0.55)) {
        const a = away + (r.next() - 0.5) * 2.2;
        c.tufts.push({ dx: Math.cos(a) * rad * 0.95, dy: Math.sin(a) * rad * 0.95 });
      }
    }
    if (c.z > 0.4 && rad > 2.5) {
      const n = rad > 5 ? 2 : 1;
      for (let k = 0; k < n; k++) c.glints.push({ dx: (r.next() - 0.65) * rad * 0.9, dy: -rad * (0.2 + 0.4 * r.next()) });
    }
  }
  if (model.fruit) {
    const front = clusters.filter((c) => c.z > 0.45 && c.r > 3);
    const want = [6, 10, 16][sizeIdx];
    for (let i = 0; i < want && front.length; i++) {
      const c = front[r.int(0, front.length - 1)];
      if (!c.fruit) c.fruit = { dx: (r.next() - 0.5) * c.r * 1.1, dy: c.r * (0.05 + 0.35 * r.next()) };
    }
  }
  if (species === "maple-autumn" || species === "sakura") {
    const n = [3, 5, 8][sizeIdx];
    for (let i = 0; i < n; i++) model.particles.push({ x: W * (0.12 + 0.76 * r.next()), y: W * (0.25 + 0.2 * r.next()), ph: i / n, mat: i % 2 ? t.alt : t.main });
  }
  void t.deep;
  return model;
}

function drawTrunk(P: Painter, m: Model, r: Rng) {
  const { trunk: tr, G, cx, W } = m;
  const span = G - tr.top;
  const spec = tr.birch ? 0 : 1;
  const rows: { x0: number; w: number; y: number }[] = [];
  for (let y = tr.top; y <= G; y++) {
    const t = (G - y) / span; // 0 at the base
    const w = Math.max(2, Math.round(tr.w * (1 + tr.flare * Math.exp(-t * 7)) * (1 - 0.15 * t)));
    const center = cx + tr.lean * Math.sin(t * Math.PI * 0.9) * (spec ? 1 : 1.3);
    const x0 = Math.round(center - w / 2);
    rows.push({ x0, w, y });
    P.cylinder(x0, y, w, 1, tr.mat, { tone: tr.birch ? 0 : -1 });
  }
  // root flare: two buttresses that spread over the ground
  const base = rows[rows.length - 1];
  P.ellipse(base.x0 + 0.5, G - 0.8, Math.max(2, tr.w * 0.6), 1.7, tr.mat, { tone: -1 });
  P.ellipse(base.x0 + base.w - 0.5, G - 0.8, Math.max(2, tr.w * 0.6), 1.7, tr.mat, { tone: 0 });
  // bark: dark vertical furrows, a few highlights; birch gets horizontal dark marks instead
  if (tr.birch) {
    for (let y = tr.top + 2; y < G - 2; y += r.int(3, 5)) {
      const row = rows[y - tr.top];
      const x = row.x0 + r.int(0, Math.max(0, row.w - 2));
      P.rect(x, y, r.chance(0.6) ? 2 : 1, 1, "ink", r.chance(0.5) ? 1 : 2);
      if (r.chance(0.4)) P.px(x + 1, y + 1, "ink", 2);
    }
  } else {
    const streaks = Math.max(3, Math.round(tr.w * 1.1));
    for (let i = 0; i < streaks; i++) {
      const y = r.int(tr.top + 1, G - 4), row = rows[y - tr.top];
      const x = row.x0 + 1 + r.int(0, Math.max(0, row.w - 2));
      const len = r.int(2, Math.max(3, Math.round(W / 14)));
      for (let k = 0; k < len && y + k < G; k++) {
        const rw = rows[y + k - tr.top];
        if (x >= rw.x0 && x < rw.x0 + rw.w) P.px(x, y + k, tr.mat, 1);
      }
    }
    // lit-side highlight streak
    for (let i = 0; i < 2; i++) {
      const y = r.int(tr.top + 2, G - 6), row = rows[y - tr.top];
      const lit = P.lightSide > 0 ? row.x0 + row.w - 2 : row.x0 + 1;
      P.px(lit, y, tr.mat, 3);
      P.px(lit, y + 1, tr.mat, 3);
    }
  }
}

function drawCluster(P: Painter, c: Cluster, dx: number, dy: number, tone: number) {
  const x = c.x + dx, y = c.y + dy, ry = c.r * c.flat;
  // soft drop shadow on whatever sits behind (reads as overlap between leaf clumps)
  P.ellipse(x - P.lightSide * 0.6, y + 1.1, c.r * 0.98, ry * 0.95, c.mat, { tone: tone - 2, flat: 1 });
  P.ellipse(x, y, c.r, ry, c.mat, { tone });
  for (const l of c.lobes) P.ellipse(x + l.dx, y + l.dy * c.flat, l.r, l.r * Math.max(c.flat, 0.8), c.mat, { tone: tone + l.tone });
  for (const t of c.tufts) P.ellipse(x + t.dx, y + t.dy, 1.1, 1.1, c.mat, { tone });
}

function drawDetail(P: Painter, m: Model, c: Cluster, dx: number, dy: number) {
  const x = c.x + dx, y = c.y + dy;
  for (const g of c.glints) {
    const gx = Math.round(x + g.dx * (P.lightSide > 0 ? -1 : 1)), gy = Math.round(y + g.dy);
    P.px(gx, gy, c.mat, 4);
    P.px(gx + 1, gy + 1, c.mat, 3);
  }
  if (c.fruit && m.fruit) {
    const fx = x + c.fruit.dx, fy = y + c.fruit.dy;
    const rad = m.W >= 96 ? 1.9 : m.W >= 64 ? 1.5 : 1.2;
    P.ellipse(fx, fy, rad, rad, m.fruit);
    P.px(Math.round(fx - 0.5 - P.lightSide * -0.6), Math.round(fy - 0.5), m.fruit, 4);
  }
}

function render(m: Model, kit: StyleKit, frame: number, swayed: boolean, seed: number): Sprite {
  const { W } = m;
  const P = new Painter(W, W, kit);
  const r = rng(seed ^ 0x51ed);
  drawTrunk(P, m, r);
  const phase = (frame / SWAY_FRAMES) * Math.PI * 2;
  const amp = W >= 96 ? 1.5 : 1.15;
  const off = (c: Cluster) => {
    if (!swayed) return [0, 0] as const;
    const s = Math.sin(phase + c.phase * 0.55), co = Math.cos(phase * 2 + c.phase);
    return [Math.round(s * amp * c.weight), Math.round(co * 0.55 * c.weight)] as const;
  };
  const order = [...m.clusters.keys()].sort((a, b) => m.clusters[a].z - m.clusters[b].z);
  const split = Math.floor(order.length * 0.45);
  // dark core under the crown: whatever the clusters leave open shows shadow
  if (m.core && !(m.snow && !m.evergreen)) {
    const k = m.core;
    P.ellipse(k.x, k.y + k.ry * 0.05, k.rx * 0.72, k.ry * 0.72, m.mats[0], { tone: -2, flat: 1 });
  }
  const sprites0 = 0; void sprites0;
  const sprites: { c: Cluster; o: readonly [number, number] }[] = order.map((i) => ({ c: m.clusters[i], o: off(m.clusters[i]) }));
  for (const b of m.branches) {
    const o = off(m.clusters[b.to]);
    P.capsule(b.ax, b.ay, b.bx + o[0], b.by + o[1], b.r, m.trunk.mat, { tone: -1 });
  }
  for (let i = 0; i < split; i++) drawCluster(P, sprites[i].c, sprites[i].o[0], sprites[i].o[1], sprites[i].c.tone);
  for (let i = split; i < sprites.length; i++) drawCluster(P, sprites[i].c, sprites[i].o[0], sprites[i].o[1], sprites[i].c.tone);
  for (let i = split; i < sprites.length; i++) drawDetail(P, m, sprites[i].c, sprites[i].o[0], sprites[i].o[1]);
  // shadowy gaps: a few dark leaf pixels deep in the crown (only where leaves already are)
  for (const h of m.holes) {
    const hx = Math.round(h.x), hy = Math.round(h.y);
    if (P.isFilled(hx, hy) && P.isFilled(hx + 1, hy) && P.isFilled(hx, hy + 1)) {
      P.px(hx, hy, m.mats[0], 0);
      P.px(hx + 1, hy, m.mats[0], 0);
      if (r.chance(0.5)) P.px(hx, hy + 1, m.mats[0], 1);
    }
  }
  P.rim();
  let raw = P.toSprite();
  if (m.snow) raw = snowCaps(raw, m);
  return raw;
}

/** Winter: any crown or limb pixel with open air above becomes snow; thicker where the surface is flat. */
function snowCaps(s: Sprite, m: Model): Sprite {
  const out: Sprite = { ...s, data: s.data.slice() };
  const lit = new Set<Material>([...m.mats, m.trunk.mat]);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= s.w || y >= s.h ? 0 : s.data[y * s.w + x]);
  const snow = new Set<number>();
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++) {
      const d = decodeIndex(at(x, y));
      if (!d || !lit.has(d.mat) || d.level === 0 && y > m.G - 2) continue;
      if (at(x, y - 1) === 0) snow.add(y * s.w + x);
    }
  for (const i of snow) {
    const x = i % s.w, y = (i - x) / s.w;
    out.data[i] = colorIndex("ui", 4);
    // a second, shaded row under flat caps
    const below = (y + 1) * s.w + x;
    if (!snow.has(below) && at(x, y + 1) && ((x * 7 + y * 3) % 3 !== 0)) {
      const d = decodeIndex(at(x, y + 1));
      if (d && lit.has(d.mat)) out.data[below] = colorIndex("ui", 3);
    }
  }
  return out;
}

function groundShadow(s: Sprite, m: Model, snowy: boolean) {
  const { W, G, cx } = m;
  const rx = W * (m.evergreen ? 0.34 : 0.4), ry = Math.max(2, W * 0.055);
  const yc = G + 0.4;
  for (let y = 1; y < W - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      if (s.data[y * W + x]) continue;
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - yc) / ry;
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      if (d > 0.62 && (x + y) % 2) continue; // dithered penumbra
      s.data[y * W + x] = snowy ? colorIndex("ui", d > 0.62 ? 3 : 2) : colorIndex("foliage", d > 0.62 ? 1 : 0);
    }
}

/** Hanging willow strands, drawn after the outline so they stay slim; they wave with the frame phase. */
function drawStrands(s: Sprite, m: Model, frame: number, swayed: boolean) {
  const phase = (frame / SWAY_FRAMES) * Math.PI * 2;
  const leafSet = new Set<Material>(m.mats);
  const lim = m.G - 1;
  for (const st of m.strands) {
    const x0 = Math.round(st.x);
    let y0 = -1;
    for (let y = 2; y < lim; y++) {
      const d = decodeIndex(s.data[y * s.w + x0]);
      if (d && leafSet.has(d.mat)) y0 = y;
    }
    if (y0 < 0) continue;
    const len = Math.min(Math.round(st.len), lim - y0 - 1);
    for (let k = 1; k <= len; k++) {
      const f = k / Math.max(1, st.len);
      const wob = swayed ? Math.sin(phase + st.phase + k * 0.45) * 1.5 * f : Math.sin(st.phase + k * 0.45) * 0.5 * f;
      const x = Math.round(st.x + wob);
      const lvl = k % 3 === 0 ? 4 : st.dark ? 2 : 3;
      if (x < 1 || x > s.w - 2) continue;
      s.data[(y0 + k) * s.w + x] = colorIndex(m.leaf, k === len ? 2 : lvl);
      if (!st.dark && k % 2 === 0 && x + 1 < s.w - 1) s.data[(y0 + k) * s.w + x + 1] = colorIndex(m.leaf, 1);
    }
  }
}

function drawParticles(s: Sprite, m: Model, frame: number) {
  for (const p of m.particles) {
    const t = (frame / SWAY_FRAMES + p.ph) % 1;
    const y = Math.round(p.y + t * (m.G - p.y - 3)), x = Math.round(p.x + Math.sin(t * Math.PI * 2 + p.ph * 9) * 2.5 + t * 3);
    if (x < 1 || y < 1 || x > s.w - 3 || y > s.h - 3) continue;
    for (const [dx, dy, lvl] of [[0, 0, 3], [1, 0, 2]] as const) {
      const i = y * s.w + x + dx + dy * s.w;
      if (!s.data[i]) s.data[i] = colorIndex(p.mat, lvl + (frame % 2 ? 0 : 0));
    }
  }
}

function clearBorder(s: Sprite) {
  for (let i = 0; i < s.w; i++) { s.data[i] = 0; s.data[(s.h - 1) * s.w + i] = 0; }
  for (let j = 0; j < s.h; j++) { s.data[j * s.w] = 0; s.data[j * s.w + s.w - 1] = 0; }
}

function frameSprite(m: Model, kit: StyleKit, frame: number, swayed: boolean, seed: number, species: Species, season: Season): Sprite {
  const raw = render(m, kit, frame, swayed, seed);
  const out = finalize(raw, kit);
  if (species === "willow") drawStrands(out, m, frame, swayed);
  if (swayed) drawParticles(out, m, frame);
  groundShadow(out, m, season === "winter");
  clearBorder(out);
  return out;
}

export const foliageGenerator: Generator = {
  id: "foliage",
  category: "environment",
  label: "HD Trees (foliage)",
  description:
    "Lush painted trees built from lit leaf clusters with a flared, barked trunk, visible limbs, ragged canopy edge and ground shadow. Species oak, willow, maple-autumn, birch, fruit-tree, pine-hd, sakura; sizes 48/64/96 px; seasons recolour the crown (snow caps in winter). Rows: idle, sway.",
  params: [
    { key: "species", label: "Species", type: "select", options: [...FOLIAGE_SPECIES], default: "oak" },
    { key: "size", label: "Size (48 / 64 / 96 px)", type: "select", options: [...FOLIAGE_SIZES], default: "medium" },
    { key: "season", label: "Season", type: "select", options: [...FOLIAGE_SEASONS], default: "summer" },
    { key: "leaf", label: "Leaf material", type: "material", options: ["foliage", "grass", "accent", "cloth2", "gold", "roof"], default: "foliage" },
    { key: "accent", label: "Fruit / blossom", type: "material", default: "cloth2" },
    { key: "variant", label: "Variant", type: "number", min: 0, max: 9, step: 1, default: 0 },
  ],
  generate(p: Params, kit: StyleKit, seed: number) {
    const species = (str(p, "species") as Species);
    const size = str(p, "size");
    const season = str(p, "season") as Season;
    const W = FOLIAGE_PX[size] ?? 64;
    const sizeIdx = Math.max(0, FOLIAGE_SIZES.indexOf(size as never));
    const model = buildModel(species, W, sizeIdx, season, mat(p, "leaf"), mat(p, "accent"), seed, num(p, "variant"));
    const idle = frameSprite(model, kit, 0, false, seed, species, season);
    const sway: Sprite[] = [];
    for (let f = 0; f < SWAY_FRAMES; f++) sway.push(frameSprite(model, kit, f, true, seed, species, season));
    const rows: FrameSet[] = [{ name: "idle", frames: [idle] }, { name: "sway", frames: sway }];
    return { rows, fps: 6 };
  },
};

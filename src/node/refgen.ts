// Reference-guided generation (#66). Pure (core + typed arrays only, so the web app can import it too).
// Offline: read a reference image and map its colours/shape onto generator params and rig slots.
// Ranking: score rendered candidates against the reference through an injectable Scorer.
import { type Generator, type Params, randomParams } from "../core/generators/types";
import { resolveRamps } from "../core/kit";
import { MATERIALS, flattenPalette, hexToRgb, rgbToOklab, type Material, type Ramps, type RGB } from "../core/palette";
import { analyzeReference, styleDistance, type RefAnalysis, type RefImage } from "../core/refstyle";
import { rng } from "../core/rng";
import type { Sprite, StyleKit } from "../core/types";

export type Match = "style" | "subject" | "both";
export const MATCHES: Match[] = ["style", "subject", "both"];

type Lab = [number, number, number];
const labDist = (a: Lab, b: Lab) => Math.hypot((a[0] - b[0]) * 1.4, a[1] - b[1], a[2] - b[2]);

// ---------- foreground + regions ----------

export interface Box { x0: number; y0: number; x1: number; y1: number }

interface Fg {
  mask: Uint8Array;
  box: Box;
  w: number;
  h: number;
  px: (x: number, y: number) => RGB;
}

/** Foreground = opaque pixels that differ from the dominant border colour (a photo/concept-art backdrop). */
export function foreground(img: RefImage): Fg {
  const { w, h, data } = img;
  const px = (x: number, y: number): RGB => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const counts = new Map<number, { n: number; rgb: RGB }>();
  const edge = (x: number, y: number) => {
    if (data[(y * w + x) * 4 + 3] < 128) return;
    const c = px(x, y);
    const k = (c[0] >> 4) << 8 | (c[1] >> 4) << 4 | (c[2] >> 4);
    const e = counts.get(k);
    if (e) e.n++; else counts.set(k, { n: 1, rgb: c });
  };
  for (let x = 0; x < w; x++) { edge(x, 0); edge(x, h - 1); }
  for (let y = 0; y < h; y++) { edge(0, y); edge(w - 1, y); }
  let bg: RGB | null = null, best = 0;
  for (const e of counts.values()) if (e.n > best) { best = e.n; bg = e.rgb; }
  const border = 2 * (w + h);
  if (best < border * 0.25) bg = null; // busy border: no flat backdrop to remove
  const mask = new Uint8Array(w * h);
  const box: Box = { x0: w, y0: h, x1: -1, y1: -1 };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] < 128) continue;
      const c = px(x, y);
      if (bg && Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]) < 54) continue;
      mask[y * w + x] = 1;
      if (x < box.x0) box.x0 = x;
      if (x > box.x1) box.x1 = x;
      if (y < box.y0) box.y0 = y;
      if (y > box.y1) box.y1 = y;
    }
  if (box.x1 < 0) { box.x0 = 0; box.y0 = 0; box.x1 = w - 1; box.y1 = h - 1; mask.fill(1); }
  return { mask, box, w, h, px };
}

/** Fractional band of the foreground box, e.g. band(fg, 0, 0.3) = the top 30%. */
function band(fg: Fg, f0: number, f1: number): Box {
  const bh = fg.box.y1 - fg.box.y0 + 1;
  return { x0: fg.box.x0, x1: fg.box.x1, y0: fg.box.y0 + Math.floor(bh * f0), y1: Math.max(fg.box.y0 + Math.floor(bh * f0), fg.box.y0 + Math.ceil(bh * f1) - 1) };
}

/** Most common colour (16-level bins, averaged) among foreground pixels of a region, optionally filtered. */
function dominant(fg: Fg, b: Box, keep?: (c: RGB) => boolean): RGB | null {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let y = b.y0; y <= b.y1; y++)
    for (let x = b.x0; x <= b.x1; x++) {
      if (!fg.mask[y * fg.w + x]) continue;
      const c = fg.px(x, y);
      if (keep && !keep(c)) continue;
      const k = (c[0] >> 4) << 8 | (c[1] >> 4) << 4 | (c[2] >> 4);
      const e = bins.get(k);
      if (e) { e.n++; e.r += c[0]; e.g += c[1]; e.b += c[2]; } else bins.set(k, { n: 1, r: c[0], g: c[1], b: c[2] });
    }
  let top: { n: number; r: number; g: number; b: number } | null = null;
  for (const e of bins.values()) if (!top || e.n > top.n) top = e;
  if (!top || top.n < 3) return null;
  return [Math.round(top.r / top.n), Math.round(top.g / top.n), Math.round(top.b / top.n)];
}

// ---------- colour -> material ----------

/** Nearest material ramp (OKLab, mid shades weighted) for a colour. */
export function nearestMaterial(rgb: RGB, ramps: Ramps, allowed: readonly Material[] = MATERIALS): Material {
  const lab = rgbToOklab(rgb);
  let best: Material = allowed[0], bd = Infinity;
  for (const m of allowed) {
    if (m === "ink") continue;
    let d = Infinity;
    for (let l = 1; l <= 3; l++) d = Math.min(d, labDist(lab, rgbToOklab(hexToRgb(ramps[m][l]))));
    if (d < bd) { bd = d; best = m; }
  }
  return best;
}

const SKINS: Material[] = ["skin"];

/** Warm, light, moderately saturated colours (OKLab hue 35-95 deg) read as skin; hair, cloth and wood do not. */
function skinLike(c: RGB): boolean {
  const [L, a, b] = rgbToOklab(c);
  const chroma = Math.hypot(a, b), hue = (Math.atan2(b, a) * 180) / Math.PI;
  return L > 0.55 && chroma > 0.03 && chroma < 0.14 && hue > 35 && hue < 95;
}

export interface Derived {
  /** Generator params (or rig slots) inferred from the reference; explicit input always overrides. */
  params: Params;
  slots: Record<string, Material>;
  notes: string[];
}

/** Rig/character slots from body bands: hair (head top), skin (face), top (torso), bottom (legs), boots (feet). */
export function deriveBodySlots(img: RefImage, kit: StyleKit): { slots: Record<string, Material>; notes: string[] } {
  const ramps = resolveRamps(kit);
  const fg = foreground(img);
  const slots: Record<string, Material> = {};
  const notes: string[] = [];
  const isSkin = skinLike;
  const skinMats = SKINS.length ? SKINS : (["skin"] as Material[]);
  const head = band(fg, 0, 0.22);
  const faceC = dominant(fg, band(fg, 0.06, 0.26), isSkin);
  if (faceC) slots.skin = nearestMaterial(faceC, ramps, skinMats);
  const hairC = dominant(fg, band(fg, 0, 0.12), (c) => !isSkin(c)) ?? dominant(fg, head, (c) => !isSkin(c));
  if (hairC) slots.hair = nearestMaterial(hairC, ramps, MATERIALS.filter((m) => !SKINS.includes(m) && m !== "ui"));
  const paint = MATERIALS.filter((m) => m !== "ink" && m !== "ui" && !SKINS.includes(m));
  const topC = dominant(fg, band(fg, 0.3, 0.55), (c) => !isSkin(c));
  if (topC) slots.top = nearestMaterial(topC, ramps, paint);
  const botC = dominant(fg, band(fg, 0.58, 0.86), (c) => !isSkin(c));
  if (botC) slots.bottom = nearestMaterial(botC, ramps, paint);
  const bootC = dominant(fg, band(fg, 0.9, 1), (c) => !isSkin(c));
  if (bootC) slots.boots = nearestMaterial(bootC, ramps, paint);
  notes.push(`Reference colours -> slots ${Object.entries(slots).map(([k, v]) => `${k}=${v}`).join(", ") || "(none found)"}.`);
  return { slots, notes };
}

const WALLS: Material[] = ["wood", "stone", "sand", "dirt", "leather", "metal", "cloth2"];
const ROOFS: Material[] = ["roof", "wood", "foliage", "stone", "cloth", "cloth2", "accent", "gold", "metal", "sand"];
const TRIMS: Material[] = ["wood", "stone", "metal", "gold", "leather", "dirt", "sand"];

/** Building params: roof from the top band, walls from the middle, trim from the darkest sizeable colour; style from shape. */
export function deriveBuilding(img: RefImage, kit: StyleKit): Derived {
  const ramps = resolveRamps(kit);
  const fg = foreground(img);
  const bw = fg.box.x1 - fg.box.x0 + 1, bh = fg.box.y1 - fg.box.y0 + 1;
  const aspect = bh / bw;
  const params: Params = {};
  const notes: string[] = [];
  const roofC = dominant(fg, band(fg, 0.02, 0.3));
  if (roofC) params.roof = nearestMaterial(roofC, ramps, ROOFS);
  const upperC = dominant(fg, band(fg, 0.42, 0.62), (c) => !roofC || labDist(rgbToOklab(c), rgbToOklab(roofC)) > 0.05);
  const lowerC = dominant(fg, band(fg, 0.72, 0.92));
  if (upperC) params.wall = nearestMaterial(upperC, ramps, WALLS);
  // two-tone walls (stone/brick below, timber above) read as half-brick
  const lowerMat = lowerC ? nearestMaterial(lowerC, ramps, WALLS) : undefined;
  const twoTone = !!(upperC && lowerC && labDist(rgbToOklab(upperC), rgbToOklab(lowerC)) > 0.08);
  // stilts: clear gaps in the bottom 12% of the box
  let gap = 0, tot = 0;
  for (let y = fg.box.y1 - Math.max(1, Math.floor(bh * 0.12)); y <= fg.box.y1; y++)
    for (let x = fg.box.x0; x <= fg.box.x1; x++) { tot++; if (!fg.mask[y * fg.w + x]) gap++; }
  const stilts = tot > 0 && gap / tot > 0.4;
  if (stilts) params.style = "stilt-house";
  else if (aspect > 1.5) { params.style = "tower"; params.width = "narrow"; }
  else if (twoTone && aspect > 0.6 && lowerMat) { params.style = "half-brick"; params.floors = 2; }
  else if (aspect < 0.7) params.style = bw > bh * 1.6 ? "barn" : "cottage";
  else params.style = "cottage";
  if (aspect < 1.2 && bw > bh * 1.2) params.width = "wide";
  if (aspect > 1 && params.style !== "tower" && params.floors === undefined) params.floors = 2;
  const trimC = dominant(fg, band(fg, 0.6, 1), (c) => rgbToOklab(c)[0] < 0.45);
  if (trimC) params.trim = nearestMaterial(trimC, ramps, TRIMS);
  notes.push(`Reference shape ${bw}x${bh} (h/w ${aspect.toFixed(2)})${twoTone ? ", two-tone walls" : ""}${stilts ? ", raised on stilts" : ""} -> style ${params.style}; roof=${params.roof ?? "default"}, wall=${params.wall ?? "default"}.`);
  return { params, slots: {}, notes };
}

/** Tint any material param (generic fallback for environment/object/others): nearest ramp to the dominant colours. */
export function deriveTints(img: RefImage, kit: StyleKit, g: Generator): Derived {
  const ramps = resolveRamps(kit);
  const fg = foreground(img);
  const all = dominant(fg, fg.box);
  const params: Params = {};
  const notes: string[] = [];
  if (!all) return { params, slots: {}, notes };
  const mats = g.params.filter((s) => s.type === "material");
  // the first material param gets the dominant colour; the rest get the dominant colours that differ from it
  const used: RGB[] = [];
  for (const s of mats) {
    const opts = s.type === "material" && s.options ? s.options : MATERIALS.filter((m) => m !== "ink" && m !== "ui");
    const c = dominant(fg, fg.box, (p) => used.every((u) => labDist(rgbToOklab(p), rgbToOklab(u)) > 0.1));
    if (!c) break;
    used.push(c);
    params[s.key] = nearestMaterial(c, ramps, opts);
  }
  if (Object.keys(params).length) notes.push(`Reference colours -> ${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(", ")}.`);
  return { params, slots: {}, notes };
}

/** Params for a generator from a reference. `match`: style = colours only, subject = shape/style only, both. */
export function deriveParams(g: Generator, img: RefImage, kit: StyleKit, match: Match = "both"): Derived {
  let d: Derived;
  if (g.id === "building") d = deriveBuilding(img, kit);
  else if (g.id === "character") {
    const b = deriveBodySlots(img, kit);
    d = { params: {}, slots: b.slots, notes: b.notes };
    for (const k of ["skin", "hair", "top", "bottom", "boots"]) if (b.slots[k]) d.params[k] = b.slots[k];
  } else d = deriveTints(img, kit, g);
  const specs = new Map(g.params.map((s) => [s.key, s]));
  const keep: Params = {};
  for (const [k, v] of Object.entries(d.params)) {
    const s = specs.get(k);
    if (!s) continue;
    const isColour = s.type === "material";
    if (match === "style" && !isColour) continue;
    if (match === "subject" && isColour) continue;
    keep[k] = v;
  }
  d.params = keep;
  return d;
}

// ---------- scoring ----------

/** Lower = closer to the reference. Distances are in a rough 0..1 range. */
export interface Scorer {
  name: string;
  distance(asset: RefImage, reference: RefImage): number;
}

function profile(img: RefImage): { colors: RGB[]; aspect: number } {
  const fg = foreground(img);
  const colors: RGB[] = [];
  for (let i = 0; i < 4; i++) colors.push(dominant(fg, band(fg, i / 4, (i + 1) / 4)) ?? [128, 128, 128]);
  return { colors, aspect: (fg.box.y1 - fg.box.y0 + 1) / (fg.box.x1 - fg.box.x0 + 1) };
}

function paletteChamfer(a: RefAnalysis, b: RefAnalysis): number {
  const side = (p: RefAnalysis, q: RefAnalysis) => {
    let s = 0, wsum = 0;
    for (const e of p.palette) {
      const lab = rgbToOklab(hexToRgb(e.hex));
      let d = Infinity;
      for (const f of q.palette) d = Math.min(d, labDist(lab, rgbToOklab(hexToRgb(f.hex))));
      s += d * e.weight; wsum += e.weight;
    }
    return wsum ? s / wsum : 1;
  };
  return (side(a, b) + side(b, a)) / 2;
}

/**
 * Local fallback: palette distance (analyzeReference of both images) + vertical colour-band profile + silhouette aspect.
 * INTEGRATOR HOOK: when `styleDistance(assetImg, refImg)` exists in core/refstyle.ts, pass
 * `{ name: "styleDistance", distance: (a, r) => 1 - styleDistance(a, r).score / 100 }` (or similar) as the scorer.
 */
export const localScorer: Scorer = {
  name: "local-palette",
  distance(asset, reference) {
    const pa = analyzeReference(asset, { paletteSize: 12 }), pr = analyzeReference(reference, { paletteSize: 12 });
    const A = profile(asset), R = profile(reference);
    const bands = A.colors.reduce((s, c, i) => s + labDist(rgbToOklab(c), rgbToOklab(R.colors[i])), 0) / A.colors.length;
    const aspect = Math.abs(Math.log(A.aspect / R.aspect));
    return paletteChamfer(pa, pr) * 0.8 + bands * 0.6 + Math.min(1, aspect) * 0.5;
  },
};

export const distanceToScore = (d: number) => Math.round(100 * Math.exp(-d * 2.2));

/** Default ranking: the same style-distance score compare_to_reference reports (distance chosen so distanceToScore returns it). */
export const styleScorer: Scorer = {
  name: "styleDistance",
  distance: (asset, reference) => -Math.log(Math.max(1, styleDistance(asset, reference).score) / 100) / 2.2,
};

/** Sprite (palette indices) -> RGBA for scoring, with a transparent background. */
export function spriteRef(sprite: Sprite, kit: StyleKit): RefImage {
  const flat = flattenPalette(resolveRamps(kit));
  const data = new Uint8ClampedArray(sprite.w * sprite.h * 4);
  for (let i = 0; i < sprite.w * sprite.h; i++) {
    const hex = flat[sprite.data[i]];
    if (!hex) continue;
    const [r, g, b] = hexToRgb(hex);
    data.set([r, g, b, 255], i * 4);
  }
  return { w: sprite.w, h: sprite.h, data };
}

// ---------- candidates ----------

export interface Candidate { seed: number; params: Params; score: number; sprite: Sprite }

export interface CandidateOptions {
  generator: Generator;
  kit: StyleKit;
  reference: RefImage;
  /** Params the caller set explicitly: they always win and are never varied. */
  pinned?: Params;
  match?: Match;
  count?: number;
  seed?: number;
  scorer?: Scorer;
}

/**
 * Render `count` candidates guided by the reference and return them best-first. Colour params come from the
 * reference; the free params (style, floors, ...) vary per candidate, with the derived style always included.
 */
export function referenceCandidates(o: CandidateOptions): { candidates: Candidate[]; derived: Derived } {
  const { generator: g, kit, reference } = o;
  const match = o.match ?? "both";
  const scorer = o.scorer ?? styleScorer;
  const count = o.count ?? 6;
  const first = o.seed ?? 1000;
  const derived = deriveParams(g, reference, kit, match);
  const pinned = o.pinned ?? {};
  const out: Candidate[] = [];
  const styleSpec = g.params.find((s) => s.key === "style" && s.type === "select");
  const styles = styleSpec && styleSpec.type === "select" ? styleSpec.options : [];
  const pool = Math.max(count * 2, 12); // render a wider pool, keep the best `count`
  for (let k = 0; k < pool; k++) {
    const seed = (first + k) % 4294967296;
    const r = rng(seed ^ 0x9e3779b9);
    // characters: costume/pattern/headwear would hide the derived top/bottom colours, so keep them plain unless pinned
    const plain: Params = g.id === "character" ? { costume: "none", pattern: "none", headwear: "none", cape: false } : {};
    const params: Params = { ...randomParams(g, r), ...plain, ...derived.params, ...pinned };
    // derived style (k=0) first; the rest sweep other styles so the ranking has real alternatives
    if (styles.length && pinned.style === undefined && !(k === 0 && derived.params.style)) params.style = styles[k % styles.length];
    if (k === 0 || !styles.length) Object.assign(params, derived.params, pinned);
    try {
      const sprite = g.generate(params, kit, seed).rows[0].frames[0];
      let d = scorer.distance(spriteRef(sprite, kit), reference);
      // the derived style is the subject guess: a mild prior so a lucky palette does not outrank the right shape
      if (match !== "style" && derived.params.style && params.style !== derived.params.style && pinned.style === undefined) d += 0.15;
      out.push({ seed, params, sprite, score: distanceToScore(d) });
    } catch {
      /* skip candidates a generator rejects */
    }
  }
  out.sort((a, b) => b.score - a.score);
  return { candidates: out.slice(0, count), derived };
}

// ---------- AI refinement (web) ----------

export interface AiProposal<T> { value: T; sprite: Sprite }

export interface RefineResult<T> { best: T; score: number; rounds: number; history: number[] }

/**
 * Propose -> score -> ONE refinement round when the score is low; keep the better candidate.
 * `propose(feedback)` calls /api/vibe or /api/rig with reference_ids; the second call gets the first score as feedback.
 */
export async function refineWithAi<T>(o: {
  propose: (feedback?: string) => Promise<AiProposal<T>>;
  score: (sprite: Sprite) => number;
  /** Refine when the first score is below this (0..100). Default 70. */
  threshold?: number;
}): Promise<RefineResult<T>> {
  const first = await o.propose();
  const s1 = o.score(first.sprite);
  const history = [s1];
  if (s1 >= (o.threshold ?? 70)) return { best: first.value, score: s1, rounds: 1, history };
  let second: AiProposal<T>;
  try {
    second = await o.propose(`The first attempt scored ${s1}/100 against the reference. Match its colours and silhouette more closely.`);
  } catch {
    return { best: first.value, score: s1, rounds: 1, history };
  }
  const s2 = o.score(second.sprite);
  history.push(s2);
  return s2 > s1 ? { best: second.value, score: s2, rounds: 2, history } : { best: first.value, score: s1, rounds: 2, history };
}

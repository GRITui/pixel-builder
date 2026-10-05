import { finalize } from "../enforce";
import { buildingFootprint, type Footprint } from "../footprint";
import { proportions } from "../kit";
import { colorIndex, type Material } from "../palette";
import { rng } from "../rng";
import { cloneSprite, flipX, getPx, setPx } from "../sprite";
import type { FrameSet, Sprite, StyleKit } from "../types";
import { Painter } from "../painter";
import { calm, type AddOns, type Ctx, type Cover, type Layout, type WallKind } from "./building-rich";
import { smoke, SMOKE_FRAMES } from "./building-rich-addons";
import { blacksmith, greenhouse, inn, marketStall, temple, wellHouse, windmill, SPIN_FRAMES } from "./building-rich-new";
import { keep, render, stilt, tower } from "./building-rich-styles";
import { bool, mat, num, str, type GenResult, type Params } from "./types";

export { richDoorHeight } from "./building-rich";
export type { Footprint };

/** Styles that can use rich look: the original nine plus the Sprint 8 wave 2 additions. */
export const NEW_STYLES = ["inn", "blacksmith", "temple", "windmill", "greenhouse", "market-stall", "well-house"];

/** Props keep a 1px transparent margin: clip anything that strayed onto the border. */
function clearMargin(s: Sprite) {
  for (let x = 0; x < s.w; x++) { setPx(s, x, 0, 0); setPx(s, x, s.h - 1, 0); }
  for (let y = 0; y < s.h; y++) { setPx(s, 0, y, 0); setPx(s, s.w - 1, y, 0); }
}

/** Soft contact shadow: a dithered half-ellipse thrown away from the light, painted after the outline so it carries none. */
export function groundShadow(s: Sprite, x0: number, x1: number, y: number, rows: number, dir: number) {
  const shadow = colorIndex("ink", 2);
  const cx = (x0 + x1) / 2 + dir * rows * 0.5, rx = (x1 - x0) / 2 + rows * 0.7;
  for (let j = 0; j < rows; j++) {
    const half = rx * Math.sqrt(1 - (j / rows) ** 2 * 0.95);
    for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++) {
      if (x < 1 || x >= s.w - 1 || y + j >= s.h - 1 || getPx(s, x, y + j) !== 0) continue;
      const edge = 1 - Math.abs(x + 0.5 - cx) / half; // 0 at the rim, 1 in the middle
      const core = j < rows * 0.45 && edge > 0.18;
      if (core || (x + j) % 2 === 0) setPx(s, x, y + j, shadow);
    }
  }
}

function coverFor(style: string, roof: Material, rs: string): Cover {
  if (rs === "corrugated") return "tin";
  if (roof === "metal") return "tin";
  if (roof === "sand" || roof === "foliage") return "thatch";
  if (roof === "stone") return "slate";
  if (roof === "roof") return style === "shop" || style === "keep" || style === "tower" || style === "half-brick" || style === "temple" ? "tile" : "shingle";
  return "shingle";
}

const SIGNS = ["INN", "SHOP", "SMITH", "BAKERY", "TAVERN", "MARKET", "HOME", "FARM", "BOOKS", "POTIONS"];
export const SIGN_OPTIONS = ["auto", "none", ...SIGNS];
export const TRI = ["auto", "on", "off"];
const tri = (p: Params, k: string, dflt: boolean): boolean => {
  const v = str(p, k);
  return v === "on" ? true : v === "off" ? false : dflt;
};

/** Per-style add-on defaults (what a user gets for `auto`), then overridden by the params. */
export function resolveAddOns(style: string, p: Params, tier: number): AddOns {
  const d: AddOns = {
    porch: false, balcony: false, awning: false, awningMat: mat(p, "awning_color"), sign: "", lanterns: false,
    flowerBoxes: false, ivy: false, wear: false, yard: false, hayloft: false, gable: str(p, "gable") === "thai" ? "thai" : "western", tier,
  };
  switch (style) {
    case "shop": d.awning = true; d.sign = "SHOP"; d.yard = true; break;
    case "farmhouse": d.porch = tier >= 2; d.flowerBoxes = bool(p, "flower_box") && tier >= 2; d.wear = tier === 1; d.balcony = tier === 3; d.lanterns = tier === 3; break;
    case "inn": d.sign = "INN"; d.lanterns = true; d.flowerBoxes = true; d.yard = true; break;
    case "blacksmith": d.wear = true; d.yard = true; d.sign = ""; break;
    case "barn": d.hayloft = tier >= 2; d.wear = tier === 1; d.yard = tier === 3; break;
    case "coop": d.wear = true; break;
    case "half-brick": d.balcony = true; d.flowerBoxes = true; break;
    case "keep": d.lanterns = true; break;
    case "temple": d.lanterns = true; break;
    case "greenhouse": d.wear = false; break;
    case "cottage": d.flowerBoxes = false; break;
    default: break;
  }
  d.porch = tri(p, "porch", d.porch);
  d.balcony = tri(p, "balcony", d.balcony);
  d.awning = tri(p, "awning", d.awning);
  d.lanterns = tri(p, "lanterns", d.lanterns);
  d.flowerBoxes = tri(p, "flower_boxes", d.flowerBoxes);
  d.ivy = tri(p, "ivy", d.ivy);
  d.wear = tri(p, "wear", d.wear);
  d.yard = tri(p, "yard", d.yard);
  d.hayloft = tri(p, "hayloft", d.hayloft);
  const sg = str(p, "sign");
  if (sg === "none") d.sign = "";
  else if (sg !== "auto") d.sign = sg;
  else if (!d.sign && d.awning) d.sign = "SHOP";
  return d;
}

export interface Rendered { sprite: Sprite; lights: { x: number; y: number; r: number }[]; smokeAt: { x: number; y: number } | null; L: Layout }

/** Render one rich building. `spin` (radians) only matters for windmill sails. */
export function renderRich(style: string, p: Params, kit: StyleKit, seed: number, fp: Footprint, spin = 0): Rendered {
  const r = rng(seed);
  calm.on = kit.shadeSteps <= 3;
  const flip = kit.lightDir === "top-right";
  const pk: StyleKit = flip ? { ...kit, lightDir: "top-left" } : kit;
  let wall = mat(p, "wall"), roof = mat(p, "roof");
  const trim = mat(p, "trim");
  const rs = str(p, "roof_style");
  const wallDef = wall === "wood", roofDef = roof === "roof";
  const tier = fp.tier ?? 2;
  let kind: WallKind = "plank";
  const byMat = (m: Material, wood: WallKind): WallKind =>
    m === "stone" ? "stone" : m === "sand" || m === "cloth2" || m === "ui" ? "plaster" : m === "dirt" ? "brick" : m === "metal" ? "tin" : m === "wood" || m === "leather" ? wood : "plaster";
  let roofMat = roof;
  switch (style) {
    case "cottage": kind = byMat(wall, "log"); break;
    case "farmhouse": kind = byMat(wall, "plank"); break;
    case "shop": if (wallDef) { wall = "sand"; } kind = byMat(wall, "plank"); break;
    case "barn": if (wallDef) wall = "roof"; kind = wall === "roof" ? "batten" : byMat(wall, "batten"); if (roofDef) roofMat = "metal"; break;
    case "coop": kind = byMat(wall, "plank"); break;
    case "tower": case "keep": if (wallDef) wall = "stone"; kind = byMat(wall, "plank"); break;
    case "stilt-house": kind = byMat(wall, "plank"); if (roofDef && p.gable !== "thai" && (rs === "auto" || rs === "corrugated")) roofMat = "metal"; break;
    case "half-brick": kind = byMat(wall, "plank"); if (roofDef && p.gable !== "thai") roofMat = "metal"; break;
    case "inn": if (wallDef) wall = "sand"; kind = byMat(wall, "plank"); break;
    case "blacksmith": if (wallDef) wall = "stone"; kind = byMat(wall, "plank"); break;
    case "temple": if (wallDef) wall = "sand"; kind = "plaster"; break;
    case "windmill": if (wallDef) wall = "sand"; kind = byMat(wall, "plank"); break;
    case "greenhouse": kind = byMat(wall, "plank"); break;
    default: kind = byMat(wall, "plank");
  }
  roof = roofMat;
  const ctx: Ctx = {
    P: undefined as unknown as Painter, kit: pk, seed, r,
    t: kit.sizes.tile, c: kit.sizes.character, ts: (1 + kit.sizes.tile / 16) / 2,
    pr: proportions(kit), wall, roof, trim,
    lit: bool(p, "lit_windows"), chimney: bool(p, "chimney"), flower: bool(p, "flower_box"),
    cover: coverFor(style, roof, rs), wallKind: kind,
    o: resolveAddOns(style, p, tier), lights: [], smokeAt: null, spin,
  };
  const hip: "hip" | "gable" = rs === "hip" || p.gable === "thai" ? "hip" : "gable";
  const o = ctx.o;
  let L: Layout;
  switch (style) {
    case "tower": L = tower(ctx, fp); break;
    case "keep": ctx.wallKind = "stone"; L = keep(ctx, fp); break;
    case "stilt-house": L = stilt(ctx, fp); break;
    case "shop": L = render(ctx, fp, { shape: hip, kind, wallMat: wall, frame: wall === "sand", pane: true }); break;
    case "farmhouse":
      L = render(ctx, fp, {
        shape: hip, kind, wallMat: wall, shutters: tier === 1 ? undefined : "foliage", dormers: tier === 3 ? 2 : fp.d >= 4 && tier === 2 ? 1 : 0,
        stringCourse: fp.storeys > 1, pane: tier > 1, rhK: tier === 1 ? 0.8 : 0.85,
      });
      break;
    case "barn": L = render(ctx, fp, { shape: "gambrel", kind, wallMat: wall, doubleDoor: true, rhK: tier === 1 ? 0.8 : 0.95 }); break;
    case "coop": L = render(ctx, fp, { shape: hip, kind, wallMat: wall, run: tier >= 2, rhK: 0.85, doorAt: tier >= 2 ? 0.74 : undefined }); break;
    case "half-brick": L = render(ctx, fp, { shape: hip, kind, wallMat: wall, lower: { kind: "brick", mat: "roof", h: Math.round(ctx.c * 1.0) }, stringCourse: false, shutters: trim, pane: true, rhK: o.gable === "thai" ? 1.1 : 0.9 }); break;
    case "inn": L = inn(ctx, fp, hip, kind, wall); break;
    case "blacksmith": L = blacksmith(ctx, fp, kind, wall); break;
    case "temple": L = temple(ctx, fp); break;
    case "windmill": L = windmill(ctx, fp); break;
    case "greenhouse": L = greenhouse(ctx, fp); break;
    case "market-stall": L = marketStall(ctx, fp); break;
    case "well-house": L = wellHouse(ctx, fp); break;
    default: L = render(ctx, fp, { shape: hip, kind, wallMat: wall, shutters: "foliage", pane: true });
  }
  void o;
  let s = ctx.P.toSprite();
  if (flip) s = flipX(s);
  s = finalize(s, kit);
  clearMargin(s);
  const W = s.w;
  const fx = (x: number) => (flip ? W - 1 - x : x);
  const x0 = L.PAD - 1, x1 = L.PAD + L.wt + 1;
  groundShadow(s, flip ? W - x1 : x0, flip ? W - x0 : x1, L.baseY + 2, Math.max(3, L.gb - 2), flip ? -1 : 1);
  const lights = ctx.lights.map((l) => ({ x: Math.round(fx(l.x)), y: Math.round(l.y), r: l.r }));
  const smokeAt = ctx.smokeAt ? { x: Math.round(fx(ctx.smokeAt.x)), y: ctx.smokeAt.y } : null;
  return { sprite: s, lights, smokeAt, L };
}

/** Render one rich building sprite (finalized, outlined, bottom-centred in its footprint-wide canvas). */
export function renderRichBuilding(style: string, p: Params, kit: StyleKit, seed: number, fp: Footprint): Sprite {
  return renderRich(style, p, kit, seed, fp).sprite;
}

export function richBuildingResult(p: Params, kit: StyleKit, seed: number): GenResult {
  const style = str(p, "style");
  const fp = buildingFootprint(style, str(p, "size"), kit, num(p, "tier"));
  const idle = renderRich(style, p, kit, seed, fp);
  const rows: FrameSet[] = [{ name: "idle", frames: [idle.sprite] }];
  if (idle.smokeAt) {
    const frames: Sprite[] = [idle.sprite];
    for (let f = 1; f < SMOKE_FRAMES; f++) {
      const s = cloneSprite(idle.sprite);
      smoke(s, idle.smokeAt, f, kit.sizes.tile);
      frames.push(s);
    }
    rows.push({ name: "smoke", frames });
  }
  if (style === "windmill") {
    const frames: Sprite[] = [idle.sprite];
    for (let f = 1; f < SPIN_FRAMES; f++) frames.push(renderRich(style, p, kit, seed, fp, (f * Math.PI) / (2 * SPIN_FRAMES)).sprite);
    rows.push({ name: "spin", frames });
  }
  return { rows, fps: 6, meta: { lights: idle.lights } };
}

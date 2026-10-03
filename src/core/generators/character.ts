import { finalize } from "../enforce";
import { Painter } from "../painter";
import type { Material } from "../palette";
import { rng } from "../rng";
import type { FrameSet, Sprite, StyleKit } from "../types";
import { bool, mat, PAINT, str, type Generator, type Params } from "./types";

type Dir = "down" | "up" | "left" | "right";
const DIRS: Dir[] = ["down", "left", "right", "up"];
const SKINS: Material[] = ["skin", "sand", "wood", "stone", "foliage", "metal", "accent"];

/**
 * Top-down "chibi" RPG character with a 4-direction, 4-frame walk cycle.
 * All coordinates are authored on a 32px grid and scaled to the kit size.
 */
function drawHumanoid(p: Params, kit: StyleKit, dir: Dir, frame: number, size: number): Sprite {
  const P = new Painter(size, size, kit);
  const k = size / 32;
  const u = (v: number) => Math.round(v * k);
  const us = (v: number) => Math.max(1, Math.round(v * k));
  const side = dir === "left" || dir === "right";
  const flip = dir === "left";
  // x transform for boxes (x, width) and points
  const X = (x: number, w = 0) => (flip ? size - u(x) - us(w) : u(x));
  const CX = (x: number) => (flip ? size - x * k : x * k);

  const build = str(p, "build");
  const tw = build === "slim" ? 8 : build === "stocky" ? 12 : 10; // torso width
  const skin = mat(p, "skin"), hair = mat(p, "hair"), top = mat(p, "top"), bottom = mat(p, "bottom"), boots = mat(p, "boots");
  const hairStyle = str(p, "hair_style"), hat = str(p, "headwear"), weapon = str(p, "weapon");

  // walk cycle: 0 neutral, 1 left step, 2 neutral, 3 right step
  const bob = frame % 2 === 1 ? 1 : 0;
  const step = frame === 1 ? 1 : frame === 3 ? -1 : 0;
  const oy = bob; // whole body bob

  // --- cape (behind everything) ---
  if (bool(p, "cape")) {
    const capeMat = mat(p, "accent_mat");
    if (dir === "up") P.box(X(16 - tw / 2 - 1, tw + 2), u(16) + oy, us(tw + 2), us(12), capeMat, [0, 0, 1]);
    else if (side) P.box(X(16 - tw / 2 - 2, 3), u(17) + oy, us(3), us(10), capeMat, [flip ? 1 : -1, 0, 0.6]);
    else {
      P.box(u(16 - tw / 2 - 1), u(18) + oy, us(1), us(8), capeMat, [-0.5, 0, 0.8]);
      P.box(u(16 + tw / 2), u(18) + oy, us(1), us(8), capeMat, [0.5, 0, 0.8]);
    }
  }

  // --- legs ---
  const legW = Math.max(3, tw / 2 - 1);
  const legY = 24;
  if (side) {
    const back = 16 - legW / 2 - step * 2, front = 16 - legW / 2 + step * 2;
    P.cylinder(X(back, legW), u(legY) + oy, us(legW), us(5) - oy, bottom, { tone: -1 });
    P.box(X(back, legW), u(legY + 4), us(legW), us(2), boots, [0, 0, 1], { tone: -1 });
    P.cylinder(X(front, legW), u(legY) + oy, us(legW), us(5) - oy, bottom);
    P.box(X(front, legW + 1), u(legY + 4), us(legW + 1), us(2), boots);
  } else {
    const lx = 16 - legW - 0.5, rx = 16 + 0.5;
    const lLift = step === 1 ? 1 : 0, rLift = step === -1 ? 1 : 0;
    P.cylinder(u(lx), u(legY) + oy, us(legW), us(5) - lLift - oy, bottom);
    P.box(u(lx), u(legY + 4) - lLift, us(legW), us(2), boots);
    P.cylinder(u(rx), u(legY) + oy, us(legW), us(5) - rLift - oy, bottom);
    P.box(u(rx), u(legY + 4) - rLift, us(legW), us(2), boots);
  }

  // --- torso ---
  const torsoX = 16 - (side ? tw * 0.4 : tw / 2);
  const torsoW = side ? tw * 0.8 : tw;
  P.cylinder(X(torsoX, torsoW), u(17) + oy, us(torsoW), us(8), top);
  P.rect(X(torsoX, torsoW), u(23) + oy, us(torsoW), us(1), mat(p, "boots"), 2); // belt
  if (!side && dir === "down") P.px(u(16), u(23) + oy, "gold", 3); // buckle

  // --- arms ---
  const swing = side ? 0 : step;
  const armW = 3;
  const drawArm = (ax: number, dy: number, tone = 0) => {
    P.cylinder(X(ax, armW), u(17 + dy) + oy, us(armW), us(6), top, { tone });
    P.box(X(ax, armW), u(23 + dy) + oy, us(armW), us(2), skin, [0, 0, 1], { tone });
  };
  if (side) drawArm(16 - 1 - step, 0);
  else {
    drawArm(16 - tw / 2 - armW, swing);
    drawArm(16 + tw / 2, -swing);
  }

  // --- head ---
  const hy = 10 + (k < 0.75 ? 0.5 : 0);
  P.ellipse(CX(16), hy * k + oy, 7.2 * k, 6.6 * k, skin);

  // --- hair ---
  const hairCut = (x0: number, y0: number, w: number, h: number) => P.box(X(x0, w), u(y0) + oy, us(w), us(h), hair);
  if (hairStyle !== "bald") {
    if (dir === "up") P.ellipse(CX(16), hy * k + oy, 7.4 * k, 6.8 * k, hair);
    else if (side) {
      P.ellipse(CX(15), (hy - 1.5) * k + oy, 7 * k, 5.2 * k, hair);
      hairCut(9, hy - 2, 5, 7); // back of head
    } else {
      P.ellipse(CX(16), (hy - 2) * k + oy, 7.4 * k, 5 * k, hair);
      P.erase(u(11), u(hy) + oy, us(10), us(4)); // forehead/face window
      P.ellipse(CX(16), (hy + 1) * k + oy, 6 * k, 4.6 * k, skin);
      hairCut(9, hy - 1, 2, 5);
      hairCut(21, hy - 1, 2, 5);
    }
    if (hairStyle === "long") {
      if (dir === "up") hairCut(9, hy, 14, 9);
      else if (side) hairCut(9, hy, 5, 9);
      else { hairCut(8, hy + 1, 3, 8); hairCut(21, hy + 1, 3, 8); }
    } else if (hairStyle === "spiky") {
      for (let i = 0; i < 4; i++) {
        const sx = 10 + i * 4;
        P.poly([[CX(sx), (hy - 4) * k + oy], [CX(sx + 4), (hy - 4) * k + oy], [CX(sx + 2), (hy - 9) * k + oy]], hair, [0, -0.5, 0.8]);
      }
    } else if (hairStyle === "ponytail") {
      if (dir === "up") hairCut(15, hy + 3, 3, 7);
      else if (side) hairCut(6, hy, 3, 7);
    }
  }

  // --- face ---
  if (dir === "down") {
    P.rect(u(13), u(hy + 1) + oy, us(1), us(2), "ink", 0);
    P.rect(u(18), u(hy + 1) + oy, us(1), us(2), "ink", 0);
    if (k >= 1) P.px(u(16), u(hy + 4) + oy, skin, 1);
  } else if (side) {
    P.rect(X(19, 1), u(hy + 1) + oy, us(1), us(2), "ink", 0);
  }

  // --- headwear ---
  const hm = mat(p, "accent_mat");
  if (hat === "helmet") {
    P.ellipse(CX(16), (hy - 1.5) * k + oy, 7.8 * k, 5.6 * k, "metal");
    if (dir !== "up") P.erase(side ? X(17, 8) : u(11), u(hy) + oy, us(side ? 8 : 10), us(4));
    if (dir === "down") P.ellipse(CX(16), (hy + 1) * k + oy, 5.8 * k, 4.4 * k, skin), P.rect(u(13), u(hy + 1) + oy, us(1), us(2), "ink", 0), P.rect(u(18), u(hy + 1) + oy, us(1), us(2), "ink", 0);
    if (side) P.ellipse(CX(19), (hy + 1.5) * k + oy, 3.5 * k, 3.5 * k, skin), P.rect(X(19, 1), u(hy + 1) + oy, us(1), us(2), "ink", 0);
  } else if (hat === "hood") {
    P.ellipse(CX(16), (hy - 0.5) * k + oy, 8.2 * k, 7.2 * k, hm);
    if (dir === "down") P.ellipse(CX(16), (hy + 1.5) * k + oy, 5.5 * k, 4.6 * k, "ink", { tone: 1 }), P.px(u(13), u(hy + 1) + oy, "gold", 4), P.px(u(18), u(hy + 1) + oy, "gold", 4);
    if (side) P.ellipse(CX(19.5), (hy + 1.5) * k + oy, 3 * k, 4 * k, "ink", { tone: 1 }), P.px(X(20), u(hy + 1) + oy, "gold", 4);
  } else if (hat === "wizard") {
    P.ellipse(CX(16), (hy - 3.5) * k + oy, 9.5 * k, 2 * k, hm, { flat: 0.4 });
    P.poly([[CX(10), (hy - 4) * k + oy], [CX(22), (hy - 4) * k + oy], [CX(side ? 12 : 18), (hy - 13) * k + oy]], hm, [0.3, -0.3, 0.9]);
  } else if (hat === "crown") {
    P.box(X(11, 10), u(hy - 6) + oy, us(10), us(3), "gold");
    for (const cx of [11, 15, 19]) P.px(X(cx + 1), u(hy - 7) + oy, "gold", 4);
    if (dir === "down") P.px(u(16), u(hy - 5) + oy, "cloth2", 3);
  }

  // --- weapon (held in front hand) ---
  if (weapon !== "none" && dir !== "up") {
    const hx = side ? 16 - 1 - step + 1 : 16 + tw / 2 + 1;
    const hyy = 23 - (side ? 0 : swing);
    if (weapon === "sword") {
      P.line(X(hx), u(hyy - 9) + oy, X(hx), u(hyy) + oy, "metal", 4);
      P.line(X(hx) + (flip ? 1 : -1), u(hyy - 8) + oy, X(hx) + (flip ? 1 : -1), u(hyy - 1) + oy, "metal", 2);
      P.rect(X(hx - 1, 3), u(hyy) + oy, us(3), 1, "gold", 3);
    } else if (weapon === "staff") {
      P.line(X(hx), u(hyy - 12) + oy, X(hx), u(hyy + 5) + oy, "wood", 2);
      P.ellipse(X(hx) + 0.5, (hyy - 13) * k + oy, 2.2 * k + 0.4, 2.2 * k + 0.4, hm);
    } else if (weapon === "shield") {
      const sx = side ? 18 : 16 - tw / 2 - 4;
      P.ellipse(CX(sx + 2), (hyy - 2) * k + oy, 3.5 * k, 4.5 * k, "metal", { flat: 0.3 });
      P.ellipse(CX(sx + 2), (hyy - 2) * k + oy, 1.5 * k, 2.5 * k, hm, { flat: 0.3 });
    } else if (weapon === "bow") {
      for (let t = -6; t <= 6; t++) P.px(X(hx + Math.round(2 - (t * t) / 18)), u(hyy - 4 + t) + oy, "wood", 3);
      P.line(X(hx + 2), u(hyy - 10) + oy, X(hx + 2), u(hyy + 2) + oy, "ui", 4);
    }
  }

  return finalize(P.toSprite(), kit);
}

function drawSlime(p: Params, kit: StyleKit, dir: Dir, frame: number, size: number): Sprite {
  const P = new Painter(size, size, kit);
  const k = size / 32;
  const body = mat(p, "skin");
  const squash = [0, 1.5, 0, -1.5][frame];
  const rx = (10 + squash) * k, ry = (8 - squash) * k;
  const cy = size - ry - 2 * k;
  P.ellipse(size / 2, cy, rx, ry, body, { flat: 0.1 });
  P.ellipse(size / 2 - rx * 0.4 * -P.lightSide, cy - ry * 0.5, Math.max(1, rx * 0.2), Math.max(1, ry * 0.2), body, { tone: 2 });
  if (dir !== "up") {
    const ex = dir === "left" ? -3 : dir === "right" ? 3 : 0;
    P.rect(Math.round(size / 2 + (ex - 3) * k), Math.round(cy - 1 * k), Math.max(1, Math.round(k)), Math.max(1, Math.round(2 * k)), "ink", 0);
    P.rect(Math.round(size / 2 + (ex + 3) * k), Math.round(cy - 1 * k), Math.max(1, Math.round(k)), Math.max(1, Math.round(2 * k)), "ink", 0);
  }
  return finalize(P.toSprite(), kit);
}

export const characterGenerator: Generator = {
  id: "character",
  category: "character",
  label: "Character",
  description: "Top-down RPG character (humanoid or slime) with 4-direction walk animation. Choose materials for skin, hair, clothes; headwear and weapon.",
  params: [
    { key: "archetype", label: "Archetype", type: "select", options: ["humanoid", "slime"], default: "humanoid" },
    { key: "build", label: "Build", type: "select", options: ["slim", "normal", "stocky"], default: "normal" },
    { key: "skin", label: "Skin / body", type: "material", options: SKINS, default: "skin" },
    { key: "hair", label: "Hair", type: "material", options: PAINT, default: "hair" },
    { key: "hair_style", label: "Hair style", type: "select", options: ["short", "long", "spiky", "ponytail", "bald"], default: "short" },
    { key: "top", label: "Top", type: "material", options: PAINT, default: "cloth" },
    { key: "bottom", label: "Bottom", type: "material", options: PAINT, default: "leather" },
    { key: "boots", label: "Boots / belt", type: "material", options: PAINT, default: "wood" },
    { key: "headwear", label: "Headwear", type: "select", options: ["none", "helmet", "hood", "wizard", "crown"], default: "none" },
    { key: "weapon", label: "Held item", type: "select", options: ["none", "sword", "staff", "shield", "bow"], default: "none" },
    { key: "accent_mat", label: "Accent (cape, hat, gem)", type: "material", options: PAINT, default: "cloth2" },
    { key: "cape", label: "Cape", type: "bool", default: false },
  ],
  generate(p, kit, seed) {
    void rng(seed); // characters are fully parametric; seed kept for API symmetry
    const size = kit.sizes.character;
    const draw = str(p, "archetype") === "slime" ? drawSlime : drawHumanoid;
    const rows: FrameSet[] = DIRS.map((d) => ({ name: `walk-${d}`, frames: [0, 1, 2, 3].map((f) => draw(p, kit, d, f, size)) }));
    return { rows, fps: 6 };
  },
};

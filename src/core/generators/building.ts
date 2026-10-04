import { finalize } from "../enforce";
import { Painter } from "../painter";
import type { Material } from "../palette";
import { proportions } from "../kit";
import { rng, type Rng } from "../rng";
import { bool, mat, num, str, type Generator } from "./types";

const WALLS: Material[] = ["wood", "stone", "sand", "dirt", "leather", "metal", "ui"];
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

export const buildingGenerator: Generator = {
  id: "building",
  category: "building",
  label: "Building",
  description: "Front-facing 3/4 view building: cottage, shop, tower, keep or barn with wall/roof materials, floors, windows, chimney.",
  params: [
    { key: "style", label: "Style", type: "select", options: ["cottage", "shop", "tower", "keep", "barn"], default: "cottage" },
    { key: "wall", label: "Walls", type: "material", options: WALLS, default: "wood" },
    { key: "roof", label: "Roof", type: "material", options: ROOFS, default: "roof" },
    { key: "roof_style", label: "Roof style", type: "select", options: ["gable", "hip", "flat", "dome", "spire"], default: "gable" },
    { key: "floors", label: "Floors", type: "number", min: 1, max: 3, default: 1 },
    { key: "width", label: "Width", type: "select", options: ["narrow", "normal", "wide"], default: "normal" },
    { key: "lit_windows", label: "Lit windows", type: "bool", default: true },
    { key: "chimney", label: "Chimney", type: "bool", default: true },
    { key: "trim", label: "Trim / door", type: "material", options: ["wood", "stone", "metal", "gold", "leather", "dirt"], default: "wood" },
  ],
  generate(p, kit, seed) {
    const r = rng(seed);
    const S = kit.sizes.building;
    const k = S / 64;
    const pr = proportions(kit);
    const style = str(p, "style");
    const wall = mat(p, "wall"), roof = mat(p, "roof"), trim = mat(p, "trim");
    let roofStyle = str(p, "roof_style");
    const floors = num(p, "floors");
    const tower = style === "tower";
    const widthFrac = tower ? 0.42 : str(p, "width") === "narrow" ? 0.55 : str(p, "width") === "wide" ? 0.9 : 0.72;
    const ww = Math.round((S - 6) * widthFrac);
    const wx = Math.round((S - ww) / 2);
    const storyH = pr.story;
    const wh = storyH * floors + (tower ? Math.round(storyH * 0.4) : 0);
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
      const cw = Math.max(2, Math.round(5 * k));
      const cx = Math.round(wx + ww * 0.72);
      const top = wy - rh - Math.round(5 * k);
      P.box(cx, top, cw, Math.round(9 * k), "stone", [0.2, 0, 1]);
      P.box(cx - 1, top - 1, cw + 2, Math.max(1, Math.round(2 * k)), "stone", [0, -1, 0.5]);
    }
    if (style === "keep") {
      for (let xx = wx; xx < wx + ww; xx += Math.round(6 * k)) P.box(xx, wy - rh - Math.round(4 * k), Math.round(3 * k), Math.round(4 * k), wall, [0, -0.4, 1]);
    }
    return { rows: [{ name: "idle", frames: [finalize(P.toSprite(), kit)] }], fps: 1 };
  },
};

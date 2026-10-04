// Side-view enemies (slime, beetle) with idle and walk rows facing right and left.
// Both are small lit volumes standing on the bottom row of the canvas (1px margin), drawn with
// the same Painter as the hero. The left rows are drawn mirrored (not flipped pixels), so the
// light keeps coming from the kit's side.
import { finalize } from "../enforce";
import { Painter } from "../painter";
import type { Material } from "../palette";
import type { FrameSet, StyleKit } from "../types";
import { mat, str, type Generator } from "./types";

export const ENEMY_KINDS = ["slime", "beetle"] as const;
type Facing = 1 | -1;

/** Canvas: three quarters of the character canvas, so an enemy is a bit smaller than the hero. */
export const enemySize = (kit: StyleKit) => Math.max(12, Math.round(kit.sizes.character * 0.75));

function slime(kit: StyleKit, body: Material, f: Facing, squash: number, lift: number) {
  const S = enemySize(kit), G = S - 2;
  const P = new Painter(S, S, kit);
  const cx = S / 2;
  const ry = S * 0.3 * squash, rx = (S * 0.36) / Math.sqrt(squash); // volume stays roughly constant
  const cy = G - ry * 0.75 - lift;
  P.ellipse(cx, cy, rx, ry, body, { flat: 0.1 });
  // a flat base: the blob sits on the ground instead of hovering as a ball
  for (let y = Math.ceil(G - lift + 0.5); y < S; y++) P.erase(0, y, S, 1);
  // face looks the way it moves; the eyes are details, not shading
  const ex = cx + f * rx * 0.28, ey = Math.round(cy - ry * 0.1);
  const eyeSep = Math.max(2, Math.round(S * 0.17));
  for (const dx of [-eyeSep / 2, eyeSep / 2]) {
    const x = Math.round(ex + dx + f * 0.5);
    P.px(x, ey, "ui", 4);
    if (S >= 20) P.px(x, ey + 1, "ink", 0);
    else P.px(x, ey, "ink", 0);
  }
  if (S >= 20) P.px(Math.round(cx - rx * 0.45), Math.round(cy - ry * 0.55), body, 4); // glint
  return finalize(P.toSprite(), kit);
}

function beetle(kit: StyleKit, shell: Material, f: Facing, step: number, bob: number, feeler: number) {
  const S = enemySize(kit), G = S - 2;
  const P = new Painter(S, S, kit);
  const cx = S / 2, k = S / 24;
  const X = (x: number) => (f > 0 ? x : S - x); // mirror geometry, keep screen-space light
  const bw = S * 0.34, bh = S * 0.22;
  const by = G - Math.max(2, Math.round(3 * k)) - bh - bob;
  // legs: three stubs per side alternate with `step`
  for (let i = 0; i < 3; i++) {
    const lx = cx + (i - 1) * bw * 0.62, ph = (i + step) % 2 ? 1 : -1;
    P.capsule(X(lx), by + bh * 0.4, X(lx + ph * 1.2 * k), G, Math.max(0.6, 0.7 * k), "ink", { tone: 2 });
  }
  P.ellipse(X(cx - S * 0.02), by, bw, bh, shell);
  // wing-case seam and spots
  P.rect(Math.round(X(cx - S * 0.02) - 0.5), Math.round(by - bh * 0.9), 1, Math.round(bh * 1.7), shell, 0);
  for (const [dx, dy] of [[-0.45, -0.2], [0.4, -0.15]]) P.px(Math.round(X(cx + dx * bw)), Math.round(by + dy * bh), "ink", 1);
  // head with eye and horns
  const hx = cx + bw * 0.95, hr = bh * 0.62;
  P.ellipse(X(hx), by + bh * 0.15, hr, hr, "leather", { tone: -1 });
  P.px(Math.round(X(hx + hr * 0.3)), Math.round(by), "ui", 4);
  const tip = feeler;
  P.line(X(hx + hr * 0.2), by - hr * 0.7, X(hx + hr * 0.9 + tip), by - hr * 1.9 - (tip ? 0 : 1), "ink", 2);
  return finalize(P.toSprite(), kit);
}

export const sideEnemyGenerator: Generator = {
  id: "sideenemy",
  category: "character",
  label: "Side-view enemy",
  description: "Simple platformer enemies seen from the side (slime, beetle) with idle and walk rows facing right and left. Sized against the kit's character so they stand on the same ground line as the side hero.",
  params: [
    { key: "kind", label: "Kind", type: "select", options: [...ENEMY_KINDS], default: "slime" },
    { key: "body", label: "Body", type: "material", options: ["foliage", "grass", "water", "accent", "cloth2", "cloth", "gold", "stone", "roof"], default: "foliage" },
  ],
  generate(p, kit) {
    const kind = str(p, "kind"), body = mat(p, "body");
    const rows: FrameSet[] = [];
    for (const [name, f] of [["right", 1], ["left", -1]] as const) {
      if (kind === "beetle") {
        rows.push({ name: `idle-${name}`, frames: [0, 1].map((i) => beetle(kit, body, f, 0, 0, i)) });
        rows.push({ name: `walk-${name}`, frames: [0, 1, 2, 3].map((i) => beetle(kit, body, f, i, i % 2 ? 1 : 0, i % 2)) });
      } else {
        rows.push({ name: `idle-${name}`, frames: [1, 0.9, 1, 1.1].map((sq) => slime(kit, body, f, sq, 0)) });
        // hop: squash, stretch off the ground, apex, land
        rows.push({ name: `walk-${name}`, frames: [[0.8, 0], [1.2, 2], [1.05, 3], [0.85, 0]].map(([sq, lift]) => slime(kit, body, f, sq, Math.round(lift * kit.sizes.character / 32))) });
      }
    }
    return { rows, fps: 6 };
  },
};

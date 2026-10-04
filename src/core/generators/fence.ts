import { finalize } from "../enforce";
import { Painter } from "../painter";
import type { Material } from "../palette";
import type { FrameSet, Sprite, StyleKit } from "../types";

export const FENCE_PIECES = [
  "h", "v", "post",
  "corner-ne", "corner-nw", "corner-se", "corner-sw",
  "t-n", "t-e", "t-s", "t-w",
  "cross", "gate-closed", "gate-open",
] as const;
export type FencePiece = (typeof FENCE_PIECES)[number];

/**
 * Which sides a piece reaches: n e s w. A "t-x" has a branch towards x, so it
 * joins x plus the two sides on the line through the opposite pair... concretely
 * t-n = n+e+w, t-e = n+s+e, t-s = e+s+w, t-w = n+s+w.
 */
const SIDES: Record<string, string> = {
  h: "ew", v: "ns", post: "",
  "corner-ne": "ne", "corner-nw": "nw", "corner-se": "se", "corner-sw": "sw",
  "t-n": "new", "t-e": "nse", "t-s": "esw", "t-w": "nsw",
  cross: "nesw",
};

/**
 * One 16px-grid fence tile. Rails sit on fixed rows (6-7 and 10-11) and fixed
 * columns (7-8 for the vertical rail), posts are centred (cols 6-9), so any two
 * pieces that both reach a shared edge meet pixel for pixel. The scale `k`
 * keeps that true for other tile sizes.
 */
function base(kit: StyleKit) {
  const T = kit.sizes.tile;
  const k = T / 16;
  const R = (n: number) => Math.round(n * k);
  return { T, k, R, P: new Painter(T, T, kit) };
}

type B = ReturnType<typeof base>;

function rail(b: B, x: number, w: number, m: Material) {
  if (w <= 0) return;
  for (const y of [6, 10]) {
    b.P.box(x, b.R(y), w, b.R(2), m, [0, -0.7, 0.7]);
    b.P.box(x, b.R(y) + b.R(1), w, Math.max(1, b.R(1)), m, [0, 0.5, 0.8], { tone: -1 });
  }
}

function vrail(b: B, y: number, h: number, m: Material) {
  if (h > 0) b.P.cylinder(b.R(7), y, Math.max(2, b.R(2)), h, m);
}

function post(b: B, x: number, w: number, top: number, bottom: number, m: Material) {
  b.P.cylinder(x, top + 1, w, bottom - top, m);
  b.P.box(x, top, w, 2, m, [0, -1, 0.35], { tone: 1 });
  b.P.box(x, bottom - 1, w, 1, m, [0, 0.3, 1], { tone: -1 });
}

function leaf(b: B, x: number, w: number, m: Material, brace: boolean) {
  if (w <= 0) return;
  rail(b, x, w, m);
  if (w >= 2) b.P.cylinder(x, b.R(5), Math.min(2, w), b.R(8), m, { tone: -1 });
  if (brace && w >= 6) b.P.line(x + 2, b.R(11), x + w - 3, b.R(6), m, 1);
}

function gateFrame(b: B, w: number, m: Material, openRatio: boolean) {
  // leaf anchored at the left post; `w` shrinks as it swings towards the viewer
  rail(b, 0, 4, m);
  rail(b, 12, 4, m);
  if (!openRatio) leaf(b, 4, w, m, true);
  else leaf(b, 4, w, m, false);
  post(b, 1, 3, 2, 14, m);
  post(b, 12, 3, 2, 14, m);
}

function render(b: B, kit: StyleKit, draw: () => void): Sprite {
  draw();
  return finalize(b.P.toSprite(), kit);
}

export function fenceRows(kit: StyleKit, piece: FencePiece, m: Material): { rows: FrameSet[]; fps: number } {
  const gate = piece === "gate-closed" || piece === "gate-open";
  if (gate) {
    const widths = [8, 6, 4, 3];
    const frames = widths.map((w, i) => {
      const b = base(kit);
      return render(b, kit, () => gateFrame(b, Math.round(w * b.k), m, i > 0));
    });
    const closed = frames[0], open = frames[frames.length - 1];
    return {
      rows: [
        { name: "idle", frames: [piece === "gate-closed" ? closed : open] },
        { name: "open", frames },
      ],
      fps: 6,
    };
  }
  const sides = SIDES[piece] ?? "";
  const b = base(kit);
  const s = render(b, kit, () => {
    const has = (c: string) => sides.includes(c);
    const mid = b.R(8);
    // horizontal rails, then vertical rails, then the post on top
    if (has("w")) rail(b, 0, mid, m);
    if (has("e")) rail(b, mid, b.T - mid, m);
    if (has("n")) vrail(b, 0, mid, m);
    if (has("s")) vrail(b, mid, b.T - mid, m);
    post(b, b.R(6), Math.max(2, b.R(4)), b.R(3), b.R(14), m);
  });
  return { rows: [{ name: "idle", frames: [s] }], fps: 1 };
}

// Colour grading presets, applied in OKLCH on float RGB (0..255, 3 per pixel) before palette selection.
import { oklabToRgb, rgbToOklab } from "../color/oklab";
import type { Preset } from "./types";

export interface GradeSpec {
  /** 0..1 strength of pulling the global colour cast back to neutral. */
  cast: number;
  chroma: number;
  chromaAdd: number;
  contrast: number;
  /** Lightness offset applied to everything. */
  lift: number;
  /** Shadow tint: a/b target, strength k (fade of existing chroma) and lightness drop. */
  shadow: { a: number; b: number; k: number; dark: number };
  /** Highlight tint added to a/b. */
  high: { a: number; b: number };
  /** Global a/b offset (colour wash). */
  wash: { a: number; b: number };
}

const NONE = { a: 0, b: 0 };
export const GRADES: Record<Preset, GradeSpec | null> = {
  neutral: null,
  // The approved look: neutralise cast, richer same-hue chroma, contrast, violet-navy shadows, warm highlights.
  vivid: { cast: 0.45, chroma: 1.55, chromaAdd: 0.012, contrast: 1.25, lift: 0, shadow: { a: 0.05, b: -0.11, k: 0.5, dark: 0.06 }, high: { a: 0.01, b: 0.03 }, wash: NONE },
  neon: { cast: 0.5, chroma: 2.1, chromaAdd: 0.03, contrast: 1.4, lift: -0.03, shadow: { a: 0.09, b: -0.14, k: 0.7, dark: 0.08 }, high: { a: 0.03, b: -0.03 }, wash: { a: 0.012, b: -0.01 } },
  pastel: { cast: 0.3, chroma: 0.8, chromaAdd: 0.01, contrast: 0.8, lift: 0.1, shadow: { a: 0.02, b: -0.03, k: 0.3, dark: 0 }, high: { a: 0.01, b: 0.01 }, wash: NONE },
  warm: { cast: 0.25, chroma: 1.3, chromaAdd: 0.01, contrast: 1.12, lift: 0.01, shadow: { a: 0.04, b: -0.02, k: 0.35, dark: 0.04 }, high: { a: 0.02, b: 0.05 }, wash: { a: 0.012, b: 0.03 } },
  cool: { cast: 0.25, chroma: 1.25, chromaAdd: 0.01, contrast: 1.12, lift: 0, shadow: { a: 0, b: -0.12, k: 0.5, dark: 0.05 }, high: { a: -0.01, b: -0.01 }, wash: { a: -0.012, b: -0.035 } },
  sepia: { cast: 0, chroma: 0.12, chromaAdd: 0, contrast: 1.1, lift: 0.02, shadow: { a: 0.01, b: 0.02, k: 0.3, dark: 0.03 }, high: { a: 0.01, b: 0.02 }, wash: { a: 0.028, b: 0.065 } },
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Grade float RGB in place. A null spec (neutral) leaves pixels untouched. */
export function grade(rgb: Float32Array, preset: Preset): void {
  const g = GRADES[preset];
  if (!g) return;
  const n = rgb.length / 3;
  let sr = 0, sg = 0, sb = 0;
  for (let i = 0; i < n; i++) { sr += rgb[i * 3]; sg += rgb[i * 3 + 1]; sb += rgb[i * 3 + 2]; }
  const mr = sr / n / 255 + 1e-6, mg = sg / n / 255 + 1e-6, mb = sb / n / 255 + 1e-6, mm = (mr + mg + mb) / 3;
  // Clamped so a legitimately warm scene (sunset sand) is not pushed to lavender.
  const f = (m: number) => Math.min(1.15, Math.max(0.9, (mm / m) ** g.cast));
  const fr = f(mr), fg = f(mg), fb = f(mb);
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    const [L0, a0, b0] = rgbToOklab(Math.min(255, rgb[o] * fr), Math.min(255, rgb[o + 1] * fg), Math.min(255, rgb[o + 2] * fb));
    const C = Math.hypot(a0, b0) * g.chroma + g.chromaAdd, H = Math.atan2(b0, a0);
    let L = clamp01((L0 - 0.5) * g.contrast + 0.5 + g.lift);
    const sh = clamp01((0.55 - L) / 0.4) ** 1.2, hi = clamp01((L - 0.7) / 0.3);
    const a = C * Math.cos(H) * (1 - sh * g.shadow.k) + sh * g.shadow.a + hi * g.high.a + g.wash.a;
    const b = C * Math.sin(H) * (1 - sh * g.shadow.k) + sh * g.shadow.b + hi * g.high.b + g.wash.b;
    L -= sh * g.shadow.dark;
    const [r, gg, bb] = oklabToRgb(L, a, b);
    rgb[o] = r; rgb[o + 1] = gg; rgb[o + 2] = bb;
  }
}

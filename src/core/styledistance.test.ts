import { describe, expect, it } from "vitest";
import { styleDistance, type RefImage } from "./refstyle";

/** Shaded ball with a dark outline on a transparent background, tinted by (dr, dg, db). */
function ball(size = 32, shift: [number, number, number] = [0, 0, 0]): RefImage {
  const data = new Uint8Array(size * size * 4);
  const c = size / 2, r = size / 2 - 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c, dy = y + 0.5 - c, d = Math.hypot(dx, dy);
      if (d > r) continue;
      const o = (y * size + x) * 4;
      const edge = d > r - 1.2;
      const lit = Math.max(0, Math.min(1, 0.5 - (dx + dy) / (2 * r)));
      const step = Math.round(lit * 3) / 3;
      const base = edge ? [30, 24, 40] : [60 + step * 150, 110 + step * 110, 50 + step * 60];
      for (let k = 0; k < 3; k++) data[o + k] = Math.max(0, Math.min(255, base[k] + (edge ? 0 : shift[k])));
      data[o + 3] = 255;
    }
  return { w: size, h: size, data };
}

function blur(img: RefImage, radius: number): RefImage {
  const out = new Uint8Array(img.w * img.h * 4);
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (let j = -radius; j <= radius; j++)
        for (let i = -radius; i <= radius; i++) {
          const xx = Math.min(img.w - 1, Math.max(0, x + i)), yy = Math.min(img.h - 1, Math.max(0, y + j));
          for (let k = 0; k < 4; k++) acc[k] += img.data[(yy * img.w + xx) * 4 + k];
          n++;
        }
      for (let k = 0; k < 4; k++) out[(y * img.w + x) * 4 + k] = Math.round(acc[k] / n);
    }
  return { w: img.w, h: img.h, data: out };
}

describe("styleDistance", () => {
  it("scores identical images 100 with all components 1", () => {
    const a = ball();
    const r = styleDistance(a, ball());
    expect(r.score).toBe(100);
    for (const v of Object.values(r.components)) expect(v).toBe(1);
    expect(r.notes.length).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const a = ball(32, [10, 40, 90]), b = ball();
    expect(JSON.stringify(styleDistance(a, b))).toBe(JSON.stringify(styleDistance(a, b)));
  });

  it("falls monotonically as the palette shifts", () => {
    const ref = ball();
    const scores = [0, 20, 50, 100].map((s) => styleDistance(ball(32, [s, -s / 2, s * 1.5]), ref).score);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThan(scores[i - 1]);
  });

  it("falls monotonically under increasing blur", () => {
    const ref = ball();
    const scores = [0, 1, 2, 3].map((r) => styleDistance(r ? blur(ref, r) : ref, ref).score);
    for (let i = 1; i < scores.length; i++) expect(scores[i]).toBeLessThan(scores[i - 1]);
  });

  it("gives actionable notes for a very different asset", () => {
    const flat: RefImage = { w: 32, h: 8, data: new Uint8Array(32 * 8 * 4).fill(200) };
    const r = styleDistance(flat, ball());
    expect(r.score).toBeLessThan(60);
    expect(r.notes.join(" ")).toMatch(/kit_from_reference|Silhouette|outline/i);
  });

  it("treats a pixel-art upscale like the original", () => {
    const a = ball(32);
    const up = new Uint8Array(128 * 128 * 4);
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) for (let k = 0; k < 4; k++) up[(y * 128 + x) * 4 + k] = a.data[((y >> 2) * 32 + (x >> 2)) * 4 + k];
    expect(styleDistance(a, { w: 128, h: 128, data: up }).score).toBeGreaterThan(95);
  });
});

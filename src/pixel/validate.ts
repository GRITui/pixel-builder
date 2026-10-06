import type { Rgba } from "./types";

export interface ValidateOptions {
  /** Max distinct opaque colours. */
  maxColours?: number;
  /** If img is an upscaled preview, every scale x scale block must be one colour. */
  scale?: number;
}
export interface ValidateReport {
  ok: boolean;
  issues: string[];
  colours: number;
  width: number;
  height: number;
}

export function validate(img: Rgba, opts: ValidateOptions = {}): ValidateReport {
  const issues: string[] = [];
  const colours = new Set<number>();
  let badAlpha = 0;
  for (let i = 0; i < img.w * img.h; i++) {
    const a = img.data[i * 4 + 3];
    if (a !== 0 && a !== 255) badAlpha++;
    if (a === 255) colours.add((img.data[i * 4] << 16) | (img.data[i * 4 + 1] << 8) | img.data[i * 4 + 2]);
  }
  if (badAlpha) issues.push(`${badAlpha} pixels have partial alpha; alpha must be 0 or 255`);
  if (opts.maxColours !== undefined && colours.size > opts.maxColours) issues.push(`${colours.size} colours exceeds the limit of ${opts.maxColours}`);
  const k = opts.scale;
  if (k && k > 1) {
    if (img.w % k || img.h % k) issues.push(`size ${img.w}x${img.h} is not a multiple of scale ${k}`);
    else {
      let bad = 0;
      const d = img.data;
      for (let by = 0; by < img.h / k; by++) for (let bx = 0; bx < img.w / k; bx++) {
        const o = ((by * k) * img.w + bx * k) * 4;
        let uniform = true;
        for (let y = 0; y < k && uniform; y++) for (let x = 0; x < k; x++) {
          const p = ((by * k + y) * img.w + bx * k + x) * 4;
          if (d[p] !== d[o] || d[p + 1] !== d[o + 1] || d[p + 2] !== d[o + 2] || d[p + 3] !== d[o + 3]) { uniform = false; break; }
        }
        if (!uniform) bad++;
      }
      if (bad) issues.push(`${bad} of ${(img.w / k) * (img.h / k)} ${k}x${k} blocks are not one solid colour`);
    }
  }
  return { ok: issues.length === 0, issues, colours: colours.size, width: img.w, height: img.h };
}

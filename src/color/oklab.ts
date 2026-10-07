// sRGB <-> linear <-> OKLab / OKLCH (Bjorn Ottosson's matrices). Channels are 0..255 sRGB unless noted.
export type Vec3 = [number, number, number];

export const srgbToLinear = (c: number): number => {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
export const linearToSrgb = (l: number): number => {
  const x = Math.min(1, Math.max(0, l));
  return 255 * (x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055);
};

export function rgbToOklab(r: number, g: number, b: number): Vec3 {
  const lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Returns clamped 0..255 sRGB (not rounded). */
export function oklabToRgb(L: number, a: number, b: number): Vec3 {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

export const oklabToOklch = ([L, a, b]: Vec3): Vec3 => [L, Math.hypot(a, b), Math.atan2(b, a)];
export const oklchToOklab = ([L, C, H]: Vec3): Vec3 => [L, C * Math.cos(H), C * Math.sin(H)];

export const rgbToHex = (r: number, g: number, b: number): string =>
  "#" + [r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("");

export function hexToRgb(hex: string): Vec3 {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`'${hex}' is not a #rrggbb colour`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Squared OKLab distance; w scales the a/b (chroma) axes. */
export const labDist2 = (p: Vec3, q: Vec3, w = 1): number =>
  (p[0] - q[0]) ** 2 + w * w * ((p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2);

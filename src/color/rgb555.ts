// 15-bit colour (SNES / GBA): 5 bits per channel, replicated back to 8 bits.
export const to555 = (v: number): number => Math.round((Math.min(255, Math.max(0, v)) * 31) / 255);
export const from555 = (v5: number): number => (v5 << 3) | (v5 >> 2);
/** Snap an 8-bit channel to the nearest representable 5-bit level. */
export const snap555 = (v: number): number => from555(to555(v));
export const pack555 = (r: number, g: number, b: number): number => (to555(b) << 10) | (to555(g) << 5) | to555(r);
export const unpack555 = (c: number): [number, number, number] => [from555(c & 31), from555((c >> 5) & 31), from555((c >> 10) & 31)];

// Shared types for the pixelizer. The core lane (#105) fills in the pipeline; these are the contract.
export interface Rgba {
  w: number;
  h: number;
  /** w*h*4 bytes, straight (non-premultiplied) alpha. */
  data: Uint8ClampedArray;
}

export type Era = 8 | 16 | 32 | 64;
export type Mode = "scene" | "sprite" | "tile";
export type Preset = "vivid" | "neon" | "pastel" | "warm" | "cool" | "sepia" | "neutral";
export type Bloom = "off" | "low" | "med" | "high";
export type Dither = "off" | "low" | "med";
export type Effect = "rain" | "snow" | "shimmer" | "flicker" | "bloom_pulse";

export const PRESETS: Preset[] = ["vivid", "neon", "pastel", "warm", "cool", "sepia", "neutral"];
export const BLOOMS: Bloom[] = ["off", "low", "med", "high"];
export const DITHERS: Dither[] = ["off", "low", "med"];
export const MODES: Mode[] = ["scene", "sprite", "tile"];
export const EFFECTS: Effect[] = ["rain", "snow", "shimmer", "flicker", "bloom_pulse"];

/** palette rule: "free" = k-means to N colours; "hardware" = pick N from a fixed palette; "rgb555" = 15-bit snapped. */
export interface EraSpec {
  /** Default native width in pixels (sprite/tile modes take an exact size instead). */
  width: number;
  /** Max colours in the result. */
  colours: number;
  palette: "hardware-nes" | "rgb555" | "free";
}

export const ERAS: Record<Era, EraSpec> = {
  8: { width: 160, colours: 24, palette: "hardware-nes" },
  16: { width: 320, colours: 48, palette: "rgb555" },
  32: { width: 480, colours: 128, palette: "free" },
  64: { width: 720, colours: 256, palette: "free" },
};

export interface PixelOptions {
  mode?: Mode;
  era?: Era;
  preset?: Preset;
  bloom?: Bloom;
  dither?: Dither;
  outline?: boolean;
  /** Native width (scene/tile) or exact [w,h] (sprite). Defaults from ERAS. */
  width?: number;
  height?: number;
  seed?: number;
  /** A locked project look overrides era/preset/bloom/dither/outline/palette. */
  look?: Look;
}

export interface Look {
  id: string;
  name: string;
  era: Era;
  palette: string[];
  preset: Preset;
  bloom: Bloom;
  dither: Dither;
  outline: boolean;
}

export interface PixelMeta {
  era: Era;
  mode: Mode;
  width: number;
  height: number;
  colours: number;
  seed: number;
  preset: Preset;
  bloom: Bloom;
  dither: Dither;
  outline: boolean;
  [k: string]: unknown;
}

export interface PixelResult {
  /** True pixel art at native size: one solid colour per pixel, alpha 0/255. */
  native: Rgba;
  /** #rrggbb palette actually used. */
  palette: string[];
  meta: PixelMeta;
}

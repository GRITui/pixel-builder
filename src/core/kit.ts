import { MATERIALS, PALETTES, type Ramps } from "./palette";
import type { LightDir, StyleKit } from "./types";

export const DEFAULT_KIT: StyleKit = {
  id: "kit-default",
  name: "Cozy RPG",
  paletteId: "hearthwood",
  rampOverrides: {},
  outline: "selective",
  lightDir: "top-left",
  shadeSteps: 4,
  dither: false,
  ambient: 0.25,
  sizes: { character: 32, building: 64, environment: 32, object: 16, ui: 16, tile: 16 },
  vibe: "Cozy top-down fantasy RPG, chunky readable silhouettes, warm lighting, SNES-era charm.",
};

export const KIT_PRESETS: StyleKit[] = [
  DEFAULT_KIT,
  {
    ...DEFAULT_KIT,
    id: "kit-gameboy",
    name: "Handheld Classic",
    paletteId: "gameboy",
    outline: "black",
    shadeSteps: 3,
    dither: true,
    ambient: 0.1,
    sizes: { character: 16, building: 48, environment: 16, object: 16, ui: 16, tile: 16 },
    vibe: "Classic 4-tone handheld game, tiny sprites, strong black outlines, dithered shading.",
  },
  {
    ...DEFAULT_KIT,
    id: "kit-neon",
    name: "Neon Dusk",
    paletteId: "neon-dusk",
    outline: "colored",
    lightDir: "top-right",
    shadeSteps: 5,
    dither: true,
    ambient: 0.35,
    vibe: "Moody synthwave fantasy at dusk, saturated rim light, soft colored outlines.",
  },
];

export function resolveRamps(kit: StyleKit): Ramps {
  const base = (PALETTES.find((p) => p.id === kit.paletteId) ?? PALETTES[0]).ramps;
  const out = {} as Ramps;
  for (const m of MATERIALS) out[m] = kit.rampOverrides[m] ?? base[m];
  return out;
}

/** Light vector in screen space (x right, y down, z toward viewer), normalised. */
export function lightVector(dir: LightDir): [number, number, number] {
  const v: [number, number, number] =
    dir === "top-left" ? [-0.55, -0.6, 0.58] : dir === "top-right" ? [0.55, -0.6, 0.58] : [0, -0.75, 0.66];
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
}

export function newId(prefix = "id"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

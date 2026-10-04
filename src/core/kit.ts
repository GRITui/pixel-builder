import { hueShiftRamps, MATERIALS, PALETTES, type Ramps } from "./palette";
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
  sizes: { character: 32, building: 96, environment: 32, object: 16, ui: 16, tile: 16 },
  vibe: "Cozy top-down fantasy RPG, chunky readable silhouettes, warm lighting, SNES-era charm.",
};

/** Rich kit (not in KIT_PRESETS: tools/tests pin the preset list): Cozy RPG with hue-shifted ramps, sel-out, anti-aliased curves and micro-detail. */
export const RICH_KIT: StyleKit = {
  ...DEFAULT_KIT,
  id: "kit-rich",
  name: "Cozy RPG (rich)",
  detail: "rich",
  vibe: "Cozy top-down fantasy RPG with richer pixels: hue-shifted shading, selective outlines, fine detail.",
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
    sizes: { character: 16, building: 64, environment: 16, object: 16, ui: 16, tile: 16 },
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
  return kit.detail === "rich" ? hueShiftRamps(out) : out;
}

/** Light vector in screen space (x right, y down, z toward viewer), normalised. */
export function lightVector(dir: LightDir): [number, number, number] {
  const v: [number, number, number] =
    dir === "top-left" ? [-0.55, -0.6, 0.58] : dir === "top-right" ? [0.55, -0.6, 0.58] : [0, -0.75, 0.66];
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
}

/**
 * World-scale contract. Every generator sizes its subject from the kit's
 * character size so separately generated assets sit in one world: a door is
 * a little taller than a person, a mature tree about twice as tall, a storey
 * a bit taller than the door. Canvas sizes (kit.sizes) are only the frames.
 */
export function proportions(kit: StyleKit) {
  const c = kit.sizes.character;
  return {
    /** Standing character height, head to feet (the humanoid fills ~84% of its canvas). */
    figure: Math.round(c * 0.84),
    door: Math.round(c * 0.92),
    doorW: Math.max(3, Math.round(c * 0.5)),
    window: Math.max(2, Math.round(c * 0.28)),
    story: Math.round(c * 1.15),
    tree: Math.round(c * 1.9),
    tile: kit.sizes.tile,
  };
}

export function newId(prefix = "id"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

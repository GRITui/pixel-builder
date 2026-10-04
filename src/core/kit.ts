import { deepenRamp, hueShiftRamps, MATERIALS, normalizeDepth, PALETTES, type Ramps } from "./palette";
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

/** HD kit: the Cozy RPG look with every size scaled 1.5x (48px characters) so world scale stays consistent. */
export const HD_KIT: StyleKit = {
  ...DEFAULT_KIT,
  id: "kit-hd",
  name: "Cozy RPG HD",
  sizes: { character: 48, building: 144, environment: 48, object: 24, ui: 24, tile: 24 },
  vibe: "Cozy top-down fantasy RPG at 1.5x resolution: richer 48px characters, same warm lighting and world scale.",
};

export const HD_RICH_KIT: StyleKit = {
  ...HD_KIT,
  id: "kit-hd-rich",
  name: "Cozy RPG HD (rich)",
  detail: "rich",
  vibe: "Cozy top-down fantasy RPG at 1.5x resolution with richer pixels: hue-shifted shading, selective outlines, fine detail.",
};

/** Side-view (platformer) kit: standard detail, same palette and light as Cozy RPG, characters 2 tiles tall. */
export const SIDE_KIT: StyleKit = {
  ...DEFAULT_KIT,
  id: "kit-side",
  name: "Cozy Platformer",
  camera: "side",
  vibe: "Cozy side-view platformer, profile characters standing on a ground line, chunky readable silhouettes, warm lighting.",
};

/** HD kit with 9-shade hue-shifted ramps: the lit Painter uses the extra shades for smooth volumes. */
export const HD_DEEP_KIT: StyleKit = {
  ...HD_RICH_KIT,
  id: "kit-hd-deep",
  name: "Cozy RPG HD (deep)",
  rampDepth: 9,
  vibe: "Cozy top-down fantasy RPG at 1.5x resolution with deep 9-shade ramps: smooth hue-shifted volumes, selective outlines, fine detail.",
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
  HD_KIT,
  HD_RICH_KIT,
  SIDE_KIT,
  HD_DEEP_KIT,
];

export function resolveRamps(kit: StyleKit): Ramps {
  const base = (PALETTES.find((p) => p.id === kit.paletteId) ?? PALETTES[0]).ramps;
  const out = {} as Ramps;
  for (const m of MATERIALS) out[m] = kit.rampOverrides[m] ?? base[m];
  const depth = normalizeDepth(kit.rampDepth);
  const shifted = kit.detail === "rich" || depth > 5 ? hueShiftRamps(out) : out;
  if (depth === 5) return shifted;
  const deep = {} as Ramps;
  for (const m of MATERIALS) deep[m] = deepenRamp(shifted[m], depth);
  return deep;
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
  // Side view: the camera sees the profile, so buildings and trees are drawn as facades
  // (taller storeys) and everything stands on the bottom row of its canvas.
  if (kit.camera === "side")
    return {
      figure: Math.round(c * 0.84),
      door: Math.round(c * 0.92),
      doorW: Math.max(3, Math.round(c * 0.5)),
      window: Math.max(2, Math.round(c * 0.28)),
      story: Math.round(c * 1.4),
      tree: Math.round(c * 1.9),
      tile: kit.sizes.tile,
    };
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

/** Fork of a kit: a new unlocked kit at version 1. */
export function forkKit(src: StyleKit, name: string): StyleKit {
  const { locked: _l, version: _v, ...rest } = JSON.parse(JSON.stringify(src)) as StyleKit;
  return { ...rest, id: newId("kit"), name };
}

export const kitVersion = (k: StyleKit): number => k.version ?? 1;

export function newId(prefix = "id"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

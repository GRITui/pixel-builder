/**
 * "Tokyo Midnight": an isometric Japanese street corner (crossroads, konbini, izakaya, apartments, vending machines,
 * chochin lanterns, utility poles, a yatai cart, a neon kanji sign, a taxi, a manhole...) from the urban night set.
 *
 *   npx tsx scripts/tokyo-midnight.ts <out.png> [scale] [seed]        (TIME=night|dusk|dawn for the existing grade, FX=rich, WET=damp|rain)
 *
 * `renderTokyo` returns the day image plus the LitObject list (with emitters) so a lighting pass can light it later.
 */
import { pathToFileURL } from "node:url";
import { ISO_KIT } from "../src/core/kit";
import { applyLighting, type GradeFx, type LitObject, type TimeOfDay } from "../src/core/lighting";
import { buildStreet } from "../src/core/generators/urban-iso";
import type { Sprite, StyleKit, TileMap } from "../src/core/types";
import type { Wet } from "../src/core/wet";
import { savePng } from "./sheet";

export interface TokyoScene { image: Sprite; objects: LitObject[]; tilemap: TileMap; lights: { x: number; y: number; r: number; kind: string; color?: string }[] }

/** The crossroads scene (day) and everything a lighting pass needs. */
export function renderTokyo(kit: StyleKit = ISO_KIT, seed = 1): TokyoScene {
  const { tm, image, objects, meta } = buildStreet(kit, 16, 16, seed, 1);
  return { image, objects, tilemap: tm, lights: meta.lights };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , out, scale = "3", seedArg = "1"] = process.argv;
  if (!out) throw new Error("usage: tsx scripts/tokyo-midnight.ts <out.png> [scale] [seed]");
  const time = process.env.TIME as TimeOfDay | undefined;
  const scene = renderTokyo(ISO_KIT, Number(seedArg));
  const img = time ? applyLighting(scene.image, scene.objects, ISO_KIT, { time, fx: (process.env.FX as GradeFx) ?? "classic", wet: (process.env.WET as Wet) ?? "dry", seed: Number(seedArg), shadows: true }) : scene.image;
  savePng(out, [[img]], ISO_KIT, Number(scale));
  console.log(`wrote ${out} (${img.w}x${img.h}, ${scene.lights.length} lights)`);
}

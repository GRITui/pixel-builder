/**
 * "Tokyo Midnight": an isometric Japanese street corner (crossroads, konbini, izakaya, apartments, vending machines,
 * chochin lanterns, utility poles, a yatai cart, a neon kanji sign, a taxi, a manhole...) from the urban night set.
 *
 *   npx tsx scripts/tokyo-midnight.ts <out.png> [scale] [seed]      (TIME=night|dusk|dawn, FX=rich, WET=damp|rain, FULL=1 for the whole map)
 *
 * The default view is a street-level camera crop centred on the crossroads that fills the frame (no transparent
 * background). `renderTokyo` returns the day image plus the LitObject list (with emitters) so a lighting pass can light it.
 */
import { pathToFileURL } from "node:url";
import { ISO_KIT } from "../src/core/kit";
import { applyLighting, type GradeFx, type LitObject, type TimeOfDay } from "../src/core/lighting";
import { buildStreet, mapOffset } from "../src/core/generators/urban-iso";
import { createSprite } from "../src/core/sprite";
import type { Sprite, StyleKit, TileMap } from "../src/core/types";
import type { Wet } from "../src/core/wet";
import { savePng } from "./sheet";

export interface TokyoScene { image: Sprite; objects: LitObject[]; tilemap: TileMap; lights: { x: number; y: number; r: number; kind: string; color?: string }[]; /** crossroads centre in image px */ centre: [number, number] }

/** The crossroads scene (day) and everything a lighting pass needs. The map is larger than the camera so the crop never shows the map edge. */
export function renderTokyo(kit: StyleKit = ISO_KIT, seed = 1, size = 30): TokyoScene {
  const { tm, image, objects, meta } = buildStreet(kit, size, size, seed, 1);
  const [ox, oy] = mapOffset(tm), T = tm.tile;
  // the shared vertex of the four intersection cells
  const centre: [number, number] = [(size * T) / 2 - ox, ((meta.cc + meta.rc + 2) * T) / 4 - oy];
  return { image, objects, tilemap: tm, lights: meta.lights, centre };
}

/** Camera: a w x h window around the crossroads (shifted up a little so rooftops are cut by the frame, not the road). */
export function cropAround(img: Sprite, centre: [number, number], w: number, h: number, up = 14): Sprite {
  const x0 = Math.round(centre[0] - w / 2), y0 = Math.round(centre[1] - up - h / 2), o = createSprite(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o.data[y * w + x] = img.data[(y + y0) * img.w + x + x0] ?? 0;
  return o;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , out, scale = "3", seedArg = "1"] = process.argv;
  if (!out) throw new Error("usage: tsx scripts/tokyo-midnight.ts <out.png> [scale] [seed]");
  const time = process.env.TIME as TimeOfDay | undefined;
  const scene = renderTokyo(ISO_KIT, Number(seedArg));
  let img = time ? applyLighting(scene.image, scene.objects, ISO_KIT, { time, fx: (process.env.FX as GradeFx) ?? "classic", wet: (process.env.WET as Wet) ?? "dry", seed: Number(seedArg), shadows: true }) : scene.image;
  if (!process.env.FULL) img = cropAround(img, scene.centre, Number(process.env.CW ?? 300), Number(process.env.CH ?? 220), Number(process.env.UP ?? 14));
  savePng(out, [[img]], ISO_KIT, Number(scale));
  console.log(`wrote ${out} (${img.w}x${img.h}, ${scene.lights.length} lights)`);
}

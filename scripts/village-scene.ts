/**
 * The Sprint 8 exit image: a village (main street with shops, inn, smithy and a Thai-or-western temple, a plaza with a
 * well-house and market stalls, houses on a second lane, a windmill at the edge) made of rich 3/4 buildings at person
 * scale. Day, night (lit windows, lamp posts, the forge) and a living gif: smoke, windmill sails, swaying trees and
 * villagers walking the street, y-sorted so they pass behind lamp posts and trunks.
 *
 *   npx tsx scripts/village-scene.ts                  # docs/img/village-scene.png (day) + village-scene-night.png
 *   npx tsx scripts/village-scene.ts out.png kit-hd-rich [seed]     (TIME=night for the lit version, FX=rich for the cinematic grade, WET=damp|rain for wet streets)
 *   npx tsx scripts/village-scene.ts --gif            # docs/img/village-scene.gif
 */
import { writeFileSync } from "node:fs";
import { KIT_PRESETS } from "../src/core/kit";
import { GENERATORS, defaults } from "../src/core/generators";
import { mapObjects } from "../src/core/generators/map";
import { colorIndex, decodeIndex } from "../src/core/palette";
import { renderRig } from "../src/core/rig";
import { attachmentById, CLIPS, rigById, withHumanoidDefaults } from "../src/core/rigs";
import { blit, bounds, cloneSprite, createSprite } from "../src/core/sprite";
import { renderTileMap } from "../src/core/tilemap";
import { addRain, mapAnimator, renderMapFrames } from "../src/core/mapanim";
import { castLight, findLights, grade, mapLitObjects, type GradeFx, type TimeOfDay } from "../src/core/lighting";
import { wetField, wetGlow, wetGround, type Wet } from "../src/core/wet";
import { encodeGif } from "../src/node/gif";
import { kitColorsFx as kitColors } from "../src/node/png";
import type { Sprite, StyleKit, TileMap } from "../src/core/types";
import { savePng } from "./sheet";

const COLS = 44, ROWS = 36;
const SCALE = Number(process.env.SCALE ?? 2);

function cropBox(s: Sprite, b: { x0: number; y0: number; x1: number; y1: number }): Sprite {
  const o = createSprite(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1);
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) o.data[(y - b.y0) * o.w + x - b.x0] = s.data[y * s.w + x];
  return o;
}
const unionBox = (ss: Sprite[]) => ss.map((s) => bounds(s)!).reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }));

interface Actor { rig: string; attachments: string[]; slots: Record<string, string>; clip: string }
const LOOKS: Record<string, Actor> = {
  merchant: { rig: "human-male-senior", attachments: ["hat-cap", "costume-overalls"], slots: { top: "cloth2", bottom: "leather" }, clip: "walk" },
  woman: { rig: "human-female-young-adult", attachments: ["hat-bonnet", "costume-dress", "basket"], slots: { top: "accent", hair: "hair" }, clip: "carry" },
  farmer: { rig: "human-male-young-adult", attachments: ["straw-hat", "costume-overalls"], slots: { top: "cloth2", bottom: "cloth" }, clip: "walk" },
  kid: { rig: "human-male-kid", attachments: ["hat-cap"], slots: { top: "cloth" }, clip: "walk" },
  smith: { rig: "human-male-young-adult", attachments: ["costume-overalls"], slots: { top: "leather", bottom: "metal" }, clip: "walk" },
};

function walkFrames(a: Actor, dir: string, kit: StyleKit): Sprite[] {
  const lib = rigById(a.rig)!;
  const atts = withHumanoidDefaults(lib.rig, a.attachments.map((id) => attachmentById(id)!.attachment));
  const clip = CLIPS.find((c) => c.clip.id === a.clip && c.family === "humanoid")!.clip;
  const rows = renderRig({ rig: lib.rig, kit, slots: a.slots as never, attachments: atts }, [clip], { directions: 4 });
  return rows.find((r) => r.name === `${a.clip}-${dir}`)!.frames;
}

export const renderScene = (kit: StyleKit, seed: number, time?: TimeOfDay, fx: GradeFx = "classic", wet?: Wet): Sprite => renderSceneFrames(kit, seed, 1, time, fx, wet)[0];

/** n = 1: the still scene. n > 1: a living loop (use a multiple of 12 for a seamless one). */
export function renderSceneFrames(kit: StyleKit, seed: number, n: number, time?: TimeOfDay, fx: GradeFx = "classic", wet: Wet = "dry"): Sprite[] {
  const gen = (id: string, p: object, s = 1) => {
    const g = GENERATORS.find((x) => x.id === id)!;
    return g.generate({ ...defaults(g), ...p } as never, kit, s);
  };
  const T = kit.sizes.tile;
  const map = gen("map", { biome: "village", cols: COLS, rows: ROWS, detail: "medium", density: 0.55, set: process.env.SET ?? "normal" }, seed);
  const tm = map.tilemap as TileMap;
  const meta = map.meta as { street: { y: number; h: number }; plaza: { cx: number; y0: number; y1: number } | null };
  const groundOnly: TileMap = { ...tm, deco: tm.deco.map(() => -1) };
  const baseWorld = cloneSprite(renderTileMap(groundOnly));
  const animated = n > 1;
  const groundFrames = animated ? renderMapFrames(groundOnly, kit, n, seed) : [baseWorld];
  const anim = animated ? mapAnimator(tm, kit, seed) : null;

  type Item = { sprite: Sprite; x: number; y: number; shadow?: number; tile?: { i: number; col: number; row: number } };
  const items: Item[] = mapObjects(tm).map((o) => {
    const sp = tm.tiles[o.tile].sprite;
    return { sprite: sp, x: o.x - sp.w / 2, y: o.y - sp.h, tile: { i: o.tile, col: o.col, row: o.row } };
  });

  // villagers walk back and forth along free path rows; a still frame catches each one mid-street
  const { street, plaza } = meta;
  const lane = ROWS - 4;
  interface Walker { look: string; row: number; x0: number; x1: number; phase: number; speed: number; dir0: 1 | -1 }
  const walkers: Walker[] = [
    { look: "merchant", row: street.y + 1, x0: 4, x1: COLS - 14, phase: 0.18, speed: 1, dir0: 1 },
    { look: "woman", row: street.y + 2, x0: 12, x1: COLS - 5, phase: 0.62, speed: 1, dir0: -1 },
    { look: "kid", row: street.y + 1, x0: 20, x1: COLS - 4, phase: 0.4, speed: 1, dir0: -1 },
    ...(plaza ? [{ look: "smith", row: plaza.y0 + 4, x0: plaza.cx - 4, x1: plaza.cx + 5, phase: 0.1, speed: 1, dir0: 1 as const }] : []),
    { look: "farmer", row: lane, x0: 3, x1: COLS - 4, phase: 0.55, speed: 1, dir0: 1 },
  ];
  const frames = new Map<string, Sprite[]>();
  const crewBox = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
  for (const w of walkers) for (const d of ["left", "right"]) {
    const fr = walkFrames(LOOKS[w.look], d, kit);
    frames.set(`${w.look}:${d}`, fr);
  }
  for (const w of walkers) crewBox.set(w.look, unionBox(["left", "right"].flatMap((d) => frames.get(`${w.look}:${d}`)!)));
  const crew = walkers.map((w) => {
    const sp0 = cropBox(frames.get(`${w.look}:right`)![0], crewBox.get(w.look)!);
    const item: Item = { sprite: sp0, x: 0, y: 0, shadow: 0.4 * sp0.w };
    items.push(item);
    return { w, item };
  });
  const place = (f: number) => {
    for (const { w, item } of crew) {
      const u = (animated ? f / n : 0) + w.phase;
      const span = (w.x1 - w.x0) * T;
      // triangle wave: right, then back left
      const tri = (u * 2) % 2, along = tri < 1 ? tri : 2 - tri;
      const right = (w.dir0 > 0) === (tri < 1);
      const fx = w.x0 * T + T / 2 + along * span, dir = right ? "right" : "left";
      const fr = frames.get(`${w.look}:${dir}`)!;
      const step = Math.floor((along * span) / (T * 0.5)) % fr.length;
      const sp = cropBox(fr[animated ? step : 1 % fr.length], crewBox.get(w.look)!);
      Object.assign(item, { sprite: sp, x: Math.round(fx - sp.w / 2), y: (w.row + 1) * T - 3 - sp.h });
    }
  };

  const wetOn = wet !== "dry";
  const field = wetOn ? wetField(baseWorld, mapLitObjects(tm), kit, { wet: wet as "damp" | "rain", seed, time: time ?? "day" }) : null;
  const compose = (f: number): Sprite => {
    let world = cloneSprite(groundFrames[f % groundFrames.length]);
    if (animated) for (const it of items) if (it.tile) it.sprite = anim!.deco(it.tile.i, it.tile.col, it.tile.row, f);
    place(f);
    if (time) world = castLight(world, mapLitObjects(tm), kit, { seed });
    if (field) world = wetGround(world, field);
    const sorted = [...items].sort((a, b) => a.y + a.sprite.h - (b.y + b.sprite.h) || a.x - b.x);
    const keepHue = new Uint8Array(world.w * world.h);
    for (const it of sorted) {
      for (let y = 0; y < it.sprite.h; y++) for (let x = 0; x < it.sprite.w; x++) {
        const X = it.x + x, Y = it.y + y;
        if (it.sprite.data[y * it.sprite.w + x] && X >= 0 && Y >= 0 && X < world.w && Y < world.h) keepHue[Y * world.w + X] = it.shadow ? 1 : 0;
      }
      if (it.shadow) shadowUnder(world, it.x + it.sprite.w / 2, it.y + it.sprite.h - 1, it.shadow);
      blit(world, it.sprite, it.x, it.y);
    }
    if (time) {
      const carried = crew.map((c) => ({ x: c.item.x + c.item.sprite.w / 2, y: c.item.y + c.item.sprite.h * 0.6, r: 22 }));
      world = grade(world, kit, time, findLights(mapLitObjects(tm), carried), seed, keepHue, fx);
    }
    if (field) world = wetGlow(world, field, time ?? "day");
    return world;
  };
  const out = Array.from({ length: animated ? n : 1 }, (_, f) => compose(f));
  return wet === "rain" ? addRain(out, kit, seed, field!.puddle, animated ? 1 : 0.7) : out;
}

/** A soft contact shadow: darkens the ground one ramp step under the feet (only ground pixels). */
function shadowUnder(dst: Sprite, cx: number, cy: number, w: number) {
  const rx = Math.max(4, w / 2), ry = Math.max(2, rx * 0.32);
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (x < 0 || y < 0 || x >= dst.w || y >= dst.h) continue;
      if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 > 1) continue;
      const d = decodeIndex(dst.data[y * dst.w + x]);
      if (d && ["grass", "dirt", "sand", "foliage", "wood", "stone"].includes(d.mat) && d.level > 0) dst.data[y * dst.w + x] = colorIndex(d.mat, d.level - 1);
    }
}

if (process.argv[1]?.endsWith("village-scene.ts")) {
  const args = process.argv.slice(2), gif = args.includes("--gif");
  const [out, kitId, seedArg] = args.filter((x) => x !== "--gif");
  const time = process.env.TIME as TimeOfDay | undefined;
  const fx: GradeFx = process.env.FX === "rich" ? "rich" : "classic";
  const wet = (process.env.WET ?? "dry") as Wet;
  const seed = Number(seedArg ?? process.env.SEED ?? 1);
  if (gif) {
    const kit = KIT_PRESETS.find((k) => k.id === (kitId ?? "kit-hd-rich"))!;
    const file = out ?? "docs/img/village-scene.gif";
    const frames = renderSceneFrames(kit, seed, Number(process.env.FRAMES ?? 24), time, fx, wet);
    const bytes = encodeGif(frames, { colors: kitColors(kit), fps: Number(process.env.FPS ?? 8), scale: Number(process.env.GIF_SCALE ?? 1) });
    writeFileSync(file, bytes);
    console.log(`wrote ${file} (${frames.length} frames, ${(bytes.length / 1024).toFixed(0)} KB)`);
  } else {
    const jobs: [string, string, TimeOfDay | undefined][] = out ? [[out, kitId ?? "kit-hd-rich", time]] : [["docs/img/village-scene.png", "kit-hd-rich", undefined], ["docs/img/village-scene-night.png", "kit-hd-rich", "night"]];
    for (const [file, id, tod] of jobs) {
      const kit = KIT_PRESETS.find((k) => k.id === id);
      if (!kit) throw new Error(`unknown kit ${id}`);
      savePng(file, [[renderScene(kit, seed, tod, fx, wet)]], kit, SCALE);
      console.log(`wrote ${file}`);
    }
  }
}

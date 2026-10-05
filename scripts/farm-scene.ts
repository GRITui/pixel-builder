/**
 * The Sprint 7 farm exit image: a farm-mmo map (yard, crop fields, pen, orchard, pond, stream, woodland edge)
 * with villagers working in place and a farm HUD, everything from one Style Kit and y-sorted so people stand
 * behind trunks. The farmer hoes toward his field (`farm` clip), his wife waters the garden bed with a
 * watering can (`water` clip), the kid carries a basket (`carry` clip).
 *
 *   npx tsx scripts/farm-scene.ts                     # docs/img/farm-scene.png (day) + farm-scene-dusk.png
 *   npx tsx scripts/farm-scene.ts out.png kit-hd-rich [seed]
 *   npx tsx scripts/farm-scene.ts --gif               # docs/img/farm-scene.gif: water flows, crops and trees sway, villagers work
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
import { mapAnimator, renderMapFrames } from "../src/core/mapanim";
import { castLight, findLights, grade, mapLitObjects, type TimeOfDay } from "../src/core/lighting";
import { encodeGif } from "../src/node/gif";
import { kitColors } from "../src/node/png";
import type { Sprite, StyleKit, TileMap } from "../src/core/types";
import { savePng } from "./sheet";

const COLS = 42, ROWS = 28;
const SCALE = Number(process.env.SCALE ?? 2);

const trim = (s: Sprite): Sprite => cropBox(s, bounds(s)!);
const unionBox = (ss: Sprite[]) => ss.map((s) => bounds(s)!).reduce((a, b) => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }));
function cropBox(s: Sprite, b: { x0: number; y0: number; x1: number; y1: number }): Sprite {
  const o = createSprite(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1);
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) o.data[(y - b.y0) * o.w + x - b.x0] = s.data[y * s.w + x];
  return o;
}

interface Actor { rig: string; attachments: string[]; slots: Record<string, string>; clip: string; dir: string; role: string }
const ACTORS: Actor[] = [
  { role: "farmer", rig: "human-male-young-adult", attachments: ["hoe", "straw-hat", "costume-overalls"], slots: { top: "cloth2", bottom: "cloth" }, clip: "farm", dir: "down" },
  { role: "gardener", rig: "human-female-young-adult", attachments: ["watering-can", "hat-bonnet", "costume-dress"], slots: { top: "cloth", hair: "hair" }, clip: "water", dir: "up" },
  { role: "walker", rig: "human-male-kid", attachments: ["basket", "hat-cap"], slots: { top: "accent" }, clip: "carry", dir: "right" },
];

function actorFrames(a: Actor, kit: StyleKit): Sprite[] {
  const lib = rigById(a.rig)!;
  const atts = withHumanoidDefaults(lib.rig, a.attachments.map((id) => attachmentById(id)!.attachment));
  const clip = CLIPS.find((c) => c.clip.id === a.clip && c.family === "humanoid")!.clip;
  const rows = renderRig({ rig: lib.rig, kit, slots: a.slots as never, attachments: atts }, [clip], { directions: 4 });
  return rows.find((r) => r.name === `${a.clip}-${a.dir}`)!.frames;
}

export const renderScene = (kit: StyleKit, seed: number, time?: TimeOfDay): Sprite => renderSceneFrames(kit, seed, 1, time)[0];

/** n = 1: the still scene. n > 1: a living loop (use a multiple of 20 for a seamless one). */
export function renderSceneFrames(kit: StyleKit, seed: number, n: number, time?: TimeOfDay): Sprite[] {
  const gen = (id: string, p: object, s = 1) => {
    const g = GENERATORS.find((x) => x.id === id)!;
    return g.generate({ ...defaults(g), ...p } as never, kit, s);
  };
  const ui = (kind: string, p: object = {}) => trim(gen("ui", { kind, material: "wood", ...p }).rows[0].frames[0]);
  const T = kit.sizes.tile;
  const map = gen("map", { biome: "farm-mmo", cols: COLS, rows: ROWS, detail: "medium", density: 0.55, buildings: "rich" }, seed);
  const tm = map.tilemap as TileMap;
  const meta = map.meta as { spawns: { x: number; y: number; role: string }[]; blocked: { x: number; y: number }[] };
  const blocked = new Set(meta.blocked.map((b) => b.y * tm.cols + b.x));
  const groundOnly: TileMap = { ...tm, deco: tm.deco.map(() => -1) };
  const baseWorld = cloneSprite(renderTileMap(groundOnly));
  const animated = n > 1;
  const groundFrames = animated ? renderMapFrames(groundOnly, kit, n, seed) : [baseWorld];
  const anim = animated ? mapAnimator(tm, kit, seed) : null;

  // crops sway with the crop generator's own loop (the map animator only knows props and trees)
  const cropLoops = new Map<number, Sprite[] | null>();
  const cropLoop = (tile: number): Sprite[] | null => {
    if (!cropLoops.has(tile)) {
      const m = /^crop-([a-z]+)-([a-z]+)-(\d+)$/.exec(tm.tiles[tile].name);
      const g = GENERATORS.find((x) => x.id === "crop")!;
      const rows = m ? g.generate({ ...defaults(g), species: m[1], stage: m[2], variant: Number(m[3]) } as never, kit, seed).rows : [];
      const sw = rows.find((r) => r.name === "sway");
      cropLoops.set(tile, sw && sw.frames[0].w === tm.tiles[tile].sprite.w && sw.frames[0].h === tm.tiles[tile].sprite.h ? sw.frames : null);
    }
    return cropLoops.get(tile)!;
  };

  type Item = { sprite: Sprite; x: number; y: number; shadow?: number; tile?: { i: number; col: number; row: number } };
  const items: Item[] = mapObjects(tm).map((o) => {
    const sp = tm.tiles[o.tile].sprite;
    return { sprite: sp, x: o.x - sp.w / 2, y: o.y - sp.h, tile: { i: o.tile, col: o.col, row: o.row } };
  });
  const feet = (c: { x: number; y: number }) => ({ x: c.x * T + T / 2, y: (c.y + 1) * T - 2 });

  // HUD first: its rectangles keep the villagers out from under it
  const W = baseWorld.w, H = baseWorld.h;
  const date = ui("date-panel", { day: 12, weekday: "sat", season: "spring" });
  const timeP = ui("time-panel", { hour: time === "dusk" ? 18 : 9, minute: 40 });
  const weather = ui("weather-icon", { weather: "sunny" });
  const clock = ui("clock", { hour: time === "dusk" ? 6 : 9 });
  const hud: { s: Sprite; x: number; y: number }[] = [
    { s: date, x: W - date.w - 4, y: 4 }, { s: timeP, x: W - timeP.w - 4, y: 4 + date.h + 2 },
    { s: weather, x: W - date.w - weather.w - 8, y: 4 }, { s: clock, x: W - date.w - weather.w - clock.w - 12, y: 2 },
  ];
  const tools = ["hoe", "watering-can", "tool-axe", "pickaxe", "sickle", "fishing-rod", "seed-bag"];
  const slot = ui("slot", { style: "inset" });
  const barX = Math.round((W - tools.length * (slot.w + 2)) / 2);
  tools.forEach((t, k) => {
    const x = barX + k * (slot.w + 2), y = H - slot.h - 4;
    hud.push({ s: slot, x, y });
    const icon = trim(gen("object", { kind: t }).rows[0].frames[0]);
    hud.push({ s: icon, x: x + Math.round((slot.w - icon.w) / 2), y: y + Math.round((slot.h - icon.h) / 2) });
  });
  const hits = (x0: number, y0: number, x1: number, y1: number) => hud.some((h) => x1 > h.x - 2 && x0 < h.x + h.s.w + 2 && y1 > h.y - 2 && y0 < h.y + h.s.h + 2);

  // villagers: nearest cell to the planned work spot that is free, dry, not blocked and not hidden by anything in front
  const used: { x: number; y: number }[] = [];
  const cells = Array.from({ length: tm.cols * tm.rows }, (_, i) => ({ x: i % tm.cols, y: Math.floor(i / tm.cols) }));
  const crew = ACTORS.map((a) => {
    const frames = actorFrames(a, kit);
    const box = unionBox(frames);
    const sp0 = cropBox(frames[0], box);
    const want = meta.spawns.find((s) => s.role === a.role) ?? meta.spawns[0];
    const ok = (c: { x: number; y: number }) => {
      const i = c.y * tm.cols + c.x, g = tm.tiles[tm.ground[i]];
      if (c.x < 1 || c.y < 2 || c.x >= tm.cols - 1 || c.y >= tm.rows - 2 || blocked.has(i) || tm.deco[i] >= 0 || !g || g.solid || g.name.startsWith("water")) return false;
      if (used.some((u) => Math.hypot(u.x - c.x, u.y - c.y) < 3)) return false;
      const f = feet(c), x0 = Math.round(f.x - sp0.w / 2), y0 = f.y - sp0.h;
      if (hits(x0 - 4, y0 - 4, x0 + sp0.w + 4, f.y)) return false;
      return !items.some((it) => {
        if (it.y + it.sprite.h <= f.y) return false;
        for (let y = Math.max(y0, it.y); y < Math.min(f.y, it.y + it.sprite.h); y++)
          for (let x = Math.max(x0, it.x); x < Math.min(x0 + sp0.w, it.x + it.sprite.w); x++)
            if (it.sprite.data[(y - it.y) * it.sprite.w + x - it.x] && sp0.data[(y - y0) * sp0.w + x - x0]) return true;
        return false;
      });
    };
    const cell = cells.filter(ok).sort((p, q) => Math.hypot(p.x - want.x, p.y - want.y) - Math.hypot(q.x - want.x, q.y - want.y))[0] ?? want;
    used.push(cell);
    const f = feet(cell);
    const item: Item = { sprite: sp0, x: Math.round(f.x - sp0.w / 2), y: f.y - sp0.h, shadow: 0.4 * sp0.w };
    items.push(item);
    return { frames, box, cell, item };
  });

  const compose = (f: number): Sprite => {
    let world = cloneSprite(groundFrames[f % groundFrames.length]);
    if (animated) {
      for (const it of items) {
        if (!it.tile) continue;
        const loop = cropLoop(it.tile.i);
        it.sprite = loop ? loop[(f + it.tile.col * 3 + it.tile.row) % loop.length] : anim!.deco(it.tile.i, it.tile.col, it.tile.row, f);
      }
      for (const c of crew) {
        const sp = cropBox(c.frames[Math.floor((f * c.frames.length) / n) % c.frames.length], c.box), fp = feet(c.cell);
        Object.assign(c.item, { sprite: sp, x: Math.round(fp.x - sp.w / 2), y: fp.y - sp.h });
      }
    }
    if (time) world = castLight(world, mapLitObjects(tm), kit, { seed });
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
    // warm window glow at dusk comes from the lighting pass; people carry a lantern-ish light nearby
    if (time) world = grade(world, kit, time, findLights(mapLitObjects(tm), crew.map((c) => ({ x: c.item.x + c.item.sprite.w / 2 + 4, y: c.item.y + c.item.sprite.h - 12, r: 26 }))), seed, keepHue);
    for (const h of hud) blit(world, h.s, h.x, h.y);
    return world;
  };
  return Array.from({ length: animated ? n : 1 }, (_, f) => compose(f));
}

/** A soft contact shadow: darkens the ground one ramp step under the feet (only ground pixels). */
function shadowUnder(dst: Sprite, cx: number, cy: number, w: number) {
  const rx = Math.max(4, w / 2), ry = Math.max(2, rx * 0.32);
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      if (x < 0 || y < 0 || x >= dst.w || y >= dst.h) continue;
      if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 > 1) continue;
      const d = decodeIndex(dst.data[y * dst.w + x]);
      if (d && ["grass", "dirt", "sand", "foliage", "wood"].includes(d.mat) && d.level > 0) dst.data[y * dst.w + x] = colorIndex(d.mat, d.level - 1);
    }
}

if (process.argv[1]?.endsWith("farm-scene.ts")) {
  const args = process.argv.slice(2), gif = args.includes("--gif");
  const [out, kitId, seedArg] = args.filter((x) => x !== "--gif");
  const time = (process.env.TIME || "day") as TimeOfDay;
  const seed = Number(seedArg ?? process.env.SEED ?? 1);
  if (gif) {
    const kit = KIT_PRESETS.find((k) => k.id === (kitId ?? "kit-hd-rich"))!;
    const file = out ?? "docs/img/farm-scene.gif";
    const frames = renderSceneFrames(kit, seed, Number(process.env.FRAMES ?? 20), time);
    const bytes = encodeGif(frames, { colors: kitColors(kit), fps: Number(process.env.FPS ?? 8), scale: Number(process.env.GIF_SCALE ?? 1) });
    writeFileSync(file, bytes);
    console.log(`wrote ${file} (${frames.length} frames, ${(bytes.length / 1024).toFixed(0)} KB)`);
  } else {
    const jobs = out ? [[out, kitId ?? "kit-hd-rich", time]] : [["docs/img/farm-scene.png", "kit-hd-rich", "day"], ["docs/img/farm-scene-dusk.png", "kit-hd-rich", "dusk"]];
    for (const [file, id, tod] of jobs) {
      const kit = KIT_PRESETS.find((k) => k.id === id);
      if (!kit) throw new Error(`unknown kit ${id}`);
      savePng(file, [[renderScene(kit, seed, tod as TimeOfDay)]], kit, SCALE);
      console.log(`wrote ${file}`);
    }
  }
}

/**
 * The Sprint 5 exit image: a forest-mmo map with the hero, three monsters, nameplates, a damage
 * number and the MMO HUD, everything from one Style Kit and y-sorted so characters stand behind trunks.
 *
 *   npx tsx scripts/mmo-scene.ts                      # docs/img/mmo-scene.png (kit-hd-rich) + mmo-scene-deep.png (kit-hd-deep)
 *   npx tsx scripts/mmo-scene.ts out.png kit-hd-deep [seed]
 */
import { renderTileMap } from "../src/core/tilemap";
import { KIT_PRESETS } from "../src/core/kit";
import { GENERATORS, defaults } from "../src/core/generators";
import { mapObjects } from "../src/core/generators/map";
import { colorIndex, decodeIndex } from "../src/core/palette";
import { renderRig } from "../src/core/rig";
import { CLIPS, rigById } from "../src/core/rigs";
import { blit, bounds, cloneSprite, createSprite } from "../src/core/sprite";
import type { Sprite, StyleKit, TileMap } from "../src/core/types";
import { savePng } from "./sheet";

const COLS = 21, ROWS = 14;
const SCALE = Number(process.env.SCALE ?? 2);

const trim = (s: Sprite): Sprite => {
  const b = bounds(s)!;
  const o = createSprite(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1);
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) o.data[(y - b.y0) * o.w + x - b.x0] = s.data[y * s.w + x];
  return o;
};

export function renderScene(kit: StyleKit, seed: number): Sprite {
  const gen = (id: string, p: object, s = 1) => {
    const g = GENERATORS.find((x) => x.id === id)!;
    return g.generate({ ...defaults(g), ...p } as never, kit, s);
  };
  const ui = (kind: string, p: object = {}) => gen("ui", { kind, skin: "mmo-gold", ...p }).rows[0].frames[0];
  const T = kit.sizes.tile;

  const map = gen("map", { biome: "forest-mmo", cols: COLS, rows: ROWS, detail: "high", density: 0.55 }, seed);
  const tm = map.tilemap as TileMap;
  const meta = map.meta as { spawns: { x: number; y: number }[]; playerStart: { x: number; y: number } };
  // ground only; deco and characters go through one y-sorted list
  const groundOnly: TileMap = { ...tm, deco: tm.deco.map(() => -1) };
  const world = cloneSprite(renderTileMap(groundOnly));

  type Item = { sprite: Sprite; x: number; y: number; shadow?: number };
  const items: Item[] = mapObjects(tm).map((o) => {
    const sp = tm.tiles[o.tile].sprite;
    return { sprite: sp, x: o.x - sp.w / 2, y: o.y - sp.h };
  });
  // standing positions: a cell's bottom-centre
  const feet = (c: { x: number; y: number }) => ({ x: c.x * T + T / 2, y: (c.y + 1) * T - 2 });
  const place = (sp: Sprite, c: { x: number; y: number }, shadow = 0.4) => {
    const f = feet(c);
    const t = trim(sp);
    items.push({ sprite: t, x: Math.round(f.x - t.w / 2), y: f.y - t.h, shadow: shadow * t.w });
    return { cx: f.x, top: f.y - t.h, base: f.y };
  };
  const monster = (rig: string, clip: string, dir: string, frame = 0) => {
    const r = rigById(rig)!;
    const clips = [CLIPS.find((c) => c.clip.id === clip && c.family === r.family)!.clip];
    const rows = renderRig({ rig: r.rig, kit }, clips, { directions: 4 });
    const f = rows.find((x) => x.name === `${clip}-${dir}`)!.frames;
    return f[Math.min(frame, f.length - 1)];
  };

  // HUD first: its rectangles keep characters (and their plates) out from under the frames
  const unit = ui("unit-frame", { portrait: "hero", hp: 80, mp: 55, xp: 40, level: 12, width: 76 });
  const mini = gen("ui", { kind: "minimap-frame", skin: "mmo-gold", width: 52 });
  const mm = cloneSprite(mini.rows[0].frames[0]);
  fillMinimap(mm, mini.meta!.mapRect as { x: number; y: number; w: number; h: number }, tm);
  const quest = ui("quest-tracker");
  const bar = ui("skill-bar", { slots: 7, cooldown: 3 });
  const chat = ui("chat-panel", { width: 96, height: 44 });
  const W = world.w, H = world.h;
  const hud = [
    { s: unit, x: 4, y: 4 }, { s: mm, x: W - mm.w - 4, y: 4 }, { s: quest, x: W - quest.w - 4, y: 4 + mm.h + 3 },
    { s: bar, x: Math.round((W - bar.w) / 2) + 28, y: H - bar.h - 4 }, { s: chat, x: 4, y: H - chat.h - 4 },
  ];
  const hits = (x0: number, y0: number, x1: number, y1: number) => hud.some((h) => x1 > h.x - 2 && x0 < h.x + h.s.w + 2 && y1 > h.y - 2 && y0 < h.y + h.s.h + 2);

  // hero on the path west of the bridge, three monsters on spawn points that are clear of the HUD
  const hero = trim(gen("character", { headwear: "none", hair_style: "spiky", costume: "overalls", weapon: "sword", top: "cloth2" }).rows[0].frames[0]);
  const cast = [
    { sprite: trim(monster("monster-mushroom-red", "attack", "down", 2)), name: "SHROOM", level: 4, hp: 62 },
    { sprite: trim(monster("monster-slime-green", "idle", "down")), name: "SLIME", level: 3, hp: 100 },
    { sprite: trim(monster("monster-plant", "idle", "down")), name: "SNAPPER", level: 6, hp: 100 },
  ];
  const heroAt = { x: meta.playerStart.x, y: meta.playerStart.y };
  const used = [heroAt];
  const walkable = (c: { x: number; y: number }) => {
    const i = c.y * tm.cols + c.x, g = tm.tiles[tm.ground[i]]?.name ?? "";
    return tm.deco[i] < 0 && (g.startsWith("grass") || g.startsWith("dirt") || g.startsWith("sand"));
  };
  const spots = [...meta.spawns, ...Array.from({ length: tm.cols * tm.rows }, (_, i) => ({ x: i % tm.cols, y: Math.floor(i / tm.cols) })).filter(walkable)];
  const heroPos = feet(heroAt);
  const chosen = cast.map((m) => {
    const ok = (c: { x: number; y: number }) => {
      if (!walkable(c) || feet(c).y > H - 8 || used.some((u) => Math.hypot(u.x - c.x, u.y - c.y) < 3.6)) return false;
      const f = feet(c);
      if (hits(f.x - m.sprite.w / 2 - 6, f.y - m.sprite.h - 34, f.x + m.sprite.w / 2 + 6, f.y)) return false;
      // nothing standing in front of it may cover it (a tree crown, a boulder)
      const x0 = Math.round(f.x - m.sprite.w / 2), y0 = f.y - m.sprite.h;
      return !items.some((it) => {
        if (it.y + it.sprite.h <= f.y) return false;
        for (let y = Math.max(y0, it.y); y < Math.min(f.y, it.y + it.sprite.h); y++)
          for (let x = Math.max(x0, it.x); x < Math.min(x0 + m.sprite.w, it.x + it.sprite.w); x++)
            if (it.sprite.data[(y - it.y) * it.sprite.w + x - it.x] && m.sprite.data[(y - y0) * m.sprite.w + x - x0]) return true;
        return false;
      });
    };
    // nearest to the hero first so the fight reads as one scene
    const c = spots.filter(ok).sort((a, b) => Math.hypot(feet(a).x - heroPos.x, feet(a).y - heroPos.y) - Math.hypot(feet(b).x - heroPos.x, feet(b).y - heroPos.y))[0] ?? meta.spawns[0];
    used.push(c);
    return c;
  });
  const hp = place(hero, heroAt);
  const marks = cast.map((m, k) => ({ ...place(m.sprite, chosen[k]), name: m.name, level: m.level, hp: m.hp }));

  // y-sort: base line = sprite bottom (shadows sit under the sprite, drawn with it)
  items.sort((a, b) => a.y + a.sprite.h - (b.y + b.sprite.h) || a.x - b.x);
  for (const it of items) {
    if (it.shadow) shadowUnder(world, it.x + it.sprite.w / 2, it.y + it.sprite.h - 1, it.shadow);
    blit(world, it.sprite, it.x, it.y);
  }

  // floating text and nameplates are UI: above everything
  const put = (s: Sprite, x: number, y: number) => blit(world, s, Math.round(x), Math.round(y));
  const plate = (m: { cx: number; top: number }, p: object) => { const s = ui("nameplate", p); put(s, m.cx - s.w / 2, m.top - s.h - 1); };
  plate(hp, { name: "HERO", level: 12, tone: "green", hp: 80 });
  marks.forEach((m) => plate(m, { name: m.name, level: m.level, tone: "red", hp: m.hp }));
  const dmg = (amount: number, tone: string, frame: number, m: { cx: number; top: number }, crit = false) => {
    const s = gen("ui", { kind: "damage-numbers", amount, tone, crit }).rows[0].frames[frame];
    put(s, m.cx - s.w / 2 + 6, m.top - 34);
  };
  dmg(342, "yellow", 1, marks[0], true);
  dmg(18, "green", 3, { cx: hp.cx + 16, top: hp.top + 8 });

  for (const h of hud) put(h.s, h.x, h.y);
  return world;
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

/** Paint the real map (water, path, trees) into the minimap's glass, replacing its placeholder terrain. */
function fillMinimap(mm: Sprite, r: { x: number; y: number; w: number; h: number }, tm: TileMap) {
  const name = (layer: number[], i: number) => tm.tiles[layer[i]]?.name ?? "";
  for (let y = r.y; y < r.y + r.h; y++)
    for (let x = r.x; x < r.x + r.w; x++) {
      const d = decodeIndex(mm.data[y * mm.w + x]);
      if (!d || !["foliage", "water", "dirt"].includes(d.mat)) continue;
      const cx = Math.min(tm.cols - 1, Math.floor(((x - r.x + 0.5) / r.w) * tm.cols)), cy = Math.min(tm.rows - 1, Math.floor(((y - r.y + 0.5) / r.h) * tm.rows));
      const i = cy * tm.cols + cx, g = name(tm.ground, i), o = name(tm.deco, i);
      let c: number;
      if (g.startsWith("water")) c = colorIndex("water", g.startsWith("water-d0") ? 3 : g.startsWith("water-d1") ? 2 : 1);
      else if (g.startsWith("bridge")) c = colorIndex("wood", 3);
      else if (o.startsWith("tree-maple")) c = colorIndex("cloth2", 3);
      else if (o.startsWith("tree-")) c = colorIndex("foliage", 0);
      else if (g.startsWith("dirt")) c = colorIndex("dirt", 3);
      else if (g.startsWith("sand")) c = colorIndex("sand", 3);
      else c = colorIndex("grass", 2);
      mm.data[y * mm.w + x] = c;
    }
}

if (process.argv[1]?.endsWith("mmo-scene.ts")) {
  const [, , out, kitId, seedArg] = process.argv;
  const jobs = out ? [[out, kitId ?? "kit-hd-rich"]] : [["docs/img/mmo-scene.png", "kit-hd-rich"], ["docs/img/mmo-scene-deep.png", "kit-hd-deep"]];
  for (const [file, id] of jobs) {
    const kit = KIT_PRESETS.find((k) => k.id === id);
    if (!kit) throw new Error(`unknown kit ${id}`);
    savePng(file, [[renderScene(kit, Number(seedArg ?? process.env.SEED ?? 7))]], kit, SCALE);
    console.log(`wrote ${file}`);
  }
}

/**
 * Full MMO HUD mock composited over a generated map: npx tsx scripts/mmo-hud.ts [out.png] [kitId] [skin]
 * Default output is docs/img/mmo-hud.png (kit-hd-rich, mmo-gold).
 */
import { KIT_PRESETS } from "../src/core/kit";
import { GENERATORS, defaults } from "../src/core/generators";
import { blit, bounds, cloneSprite } from "../src/core/sprite";
import type { Sprite, StyleKit } from "../src/core/types";
import { savePng } from "./sheet";

const [, , out = "docs/img/mmo-hud.png", kitId = "kit-hd-rich", skin = "mmo-gold"] = process.argv;
const kit: StyleKit = KIT_PRESETS.find((k) => k.id === kitId) ?? KIT_PRESETS[0];
const gen = (id: string, p: object, seed = 1) => {
  const g = GENERATORS.find((x) => x.id === id)!;
  return g.generate({ ...defaults(g), ...p } as never, kit, seed).rows;
};
const ui = (kind: string, p: object = {}) => gen("ui", { kind, skin, ...p })[0].frames[0];

const map = cloneSprite(gen("map", { biome: "meadow", cols: 16, rows: 11, density: 0.6 }, 4)[0].frames[0]);
const W = map.w, H = map.h;
const put = (s: Sprite, x: number, y: number) => blit(map, s, Math.round(x), Math.round(y));
const trim = (s: Sprite) => {
  const b = bounds(s)!;
  const o = { w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1, data: [] as number[] };
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) o.data.push(s.data[y * s.w + x]);
  return o as Sprite;
};

// world: a hero and two monsters with nameplates and floating damage
const hero = trim(gen("character", { headwear: "none", weapon: "sword" })[0].frames[0]);
const slime = trim(gen("character", { archetype: "slime", top: "foliage" })[0].frames[0]);
const wolf = trim(gen("animal", { species: "dog" })[0]?.frames[0] ?? slime);
put(hero, W * 0.46, H * 0.5);
put(slime, W * 0.66, H * 0.42);
put(wolf, W * 0.28, H * 0.34);
const plate = (p: object, cx: number, y: number) => { const s = ui("nameplate", p); put(s, cx - s.w / 2, y - 16); };
plate({ name: "SLIME", level: 4, tone: "red", hp: 55 }, W * 0.66 + slime.w / 2, H * 0.42);
plate({ name: "WOLF", level: 7, tone: "red", hp: 100 }, W * 0.28 + wolf.w / 2, H * 0.34);
plate({ name: "HERO", level: 12, tone: "green", hp: 80 }, W * 0.46 + hero.w / 2, H * 0.5);
put(gen("ui", { kind: "damage-numbers", amount: 342, tone: "yellow", crit: true })[0].frames[1], W * 0.66 + 8, H * 0.42 - 34);
put(gen("ui", { kind: "damage-numbers", amount: 56, tone: "white" })[0].frames[2], W * 0.28 + 12, H * 0.34 - 26);
put(gen("ui", { kind: "damage-numbers", amount: 18, tone: "green" })[0].frames[3], W * 0.46 + 8, H * 0.5 - 26);

// HUD
put(ui("unit-frame", { name: "HERO", portrait: "hero", hp: 80, mp: 55, xp: 40, level: 12 }), 4, 4);
const mini = ui("minimap-frame", { shape: "round", width: 52 });
put(mini, W - mini.w - 4, 4);
put(ui("quest-tracker"), W - 76 - 4, 4 + mini.h + 4);
const bar = ui("skill-bar", { slots: 8, cooldown: 3 });
put(bar, Math.round((W - bar.w) / 2) + 24, H - bar.h - 4);
const chat = ui("chat-panel", { width: 104, height: 56 });
put(chat, 4, H - chat.h - 4);
put(ui("tooltip", { name: "KNIGHT", rarity: "epic" }), W - 60 - 4, H - 40 - 28);

savePng(out, [[map]], kit, Number(process.env.SCALE ?? 2));

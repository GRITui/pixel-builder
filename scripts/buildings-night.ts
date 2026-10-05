/**
 * Day and night view of rich buildings on grass: lit windows, wall lamps and the forge glow come from
 * `meta.lights` (sprite px) and are handed to the lighting pass as `LitObject.lights`.
 *
 *   npx tsx scripts/buildings-night.ts [out.png] [kitId]      # default docs/img/buildings-night.png
 */
import { ALL_KIT_PRESETS } from "../src/core/kit";
import { GENERATORS } from "../src/core/generators";
import { defaults } from "../src/core/generators/types";
import { applyLighting, type LitObject, type TimeOfDay } from "../src/core/lighting";
import { colorIndex } from "../src/core/palette";
import { blit, createSprite } from "../src/core/sprite";
import type { Sprite } from "../src/core/types";
import { savePng } from "./sheet";

const [, , out = "docs/img/buildings-night.png", kitId = "kit-hd-rich"] = process.argv;
const kit = ALL_KIT_PRESETS.find((k) => k.id === kitId) ?? ALL_KIT_PRESETS[0];
const b = GENERATORS.find((g) => g.id === "building")!;
const c = GENERATORS.find((g) => g.id === "character")!;
const hero = c.generate(defaults(c) as never, kit, 1).rows[0].frames[0];
const LIST: Record<string, unknown>[] = JSON.parse(process.env.VARIANTS ?? "null") ?? [
  { style: "cottage" }, { style: "shop" }, { style: "inn" }, { style: "blacksmith" }, { style: "windmill" }, { style: "temple" },
];
const items = LIST.map((v, i) => {
  const r = b.generate({ ...defaults(b), look: "rich", ...v } as never, kit, 3 + i);
  return { sprite: r.rows[0].frames[0], lights: (r.meta?.lights ?? []) as { x: number; y: number; r: number }[], name: String(v.style) };
});

const gap = 14, top = 6, groundH = 22;
const H = Math.max(...items.map((i) => i.sprite.h)) + top + groundH;
const W = items.reduce((a, i) => a + i.sprite.w + gap, gap);

function scene(time: TimeOfDay): Sprite {
  const img = createSprite(W, H);
  const grass = [colorIndex("grass", 2), colorIndex("grass", 1), colorIndex("grass", 3)];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const h = (Math.imul(x + 17, 73856093) ^ Math.imul(y + 5, 19349663)) >>> 0;
      img.data[y * W + x] = grass[h % 23 === 0 ? 1 : h % 31 === 0 ? 2 : 0];
    }
  const ground = H - groundH + 8;
  for (let y = ground; y < ground + 8; y++) for (let x = 0; x < W; x++) img.data[y * W + x] = colorIndex("dirt", (x + y) % 5 === 0 ? 1 : 2);
  const objs: LitObject[] = [];
  let x = gap;
  for (const it of items) {
    const y = ground + 2 - it.sprite.h + 2;
    blit(img, it.sprite, x, y);
    objs.push({ sprite: it.sprite, x, y, name: it.name, lights: it.lights });
    x += it.sprite.w + gap;
  }
  blit(img, hero, gap + 40, ground + 6 - hero.h);
  return applyLighting(img, objs, kit, { time, seed: 5, shadows: true });
}

savePng(out, [[scene("day")], [scene("night")]], kit, Number(process.env.SCALE ?? 2));
console.log(out);

/**
 * Composite for docs/img/side-view-starter.png: parallax layers, a generated level with a house on its
 * reserved lot, the hero and two enemies.
 *   npx tsx scripts/side-view-starter.ts [out.png] [kitId] [scale]
 */
import { writeFileSync } from "node:fs";
import { KIT_PRESETS } from "../src/core/kit";
import { renderRig } from "../src/core/rig";
import { attachmentById, clipById, rigById } from "../src/core/rigs";
import { defaults, generatorById } from "../src/core/generators";
import { blankImage, drawSprite, encodePng, kitColors, scaleImage } from "../src/node/png";
import type { Sprite } from "../src/core/types";

const [, , out = "docs/img/side-view-starter.png", kitId = "kit-side", scaleArg = "3"] = process.argv;
const kit = KIT_PRESETS.find((k) => k.id === kitId) ?? KIT_PRESETS[0];
const T = kit.sizes.tile;
const COLS = 34, ROWS = 14;
let SEED = 1;
const gen = (id: string, p: Record<string, unknown>, seed = SEED) => {
  const g = generatorById(id)!;
  return g.generate({ ...defaults(g), ...p } as never, kit, seed);
};
const piece = (p: Record<string, unknown>): Sprite => gen("sideview", p).rows[0].frames[0];

const level = (s: number) => gen("sidelevel", { cols: COLS, rows: ROWS, house: 7 }, s);
while (!(level(SEED).meta as { house?: unknown }).house && SEED < 500) SEED++;
const lvl = level(SEED);
const house = (lvl.meta as { house?: { x: number; w: number; row: number } }).house;
if (!house) throw new Error("no house lot in this level");
const W = COLS * T, H = ROWS * T, gy = house.row * T;
const img = blankImage(W, H);
const colors = kitColors(kit);
const draw = (s: Sprite, x: number, y: number) => drawSprite(img, s, colors, Math.round(x), Math.round(y));

draw(piece({ kind: "bg-sky", cols: COLS, rows: ROWS }), 0, 0);
draw(piece({ kind: "bg-hills", cols: COLS, rows: ROWS }), 0, 0);
const treeRows = 7;
draw(piece({ kind: "bg-trees", cols: COLS, rows: treeRows }), 0, gy - treeRows * T + 3);
draw(lvl.rows[0].frames[0], 0, 0);
const hs = piece({ kind: "building", cols: house.w - 1 });
draw(hs, (house.x + house.w / 2) * T - hs.w / 2, gy - hs.h + 2);

const rig = rigById("humanoid-side")!.rig;
const attachments = ["costume-overalls", "straw-hat"].map((id) => attachmentById(id)!.attachment);
const hero = renderRig({ rig, kit, attachments }, [clipById("idle")!.clip])[0].frames[0];
draw(hero, (house.x + house.w + 0.5) * T, gy - hero.h + 1);
const slime = gen("sideenemy", { kind: "slime" }).rows[0].frames[0];
const beetle = gen("sideenemy", { kind: "beetle", body: "cloth2" }).rows[0].frames[0];
draw(slime, (house.x + house.w + 3.5) * T, gy - slime.h);
draw(beetle, (COLS - 5) * T, gy - beetle.h);

writeFileSync(out, encodePng(scaleImage(img, Number(scaleArg))));
console.log(`wrote ${out}`, house);

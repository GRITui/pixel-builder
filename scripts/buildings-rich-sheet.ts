/**
 * Contact sheet of rich building styles beside a character:
 *   npx tsx scripts/buildings-rich-sheet.ts out.png [kitId]
 * env: VARIANTS='[{"style":"inn"}]' (JSON), PER=6 per row, SCALE=2, ANIM=1 to show every animation frame.
 */
import { ALL_KIT_PRESETS } from "../src/core/kit";
import { GENERATORS } from "../src/core/generators";
import { defaults } from "../src/core/generators/types";
import type { Sprite } from "../src/core/types";
import { savePng } from "./sheet";

const [, , out = "buildings-rich.png", kitId = "kit-hd-rich"] = process.argv;
const kit = ALL_KIT_PRESETS.find((k) => k.id === kitId) ?? ALL_KIT_PRESETS[0];
const b = GENERATORS.find((g) => g.id === "building")!;
const c = GENERATORS.find((g) => g.id === "character")!;
const hero = c.generate(defaults(c) as never, kit, 1).rows[0].frames[0];
const variants: Record<string, unknown>[] = JSON.parse(process.env.VARIANTS ?? "null") ?? [
  { style: "cottage" }, { style: "shop" }, { style: "inn" }, { style: "blacksmith" }, { style: "temple" },
  { style: "farmhouse", tier: 1 }, { style: "farmhouse", tier: 2 }, { style: "farmhouse", tier: 3 },
  { style: "barn", tier: 1 }, { style: "barn", tier: 2 }, { style: "barn", tier: 3 }, { style: "coop", tier: 1 }, { style: "coop", tier: 2 }, { style: "coop", tier: 3 },
  { style: "windmill" }, { style: "greenhouse" }, { style: "market-stall" }, { style: "well-house" },
  { style: "tower" }, { style: "keep" }, { style: "stilt-house" }, { style: "stilt-house", gable: "thai" }, { style: "half-brick" }, { style: "half-brick", gable: "thai" },
];
const per = Number(process.env.PER ?? 6);
const frames: Sprite[] = [];
variants.forEach((v, i) => {
  const rows = b.generate({ ...defaults(b), look: "rich", ...v } as never, kit, 1 + i).rows;
  if (process.env.ANIM) for (const r of rows) frames.push(...r.frames);
  else frames.push(rows[0].frames[0]);
});
const rows: Sprite[][] = [];
for (let i = 0; i < frames.length; i += per) rows.push([...(i === 0 ? [hero] : []), ...frames.slice(i, i + per)]);
savePng(out, rows, kit, Number(process.env.SCALE ?? 2));
console.log(out);

/** Contact sheet of every rich building style beside a character: npx tsx scripts/buildings-rich-sheet.ts out.png [kitId] */
import { ALL_KIT_PRESETS } from "../src/core/kit";
import { GENERATORS } from "../src/core/generators";
import { defaults } from "../src/core/generators/types";
import { savePng } from "./sheet";

const [, , out = "buildings-rich.png", kitId = "kit-hd-rich"] = process.argv;
const kit = ALL_KIT_PRESETS.find((k) => k.id === kitId) ?? ALL_KIT_PRESETS[0];
const b = GENERATORS.find((g) => g.id === "building")!;
const c = GENERATORS.find((g) => g.id === "character")!;
const hero = c.generate(defaults(c) as never, kit, 1).rows[0].frames[0];
const variants: Record<string, unknown>[] = JSON.parse(process.env.VARIANTS ?? "null") ?? [
  { style: "cottage" }, { style: "shop" }, { style: "farmhouse", size: "small" }, { style: "farmhouse" }, { style: "farmhouse", size: "large" },
  { style: "barn" }, { style: "coop" }, { style: "tower" }, { style: "keep" }, { style: "stilt-house" }, { style: "half-brick" },
  { style: "cottage", roof: "sand", wall: "stone" }, { style: "shop", roof: "metal", wall: "dirt" },
];
const per = Number(process.env.PER ?? 6);
const frames = variants.map((v, i) => b.generate({ ...defaults(b), look: "rich", ...v } as never, kit, 1 + i).rows[0].frames[0]);
const rows = [];
for (let i = 0; i < frames.length; i += per) rows.push([...(i === 0 ? [hero] : []), ...frames.slice(i, i + per)]);
savePng(out, rows, kit, Number(process.env.SCALE ?? 2));
console.log(out);

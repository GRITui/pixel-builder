/** Dev helper: contact sheet of the urban night set (docs/img/urban-set.png).  npx tsx scripts/urban-set.ts <out.png> [scale] [kitId] [props|buildings|all] */
import { ALL_KIT_PRESETS } from "../src/core/kit";
import { URBAN_PROP_KINDS, urbanProp } from "../src/core/generators/urban";
import { savePng } from "./sheet";

const [, , out, scale = "3", kitId = "kit-iso", what = "props"] = process.argv;
const kit = ALL_KIT_PRESETS.find((k) => k.id === kitId) ?? ALL_KIT_PRESETS[0];
const variants: Record<string, number[]> = { vending: [0, 1, 2], cat: [0, 1, 2], "potted-plant": [0, 1, 2], bins: [1, 2, 3], "kei-car": [0, 1], "neon-sign": [0, 1], bicycle: [0, 1] };
const props = URBAN_PROP_KINDS.flatMap((k) => (variants[k] ?? [0]).map((v) => urbanProp(kit, k, 3, v).sprite));
const sheet = [props.slice(0, 11), props.slice(11, 22), props.slice(22)];
if (what !== "props") {
  const { URBAN_BUILDING_STYLES, urbanBuilding } = await import("../src/core/generators/urban-iso");
  const blds = URBAN_BUILDING_STYLES.map((s) => urbanBuilding(kit, { style: s }, 3).sprite);
  if (what === "buildings") sheet.length = 0;
  sheet.push(blds);
}
savePng(out, sheet, kit, Number(scale));
console.log(`wrote ${out}`);

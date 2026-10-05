// Contact sheet: species rows x stage columns (idle frame). Usage: tsx scripts/crops-sheet.ts out.png [kitId] [scale]
import { ALL_KIT_PRESETS } from "../src/core/kit";
import { CROP_SPECIES, CROP_STAGES, cropsGenerator } from "../src/core/generators/crops";
import { savePng } from "./sheet";

const [, , out = "docs/img/crops.png", kitId = "kit-default", scale = "4"] = process.argv;
const kit = ALL_KIT_PRESETS.find((k) => k.id === kitId) ?? ALL_KIT_PRESETS[0];
const sheet = CROP_SPECIES.map((species) => CROP_STAGES.map((stage) => cropsGenerator.generate({ species, stage, variant: 0 }, kit, 3).rows[0].frames[0]));
savePng(out, sheet, kit, Number(scale));
console.log(`wrote ${out}`);

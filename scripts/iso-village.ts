/** Dev helper: render a larger iso village (docs/img/iso-village.png).  npx tsx scripts/iso-village.ts <out.png> [scale] [seed] */
import { ISO_KIT } from "../src/core/kit";
import { defaults } from "../src/core/generators";
import { isoMapGenerator } from "../src/core/generators/isomap";
import { savePng } from "./sheet";

const [, , out, scale = "2", seedArg = "4"] = process.argv;
const res = isoMapGenerator.generate({ ...defaults(isoMapGenerator), cols: 18, rows: 16, water: 0.12, hills: false, house: 2, village: 4, props: 0.35 }, ISO_KIT, Number(seedArg));
const map = res.rows[0].frames[0];
savePng(out, [[map]], ISO_KIT, Number(scale));
console.log(`wrote ${out} (${map.w}x${map.h})`);

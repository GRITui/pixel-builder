/** Dev helper: crop the Tokyo Midnight day image.  npx tsx scripts/crop.ts out.png x y w h scale */
import { ISO_KIT } from "../src/core/kit";
import { createSprite } from "../src/core/sprite";
import { renderTokyo } from "./tokyo-midnight";
import { savePng } from "./sheet";

const [, , out, x0, y0, w, h, sc] = process.argv;
const s = renderTokyo(ISO_KIT, 1).image;
const o = createSprite(+w, +h);
for (let y = 0; y < +h; y++) for (let x = 0; x < +w; x++) o.data[y * +w + x] = s.data[(y + +y0) * s.w + x + +x0] ?? 0;
savePng(out, [[o]], ISO_KIT, +sc);

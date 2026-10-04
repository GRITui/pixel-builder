/**
 * Dev helper: render the iso map with characters standing on the path to a PNG
 * (used for docs/img/iso-starter.png).
 *
 *   npx tsx scripts/iso-demo.ts <out.png> [kitId] [scale] [seed]
 *
 * A non-iso kit id is switched to the iso camera (diamond tile 32, or 16 for 16px kits).
 */
import { ALL_KIT_PRESETS as KIT_PRESETS } from "../src/core/kit";
import { defaults } from "../src/core/generators";
import { characterGenerator } from "../src/core/generators/character";
import { isoMapGenerator, renderIsoMap } from "../src/core/generators/isomap";
import { ensureTile } from "../src/core/tilemap";
import { savePng } from "./sheet";

const [, , out, kitId = "kit-iso", scale = "3", seedArg = "1"] = process.argv;
const base = KIT_PRESETS.find((k) => k.id === kitId) ?? KIT_PRESETS[0];
const kit = base.camera === "iso" ? base : { ...base, camera: "iso" as const, sizes: { ...base.sizes, tile: base.sizes.character >= 32 ? 32 : 16 } };
const res = isoMapGenerator.generate(defaults(isoMapGenerator), kit, Number(seedArg));
const tm = res.tilemap!;
const hero = characterGenerator.generate({ ...defaults(characterGenerator), costume: "overalls", headwear: "straw-hat" }, kit, 3);
const row = (name: string) => hero.rows.find((r) => r.name === name)!.frames[1] ?? hero.rows.find((r) => r.name === name)!.frames[0];
// two heroes on dirt cells (the path), facing different diagonals
const dirt = tm.ground.map((g, i) => (tm.tiles[g]?.name.startsWith("dirt") && tm.deco[i] < 0 ? i : -1)).filter((i) => i >= 0);
const place = (i: number, name: string) => { tm.deco[i] = ensureTile(tm, `hero-${name}`, row(name), true); };
if (dirt.length > 6) {
  place(dirt[Math.floor(dirt.length * 0.3)], "walk-se");
  place(dirt[Math.floor(dirt.length * 0.55)], "walk-ne");
}
const map = renderIsoMap(tm);
savePng(out, [[map]], kit, Number(scale));
console.log(`wrote ${out} (${map.w}x${map.h}) hero rows: ${hero.rows.map((r) => r.name).join(",")}`);

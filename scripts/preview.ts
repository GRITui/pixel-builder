/**
 * Dev helper: render a generator to a PNG contact sheet so you can eyeball it
 * without the browser.
 *
 *   npx tsx scripts/preview.ts <generatorId> <out.png> ['[{"param":"value"}, ...]'] [kitId]
 *
 * Each JSON object is one variant (merged over defaults); each variant becomes
 * one row containing every frame of every animation row.
 */
import { KIT_PRESETS } from "../src/core/kit";
import { GENERATORS } from "../src/core/generators";
import { defaults } from "../src/core/generators/types";
import { savePng } from "./sheet";

const [, , id, out, variantsJson = "[{}]", kitId] = process.argv;
if (!id || !out) {
  console.error("usage: tsx scripts/preview.ts <generatorId> <out.png> ['[{...}]'] [kitId]");
  process.exit(1);
}
const g = GENERATORS.find((x) => x.id === id);
if (!g) throw new Error(`unknown generator ${id}; have ${GENERATORS.map((x) => x.id).join(", ")}`);
const kit = KIT_PRESETS.find((k) => k.id === kitId) ?? KIT_PRESETS[0];
const variants = JSON.parse(variantsJson) as Record<string, unknown>[];
const sheet = variants.map((v, i) => g.generate({ ...defaults(g), ...(v as object) } as never, kit, 1 + i).rows.flatMap((r) => r.frames));
savePng(out, sheet, kit, Number(process.env.SCALE ?? 4));
console.log(`wrote ${out}`);

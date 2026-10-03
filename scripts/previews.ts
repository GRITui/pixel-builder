/**
 * Render every generator under every kit preset into one PNG per
 * (generator, kit) — used by CI as a visual consistency artifact.
 *
 *   npx tsx scripts/previews.ts [outDir=previews]
 *
 * Rows: defaults, then each option of the generator's first select param
 * (usually `kind`/`style`), then a few random-param variants.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { KIT_PRESETS } from "../src/core/kit";
import { GENERATORS } from "../src/core/generators";
import { defaults, randomParams, type Params } from "../src/core/generators/types";
import { rng } from "../src/core/rng";
import type { Sprite } from "../src/core/types";
import { savePng } from "./sheet";

const outDir = process.argv[2] ?? "previews";
mkdirSync(outDir, { recursive: true });

const MAX_FRAMES_PER_ROW = 16;

for (const g of GENERATORS) {
  const variants: Params[] = [defaults(g)];
  const first = g.params.find((p) => p.type === "select");
  if (first && first.type === "select" && g.id !== "map")
    for (const o of first.options) if (o !== first.default) variants.push({ ...defaults(g), [first.key]: o });
  const r = rng(1234);
  for (let i = 0; i < (g.id === "map" ? 1 : 3); i++) variants.push(randomParams(g, r));

  for (const kit of KIT_PRESETS) {
    const t0 = performance.now();
    const sheet: Sprite[][] = variants.map((p, i) => g.generate(p, kit, 100 + i).rows.flatMap((row) => row.frames).slice(0, MAX_FRAMES_PER_ROW));
    const file = join(outDir, `${g.id}--${kit.id}.png`);
    savePng(file, sheet, kit, g.id === "map" ? 2 : 3);
    console.log(`${file}  ${variants.length} variants  ${(performance.now() - t0).toFixed(0)}ms`);
  }
}

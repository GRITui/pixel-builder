import { createHash } from "node:crypto";
import { ALL_KIT_PRESETS as K } from "../src/core/kit";
import { mapGenerator } from "../src/core/generators/map";
import { defaults } from "../src/core/generators/types";
const fp = (d: ArrayLike<number>) => createHash("sha1").update(Buffer.from(d as never)).digest("hex").slice(0, 12);
for (const [biome, detail] of [["forest-mmo","medium"],["forest-mmo","high"],["forest","medium"],["forest","high"]])
  console.log(biome, detail, fp(mapGenerator.generate({ ...defaults(mapGenerator), biome, cols: 24, rows: 18, detail } as never, K[0], 3).rows[0].frames[0].data));

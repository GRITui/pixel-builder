/**
 * Byte-identity harness for the `detail` kit field (#36).
 *
 *   tsx scripts/detail-baseline.ts <out.json>
 *
 * Renders every generator in every kit and writes a hash per asset so a later
 * run can be diffed with `cmp`. With `detail: "standard"` (the default) the
 * file must be byte-identical across a change that only adds rich detail.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { KIT_PRESETS } from "../src/core/kit";
import { GENERATORS } from "../src/core/generators";
import { defaults } from "../src/core/generators/types";
import type { Sprite } from "../src/core/types";

export function spriteHash(s: Sprite): string {
  return createHash("sha256").update(`${s.w}x${s.h}:${s.data.join(",")}`).digest("hex").slice(0, 32);
}

/** Hash every frame of every row of every generator in every kit, in a stable order. */
export function baselineDigest(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kit of KIT_PRESETS)
    for (const g of GENERATORS) {
      const rows = g.generate({ ...defaults(g) } as never, kit, 7).rows;
      const h = createHash("sha256");
      for (const r of rows) for (const f of r.frames) h.update(spriteHash(f));
      out[`${kit.id}/${g.id}`] = h.digest("hex").slice(0, 32);
    }
  return out;
}

const out = process.argv[2];
if (out) {
  writeFileSync(out, `${JSON.stringify(baselineDigest(), null, 2)}\n`);
  console.log(`wrote ${out}`);
}
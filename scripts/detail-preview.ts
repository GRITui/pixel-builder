/**
 * Side-by-side standard vs rich contact sheet, one row per variant, for the
 * art-designer check (#36).
 *
 *   tsx scripts/detail-preview.ts <out.png> [generator] [kitId]
 *
 * Left half of every row is the standard kit, right half the same generator on a
 * `detail: "rich"` copy of that kit, so the two can be compared at the same
 * scale in one image.
 */
import { KIT_PRESETS } from "../src/core/kit";
import { GENERATORS } from "../src/core/generators";
import { defaults } from "../src/core/generators/types";
import { savePng } from "./sheet";
import type { Sprite, StyleKit } from "../src/core/types";

const [, , out, generatorId = "character", kitId = "kit-default"] = process.argv;
const g = GENERATORS.find((x) => x.id === generatorId);
if (!g) throw new Error(`unknown generator ${generatorId}; have ${GENERATORS.map((x) => x.id).join(", ")}`);
const base = KIT_PRESETS.find((k) => k.id === kitId) ?? KIT_PRESETS[0];
const rich: StyleKit = { ...base, id: `${base.id}-rich`, detail: "rich" };

const VARIANTS: Record<string, Record<string, unknown>[]> = {
  character: [
    { headwear: "straw-hat", costume: "overalls", hair_style: "short" },
    { sex: "female", age: "kid", hair_style: "braids", costume: "dress" },
    { headwear: "wizard", cape: true, top: "cloth2", weapon: "staff" },
    { build: "stocky", headwear: "helmet", beard: "", facial: "beard", weapon: "sword" },
  ],
  animal: [{ kind: "cow" }, { kind: "sheep" }],
  building: [{ style: "cottage" }, { style: "barn" }],
  environment: [{ kind: "tree" }, { kind: "rock" }],
  object: [{ kind: "chest" }, { kind: "barrel" }],
};

// one row per variant: standard frame on the left, the rich frame on the right
const rows: Sprite[][] = [];
for (const v of VARIANTS[generatorId] ?? [{}]) {
  const p = { ...defaults(g), ...v } as never;
  const std = g.generate(p, base, 3);
  const rch = g.generate(p, rich, 3);
  // frame 0 of the first row of each, so one comparison per variant
  rows.push([std.rows[0].frames[0], rch.rows[0].frames[0]]);
}
savePng(out, rows, rich, Number(process.env.SCALE ?? 6));
console.log(`wrote ${out} (${rows.length} rows: standard left, rich right)`);
/**
 * Dev helper: contact sheet of monster rigs (one row per rig x direction, every frame of every clip).
 *   npx tsx scripts/monster-sheet.ts <out.png> <kitId> <rigId[,rigId]> [clips] [dirs]
 * Kit ids: kit-default, kit-neon, kit-gameboy, kit-hd-rich. SCALE env sets zoom.
 */
import { HD_RICH_KIT, KIT_PRESETS } from "../src/core/kit";
import { renderRig } from "../src/core/rig";
import { CLIPS, rigById } from "../src/core/rigs";
import { savePng } from "./sheet";

const [, , out, kitId = "kit-default", rigIds = "monster-slime-green", clipIds = "idle,walk,attack,hurt,die", dirs = "down,right,up"] = process.argv;
const kit = [...KIT_PRESETS, HD_RICH_KIT].find((k) => k.id === kitId);
if (!out || !kit) throw new Error("usage: tsx scripts/monster-sheet.ts <out.png> <kitId> <rigId[,rigId]> [clips] [dirs]");
const rows = [];
for (const id of rigIds.split(",")) {
  const r = rigById(id);
  if (!r) throw new Error(`unknown rig ${id}`);
  const clips = clipIds.split(",").map((c) => CLIPS.find((x) => x.clip.id === c && x.family === r.family)!.clip);
  const all = renderRig({ rig: r.rig, kit }, clips, { directions: 8 });
  for (const d of dirs.split(",")) rows.push(clips.flatMap((c) => all.find((a) => a.name === `${c.id}-${d}`)!.frames));
}
savePng(out, rows, kit, Number(process.env.SCALE ?? 3));
console.log(`wrote ${out}`);

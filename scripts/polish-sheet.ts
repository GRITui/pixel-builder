// Before/after sheet for the #47 polish: attack frames, side-view knight, tool-use frames.
//   npx tsx scripts/polish-sheet.ts docs/img/polish-before-after.png
import { GENERATORS } from "../src/core/generators";
import { defaults } from "../src/core/generators/types";
import { stripOutline } from "../src/core/enforce";
import { KIT_PRESETS } from "../src/core/kit";
import { renderRig } from "../src/core/rig";
import { attachmentById, clipById, rigById, withHumanoidDefaults } from "../src/core/rigs";
import type { Sprite } from "../src/core/types";
import { savePng } from "./sheet";

const out = process.argv[2] ?? "docs/img/polish-before-after.png";
const kit = KIT_PRESETS.find((k) => k.id === "kit-default")!;
const side = KIT_PRESETS.find((k) => k.id === "kit-side")!;

function row(rigId: string, atts: string[], clip: string, k = kit, slots?: Record<string, string>): Sprite[] {
  const rig = rigById(rigId)!.rig;
  const attachments = withHumanoidDefaults(rig, atts.map((a) => attachmentById(a)!.attachment));
  const rows = renderRig({ rig, kit: k, attachments, slots: slots as never }, [clipById(clip)!.clip]);
  return rows.find((r) => r.name.endsWith("-right"))!.frames;
}

const obj = GENERATORS.find((g) => g.id === "object")!;
const use = ["pickaxe", "hoe", "watering-can"].flatMap((kind) => obj.generate({ ...defaults(obj), kind } as never, kit, 1).rows.flatMap((r) => r.frames));
const metal = { top: "metal", bottom: "metal" };
const sheet: Sprite[][] = [
  row("humanoid-normal", ["sword", "helmet"], "attack"),
  row("humanoid-normal", ["sword", "helmet"], "attack-snappy"),
  row("humanoid-side", ["helmet", "sword"], "attack", side, metal),
  row("humanoid-side", ["helmet", "sword", "knight-trim"], "attack-snappy", side, metal),
  use.filter((s) => s.w === 16).map(stripOutline).slice(0, 15),
  use.slice(0, 15),
];
savePng(out, sheet, kit, 3);
console.log(`wrote ${out}`);

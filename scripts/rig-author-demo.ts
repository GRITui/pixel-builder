// Live check of POST /api/rig: 10 prompts (people, animals, monsters, vehicles)
// against a running server, rendered into one contact sheet. Needs a server
// with ANTHROPIC_API_KEY; without one it says so and exits 0.
//
//   npm run dev:api            # or: npx tsx server/index.ts   (with ANTHROPIC_API_KEY in .env)
//   npx tsx scripts/rig-author-demo.ts [outDir=rig-demo] [serverUrl=http://localhost:8787] [kitId=kit-default]
//
// Writes <outDir>/sheet.png (rows: one per prompt, columns: idle, walk x down, right, up)
// and <outDir>/<n>-<slug>.json (the raw API answer) so failures can be inspected.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KIT_PRESETS } from "../src/core/kit";
import { renderRig, type Attachment, type Clip, type RigDef } from "../src/core/rig";
import { CLIPS, attachmentById, rigById, withHumanoidDefaults } from "../src/core/rigs";
import type { Sprite } from "../src/core/types";
import { contactSheet, encodePng } from "../src/node/png";

const PROMPTS = [
  "a monk in saffron robes carrying an alms bowl",
  "a farmer woman with a straw hat and a basket",
  "an old fisherman with a long white beard and a net",
  "a water buffalo calf",
  "a white duck wearing a tiny red scarf",
  "a river crab with big claws",
  "a swamp goblin with a club and a ragged loincloth",
  "a floating one-eyed jellyfish monster",
  "a wooden handcart with two big wheels",
  "a little steam locomotive toy with a smokestack",
];

const [outDir = "rig-demo", url = "http://localhost:8787", kitId = "kit-default"] = process.argv.slice(2);
const kit = KIT_PRESETS.find((k) => k.id === kitId) ?? KIT_PRESETS[0];

const health = await fetch(`${url}/api/health`).then((r) => r.json()).catch(() => null);
if (!health) {
  console.log(`No API server at ${url}. Start it with: npx tsx server/index.ts`);
  process.exit(0);
}
if (!health.enabled) {
  console.log("The server has no ANTHROPIC_API_KEY (AI disabled); skipping the live rig sheet. See skills/pixel-builder/SKILL.md for the agent-authored path.");
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
const cells: Sprite[] = [];
let ok = 0;
for (const [n, prompt] of PROMPTS.entries()) {
  const slug = prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  const t0 = Date.now();
  const res = await fetch(`${url}/api/rig`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, kit }) });
  const body = await res.json();
  writeFileSync(join(outDir, `${n + 1}-${slug}.json`), JSON.stringify(body, null, 2));
  if (!res.ok) {
    console.log(`${n + 1}. FAIL (${res.status}) ${prompt}: ${body.error}`);
    cells.push(...Array(6).fill({ w: kit.sizes.character, h: kit.sizes.character, data: new Array(kit.sizes.character ** 2).fill(0) }));
    continue;
  }
  const rig: RigDef = body.rig ?? rigById(body.baseRig)!.rig;
  const family = body.rig ? undefined : rigById(body.baseRig)!.family;
  const own: Clip[] = body.clips ?? [];
  const pick = (id: string) => own.find((c) => c.id === id) ?? CLIPS.find((c) => c.clip.id === id && (!family || c.family === family))?.clip;
  const clips = ["idle", "walk"].flatMap((id) => pick(id) ?? []);
  const atts: Attachment[] = (body.attachments ?? []) as Attachment[];
  const withIds = [...(body.attachmentIds ?? []).flatMap((id: string) => attachmentById(id)?.attachment ?? []), ...atts];
  const rows = renderRig({ rig, kit, slots: body.slots, attachments: family === "humanoid" ? withHumanoidDefaults(rig, withIds) : withIds }, clips);
  for (const clip of clips) for (const dir of ["down", "right", "up"]) cells.push(rows.find((r) => r.name === `${clip.id}-${dir}`)!.frames[0]);
  while (cells.length % 6) cells.push({ w: kit.sizes.character, h: kit.sizes.character, data: new Array(kit.sizes.character ** 2).fill(0) });
  ok++;
  console.log(`${n + 1}. ok (${((Date.now() - t0) / 1000).toFixed(1)}s) ${prompt} -> ${body.rig ? `new rig ${body.rig.id}` : `extends ${body.baseRig}`}: ${body.notes}`);
}
writeFileSync(join(outDir, "sheet.png"), encodePng(contactSheet(cells, kit, { columns: 6, scale: 3 })));
console.log(`${ok}/${PROMPTS.length} rigs valid. Sheet: ${join(outDir, "sheet.png")}`);

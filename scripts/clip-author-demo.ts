/**
 * Text -> animation clip demo: runs 9 prompts through POST /api/clip and saves a contact sheet
 * (one row per prompt: down, side, up frames, rendered on the family's first rig).
 *
 *   npm run dev:api  (or: npx tsx server/index.ts)            # needs ANTHROPIC_API_KEY in .env
 *   npx tsx scripts/clip-author-demo.ts [out.png] [kitId]     # live, against http://localhost:8787
 *   npx tsx scripts/clip-author-demo.ts --fixtures [out.png]  # offline: the hand-written fixture outputs
 *
 * Live mode exits (no network call) when the server reports no API key.
 */
import { KIT_PRESETS } from "../src/core/kit";
import { clipFrames, renderRigFrame, type Clip, type View } from "../src/core/rig";
import { RIGS } from "../src/core/rigs";
import { FIXTURES } from "../server/clip.fixtures";
import { checkClip } from "../server/clip";
import { savePng } from "./sheet";

const args = process.argv.slice(2);
const offline = args.includes("--fixtures");
const [out = "/tmp/clip-sheet.png", kitId] = args.filter((a) => !a.startsWith("--"));
const kit = KIT_PRESETS.find((k) => k.id === kitId) ?? KIT_PRESETS[0];
const base = process.env.PIXEL_API ?? "http://localhost:8787";

async function author(prompt: string, family: string, i: number): Promise<Clip> {
  if (offline) {
    const f = FIXTURES[i];
    const { clip, errors } = checkClip(f.output, { family: f.family, prompt: f.prompt });
    if (!clip) throw new Error(errors.join("; "));
    return clip;
  }
  const res = await fetch(`${base}/api/clip`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, family }) });
  const data = (await res.json()) as { clip?: Clip; error?: string };
  if (!res.ok || !data.clip) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data.clip;
}

if (!offline) {
  const h = (await fetch(`${base}/api/health`).then((r) => r.json()).catch(() => null)) as { enabled?: boolean } | null;
  if (!h?.enabled) {
    console.log(`No AI available at ${base} (server down or ANTHROPIC_API_KEY unset). Use --fixtures for the offline sheet.`);
    process.exit(0);
  }
}

const sheet = [];
for (const [i, f] of FIXTURES.entries()) {
  try {
    const clip = await author(f.prompt, f.family, i);
    const rig = RIGS.find((r) => r.family === f.family)!.rig;
    const row = (["down", "side", "up"] as View[]).flatMap((v) => clipFrames(clip, v).map((pose) => renderRigFrame({ rig, kit }, v === "side" ? "right" : v, pose)));
    sheet.push(row);
    console.log(`ok   ${f.prompt} -> ${clip.id} (${row.length / 3} frames @ ${clip.fps}fps)`);
  } catch (e) {
    console.log(`FAIL ${f.prompt}: ${e instanceof Error ? e.message : e}`);
  }
}
if (sheet.length) {
  savePng(out, sheet, kit, Number(process.env.SCALE ?? 3));
  console.log(`wrote ${out}`);
}

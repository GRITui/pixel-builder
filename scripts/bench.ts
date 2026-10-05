/**
 * Offline quality benchmark (#23): runs every brief in bench/briefs.json through the tool layer
 * (no network, no AI), per kit, and writes contact sheets + bench/out/report.html + results.json.
 *
 *   npm run bench                     # all briefs, all kits
 *   npm run bench -- --brief map-    # only briefs whose id contains "map-"
 *   npm run bench -- --kit kit-neon  # only one kit
 *
 * PixelLab comparison images go in bench/pixellab/<brief-id>.png (see bench/pixellab/README.md).
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BENCH_DIR, kitsFor, loadBriefs, metricsOf, referencePng, validateBrief, type Brief, type Metrics } from "../bench/lib";
import { blankImage, decodePng, encodePng, type RgbaImage } from "../src/node/png";
import { callToolAsync } from "../src/node/tools";
import { Workspace } from "../src/node/workspace";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const onlyBrief = arg("brief"), onlyKit = arg("kit");
const OUT = join(BENCH_DIR, "out");

export interface RunResult {
  brief: string;
  kit: string;
  ms: number;
  error?: string;
  metrics?: Metrics;
  sheet?: string;
  /** Style-distance score 0..100 against the brief's reference (reference briefs only). */
  match?: number;
}

/** Stack preview images vertically on the contact-sheet background. */
function stack(images: RgbaImage[]): RgbaImage {
  const gap = 8;
  const w = Math.max(...images.map((i) => i.width)) + gap * 2;
  const h = images.reduce((a, i) => a + i.height + gap, gap);
  const out = blankImage(w, h, [40, 38, 52, 255]);
  let y = gap;
  for (const im of images) {
    for (let r = 0; r < im.height; r++) out.rgba.set(im.rgba.subarray(r * im.width * 4, (r + 1) * im.width * 4), ((y + r) * w + gap) * 4);
    y += im.height + gap;
  }
  return out;
}

async function runBrief(b: Brief, kit: string): Promise<RunResult> {
  const dir = mkdtempSync(join(tmpdir(), "pb-bench-"));
  const ws = new Workspace(join(dir, "ws"));
  const t0 = performance.now();
  try {
    const images: RgbaImage[] = [];
    for (const step of b.recipe) {
      const r = await callToolAsync(ws, step.tool, { ...step.input, kit_id: kit });
      for (const im of r.images ?? []) images.push(decodePng(im.png));
    }
    let match: number | undefined;
    const refPng = referencePng(b);
    if (refPng) {
      const file = join(dir, "reference.png");
      writeFileSync(file, refPng);
      const added = await callToolAsync(ws, "add_reference", { path: file, name: b.id });
      const last = ws.load().assets.at(-1)!;
      const cmp = await callToolAsync(ws, "compare_to_reference", { asset_id: last.id, reference_id: (added.data as { reference: { id: string } }).reference.id });
      match = (cmp.data as { score: number }).score;
      for (const im of cmp.images ?? []) images.unshift(decodePng(im.png));
    }
    const ms = performance.now() - t0;
    const assets = ws.load().assets;
    const dirOut = join(OUT, kit);
    mkdirSync(dirOut, { recursive: true });
    writeFileSync(join(dirOut, `${b.id}.png`), encodePng(stack(images)));
    return { brief: b.id, kit, ms, metrics: metricsOf(assets, b.expect?.directions), match, sheet: `${kit}/${b.id}.png` };
  } catch (e) {
    return { brief: b.id, kit, ms: performance.now() - t0, error: e instanceof Error ? e.message : String(e) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
export const RUBRIC = ["Readability at 1x", "Set consistency", "Animation quality", "Direction coverage", "Time to result", "Editability", "Cost"];

function report(briefs: Brief[], results: RunResult[], commit: string): string {
  const rows = briefs.map((b) => {
    const mine = results.filter((r) => r.brief === b.id);
    const ours = mine
      .map((r) =>
        r.sheet
          ? `<figure><img src="${r.sheet}" loading="lazy"><figcaption>${r.kit} &middot; ${(r.ms / 1000).toFixed(2)}s${r.metrics ? ` &middot; ${r.metrics.frames} frames, ${r.metrics.paletteColors} colours` : ""}${r.match !== undefined ? ` &middot; match ${r.match}` : ""}</figcaption></figure>`
          : `<figure class="err"><figcaption>${r.kit}: FAILED<br>${esc(r.error ?? "")}</figcaption></figure>`,
      )
      .join("");
    const pl = existsSync(join(BENCH_DIR, "pixellab", `${b.id}.png`)) ? `<img src="../pixellab/${b.id}.png">` : `<div class="none">not collected<br><small>bench/pixellab/${b.id}.png</small></div>`;
    const sel = (who: string) => RUBRIC.map((c) => `<td><select aria-label="${who} ${c}"><option>-</option>${[1, 2, 3, 4, 5].map((n) => `<option>${n}</option>`).join("")}</select></td>`).join("");
    return `<section id="${b.id}"><h2>${esc(b.id)} <small>${esc(b.category)}</small></h2><p>${esc(b.prompt)}</p>
<div class="cmp"><div class="col"><h3>pixel-builder</h3><div class="sheets">${ours}</div></div><div class="col"><h3>PixelLab</h3>${pl}</div></div>
<table><tr><th></th>${RUBRIC.map((c) => `<th>${c}</th>`).join("")}</tr><tr><th>ours</th>${sel("ours")}</tr><tr><th>PixelLab</th>${sel("pixellab")}</tr></table></section>`;
  });
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pixel Builder benchmark</title>
<style>:root{--bg:#fff;--fg:#1c1b22;--card:#f3f2f7;--line:#d8d6e0}@media(prefers-color-scheme:dark){:root{--bg:#18171d;--fg:#eceaf2;--card:#24232c;--line:#3a3945}}
body{background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,sans-serif;margin:0;padding:16px}section{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;margin:0 0 16px}
h2{margin:0}h2 small{font-weight:400;opacity:.6}img{image-rendering:pixelated;max-width:100%}.cmp{display:flex;gap:16px;flex-wrap:wrap}.col{flex:1 1 320px;min-width:0}
.sheets{display:flex;gap:8px;flex-wrap:wrap}figure{margin:0;max-width:100%}figcaption{font-size:12px;opacity:.7}.err{color:#c0392b}.none{border:2px dashed var(--line);padding:24px;text-align:center;opacity:.6}
table{border-collapse:collapse;margin-top:8px;display:block;overflow-x:auto}th,td{border:1px solid var(--line);padding:2px 6px;font-size:12px}</style>
<h1>Pixel Builder benchmark</h1><p>Commit ${esc(commit)} &middot; ${new Date().toISOString().slice(0, 10)} &middot; rubric in bench/RUBRIC.md &middot; the dropdowns are a scratchpad, record scores in bench/ratings.csv.</p>
${rows.join("\n")}</html>`;
}

async function main() {
  const all = loadBriefs();
  const briefs = all.filter((b) => !onlyBrief || b.id.includes(onlyBrief));
  const probe = new Workspace(mkdtempSync(join(tmpdir(), "pb-bench-probe-")));
  const bad = all.flatMap((b) => validateBrief(b, probe));
  if (bad.length) throw new Error(`Invalid briefs:\n${bad.join("\n")}`);
  mkdirSync(OUT, { recursive: true });
  const results: RunResult[] = [];
  for (const b of briefs)
    for (const kit of kitsFor(b).filter((k) => !onlyKit || k === onlyKit)) {
      const r = await runBrief(b, kit);
      results.push(r);
      console.log(`${r.error ? "FAIL" : "ok  "} ${b.id.padEnd(30)} ${kit.padEnd(12)} ${(r.ms / 1000).toFixed(2)}s${r.match !== undefined ? `  match ${r.match}` : ""}${r.error ? "  " + r.error.slice(0, 120) : ""}`);
    }
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch { /* not a git checkout */ }
  writeFileSync(join(OUT, "results.json"), JSON.stringify({ commit, date: new Date().toISOString(), results }, null, 1));
  writeFileSync(join(OUT, "report.html"), report(briefs, results, commit));
  const failed = results.filter((r) => r.error).length;
  console.log(`\n${results.length} runs, ${failed} failed. Open bench/out/report.html`);
  process.exit(failed ? 1 : 0);
}

main();

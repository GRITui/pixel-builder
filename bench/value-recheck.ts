// Re-measure the era-vs-value-structure claim with the mask held constant, across
// four backgrounds and one subject. Sprint 3 concluded "every era validates and expands
// the source's tonal range"; a single-sample era sheet did not reproduce that.
// This is the second-fixture check that rule demands before anything goes near a doc or PR.
//
// HARNESS RULE (learned the hard way — do not remove): the source baseline must be
// measured over the SAME mask as the result. Measuring the whole source image while the
// result is keyed to the subject silently compares subject-vs-subject+background and
// makes every era look like it loses value.
//   npx tsx bench/value-recheck.ts
import { keyBackground, pixelizeSprite } from "../src/pixel/sprite";
import { shadedSubject, type Bg } from "../src/pixel/modes.fixtures";
import { ERAS, type Era } from "../src/pixel/types";

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const ERAS_RUN: Era[] = [8, 16, 32, 64];

interface Cell { bg: string; era: Era; spread: number; p5: number; p50: number; p95: number; px: number; colours: number }

const pct = (ls: number[], p: number) => Math.round(ls[Math.floor((ls.length - 1) * p)] ?? 0);

/** Luma percentiles + distinct-colour count over the keyed subject only (alpha > 0). */
function measure(bg: string, src: ReturnType<typeof shadedSubject>, era: Era): Cell {
  const r = pixelizeSprite(src, { era, width: 32, seed: 1 });
  const nat = r.native;
  const ls: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < nat.data.length; i += 4) {
    if (nat.data[i + 3] === 0) continue;
    seen.add((nat.data[i] << 16) | (nat.data[i + 1] << 8) | nat.data[i + 2]);
    ls.push(luma(nat.data[i], nat.data[i + 1], nat.data[i + 2]));
  }
  ls.sort((a, b) => a - b);
  return { bg, era, spread: pct(ls, 0.95) - pct(ls, 0.05), p5: pct(ls, 0.05), p50: pct(ls, 0.5), p95: pct(ls, 0.95), px: ls.length, colours: seen.size };
}

/**
 * The source subject's own value range — measured INSIDE the key mask, at result
 * resolution, so it is the same pixel population the quantized result is judged on.
 */
function sourceSpread(src: ReturnType<typeof shadedSubject>): { spread: number; px: number } {
  const { w, h } = src;
  const keyed = keyBackground(src, {});
  const ls: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!keyed.mask[y * w + x]) continue;
    const i = (y * w + x) * 4;
    ls.push(luma(src.data[i], src.data[i + 1], src.data[i + 2]));
  }
  ls.sort((a, b) => a - b);
  return { spread: pct(ls, 0.95) - pct(ls, 0.05), px: ls.length };
}

const BGS: [string, Bg][] = [["dark", [20, 22, 30]], ["mid", [128, 128, 128]], ["light", [230, 230, 235]], ["gradient", "gradient"]];

const rows: Cell[] = [];
const srcs = new Map<string, number>();

for (const [name, bg] of BGS) {
  const src = shadedSubject(bg, 200, 240);
  const s = sourceSpread(src);
  srcs.set(name, s.spread);
  console.log(`bg=${name}  source subject spread ${s.spread} over ${s.px} masked px`);
  for (const era of ERAS_RUN) {
    const c = measure(name, src, era);
    rows.push(c);
    const d = c.spread - s.spread;
    console.log(`  era ${String(era).padStart(2)} limit ${String(ERAS[era].colours).padStart(3)}  px ${String(c.px).padStart(4)}  colours ${String(c.colours).padStart(3)}  p5 ${String(c.p5).padStart(3)} p50 ${String(c.p50).padStart(3)} p95 ${String(c.p95).padStart(3)}  spread ${String(c.spread).padStart(3)}  vs source ${d >= 0 ? "+" : ""}${d}`);
  }
  console.log();
}

const at = (bg: string, era: Era) => rows.find((r) => r.bg === bg && r.era === era)!;

console.log("=== verdict 1: eras that LOSE value spread vs the source subject ===");
let loses = 0;
for (const [name] of BGS) {
  const ss = srcs.get(name)!;
  const bad = ERAS_RUN.filter((e) => at(name, e).spread < ss);
  loses += bad.length;
  console.log(`bg=${name.padEnd(8)} ${bad.length}/${ERAS_RUN.length} lose` + (bad.length ? `  -> ${bad.map((e) => `era${e} ${at(name, e).spread}<${ss}`).join(", ")}` : ""));
}
console.log(`\ntotal ${loses}/${rows.length} era-background pairs lose value spread`);

console.log("\n=== verdict 2: mask constant? (px must not vary with era) ===");
for (const [name] of BGS) {
  const px = ERAS_RUN.map((e) => at(name, e).px);
  console.log(`bg=${name.padEnd(8)} px ${px.join(" / ")}  ${new Set(px).size === 1 ? "CONSTANT ok" : "VARIES - masks differ, comparison invalid"}`);
}

console.log("\n=== verdict 3: does a wider era spend more of its colour budget? ===");
for (const [name] of BGS) {
  console.log(`bg=${name.padEnd(8)} ${ERAS_RUN.map((e) => `era${e}=${at(name, e).colours}/${ERAS[e].colours} (${Math.round((at(name, e).colours / ERAS[e].colours) * 100)}%)`).join("  ")}`);
}

console.log("\n=== verdict 4: is the subject separable from a matching background? ===");
// Value separation = |subject median luma - background luma|. Below ~12 the subject melts into it.
for (const [name, bg] of BGS) {
  const bgL = bg === "gradient" ? null : luma(bg[0], bg[1], bg[2]);
  const p50 = at(name, ERAS_RUN[2]).p50; // era 32 = the realistic working era
  const sep = bgL === null ? null : Math.abs(p50 - bgL);
  console.log(`bg=${name.padEnd(8)} bg luma ${bgL === null ? "gradient" : Math.round(bgL)}  subject p50 ${p50}  separation ${sep === null ? "n/a" : Math.round(sep) + (sep >= 12 ? " ok" : " TOO LOW - subject melts")}`);
}
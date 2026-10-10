// Per-MATERIAL hue integrity — the corrected version of bench/hue-recheck.ts.
//
// bench/hue-recheck.ts counted every pixel >60 deg from the subject's mean hue as an
// outlier. That metric is wrong: the subject is a RED ball + BLUE hat + TAN arms, so ~12%
// of pixels are legitimately off-hue BY DESIGN at every era. A defect has to be measured
// INSIDE one material, not across the whole subject.
//
// The metric here is MATERIAL ESCAPE RATE: a chromatic subject pixel that sits outside all
// three designed hue windows. If quantization breaks a material's hue, its pixels escape
// into some other hue family — that is the "dark teal shadow / stray magenta" the visual
// pass reported on the era 8 sphere.
//   npx tsx bench/hue-by-material.ts
import { oklabToOklch, rgbToOklab } from "../src/color/oklab";
import { pixelizeSprite } from "../src/pixel/sprite";
import { shadedSubject, type Bg } from "../src/pixel/modes.fixtures";
import { ERAS, type Era } from "../src/pixel/types";

const ERAS_RUN: Era[] = [8, 16, 32, 64];

/** Shortest angular distance between two hue angles in degrees (0-180). */
const hueGap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

/** The fixture's designed hue families, read off modes.fixtures.ts source colours. */
const MATERIALS: { name: string; hue: number }[] = [
  { name: "body(red)", hue: 25 },
  { name: "hat(blue)", hue: 265 },
  { name: "arms(tan)", hue: 75 },
];

/** Hue window: how far a pixel may sit from its nearest designed family and still count. */
const WINDOW_DEG = 30;
/** Chroma below this is achromatic (a grey/black/white shadow) and has no meaningful hue. */
const MIN_CHROMA = 0.02;

const hueOf = (r: number, g: number, b: number) => { const [, , H] = oklabToOklch(rgbToOklab(r, g, b)); return (((H * 180) / Math.PI) + 360) % 360; };
const chromaOf = (r: number, g: number, b: number) => oklabToOklch(rgbToOklab(r, g, b))[1];

interface Stat { bg: string; era: Era; chromatic: number; escapes: number; worst: number }

function measure(bg: string, src: ReturnType<typeof shadedSubject>, era: Era): Stat {
  const nat = pixelizeSprite(src, { era, width: 32, seed: 1 }).native;
  let chromatic = 0, escapes = 0, worst = 0;
  for (let i = 0; i < nat.data.length; i += 4) {
    if (nat.data[i + 3] === 0) continue;                       // keyed-out background
    const r = nat.data[i], g = nat.data[i + 1], b = nat.data[i + 2];
    if (chromaOf(r, g, b) < MIN_CHROMA) continue;              // grey shadow: no hue to judge
    chromatic++;
    const h = hueOf(r, g, b);
    const nearest = Math.min(...MATERIALS.map((m) => hueGap(h, m.hue)));
    worst = Math.max(worst, nearest);
    if (nearest > WINDOW_DEG) escapes++;
  }
  return { bg, era, chromatic, escapes, worst: Math.round(worst) };
}

const BGS: [string, Bg][] = [["dark", [20, 22, 30]], ["mid", [128, 128, 128]], ["light", [230, 230, 235]], ["gradient", "gradient"]];
const rows: Stat[] = [];

console.log(`Material escape rate (window ${WINDOW_DEG} deg, chroma > ${MIN_CHROMA}) — mask constant\n`);
for (const [name, bg] of BGS) {
  const src = shadedSubject(bg, 200, 240);
  for (const era of ERAS_RUN) {
    const c = measure(name, src, era);
    rows.push(c);
    const pct = c.chromatic ? (c.escapes / c.chromatic) * 100 : 0;
    console.log(`bg=${name.padEnd(8)} era ${String(era).padStart(2)} limit ${String(ERAS[era].colours).padStart(3)}  subject px 430  chromatic ${String(c.chromatic).padStart(3)}  escaped ${String(c.escapes).padStart(3)} (${pct.toFixed(0)}%)  worst ${c.worst} deg from any family`);
  }
  console.log();
}

const at = (bg: string, era: Era) => rows.find((r) => r.bg === bg && r.era === era)!;
const rate = (bg: string, era: Era) => { const c = at(bg, era); return c.chromatic ? (c.escapes / c.chromatic) * 100 : 0; };

console.log("=== escape rate by era ===");
for (const [name] of BGS) {
  console.log(`bg=${name.padEnd(8)} ${ERAS_RUN.map((e) => `era${e}=${rate(name, e).toFixed(0)}%`).join("  ")}`);
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const byEra = ERAS_RUN.map((e) => ({ era: e, rate: avg(BGS.map(([n]) => rate(n, e))), worst: avg(BGS.map(([n]) => at(n, e).worst)) }));
console.log("\n=== averaged over backgrounds ===");
for (const r of byEra) console.log(`  era ${String(r.era).padStart(2)} limit ${String(ERAS[r.era].colours).padStart(3)}  escape ${r.rate.toFixed(1)}%  worst ${r.worst.toFixed(0)} deg`);

const e8 = byEra.find((r) => r.era === 8)!;
const e64 = byEra.find((r) => r.era === 64)!;
console.log("\n=== verdict ===");
console.log(`era 8 escape ${e8.rate.toFixed(1)}% (worst ${e8.worst.toFixed(0)} deg)  vs  era 64 escape ${e64.rate.toFixed(1)}% (worst ${e64.worst.toFixed(0)} deg)`);
console.log(e8.rate > e64.rate * 1.5 && e8.worst > e64.worst * 1.15
  ? "\nCONFIRMED: era 8 loses hue integrity, not value. Value passes (value-recheck: 0/16 lose); hue is what breaks."
  : "\nNOT CONFIRMED — escape rate does not separate era 8 from era 64. Re-measure; do not write this into docs.");
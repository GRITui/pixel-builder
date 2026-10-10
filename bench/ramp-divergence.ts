// Find the layer where run 1 (ramp-materials.ts) and run 3 (ramp-robust.ts) diverge on the
// same nominal fixture (fabric/red, hue 15, chroma 0.16). Layers:
//   1. fixture bytes    — two independent builders (repo oklab vs hand-rolled oklab)
//   2. source stats     — repo chromaOf vs hand-rolled chromaOf on the SAME pixels
//   3. era-16 render    — the pixelizer output itself (is it identical?)
//   npx tsx bench/ramp-divergence.ts
import { oklabToOklch, rgbToOklab } from "../src/color/oklab";
import { pixelizeSprite } from "../src/pixel/sprite";
import { materialSphere, MATERIALS, rampOf } from "./ramp-materials";
import { sphere } from "./ramp-robust";

const fab = MATERIALS.find((m) => m.name === "fabric(red)")!;

// --- layer 1: fixture bytes ---
const A = materialSphere(fab);          // built with repo oklabToRgb
const B = sphere(15, 0.16);             // built with hand-rolled oklabToRgb
let diffs = 0, firstAt = -1, maxDelta = 0;
for (let i = 0; i < A.data.length; i++) {
  const d = Math.abs(A.data[i] - B.data[i]);
  if (d) {
    if (!diffs) firstAt = i;
    diffs++;
    if (d > maxDelta) maxDelta = d;
  }
}
console.log(`layer 1 fixture bytes: ${diffs} differing bytes of ${A.data.length} (max delta ${maxDelta}, first at ${firstAt})`);

// --- layer 2: stats on the SAME pixels ---
const repoC = (r: number, g: number, b: number) => oklabToOklch(rgbToOklab(r, g, b))[1];
const handC = (r: number, g: number, b: number) => { const [, a, bb] = rgbToOklab(r, g, b); return Math.hypot(a, bb); };
console.log("\nlayer 2 chroma of 5 fixture pixels (repo oklch C vs hand hypot(a,b) — these SHOULD be identical):");
for (const [x, y] of [[100, 90], [100, 140], [60, 140], [140, 100], [100, 200]]) {
  const i = (y * 200 + x) * 4;
  const [r, g, b] = [A.data[i], A.data[i + 1], A.data[i + 2]];
  console.log(`  rgb(${r},${g},${b})  repo C ${repoC(r, g, b).toFixed(4)}  hand C ${handC(r, g, b).toFixed(4)}`);
}
const sA = rampOf(A);
console.log(`\nrampOf(fixture A): darkC ${sA.darkC.toFixed(4)} midC ${sA.midC.toFixed(4)} lightC ${sA.lightC.toFixed(4)}`);

// --- layer 3: the era-16 render ---
const rA = pixelizeSprite(A, { era: 16, width: 32, seed: 1 }).native;
const rB = pixelizeSprite(B, { era: 16, width: 32, seed: 1 }).native;
let rd = 0;
for (let i = 0; i < rA.data.length; i++) if (Math.abs(rA.data[i] - rB.data[i])) rd++;
console.log(`\nlayer 3 era-16 renders: ${rd} differing bytes of ${rA.data.length}`);
const stA = rampOf(rA), stB = rampOf(rB);
console.log(`render A: darkC ${stA.darkC.toFixed(4)}  render B: darkC ${stB.darkC.toFixed(4)}`);
console.log(`\nCONTRADICTION CHECK vs run 1 (0.107) and run 3 (0.152/0.158):`);
console.log(`  now measuring era16 darkC = ${stA.darkC.toFixed(3)} / ${stB.darkC.toFixed(3)}  src darkC = ${sA.darkC.toFixed(3)}`);

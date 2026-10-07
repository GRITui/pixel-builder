// Snake showcase art: procedural realistic sources -> pixelizer (era 16, one locked look) -> examples/snake/assets.
// Run: npm run snake:assets [-- <preview-dir>]   (a preview dir also gets a contact sheet and a mock game frame)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { saveLook } from "../../src/agent/looks";
import { encodePng } from "../../src/io/png";
import { resizeBox, upscale } from "../../src/io/resize";
import { hexToRgb, labDist2, rgbToHex, rgbToOklab } from "../../src/color/oklab";
import { pixelize } from "../../src/pixel/pipeline";
import { rng } from "../../src/pixel/rng";
import { pixelizeSprite } from "../../src/pixel/sprite";
import { pixelizeTile } from "../../src/pixel/tile";
import type { Look, Rgba } from "../../src/pixel/types";
import { validate } from "../../src/pixel/validate";
import { fruit, grassTex, hex, KEY, REGS, snakePart, wallTex, type SnakePart } from "./render";
import { titleScene } from "./scene";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "assets");
const LOOK_NAME = "snake-16bit";

const blank = (w: number, h: number): Rgba => ({ w, h, data: new Uint8ClampedArray(w * h * 4) });
const getPx = (im: Rgba, x: number, y: number): number[] => [...im.data.subarray((y * im.w + x) * 4, (y * im.w + x) * 4 + 4)];
const setPx = (im: Rgba, x: number, y: number, c: number[]) => im.data.set(c, (y * im.w + x) * 4);
const same = (a: number[], b: number[]) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

function blit(dst: Rgba, src: Rgba, ox: number, oy: number) {
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
    const s = getPx(src, x, y);
    if (s[3] && x + ox >= 0 && y + oy >= 0 && x + ox < dst.w && y + oy < dst.h) setPx(dst, x + ox, y + oy, s);
  }
}
/** Rotate 90 degrees counter-clockwise (a right-edge connection moves to the top edge). */
export function rotCCW(im: Rgba): Rgba {
  const o = blank(im.h, im.w);
  for (let y = 0; y < im.h; y++) for (let x = 0; x < im.w; x++) setPx(o, y, im.w - 1 - x, getPx(im, x, y));
  return o;
}

export async function build(previewDir?: string) {
  mkdirSync(OUT, { recursive: true });
  const out: Record<string, Rgba> = {};

  // 1. Atlas: every subject in one picture, so the palette is chosen for the whole game at once.
  const AW = 1280, AH = 960, bgGrass = hex("#3a9a3a");
  const atlas = blank(AW, AH);
  // top half: the title scene (half the colour mass); bottom half: 8 swatches of 320x240
  const put = (im: Rgba, ox: number, oy: number, w = im.w, h = im.h) => {
    const r = im.w === w && im.h === h ? im : resizeBox(im, w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) setPx(atlas, x + ox, y + oy, getPx(r, x, y));
  };
  const title = titleScene().rgba();
  put(title, 0, 0, 1280, 480);
  const parts: SnakePart[] = ["head", "body", "corner", "tail"];
  const cells: Rgba[] = [...parts.map((p) => snakePart(p, 20, bgGrass, false).rgba()), fruit("apple", 320, bgGrass).rgba(), fruit("gold", 320, bgGrass).rgba(), wallTex(32).rgba(), wallTex(24).rgba()];
  cells.forEach((c, i) => put(c, (i % 4) * 320, 480 + Math.floor(i / 4) * 240, 320, 240));
  const atlasPx = pixelize(atlas, { era: 16, preset: "vivid", seed: 1 });
  const look: Look = { id: LOOK_NAME, name: LOOK_NAME, era: 16, palette: atlasPx.palette, preset: "vivid", bloom: "off", dither: "off", outline: false };
  saveLook(join(here, "looks"), look);
  const popts = { look, era: 16 as const, seed: 1 };
  const palSet = new Set(look.palette);
  const lab = look.palette.map((h) => rgbToOklab(...hexToRgb(h)));
  /** Nearest look-palette colour to an rgb target (all hand edits go through this). */
  const near = (hx: string): number[] => {
    const t = rgbToOklab(...hexToRgb(hx));
    let b = 0, bd = Infinity;
    lab.forEach((q, i) => { const d = labDist2(t, q); if (d < bd) { bd = d; b = i; } });
    return [...hexToRgb(look.palette[b]), 255];
  };

  // 2. Snake parts: sprite mode, 16x16. Registration blocks pin each cell to a native pixel, then edges are matched.
  const S: Record<string, Rgba> = {};
  for (const p of parts) {
    const r = pixelizeSprite(snakePart(p, 32, KEY, true).rgba(), { ...popts, mode: "sprite", width: 16, height: 16 }, { bg: "#00ff00" });
    const im = r.native;
    for (const [x0, y0, w, h] of REGS[p]) for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) setPx(im, x, y, [0, 0, 0, 0]);
    S[p] = im;
  }
  const body = S.body;
  // body: columns 0 and 15 repeat their neighbours; cross profile is mirrored about the axis (top-down light)
  for (let r = 3; r < 13; r++) { setPx(body, 0, r, getPx(body, 1, r)); setPx(body, 15, r, getPx(body, 14, r)); }
  for (let r = 3; r < 8; r++) for (const c of [0, 15]) setPx(body, c, r, getPx(body, c, 15 - r));
  for (let r = 3; r < 8; r++) for (let c = 1; c < 15; c++) if (!same(getPx(body, c, r), getPx(body, c, 15 - r))) setPx(body, c, 15 - r, getPx(body, c, r));
  const B0 = (r: number) => getPx(body, 0, r), B15 = (r: number) => getPx(body, 15, r);
  for (let r = 3; r < 13; r++) {
    setPx(S.head, 0, r, B0(r)); // body | head
    setPx(S.tail, 15, r, B15(r)); // tail | body (tail connects on its right edge)
    setPx(S.corner, 0, r, B0(r)); // left edge of the corner
    setPx(S.corner, r, 15, B15(r)); // bottom edge (a rotated body below it starts with B0)
  }
  // head: tongue pixels (nearest look red) just past the snout
  const tongue = near("#e0203c");
  setPx(S.head, 15, 7, tongue); setPx(S.head, 15, 8, tongue);
  // head: eyes are 3x3 hand-placed blocks (cream + dark pupil looking forward); the pixelizer smears 3px details
  const cream = near("#f8f4d0"), dark = near("#0c0814");
  for (const [top, mid] of [[3, 4], [10, 11]]) for (let y = top; y < top + 3; y++) for (let x = 9; x < 12; x++) setPx(S.head, x, y, y === mid && x > 9 ? dark : cream);
  for (const p of parts) out[p] = S[p];

  // 3. Fruit: plain sprite mode.
  for (const k of ["apple", "gold"] as const) out[k] = pixelizeSprite(fruit(k, 512, KEY).rgba(), { ...popts, mode: "sprite", width: 16, height: 16 }, { bg: "#00ff00" }).native;
  // apple: a 2px specular glint (the 16px resample loses the highlight); only placed on opaque pixels
  const glint = near("#ffc8b8");
  for (const [x, y] of [[4, 6], [4, 7]]) if (getPx(out.apple, x, y)[3]) setPx(out.apple, x, y, glint);

  // 4. Ground: tile mode for grass (b shares a's outer ring, so a and b tile with each other); wall via a 3x3 crop (exactly periodic).
  const ga = pixelizeTile(grassTex(512, 1, 70).rgba(), { ...popts, mode: "tile", width: 16 }).native;
  const gb = pixelizeTile(grassTex(512, 2, 85).rgba(), { ...popts, mode: "tile", width: 16 }).native;
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (x === 0 || y === 0 || x === 15 || y === 15) setPx(gb, x, y, getPx(ga, x, y));
  out["grass-a"] = ga; out["grass-b"] = gb;
  const w1 = wallTex(16).rgba(), w3 = blank(w1.w * 3, w1.h * 3);
  for (let i = 0; i < 9; i++) for (let y = 0; y < w1.h; y++) for (let x = 0; x < w1.w; x++) setPx(w3, (i % 3) * w1.w + x, Math.floor(i / 3) * w1.h + y, getPx(w1, x, y));
  const wall48 = pixelize(w3, { ...popts, mode: "scene", width: 48, height: 48 }).native, wall = blank(16, 16);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) setPx(wall, x, y, getPx(wall48, x + 16, y + 16));
  out.wall = wall;

  // 5. Title scene 320x240.
  out.title = pixelize(title, { ...popts, mode: "scene", width: 320, height: 240 }).native;

  // 6. Write + validate
  const report: Record<string, unknown> = {};
  for (const [name, im] of Object.entries(out)) {
    writeFileSync(join(OUT, `${name}.png`), encodePng(im));
    const v = validate(im, { maxColours: 48 });
    const used = new Set<string>();
    let offPalette = 0;
    for (let i = 0; i < im.w * im.h; i++) if (im.data[i * 4 + 3]) { const h = rgbToHex(im.data[i * 4], im.data[i * 4 + 1], im.data[i * 4 + 2]); used.add(h); if (!palSet.has(h)) offPalette++; }
    report[name] = { ok: v.ok && offPalette === 0, colours: v.colours, size: `${im.w}x${im.h}`, offPalette };
  }
  writeFileSync(join(OUT, "palette.json"), JSON.stringify({ look: LOOK_NAME, palette: look.palette }, null, 2) + "\n");
  if (previewDir) writePreviews(out, previewDir);
  return { report, palette: look.palette, out };
}

function writePreviews(a: Record<string, Rgba>, dir: string) {
  mkdirSync(dir, { recursive: true });
  const names = ["head", "body", "corner", "tail", "apple", "gold", "grass-a", "grass-b", "wall"];
  // contact sheet: each asset on magenta (shows transparency), 6x, then the 1x strip
  const cs = blank(names.length * 17 + 1, 18);
  for (let i = 0; i < cs.w * cs.h; i++) cs.data.set([255, 0, 255, 255], i * 4);
  names.forEach((n, i) => blit(cs, a[n], 1 + i * 17, 1));
  writeFileSync(join(dir, "contact-6x.png"), encodePng(upscale(cs, 6)));
  writeFileSync(join(dir, "contact-1x.png"), encodePng(cs));
  // mock frame
  const W = 20, H = 15, f = blank(W * 16, H * 16), r = rng(5);
  for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) blit(f, tx === 0 || ty === 0 || tx === W - 1 || ty === H - 1 ? a.wall : r() < 0.5 ? a["grass-a"] : a["grass-b"], tx * 16, ty * 16);
  const cell = (im: Rgba, x: number, y: number) => blit(f, im, x * 16, y * 16);
  cell(a.head, 10, 7); cell(a.body, 9, 7); cell(a.body, 8, 7); cell(a.corner, 7, 7);
  cell(rotCCW(a.body), 7, 8); cell(rotCCW(a.tail), 7, 9);
  cell(a.apple, 14, 4); cell(a.gold, 4, 11);
  writeFileSync(join(dir, "frame-3x.png"), encodePng(upscale(f, 3)));
  writeFileSync(join(dir, "frame-1x.png"), encodePng(f));
  writeFileSync(join(dir, "title-3x.png"), encodePng(upscale(a.title, 3)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  build(process.argv[2]).then(({ report, palette }) => {
    console.log(JSON.stringify({ palette: palette.length, report }, null, 2));
    if (Object.values(report).some((r) => !(r as { ok: boolean }).ok)) process.exit(1);
  });
}

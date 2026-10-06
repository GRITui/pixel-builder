import { describe, expect, it } from "vitest";
import { KIT_PRESETS, resolveRamps } from "./kit";
import { GENERATORS, defaults } from "./generators";
import { grade, lightMap, type LitObject } from "./lighting";
import { lightScene, richLights } from "./lightbuf";
import { colorIndex, flattenPaletteFx, hexToRgb } from "./palette";
import { createSprite } from "./sprite";

const kit = KIT_PRESETS.find((k) => k.id === "kit-hd-rich")!;
const flat = flattenPaletteFx(resolveRamps(kit));
const rgbAt = (s: { data: Uint8Array | number[]; w: number }, x: number, y: number) => hexToRgb(flat[s.data[y * s.w + x]]!);
const hue = ([r, g, b]: number[]) => { const m = Math.max(r, g, b) || 1; return { r: r / m, b: b / m }; };

function scene() {
  const img = createSprite(120, 70);
  for (let y = 0; y < 70; y++) for (let x = 0; x < 120; x++) img.data[y * 120 + x] = colorIndex("stone", 2);
  const box = (x0: number, mat: "cloth" | "roof" | "foliage") => {
    for (let y = 10; y < 30; y++) for (let x = x0; x < x0 + 14; x++) img.data[y * 120 + x] = colorIndex(mat, 2);
  };
  box(6, "roof"); box(26, "cloth"); box(46, "foliage");
  const objects: LitObject[] = [
    { sprite: createSprite(5, 16), x: 90, y: 40, name: "lantern", lights: [{ x: 2, y: 3, r: 8, kind: "lantern" }] },
    { sprite: createSprite(10, 10), x: 70, y: 8, name: "house", lights: [{ x: 5, y: 5, r: 5, kind: "window" }] },
  ];
  return { img, objects };
}

describe("light buffer", () => {
  it("is deterministic and keeps transparency", () => {
    const { img, objects } = scene();
    img.data[0] = 0;
    const a = lightScene(img, objects, kit, { time: "night", seed: 2 }), b = lightScene(img, objects, kit, { time: "night", seed: 2 });
    expect(a.data).toEqual(b.data);
    expect(a.data[0]).toBe(0);
  });

  it("day is identity", () => {
    const { img, objects } = scene();
    expect(lightScene(img, objects, kit, { time: "day" })).toBe(img);
  });

  it("objects keep their hue order at night", () => {
    const { img, objects } = scene();
    const out = lightScene(img, objects, kit, { time: "night" });
    const red = hue(rgbAt(out, 12, 20)), blue = hue(rgbAt(out, 32, 20)), green = rgbAt(out, 52, 20);
    expect(red.r).toBeGreaterThan(blue.r);
    expect(blue.b).toBeGreaterThan(red.b);
    expect(green[1]).toBeGreaterThanOrEqual(green[0]);
  });

  it("a lantern tints ground red-ish, a window warm", () => {
    const { img, objects } = scene();
    const out = lightScene(img, objects, kit, { time: "night" });
    const far = hue(rgbAt(out, 4, 62)), near = hue(rgbAt(out, 92, 50));
    expect(near.r).toBeGreaterThan(far.r + 0.1);
    const win = hue(rgbAt(out, 75, 13));
    expect(win.r).toBeGreaterThan(win.b);
  });

  it("richLights resolves kinds by explicit kind and name", () => {
    const { objects } = scene();
    const ls = richLights([...objects, { sprite: createSprite(8, 20), x: 0, y: 0, name: "vending-machine" }]);
    expect(ls.map((l) => l.kind)).toEqual(["lantern", "window", "vending"]);
  });

  it("classic grade stays unchanged", () => {
    const { img } = scene();
    expect(grade(img, kit, "night", [], 1, undefined, "classic").data).toEqual(grade(img, kit, "night", [], 1).data);
  });

  it("village night rain: few orphan pixels, fast", () => {
    const g = GENERATORS.find((x) => x.id === "map")!;
    const res = g.generate({ ...defaults(g), biome: "village", cols: 24, rows: 18, detail: "medium" } as never, kit, 3);
    const t0 = Date.now();
    const out = lightMap(res.rows[0].frames[0], res.tilemap!, kit, { time: "night", fx: "rich", seed: 3, wet: "rain" });
    expect(Date.now() - t0).toBeLessThan(8000);
    const { w, h, data } = out;
    let iso = 0, n = 0;
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        let same = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && data[(y + dy) * w + x + dx] === data[y * w + x]) same++;
        n++;
        if (same === 0) iso++;
      }
    expect(iso / n).toBeLessThan(0.03);
  }, 30000);
});

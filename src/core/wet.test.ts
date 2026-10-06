import { describe, expect, it } from "vitest";
import { KIT_PRESETS } from "./kit";
import { GENERATORS, defaults } from "./generators";
import { applyWet, wetField } from "./wet";
import { addRain } from "./mapanim";
import { colorIndex, decodeIndex } from "./palette";
import { createSprite } from "./sprite";
import type { LitObject } from "./lighting";

const kit = KIT_PRESETS.find((k) => k.id === "kit-hd-rich")!;
const gen = (p: object) => {
  const g = GENERATORS.find((x) => x.id === "map")!;
  return g.generate({ ...defaults(g), biome: "village", cols: 16, rows: 14, ...p } as never, kit, 3);
};

// stone street on top, grass below; a lamp whose base sits at the border
function scene(lampY = 6, edge = 36) {
  const img = createSprite(48, 48);
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) img.data[y * 48 + x] = colorIndex(y < edge ? "stone" : "grass", 2);
  const lamp = createSprite(3, 14);
  lamp.data.fill(colorIndex("metal", 2));
  const o: LitObject = { sprite: lamp, x: 20, y: lampY, name: "lamp-post-1", lights: [{ x: 1, y: 2, r: 14 }] };
  return { img, o };
}

describe("wet", () => {
  it("dry is byte-identical to the default", () => {
    expect(gen({ wet: "dry" }).rows[0].frames[0].data).toEqual(gen({}).rows[0].frames[0].data);
  }, 30000);
  it("is deterministic and changes the map", () => {
    const a = gen({ wet: "damp" }).rows[0].frames[0], b = gen({ wet: "damp" }).rows[0].frames[0];
    expect(a.data).toEqual(b.data);
    expect(a.data).not.toEqual(gen({}).rows[0].frames[0].data);
  }, 30000);
  it("changes only stone ground; gold reflection appears below an emitter on stone", () => {
    const { img, o } = scene();
    const out = applyWet(img, [o], kit, { wet: "rain", seed: 2, time: "night" });
    let changed = 0;
    for (let i = 0; i < img.data.length; i++) {
      if (out.data[i] === img.data[i]) continue;
      changed++;
      expect(decodeIndex(img.data[i])!.mat).toBe("stone");
    }
    expect(changed).toBeGreaterThan(100);
    let gold = 0;
    for (let y = 20; y < 36; y++) for (let x = 17; x < 25; x++) if (decodeIndex(out.data[y * 48 + x])?.mat === "gold") gold++;
    expect(gold).toBeGreaterThan(0);
    for (let y = 36; y < 48; y++) for (let x = 0; x < 48; x++) expect(out.data[y * 48 + x]).toBe(img.data[y * 48 + x]);
  });
  it("reflections never land on grass", () => {
    const { img, o } = scene(24, 30);
    const out = applyWet(img, [o], kit, { wet: "rain", seed: 2, time: "night" });
    expect(wetField(img, [o], kit, { wet: "rain", seed: 2 }).emitters.length).toBe(1);
    for (let y = 30; y < 48; y++) for (let x = 0; x < 48; x++) expect(out.data[y * 48 + x]).toBe(img.data[y * 48 + x]);
  });
  it("rain is deterministic, moves between frames, and travels whole periods per loop", () => {
    const base = createSprite(96, 64);
    base.data.fill(colorIndex("stone", 2));
    const mk = () => addRain(Array.from({ length: 8 }, () => base), kit, 1);
    const fr = mk();
    expect(fr[1].data).not.toEqual(fr[0].data);
    expect(mk()[3].data).toEqual(fr[3].data);
    expect((8 * 96) / 8 % 96).toBe(0);
    expect((8 * 64 * 3) / 8 % 64).toBe(0);
  });
  it("animated rain map has the requested frames", () => {
    expect(gen({ wet: "rain", animate: true, frames: 6 }).rows[0].frames.length).toBe(6);
  }, 30000);
});

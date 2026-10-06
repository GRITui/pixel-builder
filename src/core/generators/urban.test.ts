import { describe, expect, it } from "vitest";
import { ALL_KIT_PRESETS, ISO_KIT } from "../kit";
import { applyLighting, findLights } from "../lighting";
import { decodeIndex } from "../palette";
import type { Sprite } from "../types";
import { defaults, generatorById, type Params } from "./index";
import { isoTileW } from "./iso";
import { URBAN_PROP_KINDS, urbanProp } from "./urban";
import { buildStreet, planStreet, streetLitObjects, urbanBuilding, urbanTile, URBAN_BUILDING_STYLES, URBAN_TILE_KINDS } from "./urban-iso";

const KITS = ["kit-iso", "kit-default", "kit-neon", "kit-gameboy"].map((id) => ALL_KIT_PRESETS.find((k) => k.id === id)!);
const KINDS_OF_LIGHT = ["window", "lantern", "lamp", "vending", "sign"];
const valid = (s: Sprite) => s.data.every((v) => v === 0 || decodeIndex(v) !== null);
const rowEmpty = (s: Sprite, y: number) => s.data.slice(y * s.w, (y + 1) * s.w).every((v) => v === 0);
const gen = (id: string, p: Params = {}, kit = ISO_KIT, seed = 1) => generatorById(id)!.generate({ ...defaults(generatorById(id)!), ...p }, kit, seed);
const checkLights = (lights: { x: number; y: number; r: number; kind: string }[], s: Sprite) => {
  for (const l of lights) {
    expect(KINDS_OF_LIGHT).toContain(l.kind);
    expect(l.r).toBeGreaterThan(0);
    expect(l.x).toBeGreaterThanOrEqual(0); expect(l.x).toBeLessThan(s.w);
    expect(l.y).toBeGreaterThanOrEqual(0); expect(l.y).toBeLessThan(s.h);
  }
};

describe("urban props", () => {
  for (const kit of KITS)
    for (const kind of URBAN_PROP_KINDS)
      it(`${kind} renders on ${kit.id}: palette-valid, margin row, deterministic`, () => {
        const a = urbanProp(kit, kind, 3, 0), b = urbanProp(kit, kind, 3, 0);
        expect(a.sprite.data.some((v) => v !== 0)).toBe(true);
        expect(valid(a.sprite)).toBe(true);
        expect(a.sprite.w).toBeGreaterThanOrEqual(isoTileW(kit));
        expect(rowEmpty(a.sprite, a.sprite.h - 1)).toBe(true); // 1px transparent margin under the foot
        expect(a.sprite.data).toEqual(b.sprite.data);
        expect(a.lights).toEqual(b.lights);
        checkLights(a.lights, a.sprite);
      });

  it("is outlined by finalize (everything but the flat weeds decal has an ink-level outline)", () => {
    for (const kind of URBAN_PROP_KINDS.filter((k) => k !== "weeds")) {
      const s = urbanProp(ISO_KIT, kind, 1, 0).sprite;
      expect(s.data.some((v) => v !== 0 && (decodeIndex(v)?.level ?? 9) === 0)).toBe(true);
    }
  });

  it("emitters: vending, chochin, lamp, signs, yatai, neon, taxi and kei car report lights; plain props do not", () => {
    const lit = (k: string, v = 0) => urbanProp(ISO_KIT, k, 1, v).lights;
    expect(lit("vending").map((l) => l.kind)).toContain("vending");
    expect(lit("chochin-stand").every((l) => l.kind === "lantern") && lit("chochin-stand").length >= 2).toBe(true);
    expect(lit("street-lamp").map((l) => l.kind)).toEqual(["lamp"]);
    expect(lit("yatai").map((l) => l.kind)).toContain("lantern");
    expect(lit("neon-sign", 0)[0].color).not.toBe(lit("neon-sign", 1)[0].color); // pink vs cyan
    expect(lit("kei-car", 1).map((l) => l.kind)).toContain("sign"); // taxi roof light
    expect(lit("kei-car", 0).length).toBeGreaterThan(0);
    for (const k of ["bins", "bicycle", "cat", "crates", "potted-plant", "weeds", "utility-pole", "recycle-box"]) expect(lit(k)).toEqual([]);
  });

  it("varies by variant and by seed where it should", () => {
    const f = (k: string, seed: number, v: number) => urbanProp(ISO_KIT, k, seed, v).sprite.data.join(",");
    expect(f("vending", 1, 0)).not.toBe(f("vending", 1, 1));
    expect(f("cat", 1, 0)).not.toBe(f("cat", 1, 1));
    expect(f("vending", 1, 0)).not.toBe(f("vending", 2, 0));
  });

  it("the urban-prop generator reports meta.lights and is registered as iso-prop kinds", () => {
    const res = gen("urban-prop", { kind: "vending" });
    expect((res.meta!.lights as unknown[]).length).toBeGreaterThan(0);
    expect(res.rows[0].frames).toHaveLength(1);
    const iso = gen("iso-prop", { kind: "urban-yatai" });
    expect(iso.rows[0].frames[0].data).toEqual(urbanProp(ISO_KIT, "yatai", 1, 0).sprite.data);
  });
});

describe("urban buildings", () => {
  for (const kit of KITS)
    for (const style of URBAN_BUILDING_STYLES)
      it(`${style} on ${kit.id}: anchored, palette-valid, deterministic, emits`, () => {
        const a = urbanBuilding(kit, { style }, 4), b = urbanBuilding(kit, { style }, 4);
        expect(valid(a.sprite)).toBe(true);
        expect(a.sprite.data).toEqual(b.sprite.data);
        expect(a.sprite.w).toBeGreaterThan(isoTileW(kit) * 2 - 1);
        expect(rowEmpty(a.sprite, a.sprite.h - 1)).toBe(true);
        expect(a.footprint).toBe(2);
        expect(a.lights.length).toBeGreaterThan(0);
        checkLights(a.lights, a.sprite);
      });

  it("styles carry their own emitters (konbini sign, izakaya lanterns, neon, porch lamp)", () => {
    const kinds = (style: string, o = {}) => new Set(urbanBuilding(ISO_KIT, { style, ...o } as never, 2).lights.map((l) => l.kind));
    expect(kinds("konbini").has("sign")).toBe(true);
    expect(kinds("izakaya").has("lantern")).toBe(true);
    expect(kinds("apartment").has("window")).toBe(true);
    expect(kinds("house").has("lamp")).toBe(true);
    expect(kinds("apartment", { neon: "pink" }).has("sign")).toBe(true);
  });

  it("the generator exposes meta.lights and footprint; lit_windows=false removes window emitters", () => {
    const res = gen("urban-building", { style: "apartment", size: 3, floors: 6, lit_windows: true });
    expect(res.meta!.footprint).toBe(2);
    expect((res.meta!.lights as unknown[]).length).toBeGreaterThan(0);
    const dark = gen("urban-building", { style: "apartment", size: 3, floors: 6, lit_windows: false });
    const wins = (r: typeof dark) => (r.meta!.lights as { kind: string }[]).filter((l) => l.kind === "window").length;
    expect(wins(dark)).toBeLessThan(wins(res));
  });
});

describe("urban tiles", () => {
  it("roads are full diamonds (no transparency, not outlined); sidewalks add a raised wall", () => {
    const T = isoTileW(ISO_KIT);
    for (const kind of URBAN_TILE_KINDS) {
      const s = urbanTile(ISO_KIT, kind, 1, 0, { axis: "se", side: "sw", kerb: 5, tenji: true });
      const raised = kind === "sidewalk" || kind === "lot";
      expect(s.w).toBe(T);
      expect(s.h).toBe(T / 2 + (raised ? 2 : 0));
      expect(valid(s)).toBe(true);
      // the diamond centre row is fully opaque across its widest rows
      expect(s.data[(T / 4) * T + T / 2]).not.toBe(0);
    }
  });

  it("is deterministic per seed/variant and crosswalk stripes repeat across the traffic axis", () => {
    const a = urbanTile(ISO_KIT, "crosswalk", 1, 0, { axis: "se" }), b = urbanTile(ISO_KIT, "crosswalk", 1, 0, { axis: "se" });
    expect(a.data).toEqual(b.data);
    expect(urbanTile(ISO_KIT, "asphalt", 1, 0).data).not.toEqual(urbanTile(ISO_KIT, "asphalt", 2, 0).data);
    expect(urbanTile(ISO_KIT, "crosswalk", 1, 0, { axis: "se" }).data).not.toEqual(urbanTile(ISO_KIT, "crosswalk", 1, 0, { axis: "sw" }).data);
  });
});

describe("iso-street", () => {
  const street = buildStreet(ISO_KIT, 16, 16, 1, 1);

  it("plans a 2-wide crossroads with a sidewalk ring and corner cells", () => {
    const p = planStreet(16, 16);
    expect(p.road[p.rc * 16 + 0] && p.road[(p.rc + 1) * 16 + 15] && p.road[0 * 16 + p.cc] && p.road[15 * 16 + p.cc + 1]).toBe(true);
    expect(p.road[(p.rc - 1) * 16 + 0]).toBe(false);
    expect(p.sidewalk[(p.rc - 1) * 16 + p.cc - 1]).toBe(true); // corner
    expect(p.sidewalk[(p.rc - 1) * 16 + 2]).toBe(true);
  });

  it("lays out crosswalks, centre lines, kerbs and the four corner blocks", () => {
    const names = street.tm.tiles.map((t) => t.name);
    for (const kind of ["crosswalk", "line", "sidewalk", "lot", "manhole", "asphalt"]) expect(names.some((n) => n.startsWith(kind))).toBe(true);
    expect(street.tm.orientation).toBe("isometric");
    const { cc, rc } = street.meta;
    expect([cc, rc]).toEqual([8, 8]);
    const quad = new Set(street.meta.buildings.map((b) => `${b.c < cc ? "w" : "e"}${b.r < rc ? "n" : "s"}`));
    expect(quad.size).toBe(4);
    for (const s of ["konbini", "izakaya", "apartment", "house"]) expect(street.meta.buildings.some((b) => b.style === s)).toBe(true);
    const placed = street.tm.tiles.map((t) => t.name);
    for (const k of ["urban-vending", "urban-yatai", "urban-neon-sign", "urban-kei-car", "urban-recycle-box", "urban-utility-pole", "urban-cat", "urban-bins", "urban-bicycle", "urban-weeds"]) expect(placed.some((n) => n.startsWith(k))).toBe(true);
  });

  it("is deterministic by seed and exposes lights for lighting", () => {
    const again = buildStreet(ISO_KIT, 16, 16, 1, 1);
    expect(again.image.data).toEqual(street.image.data);
    expect(street.meta.lights.length).toBeGreaterThan(30);
    expect(new Set(street.meta.lights.map((l) => l.kind))).toEqual(new Set(KINDS_OF_LIGHT));
    const objs = streetLitObjects(street.tm);
    expect(objs.length).toBe(street.tm.deco.filter((d) => d >= 0).length);
    const lights = findLights(objs);
    expect(lights.length).toBe(street.meta.lights.length);
    for (const l of lights) { expect(l.x).toBeGreaterThanOrEqual(0); expect(l.x).toBeLessThan(street.image.w); expect(l.y).toBeLessThan(street.image.h); }
  });

  it("the generator returns a tilemap and the existing night grade still runs on it", () => {
    const res = gen("iso-street");
    expect(res.tilemap).toBeTruthy();
    expect((res.meta!.lights as unknown[]).length).toBeGreaterThan(0);
    const night = applyLighting(street.image, street.objects, ISO_KIT, { time: "night" });
    expect(night.w).toBe(street.image.w);
  });
});

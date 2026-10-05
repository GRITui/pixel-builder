import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ALL_KIT_PRESETS, HD_RICH_KIT, KIT_PRESETS } from "../kit";
import { findLights } from "../lighting";
import { decodeIndex, PALETTE_SIZE_ALL } from "../palette";
import { bounds, getPx } from "../sprite";
import { buildingFootprint } from "../footprint";
import { buildingGenerator } from "./building";
import { CLASSIC_HASHES } from "./building-classic-hashes";
import { richDoorHeight } from "./building-rich";
import { renderRich } from "./building-rich-render";
import { coerceParams, defaults } from "./types";

const CLASSIC_STYLES = ["cottage", "shop", "tower", "keep", "barn", "stilt-house", "half-brick", "farmhouse", "coop"];
const NEW_STYLES = ["inn", "blacksmith", "temple", "windmill", "greenhouse", "market-stall", "well-house"];
const STYLES = [...CLASSIC_STYLES, ...NEW_STYLES];
const SIZES = ["small", "medium", "large"];
const kits = [...KIT_PRESETS.filter((k) => k.camera !== "side"), HD_RICH_KIT];
const run = (extra: Record<string, string | number | boolean>, kit = kits[0], seed = 7) =>
  buildingGenerator.generate({ ...defaults(buildingGenerator), ...extra }, kit, seed);
const gen = (extra: Record<string, string | number | boolean>, kit = kits[0], seed = 7) => run(extra, kit, seed).rows[0].frames[0];
const hash = (s: { w: number; h: number; data: number[] }) => createHash("sha1").update(`${s.w}x${s.h}`).update(Buffer.from(s.data)).digest("hex").slice(0, 12);

/** One string per sprite instead of one `expect` per pixel (fast). */
function marginIssues(s: { w: number; h: number; data: number[] }): string {
  for (let x = 0; x < s.w; x++) if (getPx(s as never, x, 0) || getPx(s as never, x, s.h - 1)) return `row at x=${x}`;
  for (let y = 0; y < s.h; y++) if (getPx(s as never, 0, y) || getPx(s as never, s.w - 1, y)) return `column at y=${y}`;
  return "";
}
function paletteIssues(s: { data: number[] }): string {
  for (const v of s.data) if (v && (v >= PALETTE_SIZE_ALL || !decodeIndex(v))) return `bad index ${v}`;
  return "";
}

describe("building look param", () => {
  it("defaults to classic and keeps classic output byte-identical", () => {
    const look = buildingGenerator.params.find((p) => p.key === "look");
    expect(look && look.type === "select" && look.default).toBe("classic");
    for (const kit of ALL_KIT_PRESETS)
      for (const st of CLASSIC_STYLES)
        for (const size of SIZES) expect(hash(gen({ style: st, size }, kit)), `${kit.id}/${st}/${size}`).toBe(CLASSIC_HASHES[`${kit.id}/${st}/${size}`]);
  });

  it("rich-only params do not change classic output", () => {
    for (const st of CLASSIC_STYLES) expect(hash(gen({ style: st, tier: 3, sign: "INN", yard: "on", ivy: "on", gable: "thai" }))).toBe(hash(gen({ style: st })));
  });
});

describe.each(kits.map((k) => [k.id, k] as const))("rich buildings in %s", (_id, kit) => {
  it.each(STYLES)("%s: deterministic, footprint-sized, margin, palette-only", (style) => {
    for (const size of NEW_STYLES.includes(style) ? ["medium"] : SIZES) {
      const r = run({ style, size, look: "rich" }, kit);
      for (const row of r.rows)
        for (const s of row.frames) {
          const fp = buildingFootprint(style, size, kit);
          expect(s.w).toBe(fp.w * kit.sizes.tile + 4);
          expect(marginIssues(s)).toBe("");
          expect(paletteIssues(s)).toBe("");
        }
      expect(hash(gen({ style, size, look: "rich" }, kit))).toBe(hash(r.rows[0].frames[0]));
      const b = bounds(r.rows[0].frames[0])!;
      expect(b.y1 - b.y0 + 1).toBeGreaterThan(kit.sizes.character * 1.25);
    }
  });

  it("door is at least 1.25x the character and fits under the roof", () => {
    expect(richDoorHeight(kit)).toBeGreaterThanOrEqual(kit.sizes.character * 1.25);
    const s = gen({ style: "cottage", look: "rich" }, kit);
    expect(s.h).toBeGreaterThan(richDoorHeight(kit) + kit.sizes.character * 0.5);
  });

  it("proportions: wall per storey is at most 1.6 characters (tiny kits need the door plus a lintel) and the roof is over 45% of a one-storey house", () => {
    for (const style of ["cottage", "farmhouse", "inn"]) {
      const fp = buildingFootprint(style, "medium", kit);
      const { L } = renderRich(style, { ...defaults(buildingGenerator), look: "rich" }, kit, 1, fp);
      const perStorey = L.wallH / fp.storeys;
      expect(perStorey, `${style} wall`).toBeLessThanOrEqual(kit.sizes.character * 1.6);
      expect(perStorey).toBeGreaterThanOrEqual(richDoorHeight(kit) * 0.95);
      if (fp.storeys === 1 && style !== "shop") expect(L.rh / (L.rh + L.wallH), `${style} roof share`).toBeGreaterThan(0.45);
    }
  });

  it("materials re-skin the same footprint", () => {
    const a = gen({ style: "cottage", look: "rich", roof: "sand" }, kit);
    const b = gen({ style: "cottage", look: "rich", roof: "metal" }, kit);
    expect(hash(a)).not.toBe(hash(b));
    expect(a.w).toBe(b.w);
  });
});

describe("rich details", () => {
  const kit = HD_RICH_KIT;
  const base = { look: "rich" } as const;

  it("add-ons change the picture and stay inside the canvas", () => {
    const plain = hash(gen({ style: "cottage", ...base, lanterns: "off", yard: "off", ivy: "off", wear: "off", awning: "off", sign: "none" }, kit));
    const extras: Record<string, string>[] = [{ lanterns: "on" }, { yard: "on" }, { ivy: "on" }, { wear: "on" }, { awning: "on" }, { sign: "HOME" }, { porch: "on" }, { balcony: "on" }, { flower_boxes: "on" }];
    for (const extra of extras) {
      const s = gen({ style: "cottage", ...base, lanterns: "off", yard: "off", ivy: "off", wear: "off", awning: "off", sign: "none", ...extra }, kit);
      expect(hash(s), JSON.stringify(extra)).not.toBe(plain);
      expect(s.w).toBe(buildingFootprint("cottage", "medium", kit).w * kit.sizes.tile + 4);
      expect(marginIssues(s), JSON.stringify(extra)).toBe("");
    }
  });

  it("every add-on on at once keeps the margin and palette for every style", () => {
    const all = { lanterns: "on", yard: "on", ivy: "on", wear: "on", porch: "on", balcony: "on", flower_boxes: "on", awning: "on", sign: "HOME", hayloft: "on" };
    for (const style of STYLES)
      for (const gable of ["western", "thai"]) {
        const r = run({ style, look: "rich", gable, ...all }, kit);
        for (const row of r.rows) for (const f of row.frames) { expect(marginIssues(f), `${style}/${gable}`).toBe(""); expect(paletteIssues(f)).toBe(""); }
      }
  });

  it("sign text and awning colour re-skin", () => {
    const a = hash(gen({ style: "shop", ...base, sign: "SHOP" }, kit));
    expect(hash(gen({ style: "shop", ...base, sign: "BAKERY" }, kit))).not.toBe(a);
    expect(hash(gen({ style: "shop", ...base, awning_color: "accent" }, kit))).not.toBe(a);
  });

  it("thai gable differs from western on stilt houses and half-brick", () => {
    for (const style of ["stilt-house", "half-brick"]) expect(hash(gen({ style, ...base, gable: "thai" }, kit))).not.toBe(hash(gen({ style, ...base }, kit)));
  });

  it("hayloft door option on the barn", () => {
    expect(hash(gen({ style: "barn", ...base, hayloft: "on" }, kit))).not.toBe(hash(gen({ style: "barn", ...base, hayloft: "off" }, kit)));
  });

  it("coerceParams accepts the new params and rejects bad values", () => {
    const p = coerceParams(buildingGenerator, { style: "inn", tier: 3, sign: "TAVERN", porch: "yes", gable: "thai", awning_color: "gold" });
    expect(p.style).toBe("inn");
    expect(p.tier).toBe(3);
    expect(p.sign).toBe("TAVERN");
    expect(p.porch).toBe("auto");
    expect(p.gable).toBe("thai");
  });
});

describe("tiers and footprints", () => {
  const kit = HD_RICH_KIT;
  it("footprint grows with the tier for farmhouse, barn and coop", () => {
    for (const style of ["farmhouse", "barn", "coop"]) {
      const a = buildingFootprint(style, "medium", kit, 1), b = buildingFootprint(style, "medium", kit, 2), c = buildingFootprint(style, "medium", kit, 3);
      expect(a.w * a.d * a.storeys).toBeLessThan(b.w * b.d * b.storeys);
      expect(b.w * b.d * b.storeys).toBeLessThan(c.w * c.d * c.storeys);
      expect([a.tier, b.tier, c.tier]).toEqual([1, 2, 3]);
    }
    expect(buildingFootprint("farmhouse", "medium", kit, 3).storeys).toBe(2);
  });

  it("default tier keeps today's footprint", () => {
    expect(buildingFootprint("farmhouse", "medium", kit)).toMatchObject({ w: 6, d: 4, storeys: 1 });
    expect(buildingFootprint("farmhouse", "large", kit)).toMatchObject({ w: 7, d: 5, storeys: 2 });
    expect(buildingFootprint("barn", "small", kit)).toMatchObject({ w: 6, d: 4, storeys: 1 });
    expect(buildingFootprint("farmhouse", "medium", kit, 2)).toMatchObject({ w: 6, d: 4, storeys: 1 });
    expect(buildingFootprint("cottage", "medium", kit, 3)).toMatchObject({ w: 4, d: 3, storeys: 1 }); // tiers only apply to tiered styles
  });

  it("tier sprites follow the tier footprint and meta carries it", () => {
    for (const style of ["farmhouse", "barn", "coop"])
      for (const tier of [1, 2, 3]) {
        const r = run({ style, tier, look: "rich" }, kit);
        const fp = buildingFootprint(style, "medium", kit, tier);
        expect(r.rows[0].frames[0].w).toBe(fp.w * kit.sizes.tile + 4);
        expect(r.meta?.footprint).toEqual(fp);
      }
    const h = (tier: number) => gen({ style: "farmhouse", tier, look: "rich" }, kit).h;
    expect(h(1)).toBeLessThan(h(3));
  });
});

describe("animation rows and lights", () => {
  const kit = HD_RICH_KIT;
  const same = (a: { data: number[] }, b: { data: number[] }) => a.data.every((v, i) => v === b.data[i]);

  it("smoke row: chimney buildings puff, frame 0 is the idle look", () => {
    for (const style of ["cottage", "farmhouse", "inn", "blacksmith", "shop"]) {
      const r = run({ style, look: "rich", chimney: true }, kit);
      const smoke = r.rows.find((x) => x.name === "smoke");
      expect(smoke, style).toBeDefined();
      expect(smoke!.frames.length).toBeGreaterThanOrEqual(4);
      expect(smoke!.frames.length).toBeLessThanOrEqual(6);
      expect(same(smoke!.frames[0], r.rows[0].frames[0])).toBe(true);
      expect(smoke!.frames.some((f, i) => i > 0 && !same(f, smoke!.frames[0]))).toBe(true);
      for (const f of smoke!.frames) expect([f.w, f.h]).toEqual([r.rows[0].frames[0].w, r.rows[0].frames[0].h]);
    }
  });

  it("no chimney, no smoke row", () => {
    expect(run({ style: "cottage", look: "rich", chimney: false }, kit).rows.map((x) => x.name)).toEqual(["idle"]);
    expect(run({ style: "temple", look: "rich" }, kit).rows.map((x) => x.name)).toEqual(["idle"]);
  });

  it("windmill spins: 4 frames, frame 0 equals idle, sails move", () => {
    const r = run({ style: "windmill", look: "rich" }, kit);
    const spin = r.rows.find((x) => x.name === "spin")!;
    expect(spin.frames).toHaveLength(4);
    expect(same(spin.frames[0], r.rows[0].frames[0])).toBe(true);
    for (let i = 1; i < 4; i++) expect(same(spin.frames[i], spin.frames[0])).toBe(false);
  });

  it("meta.lights lists window, lamp and forge emitters inside the sprite", () => {
    for (const [style, extra] of [["inn", {}], ["cottage", {}], ["blacksmith", { lit_windows: false }], ["shop", {}]] as const) {
      const r = run({ style, look: "rich", ...extra }, kit);
      const lights = r.meta?.lights as { x: number; y: number; r: number }[];
      expect(lights.length, style).toBeGreaterThan(0);
      const s = r.rows[0].frames[0];
      for (const l of lights) {
        expect(l.x).toBeGreaterThanOrEqual(0);
        expect(l.x).toBeLessThan(s.w);
        expect(l.y).toBeGreaterThanOrEqual(0);
        expect(l.y).toBeLessThan(s.h);
        expect(l.r).toBeGreaterThan(0);
      }
    }
    expect((run({ style: "cottage", look: "rich", lit_windows: false, lanterns: "off" }, kit).meta?.lights as unknown[]).length).toBe(0);
  });

  it("lights are mirrored with the sprite for top-right kits", () => {
    const k = { ...kit, id: "kit-mirror", lightDir: "top-right" as const };
    const a = run({ style: "inn", look: "rich" }, kit).meta!.lights as { x: number }[];
    const b = run({ style: "inn", look: "rich" }, k).meta!.lights as { x: number }[];
    const w = run({ style: "inn", look: "rich" }, kit).rows[0].frames[0].w;
    expect(b.map((l) => l.x).sort((p, q) => p - q)).toEqual(a.map((l) => w - 1 - l.x).sort((p, q) => p - q));
  });

  it("lighting.findLights reads object lights (offset by the object) instead of guessing from the name", () => {
    const r = run({ style: "inn", look: "rich" }, kit);
    const sprite = r.rows[0].frames[0];
    const lights = r.meta!.lights as { x: number; y: number; r: number }[];
    const out = findLights([{ sprite, x: 100, y: 50, name: "building-inn", lights }]);
    expect(out).toHaveLength(lights.length);
    expect(out[0]).toEqual({ x: 100 + lights[0].x, y: 50 + lights[0].y, r: lights[0].r });
    expect(findLights([{ sprite, x: 0, y: 0, name: "building-inn" }])).toHaveLength(0);
  });
});

describe("rich look and the iso camera", () => {
  it("iso kit ignores look", () => {
    const iso = ALL_KIT_PRESETS.find((k) => k.camera === "iso")!;
    expect(hash(gen({ style: "cottage", look: "rich" }, iso))).toBe(hash(gen({ style: "cottage" }, iso)));
  });
});

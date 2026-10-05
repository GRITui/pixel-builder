import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ALL_KIT_PRESETS, HD_RICH_KIT, KIT_PRESETS } from "../kit";
import { decodeIndex, PALETTE_SIZE_ALL } from "../palette";
import { bounds, getPx } from "../sprite";
import { buildingFootprint } from "../footprint";
import { buildingGenerator } from "./building";
import { CLASSIC_HASHES } from "./building-classic-hashes";
import { richDoorHeight } from "./building-rich";
import { defaults } from "./types";

const STYLES = ["cottage", "shop", "tower", "keep", "barn", "stilt-house", "half-brick", "farmhouse", "coop"];
const SIZES = ["small", "medium", "large"];
const kits = [...KIT_PRESETS.filter((k) => k.camera !== "side"), HD_RICH_KIT];
const gen = (extra: Record<string, string | number | boolean>, kit = kits[0], seed = 7) =>
  buildingGenerator.generate({ ...defaults(buildingGenerator), ...extra }, kit, seed).rows[0].frames[0];
const hash = (s: { w: number; h: number; data: number[] }) => createHash("sha1").update(`${s.w}x${s.h}`).update(Buffer.from(s.data)).digest("hex").slice(0, 12);

describe("building look param", () => {
  it("defaults to classic and keeps classic output byte-identical", () => {
    const look = buildingGenerator.params.find((p) => p.key === "look");
    expect(look && look.type === "select" && look.default).toBe("classic");
    for (const kit of ALL_KIT_PRESETS)
      for (const st of STYLES)
        for (const size of SIZES) expect(hash(gen({ style: st, size }, kit)), `${kit.id}/${st}/${size}`).toBe(CLASSIC_HASHES[`${kit.id}/${st}/${size}`]);
  });
});

describe.each(kits.map((k) => [k.id, k] as const))("rich buildings in %s", (_id, kit) => {
  it.each(STYLES)("%s: deterministic, footprint-sized, margin, palette-only", (style) => {
    for (const size of SIZES) {
      const s = gen({ style, size, look: "rich" }, kit);
      expect(hash(gen({ style, size, look: "rich" }, kit))).toBe(hash(s));
      const fp = buildingFootprint(style, size, kit);
      expect(s.w).toBe(fp.w * kit.sizes.tile + 4);
      for (let x = 0; x < s.w; x++) expect(getPx(s, x, 0)).toBe(0);
      for (let x = 0; x < s.w; x++) expect(getPx(s, x, s.h - 1)).toBe(0);
      for (let y = 0; y < s.h; y++) {
        expect(getPx(s, 0, y)).toBe(0);
        expect(getPx(s, s.w - 1, y)).toBe(0);
      }
      for (const v of s.data)
        if (v) {
          expect(v).toBeLessThan(PALETTE_SIZE_ALL);
          expect(decodeIndex(v)).not.toBeNull();
        }
      const b = bounds(s)!;
      expect(b.y1 - b.y0 + 1).toBeGreaterThan(kit.sizes.character * 1.25);
    }
  });

  it("door is at least 1.25x the character and fits under the roof", () => {
    expect(richDoorHeight(kit)).toBeGreaterThanOrEqual(kit.sizes.character * 1.25);
    const s = gen({ style: "cottage", look: "rich" }, kit);
    expect(s.h).toBeGreaterThan(richDoorHeight(kit) + kit.sizes.character * 0.5);
  });

  it("materials re-skin the same footprint", () => {
    const a = gen({ style: "cottage", look: "rich", roof: "sand" }, kit);
    const b = gen({ style: "cottage", look: "rich", roof: "metal" }, kit);
    expect(hash(a)).not.toBe(hash(b));
    expect(a.w).toBe(b.w);
  });
});

describe("rich look and the iso camera", () => {
  it("iso kit ignores look", () => {
    const iso = ALL_KIT_PRESETS.find((k) => k.camera === "iso")!;
    expect(hash(gen({ style: "cottage", look: "rich" }, iso))).toBe(hash(gen({ style: "cottage" }, iso)));
  });
});

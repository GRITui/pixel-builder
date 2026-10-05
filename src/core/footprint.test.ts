import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FOOTPRINT_STYLES, buildingFootprint, canPlace, doorHeightPx, placeBuilding, storeyHeightPx } from "./footprint";
import { buildingGenerator } from "./generators/building";
import { defaults } from "./generators/types";
import { ALL_KIT_PRESETS, KIT_PRESETS } from "./kit";

const SIZES = ["small", "medium", "large"];

describe("buildingFootprint table", () => {
  it("has the specified defaults", () => {
    const k = KIT_PRESETS[0];
    const dims = (s: string, z = "medium") => { const f = buildingFootprint(s, z, k); return [f.w, f.d, f.storeys]; };
    expect(dims("cottage")).toEqual([4, 3, 1]);
    expect(dims("farmhouse", "small")).toEqual([5, 3, 1]);
    expect(dims("farmhouse", "large")).toEqual([7, 5, 2]);
    expect(dims("barn", "small")).toEqual([6, 4, 1]);
    expect(dims("tower")).toEqual([3, 3, 3]);
    expect(dims("inn")).toEqual([7, 5, 2]);
  });

  for (const kit of KIT_PRESETS) {
    it(`invariants for every style/size in ${kit.id}`, () => {
      for (const style of FOOTPRINT_STYLES) for (const size of SIZES) {
        const f = buildingFootprint(style, size, kit);
        expect(f.door).toBeGreaterThanOrEqual(0);
        expect(f.door).toBeLessThan(f.w);
        expect(f.entry.dx).toBe(f.door);
        expect(f.entry.dy).toBe(f.d); // one row below the front row
        expect(f.entry.dy).toBeGreaterThanOrEqual(f.d);
        expect(f.solid.x).toBeGreaterThanOrEqual(0);
        expect(f.solid.y).toBeGreaterThanOrEqual(0);
        expect(f.solid.x + f.solid.w).toBeLessThanOrEqual(f.w);
        expect(f.solid.y + f.solid.h).toBeLessThanOrEqual(f.d);
        expect(f.canvas.w).toBeGreaterThan(f.w * kit.sizes.tile);
        expect(f.canvas.h).toBeGreaterThan(f.storeys * storeyHeightPx(kit));
      }
    });
  }

  it("scales to the character in every kit", () => {
    for (const kit of ALL_KIT_PRESETS) {
      const c = kit.sizes.character;
      expect(doorHeightPx(kit)).toBeGreaterThanOrEqual(1.25 * c);
      expect(Math.abs(storeyHeightPx(kit) - 1.6 * c)).toBeLessThanOrEqual(0.5);
      expect(storeyHeightPx(kit)).toBeGreaterThan(doorHeightPx(kit));
    }
  });
});

describe("building generator meta", () => {
  it("returns footprint, door and entry and keeps classic sprites unchanged", () => {
    const out: string[] = [];
    for (const kit of ALL_KIT_PRESETS) for (const style of ["cottage", "shop", "tower", "keep", "barn", "stilt-house", "half-brick", "farmhouse", "coop"]) for (const size of SIZES) {
      const r = buildingGenerator.generate({ ...defaults(buildingGenerator), style, size }, kit, 3);
      out.push(kit.id + style + size + createHash("md5").update(JSON.stringify(r.rows)).digest("hex"));
      if (kit.camera !== "iso") {
        const fp = buildingFootprint(style, size, kit);
        expect(r.meta?.footprint).toEqual(fp);
        expect(r.meta?.door).toBe(fp.door);
        expect(r.meta?.entry).toEqual(fp.entry);
      }
    }
    expect(createHash("md5").update(out.join()).digest("hex")).toBe("90bbc330ba8e48a94efff3db6792eec2");
  });
});

describe("placeBuilding / canPlace", () => {
  const grid = () => ({ w: 12, h: 10, solid: new Uint8Array(120) });
  const fp = buildingFootprint("cottage", "medium", KIT_PRESETS[0]);

  it("marks solid cells and keeps the entry walkable", () => {
    const g = grid();
    const pl = placeBuilding(g, fp, { x: 2, y: 1 });
    expect(pl).not.toBeNull();
    expect(pl!.solidCells).toHaveLength(fp.w * fp.d);
    for (const c of pl!.solidCells) expect(g.solid[c.y * g.w + c.x]).toBe(1);
    expect(pl!.doorCell).toEqual({ x: 2 + fp.door, y: 1 + fp.d - 1 });
    expect(pl!.entryCell).toEqual({ x: 2 + fp.door, y: 1 + fp.d });
    expect(g.solid[pl!.entryCell.y * g.w + pl!.entryCell.x]).toBe(0);
  });

  it("rejects overlap, out of bounds and blocked entries without mutating", () => {
    const g = grid();
    expect(placeBuilding(g, fp, { x: 0, y: 0 })).not.toBeNull();
    expect(canPlace(g, fp, { x: 1, y: 1 })).toBe(false); // overlaps
    expect(canPlace(g, fp, { x: 10, y: 0 })).toBe(false); // right edge
    expect(canPlace(g, fp, { x: -1, y: 5 })).toBe(false);
    expect(canPlace(g, fp, { x: 0, y: 7 })).toBe(false); // entry row falls off the grid (7+3=10)
    const g2 = grid();
    g2.solid[(1 + fp.d) * g2.w + (4 + fp.door)] = 1; // something blocks the entry
    const before = g2.solid.slice();
    expect(placeBuilding(g2, fp, { x: 4, y: 1 })).toBeNull();
    expect(g2.solid).toEqual(before);
  });
});

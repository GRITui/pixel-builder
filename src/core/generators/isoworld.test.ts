import { describe, expect, it } from "vitest";
import { ALL_KIT_PRESETS, DEFAULT_KIT, ISO_KIT } from "../kit";
import { PALETTE_SIZE } from "../palette";
import { defaults, generatorById, type Params } from "./index";
import { ISO_PROP_MARGIN, isoTileW } from "./iso";
import { isoFootprint } from "./isoworld";
import { isoPropOrigin } from "./isomap";

const gen = (id: string, p: Params = {}, kit = ISO_KIT, seed = 1) => {
  const g = generatorById(id)!;
  return g.generate({ ...defaults(g), ...p }, kit, seed);
};
const hash = (r: ReturnType<typeof gen>) => r.rows.flatMap((x) => x.frames.map((f) => f.data.join(","))).join("|");
const STYLES = ["cottage", "shop", "tower", "keep", "barn", "farmhouse", "coop", "stilt-house", "half-brick"];
const ROOFS = ["auto", "gable", "hip", "flat", "dome", "spire", "corrugated"];

describe("iso buildings", () => {
  it("every style x roof renders with sane size, a transparent margin and a bottom-centred footprint", () => {
    for (const style of STYLES)
      for (const roof_style of ROOFS) {
        const res = gen("building", { style, roof_style });
        const s = res.rows[0].frames[0], n = isoFootprint(style, "medium"), T = isoTileW(ISO_KIT);
        expect(s.data.every((v) => v >= 0 && v < PALETTE_SIZE) && s.data.some(Boolean)).toBe(true);
        expect(s.w).toBeGreaterThanOrEqual(n * T);
        expect(s.w).toBeLessThanOrEqual(n * T + 24);
        expect(s.h).toBeLessThan(n * T * 2 + 80);
        const row = (y: number) => s.data.slice(y * s.w, (y + 1) * s.w);
        expect(row(0).every((v) => v === 0)).toBe(true);
        expect(row(s.h - 1).every((v) => v === 0)).toBe(true);
        expect(res.meta).toMatchObject({ camera: "iso", footprint: n });
        const xs = row(s.h - 2).map((v, x) => (v ? x : -1)).filter((x) => x >= 0);
        if (style !== "stilt-house" && style !== "coop") expect(Math.abs((xs[0] + xs[xs.length - 1]) / 2 - (s.w - (style === "stilt-house" ? 9 : 0)) / 2)).toBeLessThanOrEqual(1);
      }
  });

  it("footprints grow with the size param (1x1 .. 3x3) and the two walls differ in shade", () => {
    const w = (size: string) => gen("building", { style: "cottage", size }).rows[0].frames[0].w;
    expect(w("small")).toBeLessThan(w("medium"));
    expect(w("medium")).toBeLessThan(w("large"));
    const s = gen("building").rows[0].frames[0];
    const left = new Set<number>(), right = new Set<number>();
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { const v = s.data[y * s.w + x]; if (v) (x < s.w / 2 ? left : right).add(v); }
    expect(left.size).toBeGreaterThan(3);
    expect(right.size).toBeGreaterThan(3);
  });

  it("is deterministic and valid in every kit preset; non-iso kits take the old path", () => {
    for (const kit of ALL_KIT_PRESETS) {
      const k = { ...kit, camera: "iso" as const };
      expect(hash(gen("building", { style: "shop" }, k, 3))).toBe(hash(gen("building", { style: "shop" }, k, 3)));
    }
    expect(gen("building", {}, DEFAULT_KIT).meta).toBeUndefined();
  });
});

describe("iso props and objects", () => {
  it("environment props keep a clear margin and are centred on the cell column", () => {
    for (const kind of ["oak", "old-oak", "pine", "palm", "dead-tree", "bush", "rock", "boulder", "flowers", "mushroom", "tall-grass", "stump", "crystal"]) {
      const s = gen("environment", { kind }).rows[0].frames[0];
      expect(s.data.some(Boolean), kind).toBe(true);
      expect(s.data.slice((s.h - ISO_PROP_MARGIN) * s.w).every((v) => v === 0), kind).toBe(true);
      expect(s.data.slice(0, s.w).every((v) => v === 0), kind).toBe(true);
      expect(s.w % 2, kind).toBe(0);
    }
    for (const kind of ["grass-tile", "tilled-soil-tile"]) expect(gen("environment", { kind }).rows[0].frames[0]).toMatchObject({ w: 32, h: 16 });
  });

  it("world objects are iso props; inventory icons stay flat", () => {
    for (const kind of ["chest", "chest-open", "barrel", "crate", "torch", "sign", "pot"]) {
      const s = gen("object", { kind }).rows[0].frames[0];
      expect(s.w, kind).toBe(32);
      expect(s.data.slice((s.h - 1) * s.w).every((v) => v === 0), kind).toBe(true);
    }
    expect(gen("object", { kind: "sword" }).rows[0].frames[0].w).toBe(16);
  });

  it("iso-prop extras (well, crop, tree-hd) render deterministically", () => {
    for (const p of <Params[]>[{ kind: "well" }, { kind: "haystack" }, { kind: "crop", variant: 3 }, { kind: "gate-open" }, { kind: "tree-hd", species: "birch" }]) {
      const res = gen("iso-prop", p);
      expect(res.rows[0].frames[0].data.some(Boolean)).toBe(true);
      expect(hash(res)).toBe(hash(gen("iso-prop", p)));
    }
  });
});

describe("iso village", () => {
  it("is deterministic per seed and places buildings on cell centres", () => {
    const p = { cols: 18, rows: 16, village: 4 };
    const a = gen("isomap", p, ISO_KIT, 4), b = gen("isomap", p, ISO_KIT, 4);
    expect(hash(a)).toBe(hash(b));
    const tm = a.tilemap!;
    expect(tm.tiles.filter((t) => t.name.startsWith("bld-")).length).toBeGreaterThan(0);
    for (let r = 0; r < tm.rows; r++)
      for (let c = 0; c < tm.cols; c++) {
        const d = tm.tiles[tm.deco[r * tm.cols + c]];
        if (d) expect(isoPropOrigin(tm, c, r, d.sprite)[0] + d.sprite.w / 2).toBe(((c - r + tm.rows) * tm.tile) / 2);
      }
  });
});

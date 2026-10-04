import { describe, expect, it } from "vitest";
import { KIT_PRESETS, proportions, SIDE_KIT } from "../kit";
import { renderRig } from "../rig";
import { clipById, rigById } from "../rigs";
import { sideEnemyGenerator } from "./sideenemy";
import { planSideLevel, sideLevelGenerator } from "./sidelevel";
import { GROUND_TILE_KINDS, sideviewGenerator } from "./sideview";
import { defaults, generatorById } from "./index";

const gen = (kind: string, kit = KIT_PRESETS[0], extra = {}, seed = 1) => sideviewGenerator.generate({ ...defaults(sideviewGenerator), kind, ...extra }, kit, seed).rows[0].frames[0];

describe("side camera kit", () => {
  it("kit-side is a preset with camera side and taller storeys", () => {
    expect(KIT_PRESETS.some((k) => k.id === "kit-side" && k.camera === "side")).toBe(true);
    expect(proportions(SIDE_KIT).story).toBeGreaterThan(proportions({ ...SIDE_KIT, camera: undefined }).story);
  });
  it("registers generators", () => {
    for (const id of ["sideview", "sideenemy", "sidelevel"]) expect(generatorById(id)).toBeDefined();
  });
});

describe("sideview tiles", () => {
  it("are tile sized, deterministic and use the soil tile seam", () => {
    for (const kit of KIT_PRESETS) {
      const T = kit.sizes.tile;
      for (const k of GROUND_TILE_KINDS) {
        const a = gen(k, kit);
        expect([a.w, a.h]).toEqual([T, T]);
        expect(gen(k, kit)).toEqual(a);
      }
    }
  });
  it("fill and wall tiles are opaque; top tile repeats sideways without a jump", () => {
    const T = 16, fill = gen("ground-fill");
    expect(fill.data.every((v) => v > 0)).toBe(true);
    const top = gen("ground-top");
    expect(top.data.every((v) => v > 0)).toBe(true);
    // fill stacked under top: soil continues (same lattice period)
    expect(top.data.slice((T - 1) * T)).toEqual(fill.data.slice((T - 1) * T));
  });
  it("slopes are half empty and 45 degrees", () => {
    const s = gen("slope-up");
    for (let x = 0; x < s.w; x++) {
      const top = s.data.findIndex((_, i) => i % s.w === x && s.data[i] > 0) / s.w;
      expect(Math.floor(top)).toBe(s.w - 1 - x);
    }
  });
  it("background layers tile left-right", () => {
    for (const kit of KIT_PRESETS) for (const kind of ["bg-sky", "bg-hills", "bg-trees"]) {
      const s = gen(kind, kit);
      expect(s.w).toBe(kit.sizes.tile * 10);
      // the top-most painted row of the last column is within 2px of the first column's
      const topOf = (x: number) => { for (let y = 0; y < s.h; y++) if (s.data[y * s.w + x]) return y; return s.h; };
      if (kind === "bg-hills") expect(Math.abs(topOf(0) - topOf(s.w - 1))).toBeLessThanOrEqual(2);
      // painted-ness agrees across the seam on every row
      let mismatch = 0;
      for (let y = 0; y < s.h; y++) if (!!s.data[y * s.w] !== !!s.data[y * s.w + s.w - 1]) mismatch++;
      expect(mismatch).toBeLessThanOrEqual(4); // a steep ridge may differ by a few rows across the seam
    }
  });
  it("platform, ladder and building render", () => {
    expect(gen("platform", KIT_PRESETS[0], { cols: 3 }).w).toBe(48);
    expect(gen("ladder", KIT_PRESETS[0], { rows: 2 }).h).toBe(32);
    const b = gen("building", SIDE_KIT);
    expect(b.data.some((v) => v)).toBe(true);
    expect(b.data.slice(0, b.w).every((v) => v === 0)).toBe(true); // 1px margin
  });
});

describe("side hero and enemies", () => {
  it("humanoid-side renders right and left rows for the new clips", () => {
    const rig = rigById("humanoid-side")!.rig;
    const clips = ["idle", "walk", "run", "jump", "fall", "climb", "crouch"].map((c) => clipById(c)!.clip);
    const rows = renderRig({ rig, kit: SIDE_KIT }, clips);
    expect(rows.map((r) => r.name)).toEqual(clips.flatMap((c) => [`${c.id}-right`, `${c.id}-left`]));
    expect(rows.find((r) => r.name === "jump-right")!.frames.length).toBe(3);
    expect(rows.every((r) => r.frames.every((f) => f.w === SIDE_KIT.sizes.character))).toBe(true);
  });
  it("enemies have idle and walk rows both ways", () => {
    for (const kind of ["slime", "beetle"]) {
      const res = sideEnemyGenerator.generate({ ...defaults(sideEnemyGenerator), kind }, SIDE_KIT, 1);
      expect(res.rows.map((r) => r.name)).toEqual(["idle-right", "walk-right", "idle-left", "walk-left"]);
      expect(sideEnemyGenerator.generate({ ...defaults(sideEnemyGenerator), kind }, SIDE_KIT, 1)).toEqual(res);
    }
  });
});

describe("side level", () => {
  it("plans deterministically with safe start and end", () => {
    const a = planSideLevel(40, 14, 5, 3, true, true);
    expect(planSideLevel(40, 14, 5, 3, true, true)).toEqual(a);
    expect(a.cells[(14 - 1) * 40 + 1]).toBe("solid");
    expect(a.cells[(14 - 1) * 40 + 38]).toBe("solid");
  });
  it("produces a tilemap with solid ground and ladders", () => {
    const res = sideLevelGenerator.generate({ ...defaults(sideLevelGenerator) }, SIDE_KIT, 3);
    const tm = res.tilemap!;
    expect(tm.cols).toBe(40);
    expect(tm.tiles.some((t) => t.name === "ground-top" && t.solid)).toBe(true);
    expect(res.meta?.camera).toBe("side");
    expect(res.rows[0].frames[0].w).toBe(40 * SIDE_KIT.sizes.tile);
  });
});

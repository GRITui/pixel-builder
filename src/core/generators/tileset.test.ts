import { describe, expect, it } from "vitest";
import { KIT_PRESETS } from "../kit";
import { colorIndex } from "../palette";
import { environmentGenerator } from "./environment";
import { BLOB47_MASKS, TERRAINS, blobCanon, blobLower, tilesetGenerator, tilesetTiles, wangLower, type TilesetLayout } from "./tileset";
import { coerceParams, defaults } from "./types";

const make = (p: Record<string, string | number>, kitIdx = 0, seed = 1) =>
  tilesetGenerator.generate({ ...defaults(tilesetGenerator), ...p }, KIT_PRESETS[kitIdx], seed);
const terrain = (kind: string, kitIdx = 0, seed = 1, variant = 0) =>
  environmentGenerator.generate({ ...defaults(environmentGenerator), kind: `${kind}-tile`, variant }, KIT_PRESETS[kitIdx], seed).rows[0].frames[0];

describe("tileset generator", () => {
  it("offers every ground tile kind as a terrain", () => {
    expect(TERRAINS).toEqual(expect.arrayContaining(["grass", "dirt", "sand", "water", "snow", "paddy", "tilled-soil", "watered-soil", "dried-soil", "snowed-soil", "stone-path"]));
    expect(coerceParams(tilesetGenerator, { upper: "nope", layout: "blob47" })).toMatchObject({ upper: "grass", layout: "blob47" });
  });

  for (const layout of ["wang16", "blob47"] as TilesetLayout[]) {
    it(`${layout}: right tile count, atlas size, opaque, deterministic`, () => {
      for (const kitIdx of [0, 1, 2]) {
        const T = KIT_PRESETS[kitIdx].sizes.tile;
        const r = make({ layout, lower: "dirt", upper: "grass" }, kitIdx);
        const m = (r.meta as any).tileset;
        expect(m.count).toBe(layout === "wang16" ? 16 : 47);
        expect(m.tiles).toHaveLength(m.count);
        const atlas = r.rows[0].frames[0];
        expect(r.rows).toHaveLength(1);
        expect([atlas.w, atlas.h]).toEqual([m.cols * T, m.rows * T]);
        expect(atlas.data.every((v) => v > 0)).toBe(true);
        expect(JSON.stringify(make({ layout, lower: "dirt", upper: "grass" }, kitIdx))).toBe(JSON.stringify(r));
      }
    });
  }

  it("covers all 47 blob masks exactly once, in ascending canonical form", () => {
    expect(BLOB47_MASKS).toHaveLength(47);
    expect(BLOB47_MASKS.every((m) => blobCanon(m) === m)).toBe(true);
    expect([...BLOB47_MASKS].sort((a, b) => a - b)).toEqual(BLOB47_MASKS);
    const { tiles } = tilesetTiles("blob47", 16);
    expect(tiles.map((t) => t.mask)).toEqual(BLOB47_MASKS);
    expect(tiles[0].upper).toEqual([]);
    expect(tiles[46].upper).toHaveLength(8);
  });

  it("wang16 index = NE*1 + SE*2 + SW*4 + NW*8", () => {
    const { tiles } = tilesetTiles("wang16", 16);
    expect(tiles[1].upper).toEqual(["NE"]);
    expect(tiles[2].upper).toEqual(["SE"]);
    expect(tiles[4].upper).toEqual(["SW"]);
    expect(tiles[8].upper).toEqual(["NW"]);
    expect(tiles[15].upper).toEqual(["NE", "SE", "SW", "NW"]);
  });

  it("wang16 corners show the upper terrain exactly where their bit is set", () => {
    for (const kitIdx of [0, 2]) {
      const T = KIT_PRESETS[kitIdx].sizes.tile;
      const up = terrain("grass", kitIdx), lo = terrain("dirt", kitIdx);
      const atlas = make({ layout: "wang16", lower: "dirt", upper: "grass" }, kitIdx).rows[0].frames[0];
      const probes: [number, number, number][] = [[1, T - 1, 0], [2, T - 1, T - 1], [4, 0, T - 1], [8, 0, 0]]; // bit, x, y
      for (let i = 0; i < 16; i++) {
        const ox = (i % 4) * T, oy = Math.floor(i / 4) * T;
        for (const [bit, x, y] of probes) {
          const got = atlas.data[(oy + y) * atlas.w + ox + x];
          expect(got).toBe((i & bit ? up : lo).data[y * T + x]);
        }
      }
    }
  });

  it("blob47 keeps the tile's own cell upper and shows lower toward absent neighbours", () => {
    const T = KIT_PRESETS[0].sizes.tile;
    const up = terrain("grass"), lo = terrain("dirt");
    const atlas = make({ layout: "blob47", lower: "dirt", upper: "grass" }).rows[0].frames[0];
    const mid = T / 2;
    const probes: [number, number, number][] = [[1, mid, 0], [4, T - 1, mid], [16, mid, T - 1], [64, 0, mid]]; // bit, x, y
    BLOB47_MASKS.forEach((mask, i) => {
      const ox = (i % 8) * T, oy = Math.floor(i / 8) * T;
      expect(atlas.data[(oy + mid) * atlas.w + ox + mid]).toBe(up.data[mid * T + mid]);
      for (const [bit, x, y] of probes) expect(atlas.data[(oy + y) * atlas.w + ox + x]).toBe((mask & bit ? up : lo).data[y * T + x]);
    });
  });

  it("wang16 tiles that should join have identical edge ownership", () => {
    const T = 16;
    const edge = (m: Uint8Array, col: number | null, row: number | null) => {
      const out: number[] = [];
      for (let k = 0; k < T; k++) out.push(col !== null ? m[(k + 1) * (T + 2) + col + 1] : m[(row! + 1) * (T + 2) + k + 1]);
      return out.join("");
    };
    const shapes = Array.from({ length: 16 }, (_, i) => wangLower(T, i));
    let pairs = 0;
    for (let a = 0; a < 16; a++)
      for (let b = 0; b < 16; b++) {
        const A = { NE: a & 1, SE: a & 2, SW: a & 4, NW: a & 8 }, B = { NE: b & 1, SE: b & 2, SW: b & 4, NW: b & 8 };
        // b sits east of a: a's NE/SE corners are b's NW/SW corners
        if (!!A.NE === !!B.NW && !!A.SE === !!B.SW) { pairs++; expect(edge(shapes[a], T - 1, null)).toBe(edge(shapes[b], 0, null)); }
        // b sits south of a: a's SW/SE corners are b's NW/NE corners
        if (!!A.SW === !!B.NW && !!A.SE === !!B.NE) { pairs++; expect(edge(shapes[a], null, T - 1)).toBe(edge(shapes[b], null, 0)); }
      }
    expect(pairs).toBe(2 * 16 * 4);
  });

  it("blob47 tiles with both side neighbours present join along that edge", () => {
    const T = 16;
    const col = (m: Uint8Array, x: number) => Array.from({ length: T }, (_, y) => m[(y + 1) * (T + 2) + x + 1]).join("");
    let pairs = 0;
    for (const a of BLOB47_MASKS)
      for (const b of BLOB47_MASKS) {
        const has = (m: number, bit: number) => (m & bit) !== 0;
        // a's E neighbour is b (upper) and b's W neighbour is a; N and S of both present so no corner is dropped
        const ok = has(a, 4) && has(b, 64) && has(a, 1) && has(a, 16) && has(b, 1) && has(b, 16);
        if (!ok || has(a, 2) !== has(b, 128) || has(a, 8) !== has(b, 32)) continue;
        pairs++;
        expect(col(blobLower(T, a), T - 1)).toBe(col(blobLower(T, b), 0));
      }
    expect(pairs).toBeGreaterThan(0);
  });

  it("gives water the foam rim and keeps pure tiles foam-free of transitions", () => {
    const T = KIT_PRESETS[0].sizes.tile;
    const foam = colorIndex("water", 4);
    const count = (atlas: { data: number[]; w: number }, i: number, cols: number) => {
      let n = 0;
      const ox = (i % cols) * T, oy = Math.floor(i / cols) * T;
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) if (atlas.data[(oy + y) * atlas.w + ox + x] === foam) n++;
      return n;
    };
    const atlas = make({ layout: "wang16", lower: "water", upper: "grass" }).rows[0].frames[0];
    const pureWater = count(atlas, 0, 4);
    expect(count(atlas, 3, 4)).toBeGreaterThan(pureWater + 4);
    expect(count(atlas, 15, 4)).toBe(0);
  });

  it("works for farm soils under every kit and varies with variant", () => {
    for (const kitIdx of [0, 1, 2]) {
      const r = make({ lower: "grass", upper: "tilled-soil", layout: "blob47" }, kitIdx);
      expect(r.rows[0].frames[0].data.every((v) => v > 0)).toBe(true);
    }
    const a = make({ variant: 0 }).rows[0].frames[0].data, b = make({ variant: 3 }).rows[0].frames[0].data;
    expect(a).not.toEqual(b);
  });
});

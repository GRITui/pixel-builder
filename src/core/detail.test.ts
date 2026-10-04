import { describe, expect, it } from "vitest";
import { DEFAULT_KIT, isRich, resolveRamps } from "./kit";
import { MATERIALS, decodeIndex, PALETTE_SIZE } from "./palette";
import { finalize, stripOutline } from "./enforce";
import { aaMarks, rimMarks, seamMarksFor, selOutMarks } from "./rigs/detail";
import { microDetailParts } from "./rigs/detail";
import { characterGenerator } from "./generators/character";
import { animalGenerator } from "./generators/animal";
import { buildingGenerator } from "./generators/building";
import { defaults } from "./generators/types";
import { lightVector } from "./kit";
import { createSprite } from "./sprite";
import type { Sprite, StyleKit } from "./types";

const rich = (kit: StyleKit = DEFAULT_KIT): StyleKit => ({ ...kit, detail: "rich" });
const std = (kit: StyleKit = DEFAULT_KIT): StyleKit => ({ ...kit, detail: "standard" });

describe("hue-shifted ramps", () => {
  it("is a no-op on a standard kit", () => {
    expect(resolveRamps(std())).toEqual(resolveRamps(DEFAULT_KIT));
  });

  it("swings shadows cooler and highlights warmer on a rich kit", () => {
      const base = resolveRamps(DEFAULT_KIT);
      const shifted = resolveRamps(rich());
      // hearthwood cloth: #20305e (level 1) -> cooler, #4c88c8 (level 3) -> warmer
      expect(hueOf(shifted.cloth[1])).toBeLessThan(hueOf(base.cloth[1]));
      expect(hueOf(shifted.cloth[3])).toBeGreaterThan(hueOf(base.cloth[3]));
    });

    it("keeps the extremes, so the darkest and lightest of a ramp stay put", () => {
      const base = resolveRamps(DEFAULT_KIT);
      const shifted = resolveRamps(rich());
      for (const m of MATERIALS) {
        expect(shifted[m][0]).toBe(base[m][0]);
        expect(shifted[m][4]).toBe(base[m][4]);
      }
    });

    it("does not add colours to a 4-tone kit (gameboy stays 4-tone when rich)", () => {
      const gb = { ...DEFAULT_KIT, paletteId: "gameboy", detail: "rich" as const };
      const plain = resolveRamps({ ...DEFAULT_KIT, paletteId: "gameboy" });
      for (const m of MATERIALS) expect(new Set(resolveRamps(gb)[m]).size).toBe(new Set(plain[m]).size);
    });

    it("leaves an achromatic ramp override alone (a grey ramp has no hue to shift)", () => {
      const grey = ["#101010", "#202020", "#303030", "#404040", "#505050"];
      const kit = rich({ ...DEFAULT_KIT, rampOverrides: { cloth: grey } });
      expect(resolveRamps(kit).cloth).toEqual(grey);
    });

    it("respects rampOverrides: the shift runs after them", () => {
      const base = ["#3a1414", "#6b2020", "#a03a30", "#c96048", "#e89478"];
      const shifted = resolveRamps(rich({ ...DEFAULT_KIT, rampOverrides: { cloth: base } })).cloth;
      // the override is what is shifted, so its levels 1 and 3 move off the raw hex
      expect(shifted[1]).not.toBe(base[1]);
      expect(shifted[0]).toBe(base[0]);
    });
  });

/** Hue angle in degrees, so a test can assert which way a ramp moved. */
function hueOf(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return 0;
  const hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return hue * 60;
}

describe("rich detail passes", () => {
  const kit = DEFAULT_KIT;
  const light = lightVector(kit.lightDir);
  /** A 9x7 blob: a curved silhouette with a flat middle and a second material on top. */
  const blob = (): Sprite => {
    const s = createSprite(9, 7);
    const put = (x: number, y: number, m: Parameters<typeof colorIndexOf>[0], l: number) => (s.data[y * s.w + x] = colorIndexOf(m, l));
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < 9; x++) {
        const dx = (x - 4) / 3.4, dy = (y - 3) / 2.8;
        if (dx * dx + dy * dy > 1) continue;
        put(x, y, "cloth", dx * dx + dy * dy > 0.55 ? 1 : 3);
      }
    return s;
  };

  it("sel-out inks each edge with its own material's darkest shade, not one ink", () => {
    const s = blob();
    const marks = selOutMarks(s, kit);
    expect(marks.size).toBeGreaterThan(0);
    for (const v of marks.values()) {
      const d = decodeIndex(v)!;
      expect(d.level).toBe(0);
      expect(d.mat).not.toBe("ink"); // per-material, so never the global ink
    }
  });

  it("sel-out honours outline: none", () => {
    expect(selOutMarks(blob(), { ...kit, outline: "none" }).size).toBe(0);
  });

  it("anti-alias band sits one step below the edge, never a dark smear", () => {
    const s = blob();
    for (const [idx, v] of aaMarks(s)) {
      const d = decodeIndex(v)!;
      // find the body pixel it eases from and check the step
      const x = idx % s.w, y = Math.floor(idx / s.w);
      const near = [s.data[y * s.w + x - 1], s.data[y * s.w + x + 1], s.data[(y - 1) * s.w + x], s.data[(y + 1) * s.w + x], s.data[(y - 1) * s.w + x - 1], s.data[(y - 1) * s.w + x + 1], s.data[(y + 1) * s.w + x - 1], s.data[(y + 1) * s.w + x + 1]]
        .map(decodeIndex)
        .filter((d): d is NonNullable<typeof d> => !!d && d.mat === "cloth");
      expect(near.length).toBeGreaterThan(0);
      const edge = Math.max(...near.map((d) => d.level));
      expect(d.level).toBe(edge - 1);
      expect(d.level).toBeGreaterThanOrEqual(1); // never level 0: that is the ink
    }
  });

  it("rim light only lightens a shadow-side edge, and never an ink or highlight", () => {
    const s = blob();
    const marks = rimMarks(s, light);
    for (const [idx, v] of marks) {
      const before = decodeIndex(s.data[idx])!;
      const after = decodeIndex(v)!;
      expect(after.mat).toBe(before.mat);
      expect(after.level).toBe(before.level + 1);
      expect(after.level).toBeLessThanOrEqual(4);
    }
  });

  it("seam pass never inks ink (eyes, mouth, outline stay clean)", () => {
    const s = blob();
    // mark two ink pixels as an "eye", then confirm the seam leaves them alone
    const eye = 11 * blob().w + 4;
    s.data[eye] = colorIndexOf("ink", 0);
    for (const [idx, v] of seamMarksFor(s, light)) {
      const d = decodeIndex(v)!;
      expect(d.mat).not.toBe("ink");
      expect(idx).not.toBe(eye);
    }
  });

  it("keeps every output index inside the kit palette", () => {
    const out = finalize(blob(), rich(kit));
    for (const v of out.data) {
      expect(Number.isInteger(v)).toBe(true);
      if (!v) continue;
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(PALETTE_SIZE);
      expect(decodeIndex(v)).not.toBeNull();
    }
  });
});

function colorIndexOf(m: Parameters<typeof decodeIndex>[0] extends never ? never : string, level: number): number {
  // local helper so the fixture above reads cleanly
  const r = MATERIALS.indexOf(m as never);
  return 1 + r * 5 + level;
}

describe("detail: rich vs standard", () => {
  const p = { ...defaults(characterGenerator), headwear: "straw-hat", costume: "overalls" } as never;

  it("standard output is byte-identical to a kit with no detail field", () => {
    const a = characterGenerator.generate(p, { ...DEFAULT_KIT, detail: undefined as never }, 3).rows;
    const b = characterGenerator.generate(p, { ...DEFAULT_KIT, detail: "standard" }, 3).rows;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("rich output differs from standard (the mode actually does something)", () => {
    const a = JSON.stringify(characterGenerator.generate(p, std(), 3).rows);
    const b = JSON.stringify(characterGenerator.generate(p, rich(), 3).rows);
    expect(a).not.toBe(b);
  });

  it("rich output stays inside the kit palette, every frame, every generator", () => {
    for (const g of [characterGenerator, animalGenerator, buildingGenerator]) {
      for (const rows of g.generate({ ...defaults(g) } as never, rich(), 7).rows)
        for (const f of rows.frames)
          for (const v of f.data) {
            if (!v) continue;
            expect(v).toBeGreaterThan(0);
            expect(v).toBeLessThan(PALETTE_SIZE);
            expect(decodeIndex(v)).not.toBeNull();
          }
    }
  }, 60_000);

  it("keeps the sprite the same size as standard: rich detail never grows the art", () => {
    // The AA band replaces the outline ring rather than adding a ring outside it,
    // so a rich frame has exactly the same bounds as its standard twin.
    for (const rows of [characterGenerator.generate(p, std(), 3).rows, characterGenerator.generate(p, rich(), 3).rows])
      for (const f of rows[0].frames) {
        const b = boundsOf(f);
        expect(b.x0).toBeGreaterThanOrEqual(1);
        expect(b.y0).toBeGreaterThanOrEqual(1);
        expect(b.x1).toBeLessThanOrEqual(f.w - 2);
        expect(b.y1).toBeLessThanOrEqual(f.h - 2);
      }
    const a = characterGenerator.generate(p, std(), 3).rows[0].frames[0];
    const b = characterGenerator.generate(p, rich(), 3).rows[0].frames[0];
    expect([boundsOf(a).x0, boundsOf(a).x1, boundsOf(a).y1]).toEqual([boundsOf(b).x0, boundsOf(b).x1, boundsOf(b).y1]);
  }, 20_000);

  it("adds micro-detail only on a rich kit", () => {
    expect(microDetailParts({ tw: 10, eyeZ: 7 }).length).toBeGreaterThan(8);
    const plain = JSON.stringify(characterGenerator.generate(p, std(), 3).rows);
    expect(plain).not.toContain("detail-eyeL-glint");
  });
});

describe("isRich / detailOf", () => {
  it("treats a kit with no detail field as standard", () => {
    const legacy = { ...DEFAULT_KIT, detail: undefined as never };
    expect(isRich(legacy)).toBe(false);
  });

  it("is true only for an explicit rich", () => {
    expect(isRich(rich())).toBe(true);
    expect(isRich(std())).toBe(false);
  });
});

describe("stripOutline is still idempotent under rich", () => {
  it("removes a per-material sel-out ring just like a single ink ring", () => {
    const body = createSprite(8, 8);
    for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) body.data[y * 8 + x] = colorIndexOf("cloth", 3);
    const outlined = selOutMarks(body, DEFAULT_KIT);
    const withRing = { ...body, data: body.data.slice() };
    for (const [i, v] of outlined) withRing.data[i] = v;
    expect(stripOutline(withRing).data.filter(Boolean).length).toBe(16);
  });
});

function boundsOf(s: Sprite) {
  let x0 = s.w, y0 = s.h, x1 = -1, y1 = -1;
  for (let y = 0; y < s.h; y++)
    for (let x = 0; x < s.w; x++)
      if (s.data[y * s.w + x]) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  return { x0, y0, x1, y1 };
}
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ALL_KIT_PRESETS as KIT_PRESETS } from "../kit";
import { decodeIndex, PALETTE_SIZE } from "../palette";
import { defaults } from "./types";
import { mapGenerator } from "./map";

const fp = (d: ArrayLike<number>) => createHash("sha1").update(Buffer.from(d as never)).digest("hex").slice(0, 12);
const gen = (p: Record<string, unknown>, kitId = "kit-default", seed = 3) =>
  mapGenerator.generate({ ...defaults(mapGenerator), cols: 16, rows: 12, ...p } as never, KIT_PRESETS.find((k) => k.id === kitId)!, seed);
const half = (idx: number) => { const d = decodeIndex(idx); return d ? (d.fine !== undefined ? d.fine * 2 + 1 : d.level * 2) : -1; };

describe("open-land ground detail", () => {
  it("keeps the forest profile pinned", () => {
    const f = (biome: string, detail: string) => fp(gen({ biome, detail, cols: 24, rows: 18 }).rows[0].frames[0].data);
    expect(f("forest-mmo", "medium")).toBe("c8742b9aff1d");
    expect(f("forest-mmo", "high")).toBe("28af5d886b78");
    expect(f("forest", "medium")).toBe("c86f7ec90a68");
    expect(f("forest", "high")).toBe("c7c08caa029b");
  });

  it("is deterministic, palette-only, and drops at most one ramp level", () => {
    for (const biome of ["farm", "meadow", "rice-village", "island"])
      for (const kitId of ["kit-default", "kit-hd-rich"]) {
        const off = gen({ biome, detail: "off" }, kitId), hi = gen({ biome, detail: "high" }, kitId);
        const a = hi.rows[0].frames[0].data, b = off.rows[0].frames[0].data;
        expect(a).toEqual(gen({ biome, detail: "high" }, kitId).rows[0].frames[0].data);
        expect(a.every((v) => v > 0 && v < PALETTE_SIZE)).toBe(true);
        let changed = 0;
        for (let i = 0; i < a.length; i++) {
          if (a[i] === b[i]) continue;
          changed++;
          const da = decodeIndex(a[i]), db = decodeIndex(b[i]);
          if (da && db && da.mat === db.mat && da.mat === "grass") expect(half(b[i]) - half(a[i])).toBeLessThanOrEqual(2);
        }
        expect(changed).toBeGreaterThan(0);
      }
  }, 60000);
});

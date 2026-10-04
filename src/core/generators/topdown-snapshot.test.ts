import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DEFAULT_KIT, KIT_PRESETS, proportions } from "../kit";
import { defaults, generatorById } from "./index";

/**
 * Camera guard (#20): top-down output must never change when the side camera is added.
 * Hashes were recorded on the commit before `camera` existed; if one changes on purpose,
 * re-record it and say why in the commit.
 */
const CASES: [string, Record<string, string | number | boolean>, string][] = [
  ["character", {}, "06dc7d2510558d31"],
  ["animal", { species: "dog" }, "1f943f7dece1e7a7"],
  ["building", { style: "farmhouse" }, "600519a6392a552d"],
  ["environment", { kind: "oak" }, "24a8232e8f81623c"],
  ["environment", { kind: "grass-tile" }, "1f4240165d39314b"],
  ["map", {}, "f44ddb63da20def8"],
  ["tileset", {}, "da01adb0485f7d2b"],
];

function hashResult(id: string, params: Record<string, string | number | boolean>): string {
  const g = generatorById(id)!;
  const res = g.generate({ ...defaults(g), ...params }, DEFAULT_KIT, 1);
  const h = createHash("sha1");
  for (const row of res.rows) {
    h.update(row.name);
    for (const f of row.frames) h.update(`${f.w}x${f.h}:${f.data.join(",")}`);
  }
  return h.digest("hex").slice(0, 16);
}

describe("top-down output is unchanged by the camera field", () => {
  it.each(CASES.map((c, i) => [i, c] as const))("case %i", { timeout: 60000 }, (_i, [id, params, want]) => {
    expect(hashResult(id, params)).toBe(want);
  });
  it("preset kits other than kit-side have no side camera", () => {
    expect(DEFAULT_KIT.camera).toBeUndefined();
    expect(KIT_PRESETS.filter((k) => k.id !== "kit-side").every((k) => k.camera === undefined)).toBe(true);
    expect(proportions(DEFAULT_KIT).figure).toBe(27);
  });
});

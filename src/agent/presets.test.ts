import { describe, expect, it } from "vitest";
import { TOOLS, callTool } from "./tools";

describe("presets tool", () => {
  it("full tool set, each description ends with an example", () => {
    expect(TOOLS.map((t) => t.name).sort()).toEqual(["looks", "presets", "pixelize", "validate"].sort());
    for (const t of TOOLS) expect(t.description).toMatch(/Example: .*\.$/);
  });
  it("lists eras, presets, modes, effects with examples", async () => {
    const d: any = (await callTool({ outDir: "." }, "presets", {})).data;
    expect(d.eras.map((e: any) => e.era)).toEqual([8, 16, 32, 64]);
    expect(d.presets).toHaveLength(7);
    expect(d.modes).toHaveLength(3);
    expect(d.effects).toHaveLength(5);
    expect(d.presets[0].example).toContain("preset=vivid");
  });
});

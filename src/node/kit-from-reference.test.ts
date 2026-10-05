import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveRamps } from "../core/kit";
import { callTool, setReferenceLoader } from "./tools";
import { decodePng } from "./png";
import { Workspace } from "./workspace";
import type { StyleKit } from "../core/types";

let dir: string;
let ws: Workspace;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pb-kfr-"));
  ws = new Workspace(dir);
});
afterEach(() => {
  setReferenceLoader(undefined);
  rmSync(dir, { recursive: true, force: true });
});

const GB = "test/fixtures/refs/gameboy-4tone.png";
type Out = { kit: StyleKit; analysis: { outline: string; limited_palette: boolean; matched_materials: string[]; palette: string[] }; note: string };

describe("kit_from_reference", () => {
  it("creates a kit from a PNG with a preview sheet and the analysis", () => {
    const r = callTool(ws, "kit_from_reference", { path: GB, name: "Brick" });
    const d = r.data as Out;
    expect(d.kit.name).toBe("Brick");
    expect(d.kit.outline).toBe("black");
    expect(d.analysis.limited_palette).toBe(true);
    expect(ws.load().kits.some((k) => k.id === d.kit.id)).toBe(true);
    expect(r.images).toHaveLength(2);
    for (const im of r.images!) expect(decodePng(im.png).width).toBeGreaterThan(16);
    expect(resolveRamps(d.kit).grass).toContain("#306230");
  });

  it("apply=palette leaves outline/light alone; strength 0 keeps the base ramps", () => {
    const base = ws.load().kits[0];
    const palette = (callTool(ws, "kit_from_reference", { path: "test/fixtures/refs/outline-black.png", apply: "palette" }).data as Out).kit;
    expect(palette.outline).toBe(base.outline);
    expect(palette.lightDir).toBe(base.lightDir);
    expect(Object.keys(palette.rampOverrides).length).toBeGreaterThan(0);
    const zero = (callTool(ws, "kit_from_reference", { path: GB, strength: 0 }).data as Out).kit;
    expect(resolveRamps(zero).skin).toEqual(resolveRamps(base).skin);
  });

  it("validates inputs and the reference_id hook", () => {
    expect(() => callTool(ws, "kit_from_reference", {})).toThrow(/exactly one/);
    expect(() => callTool(ws, "kit_from_reference", { path: GB, reference_id: "ref-1" })).toThrow(/exactly one/);
    expect(() => callTool(ws, "kit_from_reference", { reference_id: "ref-1" })).toThrow(/reference library/);
    expect(() => callTool(ws, "kit_from_reference", { path: "nope.png" })).toThrow(/Cannot read/);
    setReferenceLoader((_ws, id) => {
      expect(id).toBe("ref-1");
      const p = decodePng(readFileSync(GB));
      return p;
    });
    expect((callTool(ws, "kit_from_reference", { reference_id: "ref-1" }).data as Out).analysis.limited_palette).toBe(true);
  });
});

// Issue #24: one world scale for animals on every render path.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { animalGenerator } from "../core/generators/animal";
import { defaults } from "../core/generators/types";
import { KIT_PRESETS } from "../core/kit";
import { animalInfo } from "../core/rigs/fit";
import { CLIPS, RIGS } from "../core/rigs";
import { renderRecipe } from "../ui/rig/recipe";
import { callTool } from "./tools";
import { Workspace } from "./workspace";

let dir: string;
let ws: Workspace;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pb-fit-"));
  ws = new Workspace(join(dir, "ws"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const sig = (rows: { name: string; frames: { w: number; h: number; data: ArrayLike<number> }[] }[]) =>
  JSON.stringify(rows.map((r) => [r.name, r.frames.map((f) => [f.w, f.h, Array.from(f.data).join("")])]));

const CASES: { species: string; age: string; rig: string; family: "quadruped" | "bird" | "fish" }[] = [
  { species: "water-buffalo", age: "adult", rig: "quadruped-water-buffalo", family: "quadruped" },
  { species: "cow", age: "baby", rig: "quadruped-cow-baby", family: "quadruped" },
  { species: "chicken", age: "adult", rig: "bird-chicken", family: "bird" },
  { species: "chicken", age: "baby", rig: "bird-chicken-baby", family: "bird" },
  { species: "fish", age: "adult", rig: "fish-carp", family: "fish" },
  { species: "fish", age: "baby", rig: "fish-carp-baby", family: "fish" },
];

describe("animal world scale (#24)", () => {
  it("derives species and age from rig ids", () => {
    expect(animalInfo("quadruped-cow-baby")).toEqual({ family: "quadruped", species: "cow", baby: true });
    expect(animalInfo("quadruped-water-buffalo")).toEqual({ family: "quadruped", species: "water-buffalo", baby: false });
    expect(animalInfo("fish-carp")).toEqual({ family: "fish", species: "fish", baby: false });
    expect(animalInfo("fish-catfish-baby")).toMatchObject({ species: "catfish", baby: true });
    expect(animalInfo("human-male-young-adult")).toBeUndefined();
    // every registered animal rig resolves
    for (const r of RIGS.filter((x) => x.family !== "humanoid")) expect(animalInfo(r.rig.id), r.rig.id).toBeDefined();
  });

  for (const kit of KIT_PRESETS) {
    for (const c of CASES) {
      it(`${c.rig} renders identically from animal, generate_rigged and ui recipe in ${kit.id}`, () => {
        const expected = animalGenerator.generate({ ...defaults(animalGenerator), species: c.species, age: c.age } as never, kit, 1).rows;
        const clips = CLIPS.filter((x) => x.family === c.family).map((x) => x.clip.id);
        const ui = renderRecipe({ rig: c.rig, clips }, kit).rows;
        expect(sig(ui)).toBe(sig(expected));
        const g = callTool(ws, "generate_rigged", { rig: c.rig, clips, kit_id: kit.id, name: "a" }).data as any;
        const stored = ws.load().assets.find((a) => a.id === g.asset.id)!;
        expect(sig(stored.rows)).toBe(sig(expected));
      });
    }
  }

  it("keeps the buffalo bigger than the chicken and babies smaller than adults", () => {
    const kit = KIT_PRESETS[0];
    const h = (rig: string) => {
      const f = renderRecipe({ rig, clips: ["idle"] }, kit).rows[0].frames[0];
      const ys: number[] = [];
      for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if (f.data[y * f.w + x]) ys.push(y);
      return Math.max(...ys) - Math.min(...ys) + 1;
    };
    expect(h("quadruped-water-buffalo")).toBeGreaterThan(h("bird-chicken") * 2);
    expect(h("quadruped-cow-baby")).toBeLessThan(h("quadruped-cow"));
  });

  it("leaves humanoid rigs unscaled", () => {
    const kit = KIT_PRESETS[0];
    const humanoid = RIGS.find((r) => r.family === "humanoid")!.rig;
    const rows = renderRecipe({ rig: humanoid.id, clips: ["idle"] }, kit).rows;
    expect(rows[0].frames[0].w).toBe(kit.sizes.character);
  });
});

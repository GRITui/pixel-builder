import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generatorById } from "../core/generators";
import { DEFAULT_KIT } from "../core/kit";
import type { RefImage } from "../core/refstyle";
import { encodePng } from "./png";
import { deriveBodySlots, deriveBuilding, referenceCandidates, refineWithAi, type Scorer } from "./refgen";
import { characterConcept, houseConcept } from "./refgen.fixtures";
import { callToolAsync } from "./tools";
import { Workspace } from "./workspace";

const ref = (img: { width: number; height: number; rgba: Uint8Array }): RefImage => ({ w: img.width, h: img.height, data: img.rgba });
let dir: string;
let ws: Workspace;
const call = (n: string, i: unknown = {}) => callToolAsync(ws, n, i);
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "pb-refgen-"));
  ws = new Workspace(join(dir, "ws"));
  writeFileSync(join(dir, "hero.png"), encodePng(characterConcept()));
  writeFileSync(join(dir, "house.png"), encodePng(houseConcept()));
  await call("add_reference", { path: join(dir, "hero.png"), name: "hero" });
  await call("add_reference", { path: join(dir, "house.png"), name: "house" });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("offline mapping", () => {
  it("character: red shirt / blue pants", () => {
    const { slots } = deriveBodySlots(ref(characterConcept()), DEFAULT_KIT);
    expect(slots.top).toMatch(/cloth2|roof|accent/);
    expect(slots.bottom).toMatch(/cloth|ice|water|metal/);
    expect(slots.top).not.toBe(slots.bottom);
    expect(slots.skin).toMatch(/skin/);
  });
  it("building: red roof, two-storey two-tone -> half-brick", () => {
    const d = deriveBuilding(ref(houseConcept()), DEFAULT_KIT);
    expect(d.params.style).toBe("half-brick");
    expect(d.params.roof).toBe("roof");
    expect(d.params.floors).toBe(2);
  });
});

describe("candidates", () => {
  it("rank half-brick / stilt-house above keep / tower", () => {
    const g = generatorById("building")!;
    const { candidates } = referenceCandidates({ generator: g, kit: DEFAULT_KIT, reference: ref(houseConcept()), count: 12, seed: 5 });
    const rank = (s: string) => candidates.findIndex((c) => c.params.style === s);
    const good = Math.min(...["half-brick", "stilt-house"].map(rank).filter((r) => r >= 0));
    expect(good).toBeLessThan(3);
    for (const bad of ["keep", "tower"]) if (rank(bad) >= 0) expect(good).toBeLessThan(rank(bad));
    expect(candidates[0].score).toBeGreaterThanOrEqual(candidates[candidates.length - 1].score);
  });
  it("uses an injected scorer", () => {
    const g = generatorById("building")!;
    const scorer: Scorer = { name: "const", distance: () => 0 };
    const { candidates } = referenceCandidates({ generator: g, kit: DEFAULT_KIT, reference: ref(houseConcept()), count: 3, scorer, match: "style" });
    expect(candidates.every((c) => c.score === 100)).toBe(true);
  });
});

describe("tools", () => {
  it("generate_rigged picks slots from the reference and saves referenceId", async () => {
    const r = await call("generate_rigged", { rig: "humanoid-normal", reference_id: "hero", clips: ["idle"], name: "h" });
    const asset = ws.load().assets[0];
    expect((asset.source as any).rig.slots).toMatchObject({ top: expect.stringMatching(/cloth2|roof|accent/) });
    expect(asset.meta?.referenceId).toBe("hero");
    expect((r.data as any).notes[0]).toMatch(/slots/);
    await call("generate_rigged", { rig: "humanoid-normal", reference_id: "hero", clips: ["idle"], slots: { top: "leather" }, name: "h2" });
    expect((ws.load().assets[1].source as any).rig.slots.top).toBe("leather");
  });
  it("generate_asset: reference params, explicit override, meta", async () => {
    await call("generate_asset", { generator: "building", reference_id: "house", seed: 3, name: "a" });
    let a = ws.load().assets[0];
    expect(a.source).toMatchObject({ params: { style: "half-brick" } });
    expect(a.meta?.referenceId).toBe("house");
    await call("generate_asset", { generator: "building", reference_id: "house", params: { style: "tower", roof: "stone" }, seed: 3, name: "b" });
    a = ws.load().assets[1];
    expect(a.source).toMatchObject({ params: { style: "tower", roof: "stone" } });
  });
  it("generate_variations ranks with scores", async () => {
    const r = await call("generate_variations", { generator: "building", reference_id: "house", count: 6 });
    const v = (r.data as any).variations;
    expect(v).toHaveLength(6);
    expect(v[0].score).toBeGreaterThanOrEqual(v[5].score);
    expect(r.images).toHaveLength(1);
    await expect(call("generate_asset", { generator: "building", reference_id: "nope" })).rejects.toThrow(/nope/);
  });
});

describe("AI refinement loop", () => {
  const sprite = { w: 1, h: 1, data: [0] };
  it("refines once when the score is low and keeps the better candidate", async () => {
    let calls = 0;
    const r = await refineWithAi({ propose: async () => ({ value: calls++ === 0 ? "a" : "b", sprite }), score: () => (calls === 1 ? 40 : 60) });
    expect(calls).toBe(2);
    expect(r).toMatchObject({ best: "b", rounds: 2, score: 60 });
  });
  it("keeps the first when the refinement is worse, and skips refinement when good", async () => {
    let calls = 0;
    const r = await refineWithAi({ propose: async () => ({ value: calls++, sprite }), score: () => (calls === 1 ? 50 : 30) });
    expect(r).toMatchObject({ best: 0, rounds: 2 });
    calls = 0;
    const g = await refineWithAi({ propose: async () => ({ value: calls++, sprite }), score: () => 90 });
    expect(calls).toBe(1);
    expect(g.rounds).toBe(1);
  });
});

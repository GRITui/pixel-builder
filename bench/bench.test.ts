import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { KIT_PRESETS } from "../src/core/kit";
import { Workspace } from "../src/node/workspace";
import { kitsFor, loadBriefs, validateBrief } from "./lib";

const dir = mkdtempSync(join(tmpdir(), "pb-bench-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const briefs = loadBriefs();

describe("bench briefs", () => {
  it("loads about 30 briefs with unique ids and the required categories", () => {
    expect(briefs.length).toBeGreaterThanOrEqual(30);
    expect(new Set(briefs.map((b) => b.id)).size).toBe(briefs.length);
    const cats = new Set(briefs.map((b) => b.category));
    for (const c of ["character", "animal", "building", "environment", "autotile", "item", "ui", "map", "side-view"]) expect(cats.has(c), c).toBe(true);
    expect(briefs.some((b) => /Thai farmer with ngob hat, walk in 8 directions/.test(b.prompt))).toBe(true);
  });

  it("every recipe validates against the tool schemas, generators, rigs, clips and attachments", () => {
    const ws = new Workspace(join(dir, "ws"));
    const problems = briefs.flatMap((b) => validateBrief(b, ws));
    expect(problems).toEqual([]);
  });

  it("only uses kits that exist", () => {
    const ids = new Set(KIT_PRESETS.map((k) => k.id));
    for (const b of briefs) for (const k of kitsFor(b)) expect(ids.has(k), `${b.id} ${k}`).toBe(true);
  });

  it("rejects a bad recipe", () => {
    const ws = new Workspace(join(dir, "ws2"));
    const bad = { id: "x", category: "c", prompt: "p", recipe: [{ tool: "generate_asset" as const, input: { generator: "environment", params: { kind: "nope" } } }] };
    expect(validateBrief(bad, ws).join()).toMatch(/not in/);
  });
});

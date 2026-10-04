import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callToolAsync, callTool } from "./tools";
import { Workspace } from "./workspace";

let dir: string;
let ws: Workspace;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pb-region-"));
  ws = new Workspace(join(dir, "ws"));
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const run = async (name: string, input: unknown = {}): Promise<any> => (await callToolAsync(ws, name, input)).data;
const frameRows = async (id: string, row = "idle", f = 0): Promise<string[]> =>
  ((await run("get_asset", { id, include_pixels: true })).pixels as { row: string; frames: string[][] }[]).find((r) => r.row === row)!.frames[f];

async function gem() {
  const a = (await run("paint_asset", { name: "Block", category: "object", width: 16, height: 16, frames: [new Array(16).fill(".")
    .map((_, y) => (y >= 5 && y < 11 ? "......tttttt...." : "................"))], outline: true })).asset;
  return a.id as string;
}

describe("edit_region (agent-supplied rows)", () => {
  it("changes only the selected rect and re-exports", async () => {
    const id = await gem();
    const before = await frameRows(id);
    const r = await run("edit_region", { id, rect: { x: 6, y: 5, w: 3, h: 2 }, rows: ["jjj", "jjj"] });
    const after = await frameRows(id);
    expect(r.region).toEqual({ x: 6, y: 5, w: 3, h: 2 });
    expect(r.changed_pixels[0]).toBeGreaterThan(0);
    expect(after[5].slice(6, 9)).toBe("jjj");
    expect(after[12]).toBe(before[12]); // far from the edit: untouched
    expect(after[0]).toBe(before[0]);
    expect(readFileSync(r.asset.files[0]).subarray(1, 4).toString()).toBe("PNG");
  });

  it("validates the selection, rows and mode", async () => {
    const id = await gem();
    await expect(run("edit_region", { id, rows: ["aa"] })).rejects.toThrow(/exactly one selection/);
    await expect(run("edit_region", { id, rect: { x: 0, y: 0, w: 2, h: 1 } })).rejects.toThrow(/exactly one of `rows`/);
    await expect(run("edit_region", { id, rect: { x: 0, y: 0, w: 2, h: 1 }, rows: ['a"'] })).rejects.toThrow(/not a legend char/);
    await expect(run("edit_region", { id, rect: { x: 0, y: 0, w: 2, h: 2 }, rows: ["aa"] })).rejects.toThrow(/expected 2 rows/);
    await expect(run("edit_region", { id, rect: { x: 90, y: 0, w: 2, h: 1 }, rows: ["aa"] })).rejects.toThrow(/outside/);
  });

  it("prompt mode errors with guidance when there is no API key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const id = await gem();
    await expect(run("edit_region", { id, rect: { x: 0, y: 0, w: 2, h: 2 }, prompt: "a scarf" })).rejects.toThrow(/ANTHROPIC_API_KEY.*supply `rows`/);
  });

  it("applies the same rows to every frame of an animation row", async () => {
    const hero = (await run("generate_asset", { generator: "character", seed: 2, name: "Hero" })).asset;
    const rows = ["jj", "jj"];
    const r = await run("edit_region", { id: hero.id, row: "walk-down", cells: [[0, 0], [1, 0], [0, 1], [1, 1]], rows, all_frames: true, outline: false });
    expect(Object.keys(r.changed_pixels).length).toBeGreaterThan(1);
    for (let f = 0; f < 2; f++) expect((await frameRows(hero.id, "walk-down", f))[0].slice(0, 2)).toBe("jj");
  });

  it("is async-only through callTool and refuses maps", async () => {
    const id = await gem();
    expect(() => callTool(ws, "edit_region", { id, rect: { x: 0, y: 0, w: 1, h: 1 }, rows: ["."] })).toThrow(/callToolAsync/);
    const m = (await run("generate_asset", { generator: "map", seed: 1, name: "M" })).asset;
    await expect(run("edit_region", { id: m.id, rect: { x: 0, y: 0, w: 1, h: 1 }, rows: ["."] })).rejects.toThrow(/is a map/);
  });
});

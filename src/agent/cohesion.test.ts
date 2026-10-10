import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodePng } from "../io/png";
import { gradient } from "../pixel/fixtures";
import { callTool, siblingPalettes } from "./tools";

const tmp = () => mkdtempSync(join(tmpdir(), "pb-cohesion-"));

/** The same scene-ish gradient in two very different colour casts: independent k-means runs. */
function twoImages(out: string): [string, string] {
  const a = join(out, "a.png"), b = join(out, "b.png");
  writeFileSync(a, encodePng(gradient(160, 100)));
  const g = gradient(120, 120);
  for (let i = 0; i < g.w * g.h; i++) {
    g.data[i * 4] = 40;
    g.data[i * 4 + 2] = 40;
  }
  writeFileSync(b, encodePng(g));
  return [a, b];
}

describe("pixelize reports palette_budget", () => {
  it("first asset is solo with no hint; a second, unrelated asset is flagged drifting", async () => {
    const out = tmp(), ctx = { outDir: out };
    const [a, b] = twoImages(out);
    // sources live in out_dir; write results to a subdir so only *results* are siblings
    const res = join(out, "pixel-out");
    const first: any = (await callTool(ctx, "pixelize", { image: a, era: 16, size: 48, out_dir: res })).data;
    expect(first.palette_budget.cohesion).toBe("solo");
    expect(first.palette_budget.hint).toBe("");
    expect(first.palette_budget.within_limit).toBe(true);

    const second: any = (await callTool(ctx, "pixelize", { image: b, era: 16, size: 48, out_dir: res })).data;
    expect(second.palette_budget.cohesion).toBe("drifting");
    expect(second.palette_budget.hint).toMatch(/looks action=save/);
    // the guard is not decorative: the two palettes really do barely overlap
    expect(second.palette_budget.overlap).toBeLessThan(0.3);
  });

  it("a look-locked asset is tight against its sibling, not drifting", async () => {
    const out = tmp(), ctx = { outDir: out };
    const [a, b] = twoImages(out);
    const first: any = (await callTool(ctx, "pixelize", { image: a, era: 16, size: 48 })).data;
    await callTool(ctx, "looks", { action: "save", name: "My Game", from: first.files.meta });
    const locked: any = (await callTool(ctx, "pixelize", { image: b, era: 16, size: 48, look: "My Game" })).data;
    // a look forces its own palette, so every colour is already in the project palette
    expect(locked.palette_budget.overlap).toBe(1);
    expect(locked.palette_budget.cohesion).not.toBe("drifting");
    expect(locked.palette_budget.hint).not.toMatch(/looks action=save/);
  });

  it("writes palette_budget into the meta json", async () => {
    const out = tmp(), ctx = { outDir: out };
    const [a] = twoImages(out);
    const res = join(out, "pixel-out");
    const r: any = (await callTool(ctx, "pixelize", { image: a, era: 8, size: 32, out_dir: res })).data;
    const meta = JSON.parse(readFileSync(r.files.meta, "utf8"));
    expect(meta.palette_budget.colours).toBe(meta.palette.length);
    expect(meta.palette_budget.limit).toBe(24);
  });

  it("siblingPalettes ignores look-locked results, foreign json and the meta being written", () => {
    const dir = tmp();
    // `mine.json` is the meta currently being written, so it must be excluded, not counted
    writeFileSync(join(dir, "mine.json"), JSON.stringify({ palette: ["#999999"] }));
    writeFileSync(join(dir, "other.json"), JSON.stringify({ palette: ["#111111"] }));
    writeFileSync(join(dir, "locked.json"), JSON.stringify({ palette: ["#222222"], look: "x" }));
    writeFileSync(join(dir, "notes.json"), JSON.stringify({ hello: "world" }));
    writeFileSync(join(dir, "broken.json"), "{ not json");
    expect(siblingPalettes(dir, join(dir, "mine.json"))).toEqual([["#111111"]]);
  });
});
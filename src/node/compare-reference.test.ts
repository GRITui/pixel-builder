import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodePng } from "./png";
import { callToolAsync } from "./tools";
import { Workspace } from "./workspace";

let dir: string;
let ws: Workspace;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pb-cmp-"));
  ws = new Workspace(join(dir, "ws"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

type Cmp = { score: number; components: Record<string, number>; notes: string[]; reference_id: string };

async function setup(kit = "kit-default") {
  const ref = (await callToolAsync(ws, "add_reference", { path: "test/fixtures/refs/mmo-crop.png", name: "mmo" })).data as { reference: { id: string } };
  await callToolAsync(ws, "generate_asset", { generator: "environment", params: { kind: "oak" }, name: "tree", seed: 1, kit_id: kit });
  return ref.reference.id;
}

describe("compare_to_reference", () => {
  it("scores an asset against a stored reference, returns a side-by-side image and stores the match", async () => {
    const refId = await setup();
    const r = await callToolAsync(ws, "compare_to_reference", { asset_id: "tree", reference_id: refId });
    const d = r.data as Cmp;
    expect(d.score).toBeGreaterThan(0);
    expect(d.score).toBeLessThan(100);
    expect(Object.keys(d.components).sort()).toEqual(["detail", "light", "outline", "palette", "shades", "silhouette"]);
    expect(d.notes.length).toBeGreaterThan(0);
    const img = decodePng(r.images![0].png);
    expect(img.width).toBeGreaterThan(img.height);
    const a = ws.load().assets.find((x) => x.name === "tree")!;
    expect(a.meta?.referenceId).toBe(refId);
    expect(a.meta?.matchScore).toBe(d.score);
  });

  it("is deterministic and rejects bad rows or frames", async () => {
    const refId = await setup();
    const a = (await callToolAsync(ws, "compare_to_reference", { asset_id: "tree", reference_id: "mmo" })).data as Cmp;
    const b = (await callToolAsync(ws, "compare_to_reference", { asset_id: "tree", reference_id: refId })).data as Cmp;
    expect(a.score).toBe(b.score);
    await expect(callToolAsync(ws, "compare_to_reference", { asset_id: "tree", reference_id: refId, row: "nope" })).rejects.toThrow(/no row/);
    await expect(callToolAsync(ws, "compare_to_reference", { asset_id: "tree", reference_id: refId, frame: 9 })).rejects.toThrow(/frame 9/);
  });

  it("scores a reference that was rendered from the same kit higher than a mismatched kit", async () => {
    const refId = await setup();
    const kit = (await callToolAsync(ws, "kit_from_reference", { reference_id: refId, name: "from-mmo" })).data as { kit: { id: string } };
    await callToolAsync(ws, "generate_asset", { generator: "environment", params: { kind: "oak" }, name: "tree2", seed: 1, kit_id: kit.kit.id });
    const plain = (await callToolAsync(ws, "compare_to_reference", { asset_id: "tree", reference_id: refId })).data as Cmp;
    const tuned = (await callToolAsync(ws, "compare_to_reference", { asset_id: "tree2", reference_id: refId })).data as Cmp;
    expect(tuned.components.palette).toBeGreaterThan(plain.components.palette);
  });
});

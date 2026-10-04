// Acceptance tests for edit_region (issue #18). Two modes are covered:
//   - agent-supplied `rows` (no model, no API key): the mask must be respected,
//     only legend chars may survive, and every pixel outside the region must
//     come back byte-identical to what was there before.
//   - `prompt` mode: the model call is mocked at fetch, so the whole merge /
//     finalize / re-outline path runs without a network or a key.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildLegend } from "../core/legend";
import { PALETTE_SIZE } from "../core/palette";
import { callToolAsync } from "./tools";
import { Workspace } from "./workspace";

let dir: string;
let ws: Workspace;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pb-inpaint-"));
  ws = new Workspace(join(dir, "ws"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

const call = (name: string, input: unknown) => callToolAsync(ws, name, input);
const data = async (name: string, input: unknown): Promise<any> => (await call(name, input)).data;

const framesOf = (id: string) => ws.load().assets.find((a) => a.id === id)!.rows[0].frames;

describe("edit_region: agent-supplied rows (no API key)", () => {
  it("changes only the masked cells and leaves the rest byte-identical", async () => {
    const a = (await data("generate_asset", { generator: "object", params: { kind: "chest" }, seed: 7, name: "box" })).asset;
    const before = framesOf(a.id)[0].data.slice();
    const rect = { x: 2, y: 2, w: 3, h: 3 };

    // Use a material well away from the ink/outline ramp ('a'-'f'), because the
    // outline pass legitimately repaints pixels on the region's silhouette.
    // ' ' is NOT in the legend, so it must land as transparent.
    const FILL = "g";
    const d = await data("edit_region", { id: a.id, rect, rows: [`${FILL}${FILL}${FILL}`, `${FILL} ${FILL}`, `${FILL}${FILL}${FILL}`] });

    expect(d.via).toBe("baked");
    expect(d.region).toEqual({ x: 2, y: 2, w: 3, h: 3 });
    const after = framesOf(a.id)[0].data;
    const w = framesOf(a.id)[0].w;
    const h = framesOf(a.id)[0].h;

    const legend = buildLegend(ws.load().kits[0]);
    const fill = legend.byChar.get(FILL)!;
    expect(fill).toBeGreaterThan(6); // not ink, so no outline rewriting
    expect(legend.byChar.has(" ")).toBe(false);

    // 1. the fill reached the region and no off-palette value was written. The
    //    off-legend char becomes transparent, then `finalize` cleans it up and
    //    inks the changed block — so the cell we gave ' ' is either still
    //    transparent or has been replaced by an outline ink level, never by a
    //    bogus index and never by the fill.
    const cx = rect.x + 1;
    const cy = rect.y + 1;
    const centre = after[cy * w + cx];
    const inkLevels = new Set(["a", "b", "c", "d", "e", "f"].map((c) => legend.byChar.get(c)!));
    expect(centre === 0 || inkLevels.has(centre), `off-legend cell became ${centre}, expected transparent or outline ink`).toBe(true);
    // the fill the agent asked for is present in the region
    expect([...after.slice(2 * w + 2, 2 * w + 5), ...after.slice(3 * w + 2, 3 * w + 5), ...after.slice(4 * w + 2, 4 * w + 5)]).toContain(fill);
    // and the tool told the agent about the dropped char
    expect(d.notes.join(" ")).toMatch(/not in the legend/);
    for (const v of after) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(PALETTE_SIZE);
    }

    // 2. every UNMASKED cell is byte-identical to the original (the hard guarantee)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const inside = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
        if (!inside) expect(after[y * w + x], `pixel ${x},${y} outside the region changed`).toBe(before[y * w + x]);
      }
  });

  it("only ever writes valid palette indices", async () => {
    const a = (await data("generate_asset", { generator: "object", params: { kind: "chest" }, seed: 3, name: "box" })).asset;
    await data("edit_region", { id: a.id, rect: { x: 1, y: 1, w: 4, h: 4 }, rows: ["QQQQ", "QaZQ", "QZZQ", "QQQQ"] });
    for (const v of framesOf(a.id)[0].data) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(PALETTE_SIZE);
    }
  });

  it("accepts a lasso mask grid as well as a rect", async () => {
    const a = (await data("generate_asset", { generator: "object", params: { kind: "chest" }, seed: 11, name: "box" })).asset;
    const { w, h } = framesOf(a.id)[0];
    const mask = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => x >= 2 && x <= 4 && y >= 2 && y <= 3));
    const d = await data("edit_region", { id: a.id, mask, rows: ["aaa", "aaa"] });
    expect(d.region).toMatchObject({ w: 3, h: 2 });
    expect(d.via).toBe("baked");
  });

  it("all_frames edits every frame of the row", async () => {
    const a = (await data("generate_asset", { generator: "object", params: { kind: "coin" }, seed: 5, name: "coin" })).asset;
    const n = framesOf(a.id).length;
    expect(n).toBeGreaterThan(1);
    const before = framesOf(a.id).map((f) => f.data.slice());
    const d = await data("edit_region", { id: a.id, rect: { x: 0, y: 0, w: 4, h: 4 }, rows: ["aaaa", "aaaa", "aaaa", "aaaa"], all_frames: true });
    expect(d.frames_edited).toBe(n);
    const after = framesOf(a.id);
    // frame 1 changed...
    expect(after[0].data).not.toEqual(before[0]);
    // ...and the cells outside the rect on frame 2 are still untouched
    const w = after[0].w;
    for (let y = 0; y < after[1].h; y++)
      for (let x = 4; x < after[1].w; x++) expect(after[1].data[y * w + x]).toBe(before[1][y * w + x]);
  });

  it("rejects a region that covers no pixels, a missing region, and a missing source", async () => {
    const a = (await data("generate_asset", { generator: "object", params: { kind: "chest" }, seed: 2, name: "box" })).asset;
    await expect(call("edit_region", { id: a.id, rect: { x: 500, y: 500, w: 4, h: 4 }, rows: ["aaaa"] })).rejects.toThrow(/covers none/);
    await expect(call("edit_region", { id: a.id, rows: ["aaaa"] })).rejects.toThrow(/rect .* or mask/);
    await expect(call("edit_region", { id: a.id, rect: { x: 0, y: 0, w: 2, h: 2 } })).rejects.toThrow(/prompt .* or rows/);
  });

  it("refuses maps (they are tile grids, not sprites)", async () => {
    const m = (await data("generate_asset", { generator: "map", seed: 4, name: "map" })).asset;
    await expect(call("edit_region", { id: m.id, rect: { x: 0, y: 0, w: 2, h: 2 }, rows: ["aa"] })).rejects.toThrow(/map/);
  });
});

describe("edit_region: prompt mode (mocked model)", () => {
  /** Stub the API server the tool talks to, returning a fixed rows payload. */
  function mockModel(rows: string[]) {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ sprite: { w: 8, h: 8, data: [] }, rows }), { status: 200, headers: { "content-type": "application/json" } })));
  }

  it("asks the server for the region and merges only the masked cells", async () => {
    const a = (await data("generate_asset", { generator: "object", params: { kind: "chest" }, seed: 9, name: "box" })).asset;
    const before = framesOf(a.id)[0].data.slice();
    const w = framesOf(a.id)[0].w;
    const h = framesOf(a.id)[0].h;
    mockModel(["aaaa", "aaaa", "aaaa"]);
    const rect = { x: 1, y: 1, w: 3, h: 3 };

    const d = await data("edit_region", { id: a.id, rect, prompt: "add a red scarf" });

    expect(d.via).toBe("baked");
    expect(d.region).toEqual(rect);
    // the model was called once, with the prompt
    const call0 = (fetch as any).mock.calls[0];
    expect(String(call0[0])).toMatch(/api\/inpaint$/);
    expect(JSON.parse(call0[1].body).prompt).toBe("add a red scarf");

    const legend = buildLegend(ws.load().kits[0]);
    const after = framesOf(a.id)[0].data;
    const aa = legend.byChar.get("a")!;
    for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) expect(after[y * w + x]).toBe(aa);
    // outside the region: byte-identical, which is the hard guarantee
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!(x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h))
        expect(after[y * w + x]).toBe(before[y * w + x]);
    }
  });

  it("surfaces the server's error verbatim", async () => {
    const a = (await data("generate_asset", { generator: "object", params: { kind: "chest" }, seed: 12, name: "box" })).asset;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "AI is disabled: ANTHROPIC_API_KEY is not set on the server." }), { status: 503, headers: { "content-type": "application/json" } })));
    await expect(call("edit_region", { id: a.id, rect: { x: 0, y: 0, w: 3, h: 3 }, prompt: "make it red" })).rejects.toThrow(/ANTHROPIC_API_KEY is not set/);
  });

  it("points at agent-supplied rows when the server is unreachable", async () => {
    const a = (await data("generate_asset", { generator: "object", params: { kind: "chest" }, seed: 13, name: "box" })).asset;
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }));
    await expect(call("edit_region", { id: a.id, rect: { x: 0, y: 0, w: 3, h: 3 }, prompt: "make it red" })).rejects.toThrow(/Give rows instead/);
  });
});

describe("edit_region: rigged assets use the rig attachment path", () => {
  it("applies the edit through the rig so every clip and direction follows", async () => {
    const a = (await data("generate_rigged", { rig: "example-biped", name: "hero" })).asset;
    const rowsBefore = ws.load().assets.find((x) => x.id === a.id)!.rows.length;
    const d = await data("edit_region", { id: a.id, rect: { x: 6, y: 4, w: 4, h: 4 }, rows: ["aaaa", "aaaa", "aaaa", "aaaa"] });
    expect(d.via).toBe("rig-attachment");
    expect(d.attachment).toBe("ai-region-edit");
    // the recipe now carries the attachment, and every row was re-rendered
    const recipe = ws.load().assets.find((x) => x.id === a.id)!.source.rig!;
    expect(recipe.attachments?.map((x: any) => (typeof x === "string" ? x : x.id))).toContain("ai-region-edit");
    expect(ws.load().assets.find((x) => x.id === a.id)!.rows.length).toBe(rowsBefore);
  });
});
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeAseprite, zlibStored } from "../core/aseprite";
import { resolveRamps } from "../core/kit";
import { flattenPalette, hexToRgb } from "../core/palette";
import { composeAseFrame, readAseprite } from "./aseprite";
import { callTool } from "./tools";
import { Workspace, findAsset, getKit } from "./workspace";

let dir: string;
let ws: Workspace;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pb-ase-"));
  ws = new Workspace(join(dir, "ws"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const data = (name: string, input: unknown = {}): any => callTool(ws, name, input).data;

function check(id: string, minLayers: number) {
  const f = data("export_asset", { id, format: "aseprite" }).files[0];
  expect(f.path).toMatch(/\.aseprite$/);
  const bytes = readFileSync(f.path);
  const project = ws.load();
  const asset = findAsset(project, id);
  const kit = getKit(project, asset.kitId);
  const ase = readAseprite(bytes);
  expect(ase.fileSize).toBe(bytes.length);
  expect(ase.depth).toBe(8);
  expect(bytes.readUInt16LE(4)).toBe(0xa5e0);
  const all = asset.rows.flatMap((r) => r.frames);
  expect(ase.frames).toHaveLength(all.length);
  expect(ase.width).toBe(Math.max(...all.map((s) => s.w)));
  expect(ase.height).toBe(Math.max(...all.map((s) => s.h)));
  expect(ase.layers.length).toBeGreaterThanOrEqual(minLayers);
  // palette locked to the kit
  const flat = flattenPalette(resolveRamps(kit));
  expect(ase.palette).toHaveLength(flat.length);
  flat.forEach((hex, i) => expect(ase.palette[i]).toEqual(hex ? [...hexToRgb(hex), 255] : [0, 0, 0, 0]));
  // pixels
  all.forEach((s, n) => {
    const img = composeAseFrame(ase, n);
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) expect(img[y * ase.width + x]).toBe(s.data[y * s.w + x]);
  });
  // tags: one per row, consecutive
  let from = 0;
  expect(ase.tags).toEqual(
    asset.rows.map((r) => {
      const t = { name: r.name, from, to: from + r.frames.length - 1 };
      from = t.to + 1;
      return t;
    }),
  );
  const dur = Math.round(1000 / (asset.fps || 6));
  ase.frames.forEach((fr) => expect(fr.duration).toBe(dur));
  return { ase, asset };
}

describe("aseprite export", () => {
  it("procedural asset: per-material layers, round trip", () => {
    const id = data("generate_asset", { generator: "building", seed: 3, name: "barn" }).asset.id;
    const { ase } = check(id, 2);
    expect(ase.layers.map((l) => l.name)).toContain("outline");
  });
  it("animated tile", () => {
    const id = data("generate_asset", { generator: "environment", params: { kind: "paddy-tile" }, name: "paddy" }).asset.id;
    const { ase } = check(id, 1);
    expect(ase.frames.length).toBeGreaterThan(1);
  });
  it("rigged asset: layers per part, tags per row", () => {
    const id = data("generate_rigged", { rig: "humanoid-normal", attachments: ["straw-hat", "hoe"], clips: ["idle", "walk"], name: "farmer" }).asset.id;
    const { ase } = check(id, 3);
    expect(ase.layers.map((l) => l.name)).toEqual(expect.arrayContaining(["core", "straw-hat", "hoe"]));
    expect(ase.tags.map((t) => t.name)).toContain("walk-down");
  });
  it("attach refreshes an existing .aseprite with the new part layer", () => {
    const f = data("generate_rigged", { rig: "humanoid-normal", attachments: ["straw-hat"], clips: ["idle"], name: "farmer" }).asset;
    const p = data("export_asset", { id: f.id, format: "aseprite" }).files[0].path;
    expect(readAseprite(readFileSync(p)).layers.map((l) => l.name)).not.toContain("hoe");
    data("attach", { id: f.id, add: ["hoe"] });
    expect(readAseprite(readFileSync(p)).layers.map((l) => l.name)).toContain("hoe");
  });
});

describe("pure writer", () => {
  it("stored zlib inflates back", () => {
    const d = Uint8Array.from({ length: 70000 }, (_, i) => (i * 7) & 255);
    expect(new Uint8Array(inflateSync(zlibStored(d)))).toEqual(d);
    expect(inflateSync(zlibStored(new Uint8Array(0))).length).toBe(0);
  });
  it("writes a valid file without node zlib", () => {
    const bytes = writeAseprite({ rows: [{ name: "idle", frames: [{ w: 2, h: 2, data: [0, 1, 2, 0] }] }], palette: [null, "#ff0000", "#00ff00"] });
    const a = readAseprite(bytes);
    expect(composeAseFrame(a, 0)).toEqual(Uint8Array.from([0, 1, 2, 0]));
    expect(a.palette[2]).toEqual([0, 255, 0, 255]);
  });
});

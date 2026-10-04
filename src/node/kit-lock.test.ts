import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callTool } from "./tools";
import { Workspace } from "./workspace";

let dir: string;
let ws: Workspace;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pb-lock-"));
  ws = new Workspace(dir);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("kit lock and version", () => {
  it("locked kits refuse update_kit; fork via create_kit is editable", () => {
    const made = callTool(ws, "create_kit", { name: "House", changes: { locked: true, vibe: "house" } }).data as { kit: { id: string; locked?: boolean } };
    expect(made.kit.locked).toBe(true);
    expect(() => callTool(ws, "update_kit", { kit_id: made.kit.id, changes: { vibe: "x" } })).toThrow(/locked.*create_kit/);
    const fork = callTool(ws, "create_kit", { name: "Mine", base_kit_id: made.kit.id }).data as { kit: { id: string; locked?: boolean; version?: number } };
    expect(fork.kit.locked).toBeUndefined();
    expect(() => callTool(ws, "update_kit", { kit_id: fork.kit.id, changes: { vibe: "x" } })).not.toThrow();
  });

  it("update_kit bumps version; assets record kitVersion; stale_only targets old ones", () => {
    const kit = (callTool(ws, "create_kit", { name: "K" }).data as { kit: { id: string } }).kit.id;
    callTool(ws, "generate_asset", { generator: "environment", params: { kind: "oak" }, name: "A", kit_id: kit });
    expect(ws.load().assets[0].kitVersion).toBe(1);
    expect(callTool(ws, "rerender_assets", { stale_only: true }).data).toMatchObject({ rerendered: 0 });
    callTool(ws, "update_kit", { kit_id: kit, changes: { outline: "none" } });
    expect(ws.load().kits.find((k) => k.id === kit)?.version).toBe(2);
    callTool(ws, "generate_asset", { generator: "environment", params: { kind: "oak" }, name: "B", kit_id: kit });
    const r = callTool(ws, "rerender_assets", { stale_only: true }).data as { rerendered: number; assets: { name: string }[] };
    expect(r.rerendered).toBe(1);
    expect(r.assets[0].name).toBe("A");
    expect(ws.load().assets.every((a) => a.kitVersion === 2)).toBe(true);
  });
});

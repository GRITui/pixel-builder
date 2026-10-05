import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { callTool } from "./tools";
import { Workspace } from "./workspace";

let dir: string;
let ws: Workspace;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pb-iso-"));
  ws = new Workspace(join(dir, "ws"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("iso-starter pack", () => {
  it("builds the hero (iso rows), tiles, props, house and an isometric Tiled map under kit-iso", () => {
    callTool(ws, "set_active_kit", { kit_id: "kit-iso" });
    callTool(ws, "generate_pack", { pack: "iso-starter" });
    expect(ws.load().assets.length).toBeGreaterThan(15);
    const assets = ws.load().assets;
    const hero = assets.find((a) => a.name === "hero-iso")!;
    expect(hero.rows.map((r) => r.name)).toEqual(expect.arrayContaining(["walk-se", "walk-sw", "walk-ne", "walk-nw", "idle-se"]));
    expect(assets.map((a) => a.name)).toEqual(expect.arrayContaining(["iso-tile-grass", "iso-block-stone", "iso-tree", "iso-fence-se", "iso-house", "iso-map"]));
    const tiled = join(dir, "ws", "maps", "iso-map.tiled.json");
    expect(existsSync(tiled)).toBe(true);
    expect(JSON.parse(readFileSync(tiled, "utf8")).orientation).toBe("isometric");
  }, 60000);
});

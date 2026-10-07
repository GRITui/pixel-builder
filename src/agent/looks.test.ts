import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodePng, decodePng } from "../io/png";
import { gradient } from "../pixel/fixtures";
import { callTool } from "./tools";

const tmp = () => mkdtempSync(join(tmpdir(), "pb-looks-"));

describe("looks tool", () => {
  it("saves a look from a pixelize result, lists it, locks the palette across images, deletes it", async () => {
    const out = tmp(), ctx = { outDir: out };
    const a = join(out, "a.png"), b = join(out, "b.png");
    writeFileSync(a, encodePng(gradient(160, 100)));
    const g2 = gradient(120, 120);
    for (let i = 0; i < g2.w * g2.h; i++) g2.data[i * 4 + 2] = 40;
    writeFileSync(b, encodePng(g2));

    const first: any = (await callTool(ctx, "pixelize", { image: a, era: 16, size: 48, preset: "neon", bloom: "low" })).data;
    const saved: any = (await callTool(ctx, "looks", { action: "save", name: "My Game", from: first.files.meta })).data;
    expect(saved.id).toBe("my-game");
    const listed: any = (await callTool(ctx, "looks", { action: "list" })).data;
    expect(listed.looks.map((l: any) => l.id)).toEqual(["my-game"]);

    const second: any = (await callTool(ctx, "pixelize", { image: b, era: 8, size: 40, look: "My Game" })).data;
    expect(second.meta.era).toBe(16);
    expect(second.meta.preset).toBe("neon");
    const allowed = new Set(JSON.parse(readFileSync(first.files.meta, "utf8")).palette);
    const img = decodePng(readFileSync(second.files.native));
    for (let i = 0; i < img.w * img.h; i++) expect(allowed.has("#" + [0, 1, 2].map((k) => img.data[i * 4 + k].toString(16).padStart(2, "0")).join(""))).toBe(true);

    await callTool(ctx, "looks", { action: "delete", name: "my-game" });
    expect(((await callTool(ctx, "looks", { action: "list" })).data as any).looks).toEqual([]);
    await expect(callTool(ctx, "pixelize", { image: a, look: "my-game" })).rejects.toThrow(/No look/);
  });

  it("honours PIXEL_LOOKS_DIR", async () => {
    const out = tmp(), dir = tmp();
    process.env.PIXEL_LOOKS_DIR = dir;
    try {
      const r: any = (await callTool({ outDir: out }, "looks", { action: "list" })).data;
      expect(r.dir).toBe(dir);
    } finally { delete process.env.PIXEL_LOOKS_DIR; }
  });
});

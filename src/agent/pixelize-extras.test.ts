import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { encodePng, decodePng } from "../io/png";
import { gradient } from "../pixel/fixtures";
import { callTool } from "./tools";

const tmp = () => mkdtempSync(join(tmpdir(), "pbfx-"));
const ENV = ["IMAGE_BASE_URL", "IMAGE_API_KEY", "IMAGE_MODEL", "IMAGE_API_STYLE"] as const;
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
});

describe("pixelize effects", () => {
  it("writes GIF, spritesheet and frames JSON alongside the still", async () => {
    const dir = tmp(), src = join(dir, "g.png");
    writeFileSync(src, encodePng(gradient(90, 60)));
    const r = await callTool({ outDir: dir }, "pixelize", { image: src, era: 8, size: 45, effects: "rain,flicker", frames: "6", fps: 8 });
    const files = r.data.files as Record<string, string>;
    for (const f of ["native", "preview", "meta", "gif", "sheet", "frames"]) expect(existsSync(files[f])).toBe(true);
    expect(readFileSync(files.gif).subarray(0, 6).toString("latin1")).toBe("GIF89a");
    const sheet = decodePng(readFileSync(files.sheet));
    expect([sheet.w, sheet.h]).toEqual([45 * 6, 30]);
    const fj = JSON.parse(readFileSync(files.frames, "utf8"));
    expect(fj).toMatchObject({ fps: 8, loop: true, columns: 6, effects: ["rain", "flicker"] });
    expect(r.data.effects).toMatchObject({ list: ["rain", "flicker"], frames: 6, fps: 8 });
  });

  it("rejects unknown effects and missing / double sources", async () => {
    await expect(callTool({ outDir: tmp() }, "pixelize", { image: "x.png", effects: ["fogg"] })).rejects.toThrow(/effects/);
    await expect(callTool({ outDir: tmp() }, "pixelize", {})).rejects.toThrow(/exactly one of image/);
    await expect(callTool({ outDir: tmp() }, "pixelize", { image: "x.png", prompt: "y" })).rejects.toThrow(/exactly one of image/);
  });
});

describe("pixelize prompt path", () => {
  it("generates the source image, then pixelizes it", async () => {
    process.env.IMAGE_BASE_URL = "http://127.0.0.1:9/v1";
    delete process.env.IMAGE_API_KEY;
    process.env.IMAGE_MODEL = "test-model";
    delete process.env.IMAGE_API_STYLE;
    const sent: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ data: [{ b64_json: encodePng(gradient(64, 48)).toString("base64") }] }), { status: 200 });
    }));
    const dir = tmp();
    const r = await callTool({ outDir: dir }, "pixelize", { prompt: "A Quiet Harbour", mode: "scene", era: 8, size: 32 });
    expect(sent[0].url).toBe("http://127.0.0.1:9/v1/images/generations");
    expect(sent[0].body).toMatchObject({ model: "test-model", prompt: "realistic photograph of A Quiet Harbour, natural light, detailed" });
    const files = r.data.files as Record<string, string>;
    expect(files.native).toMatch(/a-quiet-harbour-scene-8bit\.png$/);
    expect(existsSync(files.source)).toBe(true);
    expect(r.data.width).toBe(32);
  });

  it("reports provider errors without the key", async () => {
    process.env.IMAGE_BASE_URL = "https://img.example/v1";
    process.env.IMAGE_API_KEY = "sk-live-VERYSECRET123456";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "bad key sk-live-VERYSECRET123456" } }), { status: 401 })));
    const err = await callTool({ outDir: tmp() }, "pixelize", { prompt: "x" }).catch((e) => e);
    expect(err.message).toMatch(/Image generation failed: .*IMAGE_API_KEY/);
    expect(err.message).not.toContain("VERYSECRET");
  });
});

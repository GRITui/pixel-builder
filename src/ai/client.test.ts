import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_KIT } from "../core/kit";
import { colorIndex } from "../core/palette";
import { generatorFor } from "../core/generators";
import { aiPixels, aiStatus, vibeKit, vibeParams } from "./client";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const mockFetch = (fn: (url: string, init?: RequestInit) => Response | Promise<Response>) => vi.stubGlobal("fetch", vi.fn(fn));

afterEach(() => vi.unstubAllGlobals());

describe("reference inputs", () => {
  it("passes images, reference ids and analysis through to the kit endpoint", async () => {
    let sent: Record<string, unknown> = {};
    mockFetch((_u, init) => {
      sent = JSON.parse(String(init?.body));
      return json({ kit: {}, notes: "" });
    });
    await vibeKit({ prompt: "x", kit: DEFAULT_KIT, images: ["data:image/png;base64,AAAA"], referenceIds: ["r1"], project: "p", analysis: { a: 1 } });
    expect(sent).toMatchObject({ images: ["data:image/png;base64,AAAA"], reference_ids: ["r1"], project: "p", analysis: { a: 1 } });
    await vibeKit({ prompt: "x", kit: DEFAULT_KIT });
    expect(sent).not.toHaveProperty("images");
  });
});

describe("ai client", () => {
  it("aiStatus never throws", async () => {
    mockFetch(() => {
      throw new TypeError("network down");
    });
    const s = await aiStatus();
    expect(s.enabled).toBe(false);
    expect(s.reason).toBeTruthy();
    mockFetch(() => json({ enabled: true, model: "m" }));
    expect(await aiStatus()).toMatchObject({ enabled: true, model: "m" });
  });

  it("surfaces server error messages", async () => {
    mockFetch(() => json({ error: "AI is disabled" }, 503));
    await expect(vibeKit({ prompt: "x", kit: DEFAULT_KIT })).rejects.toThrow("AI is disabled");
  });

  it("vibeParams coerces params with the real generator", async () => {
    const g = generatorFor("character");
    let sent: any;
    mockFetch((_u, init) => {
      sent = JSON.parse(String(init?.body));
      return json({ name: "Ember", params: { bogus: 1 }, notes: "n" });
    });
    const r = await vibeParams({ prompt: "witch", generator: g, kit: DEFAULT_KIT });
    expect(sent.generator.id).toBe(g.id);
    expect(sent.generator.params).toEqual(g.params);
    expect(r.name).toBe("Ember");
    expect(Object.keys(r.params).sort()).toEqual(g.params.map((p) => p.key).sort());
  });

  it("aiPixels finalizes the sprite (outline added) and sends references", async () => {
    const w = 8, h = 8;
    const data = new Array(w * h).fill(0);
    for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) data[y * w + x] = colorIndex("skin", 3);
    let sent: any;
    mockFetch((_u, init) => {
      sent = JSON.parse(String(init?.body));
      return json({ name: "Blob", sprite: { w, h, data } });
    });
    const ref = { w: 8, h: 8, data: new Array(64).fill(0) };
    const r = await aiPixels({ prompt: "blob", category: "object", w, h, kit: { ...DEFAULT_KIT, outline: "black" }, references: [ref, ref, ref] });
    expect(sent.references).toHaveLength(2);
    expect(r.sprite.data.filter((v) => v > 0).length).toBeGreaterThan(16); // outline ring added
    mockFetch(() => json({ name: "x", sprite: { w: 8, h: 8, data: [1] } }));
    await expect(aiPixels({ prompt: "x", category: "object", w, h, kit: DEFAULT_KIT })).rejects.toThrow(/malformed/);
  });

  it("vibeKit returns the partial kit", async () => {
    mockFetch(() => json({ kit: { outline: "black" }, notes: "ok" }));
    expect(await vibeKit({ prompt: "x", kit: DEFAULT_KIT })).toEqual({ kit: { outline: "black" }, notes: "ok" });
  });
});

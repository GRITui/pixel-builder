import { describe, expect, it } from "vitest";
import { encodePng } from "../io/png";
import { gradient } from "../pixel/fixtures";
import { extractImageRef, generateImage, imageConfig, imagePrompt, type ImageConfig } from "./images";
import { ProviderError } from "./provider";

const KEY = "sk-test-SECRET1234567890";
const png = encodePng(gradient(12, 8));
const b64 = png.toString("base64");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const cfg = (over: Partial<ImageConfig> = {}): ImageConfig => ({ baseUrl: "https://img.example/v1", apiKey: KEY, timeoutMs: 5000, model: "m1", style: "images", ...over });

function fake(respond: (url: string, body: any) => Response | Promise<Response>) {
  const calls: { url: string; body: any; headers: Record<string, string> }[] = [];
  const f = async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, body, headers: init.headers as Record<string, string> });
    return respond(url, body);
  };
  return { f, calls };
}

async function errorOf(p: Promise<unknown>): Promise<ProviderError> {
  try { await p; } catch (e) { return e as ProviderError; }
  throw new Error("expected a rejection");
}

describe("imageConfig", () => {
  it("reads IMAGE_* and only reuses the general key for the general base URL", () => {
    expect(imageConfig({ IMAGE_BASE_URL: "https://openrouter.ai/api/v1/", IMAGE_API_KEY: "k", IMAGE_MODEL: "x", IMAGE_API_STYLE: "Chat" })).toMatchObject({ baseUrl: "https://openrouter.ai/api/v1", apiKey: "k", model: "x", style: "chat" });
    expect(imageConfig({ IMAGE_BASE_URL: "https://other.example/v1", OPENAI_API_KEY: "general" }).apiKey).toBeUndefined();
    expect(imageConfig({ OPENAI_API_KEY: "general" })).toMatchObject({ apiKey: "general", baseUrl: "https://api.openai.com/v1", model: "gpt-image-1", style: "images" });
  });
});

describe("imagePrompt", () => {
  it("wraps the subject per mode", () => {
    expect(imagePrompt("a rainy street.", "scene")).toBe("realistic photograph of a rainy street, natural light, detailed");
    expect(imagePrompt("a knight", "sprite")).toMatch(/^a knight, single subject, centered, full view, on a perfectly flat solid #00FF00 background, no shadow, no text$/);
    expect(imagePrompt("cobblestones", "tile")).toBe("seamless tileable top-down texture of cobblestones, even lighting");
  });
});

describe("generateImage", () => {
  it("images style, b64_json", async () => {
    const { f, calls } = fake(() => json({ data: [{ b64_json: b64 }] }));
    const img = await generateImage({ prompt: "a lighthouse", mode: "scene", size: "1536x1024" }, { config: cfg(), fetch: f });
    expect([img.w, img.h]).toEqual([12, 8]);
    expect(calls[0].url).toBe("https://img.example/v1/images/generations");
    expect(calls[0].body).toEqual({ model: "m1", prompt: imagePrompt("a lighthouse", "scene"), size: "1536x1024", n: 1 });
    expect(calls[0].headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it("images style, url response downloaded through the safe fetcher", async () => {
    const { f } = fake(() => json({ data: [{ url: "https://cdn.example/img.png?sig=abc" }] }));
    const seen: string[] = [];
    const img = await generateImage({ prompt: "x", mode: "sprite" }, { config: cfg(), fetch: f, fetchUrl: async (u) => { seen.push(u); return png; } });
    expect(seen).toEqual(["https://cdn.example/img.png?sig=abc"]);
    expect(img.w).toBe(12);
    const e = await errorOf(generateImage({ prompt: "x" }, { config: cfg(), fetch: f, fetchUrl: async () => { throw new Error("Fetching https://cdn.example/img.png?sig=abc failed: HTTP 403."); } }));
    expect(e.message).toMatch(/cdn\.example/);
    expect(e.message).not.toMatch(/sig=abc/);
  });

  it("chat style: OpenRouter message.images and content parts", async () => {
    const { f, calls } = fake(() => json({ choices: [{ message: { role: "assistant", content: "here", images: [{ type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } }] } }] }));
    const img = await generateImage({ prompt: "moss", mode: "tile" }, { config: cfg({ style: "chat" }), fetch: f });
    expect(img.h).toBe(8);
    expect(calls[0].url).toBe("https://img.example/v1/chat/completions");
    expect(calls[0].body).toMatchObject({ model: "m1", modalities: ["image", "text"], messages: [{ role: "user", content: imagePrompt("moss", "tile") }] });
    const parts = fake(() => json({ choices: [{ message: { content: [{ type: "text", text: "ok" }, { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } }] } }] }));
    expect((await generateImage({ prompt: "moss" }, { config: cfg({ style: "chat" }), fetch: parts.f })).w).toBe(12);
  });

  it("extracts refs from loose shapes", () => {
    expect(extractImageRef({ choices: [{ message: { content: `![img](https://x.example/a.png)` } }] })).toBe("https://x.example/a.png");
    expect(extractImageRef({ choices: [{ message: { content: `data:image/png;base64,AAAA` } }] })).toBe("data:image/png;base64,AAAA");
    expect(extractImageRef({ choices: [{ message: { content: "sorry" } }] })).toBeUndefined();
  });

  it("maps errors and never leaks the key", async () => {
    const leaky = { error: { message: `Incorrect API key provided: ${KEY}` } };
    for (const [status, re] of [[401, /IMAGE_API_KEY/], [429, /Rate limited/], [503, /overloaded/], [400, /refused/], [500, /\(500\)/]] as const) {
      const { f } = fake(() => json(leaky, status));
      const e = await errorOf(generateImage({ prompt: "x" }, { config: cfg(), fetch: f }));
      expect(e).toBeInstanceOf(ProviderError);
      expect(e.message).toMatch(re);
      expect(e.message).not.toContain(KEY);
      expect(e.message).not.toContain("SECRET");
    }
    const nf = fake(() => json({}, 404));
    expect((await errorOf(generateImage({ prompt: "x" }, { config: cfg(), fetch: nf.f }))).message).toMatch(/IMAGE_API_STYLE=chat/);
    const down = await errorOf(generateImage({ prompt: "x" }, { config: cfg(), fetch: async () => { throw new TypeError(`connect failed ${KEY}`); } }));
    expect(down.message).toBe("Could not reach the AI provider.");
    const notJson = fake(() => new Response("<html>", { status: 200 }));
    expect((await errorOf(generateImage({ prompt: "x" }, { config: cfg(), fetch: notJson.f }))).message).toMatch(/not JSON/);
    const none = fake(() => json({ choices: [{ message: { content: "I can't draw" } }] }));
    expect((await errorOf(generateImage({ prompt: "x" }, { config: cfg({ style: "chat" }), fetch: none.f }))).message).toMatch(/returned no image/);
    const junk = fake(() => json({ data: [{ b64_json: Buffer.from("not an image").toString("base64") }] }));
    expect((await errorOf(generateImage({ prompt: "x" }, { config: cfg(), fetch: junk.f }))).message).toMatch(/could not be decoded/);
  });

  it("validates input and requires a key for hosted providers", async () => {
    const { f, calls } = fake(() => json({ data: [{ b64_json: b64 }] }));
    expect((await errorOf(generateImage({ prompt: " " }, { config: cfg(), fetch: f }))).message).toMatch(/prompt is required/);
    expect((await errorOf(generateImage({ prompt: "x", size: "big" }, { config: cfg(), fetch: f }))).message).toMatch(/1024x1024/);
    expect((await errorOf(generateImage({ prompt: "x" }, { config: cfg({ baseUrl: "https://api.openai.com/v1", apiKey: undefined }), fetch: f }))).message).toMatch(/IMAGE_API_KEY/);
    expect(calls).toHaveLength(0);
    // local servers work without a key, and send no authorization header
    await generateImage({ prompt: "x" }, { config: cfg({ baseUrl: "http://127.0.0.1:8080/v1", apiKey: undefined }), fetch: f });
    expect(calls[0].headers.authorization).toBeUndefined();
  });
});

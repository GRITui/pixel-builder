import { describe, expect, it } from "vitest";
import { aiHealth, extractJson, stripThink, validateSchema, openaiConfig } from "./llm";
import { callOpenAI, mapHttpStatus, type FetchLike } from "./providers/openai";
import { HttpError } from "./prompts";

const schema = { type: "object", additionalProperties: false, required: ["a"], properties: { a: { type: "integer" } } };
const cfg = { baseUrl: "http://x/v1", apiKey: "sk-secret", model: "m", visionModel: "vm" };
const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }), { status: 200 });
const fake = (...rs: (Response | Error)[]) => {
  const calls: any[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body as string) });
    const r = rs.shift()!;
    if (r instanceof Error) throw r;
    return r;
  };
  return { f, calls };
};
const base = { system: "sys", user: "u", schema };

describe("openai provider", () => {
  it("uses json_schema first", async () => {
    const { f, calls } = fake(reply('{"a":1}'));
    expect(await callOpenAI(base, cfg, f)).toEqual({ a: 1 });
    expect(calls[0].url).toBe("http://x/v1/chat/completions");
    expect(calls[0].body.response_format.type).toBe("json_schema");
    expect(calls[0].body.response_format.json_schema.strict).toBe(false);
    expect(calls[0].init.headers.authorization).toBe("Bearer sk-secret");
  });
  it("falls back to json_object with schema in system prompt", async () => {
    const { f, calls } = fake(new Response("unsupported response_format", { status: 400 }), reply('{"a":2}'));
    expect(await callOpenAI(base, cfg, f)).toEqual({ a: 2 });
    expect(calls[1].body.response_format).toEqual({ type: "json_object" });
    expect(calls[1].body.messages[0].content).toContain('"required"');
  });
  it("extracts fenced / embedded JSON and strips think", async () => {
    expect(extractJson('<think>{"a":9}</think>\n```json\n{"a":3}\n```')).toEqual({ a: 3 });
    expect(extractJson('Sure! {"a":{"b":"}"}} done')).toEqual({ a: { b: "}" } });
    expect(stripThink("<think>x\ny</think>hi")).toBe("hi");
    const { f } = fake(reply('<think>hm</think>Here: {"a":4}'));
    expect(await callOpenAI(base, cfg, f)).toEqual({ a: 4 });
  });
  it("repairs once with the validation error, then fails", async () => {
    const ok = fake(reply('{"a":"x"}'), reply('{"a":5}'));
    expect(await callOpenAI(base, cfg, ok.f)).toEqual({ a: 5 });
    expect(ok.calls[1].body.messages.at(-1).content).toContain("$.a");
    const bad = fake(reply("{}"), reply("{}"));
    await expect(callOpenAI(base, cfg, bad.f)).rejects.toMatchObject({ status: 502 });
  });
  it("maps errors without leaking the key", async () => {
    expect(mapHttpStatus(401).status).toBe(502);
    expect(mapHttpStatus(429).status).toBe(429);
    expect(mapHttpStatus(503).status).toBe(503);
    expect(mapHttpStatus(500).status).toBe(502);
    const e = (await callOpenAI(base, cfg, fake(new Response("bad key sk-secret", { status: 401 })).f).catch((x: Error) => x)) as Error;
    expect(e).toBeInstanceOf(HttpError);
    expect(e.message).not.toContain("sk-secret");
    const t = Object.assign(new Error("t"), { name: "TimeoutError" });
    await expect(callOpenAI(base, cfg, fake(t).f)).rejects.toMatchObject({ status: 504 });
    await expect(callOpenAI(base, cfg, fake(new TypeError("fetch failed")).f)).rejects.toMatchObject({ status: 502 });
  });
  it("sends images as image_url with the vision model", async () => {
    const { f, calls } = fake(reply('{"a":1}'));
    await callOpenAI({ ...base, images: [{ media_type: "image/png", data: "AAAA" }] }, cfg, f);
    expect(calls[0].body.model).toBe("vm");
    const c = calls[0].body.messages[1].content;
    expect(c[0]).toEqual({ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } });
    expect(c.at(-1)).toEqual({ type: "text", text: "u" });
  });
  it("gives a clear error when images are rejected", async () => {
    const { f } = fake(new Response("model does not support image input", { status: 400 }));
    await expect(callOpenAI({ ...base, images: [{ media_type: "image/png", data: "AAAA" }] }, cfg, f)).rejects.toMatchObject({ status: 422 });
  });
});

describe("validateSchema", () => {
  it("checks the subset", () => {
    expect(validateSchema({ a: 1 }, schema)).toBeNull();
    expect(validateSchema({ a: 1, b: 2 }, schema)).toMatch(/unexpected/);
    expect(validateSchema({ a: "z" }, { type: "object", properties: { a: { enum: ["x"] } } })).toMatch(/one of/);
  });
});

describe("health", () => {
  it("reports provider and never the key", () => {
    expect(aiHealth({})).toMatchObject({ enabled: false, provider: "anthropic" });
    expect(aiHealth({ ANTHROPIC_API_KEY: "k" })).toMatchObject({ enabled: true, model: "claude-opus-5-5", vision_model: "claude-opus-5-5" });
    expect(aiHealth({ AI_PROVIDER: "openai" })).toMatchObject({ enabled: false, provider: "openai" });
    const h = aiHealth({ AI_PROVIDER: "openai", OPENAI_API_KEY: "sk-secret", AI_MODEL: "qwen-max", AI_VISION_MODEL: "qwen-vl-max" });
    expect(h).toMatchObject({ enabled: true, provider: "openai", model: "qwen-max", vision_model: "qwen-vl-max" });
    expect(JSON.stringify(h)).not.toContain("sk-secret");
    expect(openaiConfig({ OPENAI_BASE_URL: "http://h/v1/" }).baseUrl).toBe("http://h/v1");
  });
});

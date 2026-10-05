// OpenAI-compatible Chat Completions provider (OpenAI, Qwen/DashScope,
// OpenRouter, Ollama, vLLM). Plain fetch; the key only goes in the Authorization header.
import { HttpError, type JsonSchema } from "../prompts";
import { checkImageCaps, type ImageInput } from "../images";
import { extractJson, openaiConfig, stripThink, validateSchema, type OpenAIConfig } from "../llm";

export interface OpenAICall {
  system: string;
  user: string;
  images?: ImageInput[];
  schema: JsonSchema;
  maxTokens?: number;
  signal?: AbortSignal;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
const TIMEOUT_MS = 120_000;

type Msg = { role: string; content: unknown };

export function buildMessages(system: string, user: string, images?: ImageInput[]): Msg[] {
  let content: unknown = user;
  if (images?.length) {
    checkImageCaps(images);
    content = [
      ...images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.media_type};base64,${i.data}` } })),
      { type: "text", text: user },
    ];
  }
  return [
    { role: "system", content: system },
    { role: "user", content },
  ];
}

export function mapHttpStatus(status: number, hint = ""): HttpError {
  if (status === 401 || status === 403) return new HttpError(502, "The server's AI provider key was rejected or not allowed to use this model. Check OPENAI_API_KEY / AI_MODEL.");
  if (status === 429) return new HttpError(429, "Rate limited by the AI provider. Try again in a moment.");
  if (status === 408 || status === 504) return new HttpError(504, "The AI provider timed out. Try again.");
  if (status === 503 || status === 529) return new HttpError(503, "The AI provider is overloaded. Try again shortly.");
  return new HttpError(502, `AI provider error (${status})${hint ? `: ${hint}` : ""}`);
}

export function mapFetchError(e: unknown, signal?: AbortSignal): HttpError {
  if (e instanceof HttpError) return e;
  if (signal?.aborted) return new HttpError(499, "Request cancelled.");
  const name = (e as { name?: string })?.name;
  if (name === "TimeoutError" || name === "AbortError") return new HttpError(504, "The AI provider timed out. Try again.");
  return new HttpError(502, "Could not reach the AI provider.");
}

const clip = (s: string) => s.replace(/\s+/g, " ").slice(0, 300);

async function post(f: FetchLike, cfg: OpenAIConfig, body: unknown, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const sig = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  try {
    const res = await f(`${cfg.baseUrl}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), signal: sig });
    return { status: res.status, ok: res.ok, text: await res.text() };
  } catch (e) {
    throw mapFetchError(e, signal);
  }
}

export async function callOpenAI(c: OpenAICall, cfg: OpenAIConfig = openaiConfig(), f: FetchLike = fetch): Promise<unknown> {
  const withImages = !!c.images?.length;
  const model = withImages ? cfg.visionModel : cfg.model;
  const jsonSystem = `${c.system}\n\nRespond with ONLY a JSON object matching this JSON Schema, no prose:\n${JSON.stringify(c.schema)}`;
  let mode: "json_schema" | "json_object" = "json_schema";
  let messages = buildMessages(c.system, c.user, c.images);
  let repaired = false;

  for (let attempt = 0; attempt < 4; attempt++) {
    const body = {
      model,
      messages,
      max_tokens: c.maxTokens ?? 16000,
      response_format: mode === "json_schema" ? { type: "json_schema", json_schema: { name: "pixel_builder_output", schema: c.schema, strict: false } } : { type: "json_object" },
    };
    const r = await post(f, cfg, body, c.signal);
    if (!r.ok) {
      const lower = r.text.toLowerCase();
      if (r.status === 400 && lower.includes("response_format") && mode === "json_schema") {
        mode = "json_object";
        messages = buildMessages(jsonSystem, c.user, c.images);
        continue;
      }
      if (r.status === 400 && withImages && /image|vision|multimodal/.test(lower)) {
        throw new HttpError(422, `The model "${model}" rejected the reference images. Set AI_VISION_MODEL to a vision-capable model (e.g. qwen-vl-max, gpt-4o).`);
      }
      throw mapHttpStatus(r.status, r.status === 400 ? clip(r.text) : "");
    }
    let choice: any;
    try {
      choice = JSON.parse(r.text).choices?.[0];
    } catch {
      throw new HttpError(502, "The AI provider returned a malformed response.");
    }
    if (choice?.finish_reason === "content_filter" || choice?.message?.refusal) throw new HttpError(422, "The model declined this request. Try rephrasing the prompt.");
    if (choice?.finish_reason === "length") throw new HttpError(502, "Model output truncated (hit the token limit). Try a smaller size or simpler prompt.");
    const text = stripThink(typeof choice?.message?.content === "string" ? choice.message.content : "");
    if (!text) throw new HttpError(502, "The model returned no content.");
    let problem: string | null;
    let parsed: unknown;
    try {
      parsed = extractJson(text);
      problem = validateSchema(parsed, c.schema);
    } catch (e) {
      problem = (e as Error).message;
    }
    if (!problem) return parsed;
    if (repaired) throw new HttpError(502, `The model returned invalid output: ${problem}`);
    repaired = true;
    messages = [...messages, { role: "assistant", content: text }, { role: "user", content: `Your reply was invalid: ${problem}. Reply again with ONLY a corrected JSON object matching the schema.` }];
  }
  throw new HttpError(502, "The model returned invalid output.");
}

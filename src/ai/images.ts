// OpenAI-compatible image generation (#107): prompt -> Rgba, for the pixelize prompt path.
// Two wire styles: POST {base}/images/generations (OpenAI, most gateways; b64_json or url) and, with
// IMAGE_API_STYLE=chat, POST {base}/chat/completions with image output (OpenRouter-style: the image
// comes back as a data URI in message.images or in content parts). Errors never carry the key.
import { decodeImage, MAX_IMAGE_BYTES } from "../io/decode";
import { fetchImage } from "../net/fetch-safe";
import type { Mode, Rgba } from "../pixel/types";
import { mapHttpStatus, postJson, ProviderError, providerConfig, redact, type FetchLike, type ProviderConfig } from "./provider";

export type ImageApiStyle = "images" | "chat";

export interface ImageConfig extends ProviderConfig {
  model: string;
  style: ImageApiStyle;
}

export const DEFAULT_IMAGE_MODEL = "gpt-image-1";
export const DEFAULT_IMAGE_SIZE = "1024x1024";

/**
 * IMAGE_BASE_URL / IMAGE_API_KEY / IMAGE_MODEL / IMAGE_API_STYLE, falling back to the general
 * provider settings. The general key is only reused when the image base URL is not overridden, so a
 * key meant for one provider is never sent to another.
 */
export function imageConfig(env: NodeJS.ProcessEnv = process.env): ImageConfig {
  const general = providerConfig(env);
  const base = env.IMAGE_BASE_URL?.trim();
  const timeout = Number(env.IMAGE_TIMEOUT_MS);
  return {
    baseUrl: base ? base.replace(/\/+$/, "") : general.baseUrl,
    apiKey: env.IMAGE_API_KEY || (base ? undefined : general.apiKey),
    timeoutMs: timeout > 0 ? timeout : Math.max(general.timeoutMs, 180_000),
    model: env.IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL,
    style: env.IMAGE_API_STYLE?.trim().toLowerCase() === "chat" ? "chat" : "images",
  };
}

/** Wrap the user's subject in a template that gives the pixelizer clean input for each mode. */
export function imagePrompt(prompt: string, mode: Mode = "scene"): string {
  const p = prompt.trim().replace(/\s+/g, " ").replace(/[.,;\s]+$/, "");
  if (mode === "sprite") return `${p}, single subject, centered, full view, on a perfectly flat solid #00FF00 background, no shadow, no text`;
  if (mode === "tile") return `seamless tileable top-down texture of ${p}, even lighting`;
  return `realistic photograph of ${p}, natural light, detailed`;
}

export interface GenerateImageInput {
  prompt: string;
  mode?: Mode;
  /** "WxH" (e.g. 1024x1024, 1536x1024) or "auto". images style only. */
  size?: string;
}

export interface ImageDeps {
  env?: NodeJS.ProcessEnv;
  config?: ImageConfig;
  /** Transport for the provider API (tests pass a fake). */
  fetch?: FetchLike;
  /** Downloader for `url` responses; defaults to the SSRF-safe fetchImage. */
  fetchUrl?: (url: string) => Promise<Buffer>;
  signal?: AbortSignal;
}

const HOSTED_NEEDS_KEY = /(^|\.)(openai\.com|openrouter\.ai|together\.xyz|fireworks\.ai|x\.ai)$/i;

function keyRequired(cfg: ImageConfig): boolean {
  try { return HOSTED_NEEDS_KEY.test(new URL(cfg.baseUrl).hostname); } catch { return false; }
}

/** Provider error text, redacted and short, for the error message hint. */
function errorHint(text: string, key?: string): string {
  let msg = "";
  try {
    const j = JSON.parse(text);
    msg = typeof j?.error === "string" ? j.error : j?.error?.message ?? j?.message ?? "";
  } catch { /* not JSON */ }
  return redact(String(msg || "").slice(0, 240), key).trim();
}

function httpError(status: number, text: string, cfg: ImageConfig): ProviderError {
  if (status === 401 || status === 403) return new ProviderError(502, "The image provider rejected the API key or the model is not allowed. Check IMAGE_API_KEY and IMAGE_MODEL.");
  const hint = errorHint(text, cfg.apiKey);
  if ((status === 404 || status === 405) && cfg.style === "images")
    return new ProviderError(502, `The image provider has no ${cfg.baseUrl.replace(/^https?:\/\/[^/]+/, "") || ""}/images/generations endpoint (${status}). For providers that return images from chat completions (e.g. OpenRouter) set IMAGE_API_STYLE=chat.`);
  if (status === 400) return new ProviderError(400, `The image provider refused the request${hint ? `: ${hint}` : "."}`);
  return mapHttpStatus(status, hint);
}

function parseJson(text: string): any {
  try { return JSON.parse(text); } catch { throw new ProviderError(502, "The image provider returned a response that is not JSON."); }
}

/** First image reference in an OpenAI-style images response or an OpenRouter-style chat response. */
export function extractImageRef(body: any): string | undefined {
  const d = body?.data?.[0];
  if (d?.b64_json) return `data:image/png;base64,${d.b64_json}`;
  if (typeof d?.url === "string") return d.url;
  const msg = body?.choices?.[0]?.message;
  if (!msg) return undefined;
  const fromPart = (p: any): string | undefined => {
    if (!p || typeof p !== "object") return undefined;
    const u = p.image_url;
    if (typeof u === "string") return u;
    if (typeof u?.url === "string") return u.url;
    if (typeof p.b64_json === "string") return `data:image/png;base64,${p.b64_json}`;
    if ((p.type === "image" || p.type === "output_image") && typeof p.data === "string") return p.data.startsWith("data:") ? p.data : `data:${p.mime_type ?? "image/png"};base64,${p.data}`;
    return undefined;
  };
  for (const p of Array.isArray(msg.images) ? msg.images : []) { const r = fromPart(p); if (r) return r; }
  if (Array.isArray(msg.content)) for (const p of msg.content) { const r = fromPart(p); if (r) return r; }
  if (typeof msg.content === "string") {
    const m = /data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=\s]+/i.exec(msg.content) ?? /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/.exec(msg.content);
    if (m) return (m[1] ?? m[0]).replace(/\s+/g, "");
  }
  return undefined;
}

function decodeDataUri(uri: string): Buffer {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(uri);
  if (!m || !m[2]) throw new ProviderError(502, "The image provider returned a data URI that is not base64.");
  if (m[3].length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8) throw new ProviderError(502, `The generated image is larger than ${MAX_IMAGE_BYTES / 1048576} MB.`);
  return Buffer.from(m[3], "base64");
}

/** Generate an image for `prompt` (wrapped in the mode's template) and decode it to RGBA. */
export async function generateImage(input: GenerateImageInput, deps: ImageDeps = {}): Promise<Rgba> {
  const cfg = deps.config ?? imageConfig(deps.env);
  const prompt = input.prompt?.trim();
  if (!prompt) throw new ProviderError(400, "A prompt is required to generate an image.");
  if (prompt.length > 2000) throw new ProviderError(400, "The prompt is too long (max 2000 characters).");
  if (input.size !== undefined && input.size !== "auto" && !/^\d{2,5}x\d{2,5}$/.test(input.size)) throw new ProviderError(400, `Image size must look like 1024x1024 or be 'auto', got '${input.size}'.`);
  if (!cfg.apiKey && keyRequired(cfg)) throw new ProviderError(400, "Image generation needs an API key: set IMAGE_API_KEY (and IMAGE_BASE_URL / IMAGE_MODEL for non-OpenAI providers).");
  const full = imagePrompt(prompt, input.mode);
  const [path, body] = cfg.style === "chat"
    ? ["/chat/completions", { model: cfg.model, messages: [{ role: "user", content: full }], modalities: ["image", "text"] }]
    : ["/images/generations", { model: cfg.model, prompt: full, size: input.size ?? DEFAULT_IMAGE_SIZE, n: 1 }];
  const res = await postJson(cfg, path, body, { signal: deps.signal, fetch: deps.fetch });
  if (!res.ok) throw httpError(res.status, res.text, cfg);
  const ref = extractImageRef(parseJson(res.text));
  if (!ref) throw new ProviderError(502, cfg.style === "chat" ? `The model returned no image. Check that IMAGE_MODEL (${cfg.model}) can output images.` : "The image provider returned no image.");
  let bytes: Buffer;
  if (ref.startsWith("data:")) bytes = decodeDataUri(ref);
  else if (/^https?:\/\//i.test(ref)) {
    try {
      bytes = await (deps.fetchUrl ?? ((u: string) => fetchImage(u)))(ref);
    } catch (e) {
      // The signed URL itself can carry tokens; report the host only.
      let host = "the provider";
      try { host = new URL(ref).host; } catch { /* keep default */ }
      throw new ProviderError(502, `Could not download the generated image from ${host}: ${redact((e as Error).message ?? String(e), cfg.apiKey).replace(ref, "<url>")}`);
    }
  } else throw new ProviderError(502, "The image provider returned an unsupported image reference.");
  try {
    return await decodeImage(bytes);
  } catch (e) {
    throw new ProviderError(502, `The generated image could not be decoded: ${(e as Error).message}`);
  }
}

export { ProviderError };

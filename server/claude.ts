// Thin wrapper around the Anthropic SDK: one structured-output call, typed
// error mapping. The API key never leaves the server.
import Anthropic from "@anthropic-ai/sdk";
import { HttpError, type JsonSchema } from "./prompts";

export const DEFAULT_MODEL = "claude-opus-5-5";
export const getModel = () => process.env.PIXEL_MODEL || DEFAULT_MODEL;
export const hasKey = () => !!process.env.ANTHROPIC_API_KEY;

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

export interface StructuredCall {
  system: string;
  user: string;
  schema: JsonSchema;
  effort: "low" | "medium" | "high";
  maxTokens?: number;
  /** Use the streaming API (required for large max_tokens, e.g. pixel grids). */
  stream?: boolean;
  signal?: AbortSignal;
}

/** Map typed SDK errors (most specific first) to an HttpError. */
export function mapError(e: unknown): HttpError {
  if (e instanceof HttpError) return e;
  if (e instanceof Anthropic.AuthenticationError) return new HttpError(502, "The server's Anthropic API key was rejected. Check ANTHROPIC_API_KEY.");
  if (e instanceof Anthropic.PermissionDeniedError) return new HttpError(502, "The server's Anthropic API key is not allowed to use this model.");
  if (e instanceof Anthropic.RateLimitError) return new HttpError(429, "Rate limited by the AI provider. Try again in a moment.");
  if (e instanceof Anthropic.APIUserAbortError) return new HttpError(499, "Request cancelled.");
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new HttpError(504, "The AI provider timed out. Try again.");
  if (e instanceof Anthropic.APIConnectionError) return new HttpError(502, "Could not reach the AI provider.");
  if (e instanceof Anthropic.APIError) {
    if (e.status === 529 || e.status === 503) return new HttpError(503, "The AI provider is overloaded. Try again shortly.");
    return new HttpError(502, `AI provider error${e.status ? ` (${e.status})` : ""}: ${e.message}`);
  }
  return new HttpError(500, "Unexpected server error.");
}

/** Run one structured-output request and return the parsed JSON (untrusted). */
export async function callStructured(c: StructuredCall): Promise<unknown> {
  if (!hasKey()) throw new HttpError(503, "AI is disabled: ANTHROPIC_API_KEY is not set on the server.");
  const params = {
    model: getModel(),
    max_tokens: c.maxTokens ?? 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default" as const,
    output_config: { format: { type: "json_schema" as const, schema: c.schema }, effort: c.effort },
    system: c.system,
    messages: [{ role: "user" as const, content: c.user }],
  };
  try {
    const msg = c.stream
      ? await getClient().beta.messages.stream(params, { signal: c.signal }).finalMessage()
      : await getClient().beta.messages.create(params, { signal: c.signal });
    if (msg.stop_reason === "refusal") throw new HttpError(422, "The model declined this request. Try rephrasing the prompt.");
    if (msg.stop_reason === "max_tokens") throw new HttpError(502, "Model output truncated (hit the token limit). Try a smaller size or simpler prompt.");
    const text = msg.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (!text) throw new HttpError(502, "The model returned no content.");
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpError(502, "The model returned invalid JSON.");
    }
  } catch (e) {
    throw mapError(e);
  }
}

// OpenAI-compatible provider plumbing (base for the image adapter, #107): config from env, POST with
// timeout + cancellation, and error mapping that never leaks the API key.
export class ProviderError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface ProviderConfig {
  apiKey?: string;
  /** Without trailing slash, e.g. https://api.openai.com/v1 */
  baseUrl: string;
  timeoutMs: number;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export function providerConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  return {
    apiKey: env.OPENAI_API_KEY || env.AI_API_KEY || undefined,
    baseUrl: (env.OPENAI_BASE_URL || env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
    timeoutMs: Number(env.AI_TIMEOUT_MS) > 0 ? Number(env.AI_TIMEOUT_MS) : 120_000,
  };
}

export function mapHttpStatus(status: number, hint = ""): ProviderError {
  if (status === 401 || status === 403) return new ProviderError(502, "The AI provider rejected the API key or the model is not allowed. Check OPENAI_API_KEY and the model name.");
  if (status === 429) return new ProviderError(429, "Rate limited by the AI provider. Try again in a moment.");
  if (status === 408 || status === 504) return new ProviderError(504, "The AI provider timed out. Try again.");
  if (status === 503 || status === 529) return new ProviderError(503, "The AI provider is overloaded. Try again shortly.");
  return new ProviderError(502, `AI provider error (${status})${hint ? `: ${hint}` : ""}`);
}

export function mapFetchError(e: unknown, signal?: AbortSignal): ProviderError {
  if (e instanceof ProviderError) return e;
  if (signal?.aborted) return new ProviderError(499, "Request cancelled.");
  const name = (e as { name?: string })?.name;
  if (name === "TimeoutError" || name === "AbortError") return new ProviderError(504, "The AI provider timed out. Try again.");
  return new ProviderError(502, "Could not reach the AI provider.");
}

/** Remove anything that looks like a bearer key from text before it reaches logs or tool output. */
export const redact = (s: string, key?: string): string => {
  let out = s.replace(/\b(sk|key)-[A-Za-z0-9_-]{8,}/g, "[redacted]");
  if (key && key.length > 6) out = out.split(key).join("[redacted]");
  return out;
};

/** POST JSON to `${baseUrl}${path}`; returns status + text. Network failures are mapped, never raw. */
export async function postJson(cfg: ProviderConfig, path: string, body: unknown, opts: { signal?: AbortSignal; fetch?: FetchLike } = {}): Promise<{ status: number; ok: boolean; text: string }> {
  const timeout = AbortSignal.timeout(cfg.timeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  try {
    const res = await (opts.fetch ?? fetch)(`${cfg.baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body), signal });
    return { status: res.status, ok: res.ok, text: await res.text() };
  } catch (e) {
    throw mapFetchError(e, opts.signal);
  }
}

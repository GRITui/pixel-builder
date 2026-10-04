// Browser client for the Pixel Builder API (server/). Same-origin `/api/*`
// (Vite proxies it in dev). The API key only ever lives on the server.
import { finalize } from "../core/enforce";
import { coerceParams, type Generator, type Params } from "../core/generators/types";
import type { Category, Sprite, StyleKit } from "../core/types";

export interface AiStatus {
  enabled: boolean;
  model: string | null;
  reason?: string;
}

export interface VibeResult {
  /** Short asset name suggested by the model, e.g. "Ember Witch". */
  name: string;
  params: Params;
  /** One sentence on how the prompt was interpreted. */
  notes: string;
}

export interface PixelsResult {
  name: string;
  sprite: Sprite;
}

const STATUS_TIMEOUT_MS = 5_000;
const CALL_TIMEOUT_MS = 240_000;

async function request<T>(path: string, init: { method: "GET" | "POST"; body?: unknown; timeoutMs: number }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method,
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs),
    });
  } catch (e) {
    const timedOut = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new Error(timedOut ? "The AI request timed out. Try again." : "Could not reach the API server. Is it running?");
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const msg = data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string" ? (data as { error: string }).error : `API request failed (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

/** GET /api/health — whether the server has an API key configured. Never throws. */
export async function aiStatus(): Promise<AiStatus> {
  try {
    const s = await request<Partial<AiStatus>>("/api/health", { method: "GET", timeoutMs: STATUS_TIMEOUT_MS });
    return { enabled: s.enabled === true, model: typeof s.model === "string" ? s.model : null, reason: typeof s.reason === "string" ? s.reason : undefined };
  } catch (e) {
    return { enabled: false, model: null, reason: e instanceof Error ? e.message : "API server unreachable" };
  }
}

/**
 * "Vibe" mode: natural language -> parameters for a procedural generator.
 * Output always goes through the same generator + kit, so it stays on-style.
 */
export async function vibeParams(args: { prompt: string; generator: Generator; kit: StyleKit; current?: Params }): Promise<VibeResult> {
  const { generator } = args;
  const r = await request<{ name?: unknown; params?: unknown; notes?: unknown }>("/api/vibe", {
    method: "POST",
    timeoutMs: CALL_TIMEOUT_MS,
    body: {
      prompt: args.prompt,
      generator: { id: generator.id, label: generator.label, description: generator.description, params: generator.params },
      kit: args.kit,
      current: args.current,
    },
  });
  const raw = r.params && typeof r.params === "object" ? (r.params as Record<string, unknown>) : {};
  return {
    name: typeof r.name === "string" && r.name ? r.name : generator.label,
    params: coerceParams(generator, raw),
    notes: typeof r.notes === "string" ? r.notes : "",
  };
}

/**
 * "Freeform" mode: the model paints pixels directly, restricted to the kit's
 * palette; result is then run through the enforcement pass (outline etc).
 * `references` (e.g. library sprites) are sent as style examples.
 */
export async function aiPixels(args: { prompt: string; category: Category; w: number; h: number; kit: StyleKit; references?: Sprite[] }): Promise<PixelsResult> {
  const r = await request<{ name?: unknown; sprite?: Partial<Sprite> }>("/api/pixels", {
    method: "POST",
    timeoutMs: CALL_TIMEOUT_MS,
    body: { prompt: args.prompt, category: args.category, w: args.w, h: args.h, kit: args.kit, references: args.references?.slice(0, 2) },
  });
  const s = r.sprite;
  if (!s || !Number.isInteger(s.w) || !Number.isInteger(s.h) || !Array.isArray(s.data) || s.data.length !== (s.w as number) * (s.h as number)) {
    throw new Error("The server returned a malformed sprite.");
  }
  const sprite = finalize({ w: s.w as number, h: s.h as number, data: s.data as number[] }, args.kit, { cleanup: true });
  return { name: typeof r.name === "string" && r.name ? r.name : "AI sprite", sprite };
}

/**
 * "Region edit" (inpaint): the model rewrites only the masked cells of the
 * given frames. The server sees each frame as legend rows for context and
 * merges the result back, so pixels outside the mask are unchanged.
 */
export async function aiInpaint(args: {
  prompt: string;
  frames: Sprite[];
  mask: { x: number; y: number; w: number; h: number } | boolean[][];
  kit: StyleKit;
}): Promise<Sprite[]> {
  const r = await request<{ frames?: { w: number; h: number; data: number[] }[] }>("/api/inpaint", {
    method: "POST",
    timeoutMs: CALL_TIMEOUT_MS,
    body: { prompt: args.prompt, frames: args.frames, mask: args.mask, kit: args.kit },
  });
  const frames = r.frames;
  if (!Array.isArray(frames) || frames.length !== args.frames.length)
    throw new Error("The server returned a malformed inpaint result.");
  return frames.map((s) => {
    if (!Number.isInteger(s?.w) || !Number.isInteger(s?.h) || !Array.isArray(s?.data) || s.data.length !== (s.w as number) * (s.h as number))
      throw new Error("The server returned a malformed inpaint result.");
    return { w: s.w as number, h: s.h as number, data: s.data as number[] };
  });
}

/** "Describe a style": natural language -> a partial style kit (palette, outline, light, ramp tweaks...). */
export async function vibeKit(args: { prompt: string; kit: StyleKit }): Promise<{ kit: Partial<StyleKit>; notes: string }> {
  const r = await request<{ kit?: unknown; notes?: unknown }>("/api/kit", {
    method: "POST",
    timeoutMs: CALL_TIMEOUT_MS,
    body: { prompt: args.prompt, kit: args.kit },
  });
  return {
    kit: r.kit && typeof r.kit === "object" ? (r.kit as Partial<StyleKit>) : {},
    notes: typeof r.notes === "string" ? r.notes : "",
  };
}

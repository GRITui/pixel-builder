// Browser client for the Pixel Builder API (server/). Same-origin `/api/*`
// (Vite proxies it in dev). The API key only ever lives on the server.
import { authHeaders } from "../ui/remote";
import { finalize } from "../core/enforce";
import { coerceParams, type Generator, type Params } from "../core/generators/types";
import type { Attachment, Clip, RigDef } from "../core/rig";
import type { RigFamily } from "../core/rigs";
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

/** Optional reference inputs shared by the AI calls: data-URL images and/or library reference ids. */
export interface ReferenceArgs {
  images?: string[];
  referenceIds?: string[];
  project?: string;
}
export const refBody = (a: ReferenceArgs) => ({
  ...(a.images?.length ? { images: a.images.slice(0, 4) } : {}),
  ...(a.referenceIds?.length ? { reference_ids: a.referenceIds } : {}),
  ...(a.project && a.referenceIds?.length ? { project: a.project } : {}),
});

const STATUS_TIMEOUT_MS = 5_000;
const CALL_TIMEOUT_MS = 240_000;

async function request<T>(path: string, init: { method: "GET" | "POST"; body?: unknown; timeoutMs: number }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method,
      headers: { ...authHeaders(), ...(init.body === undefined ? {} : { "content-type": "application/json" }) },
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
export async function vibeParams(args: { prompt: string; generator: Generator; kit: StyleKit; current?: Params } & ReferenceArgs): Promise<VibeResult> {
  const { generator } = args;
  const r = await request<{ name?: unknown; params?: unknown; notes?: unknown }>("/api/vibe", {
    method: "POST",
    timeoutMs: CALL_TIMEOUT_MS,
    body: {
      prompt: args.prompt,
      generator: { id: generator.id, label: generator.label, description: generator.description, params: generator.params },
      kit: args.kit,
      current: args.current,
      ...refBody(args),
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
export async function aiPixels(args: { prompt: string; category: Category; w: number; h: number; kit: StyleKit; references?: Sprite[] } & ReferenceArgs): Promise<PixelsResult> {
  const r = await request<{ name?: unknown; sprite?: Partial<Sprite> }>("/api/pixels", {
    method: "POST",
    timeoutMs: CALL_TIMEOUT_MS,
    body: { prompt: args.prompt, category: args.category, w: args.w, h: args.h, kit: args.kit, references: args.references?.slice(0, 2), ...refBody(args) },
  });
  const s = r.sprite;
  if (!s || !Number.isInteger(s.w) || !Number.isInteger(s.h) || !Array.isArray(s.data) || s.data.length !== (s.w as number) * (s.h as number)) {
    throw new Error("The server returned a malformed sprite.");
  }
  const sprite = finalize({ w: s.w as number, h: s.h as number, data: s.data as number[] }, args.kit, { cleanup: true });
  return { name: typeof r.name === "string" && r.name ? r.name : "AI sprite", sprite };
}

/** "Describe a style": natural language -> a partial style kit (palette, outline, light, ramp tweaks...). */
export async function vibeKit(args: { prompt: string; kit: StyleKit; /** Offline analysis of the reference (analyzeReference output). */ analysis?: unknown } & ReferenceArgs): Promise<{ kit: Partial<StyleKit>; notes: string }> {
  const r = await request<{ kit?: unknown; notes?: unknown }>("/api/kit", {
    method: "POST",
    timeoutMs: CALL_TIMEOUT_MS,
    body: { prompt: args.prompt, kit: args.kit, ...(args.analysis ? { analysis: args.analysis } : {}), ...refBody(args) },
  });
  return {
    kit: r.kit && typeof r.kit === "object" ? (r.kit as Partial<StyleKit>) : {},
    notes: typeof r.notes === "string" ? r.notes : "",
  };
}

/**
 * Region edit: the model repaints only the masked cells. Returns legend rows for the
 * mask's bounding box; apply them with `applyRegionEdit` (core/inpaint).
 */
export async function aiInpaint(args: {
  rows: string[];
  mask: { rect: { x: number; y: number; w: number; h: number } } | { cells: [number, number][] };
  prompt: string;
  kit: StyleKit;
} & ReferenceArgs): Promise<{ rect: { x: number; y: number; w: number; h: number }; rows: string[] }> {
  const r = await request<{ rect?: { x: number; y: number; w: number; h: number }; rows?: unknown }>("/api/inpaint", {
    method: "POST",
    timeoutMs: CALL_TIMEOUT_MS,
    body: { rows: args.rows, mask: args.mask, prompt: args.prompt, kit: args.kit, ...refBody(args) },
  });
  if (!r.rect || !Array.isArray(r.rows) || !r.rows.every((x) => typeof x === "string")) throw new Error("The server returned a malformed edit.");
  return { rect: r.rect, rows: r.rows as string[] };
}

/**
 * "Describe animation": text -> a Clip for a rig family (validated server-side against the
 * family's joints). Load it into the rig editor timeline; it is not stored until saved.
 */
export async function aiClip(args: { prompt: string; family: RigFamily; rig?: string | { id: string; joints: { id: string; parent: string | null }[] }; fps?: number; frames?: number }): Promise<{ clip: Clip; notes: string }> {
  const r = await request<{ clip?: Partial<Clip>; notes?: unknown }>("/api/clip", { method: "POST", timeoutMs: CALL_TIMEOUT_MS, body: args });
  const c = r.clip;
  if (!c || typeof c.id !== "string" || typeof c.fps !== "number" || !c.frames || typeof c.frames !== "object") throw new Error("The server returned a malformed clip.");
  return { clip: c as Clip, notes: typeof r.notes === "string" ? r.notes : "" };
}

export interface RigAuthorResult {
  /** Present when the model authored a new rig; otherwise `baseRig` names the registry rig that was extended. */
  rig?: RigDef;
  baseRig?: string;
  family: string;
  /** Built-in attachment ids to wear. */
  attachmentIds: string[];
  attachments: Attachment[];
  /** Clips the new rig brings (idle/walk for free-form creatures). */
  clips: Clip[];
  slots: Record<string, string>;
  name: string;
  notes: string;
}

/**
 * "Describe a character": text -> a rigged character or creature (a new rig, or a registry rig plus
 * new attachments). The server validates the result; the caller stores it in the project.
 */
export async function aiRig(args: { prompt: string; kit: StyleKit; base?: string } & ReferenceArgs): Promise<RigAuthorResult> {
  const r = await request<Partial<RigAuthorResult>>("/api/rig", {
    method: "POST",
    timeoutMs: CALL_TIMEOUT_MS,
    body: { prompt: args.prompt, kit: args.kit, ...(args.base ? { base: args.base } : {}), ...refBody(args) },
  });
  const rig = r.rig && typeof r.rig === "object" && Array.isArray(r.rig.joints) && Array.isArray(r.rig.parts) ? r.rig : undefined;
  const baseRig = typeof r.baseRig === "string" ? r.baseRig : undefined;
  if (!rig && !baseRig) throw new Error("The server returned a malformed rig.");
  const list = <T extends { id: unknown }>(v: unknown): T[] => (Array.isArray(v) ? v.filter((x): x is T => !!x && typeof (x as T).id === "string") : []);
  return {
    rig,
    baseRig,
    family: typeof r.family === "string" ? r.family : "custom",
    attachmentIds: Array.isArray(r.attachmentIds) ? r.attachmentIds.filter((x): x is string => typeof x === "string") : [],
    attachments: list<Attachment>(r.attachments),
    clips: list<Clip>(r.clips),
    slots: r.slots && typeof r.slots === "object" ? (r.slots as Record<string, string>) : {},
    name: typeof r.name === "string" && r.name ? r.name : rig?.name ?? "AI rig",
    notes: typeof r.notes === "string" ? r.notes : "",
  };
}

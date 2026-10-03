// STUB — owned by Lane C. Keep these exported names/signatures (the UI lanes code against them).
import type { Generator, Params } from "../core/generators/types";
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

/** GET /api/health — whether the server has an API key configured. */
export async function aiStatus(): Promise<AiStatus> {
  return { enabled: false, model: null, reason: "AI client not implemented yet" };
}

/**
 * "Vibe" mode: natural language -> parameters for a procedural generator.
 * Output always goes through the same generator + kit, so it stays on-style.
 */
export async function vibeParams(_args: { prompt: string; generator: Generator; kit: StyleKit; current?: Params }): Promise<VibeResult> {
  throw new Error("AI not implemented");
}

/**
 * "Freeform" mode: the model paints pixels directly, restricted to the kit's
 * palette; result is then run through the enforcement pass (outline etc).
 */
export async function aiPixels(_args: { prompt: string; category: Category; w: number; h: number; kit: StyleKit }): Promise<PixelsResult> {
  throw new Error("AI not implemented");
}

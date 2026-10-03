// The interchange format shared by the web app (library export/import), the
// CLI and the MCP server. One JSON file holds kits + assets; sprites store
// palette indices, so a project re-colours itself when a kit changes.
import { DEFAULT_KIT, KIT_PRESETS } from "./kit";
import { PALETTE_SIZE } from "./palette";
import type { Asset, Category, Sprite, StyleKit } from "./types";
import { CATEGORIES } from "./types";

export const PROJECT_FORMAT = "pixel-builder/project";
export const PROJECT_VERSION = 1;

export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  activeKitId: string;
  kits: StyleKit[];
  assets: Asset[];
}

export function emptyProject(): ProjectFile {
  return { format: PROJECT_FORMAT, version: PROJECT_VERSION, activeKitId: DEFAULT_KIT.id, kits: KIT_PRESETS.map((k) => ({ ...k })), assets: [] };
}

export function serializeProject(p: ProjectFile): string {
  return JSON.stringify(p, null, 2);
}

const CATEGORY_IDS = new Set<Category>(CATEGORIES.map((c) => c.id));

function isSprite(s: unknown): s is Sprite {
  const o = s as Sprite;
  return (
    !!o &&
    Number.isInteger(o.w) && Number.isInteger(o.h) && o.w > 0 && o.h > 0 && o.w <= 1024 && o.h <= 1024 &&
    Array.isArray(o.data) && o.data.length === o.w * o.h &&
    o.data.every((v) => Number.isInteger(v) && v >= 0 && v < PALETTE_SIZE)
  );
}

function isAsset(a: unknown): a is Asset {
  const o = a as Asset;
  return (
    !!o && typeof o.id === "string" && typeof o.name === "string" && CATEGORY_IDS.has(o.category) &&
    Array.isArray(o.rows) && o.rows.length > 0 &&
    o.rows.every((r) => r && typeof r.name === "string" && Array.isArray(r.frames) && r.frames.length > 0 && r.frames.every(isSprite))
  );
}

function isKit(k: unknown): k is StyleKit {
  const o = k as StyleKit;
  return !!o && typeof o.id === "string" && typeof o.name === "string" && typeof o.paletteId === "string" && !!o.sizes;
}

/**
 * Parse and validate a project file. Invalid assets/kits are dropped (and
 * reported) rather than failing the whole import; missing kit fields are
 * filled from the default kit so older files keep loading.
 */
export function parseProject(json: string): { project: ProjectFile; warnings: string[] } {
  const warnings: string[] = [];
  let raw: Partial<ProjectFile>;
  try {
    raw = JSON.parse(json);
  } catch (e) {
    throw new Error(`Not valid JSON: ${(e as Error).message}`);
  }
  if (!raw || typeof raw !== "object") throw new Error("Project file must be a JSON object");
  if (raw.format !== undefined && raw.format !== PROJECT_FORMAT) throw new Error(`Unknown format "${String(raw.format)}"`);
  if ((raw.version ?? 1) > PROJECT_VERSION) warnings.push(`File version ${raw.version} is newer than supported ${PROJECT_VERSION}; loading what we can.`);

  const kits: StyleKit[] = [];
  for (const k of Array.isArray(raw.kits) ? raw.kits : []) {
    if (isKit(k)) kits.push({ ...DEFAULT_KIT, ...k, sizes: { ...DEFAULT_KIT.sizes, ...k.sizes }, rampOverrides: k.rampOverrides ?? {} });
    else warnings.push("Dropped an invalid kit");
  }
  if (!kits.length) kits.push(...KIT_PRESETS.map((k) => ({ ...k })));

  const assets: Asset[] = [];
  for (const a of Array.isArray(raw.assets) ? raw.assets : []) {
    if (isAsset(a)) assets.push({ ...a, tags: Array.isArray(a.tags) ? a.tags : [], fps: a.fps || 6 });
    else warnings.push(`Dropped invalid asset ${(a as Asset)?.name ?? (a as Asset)?.id ?? "?"}`);
  }

  const activeKitId = kits.some((k) => k.id === raw.activeKitId) ? raw.activeKitId! : kits[0].id;
  return { project: { format: PROJECT_FORMAT, version: PROJECT_VERSION, activeKitId, kits, assets }, warnings };
}

/** Merge `incoming` into `base`: kits/assets with the same id are replaced, new ones appended. */
export function mergeProjects(base: ProjectFile, incoming: ProjectFile): ProjectFile {
  const byId = <T extends { id: string }>(a: T[], b: T[]) => {
    const m = new Map(a.map((x) => [x.id, x]));
    for (const x of b) m.set(x.id, x);
    return [...m.values()];
  };
  return { ...base, kits: byId(base.kits, incoming.kits), assets: byId(base.assets, incoming.assets) };
}

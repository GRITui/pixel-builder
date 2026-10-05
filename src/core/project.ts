// The interchange format shared by the web app (library export/import), the
// CLI and the MCP server. One JSON file holds kits + assets; sprites store
// palette indices, so a project re-colours itself when a kit changes.
import { ALL_KIT_PRESETS, DEFAULT_KIT } from "./kit";
import { PALETTE_SIZE_ALL } from "./palette";
import type { Attachment, Clip, RigDef } from "./rig";
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
  /** Agent/user-authored rig parts; resolved after the built-in registry (src/core/rigs). Optional: old files lack them. */
  rigs?: RigDef[];
  clips?: Clip[];
  attachments?: Attachment[];
}

export function emptyProject(): ProjectFile {
  return { format: PROJECT_FORMAT, version: PROJECT_VERSION, activeKitId: DEFAULT_KIT.id, kits: ALL_KIT_PRESETS.map((k) => ({ ...k })), assets: [] };
}

/**
 * Pretty enough to diff, compact enough to share: kits are indented, each
 * asset is one line (sprite data arrays would otherwise put every number on
 * its own line and make files ~7x larger). Output is plain JSON.
 */
export function serializeProject(p: ProjectFile): string {
  const kits = JSON.stringify(p.kits, null, 2).replace(/\n/g, "\n  ");
  const assets = p.assets.map((a) => `    ${JSON.stringify(a)}`).join(",\n");
  const extra = (["rigs", "clips", "attachments"] as const)
    .filter((k) => p[k]?.length)
    .map((k) => `,\n  "${k}": [\n${p[k]!.map((x) => `    ${JSON.stringify(x)}`).join(",\n")}\n  ]`)
    .join("");
  return `{\n  "format": ${JSON.stringify(p.format)},\n  "version": ${p.version},\n  "activeKitId": ${JSON.stringify(p.activeKitId)},\n  "kits": ${kits},\n  "assets": [${assets ? `\n${assets}\n  ` : ""}]${extra}\n}\n`;
}

const CATEGORY_IDS = new Set<Category>(CATEGORIES.map((c) => c.id));

function isSprite(s: unknown): s is Sprite {
  const o = s as Sprite;
  return (
    !!o &&
    Number.isInteger(o.w) && Number.isInteger(o.h) && o.w > 0 && o.h > 0 && o.w <= 1024 && o.h <= 1024 &&
    Array.isArray(o.data) && o.data.length === o.w * o.h &&
    o.data.every((v) => Number.isInteger(v) && v >= 0 && v < PALETTE_SIZE_ALL)
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
  if (!kits.length) kits.push(...ALL_KIT_PRESETS.map((k) => ({ ...k })));

  const assets: Asset[] = [];
  for (const a of Array.isArray(raw.assets) ? raw.assets : []) {
    if (isAsset(a)) assets.push({ ...a, tags: Array.isArray(a.tags) ? a.tags : [], fps: a.fps || 6 });
    else warnings.push(`Dropped invalid asset ${(a as Asset)?.name ?? (a as Asset)?.id ?? "?"}`);
  }

  const lib = <T extends { id: string }>(key: "rigs" | "clips" | "attachments", ok: (x: any) => boolean): T[] | undefined => {
    const v = (raw as Record<string, unknown>)[key];
    if (!Array.isArray(v)) return undefined;
    const out = v.filter((x) => {
      const good = !!x && typeof x === "object" && typeof x.id === "string" && ok(x);
      if (!good) warnings.push(`Dropped invalid ${key.slice(0, -1)} ${(x as { id?: string })?.id ?? "?"}`);
      return good;
    });
    return out.length ? (out as T[]) : undefined;
  };
  const rigs = lib<RigDef>("rigs", (x) => Array.isArray(x.joints) && Array.isArray(x.parts));
  const clips = lib<Clip>("clips", (x) => x.frames && typeof x.frames === "object");
  const attachments = lib<Attachment>("attachments", (x) => Array.isArray(x.parts));

  const activeKitId = kits.some((k) => k.id === raw.activeKitId) ? raw.activeKitId! : kits[0].id;
  return { project: { format: PROJECT_FORMAT, version: PROJECT_VERSION, activeKitId, kits, assets, ...(rigs ? { rigs } : {}), ...(clips ? { clips } : {}), ...(attachments ? { attachments } : {}) }, warnings };
}

/** Merge `incoming` into `base`: kits/assets with the same id are replaced, new ones appended. */
export function mergeProjects(base: ProjectFile, incoming: ProjectFile): ProjectFile {
  const byId = <T extends { id: string }>(a: T[], b: T[]) => {
    const m = new Map(a.map((x) => [x.id, x]));
    for (const x of b) m.set(x.id, x);
    return [...m.values()];
  };
  const out: ProjectFile = { ...base, kits: byId(base.kits, incoming.kits), assets: byId(base.assets, incoming.assets) };
  for (const k of ["rigs", "clips", "attachments"] as const)
    if (base[k]?.length || incoming[k]?.length) (out as any)[k] = byId<{ id: string }>(base[k] ?? [], incoming[k] ?? []);
  return out;
}

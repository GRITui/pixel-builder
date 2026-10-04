// App state hooks persisted to localStorage (`pixel-builder:v1:*`).
// Every storage access is wrapped in try/catch and tolerates missing / corrupt data.
import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_KIT, newId } from "../core/kit";
import { emptyProject, mergeProjects, PROJECT_FORMAT, PROJECT_VERSION, type ProjectFile } from "../core/project";
import type { Attachment, Clip, RigDef } from "../core/rig";
import type { Asset, Sprite, StyleKit } from "../core/types";

const PREFIX = "pixel-builder:v1:";
export const STORAGE_ERROR_EVENT = "pixel-builder:storage-error";

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch (e) {
    console.warn("pixel-builder: could not persist", key, e);
    try {
      window.dispatchEvent(new CustomEvent(STORAGE_ERROR_EVENT, { detail: key }));
    } catch {
      /* ignore */
    }
  }
}

function readJSON<T>(key: string): T | undefined {
  const raw = readRaw(key);
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

// ---------- compact (de)serialisation of sprites ----------
// Sprite data is an array of small ints; packing it into a string keeps big maps
// well inside the localStorage quota. Unpacking also accepts plain arrays.

const PACK_OFFSET = 35;

function packData(data: number[] | string): string {
  if (typeof data === "string") return data;
  let s = "";
  for (let i = 0; i < data.length; i += 4096) s += String.fromCharCode(...data.slice(i, i + 4096).map((v) => v + PACK_OFFSET));
  return s;
}

function unpackData(data: unknown, len: number): number[] {
  if (Array.isArray(data)) return data.map((v) => (Number.isFinite(v) ? (v as number) : 0));
  const out: number[] = new Array(len).fill(0);
  if (typeof data === "string") for (let i = 0; i < len && i < data.length; i++) out[i] = data.charCodeAt(i) - PACK_OFFSET;
  return out;
}

type Packed<T> = T extends Sprite ? Omit<Sprite, "data"> & { data: string | number[] } : T;

function mapSprites(a: Asset, fn: (s: Sprite) => Sprite): Asset {
  return {
    ...a,
    rows: a.rows.map((r) => ({ ...r, frames: r.frames.map(fn) })),
    tilemap: a.tilemap ? { ...a.tilemap, tiles: a.tilemap.tiles.map((t) => ({ ...t, sprite: fn(t.sprite) })) } : undefined,
  };
}

export function packAsset(a: Asset): unknown {
  return mapSprites(a, (s) => ({ ...s, data: packData(s.data) as unknown as number[] }) as Packed<Sprite> as Sprite);
}

function validSprite(s: any): boolean {
  return !!s && Number.isInteger(s.w) && Number.isInteger(s.h) && s.w > 0 && s.h > 0 && (typeof s.data === "string" || Array.isArray(s.data));
}

/** Returns a safe Asset or null when the record is unusable. */
export function unpackAsset(raw: any): Asset | null {
  try {
    if (!raw || typeof raw.id !== "string" || !Array.isArray(raw.rows) || raw.rows.length === 0) return null;
    for (const r of raw.rows) if (!r || !Array.isArray(r.frames) || r.frames.length === 0 || !r.frames.every(validSprite)) return null;
    if (raw.tilemap && !(Array.isArray(raw.tilemap.tiles) && raw.tilemap.tiles.every((t: any) => validSprite(t?.sprite)))) return null;
    const fix = (s: Sprite): Sprite => ({ w: s.w, h: s.h, data: unpackData(s.data, s.w * s.h) });
    const a = mapSprites(raw as Asset, fix);
    const now = Date.now();
    return {
      ...a,
      name: typeof a.name === "string" ? a.name : "Untitled",
      category: a.category ?? "object",
      kitId: a.kitId ?? DEFAULT_KIT.id,
      fps: Number.isFinite(a.fps) && a.fps > 0 ? a.fps : 6,
      source: a.source ?? { kind: "manual" },
      tags: Array.isArray(a.tags) ? a.tags.filter((t) => typeof t === "string") : [],
      createdAt: a.createdAt ?? now,
      updatedAt: a.updatedAt ?? now,
    };
  } catch {
    return null;
  }
}

export function normalizeKit(raw: any): StyleKit | null {
  if (!raw || typeof raw.id !== "string") return null;
  return {
    ...DEFAULT_KIT,
    ...raw,
    name: typeof raw.name === "string" ? raw.name : "Kit",
    rampOverrides: raw.rampOverrides && typeof raw.rampOverrides === "object" ? raw.rampOverrides : {},
    sizes: { ...DEFAULT_KIT.sizes, ...(raw.sizes ?? {}) },
  };
}

// ---------- generic persisted state ----------

export function usePersisted<T>(
  key: string,
  initial: () => T,
  revive?: (raw: unknown) => T | undefined,
  serialize?: (v: T) => unknown,
): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    const raw = readJSON<unknown>(key);
    if (raw !== undefined) {
      const v = revive ? revive(raw) : (raw as T);
      if (v !== undefined) return v;
    }
    return initial();
  });
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    writeRaw(key, JSON.stringify(serialize ? serialize(value) : value));
  }, [key, value]); // eslint-disable-line react-hooks/exhaustive-deps
  return [value, setValue];
}

// ---------- project (kits + active kit + assets) ----------
// The persisted state is exactly a ProjectFile (src/core/project.ts); only the
// storage encoding packs sprite data into strings to stay inside the quota.

export interface KitsApi {
  kits: StyleKit[];
  active: StyleKit;
  setActive: (id: string) => void;
  /** Insert or replace by id. */
  upsert: (kit: StyleKit) => void;
  duplicate: (id: string) => StyleKit | null;
  remove: (id: string) => void;
}

export interface LibraryApi {
  assets: Asset[];
  add: (a: Asset) => void;
  /** Replace by id (or add when unknown); bumps updatedAt. */
  update: (a: Asset) => void;
  patch: (id: string, p: Partial<Asset>) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => Asset | null;
}

export interface ProjectApi {
  project: ProjectFile;
  kits: KitsApi;
  library: LibraryApi;
  /** Custom rig clips stored on the project (`ProjectFile.clips`, optional). */
  clips: Clip[];
  /** Rigs and attachments stored on the project (e.g. created by agents via MCP). */
  customRigs: RigDef[];
  customAttachments: Attachment[];
  addClip: (c: Clip) => void;
  /** Store an AI-authored rig, attachments and clips on the project (same id replaces). */
  addAuthored: (a: { rig?: RigDef; attachments?: Attachment[]; clips?: Clip[] }) => void;
  replaceProject: (p: ProjectFile) => void;
  mergeProject: (p: ProjectFile) => void;
}

function revive(raw: any): ProjectFile | undefined {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.kits) || !Array.isArray(raw.assets)) return undefined;
  const kits = raw.kits.map(normalizeKit).filter((k: StyleKit | null): k is StyleKit => !!k);
  if (!kits.length) return undefined;
  const assets = raw.assets.map(unpackAsset).filter((a: Asset | null): a is Asset => !!a);
  const activeKitId = kits.some((k: StyleKit) => k.id === raw.activeKitId) ? raw.activeKitId : kits[0].id;
  const out: ProjectFile = { format: PROJECT_FORMAT, version: PROJECT_VERSION, activeKitId, kits, assets };
  // optional rig arrays are owned by core/project.ts; keep whatever valid ones are stored
  const extra = out as unknown as Record<string, unknown>;
  if (Array.isArray(raw.clips)) extra.clips = raw.clips.filter((c: any) => c && typeof c.id === "string" && Number.isFinite(c.fps) && c.frames);
  if (Array.isArray(raw.rigs)) extra.rigs = raw.rigs;
  if (Array.isArray(raw.attachments)) extra.attachments = raw.attachments;
  return out;
}

export function useProject(): ProjectApi {
  const [project, setProject] = usePersisted<ProjectFile>("project", emptyProject, revive, (p) => ({ ...p, assets: p.assets.map(packAsset) }));
  const active = project.kits.find((k) => k.id === project.activeKitId) ?? project.kits[0];

  const setKits = useCallback((fn: (ks: StyleKit[]) => StyleKit[]) => setProject((p) => ({ ...p, kits: fn(p.kits) })), [setProject]);
  const setAssets = useCallback((fn: (as: Asset[]) => Asset[]) => setProject((p) => ({ ...p, assets: fn(p.assets) })), [setProject]);

  const kits: KitsApi = {
    kits: project.kits,
    active,
    setActive: (id) => setProject((p) => (p.kits.some((k) => k.id === id) ? { ...p, activeKitId: id } : p)),
    upsert: (kit) => setKits((ks) => (ks.some((k) => k.id === kit.id) ? ks.map((k) => (k.id === kit.id ? kit : k)) : [...ks, kit])),
    duplicate: (id) => {
      const src = project.kits.find((k) => k.id === id);
      if (!src) return null;
      const copy: StyleKit = { ...JSON.parse(JSON.stringify(src)), id: newId("kit"), name: `${src.name} copy` };
      setProject((p) => ({ ...p, kits: [...p.kits, copy], activeKitId: copy.id }));
      return copy;
    },
    remove: (id) =>
      setProject((p) => {
        if (p.kits.length <= 1) return p;
        const rest = p.kits.filter((k) => k.id !== id);
        return { ...p, kits: rest, activeKitId: p.activeKitId === id ? rest[0].id : p.activeKitId };
      }),
  };

  const library: LibraryApi = {
    assets: project.assets,
    add: (a) => setAssets((as) => [a, ...as.filter((x) => x.id !== a.id)]),
    update: (a) => setAssets((as) => (as.some((x) => x.id === a.id) ? as.map((x) => (x.id === a.id ? { ...a, updatedAt: Date.now() } : x)) : [a, ...as])),
    patch: (id, patch) => setAssets((as) => as.map((x) => (x.id === id ? { ...x, ...patch, updatedAt: Date.now() } : x))),
    remove: (id) => setAssets((as) => as.filter((x) => x.id !== id)),
    duplicate: (id) => {
      const src = project.assets.find((a) => a.id === id);
      if (!src) return null;
      const now = Date.now();
      const copy: Asset = { ...JSON.parse(JSON.stringify(src)), id: newId("asset"), name: `${src.name} copy`, createdAt: now, updatedAt: now };
      setAssets((as) => [copy, ...as]);
      return copy;
    },
  };

  const clips = (project as unknown as { clips?: Clip[] }).clips ?? [];
  const customRigs = project.rigs ?? [];
  const customAttachments = project.attachments ?? [];
  const addClip = (c: Clip) =>
    setProject((p) => {
      const list = (p as unknown as { clips?: Clip[] }).clips ?? [];
      return { ...p, clips: [...list.filter((x) => x.id !== c.id), c] } as ProjectFile;
    });

  const upsertById = <T extends { id: string }>(list: T[] | undefined, add: T[]): T[] => [...(list ?? []).filter((x) => !add.some((a) => a.id === x.id)), ...add];
  const addAuthored: ProjectApi["addAuthored"] = (a) =>
    setProject((p) => {
      const next = { ...p } as ProjectFile & { clips?: Clip[] };
      if (a.rig) next.rigs = upsertById(p.rigs, [a.rig]);
      if (a.attachments?.length) next.attachments = upsertById(p.attachments, a.attachments);
      if (a.clips?.length) next.clips = upsertById((p as ProjectFile & { clips?: Clip[] }).clips, a.clips);
      return next;
    });

  return {
    project,
    kits,
    library,
    clips,
    customRigs,
    customAttachments,
    addClip,
    addAuthored,
    replaceProject: setProject,
    mergeProject: (incoming) => setProject((p) => mergeProjects(p, incoming)),
  };
}

// ---------- small persisted UI prefs ----------

export function usePref<T extends string | number | boolean>(key: string, initial: T): [T, (v: T) => void] {
  const [v, set] = usePersisted<T>(`pref:${key}`, () => initial, (raw) => (typeof raw === typeof initial ? (raw as T) : undefined));
  return [v, set];
}

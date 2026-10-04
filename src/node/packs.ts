// Asset packs: named lists of generate_asset / generate_rigged calls that build a
// starter set in one go (generate_pack). Entries are plain tool inputs, so a pack is
// exactly what an agent would have typed, and it stays reproducible (fixed seeds).

export interface PackEntryProcedural {
  name: string;
  generator: string;
  params?: Record<string, string | number | boolean>;
  seed?: number;
  /** Free-form labels for `only` filtering (e.g. "sea", "normal", "tool"). */
  tags?: string[];
}

export interface PackEntryRigged {
  name: string;
  rig: string;
  slots?: Record<string, string>;
  attachments?: string[];
  clips?: string[];
  tags?: string[];
}

export type PackEntry = PackEntryProcedural | PackEntryRigged;

export interface PackManifest {
  id: string;
  name: string;
  description: string;
  entries: PackEntry[];
}

export const isRigged = (e: PackEntry): e is PackEntryRigged => "rig" in e;

export const PACKS: PackManifest[] = [];

export const packById = (id: string) => PACKS.find((p) => p.id === id);

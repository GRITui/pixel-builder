// Project storage for the shared team library. `Store` is the seam: a filesystem
// implementation ships today; anything with get/put/list/delete (S3, SQLite) can replace it.
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseProject, serializeProject, type ProjectFile } from "../src/core/project";

export class ConflictError extends Error {
  constructor(public readonly currentEtag: string | null) {
    super("The project changed since you loaded it (stale ETag).");
    this.name = "ConflictError";
  }
}

export class InvalidIdError extends Error {
  constructor(id: string) {
    super(`Invalid project id '${id.slice(0, 40)}': use 1-64 characters from a-z, 0-9, '-' and '_', starting with a letter or digit.`);
    this.name = "InvalidIdError";
  }
}

export interface ProjectInfo {
  id: string;
  etag: string;
  bytes: number;
  updatedAt: number;
}

export interface Store {
  get(id: string): Promise<{ project: ProjectFile; etag: string; text: string } | null>;
  /** Writes the project; with `ifMatch` the write only succeeds if the stored etag equals it (else ConflictError). */
  put(id: string, project: ProjectFile, ifMatch?: string): Promise<string>;
  list(): Promise<ProjectInfo[]>;
  delete(id: string): Promise<boolean>;
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
export const isValidId = (id: string): boolean => ID_RE.test(id);
export function assertId(id: string): string {
  if (!isValidId(id)) throw new InvalidIdError(id);
  return id;
}

/** ETag = quoted content hash (strong validator). */
export const etagOf = (text: string): string => `"${createHash("sha256").update(text).digest("hex").slice(0, 32)}"`;
const stripEtag = (v: string): string => v.trim().replace(/^W\//, "");

export class FsStore implements Store {
  readonly dir: string;
  private locks = new Map<string, Promise<unknown>>();

  constructor(dir = process.env.PIXEL_BUILDER_DATA || "pixel-data") {
    this.dir = resolve(dir);
    mkdirSync(this.dir, { recursive: true });
  }

  private path(id: string): string {
    return join(this.dir, `${assertId(id)}.json`);
  }

  /** Serialise read-check-write per id inside this process so two writers cannot both pass the etag check. */
  private async locked<T>(id: string, fn: () => T): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(id, next.catch(() => undefined));
    return next;
  }

  private read(id: string): { text: string; etag: string } | null {
    try {
      const text = readFileSync(this.path(id), "utf8");
      return { text, etag: etagOf(text) };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async get(id: string) {
    assertId(id);
    const r = this.read(id);
    if (!r) return null;
    return { project: parseProject(r.text).project, etag: r.etag, text: r.text };
  }

  async put(id: string, project: ProjectFile, ifMatch?: string): Promise<string> {
    assertId(id);
    const text = serializeProject(project);
    return this.locked(id, () => {
      const cur = this.read(id);
      if (ifMatch !== undefined && ifMatch !== "*" && (!cur || stripEtag(ifMatch) !== cur.etag)) throw new ConflictError(cur?.etag ?? null);
      if (ifMatch === "*" && !cur) throw new ConflictError(null);
      const path = this.path(id);
      const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
      try {
        writeFileSync(tmp, text);
        renameSync(tmp, path);
      } catch (e) {
        rmSync(tmp, { force: true });
        throw e;
      }
      return etagOf(text);
    });
  }

  async list(): Promise<ProjectInfo[]> {
    const out: ProjectInfo[] = [];
    for (const f of readdirSync(this.dir)) {
      const id = f.endsWith(".json") ? f.slice(0, -5) : "";
      if (!isValidId(id)) continue;
      const st = statSync(join(this.dir, f));
      const r = this.read(id);
      if (r) out.push({ id, etag: r.etag, bytes: st.size, updatedAt: Math.round(st.mtimeMs) });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  async delete(id: string): Promise<boolean> {
    assertId(id);
    return this.locked(id, () => {
      if (!this.read(id)) return false;
      rmSync(this.path(id), { force: true });
      return true;
    });
  }
}

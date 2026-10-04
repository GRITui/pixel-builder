// Remote (shared library) workspace: the project lives on a pixel-builder server at
// `http(s)://host/api/projects/<id>`; exports still go to a local directory.
import { emptyProject, parseProject, type ProjectFile } from "../core/project";
import { ToolError, Workspace, serializeProjectCompact } from "./workspace";

export const isRemoteSpec = (spec?: string): boolean => !!spec && /^https?:\/\//i.test(spec);

/**
 * Tools stay synchronous: `pull()` fetches the project into a local cache before a tool runs,
 * `load()`/`save()` work on that cache, and `push()` writes it back with If-Match afterwards
 * (409 -> ToolError, nothing overwritten). Wired in by callToolAsync.
 */
export class RemoteWorkspace extends Workspace {
  readonly url: string;
  private etag: string | null = null;
  private text: string | null = null;
  private dirty = false;

  constructor(url: string, outDir?: string, private readonly token: string | undefined = process.env.PIXEL_BUILDER_TOKEN || undefined) {
    super(outDir || process.env.PIXEL_BUILDER_OUT_DIR || undefined);
    this.url = url.replace(/\/+$/, "");
    if (!/\/api\/projects\/[^/]+$/.test(this.url)) throw new ToolError(`Remote workspace must look like http(s)://host/api/projects/<id>, got '${url}'.`);
  }

  get projectPath(): string {
    return this.url;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { ...(this.token ? { authorization: `Bearer ${this.token}` } : {}), ...extra };
  }

  private async request(init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(this.url, init);
    } catch (e) {
      throw new ToolError(`Cannot reach ${this.url}: ${(e as Error).message}. Is the server running and the URL right?`);
    }
    if (res.status === 401) throw new ToolError(`${this.url} rejected the token (401). Set PIXEL_BUILDER_TOKEN to the server's token.`);
    return res;
  }

  private chain: Promise<unknown> = Promise.resolve();
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  async pull(): Promise<void> {
    const res = await this.request({ headers: this.headers() });
    this.dirty = false;
    if (res.status === 404) {
      this.text = null;
      this.etag = null;
      return;
    }
    if (!res.ok) throw new ToolError(`GET ${this.url} failed: HTTP ${res.status}.`);
    this.text = await res.text();
    this.etag = res.headers.get("etag");
  }

  load(): ProjectFile {
    this.warnings = [];
    if (this.text === null) return emptyProject();
    const { project, warnings } = parseProject(this.text);
    this.warnings = warnings;
    return project;
  }

  save(project: ProjectFile): void {
    this.text = serializeProjectCompact(project);
    this.dirty = true;
  }

  async push(): Promise<void> {
    if (!this.dirty || this.text === null) return;
    const res = await this.request({ method: "PUT", headers: this.headers({ "content-type": "application/json", ...(this.etag ? { "if-match": this.etag } : {}) }), body: this.text });
    if (res.status === 409) throw new ToolError("The shared project changed while this tool ran (409). Nothing was overwritten; re-run the tool to apply it to the latest version.");
    if (!res.ok) throw new ToolError(`PUT ${this.url} failed: HTTP ${res.status}.`);
    this.etag = res.headers.get("etag");
    this.dirty = false;
  }
}

/** `spec` is a directory or an `http(s)://.../api/projects/<id>` URL (default: $PIXEL_BUILDER_WORKSPACE). */
export function openWorkspace(spec?: string, outDir?: string): Workspace {
  const s = spec || process.env.PIXEL_BUILDER_WORKSPACE;
  return isRemoteSpec(s) ? new RemoteWorkspace(s!, outDir) : new Workspace(spec);
}

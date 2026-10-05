import { useMemo, useRef, useState } from "react";
import { CATEGORIES, type Asset, type Category, type Reference, type StyleKit } from "../../core/types";
import type { FlatPalette } from "../render";
import { AssetCard, canRerender } from "./AssetCard";

export interface LibraryActions {
  edit: (a: Asset) => void;
  load: (a: Asset) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => void;
  tags: (id: string, tags: string[]) => void;
  rerender: (a: Asset) => void;
  toggleRef: (id: string) => void;
  error: (m: string) => void;
}

interface ListProps {
  assets: Asset[];
  kit: StyleKit;
  kits: StyleKit[];
  pal: FlatPalette;
  actions: LibraryActions;
  refIds: string[];
  /** Reference library, to resolve each asset's meta.referenceId for the compare view. */
  references?: Reference[];
  variant: "compact" | "full";
}

function matches(a: Asset, q: string): boolean {
  if (!q) return true;
  const s = q.toLowerCase();
  return a.name.toLowerCase().includes(s) || a.tags.some((t) => t.includes(s)) || a.category.includes(s);
}

function Cards({ assets, kit, kits, pal, actions, refIds, references, variant }: ListProps) {
  return (
    <div className={`lib-grid ${variant}`}>
      {assets.map((a) => (
        <AssetCard
          key={a.id}
          asset={a}
          kit={kit}
          kitName={kits.find((k) => k.id === a.kitId)?.name}
          pal={pal}
          variant={variant}
          reference={references?.find((r) => r.id === a.meta?.referenceId)}
          isRef={refIds.includes(a.id)}
          refFull={refIds.length >= 2}
          onToggleRef={() => actions.toggleRef(a.id)}
          onEdit={() => actions.edit(a)}
          onLoad={() => actions.load(a)}
          onRename={(n) => actions.rename(a.id, n)}
          onDelete={() => actions.remove(a.id)}
          onDuplicate={() => actions.duplicate(a.id)}
          onTags={(t) => actions.tags(a.id, t)}
          onRerender={() => actions.rerender(a)}
          onError={actions.error}
        />
      ))}
    </div>
  );
}

/** Right-hand strip: library filtered to the current category. */
export function LibraryStrip(props: Omit<ListProps, "variant"> & { category: Category; onOpenLibrary: () => void }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => props.assets.filter((a) => a.category === props.category && matches(a, q)), [props.assets, props.category, q]);
  const label = CATEGORIES.find((c) => c.id === props.category)?.label;
  return (
    <aside className="strip" aria-label={`${label} library`}>
      <div className="strip-head">
        <h3 className="card-title">{label} library</h3>
        <button className="ghost" onClick={props.onOpenLibrary} title="Open the full library">
          All ›
        </button>
      </div>
      <input type="search" placeholder="Search…" aria-label="Search library" value={q} onChange={(e) => setQ(e.target.value)} />
      {list.length === 0 ? (
        <p className="empty">{q ? "No matches." : `Nothing saved yet. Generate something and press “Save to library”.`}</p>
      ) : (
        <Cards {...props} assets={list} variant="compact" />
      )}
    </aside>
  );
}

/** Full library page: filters, bulk re-render, project export / import. */
export function LibraryView(
  props: Omit<ListProps, "variant"> & {
    onExportAll: () => void;
    onImportFile: (f: File) => void;
    onRerenderAll: () => void;
  },
) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Category | "all">("all");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState<"new" | "name">("new");
  const file = useRef<HTMLInputElement>(null);
  const allTags = useMemo(() => [...new Set(props.assets.flatMap((a) => a.tags))].sort(), [props.assets]);
  const list = useMemo(() => {
    const l = props.assets.filter((a) => (cat === "all" || a.category === cat) && (!tag || a.tags.includes(tag)) && matches(a, q));
    return sort === "name" ? [...l].sort((a, b) => a.name.localeCompare(b.name)) : [...l].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [props.assets, cat, tag, q, sort]);
  const procedural = props.assets.filter(canRerender).length;

  return (
    <div className="library-view">
      <div className="lib-bar">
        <input type="search" placeholder="Search name, tag or category…" aria-label="Search library" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg" role="group" aria-label="Filter by category">
          <button className={cat === "all" ? "on" : ""} onClick={() => setCat("all")}>
            All
          </button>
          {CATEGORIES.map((c) => (
            <button key={c.id} className={cat === c.id ? "on" : ""} onClick={() => setCat(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        <select aria-label="Filter by tag" value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">All tags</option>
          {allTags.map((t) => (
            <option key={t} value={t}>
              #{t}
            </option>
          ))}
        </select>
        <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as "new" | "name")}>
          <option value="new">Newest</option>
          <option value="name">Name</option>
        </select>
      </div>
      <div className="lib-bar">
        <span className="dim">
          {list.length} of {props.assets.length} assets
        </span>
        <span className="grow" />
        <button disabled={!procedural} onClick={props.onRerenderAll} title="Re-run every procedural asset with the current kit (hand-edited assets are skipped)">
          Re-render all with current kit ({procedural})
        </button>
        <button onClick={props.onExportAll} title="Download kits + library as pixel-builder.json">
          Export all JSON
        </button>
        <button onClick={() => file.current?.click()} title="Merge a pixel-builder.json into this library">
          Import JSON
        </button>
        <input
          ref={file}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) props.onImportFile(f);
          }}
        />
      </div>
      {list.length === 0 ? <p className="empty big">{props.assets.length ? "No assets match these filters." : "Your library is empty. Generate an asset and save it, or import a pixel-builder.json."}</p> : <Cards {...props} assets={list} variant="full" />}
    </div>
  );
}

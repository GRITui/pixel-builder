import { useState } from "react";
import { generatorById } from "../../core/generators";
import { CATEGORIES, type Asset, type Reference, type StyleKit } from "../../core/types";
import type { FlatPalette } from "../render";
import { CompareView } from "./CompareView";
import { ExportMenu } from "./ExportMenu";
import { AnimThumb } from "./SpriteView";

export function canRerender(a: Asset): boolean {
  if (a.source.kind === "rigged") return !!a.source.rig;
  return (a.source.kind === "procedural" || a.source.kind === "ai-vibe") && !!a.source.generator && !!generatorById(a.source.generator) && a.source.params !== undefined && a.source.seed !== undefined;
}

export interface AssetCardProps {
  asset: Asset;
  kit: StyleKit;
  kitName?: string;
  pal: FlatPalette;
  variant: "compact" | "full";
  /** The reference this asset was compared with (meta.referenceId), when it still exists. */
  reference?: Reference;
  isRef?: boolean;
  refFull?: boolean;
  onToggleRef?: () => void;
  onEdit: () => void;
  onLoad?: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onTags: (tags: string[]) => void;
  onRerender: () => void;
  onError: (m: string) => void;
}

function EditableName({ name, onRename }: { name: string; onRename: (n: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  if (!editing)
    return (
      <button
        className="name-btn"
        title="Click to rename"
        onClick={() => {
          setDraft(name);
          setEditing(true);
        }}
      >
        {name}
      </button>
    );
  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== name) onRename(draft.trim());
  };
  return (
    <input
      className="name-input"
      autoFocus
      aria-label="Asset name"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}

function TagEditor({ tags, onTags }: { tags: string[]; onTags: (t: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim().toLowerCase();
    setDraft("");
    if (t && !tags.includes(t)) onTags([...tags, t]);
  };
  return (
    <div className="tags">
      {tags.map((t) => (
        <span key={t} className="tag">
          {t}
          <button className="ghost" aria-label={`Remove tag ${t}`} onClick={() => onTags(tags.filter((x) => x !== t))}>
            ✕
          </button>
        </span>
      ))}
      <input
        className="tag-input"
        placeholder="+ tag"
        aria-label="Add tag"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
        onBlur={add}
      />
    </div>
  );
}

export function AssetCard(p: AssetCardProps) {
  const { asset: a } = p;
  const [confirmDel, setConfirmDel] = useState(false);
  const [comparing, setComparing] = useState(false);
  const score = typeof a.meta?.matchScore === "number" ? a.meta.matchScore : undefined;
  const full = p.variant === "full";
  const rerender = canRerender(a);
  const otherKit = a.kitId !== p.kit.id;
  const cat = CATEGORIES.find((c) => c.id === a.category)?.label ?? a.category;
  const meta = `${a.rows[0].frames[0].w}×${a.rows[0].frames[0].h}${a.rows.length > 1 || a.rows[0].frames.length > 1 ? ` · ${a.rows.length}r/${a.rows.reduce((n, r) => n + r.frames.length, 0)}f` : ""}`;
  const srcLabel = a.source.kind === "procedural" ? "procedural" : a.source.kind === "ai-vibe" ? "AI vibe" : a.source.kind === "ai-pixels" ? "AI pixels" : a.source.kind;

  return (
    <article className={`asset ${p.variant} ${p.isRef ? "is-ref" : ""}`}>
      <div className="asset-thumb">
        <AnimThumb rows={a.rows} fps={a.fps} pal={p.pal} size={full ? 112 : 72} />
      </div>
      <div className="asset-info">
        <EditableName name={a.name} onRename={p.onRename} />
        <div className="dim asset-meta">
          {full && <span>{cat} · </span>}
          {meta} · {srcLabel}
          {score !== undefined && (
            <span className="badge" title={`Style match against ${p.reference?.name ?? "its reference"} (0-100), from compare_to_reference`}>
              match {Math.round(score)}
            </span>
          )}
          {otherKit && (
            <span className="badge" title={`Made with “${p.kitName ?? "another kit"}”. Shown re-coloured with the current kit; re-render to match its look.`}>
              other kit
            </span>
          )}
        </div>
        {full && <TagEditor tags={a.tags} onTags={p.onTags} />}
        {!full && a.tags.length > 0 && <div className="dim tags-line">#{a.tags.join(" #")}</div>}
        <div className="asset-actions">
          <button onClick={p.onEdit} title="Open in editor">
            Edit
          </button>
          {!full && p.onToggleRef && (
            <button className={p.isRef ? "on" : ""} disabled={!p.isRef && p.refFull} onClick={p.onToggleRef} title={p.isRef ? "Remove from style references" : p.refFull ? "Two references already selected" : "Use as a style reference for Freeform pixels"}>
              Ref
            </button>
          )}
          {!full && p.onLoad && rerender && (
            <button onClick={p.onLoad} title="Load this asset's parameters and seed into the workspace">
              Load
            </button>
          )}
          {full && (
            <button onClick={p.onDuplicate} title="Duplicate">
              Duplicate
            </button>
          )}
          {rerender && (
            <button onClick={p.onRerender} title="Re-run the generator with this asset's params + seed using the current kit">
              Re-render
            </button>
          )}
          {p.reference && (
            <button className={comparing ? "on" : ""} onClick={() => setComparing(!comparing)} title="Compare with the reference (split slider)">
              Compare
            </button>
          )}
          <ExportMenu asset={a} kit={p.kit} onError={p.onError} label="Export" />
          {confirmDel ? (
            <>
              <button className="danger" onClick={p.onDelete}>
                Delete?
              </button>
              <button className="ghost" onClick={() => setConfirmDel(false)} aria-label="Cancel delete">
                ✕
              </button>
            </>
          ) : (
            <button className="ghost danger-text" onClick={() => setConfirmDel(true)} title="Delete">
              🗑
            </button>
          )}
        </div>
        {comparing && p.reference && <CompareView asset={a} reference={p.reference} pal={p.pal} />}
      </div>
    </article>
  );
}

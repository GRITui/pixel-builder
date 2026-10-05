import { useCallback, useEffect, useState } from "react";
import type { Reference } from "../../core/types";
import { refDataUrl, referenceFromBlob } from "../refs";
import { usePref } from "../store";

interface Props {
  references: Reference[];
  onAdd: (r: Reference) => void;
  onUpdate: (id: string, patch: Partial<Pick<Reference, "name" | "tags">>) => void;
  onRemove: (id: string) => void;
  onError: (msg: string) => void;
}

/**
 * Reference library: drop, paste or pick images; thumbnails with tags; delete; pin one
 * so it floats beside the editor/generator. Lives in the project, so it syncs like assets.
 */
export function ReferencesPanel({ references, onAdd, onUpdate, onRemove, onError }: Props) {
  const [open, setOpen] = usePref<boolean>("refs-open", false);
  const [pinned, setPinned] = usePref<string>("refs-pinned", "");
  const [over, setOver] = useState(false);
  const pin = references.find((r) => r.id === pinned);

  const addFiles = useCallback(
    async (files: Iterable<File | Blob>, source: Reference["source"]["kind"]) => {
      for (const f of files) {
        if (f.type && !f.type.startsWith("image/")) continue;
        try {
          const name = (f instanceof File && f.name ? f.name : "pasted image").replace(/\.[^.]+$/, "");
          onAdd(await referenceFromBlob(f, { name, source: { kind: source, value: source === "paste" ? "" : (f as File).name } }));
        } catch (e) {
          onError(e instanceof Error ? e.message : String(e));
        }
      }
    },
    [onAdd, onError],
  );

  // paste from clipboard anywhere (except into text fields) while the panel is open
  useEffect(() => {
    if (!open) return;
    const on = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        e.preventDefault();
        void addFiles(files, "paste");
      }
    };
    window.addEventListener("paste", on);
    return () => window.removeEventListener("paste", on);
  }, [open, addFiles]);

  return (
    <>
      {pin && (
        <figure style={{ position: "fixed", right: 16, top: 64, zIndex: 70, margin: 0, background: "var(--panel-2)", border: "1px solid var(--line-2)", borderRadius: 8, padding: 4, maxWidth: 220 }}>
          <img src={refDataUrl(pin)} alt={`Pinned reference: ${pin.name}`} style={{ display: "block", maxWidth: "100%", maxHeight: 220 }} />
          <figcaption style={{ fontSize: 11, display: "flex", justifyContent: "space-between", gap: 4 }}>
            <span>{pin.name}</span>
            <button onClick={() => setPinned("")} aria-label="Unpin reference">Unpin</button>
          </figcaption>
        </figure>
      )}
      <div style={{ position: "fixed", right: 16, bottom: 16, zIndex: 80 }}>
        {open && (
          <div
            role="region"
            aria-label="References"
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              void addFiles(e.dataTransfer.files, "path");
            }}
            style={{ width: 320, maxHeight: "60vh", overflow: "auto", marginBottom: 8, background: "var(--panel-2)", border: `1px ${over ? "dashed var(--accent)" : "solid var(--line-2)"}`, borderRadius: 8, padding: 10 }}
          >
            <div style={{ fontSize: 12, marginBottom: 8 }}>
              Drop images here, paste from the clipboard, or{" "}
              <label style={{ textDecoration: "underline", cursor: "pointer" }}>
                browse
                <input type="file" accept="image/*" multiple hidden onChange={(e) => { void addFiles(e.target.files ?? [], "path"); e.target.value = ""; }} />
              </label>
              . PNG, JPEG, WebP, GIF; up to 10 MB.
            </div>
            {!references.length && <div style={{ fontSize: 12, opacity: 0.7 }}>No references yet. Add a mood board for agents and generators.</div>}
            <div style={{ display: "grid", gap: 8 }}>
              {references.map((r) => (
                <div key={r.id} style={{ display: "grid", gridTemplateColumns: "72px 1fr", gap: 8, alignItems: "start" }}>
                  <img src={refDataUrl(r)} alt={r.name} style={{ width: 72, height: 72, objectFit: "contain", background: "#0002", borderRadius: 4 }} />
                  <div style={{ display: "grid", gap: 4, fontSize: 12 }}>
                    <input value={r.name} aria-label="Reference name" onChange={(e) => onUpdate(r.id, { name: e.target.value })} />
                    <input
                      defaultValue={r.tags.join(", ")}
                      key={r.tags.join(",")}
                      aria-label="Tags (comma separated)"
                      placeholder="tags, comma separated"
                      onBlur={(e) => onUpdate(r.id, { tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
                    />
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <span style={{ opacity: 0.7 }}>{r.width}x{r.height}</span>
                      <button onClick={() => setPinned(pinned === r.id ? "" : r.id)}>{pinned === r.id ? "Unpin" : "Pin"}</button>
                      <button onClick={() => onRemove(r.id)} aria-label={`Delete ${r.name}`}>Delete</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <button onClick={() => setOpen(!open)} aria-expanded={open}>References{references.length ? ` (${references.length})` : ""}</button>
      </div>
    </>
  );
}

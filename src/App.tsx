import { useCallback, useEffect, useMemo, useState } from "react";
import { CATEGORIES, type Asset, type Category, type StyleKit } from "./core/types";
import { coerceParams, generatorById, generatorFor } from "./core/generators";
import { CategoryNav, type View } from "./ui/components/CategoryNav";
import { KitEditor } from "./ui/components/KitEditor";
import { LibraryStrip, LibraryView, type LibraryActions } from "./ui/components/LibraryList";
import { TopBar } from "./ui/components/TopBar";
import { Toasts, useToasts } from "./ui/components/Toasts";
import { initRigSel } from "./ui/components/RiggedWorkspace";
import { Workspace, initWs, type WsState } from "./ui/components/Workspace";
import { rerenderAsset } from "./ui/components/rerender";
import { usePalette, useAiStatus } from "./ui/components/common";
import { canRerender } from "./ui/components/AssetCard";
import { exportProject, readProjectFile } from "./ui/exportAsset";
import { ImportDialog } from "./ui/ImportDialog";
import { ReferenceGenerate } from "./ui/components/ReferenceGenerate";
import { MapEditor } from "./ui/MapEditor";
import { PixelEditor } from "./ui/PixelEditor";
import { SyncBadge } from "./ui/components/SyncBadge";
import { ReferencesPanel } from "./ui/components/ReferencesPanel";
import { useRemoteSync } from "./ui/remote";
import { STORAGE_ERROR_EVENT, usePref, useProject } from "./ui/store";

const VIEWS = new Set<string>([...CATEGORIES.map((c) => c.id), "library"]);

export default function App() {
  const { project, kits, library, mergeProject, clips, customRigs, customAttachments, addClip, addAuthored, replaceProject, references, addReference, updateReference, removeReference } = useProject();
  const sync = useRemoteSync(project, replaceProject);
  const kit = kits.active;
  const pal = usePalette(kit);
  const { status, refresh } = useAiStatus();
  const { toasts, push, dismiss } = useToasts();

  const [viewPref, setViewPref] = usePref<string>("view", "character");
  const view: View = VIEWS.has(viewPref) ? (viewPref as View) : "character";
  const [wsMap, setWsMap] = useState<Record<Category, WsState>>(() => Object.fromEntries(CATEGORIES.map((c) => [c.id, initWs(generatorFor(c.id))])) as Record<Category, WsState>);
  const [refIds, setRefIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [importing, setImporting] = useState(false);
  const [genRef, setGenRef] = useState<string | null>(null);
  const [kitOpen, setKitOpen] = useState(false);

  useEffect(() => {
    const on = () => push("Browser storage is full or blocked: changes may not persist. Use Library › Export all JSON to back up.", "error");
    window.addEventListener(STORAGE_ERROR_EVENT, on);
    return () => window.removeEventListener(STORAGE_ERROR_EVENT, on);
  }, [push]);

  const updateWs = useCallback((c: Category, fn: (w: WsState) => WsState) => setWsMap((m) => ({ ...m, [c]: fn(m[c]) })), []);
  const refs = useMemo(() => refIds.map((id) => library.assets.find((a) => a.id === id)).filter((a): a is Asset => !!a), [refIds, library.assets]);
  const error = useCallback((m: string) => push(m, "error"), [push]);

  const saveAsset = (a: Asset) => {
    library.add(a);
    push(`Saved “${a.name}” to the library.`);
  };

  /** Hand-edited pixels can't be regenerated, so mark such assets as manual. */
  const onEditorSave = (a: Asset) => {
    const orig = editing;
    const changed = !orig || JSON.stringify(orig.rows) !== JSON.stringify(a.rows) || JSON.stringify(orig.tilemap) !== JSON.stringify(a.tilemap);
    const next: Asset = changed && (a.source.kind === "procedural" || a.source.kind === "ai-vibe") ? { ...a, source: { ...a.source, kind: "manual" } } : a;
    library.update(next);
    setEditing(next);
    push(`Saved “${next.name}”.`);
  };

  const rerender = (a: Asset) => {
    try {
      library.update(rerenderAsset(a, kit));
      push(`Re-rendered “${a.name}” with ${kit.name}.`);
    } catch (e) {
      error(`Re-render failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const actions: LibraryActions = {
    edit: setEditing,
    load: (a) => {
      const recipe = a.source.kind === "rigged" ? a.source.rig : undefined;
      if (recipe && typeof recipe.rig === "string") {
        updateWs("character", (w) => ({
          ...w,
          rigMode: true,
          name: a.name,
          rig: { ...initRigSel(), rigId: recipe.rig as string, slots: recipe.slots ?? {}, attachments: (recipe.attachments ?? []).filter((x): x is string => typeof x === "string"), clips: recipe.clips.map((c) => (typeof c === "string" ? c : c.id)), name: a.name },
        }));
        setViewPref("character");
        return;
      }
      const g = (a.source.generator ? generatorById(a.source.generator) : undefined) ?? generatorFor(a.category);
      updateWs(a.category, (w) => ({
        ...w,
        rigMode: false,
        generatorId: g.id,
        params: coerceParams(g, (a.source.params ?? {}) as Record<string, unknown>),
        seed: a.source.seed ?? w.seed,
        name: a.name,
        notes: "",
        prompt: a.source.prompt ?? w.prompt,
        origin: { kind: a.source.kind === "ai-vibe" ? "ai-vibe" : "procedural", prompt: a.source.prompt },
        freeform: null,
      }));
      setViewPref(a.category);
    },
    rename: (id, name) => library.patch(id, { name }),
    remove: (id) => {
      library.remove(id);
      setRefIds((r) => r.filter((x) => x !== id));
    },
    duplicate: (id) => void library.duplicate(id),
    tags: (id, tags) => library.patch(id, { tags }),
    rerender,
    toggleRef: (id) => setRefIds((r) => (r.includes(id) ? r.filter((x) => x !== id) : r.length >= 2 ? r : [...r, id])),
    error,
  };

  const rerenderAll = () => {
    let n = 0;
    for (const a of library.assets)
      if (canRerender(a))
        try {
          library.update(rerenderAsset(a, kit));
          n++;
        } catch {
          /* skip assets whose generator now fails */
        }
    push(`Re-rendered ${n} asset${n === 1 ? "" : "s"} with ${kit.name}.`);
  };

  const importProject = async (f: File) => {
    try {
      const { project: incoming, warnings } = await readProjectFile(f);
      mergeProject(incoming);
      push(`Imported ${incoming.assets.length} assets and ${incoming.kits.length} kits.${warnings.length ? ` ${warnings.slice(0, 2).join(" ")}${warnings.length > 2 ? ` (+${warnings.length - 2} more warnings)` : ""}` : ""}`, warnings.length ? "error" : "info");
    } catch (e) {
      error(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const listProps = { assets: library.assets, kit, kits: kits.kits, pal, actions, refIds, references };
  const importCategory: Category = view === "library" ? "character" : view;

  return (
    <div className="app">
      <SyncBadge state={sync.state} message={sync.message} reload={sync.reload} />
      <ReferencesPanel references={references} onAdd={addReference} onUpdate={updateReference} onRemove={removeReference} onGenerate={setGenRef} onError={error} />
      <TopBar kits={kits.kits} kit={kit} onKit={kits.setActive} onEditKit={() => setKitOpen(true)} status={status} onRefreshAi={refresh} />
      <div className={`body ${view === "library" ? "no-strip" : ""}`}>
        <CategoryNav view={view} onView={setViewPref} assets={library.assets} />
        <main className="main">
          {view === "library" ? (
            <LibraryView {...listProps} onExportAll={() => exportProject(project)} onImportFile={importProject} onRerenderAll={rerenderAll} />
          ) : (
            <Workspace
              key={view}
              category={view}
              kit={kit}
              pal={pal}
              ws={wsMap[view]}
              update={updateWs}
              status={status}
              refs={refs}
              onRemoveRef={actions.toggleRef}
              onSave={saveAsset}
              onOpenEditor={setEditing}
              onImport={() => setImporting(true)}
              onError={error}
              customClips={clips}
              customRigs={customRigs}
              customAttachments={customAttachments}
              onAuthored={addAuthored}
              onSaveClip={(c) => {
                addClip(c);
                push(`Saved clip “${c.id}” to the project.`);
              }}
            />
          )}
        </main>
        {view !== "library" && <LibraryStrip {...listProps} category={view} onOpenLibrary={() => setViewPref("library")} />}
      </div>

      {kitOpen && (
        <KitEditor
          kits={kits.kits}
          active={kit}
          status={status}
          onSelect={kits.setActive}
          onSave={(k: StyleKit) => {
            kits.upsert(k);
            push(`Kit “${k.name}” saved. Library previews re-coloured.`);
          }}
          onDuplicate={(id) => void kits.duplicate(id)}
          onDelete={kits.remove}
          onAddPreset={(k) => {
            kits.upsert(k);
            kits.setActive(k.id);
          }}
          onClose={() => setKitOpen(false)}
        />
      )}
      {editing &&
        (editing.tilemap ? (
          <MapEditor asset={editing} kit={kit} library={library.assets} onSave={onEditorSave} onClose={() => setEditing(null)} />
        ) : (
          <PixelEditor asset={editing} kit={kit} onSave={onEditorSave} onClose={() => setEditing(null)} />
        ))}
      {importing && (
        <ImportDialog
          kit={kit}
          category={importCategory}
          onImport={(a) => {
            library.add(a);
            setImporting(false);
            push(`Imported “${a.name}” into the library.`);
          }}
          onClose={() => setImporting(false)}
        />
      )}
      {genRef !== null && (
        <ReferenceGenerate
          references={references}
          initialId={genRef}
          kit={kit}
          status={status}
          onKeep={(a) => { library.add(a); setGenRef(null); push(`Saved “${a.name}” to the library.`); }}
          onClose={() => setGenRef(null)}
          onError={error}
        />
      )}
      <Toasts toasts={toasts} dismiss={dismiss} />
    </div>
  );
}

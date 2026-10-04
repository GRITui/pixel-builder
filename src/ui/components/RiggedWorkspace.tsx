import { useEffect, useMemo, useRef, useState } from "react";
import { createAsset } from "../../core/asset";
import { MATERIALS, type Material } from "../../core/palette";
import { DIRS, validateRig, type Attachment, type Clip, type RigDef, type RigRecipe } from "../../core/rig";
import { ATTACHMENTS, CLIPS, RIGS, rigById, withHumanoidDefaults, type RigFamily } from "../../core/rigs";
import type { Asset, FrameSet, StyleKit } from "../../core/types";
import { RigEditor } from "../rig/RigEditor";
import { drawSprite, type FlatPalette } from "../render";
import { renderRigWorld } from "../rig/recipe";
import { RampSwatch } from "./common";
import { ExportMenu } from "./ExportMenu";
import "../rig/rig.css";

/** What the rigged mode remembers between visits. */
export interface RigSel {
  rigId: string;
  slots: Record<string, Material>;
  attachments: string[];
  clips: string[];
  name: string;
}

export function initRigSel(): RigSel {
  const rig = RIGS[0]?.rig;
  return { rigId: rig?.id ?? "", slots: {}, attachments: [], clips: [], name: "" };
}

const FAMILIES: RigFamily[] = ["humanoid", "quadruped", "bird"];

/** One animation loop for every preview cell: frame = floor(t * fps) per clip. */
function RigPreview({ rows, clips, pal, scale }: { rows: FrameSet[]; clips: Clip[]; pal: FlatPalette; scale: number }) {
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    let last = -1;
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      const key = clips.map((c) => Math.floor(t * c.fps)).join(",");
      if (key !== String(last)) {
        last = key as unknown as number;
        rows.forEach((r, i) => {
          const c = refs.current[i];
          if (!c) return;
          const clip = clips[Math.floor(i / DIRS.length)];
          const f = clip && r.frames[Math.floor(t * clip.fps) % r.frames.length];
          if (!f) return;
          if (c.width !== f.w * scale) {
            c.width = f.w * scale;
            c.height = f.h * scale;
          }
          const ctx = c.getContext("2d")!;
          ctx.clearRect(0, 0, c.width, c.height);
          drawSprite(ctx, f, pal, 0, 0, scale);
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [rows, clips, pal, scale]);

  return (
    <div className="rigw-clips">
      {clips.map((c, ci) => (
        <div key={c.id} className="rigw-clip">
          <strong>
            {c.id} <span className="dim fine">{c.fps} fps</span>
          </strong>
          <div className="rigw-dirs">
            {DIRS.map((d, di) => (
              <figure key={d} className="checker">
                <canvas ref={(el) => void (refs.current[ci * DIRS.length + di] = el)} className="px" />
                <figcaption>{d}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function RiggedWorkspace(props: {
  kit: StyleKit;
  pal: FlatPalette;
  sel: RigSel;
  update: (fn: (s: RigSel) => RigSel) => void;
  customClips: Clip[];
  /** Rigs and attachments saved in the project (e.g. created by agents via create_rig / create_attachment). */
  customRigs?: RigDef[];
  customAttachments?: Attachment[];
  onSave: (a: Asset) => void;
  onSaveClip: (c: Clip) => void;
  onError: (m: string) => void;
}) {
  const { kit, pal, sel, update } = props;
  const allRigs = useMemo<{ rig: RigDef; family: RigFamily | "custom" }[]>(
    () => [...RIGS, ...(props.customRigs ?? []).filter((r) => !rigById(r.id)).map((rig) => ({ rig, family: "custom" as const }))],
    [props.customRigs],
  );
  const entry = allRigs.find((r) => r.rig.id === sel.rigId) ?? allRigs[0];
  const rig = entry.rig;
  const family = entry.family;
  const customRig = family === "custom";
  const [editing, setEditing] = useState(false);

  const clipsAvail = useMemo(
    () => [...CLIPS.filter((c) => c.family === family || customRig).map((c) => ({ clip: c.clip, custom: false })), ...props.customClips.map((clip) => ({ clip, custom: true }))],
    [family, customRig, props.customClips],
  );
  // registry attachments for this family, plus project attachments that fit this rig's joints
  const attsAvail = useMemo(
    () => [
      ...ATTACHMENTS.filter((a) => a.family === family),
      ...(props.customAttachments ?? []).filter((a) => !ATTACHMENTS.some((x) => x.attachment.id === a.id) && validateRig(rig, [a]).length === 0).map((attachment) => ({ attachment, family })),
    ],
    [family, rig, props.customAttachments],
  );
  const selClips = sel.clips.length ? sel.clips : clipsAvail.slice(0, 1).map((c) => c.clip.id);
  const clips = useMemo(() => selClips.flatMap((id) => clipsAvail.find((c) => c.clip.id === id)?.clip ?? []), [selClips.join(","), clipsAvail]); // eslint-disable-line react-hooks/exhaustive-deps
  const attachments = useMemo(() => sel.attachments.flatMap((id) => attsAvail.find((a) => a.attachment.id === id)?.attachment ?? []), [sel.attachments, attsAvail]);
  const slots = useMemo(() => ({ ...rig.slots, ...sel.slots }), [rig, sel.slots]);

  const gen = useMemo(() => {
    try {
      if (!clips.length) return { rows: null, error: "Pick at least one clip." };
      return { rows: renderRigWorld(rig, kit, slots, withHumanoidDefaults(rig, attachments), clips), error: null };
    } catch (e) {
      return { rows: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [rig, kit, slots, attachments, clips]);

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const name = sel.name.trim() || rig.name;
  const size = gen.rows?.[0]?.frames[0]?.w ?? kit.sizes.character;
  const scale = Math.max(1, Math.min(6, Math.floor(150 / size)));

  const draft = useMemo<Asset | null>(() => {
    if (!gen.rows) return null;
    const recipe: RigRecipe = {
      // project-defined rigs/attachments are embedded so the asset re-renders without the project definitions
      rig: customRig ? rig : rig.id,
      slots: sel.slots,
      attachments: attachments.map((a) => (ATTACHMENTS.some((x) => x.attachment.id === a.id) ? a.id : a)),
      clips: clips.map((c) => (props.customClips.some((x) => x.id === c.id) ? c : c.id)),
    };
    return createAsset({ name, category: "character", kit, rows: gen.rows, fps: clips[0].fps, source: { kind: "rigged", rig: recipe } });
  }, [gen.rows, rig, customRig, sel.slots, attachments, clips, props.customClips, name, kit]);

  const pickRig = (id: string) => update((s) => ({ ...s, rigId: id, slots: {}, attachments: [], clips: [] }));
  const familyRigs = allRigs.filter((r) => r.family === family);

  return (
    <div className="workspace">
      <div className="ws-left">
        <section className="card">
          <h3 className="card-title">Rig</h3>
          <div className="rigw-slot">
            <label htmlFor="rig-family" className="dim">Family</label>
            <select id="rig-family" value={family} onChange={(e) => pickRig(allRigs.find((r) => r.family === e.target.value)?.rig.id ?? sel.rigId)}>
              {[...FAMILIES, "custom" as const].filter((f) => allRigs.some((r) => r.family === f)).map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
            <label htmlFor="rig-pick" className="dim">Rig</label>
            <select id="rig-pick" value={rig.id} onChange={(e) => pickRig(e.target.value)}>
              {familyRigs.map((r) => (
                <option key={r.rig.id} value={r.rig.id}>
                  {r.rig.name}
                </option>
              ))}
            </select>
          </div>
        </section>
        <section className="card">
          <h3 className="card-title">Materials</h3>
          {Object.keys(rig.slots).map((s) => (
            <div key={s} className="rigw-slot">
              <span>{s}</span>
              <select aria-label={`${s} material`} value={slots[s]} onChange={(e) => update((x) => ({ ...x, slots: { ...x.slots, [s]: e.target.value as Material } }))}>
                {MATERIALS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <RampSwatch kit={kit} material={slots[s]} />
            </div>
          ))}
        </section>
        <section className="card">
          <h3 className="card-title">Attachments</h3>
          {attsAvail.length === 0 && <p className="dim fine">No attachments for this family.</p>}
          <div className="rigw-grid">
            {attsAvail.map(({ attachment: a }) => (
              <label key={a.id} className="rigw-check">
                <input type="checkbox" checked={sel.attachments.includes(a.id)} onChange={() => update((s) => ({ ...s, attachments: toggle(s.attachments, a.id) }))} />
                {a.name}
              </label>
            ))}
          </div>
        </section>
        <section className="card">
          <h3 className="card-title">Clips</h3>
          <div className="rigw-grid">
            {clipsAvail.map(({ clip, custom }) => (
              <label key={clip.id} className="rigw-check">
                <input
                  type="checkbox"
                  checked={selClips.includes(clip.id)}
                  onChange={() => update((s) => ({ ...s, clips: toggle(selClips, clip.id) }))}
                />
                {clip.id} {custom && <span className="dim fine">custom</span>}
              </label>
            ))}
          </div>
          <div>
            <button onClick={() => setEditing(true)} title="Pose joints frame by frame and save a custom clip">
              Edit / new clip…
            </button>
          </div>
        </section>
      </div>

      <div className="ws-right">
        <section className="card preview-card">
          <div className="card-head">
            <h3 className="card-title">Rigged preview</h3>
          </div>
          {gen.rows ? <RigPreview rows={gen.rows} clips={clips} pal={pal} scale={scale} /> : <p className="error">{gen.error}</p>}
          <div className="action-row">
            <input className="name-field" aria-label="Asset name" placeholder={rig.name} value={sel.name} onChange={(e) => update((s) => ({ ...s, name: e.target.value }))} />
            <button className="primary" disabled={!draft} onClick={() => draft && props.onSave(draft)}>
              Save to library
            </button>
            {draft && <ExportMenu asset={draft} kit={kit} onError={props.onError} align="right" />}
          </div>
          {gen.rows && <p className="dim fine">{size}×{size}px · {gen.rows.length} rows ({clips.length} clip{clips.length === 1 ? "" : "s"} × 4 directions)</p>}
        </section>
      </div>

      {editing && (
        <RigEditor
          rig={rig}
          kit={kit}
          pal={pal}
          slots={slots}
          attachments={attachments}
          initialClip={clips[0]}
          templates={clipsAvail.map((c) => c.clip)}
          onSave={(c) => {
            props.onSaveClip(c);
            update((s) => ({ ...s, clips: [...selClips.filter((x) => x !== c.id), c.id] }));
            setEditing(false);
          }}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}

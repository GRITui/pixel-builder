import { useEffect, useMemo, useRef, useState } from "react";
import { aiRig, type AiStatus } from "../../ai/client";
import { createAsset } from "../../core/asset";
import { MATERIALS, type Material } from "../../core/palette";
import { DIRS, DIRS8, validateRig, type Directions, type Attachment, type Clip, type RigDef, type RigRecipe } from "../../core/rig";
import { ATTACHMENTS, CLIPS, RIGS, rigById, withHumanoidDefaults, type RigFamily } from "../../core/rigs";
import type { Asset, FrameSet, StyleKit } from "../../core/types";
import { RigEditor } from "../rig/RigEditor";
import { drawSprite, type FlatPalette } from "../render";
import { renderRigWorld } from "../rig/recipe";
import { RampSwatch, aiOffReason } from "./common";
import { ExportMenu } from "./ExportMenu";
import "../rig/rig.css";

/** What the rigged mode remembers between visits. */
export interface RigSel {
  rigId: string;
  slots: Record<string, Material>;
  attachments: string[];
  clips: string[];
  name: string;
  /** 4 (default) or 8 directions. */
  directions?: Directions;
}

export function initRigSel(): RigSel {
  const rig = RIGS[0]?.rig;
  return { rigId: rig?.id ?? "", slots: {}, attachments: [], clips: [], name: "" };
}

const FAMILIES: RigFamily[] = ["humanoid", "quadruped", "bird", "monster", "beast", "undead"];

/** One animation loop for every preview cell: frame = floor(t * fps) per clip. */
function RigPreview({ rows, clips, pal, scale, directions }: { rows: FrameSet[]; clips: Clip[]; pal: FlatPalette; scale: number; directions: Directions }) {
  const dirs = directions === 8 ? DIRS8 : DIRS;
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
          const clip = clips[Math.floor(i / dirs.length)];
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
  }, [rows, clips, pal, scale, dirs]);

  return (
    <div className="rigw-clips">
      {clips.map((c, ci) => (
        <div key={c.id} className="rigw-clip">
          <strong>
            {c.id} <span className="dim fine">{c.fps} fps</span>
          </strong>
          <div className="rigw-dirs">
            {dirs.map((d, di) => (
              <figure key={d} className="checker">
                <canvas ref={(el) => void (refs.current[ci * dirs.length + di] = el)} className="px" />
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
  /** AI availability (the Describe box is disabled without a server key). */
  status?: AiStatus | null;
  /** Store an AI-authored rig / attachments / clips on the project. */
  onAuthored?: (a: { rig?: RigDef; attachments?: Attachment[]; clips?: Clip[] }) => void;
  onError: (m: string) => void;
}) {
  const { kit, pal, sel, update } = props;
  const directions: Directions = sel.directions === 8 ? 8 : 4;
  const allRigs = useMemo<{ rig: RigDef; family: RigFamily | "custom" }[]>(
    () => [...RIGS, ...(props.customRigs ?? []).filter((r) => !rigById(r.id)).map((rig) => ({ rig, family: "custom" as const }))],
    [props.customRigs],
  );
  const entry = allRigs.find((r) => r.rig.id === sel.rigId) ?? allRigs[0];
  const rig = entry.rig;
  const family = entry.family;
  const customRig = family === "custom";
  const [editing, setEditing] = useState(false);
  const [desc, setDesc] = useState("");
  const [descBusy, setDescBusy] = useState(false);
  const [descNotes, setDescNotes] = useState("");
  const [keepRig, setKeepRig] = useState(false);
  const aiOn = !!props.status?.enabled;

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
      return { rows: renderRigWorld(rig, kit, slots, withHumanoidDefaults(rig, attachments), clips, directions), error: null };
    } catch (e) {
      return { rows: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [rig, kit, slots, attachments, clips, directions]);

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
      ...(directions === 8 ? { directions: 8 as const } : {}),
    };
    return createAsset({ name, category: "character", kit, rows: gen.rows, fps: clips[0].fps, source: { kind: "rigged", rig: recipe } });
  }, [gen.rows, rig, customRig, sel.slots, attachments, clips, props.customClips, name, kit, directions]);

  const describe = async () => {
    setDescBusy(true);
    setDescNotes("");
    try {
      const r = await aiRig({ prompt: desc.trim(), kit, base: keepRig ? rig.id : undefined });
      // ids must not shadow built-ins: the registry wins on lookup, so authored clips/attachments get a prefix when they collide
      const att = r.attachments.map((a) => (ATTACHMENTS.some((x) => x.attachment.id === a.id) ? { ...a, id: `ai-${a.id}` } : a));
      const prefix = r.rig?.id ?? "ai";
      const clips = r.clips.map((c) => ({ ...c, id: `${prefix}-${c.id}` }));
      const nextRig = r.rig && rigById(r.rig.id) ? { ...r.rig, id: `ai-${r.rig.id}` } : r.rig;
      props.onAuthored?.({ rig: nextRig, attachments: att, clips });
      update((s) => ({
        ...s,
        rigId: nextRig?.id ?? r.baseRig ?? s.rigId,
        slots: Object.fromEntries(Object.entries(r.slots).filter(([, m]) => (MATERIALS as readonly string[]).includes(m))) as Record<string, Material>,
        attachments: [...r.attachmentIds, ...att.map((a) => a.id)],
        clips: clips.map((c) => c.id),
        name: r.name,
      }));
      setDescNotes(r.notes);
    } catch (e) {
      props.onError(e instanceof Error ? e.message : String(e));
    } finally {
      setDescBusy(false);
    }
  };
  const pickRig = (id: string) => update((s) => ({ ...s, rigId: id, slots: {}, attachments: [], clips: [] }));
  const familyRigs = allRigs.filter((r) => r.family === family);

  return (
    <div className="workspace">
      <div className="ws-left">
        <section className="card" aria-label="Describe a character">
          <h3 className="card-title">Describe</h3>
          <textarea
            id="rig-describe"
            aria-label="Describe a character or creature"
            rows={3}
            value={desc}
            placeholder="e.g. a monk in saffron robes carrying an alms bowl, or a river crab"
            onChange={(e) => setDesc(e.target.value)}
          />
          <label className="rigw-check" title="Keep the selected rig's body and only author attachments and colours">
            <input type="checkbox" checked={keepRig} onChange={(e) => setKeepRig(e.target.checked)} />
            Build on the selected rig
          </label>
          <div className="btn-row">
            <button
              className="primary"
              disabled={!aiOn || !desc.trim() || descBusy}
              title={!aiOn ? aiOffReason(props.status ?? null) : !desc.trim() ? "Describe what you want first" : "Claude authors a rig (or attachments for the selected one) and loads it here"}
              onClick={describe}
            >
              {descBusy ? "Designing…" : "✦ Design it"}
            </button>
          </div>
          {!aiOn && <p className="hint">{aiOffReason(props.status ?? null).replace(/\.?$/, ".")} Agents can author rigs without a key: see the design_creature prompt.</p>}
          {descNotes && <p className="dim fine">{descNotes}</p>}
        </section>
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
          <div className="rigw-slot" role="group" aria-label="Directions">
            <span className="dim">Directions</span>
            {([4, 8] as const).map((n) => (
              <label key={n} className="rigw-check">
                <input type="radio" name="rig-directions" checked={directions === n} onChange={() => update((s) => ({ ...s, directions: n }))} />
                {n}{n === 8 ? " (3/4 diagonals)" : ""}
              </label>
            ))}
          </div>
        </section>
      </div>

      <div className="ws-right">
        <section className="card preview-card">
          <div className="card-head">
            <h3 className="card-title">Rigged preview</h3>
          </div>
          {gen.rows ? <RigPreview rows={gen.rows} clips={clips} pal={pal} scale={scale} directions={directions} /> : <p className="error">{gen.error}</p>}
          <div className="action-row">
            <input className="name-field" aria-label="Asset name" placeholder={rig.name} value={sel.name} onChange={(e) => update((s) => ({ ...s, name: e.target.value }))} />
            <button className="primary" disabled={!draft} onClick={() => draft && props.onSave(draft)}>
              Save to library
            </button>
            {draft && <ExportMenu asset={draft} kit={kit} onError={props.onError} align="right" />}
          </div>
          {gen.rows && <p className="dim fine">{size}×{size}px · {gen.rows.length} rows ({clips.length} clip{clips.length === 1 ? "" : "s"} × {directions} directions)</p>}
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

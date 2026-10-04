import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { vibeKit } from "../../ai/client";
import { generatorById, coerceParams, type GenResult } from "../../core/generators";
import { ALL_KIT_PRESETS as KIT_PRESETS, resolveRamps } from "../../core/kit";
import { MATERIALS, PALETTES, RAMP_LEN, type Material } from "../../core/palette";
import type { LightDir, OutlineMode, StyleKit } from "../../core/types";
import { paletteFor } from "../render";
import { aiOffReason, Modal } from "./common";
import { AnimThumb } from "./SpriteView";
import type { AiStatus } from "../../ai/client";

const SAMPLES: { label: string; gen: string; params: Record<string, unknown> }[] = [
  { label: "Character", gen: "character", params: {} },
  { label: "Grass tile", gen: "environment", params: { kind: "grass-tile" } },
  { label: "Tree", gen: "environment", params: { kind: "oak" } },
  { label: "Chest", gen: "object", params: { kind: "chest" } },
  { label: "Button", gen: "ui", params: { kind: "button" } },
  { label: "Building", gen: "building", params: {} },
];

function SampleSheet({ kit }: { kit: StyleKit }) {
  const deferred = useDeferredValue(kit);
  const pal = useMemo(() => paletteFor(deferred), [deferred]);
  const results = useMemo(
    () =>
      SAMPLES.map((s) => {
        const g = generatorById(s.gen);
        if (!g) return null;
        try {
          return g.generate(coerceParams(g, s.params), deferred, 12345) as GenResult;
        } catch {
          return null;
        }
      }),
    [deferred],
  );
  return (
    <div className="sample-sheet" aria-label="Live sample sheet">
      {SAMPLES.map((s, i) => (
        <figure key={s.label}>
          {results[i] ? <AnimThumb rows={results[i]!.rows} fps={results[i]!.fps} pal={pal} size={104} alwaysPlay /> : <div className="thumb" style={{ width: 104, height: 104 }} />}
          <figcaption>{s.label}</figcaption>
        </figure>
      ))}
    </div>
  );
}

function hex6(c: string): string {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toLowerCase() : "#000000";
}

const OUTLINES: OutlineMode[] = ["none", "black", "colored", "selective"];
const LIGHTS: LightDir[] = ["top-left", "top", "top-right"];
const SIZE_KEYS = ["character", "building", "environment", "object", "ui", "tile"] as const;

export function KitEditor(props: {
  kits: StyleKit[];
  active: StyleKit;
  status: AiStatus | null;
  onSelect: (id: string) => void;
  onSave: (kit: StyleKit) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onAddPreset: (kit: StyleKit) => void;
  onClose: () => void;
}) {
  const { active } = props;
  const [draft, setDraft] = useState<StyleKit>(active);
  useEffect(() => setDraft(active), [active]);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(active), [draft, active]);
  const [styleText, setStyleText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const set = <K extends keyof StyleKit>(k: K, v: StyleKit[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const ramps = resolveRamps(draft);
  const overridden = (m: Material) => !!draft.rampOverrides[m];
  const setRampColor = (m: Material, i: number, c: string) =>
    setDraft((d) => {
      const cur = [...resolveRamps(d)[m]];
      cur[i] = c;
      return { ...d, rampOverrides: { ...d.rampOverrides, [m]: cur } };
    });
  const resetRamp = (m: Material) =>
    setDraft((d) => {
      const o = { ...d.rampOverrides };
      delete o[m];
      return { ...d, rampOverrides: o };
    });

  const guard = (fn: () => void) => () => {
    if (!dirty || window.confirm("Discard unsaved changes to this kit?")) fn();
  };
  const close = () => guard(props.onClose)();

  const aiOn = !!props.status?.enabled;
  const aiTitle = !aiOn ? aiOffReason(props.status) : "Let Claude adjust palette, outline, light and shading to match the description";

  const describe = async () => {
    if (!styleText.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await vibeKit({ prompt: styleText.trim(), kit: draft });
      setDraft((d) => {
        const k = r.kit;
        const paletteChanged = k.paletteId !== undefined && k.paletteId !== d.paletteId;
        return {
          ...d,
          ...k,
          id: d.id,
          name: d.name,
          rampOverrides: k.rampOverrides ?? (paletteChanged ? {} : d.rampOverrides),
          sizes: { ...d.sizes, ...(k.sizes ?? {}) },
        };
      });
      setMsg({ text: r.notes || "Style applied. Review it, then save." });
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
    }
  };

  const missingPresets = KIT_PRESETS.filter((p) => !props.kits.some((k) => k.id === p.id));

  return (
    <Modal
      title="Style Kit"
      wide
      onClose={close}
      footer={
        <>
          <span className="dim grow">{active.locked ? "Locked house style: use Duplicate to make an editable copy" : dirty ? "Unsaved changes" : "All changes saved"}</span>
          <button disabled={!dirty} onClick={() => setDraft(active)}>
            Revert
          </button>
          <button className="primary" disabled={!dirty || !!active.locked} onClick={() => props.onSave(draft)}>
            Save kit
          </button>
          <button onClick={close}>Close</button>
        </>
      }
    >
      <div className="kit-editor">
        <div className="kit-form">
          <div className="kit-top">
            <select aria-label="Kit" value={active.id} onChange={(e) => guard(() => props.onSelect(e.target.value))()}>
              {props.kits.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
            <button onClick={guard(() => props.onDuplicate(active.id))}>Duplicate</button>
            <button className="danger-text" disabled={props.kits.length <= 1 || !!active.locked} onClick={guard(() => window.confirm(`Delete kit “${active.name}”?`) && props.onDelete(active.id))}>
              Delete
            </button>
            {missingPresets.length > 0 && (
              <select
                aria-label="Add a preset kit"
                value=""
                onChange={(e) => {
                  const p = missingPresets.find((x) => x.id === e.target.value);
                  if (p) guard(() => props.onAddPreset({ ...p }))();
                }}
              >
                <option value="">+ Add preset…</option>
                {missingPresets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <fieldset>
            <legend>Describe a style</legend>
            <div className="row">
              <input
                value={styleText}
                placeholder="e.g. mossy overgrown ruins at dawn, soft pastel, thin dark outlines"
                aria-label="Describe a style"
                onChange={(e) => setStyleText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && aiOn && describe()}
              />
              <button className="primary" disabled={!aiOn || busy || !styleText.trim()} title={aiTitle} onClick={describe}>
                {busy ? "Thinking…" : "✦ Apply"}
              </button>
            </div>
            {!aiOn && <p className="hint">{aiTitle}</p>}
            {msg && <p className={msg.error ? "error" : "notes"}>{msg.text}</p>}
          </fieldset>

          <fieldset>
            <legend>General</legend>
            <div className="grid2">
              <label>
                Name
                <input value={draft.name} onChange={(e) => set("name", e.target.value)} />
              </label>
              <label>
                Palette preset
                <select value={draft.paletteId} onChange={(e) => setDraft((d) => ({ ...d, paletteId: e.target.value, rampOverrides: {} }))} title="Switching palette clears your ramp edits">
                  {PALETTES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Outline
                <select value={draft.outline} onChange={(e) => set("outline", e.target.value as OutlineMode)}>
                  {OUTLINES.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </label>
              <label>
                Light direction
                <select value={draft.lightDir} onChange={(e) => set("lightDir", e.target.value as LightDir)}>
                  {LIGHTS.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </label>
              <label>
                Shade steps · {draft.shadeSteps}
                <input type="range" min={2} max={5} step={1} value={draft.shadeSteps} onChange={(e) => set("shadeSteps", Number(e.target.value))} />
              </label>
              <label>
                Ambient · {draft.ambient.toFixed(2)}
                <input type="range" min={0} max={1} step={0.05} value={draft.ambient} onChange={(e) => set("ambient", Number(e.target.value))} />
              </label>
              <label className="switch">
                <input type="checkbox" checked={draft.dither} onChange={(e) => set("dither", e.target.checked)} />
                <span>Dither shading</span>
              </label>
            </div>
          </fieldset>

          <fieldset>
            <legend>Sprite sizes (px)</legend>
            <div className="grid6">
              {SIZE_KEYS.map((k) => (
                <label key={k}>
                  {k}
                  <input
                    type="number"
                    min={8}
                    max={128}
                    step={4}
                    value={draft.sizes[k]}
                    onChange={(e) => {
                      const n = Math.round(Number(e.target.value));
                      if (Number.isFinite(n)) set("sizes", { ...draft.sizes, [k]: Math.max(8, Math.min(128, n)) });
                    }}
                  />
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Vibe (art direction used by the AI)</legend>
            <textarea rows={2} value={draft.vibe} onChange={(e) => set("vibe", e.target.value)} />
          </fieldset>

          <fieldset>
            <legend>Colour ramps (dark → light)</legend>
            <div className="ramps">
              {MATERIALS.map((m) => (
                <div key={m} className="ramp-row">
                  <span className={`ramp-name ${overridden(m) ? "edited" : ""}`}>{m}</span>
                  {Array.from({ length: RAMP_LEN }, (_, i) => (
                    <input key={i} type="color" aria-label={`${m} shade ${i + 1}`} value={hex6(ramps[m][i])} onChange={(e) => setRampColor(m, i, e.target.value)} />
                  ))}
                  <button className="ghost" disabled={!overridden(m)} onClick={() => resetRamp(m)} title="Reset to the palette preset" aria-label={`Reset ${m}`}>
                    ↺
                  </button>
                </div>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="kit-sample">
          <h3 className="card-title">Live sample sheet</h3>
          <SampleSheet kit={draft} />
          <p className="hint">Rendered with the unsaved kit. Save to apply it everywhere.</p>
        </div>
      </div>
    </Modal>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderRigFrame, solvePose, type Attachment, type Clip, type Dir, type RigDef, type View } from "../../core/rig";
import type { Material } from "../../core/palette";
import type { StyleKit } from "../../core/types";
import { Modal } from "../components/common";
import { fitScale } from "../components/SpriteView";
import { drawSprite, type FlatPalette } from "../render";
import {
  addFrame, bones, canRedo, canUndo, createHistory, deleteFrame, dragJoint, duplicateFrame, frameCount, framesPerView,
  hitJoint, pushHistory, redo, setPose, toClip, undo, VIEWS, type Pt, type ViewFrames,
} from "./ops";
import "./rig.css";

const DIR_OF: Record<View, Dir> = { down: "down", side: "right", up: "up" };

export interface RigEditorProps {
  rig: RigDef;
  kit: StyleKit;
  pal: FlatPalette;
  slots?: Record<string, Material>;
  attachments?: Attachment[];
  /** Clip to start from (a copy is edited), if any. */
  initialClip?: Clip;
  /** Other clips that can be used as a starting point. */
  templates?: Clip[];
  onSave: (clip: Clip) => void;
  onClose: () => void;
}

export function RigEditor(p: RigEditorProps) {
  const { rig, kit, pal } = p;
  const [hist, setHist] = useState(() => createHistory<ViewFrames>(framesPerView(p.initialClip)));
  const [draft, setDraft] = useState<ViewFrames | null>(null); // live drag state, not yet in history
  const [view, setView] = useState<View>("down");
  const [index, setIndex] = useState(0);
  const [onion, setOnion] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [playIdx, setPlayIdx] = useState(0);
  const [fps, setFps] = useState(p.initialClip?.fps ?? 8);
  const [name, setName] = useState(p.initialClip ? `${p.initialClip.id}-custom` : "custom-clip");
  const [active, setActive] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const dragging = useRef<string | null>(null);

  const frames = draft ?? hist.present;
  const n = frameCount(frames);
  const i = Math.min(index, n - 1);
  const shown = playing ? playIdx % n : i;
  const size = kit.sizes.character;
  const k = size / rig.grid;
  const scale = fitScale(size, size, 440, 440, 20);
  const px = size * scale;

  useEffect(() => {
    if (!playing) return;
    setPlayIdx(i);
    const t = setInterval(() => setPlayIdx((v) => v + 1), 1000 / Math.max(1, fps));
    return () => clearInterval(t);
  }, [playing, fps]); // eslint-disable-line react-hooks/exhaustive-deps

  const render = useMemo(() => ({ rig, kit, slots: p.slots, attachments: p.attachments }), [rig, kit, p.slots, p.attachments]);
  const sprite = useMemo(() => renderRigFrame(render, DIR_OF[view], frames[view][shown] ?? {}), [render, view, frames, shown]);
  const prevIdx = (shown - 1 + n) % n;
  const onionSprite = useMemo(() => (onion && !playing && n > 1 ? renderRigFrame(render, DIR_OF[view], frames[view][prevIdx] ?? {}) : null), [render, view, frames, prevIdx, onion, playing, n]);
  const joints = useMemo(() => solvePose(rig, view, frames[view][i] ?? {}), [rig, view, frames, i]);

  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current!;
    c.width = px;
    c.height = px;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, px, px);
    if (onionSprite) {
      ctx.globalAlpha = 0.3;
      drawSprite(ctx, onionSprite, pal, 0, 0, scale);
      ctx.globalAlpha = 1;
    }
    drawSprite(ctx, sprite, pal, 0, 0, scale);
  }, [sprite, onionSprite, pal, px, scale]);

  const commit = useCallback((next: ViewFrames) => setHist((h) => pushHistory(h, next)), []);
  const doUndo = useCallback(() => setHist((h) => undo(h)), []);
  const doRedo = useCallback(() => setHist((h) => redo(h)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "SELECT") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        doRedo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doUndo, doRedo]);

  const toGrid = (e: React.PointerEvent<SVGSVGElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * size / k, ((e.clientY - r.top) / r.height) * size / k];
  };
  const radius = Math.max(1, 9 / (k * scale));
  const jointPos = joints as Record<string, Pt>;

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (playing) return;
    const hit = hitJoint(jointPos, toGrid(e), radius);
    if (!hit) return setActive(null);
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = hit;
    setActive(hit);
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const id = dragging.current;
    if (!id) return setHover(playing ? null : hitJoint(jointPos, toGrid(e), radius));
    setDraft(setPose(hist.present, view, i, dragJoint(rig, view, hist.present[view][i] ?? {}, id, toGrid(e))));
  };
  const onUp = () => {
    dragging.current = null;
    if (draft) commit(draft);
    setDraft(null);
  };

  const edit = (fn: (f: ViewFrames) => ViewFrames, nextIndex?: number) => {
    commit(fn(hist.present));
    if (nextIndex !== undefined) setIndex(nextIndex);
  };
  const resetJoint = () => active && edit((f) => { const { [active]: _, ...rest } = f[view][i] ?? {}; return setPose(f, view, i, rest); });

  const loadTemplate = (id: string) => {
    const c = p.templates?.find((t) => t.id === id);
    if (!c) return;
    setHist((h) => pushHistory(h, framesPerView(c)));
    setIndex(0);
    setFps(c.fps);
  };

  const valid = /^[a-z0-9][a-z0-9-_]*$/i.test(name.trim());
  const pose = frames[view][i] ?? {};

  return (
    <Modal
      wide
      title={`Rig editor: ${rig.name}`}
      onClose={p.onClose}
      footer={
        <>
          <label className="inline">
            Clip id
            <input aria-label="Clip id" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="inline">
            fps
            <input aria-label="Frames per second" type="number" min={1} max={30} value={fps} onChange={(e) => setFps(Math.max(1, Math.min(30, Number(e.target.value) || 1)))} style={{ width: 56 }} />
          </label>
          {!valid && <span className="error">Use letters, digits, - and _.</span>}
          <span style={{ flex: 1 }} />
          <button onClick={p.onClose}>Cancel</button>
          <button className="primary" disabled={!valid} onClick={() => p.onSave(toClip(name.trim(), fps, hist.present))}>
            Save clip to project
          </button>
        </>
      }
    >
      <div className="rige">
        <div className="rige-main">
          <div className="rige-tools">
            <div className="seg" role="group" aria-label="View">
              {VIEWS.map((v) => (
                <button key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
                  {v}
                </button>
              ))}
            </div>
            <button onClick={doUndo} disabled={!canUndo(hist)} aria-label="Undo" title="Undo (Ctrl+Z)">↶ Undo</button>
            <button onClick={doRedo} disabled={!canRedo(hist)} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">↷ Redo</button>
            <label className="inline">
              <input type="checkbox" checked={onion} onChange={(e) => setOnion(e.target.checked)} /> Onion skin
            </label>
          </div>
          <div className="rige-stage checker" style={{ width: px, height: px }}>
            <canvas ref={canvas} className="px" aria-label="Rig preview" />
            <svg
              width={px}
              height={px}
              className="rige-overlay"
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              style={{ cursor: hover || active ? "grab" : "default", display: playing ? "none" : undefined }}
            >
              {bones(rig).map(([a, b]) => (
                <line key={a + b} x1={joints[a][0] * k * scale} y1={joints[a][1] * k * scale} x2={joints[b][0] * k * scale} y2={joints[b][1] * k * scale} className="bone" />
              ))}
              {rig.joints.map((j) => (
                <circle
                  key={j.id}
                  cx={joints[j.id][0] * k * scale}
                  cy={joints[j.id][1] * k * scale}
                  r={5}
                  className={`joint ${active === j.id ? "active" : ""} ${hover === j.id ? "hover" : ""} ${pose[j.id] ? "posed" : ""}`}
                >
                  <title>{j.id}</title>
                </circle>
              ))}
            </svg>
          </div>
          <p className="dim fine">
            {active ? `Selected: ${active}${pose[active] ? ` (offset ${pose[active][0]}, ${pose[active][1]})` : ""}. Children follow.` : "Drag a joint to pose this frame and view. Children follow their parent."}
          </p>
        </div>

        <div className="rige-side">
          <h3 className="card-title">Frames</h3>
          <div className="rige-timeline" role="listbox" aria-label="Frames">
            {Array.from({ length: n }, (_, f) => (
              <button key={f} role="option" aria-selected={f === shown} className={`rige-frame ${f === shown ? "on" : ""}`} onClick={() => { setPlaying(false); setIndex(f); }}>
                {f + 1}
              </button>
            ))}
          </div>
          <div className="rige-tools">
            <button onClick={() => edit((f) => addFrame(f, i), i + 1)} aria-label="Add empty frame">+ Add</button>
            <button onClick={() => edit((f) => duplicateFrame(f, i), i + 1)} aria-label="Duplicate frame">Duplicate</button>
            <button onClick={() => edit((f) => deleteFrame(f, i), Math.max(0, i - 1))} disabled={n <= 1} aria-label="Delete frame">Delete</button>
          </div>
          <div className="rige-tools">
            <button className={playing ? "primary" : ""} onClick={() => setPlaying((v) => !v)} aria-pressed={playing}>
              {playing ? "■ Stop" : "▶ Play"}
            </button>
            <button onClick={resetJoint} disabled={!active || !pose[active]}>Reset joint</button>
            <button onClick={() => edit((f) => setPose(f, view, i, {}))} disabled={!Object.keys(pose).length}>Reset pose</button>
          </div>
          {p.templates && p.templates.length > 0 && (
            <label className="inline">
              Start from
              <select value="" onChange={(e) => loadTemplate(e.target.value)} aria-label="Start from an existing clip">
                <option value="">choose clip…</option>
                {p.templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.id}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="dim fine">Frames are shared by all views; each view has its own pose. Left mirrors the side view.</p>
        </div>
      </div>
    </Modal>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AttachReference } from "./components/AttachReference";
import { aiInpaint, aiStatus } from "../ai/client";
import { applyOutline, stripOutline } from "../core/enforce";
import type { Rect } from "../core/inpaint";
import { buildLegend, encodeSprite } from "../core/legend";
import { resolveRamps } from "../core/kit";
import { colorIndex, MATERIALS, RAMP_LEN } from "../core/palette";
import { cloneSprite, createSprite, getPx, spritesEqual } from "../core/sprite";
import type { Asset, FrameSet, Sprite, StyleKit } from "../core/types";
import { paintLayers, rgbaTable } from "./editor/canvasUtil";
import {
  canRedo, canUndo, createHistory, floodFill, linePoints, moveItem, paintPoints, pushHistory, rectPoints, redo,
  applyRegionToRow, replaceAt, resizeSprite, selectionRect, shadePoints, undo, type Anchor, type History, type Point,
} from "./editor/ops";
import { SpriteThumb } from "./editor/SpriteThumb";
import "./editor/editor.css";
import { paletteFor } from "./render";

export interface PixelEditorProps {
  asset: Asset;
  kit: StyleKit;
  onSave: (a: Asset) => void;
  onClose: () => void;
}

type Tool = "pencil" | "eraser" | "fill" | "line" | "rect" | "picker" | "shade" | "select";

const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: "pencil", label: "Pencil", key: "B", hint: "Draw (right-click erases)" },
  { id: "eraser", label: "Eraser", key: "E", hint: "Erase to transparent" },
  { id: "fill", label: "Fill", key: "G", hint: "Fill a connected region" },
  { id: "line", label: "Line", key: "L", hint: "Drag a straight line" },
  { id: "rect", label: "Rect", key: "R", hint: "Drag a rectangle" },
  { id: "picker", label: "Pick", key: "I", hint: "Eyedropper" },
  { id: "shade", label: "Shade", key: "S", hint: "Click lightens, Shift-click darkens along the colour ramp" },
  { id: "select", label: "AI select", key: "T", hint: "Drag a rectangle, describe the change, and let the AI repaint just that region" },
];

const TOOL_KEYS: Record<string, Tool> = { b: "pencil", e: "eraser", g: "fill", l: "line", r: "rect", i: "picker", s: "shade", t: "select" };

interface Stroke {
  tool: Tool;
  value: number;
  dir: 1 | -1;
  start: Point;
  last: Point;
  base: Sprite;
  work: Sprite;
  touched: Set<number>;
  ri: number;
  fi: number;
}

function initialRows(asset: Asset, kit: StyleKit): FrameSet[] {
  if (asset.rows.length && asset.rows.every((r) => r.frames.length)) return asset.rows;
  const size = asset.category === "map" ? kit.sizes.tile : kit.sizes[asset.category];
  return [{ name: "idle", frames: [createSprite(size, size)] }];
}

function mostUsedColor(s: Sprite): number {
  const counts = new Map<number, number>();
  for (const v of s.data) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = colorIndex("stone", 2), n = 0;
  for (const [k, c] of counts) if (c > n) { n = c; best = k; }
  return best;
}

export function PixelEditor({ asset, kit, onSave, onClose }: PixelEditorProps) {
  const [startRows] = useState(() => initialRows(asset, kit));
  const [hist, setHist] = useState<History<FrameSet[]>>(() => createHistory(startRows, 100));
  const [ri0, setRi] = useState(0);
  const [fi0, setFi] = useState(0);
  const [tool, setTool] = useState<Tool>("pencil");
  const [mirror, setMirror] = useState(false);
  const [grid, setGrid] = useState(true);
  const [onion, setOnion] = useState(false);
  const [filled, setFilled] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playIdx, setPlayIdx] = useState(0);
  const [fps, setFps] = useState(asset.fps || 6);
  const [draft, setDraft] = useState<Sprite | null>(null);
  const [allFrames, setAllFrames] = useState(false);
  // AI region edit: selection, prompt, key status and the pending preview (committed as one history step on Accept)
  const [sel, setSel] = useState<Rect | null>(null);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiRef, setAiRef] = useState<string | null>(null);
  const [aiAll, setAiAll] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiEnabled, setAiEnabled] = useState<boolean | null>(null);
  const [proposal, setProposal] = useState<FrameSet[] | null>(null);
  const selStart = useRef<Point | null>(null);
  useEffect(() => {
    let live = true;
    void aiStatus().then((s) => live && setAiEnabled(s.enabled));
    return () => { live = false; };
  }, []);

  const rows = hist.present;
  const ri = Math.min(ri0, rows.length - 1);
  const row = rows[ri];
  const fi = Math.min(fi0, row.frames.length - 1);
  const frame = row.frames[fi];
  const prevFrame = fi > 0 ? row.frames[fi - 1] : undefined;

  const [color, setColor] = useState(() => mostUsedColor(startRows[0].frames[0]));
  const [zoom, setZoom] = useState(() => Math.max(2, Math.min(24, Math.floor(512 / Math.max(frame.w, frame.h)))));
  const [sizeW, setSizeW] = useState(frame.w);
  const [sizeH, setSizeH] = useState(frame.h);
  const [anchor, setAnchor] = useState<Anchor>("bottom");

  const pal = useMemo(() => paletteFor(kit), [kit]);
  const ramps = useMemo(() => resolveRamps(kit), [kit]);
  const table = useMemo(() => rgbaTable(pal), [pal]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const coordRef = useRef<HTMLSpanElement>(null);
  const strokeRef = useRef<Stroke | null>(null);

  const shown = draft ?? proposal?.[ri]?.frames[fi] ?? frame;

  useEffect(() => {
    if (!canvasRef.current) return;
    paintLayers(
      canvasRef.current,
      shown.w,
      shown.h,
      [{ sprite: onion ? prevFrame : null, alpha: 80 }, { sprite: shown, alpha: 255 }],
      table,
    );
  }, [shown, prevFrame, onion, table]);

  useEffect(() => {
    setSizeW(frame.w);
    setSizeH(frame.h);
  }, [frame.w, frame.h]);

  // play preview
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setPlayIdx((i) => i + 1), 1000 / Math.max(1, fps));
    return () => window.clearInterval(id);
  }, [playing, fps]);

  const commitRows = useCallback((next: FrameSet[]) => setHist((h) => pushHistory(h, next)), []);

  const replaceFrame = useCallback(
    (r: number, f: number, s: Sprite) => {
      setHist((h) => {
        const cur = h.present;
        if (!cur[r] || spritesEqual(cur[r].frames[f], s)) return h;
        return pushHistory(h, replaceAt(cur, r, { ...cur[r], frames: replaceAt(cur[r].frames, f, s) }));
      });
    },
    [],
  );

  // ---------- pointer ----------

  const cellAt = (e: React.PointerEvent<HTMLElement>): Point => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: Math.floor(((e.clientX - rect.left) / rect.width) * frame.w),
      y: Math.floor(((e.clientY - rect.top) / rect.height) * frame.h),
    };
  };

  const applyStroke = (s: Stroke, p: Point) => {
    if (s.tool === "pencil" || s.tool === "eraser") {
      paintPoints(s.work, linePoints(s.last.x, s.last.y, p.x, p.y), s.value, mirror);
    } else if (s.tool === "shade") {
      shadePoints(s.work, linePoints(s.last.x, s.last.y, p.x, p.y), s.dir, mirror, s.touched);
    } else {
      s.work.data = s.base.data.slice();
      const pts = s.tool === "line" ? linePoints(s.start.x, s.start.y, p.x, p.y) : rectPoints(s.start.x, s.start.y, p.x, p.y, filled);
      paintPoints(s.work, pts, s.value, mirror);
    }
    s.last = p;
    setDraft({ w: s.work.w, h: s.work.h, data: s.work.data });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.button !== 2) return;
    if (strokeRef.current) return;
    if (proposal) return; // accept or discard the AI preview first
    const p = cellAt(e);
    if (tool === "select") {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      selStart.current = p;
      setSel(selectionRect(p, p, frame.w, frame.h));
      setAiError("");
      return;
    }
    const erase = e.button === 2;
    const value = erase || tool === "eraser" ? 0 : color;
    if (tool === "picker") {
      if (p.x >= 0 && p.y >= 0 && p.x < frame.w && p.y < frame.h) setColor(getPx(frame, p.x, p.y));
      return;
    }
    if (tool === "fill") {
      let out = floodFill(frame, p.x, p.y, value);
      if (mirror) out = floodFill(out, frame.w - 1 - p.x, p.y, value);
      replaceFrame(ri, fi, out);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const s: Stroke = {
      tool,
      value,
      dir: e.shiftKey || (erase && tool === "shade") ? -1 : 1,
      start: p,
      last: p,
      base: frame,
      work: cloneSprite(frame),
      touched: new Set(),
      ri,
      fi,
    };
    strokeRef.current = s;
    applyStroke(s, p);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = cellAt(e);
    if (coordRef.current) {
      const ok = p.x >= 0 && p.y >= 0 && p.x < frame.w && p.y < frame.h;
      coordRef.current.textContent = ok ? `${p.x}, ${p.y}` : "";
    }
    if (selStart.current) {
      setSel(selectionRect(selStart.current, p, frame.w, frame.h));
      return;
    }
    const s = strokeRef.current;
    if (!s || (p.x === s.last.x && p.y === s.last.y)) return;
    applyStroke(s, p);
  };

  const endStroke = () => {
    selStart.current = null;
    const s = strokeRef.current;
    if (!s) return;
    strokeRef.current = null;
    replaceFrame(s.ri, s.fi, s.work);
    setDraft(null);
  };

  // ---------- AI region edit ----------

  const runAi = async () => {
    if (!sel || !aiPrompt.trim() || aiBusy) return;
    setAiBusy(true);
    setAiError("");
    try {
      const legend = buildLegend(kit);
      const targets = aiAll ? row.frames.map((_, i) => i) : [fi];
      const edits: { fi: number; rows: string[] }[] = [];
      for (const i of targets) {
        const f = row.frames[i];
        if (f.w !== frame.w || f.h !== frame.h) continue;
        const r = await aiInpaint({ rows: encodeSprite(f, legend), mask: { rect: sel }, prompt: aiPrompt.trim(), kit, images: aiRef ? [aiRef] : undefined });
        edits.push({ fi: i, rows: r.rows });
      }
      setProposal(applyRegionToRow(rows, ri, edits, sel, kit, true));
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "The AI edit failed.");
    } finally {
      setAiBusy(false);
    }
  };
  const acceptAi = () => {
    if (proposal) commitRows(proposal);
    setProposal(null);
  };
  const discardAi = () => setProposal(null);

  // ---------- frame + row ops ----------

  const setFrames = (frames: Sprite[], select: number) => {
    commitRows(replaceAt(rows, ri, { ...row, frames }));
    setFi(select);
  };
  const addFrame = () => setFrames([...row.frames.slice(0, fi + 1), createSprite(frame.w, frame.h), ...row.frames.slice(fi + 1)], fi + 1);
  const dupFrame = () => setFrames([...row.frames.slice(0, fi + 1), cloneSprite(frame), ...row.frames.slice(fi + 1)], fi + 1);
  const delFrame = () => {
    if (row.frames.length < 2) return;
    setFrames(row.frames.filter((_, i) => i !== fi), Math.min(fi, row.frames.length - 2));
  };
  const moveFrame = (dir: -1 | 1) => {
    const to = fi + dir;
    if (to < 0 || to >= row.frames.length) return;
    setFrames(moveItem(row.frames, fi, to), to);
  };

  const applySize = () => {
    const w = Math.max(1, Math.min(256, Math.round(sizeW) || frame.w));
    const h = Math.max(1, Math.min(256, Math.round(sizeH) || frame.h));
    if (w === frame.w && h === frame.h) return;
    commitRows(rows.map((r) => ({ ...r, frames: r.frames.map((f) => resizeSprite(f, w, h, anchor)) })));
  };

  const reoutline = () => {
    const fix = (s: Sprite) => applyOutline(stripOutline(s), kit);
    if (allFrames) commitRows(replaceAt(rows, ri, { ...row, frames: row.frames.map(fix) }));
    else replaceFrame(ri, fi, fix(frame));
  };

  const dirty = hist.present !== startRows || fps !== (asset.fps || 6);

  const save = () => onSave({ ...asset, rows: hist.present, fps, updatedAt: Date.now() });
  const requestClose = () => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  };

  const doUndo = () => setHist((h) => undo(h));
  const doRedo = () => setHist((h) => redo(h));

  // keyboard (handlers kept in a ref so the listener is registered once)
  const stepFrame = (d: number) => setFi(Math.max(0, Math.min(row.frames.length - 1, fi + d)));
  const latest = useRef({ doUndo, doRedo, save, requestClose, stepFrame });
  latest.current = { doUndo, doRedo, save, requestClose, stepFrame };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      const L = latest.current;
      if (e.ctrlKey || e.metaKey) {
        if (k === "z") { e.preventDefault(); if (e.shiftKey) L.doRedo(); else L.doUndo(); }
        else if (k === "y") { e.preventDefault(); L.doRedo(); }
        else if (k === "s") { e.preventDefault(); L.save(); }
        return;
      }
      if (e.altKey) return;
      if (TOOL_KEYS[k]) { setTool(TOOL_KEYS[k]); e.preventDefault(); }
      else if (k === "m") setMirror((v) => !v);
      else if (k === "h") setGrid((v) => !v);
      else if (k === "o") setOnion((v) => !v);
      else if (k === "p") setPlaying((v) => !v);
      else if (k === "+" || k === "=") setZoom((z) => Math.min(48, z + 1));
      else if (k === "-") setZoom((z) => Math.max(1, z - 1));
      else if (k === ",") L.stepFrame(-1);
      else if (k === ".") L.stepFrame(1);
      else if (k === "escape") L.requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---------- derived UI data ----------

  const used = useMemo(() => {
    const counts = new Map<number, number>();
    for (const v of frame.data) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k]) => k);
  }, [frame]);

  const previewFrame = playing ? row.frames[playIdx % row.frames.length] : frame;
  const pw = frame.w * zoom, ph = frame.h * zoom;
  const gridStyle =
    grid && zoom >= 4
      ? {
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,.14) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.14) 1px, transparent 1px)",
          backgroundSize: `${zoom}px ${zoom}px`,
        }
      : undefined;

  const swatch = (idx: number, title: string) => (
    <button
      key={idx}
      type="button"
      className={"pe-swatch" + (idx === color ? " is-active" : "")}
      style={idx ? { background: pal[idx] ?? "#000" } : undefined}
      title={title}
      onClick={() => setColor(idx)}
    />
  );

  return (
    <div className="pe-overlay" role="dialog" aria-modal="true" aria-label={`Pixel editor: ${asset.name}`}>
      <header className="pe-header">
        <strong className="pe-title">{asset.name}</strong>
        <span className="pe-dim">{frame.w} x {frame.h}</span>
        <span className="pe-spacer" />
        <button type="button" onClick={doUndo} disabled={!canUndo(hist)} title="Undo (Ctrl+Z)">Undo</button>
        <button type="button" onClick={doRedo} disabled={!canRedo(hist)} title="Redo (Ctrl+Shift+Z / Ctrl+Y)">Redo</button>
        <span className="pe-sep" />
        <button type="button" onClick={() => setZoom((z) => Math.max(1, z - 1))} title="Zoom out (-)">-</button>
        <span className="pe-zoom">{zoom}x</span>
        <button type="button" onClick={() => setZoom((z) => Math.min(48, z + 1))} title="Zoom in (+)">+</button>
        <label className="pe-check" title="Toggle grid (H)"><input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} />Grid</label>
        <span className="pe-sep" />
        <button type="button" onClick={requestClose}>Close</button>
        <button type="button" className="pe-primary" onClick={save} title="Save (Ctrl+S)">Save</button>
      </header>

      <div className="pe-body">
        <nav className="pe-tools" aria-label="Tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={"pe-tool" + (tool === t.id ? " is-active" : "")}
              title={`${t.label} (${t.key}) - ${t.hint}`}
              onClick={() => setTool(t.id)}
            >
              <span>{t.label}</span><kbd>{t.key}</kbd>
            </button>
          ))}
          <button
            type="button"
            className={"pe-tool" + (mirror ? " is-active" : "")}
            title="Mirror horizontally while drawing (M)"
            onClick={() => setMirror((v) => !v)}
          >
            <span>Mirror</span><kbd>M</kbd>
          </button>
          {tool === "rect" && (
            <label className="pe-check"><input type="checkbox" checked={filled} onChange={(e) => setFilled(e.target.checked)} />Filled</label>
          )}
        </nav>

        <main className="pe-main">
          <div className="pe-scroll">
            <div className="pe-stage" style={{ width: pw, height: ph }}>
              <canvas
                ref={canvasRef}
                className="pe-canvas"
                style={{ width: pw, height: ph, imageRendering: "pixelated" }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endStroke}
                onPointerCancel={endStroke}
                onPointerLeave={() => { if (coordRef.current) coordRef.current.textContent = ""; }}
                onContextMenu={(e) => e.preventDefault()}
              />
              {gridStyle && <div className="pe-grid" style={gridStyle} />}
              {sel && (
                <div
                  className={"pe-sel" + (proposal ? " is-preview" : "")}
                  style={{ left: sel.x * zoom, top: sel.y * zoom, width: sel.w * zoom, height: sel.h * zoom }}
                />
              )}
              {mirror && <div className="pe-mirror-line" style={{ left: pw / 2 }} />}
            </div>
          </div>

          <section className="pe-frames" aria-label="Frames">
            <div className="pe-frames-bar">
              {rows.length > 1 && (
                <select value={ri} onChange={(e) => { setRi(Number(e.target.value)); setFi(0); }} aria-label="Animation row">
                  {rows.map((r, i) => <option key={i} value={i}>{r.name}</option>)}
                </select>
              )}
              {rows.length === 1 && <span className="pe-dim">{row.name}</span>}
              <button type="button" onClick={addFrame} title="Add a blank frame after this one">Add</button>
              <button type="button" onClick={dupFrame} title="Duplicate frame">Duplicate</button>
              <button type="button" onClick={delFrame} disabled={row.frames.length < 2} title="Delete frame">Delete</button>
              <button type="button" onClick={() => moveFrame(-1)} disabled={fi === 0} title="Move frame left">&larr;</button>
              <button type="button" onClick={() => moveFrame(1)} disabled={fi === row.frames.length - 1} title="Move frame right">&rarr;</button>
              <label className="pe-check" title="Show the previous frame faintly (O)"><input type="checkbox" checked={onion} onChange={(e) => setOnion(e.target.checked)} />Onion skin</label>
              <button type="button" className={playing ? "is-active" : ""} onClick={() => setPlaying((v) => !v)} title="Play preview (P)">{playing ? "Stop" : "Play"}</button>
              <label className="pe-check">FPS
                <input type="number" min={1} max={60} value={fps} onChange={(e) => setFps(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
              </label>
              <span className="pe-spacer" />
              <span className="pe-dim">frame {fi + 1}/{row.frames.length}</span>
              <span className="pe-dim pe-coords" ref={coordRef} />
            </div>
            <div className="pe-frame-list">
              {row.frames.map((f, i) => (
                <button
                  key={i}
                  type="button"
                  className={"pe-frame" + (i === fi ? " is-active" : "")}
                  onClick={() => setFi(i)}
                  title={`Frame ${i + 1}`}
                >
                  <SpriteThumb sprite={i === fi && draft ? draft : f} pal={pal} scale={Math.max(1, Math.floor(56 / Math.max(f.w, f.h)))} className="pe-thumb" />
                  <span>{i + 1}</span>
                </button>
              ))}
            </div>
          </section>
        </main>

        <aside className="pe-side">
          <h3>Palette <span className="pe-dim">{kit.name}</span></h3>
          <div className="pe-used">
            {swatch(0, "Transparent")}
            {used.map((idx) => swatch(idx, "Used in this frame"))}
          </div>
          <div className="pe-ramps">
            {MATERIALS.map((m) => (
              <div className="pe-ramp" key={m}>
                <span className="pe-ramp-name">{m}</span>
                {Array.from({ length: RAMP_LEN }, (_, l) => swatch(colorIndex(m, l), `${m} ${l + 1}/${RAMP_LEN} ${ramps[m][l] ?? ""}`))}
              </div>
            ))}
          </div>

          <h3>Preview</h3>
          <div className="pe-preview">
            <SpriteThumb sprite={previewFrame} pal={pal} scale={Math.max(1, Math.floor(96 / Math.max(frame.w, frame.h)))} className="pe-preview-canvas" />
            <SpriteThumb sprite={previewFrame} pal={pal} scale={1} className="pe-preview-canvas" />
          </div>

          <h3>Tools</h3>
          <div className="pe-row">
            <button type="button" onClick={reoutline} disabled={kit.outline === "none"} title={kit.outline === "none" ? "The kit has outlines turned off" : "Strip the outer outline and apply the kit's outline again"}>
              Re-outline
            </button>
            <label className="pe-check"><input type="checkbox" checked={allFrames} onChange={(e) => setAllFrames(e.target.checked)} />Whole row</label>
          </div>

          <h3>AI region edit</h3>
          <div className="pe-ai">
            <p className="pe-dim pe-note">
              {sel ? `Selected ${sel.w} x ${sel.h} at ${sel.x}, ${sel.y}.` : "Pick Select + prompt (T) and drag a rectangle."} Only the selection changes; the kit outline is re-applied around it.
            </p>
            <textarea
              className="pe-ai-prompt"
              rows={3}
              placeholder="e.g. a red scarf around the neck"
              value={aiPrompt}
              maxLength={300}
              disabled={aiBusy || !!proposal}
              onChange={(e) => setAiPrompt(e.target.value)}
              aria-label="Region edit prompt"
            />
            <AttachReference value={aiRef} onChange={setAiRef} disabled={aiBusy || !!proposal} />
            {row.frames.length > 1 && (
              <label className="pe-check" title="Repaint the same region on every frame of this animation row (one model call per frame)">
                <input type="checkbox" checked={aiAll} disabled={aiBusy || !!proposal} onChange={(e) => setAiAll(e.target.checked)} />Apply to all {row.frames.length} frames
              </label>
            )}
            {asset.source.kind === "rigged" && (
              <p className="pe-dim pe-note">This asset is rigged: edits are lost when it is re-rendered. A rig attachment is the better way to add a scarf or hat.</p>
            )}
            {!proposal ? (
              <button
                type="button"
                className="pe-primary"
                onClick={runAi}
                disabled={!aiEnabled || !sel || !aiPrompt.trim() || aiBusy}
                title={aiEnabled ? (sel ? "Repaint the selected region" : "Select a region first") : "AI is off: set ANTHROPIC_API_KEY on the server (or use the edit_region tool with your own rows)"}
              >
                {aiBusy ? "Painting..." : "Apply"}
              </button>
            ) : (
              <div className="pe-row">
                <button type="button" className="pe-primary" onClick={acceptAi} title="Keep this edit (undoable)">Accept</button>
                <button type="button" onClick={discardAi}>Discard</button>
                <span className="pe-dim">Previewing on the canvas</span>
              </div>
            )}
            {aiEnabled === false && <p className="pe-dim pe-note">AI is off (no API key on the server).</p>}
            {aiError && <p className="pe-error" role="alert">{aiError}</p>}
          </div>

          <h3>Canvas size</h3>
          <div className="pe-row">
            <input type="number" min={1} max={256} value={sizeW} onChange={(e) => setSizeW(Number(e.target.value))} aria-label="Width" />
            <span>x</span>
            <input type="number" min={1} max={256} value={sizeH} onChange={(e) => setSizeH(Number(e.target.value))} aria-label="Height" />
            <select value={anchor} onChange={(e) => setAnchor(e.target.value as Anchor)} aria-label="Anchor">
              <option value="bottom">Bottom</option>
              <option value="center">Center</option>
              <option value="top-left">Top-left</option>
            </select>
            <button type="button" onClick={applySize}>Apply</button>
          </div>
          <p className="pe-dim pe-note">Resizing applies to every frame and keeps the pixels (no scaling).</p>
        </aside>
      </div>
    </div>
  );
}

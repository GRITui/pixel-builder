import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSprite } from "../core/sprite";
import { emptyTileMap, ensureTile, renderTileMap } from "../core/tilemap";
import type { Asset, Category, StyleKit, TileMap } from "../core/types";
import { paintLayers, rgbaTable } from "./editor/canvasUtil";
import {
  canRedo, canUndo, createHistory, floodFillGrid, linePoints, pushHistory, redo, resizeGrid, undo, type History, type Point,
} from "./editor/ops";
import { SpriteThumb } from "./editor/SpriteThumb";
import "./editor/editor.css";
import { paletteFor } from "./render";

export interface MapEditorProps {
  /** A map asset (asset.tilemap is set). */
  asset: Asset;
  kit: StyleKit;
  /** Whole library, so environment/object assets can be added to the tile set. */
  library: Asset[];
  onSave: (a: Asset) => void;
  onClose: () => void;
}

type Tool = "paint" | "erase" | "fill";
type Layer = "ground" | "deco";

const LIBRARY_CATEGORIES: Category[] = ["environment", "object", "building"];

const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: "paint", label: "Paint", key: "B" },
  { id: "erase", label: "Erase", key: "E" },
  { id: "fill", label: "Fill", key: "G" },
];

function copyMap(tm: TileMap): TileMap {
  return { ...tm, tiles: tm.tiles.slice(), ground: tm.ground.slice(), deco: tm.deco.slice() };
}

function clampDim(n: number): number {
  return Math.max(1, Math.min(128, Math.round(n) || 1));
}

export function MapEditor({ asset, kit, library, onSave, onClose }: MapEditorProps) {
  const [startMap] = useState<TileMap>(() => asset.tilemap ?? emptyTileMap(16, 12, kit.sizes.tile));
  const [hist, setHist] = useState<History<TileMap>>(() => createHistory(startMap, 100));
  const [tool, setTool] = useState<Tool>("paint");
  const [layer, setLayer] = useState<Layer>("ground");
  const [selected, setSelected] = useState(0);
  const [zoom, setZoom] = useState(() => Math.max(1, Math.min(8, Math.floor(640 / Math.max(1, startMap.cols * startMap.tile)))));
  const [grid, setGrid] = useState(true);
  const [showSolid, setShowSolid] = useState(false);
  const [draft, setDraft] = useState<TileMap | null>(null);
  const [colsIn, setColsIn] = useState(startMap.cols);
  const [rowsIn, setRowsIn] = useState(startMap.rows);
  const [libCat, setLibCat] = useState<Category | "all">("all");
  const [libQuery, setLibQuery] = useState("");

  const tm = hist.present;
  const shown = draft ?? tm;
  const pal = useMemo(() => paletteFor(kit), [kit]);
  const table = useMemo(() => rgbaTable(pal), [pal]);

  const mapCanvas = useRef<HTMLCanvasElement>(null);
  const solidCanvas = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<HTMLDivElement>(null);
  const coordRef = useRef<HTMLSpanElement>(null);
  const stroke = useRef<{ work: TileMap; last: Point; tool: Tool; layer: Layer; value: number } | null>(null);

  const pxW = shown.cols * shown.tile;
  const pxH = shown.rows * shown.tile;

  useEffect(() => {
    if (!mapCanvas.current) return;
    paintLayers(mapCanvas.current, pxW, pxH, [{ sprite: renderTileMap(shown), alpha: 255 }], table);
  }, [shown, pxW, pxH, table]);

  useEffect(() => {
    const c = solidCanvas.current;
    if (!c || !showSolid) return;
    c.width = pxW;
    c.height = pxH;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, pxW, pxH);
    ctx.fillStyle = "rgba(235, 64, 52, 0.5)";
    for (let y = 0; y < shown.rows; y++)
      for (let x = 0; x < shown.cols; x++) {
        const i = y * shown.cols + x;
        const solid = [shown.ground[i], shown.deco[i]].some((t) => t >= 0 && shown.tiles[t]?.solid);
        if (solid) ctx.fillRect(x * shown.tile, y * shown.tile, shown.tile, shown.tile);
      }
  }, [shown, showSolid, pxW, pxH]);

  const commit = useCallback((next: TileMap) => setHist((h) => pushHistory(h, next)), []);

  // ---------- pointer ----------

  const cellAt = (e: React.PointerEvent<HTMLElement>): Point => {
    const rect = mapCanvas.current!.getBoundingClientRect();
    return {
      x: Math.floor(((e.clientX - rect.left) / rect.width) * tm.cols),
      y: Math.floor(((e.clientY - rect.top) / rect.height) * tm.rows),
    };
  };
  const inMap = (p: Point) => p.x >= 0 && p.y >= 0 && p.x < tm.cols && p.y < tm.rows;

  const paintCells = (s: NonNullable<typeof stroke.current>, p: Point) => {
    for (const q of linePoints(s.last.x, s.last.y, p.x, p.y))
      if (inMap(q)) s.work[s.layer][q.y * tm.cols + q.x] = s.value;
    s.last = p;
    setDraft({ ...s.work });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.button !== 2) return;
    if (stroke.current) return;
    const p = cellAt(e);
    if (!inMap(p)) return;
    const erase = tool === "erase" || e.button === 2;
    // No tiles yet means nothing to paint with.
    const value = erase ? -1 : tm.tiles[selected] ? selected : undefined;
    if (value === undefined) return;
    if (tool === "fill") {
      const next = copyMap(tm);
      next[layer] = floodFillGrid(tm[layer], tm.cols, tm.rows, p.x, p.y, value);
      if (next[layer] !== tm[layer]) commit(next);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const s = { work: copyMap(tm), last: p, tool, layer, value };
    stroke.current = s;
    paintCells(s, p);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = cellAt(e);
    const hover = hoverRef.current;
    if (hover) {
      if (inMap(p)) {
        hover.style.display = "block";
        hover.style.left = `${p.x * tm.tile * zoom}px`;
        hover.style.top = `${p.y * tm.tile * zoom}px`;
        hover.style.width = `${tm.tile * zoom}px`;
        hover.style.height = `${tm.tile * zoom}px`;
      } else hover.style.display = "none";
    }
    if (coordRef.current) coordRef.current.textContent = inMap(p) ? `${p.x}, ${p.y}` : "";
    const s = stroke.current;
    if (!s || (p.x === s.last.x && p.y === s.last.y)) return;
    paintCells(s, p);
  };

  const endStroke = () => {
    const s = stroke.current;
    if (!s) return;
    stroke.current = null;
    commit(s.work);
    setDraft(null);
  };

  const hideHover = () => {
    if (hoverRef.current) hoverRef.current.style.display = "none";
    if (coordRef.current) coordRef.current.textContent = "";
  };

  // ---------- tiles ----------

  const addFromLibrary = (a: Asset) => {
    const sprite = a.rows[0]?.frames[0];
    if (!sprite) return;
    const next = copyMap(tm);
    const idx = ensureTile(next, a.name, sprite, a.category === "building");
    if (next.tiles.length !== tm.tiles.length) commit(next);
    setSelected(idx);
    setTool((t) => (t === "erase" ? "paint" : t));
    // Big props (trees, houses) belong on the deco layer, tile-sized art on the ground.
    setLayer(sprite.w <= tm.tile && sprite.h <= tm.tile && a.category === "environment" ? "ground" : "deco");
  };

  const toggleSolid = () => {
    const t = tm.tiles[selected];
    if (!t) return;
    const next = copyMap(tm);
    next.tiles[selected] = { ...t, solid: !t.solid };
    commit(next);
  };

  const libItems = useMemo(
    () =>
      library.filter(
        (a) =>
          LIBRARY_CATEGORIES.includes(a.category) &&
          (libCat === "all" || a.category === libCat) &&
          a.rows[0]?.frames[0] &&
          a.name.toLowerCase().includes(libQuery.trim().toLowerCase()),
      ),
    [library, libCat, libQuery],
  );

  const applyResize = () => {
    const cols = clampDim(colsIn), rows = clampDim(rowsIn);
    if (cols === tm.cols && rows === tm.rows) return;
    commit({
      ...tm,
      cols,
      rows,
      ground: resizeGrid(tm.ground, tm.cols, tm.rows, cols, rows),
      deco: resizeGrid(tm.deco, tm.cols, tm.rows, cols, rows),
    });
    setColsIn(cols);
    setRowsIn(rows);
  };

  // ---------- save / close / keys ----------

  const dirty = hist.present !== startMap;

  const save = () => {
    const first = asset.rows[0] ?? { name: "map", frames: [] };
    const rendered = renderTileMap(tm);
    const frames = first.frames.length ? [rendered, ...first.frames.slice(1)] : [rendered];
    onSave({ ...asset, tilemap: tm, rows: [{ ...first, frames }, ...asset.rows.slice(1)], updatedAt: Date.now() });
  };
  const requestClose = () => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    onClose();
  };

  const latest = useRef({ save, requestClose });
  latest.current = { save, requestClose };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (k === "z") { e.preventDefault(); setHist((h) => (e.shiftKey ? redo(h) : undo(h))); }
        else if (k === "y") { e.preventDefault(); setHist((h) => redo(h)); }
        else if (k === "s") { e.preventDefault(); latest.current.save(); }
        return;
      }
      if (e.altKey) return;
      if (k === "b") setTool("paint");
      else if (k === "e") setTool("erase");
      else if (k === "g") setTool("fill");
      else if (k === "1") setLayer("ground");
      else if (k === "2") setLayer("deco");
      else if (k === "h") setGrid((v) => !v);
      else if (k === "x") setShowSolid((v) => !v);
      else if (k === "+" || k === "=") setZoom((z) => Math.min(16, z + 1));
      else if (k === "-") setZoom((z) => Math.max(1, z - 1));
      else if (k === "escape") latest.current.requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const cellPx = tm.tile * zoom;
  const gridStyle = grid && cellPx >= 6
    ? {
        backgroundImage:
          "linear-gradient(to right, rgba(255,255,255,.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,.16) 1px, transparent 1px)",
        backgroundSize: `${cellPx}px ${cellPx}px`,
      }
    : undefined;
  const thumbScale = (s: { w: number; h: number }) => Math.max(1, Math.floor(40 / Math.max(s.w, s.h)));
  const selectedTile = tm.tiles[selected];

  return (
    <div className="me-overlay" role="dialog" aria-modal="true" aria-label={`Map editor: ${asset.name}`}>
      <header className="me-header">
        <strong className="me-title">{asset.name}</strong>
        <span className="me-dim">{tm.cols} x {tm.rows} tiles of {tm.tile}px</span>
        <span className="me-dim me-coords" ref={coordRef} />
        <span className="me-spacer" />
        <button type="button" onClick={() => setHist((h) => undo(h))} disabled={!canUndo(hist)} title="Undo (Ctrl+Z)">Undo</button>
        <button type="button" onClick={() => setHist((h) => redo(h))} disabled={!canRedo(hist)} title="Redo (Ctrl+Shift+Z / Ctrl+Y)">Redo</button>
        <span className="me-sep" />
        {TOOLS.map((t) => (
          <button key={t.id} type="button" className={tool === t.id ? "is-active" : ""} onClick={() => setTool(t.id)} title={`${t.label} (${t.key})`}>
            {t.label}
          </button>
        ))}
        <span className="me-sep" />
        <button type="button" className={layer === "ground" ? "is-active" : ""} onClick={() => setLayer("ground")} title="Ground layer (1)">Ground</button>
        <button type="button" className={layer === "deco" ? "is-active" : ""} onClick={() => setLayer("deco")} title="Deco layer (2)">Deco</button>
        <span className="me-sep" />
        <button type="button" onClick={() => setZoom((z) => Math.max(1, z - 1))} title="Zoom out (-)">-</button>
        <span className="me-zoom">{zoom}x</span>
        <button type="button" onClick={() => setZoom((z) => Math.min(16, z + 1))} title="Zoom in (+)">+</button>
        <label className="me-check" title="Toggle grid (H)"><input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} />Grid</label>
        <label className="me-check" title="Show solid tiles (X)"><input type="checkbox" checked={showSolid} onChange={(e) => setShowSolid(e.target.checked)} />Solid</label>
        <span className="me-sep" />
        <button type="button" onClick={requestClose}>Close</button>
        <button type="button" className="me-primary" onClick={save} title="Save (Ctrl+S)">Save</button>
      </header>

      <div className="me-body">
        <aside className="me-side">
          <h3>Tiles <span className="me-dim">{tm.tiles.length}</span></h3>
          {tm.tiles.length === 0 && <p className="me-dim">No tiles yet. Add some from the library below.</p>}
          <div className="me-tiles">
            {tm.tiles.map((t, i) => (
              <button
                key={`${t.name}-${i}`}
                type="button"
                className={"me-tile" + (i === selected ? " is-active" : "")}
                onClick={() => { setSelected(i); if (tool === "erase") setTool("paint"); }}
                title={`${t.name}${t.solid ? " (solid)" : ""}`}
              >
                <SpriteThumb sprite={t.sprite} pal={pal} scale={thumbScale(t.sprite)} className="me-thumb" />
                <span className="me-tile-name">{t.name}{t.solid ? " *" : ""}</span>
              </button>
            ))}
          </div>
          <div className="me-row" style={{ marginTop: 8 }}>
            <button type="button" onClick={toggleSolid} disabled={!selectedTile} title="Mark the selected tile as solid (blocks movement)">
              {selectedTile?.solid ? "Make walkable" : "Make solid"}
            </button>
          </div>

          <h3>Add from library</h3>
          <div className="me-lib-controls">
            <select value={libCat} onChange={(e) => setLibCat(e.target.value as Category | "all")} aria-label="Library category">
              <option value="all">All</option>
              {LIBRARY_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input type="search" placeholder="Search" value={libQuery} onChange={(e) => setLibQuery(e.target.value)} aria-label="Search library" />
          </div>
          <div className="me-lib">
            {libItems.length === 0 && <p className="me-dim">No environment, object or building assets{libQuery ? " match" : " in the library yet"}.</p>}
            <div className="me-tiles">
              {libItems.map((a) => {
                const s = a.rows[0].frames[0] ?? createSprite(1, 1);
                return (
                  <button key={a.id} type="button" className="me-tile" onClick={() => addFromLibrary(a)} title={`Add "${a.name}" (${a.category})`}>
                    <SpriteThumb sprite={s} pal={pal} scale={thumbScale(s)} className="me-thumb" />
                    <span className="me-tile-name">{a.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <h3>Map size</h3>
          <div className="me-row">
            <input type="number" min={1} max={128} value={colsIn} onChange={(e) => setColsIn(Number(e.target.value))} aria-label="Columns" />
            <span>x</span>
            <input type="number" min={1} max={128} value={rowsIn} onChange={(e) => setRowsIn(Number(e.target.value))} aria-label="Rows" />
            <button type="button" onClick={applyResize}>Resize</button>
          </div>
          <p className="me-dim" style={{ fontSize: 12 }}>Resizing keeps the top-left corner and crops or pads with empty cells.</p>
        </aside>

        <main className="me-scroll">
          <div className="me-stage" style={{ width: pxW * zoom, height: pxH * zoom }}>
            <canvas
              ref={mapCanvas}
              className="me-canvas"
              style={{ width: pxW * zoom, height: pxH * zoom }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endStroke}
              onPointerCancel={endStroke}
              onPointerLeave={hideHover}
              onContextMenu={(e) => e.preventDefault()}
            />
            {showSolid && <canvas ref={solidCanvas} className="me-solid" style={{ width: pxW * zoom, height: pxH * zoom }} />}
            {gridStyle && <div className="me-grid" style={gridStyle} />}
            <div ref={hoverRef} className="me-hover" style={{ display: "none" }} />
          </div>
        </main>
      </div>
    </div>
  );
}

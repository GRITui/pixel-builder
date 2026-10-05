import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createAsset } from "../core/asset";
import { downscaleRGBA, finalize, quantizeRGBA } from "../core/enforce";
import { resolveRamps } from "../core/kit";
import { cropToContentImage, detectGrid, downscaleGrid, hasOutline, imageToSprite, makeRampMapper, removeBackgroundFlood, type GridInfo } from "../core/pixelgrid";
import { blit, createSprite } from "../core/sprite";
import { CATEGORIES, type Asset, type Category, type StyleKit } from "../core/types";
import { fitScale } from "./editor/canvasUtil";
import { buildImportSprite, type ImportOptions } from "./editor/importPipeline";
import type { RGBAImage } from "./editor/ops";
import { SpriteThumb } from "./editor/SpriteThumb";
import "./editor/editor.css";
import { fileToRGBA, paletteFor } from "./render";

export interface ImportDialogProps {
  kit: StyleKit;
  /** Category the user is currently in; the dialog may let them change it. */
  category: Category;
  onImport: (a: Asset) => void;
  onClose: () => void;
}

type ImportCategory = Exclude<Category, "map">;

/** Source pixels beyond this are pre-shrunk once so live previews stay snappy. */
const MAX_SOURCE = 768;

const SIZE_PRESETS: { key: keyof StyleKit["sizes"]; label: string }[] = [
  { key: "character", label: "Character" },
  { key: "building", label: "Building" },
  { key: "environment", label: "Environment" },
  { key: "object", label: "Object" },
  { key: "ui", label: "UI" },
  { key: "tile", label: "Tile" },
];

function clampSize(n: number): number {
  return Math.max(2, Math.min(256, Math.round(n) || 2));
}

function capSource(img: RGBAImage): RGBAImage {
  const m = Math.max(img.w, img.h);
  if (m <= MAX_SOURCE) return img;
  const k = MAX_SOURCE / m;
  const w = Math.max(1, Math.round(img.w * k)), h = Math.max(1, Math.round(img.h * k));
  return { data: downscaleRGBA(img.data, img.w, img.h, w, h), w, h };
}

function nameFromFile(f: File): string {
  return f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Imported image";
}

export function ImportDialog({ kit, category, onImport, onClose }: ImportDialogProps) {
  const initialCat: ImportCategory = category === "map" ? "object" : category;
  const [cat, setCat] = useState<ImportCategory>(initialCat);
  const [name, setName] = useState("");
  const [src, setSrc] = useState<RGBAImage | null>(null);
  /** The uncapped source: grid detection and exact downscale need every pixel. */
  const [full, setFull] = useState<RGBAImage | null>(null);
  const [mode, setMode] = useState<"auto" | "pixel-art" | "resample">("auto");
  const [mapping, setMapping] = useState<"nearest" | "ramps">("nearest");
  const [showGrid, setShowGrid] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  const [width, setWidth] = useState(() => kit.sizes[initialCat]);
  const [height, setHeight] = useState(() => kit.sizes[initialCat]);
  const [crop, setCrop] = useState(true);
  const [removeBg, setRemoveBg] = useState(true);
  const [bgTolerance, setBgTolerance] = useState(28);
  const [outline, setOutline] = useState(true);
  const [cleanup, setCleanup] = useState(true);
  const [pad, setPad] = useState(true);

  const pal = useMemo(() => paletteFor(kit), [kit]);
  const origCanvas = useRef<HTMLCanvasElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async (file: File | undefined | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("That file is not an image.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const raw = await fileToRGBA(file);
      setFull(raw);
      setSrc(capSource(raw));
      setName((n) => n || nameFromFile(file));
    } catch {
      setError("Could not read that image.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // original preview: paint raw RGBA at its natural size, CSS does the fitting
  // grid detection runs on the uncapped source
  const grid: GridInfo | null = useMemo(
    () => (full ? detectGrid({ width: full.w, height: full.h, rgba: full.data }) : null),
    [full],
  );
  const isPixelArt = mode === "pixel-art" ? !!grid && grid.scale >= 1 : mode === "auto" && !!grid && grid.scale >= 2 && grid.confidence >= 0.6;
  const exact: RGBAImage | null = useMemo(() => {
    if (!full || !grid || !isPixelArt) return null;
    const d = downscaleGrid({ width: full.w, height: full.h, rgba: full.data }, grid);
    return { data: new Uint8ClampedArray(d.rgba), w: d.width, h: d.height };
  }, [full, grid, isPixelArt]);

  // an existing outline is kept: default the outline box from the recovered art
  useEffect(() => {
    if (exact) setOutline(!hasOutline({ width: exact.w, height: exact.h, rgba: exact.data }));
  }, [exact]);

  useEffect(() => {
    const c = origCanvas.current;
    if (!c || !src) return;
    c.width = src.w;
    c.height = src.h;
    const ctx = c.getContext("2d");
    ctx?.putImageData(new ImageData(new Uint8ClampedArray(src.data), src.w, src.h), 0, 0);
    if (ctx && showGrid && grid && grid.scale >= 2 && full) {
      const f = src.w / full.w;
      ctx.strokeStyle = "rgba(255,0,200,0.55)";
      ctx.lineWidth = Math.max(1, src.w / 500);
      ctx.beginPath();
      for (let x = grid.offsetX; x <= full.w; x += grid.scale) { ctx.moveTo(x * f, 0); ctx.lineTo(x * f, src.h); }
      for (let y = grid.offsetY; y <= full.h; y += grid.scale) { ctx.moveTo(0, y * f); ctx.lineTo(src.w, y * f); }
      ctx.stroke();
    }
  }, [src, full, grid, showGrid]);

  const options: ImportOptions = useMemo(
    () => ({
      width: clampSize(width),
      height: clampSize(height),
      crop,
      removeBg,
      bgTolerance,
      outline,
      cleanup,
      pad,
      anchor: cat === "character" || cat === "building" ? "bottom" : "center",
    }),
    [width, height, crop, removeBg, bgTolerance, outline, cleanup, pad, cat],
  );

  const result = useMemo(() => {
    if (!src) return null;
    if (!exact) {
      // resample keeps the original behaviour (nearest only)
      return buildImportSprite(src, options, kit);
    }
    let img = { width: exact.w, height: exact.h, rgba: exact.data as Uint8Array | Uint8ClampedArray };
    if (removeBg) img = removeBackgroundFlood(img, { tolerance: bgTolerance });
    if (crop) img = cropToContentImage(img);
    const m = outline && kit.outline !== "none" ? 1 : 0;
    const canvas = createSprite(img.width + 2 * m, img.height + 2 * m);
    const q = mapping === "ramps" ? makeRampMapper([img], resolveRamps(kit)) : null;
    const flat = { data: new Uint8ClampedArray(img.rgba), w: img.width, h: img.height };
    blit(canvas, q ? imageToSprite(img, q) : quantizeRGBA(flat.data, flat.w, flat.h, kit), m, m);
    return finalize(canvas, kit, { outline: m > 0, cleanup });
  }, [src, exact, options, kit, removeBg, bgTolerance, crop, outline, cleanup, mapping]);
  const empty = result ? result.data.every((v) => v === 0) : false;

  const pickCategory = (c: ImportCategory) => {
    setCat(c);
    setWidth(kit.sizes[c]);
    setHeight(kit.sizes[c]);
  };

  const doImport = () => {
    if (!result || empty) return;
    onImport(
      createAsset({
        name: name.trim() || "Imported image",
        category: cat,
        kit,
        rows: [{ name: "idle", frames: [result] }],
        source: { kind: "import" },
      }),
    );
  };

  const origScale = src && Math.max(src.w, src.h) < 96 ? "pixelated" : "auto";

  return (
    <div className="id-overlay" role="dialog" aria-modal="true" aria-label="Import image" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="id-dialog">
        <header className="id-header">
          <h2>Import image</h2>
          <button type="button" onClick={() => fileInput.current?.click()}>Choose file</button>
          <button type="button" onClick={onClose}>Close</button>
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => { void load(e.target.files?.[0]); e.target.value = ""; }} />
        </header>

        <div className="id-body">
          <div className="id-controls">
            <label className="id-field">
              <span>Name</span>
              <input type="text" value={name} placeholder="Imported image" onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="id-field">
              <span>Category</span>
              <select value={cat} onChange={(e) => pickCategory(e.target.value as ImportCategory)}>
                {CATEGORIES.filter((c) => c.id !== "map").map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>

            <div className="id-field">
              <span>Target size (from the kit)</span>
              <div className="id-presets">
                {SIZE_PRESETS.map((p) => {
                  const n = kit.sizes[p.key];
                  const active = width === n && height === n;
                  return (
                    <button key={p.key} type="button" className={active ? "is-active" : ""} onClick={() => { setWidth(n); setHeight(n); }} title={`${p.label}: ${n} x ${n}`}>
                      {p.label} {n}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="id-field">
              <span>Custom size</span>
              <div className="id-size-row">
                <input type="number" min={2} max={256} value={width} onChange={(e) => setWidth(Number(e.target.value))} aria-label="Width" />
                <span>x</span>
                <input type="number" min={2} max={256} value={height} onChange={(e) => setHeight(Number(e.target.value))} aria-label="Height" />
                <span className="id-dim">px</span>
              </div>
            </div>

            <div className="id-field">
              <span>Source type</span>
              <div className="id-presets">
                {([["auto", "Auto"], ["pixel-art", "Pixel art"], ["resample", "Photo / art"]] as const).map(([k, label]) => (
                  <button key={k} type="button" className={mode === k ? "is-active" : ""} onClick={() => setMode(k)}>{label}</button>
                ))}
              </div>
              {grid && (
                <span className="id-dim" style={{ fontSize: 12 }}>
                  {exact
                    ? `Pixel grid ${grid.scale}x, offset ${grid.offsetX},${grid.offsetY}, confidence ${Math.round(grid.confidence * 100)}%. Recovered at true size ${exact.w} x ${exact.h}.`
                    : mode === "pixel-art" ? "No pixel grid found." : grid.scale >= 2 ? `Possible grid ${grid.scale}x (confidence ${Math.round(grid.confidence * 100)}%), treated as a picture.` : "No pixel grid found: treated as a picture."}
                </span>
              )}
            </div>
            {exact && (
              <>
                <div className="id-field">
                  <span>Palette mapping</span>
                  <div className="id-presets">
                    <button type="button" className={mapping === "nearest" ? "is-active" : ""} onClick={() => setMapping("nearest")} title="Closest kit colour">Nearest</button>
                    <button type="button" className={mapping === "ramps" ? "is-active" : ""} onClick={() => setMapping("ramps")} title="Each source hue becomes one material ramp, so shading survives">Keep ramps</button>
                  </div>
                </div>
                <label className="id-check"><input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />Show detected grid</label>
              </>
            )}
            {!exact && <label className="id-check"><input type="checkbox" checked={pad} onChange={(e) => setPad(e.target.checked)} />Fill the exact canvas size (keeps proportions)</label>}
            <label className="id-check"><input type="checkbox" checked={removeBg} onChange={(e) => setRemoveBg(e.target.checked)} />Remove background (corner colour)</label>
            {removeBg && (
              <label className="id-field">
                <span>Background tolerance {bgTolerance}</span>
                <div className="id-range"><input type="range" min={0} max={120} value={bgTolerance} onChange={(e) => setBgTolerance(Number(e.target.value))} /></div>
              </label>
            )}
            <label className="id-check"><input type="checkbox" checked={crop} onChange={(e) => setCrop(e.target.checked)} />Crop to content</label>
            <label className="id-check"><input type="checkbox" checked={outline} onChange={(e) => setOutline(e.target.checked)} />Outline ({kit.outline === "none" ? "kit has none" : `kit: ${kit.outline}`})</label>
            <label className="id-check"><input type="checkbox" checked={cleanup} onChange={(e) => setCleanup(e.target.checked)} />Remove stray pixels</label>
            <p className="id-dim" style={{ fontSize: 12, margin: 0 }}>Colours snap to the kit palette ({kit.name}) so imports match everything else.</p>
          </div>

          {src ? (
            <div
              className="id-previews"
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); void load(e.dataTransfer.files[0]); }}
            >
              <div className="id-pane">
                <h3>Original {full?.w ?? src.w} x {full?.h ?? src.h}{exact ? ` (grid ${grid?.scale}x)` : ""}</h3>
                <div className={"id-frame" + (over ? " is-over" : "")}>
                  <canvas ref={origCanvas} style={{ imageRendering: origScale }} />
                </div>
              </div>
              <div className="id-pane">
                <h3>Result {result?.w} x {result?.h}</h3>
                <div className="id-frame">
                  {result && <SpriteThumb sprite={result} pal={pal} scale={fitScale(result.w, result.h, 240)} />}
                </div>
                {empty && <span className="id-error">Nothing is left. Try turning off background removal or lowering the tolerance.</span>}
              </div>
            </div>
          ) : (
            <div
              className={"id-drop" + (over ? " is-over" : "")}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); void load(e.dataTransfer.files[0]); }}
            >
              <p>{loading ? "Reading image..." : "Drop an image here, or"}</p>
              {!loading && <button type="button" onClick={() => fileInput.current?.click()}>Choose file</button>}
              <p className="id-dim">PNG, JPEG, GIF or WebP. It will be shrunk and snapped to the kit palette.</p>
            </div>
          )}
        </div>

        <footer className="id-footer">
          {error && <span className="id-error">{error}</span>}
          <span className="id-spacer" />
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="id-primary" onClick={doImport} disabled={!result || empty || loading}>Import</button>
        </footer>
      </div>
    </div>
  );
}

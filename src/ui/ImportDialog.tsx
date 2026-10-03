import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createAsset } from "../core/asset";
import { downscaleRGBA } from "../core/enforce";
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
      const img = capSource(await fileToRGBA(file));
      setSrc(img);
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
  useEffect(() => {
    const c = origCanvas.current;
    if (!c || !src) return;
    c.width = src.w;
    c.height = src.h;
    c.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(src.data), src.w, src.h), 0, 0);
  }, [src]);

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

  const result = useMemo(() => (src ? buildImportSprite(src, options, kit) : null), [src, options, kit]);
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

            <label className="id-check"><input type="checkbox" checked={pad} onChange={(e) => setPad(e.target.checked)} />Fill the exact canvas size (keeps proportions)</label>
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
                <h3>Original {src.w} x {src.h}</h3>
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

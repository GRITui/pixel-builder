import { useEffect, useRef, useState } from "react";
import type { Asset, StyleKit } from "../../core/types";
import { EXPORT_SCALES, exportAseprite, exportMap, exportPng, exportSpritesheet } from "../exportAsset";

export function ExportMenu({ asset, kit, onError, align = "left", label = "Export" }: { asset: Asset; kit: StyleKit; onError: (m: string) => void; align?: "left" | "right"; label?: string }) {
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState<number>(4);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = (fn: () => Promise<void>) => () => {
    setOpen(false);
    fn().catch((e) => onError(e instanceof Error ? e.message : "Export failed"));
  };
  const animated = asset.rows.length > 1 || asset.rows[0].frames.length > 1;
  const isMap = !!asset.tilemap;

  return (
    <div className="menu-wrap" ref={box}>
      <button onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        {label} ▾
      </button>
      {open && (
        <div className={`menu ${align}`} role="menu">
          <div className="menu-row">
            <span className="dim">Scale</span>
            <div className="seg" role="group" aria-label="Export scale">
              {EXPORT_SCALES.map((s) => (
                <button key={s} className={scale === s ? "on" : ""} onClick={() => setScale(s)}>
                  {s}x
                </button>
              ))}
            </div>
          </div>
          <button role="menuitem" onClick={run(() => exportPng(asset, kit, scale))}>
            {isMap ? "Map PNG" : "PNG (first frame)"}
          </button>
          {animated && (
            <button role="menuitem" onClick={run(() => exportSpritesheet(asset, kit, scale))}>
              Spritesheet PNG + JSON
            </button>
          )}
          <button role="menuitem" onClick={run(() => exportAseprite(asset, kit))}>
            Aseprite (.aseprite)
          </button>
          {isMap && (
            <button role="menuitem" onClick={run(() => exportMap(asset, kit, scale))}>
              Tiled map (.tmj) + tileset + PNG
            </button>
          )}
        </div>
      )}
    </div>
  );
}

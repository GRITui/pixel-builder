import { useState } from "react";
import type { Asset, Reference } from "../../core/types";
import { refDataUrl } from "../refs";
import type { FlatPalette } from "../render";
import { SpriteCanvas } from "./SpriteView";

const BOX = 240;

/** Split-slider compare: reference on the left of the handle, the asset on the right, same display box. */
export function CompareView({ asset, reference, pal }: { asset: Asset; reference: Reference; pal: FlatPalette }) {
  const [split, setSplit] = useState(50);
  const f = asset.rows[0].frames[0];
  const scale = Math.max(1, Math.floor(BOX / Math.max(f.w, f.h)));
  const w = f.w * scale, h = f.h * scale;
  return (
    <div className="compare" style={{ width: w }}>
      <div className="compare-stage checker" style={{ width: w, height: h, position: "relative" }}>
        <SpriteCanvas sprite={f} pal={pal} scale={scale} />
        <img
          src={refDataUrl(reference)}
          alt={`Reference ${reference.name}`}
          style={{ position: "absolute", inset: 0, width: w, height: h, objectFit: "fill", imageRendering: "pixelated", clipPath: `inset(0 ${100 - split}% 0 0)` }}
        />
        <div style={{ position: "absolute", top: 0, bottom: 0, left: `${split}%`, width: 2, background: "var(--accent, #fff)" }} />
      </div>
      <input type="range" min={0} max={100} value={split} aria-label="Compare split: reference left, asset right" onChange={(e) => setSplit(Number(e.target.value))} style={{ width: "100%" }} />
      <div className="dim">
        {reference.name} | {asset.name}
        {typeof asset.meta?.matchScore === "number" ? ` | match ${asset.meta.matchScore}` : ""}
      </div>
    </div>
  );
}

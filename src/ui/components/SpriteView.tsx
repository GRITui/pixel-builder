import { useEffect, useRef, useState } from "react";
import type { FrameSet, Sprite } from "../../core/types";
import { drawSprite, type FlatPalette } from "../render";

/** Static sprite on a canvas, `scale` px per art pixel. */
export function SpriteCanvas({ sprite, pal, scale = 1, className = "" }: { sprite: Sprite; pal: FlatPalette; scale?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    c.width = sprite.w * scale;
    c.height = sprite.h * scale;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    drawSprite(ctx, sprite, pal, 0, 0, scale);
  }, [sprite, pal, scale]);
  return <canvas ref={ref} className={`px ${className}`} />;
}

/** Largest integer scale that fits `box` px (never below 1). */
export function fitScale(w: number, h: number, boxW: number, boxH = boxW, max = 16): number {
  return Math.max(1, Math.min(max, Math.floor(Math.min(boxW / w, boxH / h))));
}

/**
 * Fixed-size thumbnail showing the first frame; plays the first row on hover/focus.
 * Large sprites (maps) are drawn at 1x and shrunk by CSS with pixelated sampling.
 */
export function AnimThumb({ rows, fps, pal, size = 80, alwaysPlay = false }: { rows: FrameSet[]; fps: number; pal: FlatPalette; size?: number; alwaysPlay?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState(false);
  const frames = rows[0].frames;
  const f0 = frames[0];
  const scale = fitScale(f0.w, f0.h, size);
  const play = (hover || alwaysPlay) && frames.length > 1;

  useEffect(() => {
    const c = ref.current!;
    const draw = (i: number) => {
      const f = frames[i % frames.length];
      c.width = f.w * scale;
      c.height = f.h * scale;
      const ctx = c.getContext("2d")!;
      ctx.clearRect(0, 0, c.width, c.height);
      drawSprite(ctx, f, pal, 0, 0, scale);
    };
    draw(0);
    if (!play) return;
    let i = 0;
    const t = setInterval(() => draw(++i), 1000 / Math.max(1, fps));
    return () => clearInterval(t);
  }, [frames, pal, scale, fps, play]);

  return (
    <div
      className="thumb checker"
      style={{ width: size, height: size }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
    >
      <canvas ref={ref} className="px" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
    </div>
  );
}

export type PreviewBg = "checker" | "dark" | "light";

/**
 * Preview of every animation row, animated at `fps` by ONE interval for the whole
 * preview. `zoom` 0 = auto (largest integer scale that fits).
 */
export function LivePreview({ rows, fps, pal, zoom, bg }: { rows: FrameSet[]; fps: number; pal: FlatPalette; zoom: number; bg: PreviewBg }) {
  const refs = useRef<(HTMLCanvasElement | null)[]>([]);
  const maxW = Math.max(...rows.flatMap((r) => r.frames.map((f) => f.w)));
  const maxH = Math.max(...rows.flatMap((r) => r.frames.map((f) => f.h)));
  const multi = rows.length > 1;
  const z = zoom > 0 ? zoom : multi ? fitScale(maxW, maxH, rows.length <= 3 ? 240 : 176, 200) : fitScale(maxW, maxH, 560, 380);
  const animated = rows.some((r) => r.frames.length > 1);

  useEffect(() => {
    const draw = (tick: number) => {
      rows.forEach((r, i) => {
        const c = refs.current[i];
        if (!c) return;
        const f = r.frames[tick % r.frames.length];
        c.width = f.w * z;
        c.height = f.h * z;
        const ctx = c.getContext("2d")!;
        ctx.clearRect(0, 0, c.width, c.height);
        drawSprite(ctx, f, pal, 0, 0, z);
      });
    };
    let tick = 0;
    draw(0);
    if (!animated) return;
    const t = setInterval(() => draw(++tick), 1000 / Math.max(1, fps));
    return () => clearInterval(t);
  }, [rows, pal, z, fps, animated]);

  return (
    <div className={`preview-stage bg-${bg} ${multi ? "multi" : ""}`}>
      {rows.map((r, i) => (
        <figure key={r.name + i} className={`preview-row ${bg === "checker" ? "checker" : ""}`}>
          <canvas ref={(el) => void (refs.current[i] = el)} className="px" />
          {multi && (
            <figcaption>
              {r.name} <span className="dim">{r.frames.length}f</span>
            </figcaption>
          )}
        </figure>
      ))}
    </div>
  );
}

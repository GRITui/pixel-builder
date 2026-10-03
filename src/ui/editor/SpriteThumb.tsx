import { useEffect, useMemo, useRef } from "react";
import type { Sprite } from "../../core/types";
import type { FlatPalette } from "../render";
import { paintLayers, rgbaTable } from "./canvasUtil";

interface Props {
  sprite: Sprite;
  pal: FlatPalette;
  /** Screen pixels per art pixel. */
  scale: number;
  className?: string;
}

/** A crisp, pixelated sprite preview. */
export function SpriteThumb({ sprite, pal, scale, className }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const table = useMemo(() => rgbaTable(pal), [pal]);
  useEffect(() => {
    if (ref.current) paintLayers(ref.current, sprite.w, sprite.h, [{ sprite, alpha: 255 }], table);
  }, [sprite, table]);
  return (
    <canvas
      ref={ref}
      className={className}
      style={{ width: sprite.w * scale, height: sprite.h * scale, imageRendering: "pixelated" }}
    />
  );
}

// Image -> kit-palette sprite, pure so the dialog preview and tests share it.
import { downscaleRGBA, finalize, quantizeRGBA } from "../../core/enforce";
import { blit, createSprite } from "../../core/sprite";
import type { Sprite, StyleKit } from "../../core/types";
import { cropToContent, removeBackground, type RGBAImage } from "./ops";

export interface ImportOptions {
  /** Target canvas (or the bounding box when `pad` is off). */
  width: number;
  height: number;
  crop: boolean;
  removeBg: boolean;
  bgTolerance: number;
  outline: boolean;
  cleanup: boolean;
  /** Output exactly width x height with the picture anchored inside. */
  pad: boolean;
  anchor: "bottom" | "center";
}

export function buildImportSprite(src: RGBAImage, o: ImportOptions, kit: StyleKit): Sprite {
  let img = src;
  if (o.removeBg) img = removeBackground(img, o.bgTolerance);
  if (o.crop) img = cropToContent(img);

  const margin = o.outline && kit.outline !== "none" ? 1 : 0;
  const bw = Math.max(1, o.width - margin * 2), bh = Math.max(1, o.height - margin * 2);
  const scale = Math.min(bw / img.w, bh / img.h);
  const fw = Math.max(1, Math.min(bw, Math.round(img.w * scale)));
  const fh = Math.max(1, Math.min(bh, Math.round(img.h * scale)));
  const small = quantizeRGBA(downscaleRGBA(img.data, img.w, img.h, fw, fh), fw, fh, kit);

  const cw = o.pad ? o.width : fw + margin * 2;
  const ch = o.pad ? o.height : fh + margin * 2;
  const canvas = createSprite(cw, ch);
  const dx = Math.floor((cw - fw) / 2);
  const dy = o.pad ? (o.anchor === "bottom" ? ch - margin - fh : Math.floor((ch - fh) / 2)) : margin;
  blit(canvas, small, dx, dy);
  return finalize(canvas, kit, { outline: margin > 0, cleanup: o.cleanup });
}

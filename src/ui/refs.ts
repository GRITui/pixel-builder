// Browser side of the reference library: decode any image the browser can (PNG, JPEG,
// WebP, GIF first frame) via canvas, build the `Reference` record with a <=512px preview.
import { newId } from "../core/kit";
import { REFERENCE_MAX_DIM, REFERENCE_PREVIEW_MAX, type Reference } from "../core/types";

export const REFERENCE_MAX_BYTES = 10 * 1024 * 1024;
export const refDataUrl = (r: Reference) => `data:image/png;base64,${r.preview}`;

async function decodeBlob(blob: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(blob);
  } catch {
    throw new Error("Could not read that image (unsupported or corrupt file).");
  }
}

/** Validate and convert an image file/blob into a Reference (preview inline). */
export async function referenceFromBlob(blob: Blob, opts: { name: string; source: Reference["source"]; tags?: string[] }): Promise<Reference> {
  if (blob.size > REFERENCE_MAX_BYTES) throw new Error(`Image is larger than ${REFERENCE_MAX_BYTES / 1048576} MB.`);
  if (blob.type && !blob.type.startsWith("image/")) throw new Error("Not an image file.");
  const bmp = await decodeBlob(blob);
  try {
    if (bmp.width > REFERENCE_MAX_DIM || bmp.height > REFERENCE_MAX_DIM) throw new Error(`Image is ${bmp.width}x${bmp.height}; the limit is ${REFERENCE_MAX_DIM}px per side.`);
    const k = Math.min(1, REFERENCE_PREVIEW_MAX / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    const preview = c.toDataURL("image/png").split(",")[1];
    return { id: newId("ref"), name: opts.name, tags: opts.tags ?? [], source: opts.source, width: bmp.width, height: bmp.height, preview, createdAt: Date.now() };
  } finally {
    bmp.close();
  }
}

/** RGBA pixels of a reference's preview ({w,h,data}), the browser twin of node/refs.ts loadReferenceImage. */
export async function loadReferenceImage(project: { references?: Reference[] }, id: string): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
  const ref = project.references?.find((r) => r.id === id);
  if (!ref) throw new Error(`No reference '${id}'.`);
  const bmp = await createImageBitmap(await (await fetch(refDataUrl(ref))).blob());
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height);
  return { w: d.width, h: d.height, data: d.data };
}

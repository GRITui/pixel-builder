// Browser helper: turn a picked image file into a small data URL for the AI endpoints.
// The server re-validates and caps everything; downscaling here keeps requests small.
export const REF_MAX_SIDE = 1024;

/** Target size keeping aspect ratio, long side <= max (never upscales). */
export function fitSize(w: number, h: number, max = REF_MAX_SIDE): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(w, h, 1));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

export async function readReferenceImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Pick an image file.");
  const bmp = await createImageBitmap(file);
  const { w, h } = fitSize(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available.");
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return canvas.toDataURL("image/jpeg", 0.88);
}

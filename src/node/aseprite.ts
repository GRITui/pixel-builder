// Node binding for the .aseprite writer. All format logic lives in
// `core/aseprite.ts` (which the browser reuses); this module only wires in
// node:zlib so cels are stored compressed, which is what the node/CLI/MCP
// export path writes.
import { deflateSync } from "node:zlib";
import { encodeAseprite as encodeCore, type AsepriteExportInput } from "../core/aseprite";

export { asepritePalette } from "../core/aseprite";
export type { AsepriteExportInput } from "../core/aseprite";

export type AsepriteNodeInput = Omit<AsepriteExportInput, "deflate">;

/** Encode an asset as a .aseprite file with zlib-compressed cels. */
export function encodeAseprite(input: AsepriteNodeInput): Buffer {
  const bytes = encodeCore({ ...input, deflate: (raw) => new Uint8Array(deflateSync(raw, { level: 9 })) });
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
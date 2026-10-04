// Node side of the Aseprite export: builds the file for an asset (kit palette, layer split)
// with real deflate, plus a small reader used by tests to verify the round trip.
//
// Layers: rigged assets get one layer per rig part (core, then attachments; same pixel
// ownership as the SVG export, see rigSvgInfo); every other asset one layer per material.
import { deflateSync, inflateSync } from "node:zlib";
import { materialLayers, writeAseprite } from "../core/aseprite";
import { resolveRamps } from "../core/kit";
import { flattenRamps } from "../core/palette";
import type { RigSvgInfo } from "../core/svg";
import type { Asset, StyleKit } from "../core/types";

export function asepriteBytes(asset: Pick<Asset, "rows" | "fps">, kit: StyleKit, rig?: RigSvgInfo): Uint8Array {
  const palette = flattenRamps(resolveRamps(kit));
  const deflate = (d: Uint8Array) => deflateSync(d);
  const rows = asset.rows;
  if (rig) {
    const used = rig.parts.filter((p) => rows.some((r, ri) => r.frames.some((_, fi) => rig.owners[ri]?.[fi]?.includes(p))));
    const parts = used.length ? used : ["core"];
    return writeAseprite({
      rows, palette, fps: asset.fps, deflate, layers: parts,
      layerOf: (ri, fi, p) => Math.max(0, parts.indexOf(rig.owners[ri]?.[fi]?.[p] ?? "")), // unowned pixels -> first layer (core)
    });
  }
  const { layers, layerOf } = materialLayers(rows);
  return writeAseprite({ rows, palette, fps: asset.fps, deflate, layers, layerOf });
}

// ---------- reader (tests / validation) ----------

export interface AseCel { layer: number; x: number; y: number; w: number; h: number; pixels: Uint8Array }
export interface AseFile {
  width: number;
  height: number;
  depth: number;
  frames: { duration: number; cels: AseCel[] }[];
  layers: { name: string; flags: number }[];
  tags: { name: string; from: number; to: number }[];
  /** [r, g, b, a] per palette entry. */
  palette: [number, number, number, number][];
  fileSize: number;
}

export function readAseprite(buf: Uint8Array): AseFile {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.length);
  if (b.length < 128 || b.readUInt16LE(4) !== 0xa5e0) throw new Error("Not an .aseprite file (bad magic).");
  const out: AseFile = {
    fileSize: b.readUInt32LE(0), width: b.readUInt16LE(8), height: b.readUInt16LE(10), depth: b.readUInt16LE(12),
    frames: [], layers: [], tags: [], palette: [],
  };
  const nFrames = b.readUInt16LE(6);
  const str = (at: number): [string, number] => { const n = b.readUInt16LE(at); return [b.toString("utf8", at + 2, at + 2 + n), at + 2 + n]; };
  let pos = 128;
  for (let f = 0; f < nFrames; f++) {
    const size = b.readUInt32LE(pos);
    if (b.readUInt16LE(pos + 4) !== 0xf1fa) throw new Error(`Bad frame magic at ${pos}.`);
    const oldN = b.readUInt16LE(pos + 6), newN = b.readUInt32LE(pos + 12);
    const frame = { duration: b.readUInt16LE(pos + 8), cels: [] as AseCel[] };
    let cp = pos + 16;
    for (let c = 0; c < (newN || oldN); c++) {
      const csize = b.readUInt32LE(cp), type = b.readUInt16LE(cp + 4), d = cp + 6;
      if (type === 0x2019) {
        const first = b.readUInt32LE(d + 4), last = b.readUInt32LE(d + 8);
        for (let i = first; i <= last; i++) {
          const e = d + 20 + (i - first) * 6 + 0;
          // entries are 6 bytes (flags, rgba) unless named; names are not written by us
          out.palette[i] = [b[e + 2], b[e + 3], b[e + 4], b[e + 5]];
        }
      } else if (type === 0x2004) out.layers.push({ flags: b.readUInt16LE(d), name: str(d + 16)[0] });
      else if (type === 0x2018) {
        let p = d + 10;
        for (let t = 0; t < b.readUInt16LE(d); t++) {
          const from = b.readUInt16LE(p), to = b.readUInt16LE(p + 2);
          const [name, np] = str(p + 17);
          out.tags.push({ name, from, to });
          p = np;
        }
      } else if (type === 0x2005) {
        const celType = b.readUInt16LE(d + 7);
        const cel: Omit<AseCel, "pixels"> = { layer: b.readUInt16LE(d), x: b.readInt16LE(d + 2), y: b.readInt16LE(d + 4), w: 0, h: 0 };
        if (celType === 2 || celType === 0) {
          cel.w = b.readUInt16LE(d + 16); cel.h = b.readUInt16LE(d + 18);
          const raw = b.subarray(d + 20, cp + csize);
          frame.cels.push({ ...cel, pixels: new Uint8Array(celType === 2 ? inflateSync(raw) : raw) });
        }
      }
      cp += csize;
    }
    out.frames.push(frame);
    pos += size;
  }
  return out;
}

/** Composite a frame's cels (bottom layer first) onto the canvas as palette indices; 0 = transparent. */
export function composeAseFrame(file: AseFile, frame: number): Uint8Array {
  const img = new Uint8Array(file.width * file.height);
  [...file.frames[frame].cels].sort((a, b) => a.layer - b.layer).forEach((c) => {
    for (let y = 0; y < c.h; y++)
      for (let x = 0; x < c.w; x++) {
        const v = c.pixels[y * c.w + x];
        if (v) img[(y + c.y) * file.width + x + c.x] = v;
      }
  });
  return img;
}

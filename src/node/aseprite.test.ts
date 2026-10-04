// Round-trip: encode a .aseprite, then read it back with an independent
// minimal parser written straight from Aseprite's format spec, and check the
// pixels come back identical. The reader deliberately shares no code with the
// encoder, so a byte-layout mistake in one shows up as a mismatch.
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { asepritePalette, encodeAseprite } from "./aseprite";
import { ATTACHMENTS, CLIPS, RIGS } from "../core/rigs";
import { flattenRamps, hexToRgb } from "../core/palette";
import { resolveRamps } from "../core/kit";
import { emptyProject } from "../core/project";
import { rigSvgInfo } from "../core/svg";
import { renderRecipe } from "../ui/rig/recipe";
import type { FrameSet, Sprite, StyleKit } from "../core/types";

// ---------- minimal reader ----------

interface Cel {
  layer: number;
  x: number;
  y: number;
  opacity: number;
  w: number;
  h: number;
  pixels: Uint8Array;
}

interface Ase {
  width: number;
  height: number;
  frames: number;
  depth: number;
  transparentIndex: number;
  ncolors: number;
  palette: [number, number, number][];
  /** Layer names in file order: index 0 is the topmost layer. */
  layers: string[];
  /** cels[frame][layerIndex] */
  cels: Cel[][][];
  tags: { from: number; to: number; name: string }[];
  durations: number[];
}

function readAseprite(buf: Buffer): Ase {
  let p = 0;
  const u8 = () => buf[p++];
  const u16 = () => {
    const v = buf.readUInt16LE(p);
    p += 2;
    return v;
  };
  const i16 = () => {
    const v = buf.readInt16LE(p);
    p += 2;
    return v;
  };
  const u32 = () => {
    const v = buf.readUInt32LE(p);
    p += 4;
    return v;
  };
  const str = () => {
    const n = u16();
    const s = buf.toString("utf8", p, p + n);
    p += n;
    return s;
  };

  const out = {
    palette: [] as [number, number, number][],
    layers: [] as string[],
    cels: [] as Cel[][][],
    tags: [] as { from: number; to: number; name: string }[],
    durations: [] as number[],
    transparentIndex: 0,
    ncolors: 0,
    width: 0,
    height: 0,
    depth: 0,
    frames: 0,
  };

  const size = u32();
  expect(size).toBe(buf.length); // the header size covers the whole file
  const magic = u16();
  if (magic !== 0xa5e0) throw new Error(`bad magic 0x${magic.toString(16)}`);
  out.frames = u16();
  out.width = u16();
  out.height = u16();
  out.depth = u16();
  u32(); // flags
  u16(); // legacy speed
  u32(); // next
  u32(); // "frit"
  out.transparentIndex = u8();
  u8();
  u8();
  u8();
  out.ncolors = u16();
  u8(); // pixel width
  u8(); // pixel height
  i16();
  i16();
  u16();
  u16();
  p = 128; // the header occupies exactly 128 bytes

  for (let f = 0; f < out.frames; f++) {
    const frameStart = p;
    const frameSize = u32();
    const frameEnd = frameStart + frameSize; // size counts from the size field itself
    const frameMagic = u16();
    if (frameMagic !== 0xf1fa) throw new Error(`bad frame magic 0x${frameMagic.toString(16)}`);
    u16(); // u16 copy of the chunk count
    out.durations.push(u16());
    u8();
    u8();
    const chunkCount = u32();

    const frameCels: Cel[][] = [];
    for (let c = 0; c < chunkCount; c++) {
      const chunkStart = p;
      const chunkSize = u32();
      const chunkEnd = chunkStart + chunkSize; // the size field is part of the chunk
      const type = u16();
      if (type === 4) {
        // FLI_COLOR2
        const packets = u16();
        for (let k = 0; k < packets; k++) {
          u8(); // skip count
          let n = u8();
          if (n === 0) n = 256;
          for (let i = 0; i < n; i++) out.palette.push([u8(), u8(), u8()]);
        }
      } else if (type === 0x2004) {
        // LAYER
        u16(); // flags
        const layerType = u16();
        if (layerType !== 0) throw new Error(`unexpected layer type ${layerType}`);
        u16(); // child level
        u16();
        u16();
        u16(); // blend mode
        u8(); // opacity
        u8();
        u8();
        u8();
        out.layers.push(str());
      } else if (type === 0x2005) {
        // CEL
        const layer = u16();
        const cel: Cel = { layer, x: i16(), y: i16(), opacity: u8(), w: 0, h: 0, pixels: new Uint8Array() };
        const celType = u16();
        u16(); // z-index
        u8();
        u8();
        u8();
        u8();
        u8();
        if (celType !== 2) throw new Error(`unexpected cel type ${celType} (want compressed)`);
        cel.w = u16();
        cel.h = u16();
        cel.pixels = new Uint8Array(inflateSync(buf.subarray(p, chunkEnd)));
        expect(cel.pixels.length).toBe(cel.w * cel.h);
        (frameCels[layer] ??= []).push(cel);
      } else if (type === 0x2018) {
        // TAGS
        const ntags = u16();
        u32();
        u32();
        for (let t = 0; t < ntags; t++) {
          const from = u16();
          const to = u16();
          u8(); // direction
          u16(); // repeat
          u16();
          u32();
          u8();
          u8();
          u8();
          u8();
          out.tags.push({ from, to, name: str() });
        }
      }
      p = chunkEnd;
    }
    out.cels.push(frameCels);
    p = frameEnd;
  }
  expect(p).toBe(buf.length);
  return out;
}

/** Composite a frame's cels into a full-canvas indexed image (layer 0 is topmost). */
function composite(ase: Ase, frame: number): Uint8Array {
  const canvas = new Uint8Array(ase.width * ase.height);
  // Paint from the bottom layer up so higher layers overwrite, as Aseprite draws.
  for (let li = ase.layers.length - 1; li >= 0; li--) {
    for (const cel of ase.cels[frame][li] ?? []) {
      for (let y = 0; y < cel.h; y++)
        for (let x = 0; x < cel.w; x++) {
          const idx = cel.pixels[y * cel.w + x];
          const dx = cel.x + x, dy = cel.y + y;
          if (idx === 0 || dx < 0 || dy < 0 || dx >= ase.width || dy >= ase.height) continue;
          canvas[dy * ase.width + dx] = idx;
        }
    }
  }
  return canvas;
}

// ---------- fixtures ----------

/** A hand-built static asset: one row, two frames, a few palette indices. */
const STATIC_ROWS: FrameSet[] = [
  {
    name: "idle",
    frames: [
      { w: 4, h: 3, data: [1, 2, 0, 0, 1, 2, 3, 0, 4, 4, 0, 0] },
      { w: 4, h: 3, data: [1, 2, 0, 0, 1, 2, 3, 0, 4, 5, 0, 0] },
    ],
  },
];

const project = emptyProject();
const kitById = (id: string): StyleKit => project.kits.find((k) => k.id === id) ?? project.kits[0];

/** A rigged humanoid with real part ownership, so the export splits into layers. */
function riggedFixture(kitId: string) {
  const kit = kitById(kitId);
  const rig = RIGS.find((r) => r.family === "humanoid")!.rig;
  const clips = CLIPS.filter((c) => c.family === "humanoid").slice(0, 2).map((c) => c.clip);
  const attachments = ATTACHMENTS.filter((a) => a.family === "humanoid").slice(0, 1).map((a) => a.attachment);
  const res = renderRecipe({ rig: rig.id, slots: {}, attachments: attachments.map((a) => a.id), clips }, kit);
  const rigInfo = rigSvgInfo({ rig, slots: {}, attachments, clips, kit });
  return { kit, rows: res.rows, fps: res.fps, rig: rigInfo };
}

const flatFrames = (rows: FrameSet[]): Sprite[] => rows.flatMap((r) => r.frames);

// ---------- tests ----------

describe("encodeAseprite", () => {
  it("writes a header Aseprite can read back", () => {
    const kit = kitById("kit-default");
    const ase = readAseprite(encodeAseprite({ rows: STATIC_ROWS, fps: 8, kit }));
    expect(ase.depth).toBe(8);
    expect(ase.frames).toBe(2);
    expect(ase.width).toBe(4);
    expect(ase.height).toBe(3);
    expect(ase.transparentIndex).toBe(0);
    expect(ase.ncolors).toBe(asepritePalette(kit).length);
    // The palette survives the round-trip entry for entry.
    expect(ase.palette).toEqual(asepritePalette(kit));
    expect(ase.durations).toEqual([125, 125]); // 1000 / 8 fps
  });

  it("round-trips pixels exactly (static asset)", () => {
    const kit = kitById("kit-default");
    const ase = readAseprite(encodeAseprite({ rows: STATIC_ROWS, fps: 8, kit }));
    expect(ase.layers).toEqual(["core"]); // no rig info => a single layer
    let f = 0;
    for (const row of STATIC_ROWS)
      for (const sprite of row.frames) {
        expect([...composite(ase, f)]).toEqual(sprite.data);
        f++;
      }
  });

  it("round-trips pixels exactly (rigged asset, one layer per part)", () => {
    const { kit, rows, fps, rig } = riggedFixture("kit-default");
    const ase = readAseprite(encodeAseprite({ rows, fps, kit, rig }));

    // A layer per rig part that appears, plus "core" for unowned pixels.
    expect(ase.layers).toContain("core");
    expect(ase.layers.length).toBeGreaterThan(1);

    // Every source frame composites back to exactly its indexed pixels.
    let f = 0;
    for (const sprite of flatFrames(rows)) {
      const canvas = composite(ase, f);
      expect(canvas.length).toBe(sprite.w * sprite.h);
      expect([...canvas]).toEqual(sprite.data);
      f++;
    }
    expect(f).toBe(ase.frames);
  });

  it("gives each pixel to exactly one layer, so paint order never decides the result", () => {
    const { kit, rows, fps, rig } = riggedFixture("kit-default");
    const ase = readAseprite(encodeAseprite({ rows, fps, kit, rig }));
    for (let f = 0; f < ase.frames; f++) {
      const claimed = new Set<number>();
      for (let li = 0; li < ase.layers.length; li++)
        for (const cel of ase.cels[f][li] ?? [])
          for (let y = 0; y < cel.h; y++)
            for (let x = 0; x < cel.w; x++) {
              if (cel.pixels[y * cel.w + x] === 0) continue;
              const p = (cel.y + y) * ase.width + (cel.x + x);
              expect(claimed.has(p)).toBe(false);
              claimed.add(p);
            }
    }
  });

  it("puts core behind every attachment layer", () => {
    const { kit, rows, fps, rig } = riggedFixture("kit-default");
    const ase = readAseprite(encodeAseprite({ rows, fps, kit, rig }));
    // File order is top-to-bottom, so "core" must be the last entry.
    expect(ase.layers[ase.layers.length - 1]).toBe("core");
    expect(ase.layers).toEqual([...rig.parts.filter((p) => p !== "core" && ase.layers.includes(p)), "core"]);
  });

  it("writes one tag per animation row, spanning that row's frames", () => {
    const { kit, rows, fps, rig } = riggedFixture("kit-default");
    const ase = readAseprite(encodeAseprite({ rows, fps, kit, rig }));
    expect(ase.tags).toHaveLength(rows.length);
    let at = 0;
    rows.forEach((row, i) => {
      expect(ase.tags[i]).toEqual({ from: at, to: at + row.frames.length - 1, name: row.name });
      at += row.frames.length;
    });
  });

  it("scales cels by an integer factor with nearest-neighbour pixels", () => {
    const { kit, rows, fps, rig } = riggedFixture("kit-default");
    const ase = readAseprite(encodeAseprite({ rows, fps, kit, rig, scale: 3 }));
    expect(ase.width).toBe(Math.max(...flatFrames(rows).map((s) => s.w)) * 3);
    expect(ase.height).toBe(Math.max(...flatFrames(rows).map((s) => s.h)) * 3);

    const cels = ase.cels[0].flat().filter(Boolean) as Cel[];
    expect(cels.length).toBeGreaterThan(0);
    for (const cel of cels) {
      expect(cel.w % 3).toBe(0);
      expect(cel.h % 3).toBe(0);
      // Every 3x3 block holds one source pixel.
      for (let y = 0; y < cel.h; y++)
        for (let x = 0; x < cel.w; x++)
          expect(cel.pixels[y * cel.w + x]).toBe(cel.pixels[(((y / 3) | 0) * 3) * cel.w + (((x / 3) | 0) * 3)]);
    }
  });

  it("locks each kit's palette into the file", () => {
    for (const kitId of ["kit-default", "kit-gameboy", "kit-neon"]) {
      const kit = kitById(kitId);
      const ase = readAseprite(encodeAseprite({ rows: STATIC_ROWS, fps: 8, kit }));
      expect(ase.palette).toEqual(asepritePalette(kit));
      // Index 0 is the transparent slot; entry 1 must be a real ramp colour.
      expect(ase.palette[1]).toEqual(hexToRgb(kitRamp(kit)[1]!));
      // No cel may index past the palette.
      for (const cel of ase.cels.flat(2) as Cel[]) for (const v of cel.pixels) expect(v).toBeLessThan(ase.palette.length);
    }
  });

  it("rejects an asset with no frames", () => {
    expect(() => encodeAseprite({ rows: [], fps: 8, kit: kitById("kit-default") })).toThrow(/no frames/i);
  });
});

/** A kit's flattened ramp (index 0 = the transparent slot). */
function kitRamp(kit: StyleKit): (string | null)[] {
  return flattenRamps(resolveRamps(kit));
}
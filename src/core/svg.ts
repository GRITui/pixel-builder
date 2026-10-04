// Layered SVG export/import. Presets ship as SVG so a human (Inkscape, Illustrator,
// Figma) or an AI can open them, retexture one layer and import them back losslessly.
//
// Layout: one <g inkscape:groupmode="layer"> per material (or per rig part, with a
// sub-group per material), frames laid out as a grid (rows = animation rows), and a
// locked "guides" layer on top (ignored on import). Pixels are horizontal runs of
// <rect> that keep data-material / data-level, so the palette index survives a round trip.
// Pure: no node/DOM APIs, no dependencies.
import { resolveRamps } from "./kit";
import { MATERIALS, RAMP_LEN, colorIndex, decodeIndex, flattenRamps, hexToRgb, makeQuantizer, type Material } from "./palette";
import { renderRigFrame, solvePose, withAttachmentJoints, clipFrames, DIRS, viewOf, type Attachment, type Clip, type Dir, type RigDef } from "./rig";
import type { Category, FrameSet, Sprite, StyleKit, TileMap } from "./types";

export const SVG_GAP = 4;
const PAD = 3;
const LABEL_H = 6;

export interface SvgAssetInput {
  name: string;
  category: Category;
  fps?: number;
  rows: FrameSet[];
  tilemap?: TileMap;
  /** Present for rigged assets: pixel -> part ownership and joint positions per frame. */
  rig?: RigSvgInfo;
}

export interface RigSvgInfo {
  /** Layer order: "core" first, then attachments in order. */
  parts: string[];
  /** [row][frame] -> per pixel part id ("" for transparent). */
  owners: string[][][];
  /** [row][frame] -> joint id -> pixel position. */
  joints: Record<string, [number, number]>[][];
}

// ---------- rig part ownership ----------

export interface RigSvgSource {
  rig: RigDef;
  slots?: Record<string, Material>;
  attachments: Attachment[];
  clips: Clip[];
  kit: StyleKit;
  size?: number;
}

/**
 * Render the rig progressively (base, then + each attachment in order) and give every
 * pixel of the final frame to the last stage that changed it. Rows follow renderRig.
 */
export function rigSvgInfo(src: RigSvgSource): RigSvgInfo {
  const { rig, kit } = src;
  const size = src.size ?? kit.sizes.character;
  const parts = ["core", ...src.attachments.map((a) => a.id)];
  const owners: string[][][] = [];
  const joints: Record<string, [number, number]>[][] = [];
  const full = withAttachmentJoints(rig, src.attachments);
  const k = size / rig.grid;
  for (const clip of src.clips)
    for (const dir of DIRS as Dir[]) {
      const poses = clipFrames(clip, viewOf(dir));
      const list = poses.length ? poses : [{}];
      owners.push([]);
      joints.push([]);
      for (const pose of list) {
        const stages = parts.map((_, n) => renderRigFrame({ rig, slots: src.slots, attachments: src.attachments.slice(0, n), kit, size }, dir, pose).data);
        const final = stages[stages.length - 1];
        const own = final.map((v, p) => {
          if (!v) return "";
          for (let n = stages.length - 1; n > 0; n--) if (stages[n][p] !== stages[n - 1][p]) return parts[n];
          return "core";
        });
        owners[owners.length - 1].push(own);
        const J = solvePose(full, viewOf(dir), pose);
        const out: Record<string, [number, number]> = {};
        for (const id of Object.keys(J)) out[id] = [dir === "left" ? size - J[id][0] * k : J[id][0] * k, J[id][1] * k];
        joints[joints.length - 1].push(out);
      }
    }
  return { parts, owners, joints };
}

// ---------- export ----------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const sid = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
const mname = (m: Material) => (m === "ink" ? "outline" : m);

interface Layout {
  cellW: number;
  cellH: number;
  origin(r: number, i: number): [number, number];
  width: number;
  height: number;
}

function layoutOf(rows: FrameSet[]): Layout {
  const all = rows.flatMap((r) => r.frames);
  const cellW = Math.max(1, ...all.map((s) => s.w)), cellH = Math.max(1, ...all.map((s) => s.h));
  const cols = Math.max(1, ...rows.map((r) => r.frames.length));
  return {
    cellW,
    cellH,
    origin: (r, i) => [PAD + i * (cellW + SVG_GAP), PAD + LABEL_H + r * (cellH + SVG_GAP + LABEL_H)],
    width: PAD * 2 + cols * cellW + (cols - 1) * SVG_GAP,
    height: PAD * 2 + LABEL_H + rows.length * cellH + (rows.length - 1) * (SVG_GAP + LABEL_H),
  };
}

function runs(s: Sprite, pick: (p: number) => boolean): { x: number; y: number; w: number; idx: number }[] {
  const out: { x: number; y: number; w: number; idx: number }[] = [];
  for (let y = 0; y < s.h; y++) {
    let x = 0;
    while (x < s.w) {
      const p = y * s.w + x, idx = s.data[p];
      if (!idx || !pick(p)) { x++; continue; }
      let e = x + 1;
      while (e < s.w && s.data[y * s.w + e] === idx && pick(y * s.w + e)) e++;
      out.push({ x, y, w: e - x, idx });
      x = e;
    }
  }
  return out;
}

export function spriteSheetToSvg(input: SvgAssetInput & { kit: StyleKit }): string {
  const { kit, rows } = input;
  if (!rows.length || !rows[0].frames.length) throw new Error("Asset has no frames to export.");
  const flat = flattenRamps(resolveRamps(kit));
  const L = layoutOf(rows);
  const rig = input.rig;
  const tile = input.tilemap?.tile ?? kit.sizes.tile;

  // which (part, material) groups exist, in order
  const used = new Set<number>();
  rows.forEach((r) => r.frames.forEach((s) => s.data.forEach((v) => v && used.add(v))));
  const mats = MATERIALS.filter((m) => [...used].some((i) => decodeIndex(i)?.mat === m));
  const partIds: (string | null)[] = rig ? rig.parts.filter((p) => rows.some((r, ri) => r.frames.some((_, fi) => rig.owners[ri]?.[fi]?.includes(p)))) : [null];
  // pixels owned by nobody (stored sprite differs from the recipe render) go to "core"
  const ownerOf = (ri: number, fi: number, p: number) => {
    const o = rig?.owners[ri]?.[fi]?.[p];
    return o && partIds.includes(o) ? o : "core";
  };

  const rect = (x: number, y: number, w: number, idx: number) => {
    const d = decodeIndex(idx)!;
    return `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${flat[idx]}" data-material="${d.mat}" data-level="${d.level}"/>`;
  };
  const frames = (layerId: string, pick: (ri: number, fi: number, p: number) => boolean) => {
    const g: string[] = [];
    rows.forEach((r, ri) =>
      r.frames.forEach((s, fi) => {
        const rs = runs(s, (p) => pick(ri, fi, p));
        if (!rs.length) return;
        const [ox, oy] = L.origin(ri, fi);
        g.push(`<g id="${layerId}-frame-${ri}-${fi}" transform="translate(${ox},${oy})">${rs.map((q) => rect(q.x, q.y, q.w, q.idx)).join("")}</g>`);
      }),
    );
    return g.join("\n");
  };
  const layer = (id: string, label: string, body: string) => `<g id="${id}" inkscape:label="${esc(label)}" inkscape:groupmode="layer">\n${body}\n</g>`;
  const hasMat = (ri: number, fi: number, p: number, m: Material) => decodeIndex(rows[ri].frames[fi].data[p])?.mat === m;

  const layers: string[] = [];
  const layerNames: string[] = [];
  if (!rig) {
    for (const m of mats) {
      const id = `layer-${sid(mname(m))}`;
      layerNames.push(mname(m));
      layers.push(layer(id, mname(m), frames(id, (ri, fi, p) => hasMat(ri, fi, p, m))));
    }
  } else {
    for (const part of partIds as string[]) {
      const pid = `layer-${sid(part)}`;
      layerNames.push(part);
      const subs: string[] = [];
      for (const m of mats) {
        const sub = `${pid}-${sid(mname(m))}`;
        const body = frames(sub, (ri, fi, p) => hasMat(ri, fi, p, m) && ownerOf(ri, fi, p) === part);
        if (body) subs.push(`<g id="${sub}" inkscape:label="${esc(mname(m))}">\n${body}\n</g>`);
      }
      layers.push(layer(pid, part, subs.join("\n")));
    }
  }

  // ---- guides ----
  const gd: string[] = [];
  const stroke = (c: string, w: number, extra = "") => `fill="none" stroke="${c}" stroke-width="${w}" ${extra}`;
  rows.forEach((r, ri) =>
    r.frames.forEach((s, fi) => {
      const [ox, oy] = L.origin(ri, fi);
      const f: string[] = [];
      f.push(`<rect width="${s.w}" height="${s.h}" fill="url(#pb-px)"/>`);
      f.push(`<rect width="${s.w}" height="${s.h}" fill="url(#pb-tile)"/>`);
      let maxY = -1;
      for (let p = 0; p < s.data.length; p++) if (s.data[p]) maxY = Math.max(maxY, Math.floor(p / s.w));
      if (maxY >= 0) f.push(`<line x1="0" y1="${maxY + 1}" x2="${s.w}" y2="${maxY + 1}" stroke="#2ecc71" stroke-width="0.25" stroke-dasharray="1 0.5"/>`);
      f.push(`<line x1="${s.w / 2}" y1="0" x2="${s.w / 2}" y2="${s.h}" stroke="#3498db" stroke-width="0.15" stroke-dasharray="1 0.5"/>`);
      f.push(`<rect x="1" y="1" width="${Math.max(0, s.w - 2)}" height="${Math.max(0, s.h - 2)}" ${stroke("#e67e22", 0.15, 'stroke-dasharray="0.6 0.6"')}/>`);
      f.push(`<rect width="${s.w}" height="${s.h}" ${stroke("#e84393", 0.3)}/>`);
      f.push(`<text x="0" y="-1.2" font-size="3.2" font-family="monospace" fill="#e84393">${esc(`${r.name} ${fi}`)}</text>`);
      const J = rig?.joints[ri]?.[fi];
      if (J)
        for (const [id, [x, y]] of Object.entries(J))
          f.push(`<path d="M${(x - 0.8).toFixed(2)} ${y.toFixed(2)}H${(x + 0.8).toFixed(2)}M${x.toFixed(2)} ${(y - 0.8).toFixed(2)}V${(y + 0.8).toFixed(2)}" ${stroke("#c0392b", 0.2)}/>` +
            `<text x="${(x + 1).toFixed(2)}" y="${(y - 0.4).toFixed(2)}" font-size="1.6" font-family="monospace" fill="#c0392b" opacity="0.85">${esc(id)}</text>`);
      gd.push(`<g id="guide-frame-${ri}-${fi}" transform="translate(${ox},${oy})">${f.join("")}</g>`);
    }),
  );
  const defs =
    `<defs>` +
    `<pattern id="pb-px" width="1" height="1" patternUnits="userSpaceOnUse"><path shape-rendering="geometricPrecision" d="M1 0V1H0" fill="none" stroke="#000" stroke-width="0.04" opacity="0.2"/></pattern>` +
    `<pattern id="pb-tile" width="${tile}" height="${tile}" patternUnits="userSpaceOnUse"><path shape-rendering="geometricPrecision" d="M${tile} 0V${tile}H0" fill="none" stroke="#8e44ad" stroke-width="${+Math.max(0.12, L.width / 600).toFixed(2)}" opacity="0.75"/></pattern>` +
    `</defs>`;

  const legend: Record<string, string[]> = {};
  for (const m of MATERIALS) legend[m] = Array.from({ length: RAMP_LEN }, (_, l) => flat[colorIndex(m, l)] ?? "");
  const meta = {
    format: "pixel-builder-svg",
    version: 1,
    name: input.name,
    category: input.category,
    kitId: kit.id,
    fps: input.fps ?? 6,
    size: [rows[0].frames[0].w, rows[0].frames[0].h],
    tile,
    layers: layerNames,
    rows: rows.map((r) => ({ name: r.name, frames: r.frames.map((s) => [s.w, s.h]) })),
    legend,
    note: "Edit by layer. Keep data-material/data-level (or use kit colours from `legend`). The 'guides' layer is ignored on import.",
  };

  const scale = Math.max(1, Math.ceil(512 / Math.max(L.width, L.height)));
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" ` +
    `width="${L.width * scale}" height="${L.height * scale}" viewBox="0 0 ${L.width} ${L.height}" shape-rendering="crispEdges">\n` +
    `<title>${esc(input.name)}</title>\n<desc id="pixel-builder-meta">${esc(JSON.stringify(meta))}</desc>\n` +
    defs + "\n" +
    `<g id="sprites" shape-rendering="crispEdges">\n${layers.join("\n")}\n</g>\n` +
    `<g id="guides" inkscape:label="guides" inkscape:groupmode="layer" sodipodi:insensitive="true" pointer-events="none">\n${gd.join("\n")}\n</g>\n` +
    `</svg>\n`
  );
}

// ---------- import ----------

export interface ParsedSvg {
  name?: string;
  category?: Category;
  kitId?: string;
  fps?: number;
  rows: FrameSet[];
  notes: string[];
}

const attrsOf = (s: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = unesc(m[2] ?? m[3] ?? "");
  return out;
};

function styleOf(a: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...a };
  for (const d of (a.style ?? "").split(";")) {
    const i = d.indexOf(":");
    if (i > 0) out[d.slice(0, i).trim()] = d.slice(i + 1).trim();
  }
  return out;
}

function translateOf(t?: string): [number, number] {
  if (!t) return [0, 0];
  let x = 0, y = 0;
  for (const m of t.matchAll(/(translate|matrix)\(([^)]*)\)/g)) {
    const n = m[2].split(/[\s,]+/).filter(Boolean).map(Number);
    if (m[1] === "translate") { x += n[0] || 0; y += n[1] || 0; }
    else { x += n[4] || 0; y += n[5] || 0; }
  }
  return [x, y];
}

function parseColor(v?: string): [number, number, number] | null {
  if (!v) return null;
  v = v.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16)) as [number, number, number];
  m = /^#([0-9a-f]{6})/.exec(v);
  if (m) return hexToRgb("#" + m[1]);
  const r = /^rgb\(\s*([\d.]+)(%?)[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)/.exec(v);
  if (r) return [Number(r[1]) * (r[2] ? 2.55 : 1), Number(r[3]) * (r[4] ? 2.55 : 1), Number(r[5]) * (r[6] ? 2.55 : 1)].map((c) => Math.max(0, Math.min(255, Math.round(c)))) as [number, number, number];
  if (v === "black") return [0, 0, 0];
  if (v === "white") return [255, 255, 255];
  return null;
}

const rgbHex = ([r, g, b]: number[]) => "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");

/** Read a (pixel-builder or hand-edited) SVG back into frames. Guides and hidden layers are skipped. */
export function svgToSprites(svg: string, kit: StyleKit): ParsedSvg {
  const notes: string[] = [];
  const metaText = /<desc\b[^>]*id="pixel-builder-meta"[^>]*>([\s\S]*?)<\/desc>/.exec(svg)?.[1];
  let meta: any;
  if (metaText) {
    try { meta = JSON.parse(unesc(metaText)); } catch { notes.push("metadata could not be parsed; frames were inferred from groups"); }
  }
  const body = svg
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<(desc|metadata|title|defs|pattern|style|script|clipPath|mask)\b[\s\S]*?<\/\1\s*>/gi, "");
  if (!/<svg\b/i.test(body)) throw new Error("Not an SVG file (no <svg> element).");
  const flat = flattenRamps(resolveRamps(kit));
  const quant = makeQuantizer(resolveRamps(kit));
  const byHex = new Map<string, number>();
  flat.forEach((h, i) => { if (h && !byHex.has(h.toLowerCase())) byHex.set(h.toLowerCase(), i); });

  interface G { tx: number; ty: number; hidden: boolean; guides: boolean; frame?: { key: string; bx: number; by: number } }
  const stack: G[] = [{ tx: 0, ty: 0, hidden: false, guides: false }];
  const frames = new Map<string, { r: number; i: number; px: { x: number; y: number; idx: number }[] }>();
  const frameOf = (key: string) => {
    let f = frames.get(key);
    if (!f) {
      const m = /(\d+)-(\d+)$/.exec(key);
      f = { r: m ? Number(m[1]) : 0, i: m ? Number(m[2]) : 0, px: [] };
      frames.set(key, f);
    }
    return f;
  };
  let skipped = 0;
  for (const t of body.matchAll(/<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g)) {
    const [, close, tag, rest, selfClose] = t;
    const top = stack[stack.length - 1];
    if (tag === "g" || tag === "svg") {
      if (close) { if (stack.length > 1) stack.pop(); continue; }
      const a = styleOf(attrsOf(rest));
      const [dx, dy] = translateOf(a.transform);
      const g: G = {
        tx: top.tx + dx, ty: top.ty + dy,
        hidden: top.hidden || /^none$/i.test(a.display ?? "") || /^(hidden|collapse)$/i.test(a.visibility ?? ""),
        guides: top.guides || a.id === "guides" || a["inkscape:label"] === "guides",
        frame: top.frame,
      };
      const fm = /(?:^|-)frame-(\d+-\d+)$/.exec(a.id ?? "");
      if (fm && !top.frame) g.frame = { key: fm[1], bx: g.tx, by: g.ty };
      if (!selfClose) stack.push(g);
      continue;
    }
    if (tag !== "rect" || close) continue;
    if (top.hidden || top.guides) continue;
    const a = styleOf(attrsOf(rest));
    if (/^none$/i.test(a.display ?? "") || /^(hidden|collapse)$/i.test(a.visibility ?? "")) continue;
    if (/^none$/i.test(a.fill ?? "") || Number(a.opacity ?? 1) < 0.5 || Number(a["fill-opacity"] ?? 1) < 0.5) continue;
    const [dx, dy] = translateOf(a.transform);
    const num = (v?: string) => Number.parseFloat(v ?? "0") || 0;
    const w = Math.round(num(a.width)), h = Math.round(num(a.height));
    if (w <= 0 || h <= 0) continue;
    const ax = top.tx + dx + num(a.x), ay = top.ty + dy + num(a.y);
    const base = top.frame ?? { key: "0-0", bx: 0, by: 0 };
    const x0 = Math.round(ax - base.bx), y0 = Math.round(ay - base.by);

    let idx = 0;
    const dm = a["data-material"] as Material | undefined;
    const dIdx = dm && (MATERIALS as readonly string[]).includes(dm) && a["data-level"] !== undefined ? colorIndex(dm, Number(a["data-level"])) : 0;
    const rgb = parseColor(a.fill);
    if (dIdx && (!rgb || rgbHex(rgb) === (flat[dIdx] ?? "").toLowerCase())) idx = dIdx;
    else if (rgb) idx = byHex.get(rgbHex(rgb)) ?? quant(rgb);
    else if (dIdx) idx = dIdx;
    else { skipped++; continue; }
    const f = frameOf(base.key);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) f.px.push({ x: x0 + xx, y: y0 + yy, idx });
  }
  if (skipped) notes.push(`${skipped} rect(s) without a usable fill or data-material were skipped`);
  if (!frames.size) throw new Error("The SVG has no visible pixel rects outside the guides layer. Pixels must be <rect> elements (keep them in the sprite layers, not in 'guides').");

  const paint = (w: number, h: number, px: { x: number; y: number; idx: number }[]): Sprite => {
    const data = new Array<number>(w * h).fill(0);
    for (const p of px) if (p.x >= 0 && p.y >= 0 && p.x < w && p.y < h) data[p.y * w + p.x] = p.idx;
    return { w, h, data };
  };
  const rows: FrameSet[] = [];
  if (meta?.format === "pixel-builder-svg" && Array.isArray(meta.rows)) {
    meta.rows.forEach((r: { name: string; frames: [number, number][] }, ri: number) =>
      rows.push({ name: String(r.name), frames: r.frames.map(([w, h], fi) => paint(w, h, frames.get(`${ri}-${fi}`)?.px ?? [])) }),
    );
  } else {
    // foreign SVG: one frame per frame group (or the whole drawing), sized to its content or the viewBox
    const vb = /<svg\b[^>]*viewBox="([^"]+)"/i.exec(body)?.[1]?.split(/[\s,]+/).map(Number);
    const all = [...frames.values()];
    const W = Math.max(1, ...all.flatMap((f) => f.px.map((p) => p.x + 1)));
    const H = Math.max(1, ...all.flatMap((f) => f.px.map((p) => p.y + 1)));
    const single = all.length === 1 && vb && vb.length === 4 && vb[0] === 0 && vb[1] === 0;
    const w = single ? Math.max(W, Math.round(vb![2])) : W, h = single ? Math.max(H, Math.round(vb![3])) : H;
    const maxRow = Math.max(...all.map((f) => f.r));
    for (let ri = 0; ri <= maxRow; ri++) {
      const fs = all.filter((f) => f.r === ri).sort((a, b) => a.i - b.i);
      if (fs.length) rows.push({ name: maxRow ? `row-${ri}` : "idle", frames: fs.map((f) => paint(w, h, f.px)) });
    }
    notes.push("no pixel-builder metadata: frames inferred from the drawing");
  }
  return {
    name: typeof meta?.name === "string" ? meta.name : undefined,
    category: meta?.category,
    kitId: typeof meta?.kitId === "string" ? meta.kitId : undefined,
    fps: typeof meta?.fps === "number" ? meta.fps : undefined,
    rows,
    notes,
  };
}

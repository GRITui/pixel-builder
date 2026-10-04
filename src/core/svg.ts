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

interface Box { x: number; y: number; w: number; h: number; idx: number }

/** Greedy rectangles of equal palette index inside (x0,y0,cw,ch) of a sprite, limited to pixels `pick` allows. */
function boxes(s: Sprite, pick: (p: number) => boolean, x0 = 0, y0 = 0, cw = s.w, ch = s.h): Box[] {
  const out: Box[] = [];
  const done = new Uint8Array(s.w * s.h);
  const ok = (x: number, y: number, idx: number) => { const p = y * s.w + x; return !done[p] && s.data[p] === idx && pick(p); };
  const x1 = Math.min(s.w, x0 + cw), y1 = Math.min(s.h, y0 + ch);
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const idx = s.data[y * s.w + x];
      if (!idx || !ok(x, y, idx)) continue;
      let w = 1;
      while (x + w < x1 && ok(x + w, y, idx)) w++;
      let h = 1;
      grow: while (y + h < y1) {
        for (let k = 0; k < w; k++) if (!ok(x + k, y + h, idx)) break grow;
        h++;
      }
      for (let j = 0; j < h; j++) for (let k = 0; k < w; k++) done[(y + j) * s.w + x + k] = 1;
      out.push({ x, y, w, h, idx });
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

  // fill / data-level live on a group per palette index; data-material on the layer (or part sub-group)
  const levelGroups = (bs: Box[], dx = 0, dy = 0) => {
    const by = new Map<number, Box[]>();
    for (const q of bs) (by.get(q.idx) ?? by.set(q.idx, []).get(q.idx)!).push(q);
    return [...by.entries()]
      .sort((p, q) => p[0] - q[0])
      .map(([idx, list]) => `<g data-level="${decodeIndex(idx)!.level}" fill="${flat[idx]}"><path d="${list.map((q) => `M${q.x - dx} ${q.y - dy}h${q.w}v${q.h}h-${q.w}z`).join("")}"/></g>`)
      .join("");
  };
  // Maps: tile-sized cells whose content (within one layer) repeats become <symbol>s reused with <use>.
  const symbols: string[] = [];
  const cellsOf = (layerKey: string, s: Sprite, pick: (p: number) => boolean) => {
    const uses: string[] = [];
    if (!input.tilemap || s.w <= tile && s.h <= tile) return { uses, skip: new Set<number>() };
    const found: { cx: number; cy: number; key: string; body: string; bs: Box[] }[] = [];
    for (let cy = 0; cy < s.h; cy += tile)
      for (let cx = 0; cx < s.w; cx += tile) {
        const bs = boxes(s, pick, cx, cy, tile, tile);
        if (bs.length) found.push({ cx, cy, key: levelGroups(bs, cx, cy), body: "", bs });
      }
    const count = new Map<string, number>();
    for (const c of found) count.set(c.key, (count.get(c.key) ?? 0) + 1);
    const skip = new Set<number>();
    for (const c of found) {
      if ((count.get(c.key) ?? 0) < 2 || c.key.length < 120) continue;
      let sym = symIds.get(layerKey + c.key);
      if (!sym) {
        sym = `pb-s${symIds.size}`;
        symIds.set(layerKey + c.key, sym);
        symbols.push(`<symbol id="${sym}" overflow="visible">${c.key}</symbol>`);
      }
      uses.push(`<use href="#${sym}" x="${c.cx}" y="${c.cy}"/>`);
      for (let y = c.cy; y < Math.min(s.h, c.cy + tile); y++) for (let x = c.cx; x < Math.min(s.w, c.cx + tile); x++) skip.add(y * s.w + x);
    }
    return { uses, skip };
  };
  const symIds = new Map<string, string>();
  const frames = (layerId: string, pick: (ri: number, fi: number, p: number) => boolean) => {
    const g: string[] = [];
    rows.forEach((r, ri) =>
      r.frames.forEach((s, fi) => {
        const base = (p: number) => pick(ri, fi, p);
        const { uses, skip } = cellsOf(layerId, s, base);
        const bs = boxes(s, (p) => base(p) && !skip.has(p));
        if (!bs.length && !uses.length) return;
        const [ox, oy] = L.origin(ri, fi);
        g.push(`<g id="${layerId}-frame-${ri}-${fi}" transform="translate(${ox},${oy})">${uses.join("")}${levelGroups(bs)}</g>`);
      }),
    );
    return g.join("\n");
  };
  const layer = (id: string, label: string, body: string, extra = "") => `<g id="${id}" inkscape:label="${esc(label)}" inkscape:groupmode="layer"${extra}>\n${body}\n</g>`;
  const hasMat = (ri: number, fi: number, p: number, m: Material) => decodeIndex(rows[ri].frames[fi].data[p])?.mat === m;

  const layers: string[] = [];
  const layerNames: string[] = [];
  if (!rig) {
    for (const m of mats) {
      const id = `layer-${sid(mname(m))}`;
      layerNames.push(mname(m));
      layers.push(layer(id, mname(m), frames(id, (ri, fi, p) => hasMat(ri, fi, p, m)), ` data-material="${m}"`));
    }
  } else {
    for (const part of partIds as string[]) {
      const pid = `layer-${sid(part)}`;
      layerNames.push(part);
      const subs: string[] = [];
      for (const m of mats) {
        const sub = `${pid}-${sid(mname(m))}`;
        const body = frames(sub, (ri, fi, p) => hasMat(ri, fi, p, m) && ownerOf(ri, fi, p) === part);
        if (body) subs.push(`<g id="${sub}" inkscape:label="${esc(mname(m))}" data-material="${m}">\n${body}\n</g>`);
      }
      layers.push(layer(pid, part, subs.join("\n")));
    }
  }

  // ---- guides ----
  const gd: string[] = [];
  const stroke = (c: string, w: number, extra = "") => `fill="none" stroke="${c}" stroke-width="${w}" ${extra}`;
  // the static frame furniture is identical for every frame of a size: define once, <use> per frame
  const frameSyms = new Map<string, string>();
  const frameSym = (w: number, h: number) => {
    const key = `${w}x${h}`;
    if (!frameSyms.has(key))
      frameSyms.set(key,
        `<symbol id="pb-gf-${key}" overflow="visible">` +
        `<rect width="${w}" height="${h}" fill="url(#pb-px)"/><rect width="${w}" height="${h}" fill="url(#pb-tile)"/>` +
        `<line x1="${w / 2}" y1="0" x2="${w / 2}" y2="${h}" stroke="#3498db" stroke-width="0.15" stroke-dasharray="1 0.5"/>` +
        `<rect x="1" y="1" width="${Math.max(0, w - 2)}" height="${Math.max(0, h - 2)}" ${stroke("#e67e22", 0.15, 'stroke-dasharray="0.6 0.6"')}/>` +
        `<rect width="${w}" height="${h}" ${stroke("#e84393", 0.3)}/></symbol>`);
    return `<use href="#pb-gf-${key}"/>`;
  };
  rows.forEach((r, ri) =>
    r.frames.forEach((s, fi) => {
      const [ox, oy] = L.origin(ri, fi);
      const f: string[] = [frameSym(s.w, s.h)];
      let maxY = -1;
      for (let p = 0; p < s.data.length; p++) if (s.data[p]) maxY = Math.max(maxY, Math.floor(p / s.w));
      if (maxY >= 0) f.push(`<line x1="0" y1="${maxY + 1}" x2="${s.w}" y2="${maxY + 1}" stroke="#2ecc71" stroke-width="0.25" stroke-dasharray="1 0.5"/>`);
      f.push(`<text x="0" y="-1.2" font-size="3.2" font-family="monospace" fill="#e84393">${esc(`${r.name} ${fi}`)}</text>`);
      const J = rig?.joints[ri]?.[fi];
      if (J) {
        const n = (v: number) => +v.toFixed(1);
        f.push(`<g ${stroke("#c0392b", 0.2)} font-size="1.6" font-family="monospace" opacity="0.85">` +
          Object.entries(J).map(([id, [x, y]]) =>
            `<path d="M${n(x - 0.8)} ${n(y)}h1.6M${n(x)} ${n(y - 0.8)}v1.6"/><text x="${n(x + 1)}" y="${n(y - 0.4)}" fill="#c0392b" stroke="none">${esc(id)}</text>`).join("") + `</g>`);
      }
      gd.push(`<g id="guide-frame-${ri}-${fi}" transform="translate(${ox},${oy})">${f.join("")}</g>`);
    }),
  );
  const defs =
    `<defs>` +
    `<pattern id="pb-px" width="1" height="1" patternUnits="userSpaceOnUse"><path shape-rendering="geometricPrecision" d="M1 0V1H0" fill="none" stroke="#000" stroke-width="0.04" opacity="0.2"/></pattern>` +
    `<pattern id="pb-tile" width="${tile}" height="${tile}" patternUnits="userSpaceOnUse"><path shape-rendering="geometricPrecision" d="M${tile} 0V${tile}H0" fill="none" stroke="#8e44ad" stroke-width="${+Math.max(0.12, L.width / 600).toFixed(2)}" opacity="0.75"/></pattern>` +
    [...frameSyms.values(), ...symbols].join("") +
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

/** Subpaths that are axis-aligned rectangles -> [x, y, w, h]; null if the path has anything else. */
function pathRects(d: string): [number, number, number, number][] | null {
  const out: [number, number, number, number][] = [];
  let pts: [number, number][] = [];
  let cx = 0, cy = 0, sx = 0, sy = 0, ok = true;
  const flush = () => {
    if (!pts.length) return;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
    if (pts.every((p) => (p[0] === x || p[0] === x + w) && (p[1] === y || p[1] === y + h))) out.push([x, y, w, h]);
    else ok = false;
    pts = [];
  };
  for (const m of d.matchAll(/([MmHhVvLlZz])([^MmHhVvLlZz]*)/g)) {
    const c = m[1], n = (m[2].match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
    const rel = c === c.toLowerCase();
    const U = c.toUpperCase();
    if (U === "Z") { cx = sx; cy = sy; flush(); continue; }
    const step = U === "H" || U === "V" ? 1 : 2;
    if (!n.length) { ok = false; continue; }
    for (let i = 0; i < n.length; i += step) {
      const first = U === "M" && i === 0;
      if (first) flush();
      else if (!pts.length) pts = [[sx, sy]];
      if (U === "M" || U === "L") { cx = rel ? cx + n[i] : n[i]; cy = rel ? cy + n[i + 1] : n[i + 1]; }
      else if (U === "H") cx = rel ? cx + n[i] : n[i];
      else cy = rel ? cy + n[i] : n[i];
      if (first) { sx = cx; sy = cy; pts = [[cx, cy]]; }
      else pts.push([cx, cy]);
    }
  }
  flush();
  return ok && out.length ? out : null;
}

/** Read a (pixel-builder or hand-edited) SVG back into frames. Guides and hidden layers are skipped. */
export function svgToSprites(svg: string, kit: StyleKit): ParsedSvg {
  const notes: string[] = [];
  const metaText = /<desc\b[^>]*id="pixel-builder-meta"[^>]*>([\s\S]*?)<\/desc>/.exec(svg)?.[1];
  let meta: any;
  if (metaText) {
    try { meta = JSON.parse(unesc(metaText)); } catch { notes.push("metadata could not be parsed; frames were inferred from groups"); }
  }
  // <use href="#pb-sN" x y/> of a pixel symbol: inline its content (inherits the surrounding material group)
  const syms = new Map<string, string>();
  for (const m of svg.matchAll(/<symbol\b([^>]*)>([\s\S]*?)<\/symbol\s*>/g)) {
    const id = attrsOf(m[1]).id;
    if (id?.startsWith("pb-s")) syms.set(id, m[2]);
  }
  const expanded = !syms.size ? svg : svg.replace(/<use\b([^>]*?)\/?>/g, (all, rest) => {
    const a = attrsOf(rest);
    const inner = syms.get((a.href ?? a["xlink:href"] ?? "").replace(/^#/, ""));
    if (inner === undefined) return all;
    return `<g transform="translate(${Number(a.x) || 0},${Number(a.y) || 0})${a.transform ? " " + a.transform : ""}">${inner}</g>`;
  });
  const body = expanded
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<(desc|metadata|title|defs|pattern|style|script|clipPath|mask)\b[\s\S]*?<\/\1\s*>/gi, "");
  if (!/<svg\b/i.test(body)) throw new Error("Not an SVG file (no <svg> element).");
  const flat = flattenRamps(resolveRamps(kit));
  const quant = makeQuantizer(resolveRamps(kit));
  const byHex = new Map<string, number>();
  flat.forEach((h, i) => { if (h && !byHex.has(h.toLowerCase())) byHex.set(h.toLowerCase(), i); });

  interface G { tx: number; ty: number; hidden: boolean; guides: boolean; inh: Record<string, string>; frame?: { key: string; bx: number; by: number } }
  const stack: G[] = [{ tx: 0, ty: 0, hidden: false, guides: false, inh: {} }];
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
  let skipped = 0, skippedPaths = 0;
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
        inh: { ...top.inh },
      };
      for (const k of ["fill", "data-material", "data-level"]) if (a[k] !== undefined) g.inh[k] = a[k];
      const fm = /(?:^|-)frame-(\d+-\d+)$/.exec(a.id ?? "");
      if (fm && !top.frame) g.frame = { key: fm[1], bx: g.tx, by: g.ty };
      if (!selfClose) stack.push(g);
      continue;
    }
    if ((tag !== "rect" && tag !== "path") || close) continue;
    if (top.hidden || top.guides) continue;
    const a = styleOf({ ...top.inh, ...attrsOf(rest) });
    if (/^none$/i.test(a.display ?? "") || /^(hidden|collapse)$/i.test(a.visibility ?? "")) continue;
    if (/^none$/i.test(a.fill ?? "") || Number(a.opacity ?? 1) < 0.5 || Number(a["fill-opacity"] ?? 1) < 0.5) continue;
    const [dx, dy] = translateOf(a.transform);
    const num = (v?: string) => Number.parseFloat(v ?? "0") || 0;
    const geoms: [number, number, number, number][] = [];
    if (tag === "rect") geoms.push([num(a.x), num(a.y), num(a.width), num(a.height)]);
    else {
      const r = pathRects(a.d ?? "");
      if (!r) { skippedPaths++; continue; }
      geoms.push(...r);
    }
    const base = top.frame ?? { key: "0-0", bx: 0, by: 0 };

    let idx = 0;
    const dm = a["data-material"] as Material | undefined;
    const dIdx = dm && (MATERIALS as readonly string[]).includes(dm) && a["data-level"] !== undefined ? colorIndex(dm, Number(a["data-level"])) : 0;
    const rgb = parseColor(a.fill);
    if (dIdx && (!rgb || rgbHex(rgb) === (flat[dIdx] ?? "").toLowerCase())) idx = dIdx;
    else if (rgb) idx = byHex.get(rgbHex(rgb)) ?? quant(rgb);
    else if (dIdx) idx = dIdx;
    else { skipped++; continue; }
    const f = frameOf(base.key);
    for (const [gx, gy, gw, gh] of geoms) {
      const w = Math.round(gw), h = Math.round(gh);
      if (w <= 0 || h <= 0) continue;
      const x0 = Math.round(top.tx + dx + gx - base.bx), y0 = Math.round(top.ty + dy + gy - base.by);
      for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) f.px.push({ x: x0 + xx, y: y0 + yy, idx });
    }
  }
  if (skippedPaths) notes.push(`${skippedPaths} path(s) skipped: only axis-aligned rectangles (M x y h w v h h -w z) are read as pixels`);
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

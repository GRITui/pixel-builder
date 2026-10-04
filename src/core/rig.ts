// Rig method: a character is a skeleton of joints plus declarative parts
// attached to them. Animations are poses (joint offsets per frame), so every
// rig gets every clip, and accessories attach to a joint once and follow every
// frame and direction. Parts are drawn with the lit Painter, so rigged sprites
// keep the kit's lighting, shade steps and outline like everything else.
//
// Rigs, clips and attachments are plain JSON (serialisable in the project
// file, editable in the UI, authorable by agents through MCP).
import { finalize } from "./enforce";
import { buildLegend } from "./legend";
import { Painter } from "./painter";
import { decodeIndex, MATERIALS, type Material } from "./palette";
import { richParts, richShade } from "./rigs/detail";
import type { FrameSet, Sprite, StyleKit } from "./types";

/** Drawing views. "left" is rendered as the mirror of "side" (lighting is recomputed, not flipped). */
export type View = "down" | "side" | "up";
/** 3/4 views: front-three-quarter and back-three-quarter (right-facing; mirrored for the left diagonals). */
export type DiagView = "down-side" | "up-side";
export type RigView = View | DiagView;
export type Dir = "down" | "down-right" | "right" | "up-right" | "up" | "up-left" | "left" | "down-left";
/** The classic four directions (row order of every 4-direction asset). */
export const DIRS: Dir[] = ["down", "left", "right", "up"];
/** All eight directions in document order; the diagonals are 3/4 views (`down-side`, `up-side`), mirrored for the left ones. */
export const DIRS8: Dir[] = ["down", "down-right", "right", "up-right", "up", "up-left", "left", "down-left"];
export type Directions = 4 | 8;
export const viewOf = (d: Dir): RigView =>
  d === "left" || d === "right" ? "side" : d === "down-left" || d === "down-right" ? "down-side" : d === "up-left" || d === "up-right" ? "up-side" : d;
const isMirrored = (d: Dir) => d === "left" || d === "down-left" || d === "up-left";
const isDiagonal = (v: RigView): v is DiagView => v === "down-side" || v === "up-side";
/** Foreshortening of side-view x motion when a diagonal view borrows the side clip. */
const DIAG_X = 0.75;

type PerView<T> = T | Partial<Record<RigView, T>>;

export interface Joint {
  id: string;
  parent: string | null;
  /** Rest position on the rig's design grid, per view (absolute, not relative to the parent). */
  rest: PerView<[number, number]>;
}

interface PartBase {
  /** Unique within the rig (attachments may replace a part by reusing its id). */
  id: string;
  /** Draw order; higher is in front. May differ per view (e.g. a held tool is behind the body in "up"). */
  z: PerView<number>;
  /** Hide this part in the diagonal views even though it appears in "side" (its diagonal replacement is a separate part). */
  noDiag?: boolean;
  /**
   * Views the part appears in (default: all). Diagonal views: a part that lists a diagonal view
   * appears exactly there; otherwise it follows its "side" view (down-only/up-only parts are hidden
   * in 3/4 views, and in `up-side` face-like parts, see FRONT_FEATURE, are dropped).
   */
  views?: RigView[];
  /** Material slot ("skin", "top", ...) resolved through the asset's slot map, or a literal material name. */
  slot?: string;
  /** Shift the shade by whole ramp levels. */
  tone?: number;
}

export type PartDef =
  | (PartBase & { kind: "ellipse"; joint: string; rx: number; ry: number; dx?: number; dy?: number; flat?: number })
  | (PartBase & { kind: "box"; joint: string; w: number; h: number; dx?: number; dy?: number; normal?: [number, number, number] })
  /** Limb between two joints, lit like a cylinder along its length. */
  | (PartBase & { kind: "limb"; from: string; to: string; r: number })
  /** Hand-painted detail in palette legend chars, pinned at a joint (eyes, hats, tools). Rows are mirrored for "left". */
  | (PartBase & { kind: "pixels"; joint: string; rows: PerView<string[]>; anchor: [number, number] });

export interface RigDef {
  id: string;
  name: string;
  /** Design grid size; rendering scales coordinates by kitSize / grid. */
  grid: number;
  joints: Joint[];
  parts: PartDef[];
  /** Material slots this rig expects, with defaults. */
  slots: Record<string, Material>;
}

/** Per-frame joint offsets [dx, dy] in grid units; children inherit their parent's offset. */
export type Pose = Record<string, [number, number]>;

export interface Clip {
  id: string;
  fps: number;
  /** Frames for all views, or per-view overrides (e.g. side view swings legs on x, front view lifts them on y). */
  frames: PerView<Pose[]>;
}

/** An accessory: extra parts attached to joints of a rig (hat, hoe, basket...). */
export interface Attachment {
  id: string;
  name: string;
  parts: PartDef[];
  /**
   * Extra joints the attachment brings (e.g. a hoe's `toolTip`, child of
   * `handR`). They are added to the rig while rendering, so clips can pose
   * them and `limb` parts can run from a hand to them (rotating tools).
   */
  joints?: Joint[];
}

/** The rig plus every joint contributed by its attachments. */
export function withAttachmentJoints(rig: RigDef, attachments: Attachment[] = []): RigDef {
  const extra = attachments.flatMap((a) => a.joints ?? []);
  if (!extra.length) return rig;
  const ids = new Set(rig.joints.map((j) => j.id));
  return { ...rig, joints: [...rig.joints, ...extra.filter((j) => !ids.has(j.id) && (ids.add(j.id), true))] };
}

export interface RigRender {
  rig: RigDef;
  slots?: Record<string, Material>;
  attachments?: Attachment[];
  kit: StyleKit;
  /** Output size in pixels (square). Default: kit.sizes.character. */
  size?: number;
}

export interface RenderOptions {
  /** 4 (default: down, left, right, up) or 8 (adds the four 3/4 diagonals). */
  directions?: Directions;
}

const VIEW_KEYS: RigView[] = ["down", "down-side", "side", "up-side", "up"];
const isPerView = (v: unknown): v is Partial<Record<RigView, unknown>> =>
  v !== null && typeof v === "object" && !Array.isArray(v) && VIEW_KEYS.some((k) => k in (v as object));

function pick<T>(v: PerView<T>, view: RigView): T {
  if (isPerView(v)) {
    const pv = v as Partial<Record<RigView, T>>;
    // a diagonal with no data of its own follows the side view
    return (pv[view] ?? (isDiagonal(view) ? pv.side : undefined) ?? pv.down ?? pv.side ?? pv.up ?? pv["down-side"] ?? pv["up-side"]) as T;
  }
  return v as T;
}

/** Joint rest: a missing diagonal is the midpoint between the neighbouring front/back view and the side view. */
function pickRest(v: PerView<[number, number]>, view: RigView): [number, number] {
  if (isPerView(v) && isDiagonal(view) && !(view in v)) {
    const pv = v as Partial<Record<RigView, [number, number]>>;
    const a = pv[view === "down-side" ? "down" : "up"], b = pv.side;
    if (a && b) return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  }
  return pick(v, view);
}

/** Face-like parts are not visible from behind (used to filter side parts in `up-side`). */
const FRONT_FEATURE = /eye|nose|mouth|face|lip|blush|lash|snout|beak|wattle|fringe|muzzle|jaw|beard|mustache|glasses|freckle|wrinkle/i;

function visibleIn(p: PartDef, view: RigView): boolean {
  if (!p.views) return true;
  if (p.views.includes(view)) return true;
  if (!isDiagonal(view) || p.noDiag || p.views.some(isDiagonal)) return false;
  if (!p.views.includes("side")) return false;
  return !(view === "up-side" && FRONT_FEATURE.test(p.id));
}

/** World positions of every joint for a view and pose (offsets accumulate down the hierarchy). */
export function solvePose(rig: RigDef, view: RigView, pose: Pose = {}): Record<string, [number, number]> {
  const byId = new Map(rig.joints.map((j) => [j.id, j]));
  const acc = new Map<string, [number, number]>();
  const offset = (id: string): [number, number] => {
    const hit = acc.get(id);
    if (hit) return hit;
    const j = byId.get(id);
    if (!j) throw new Error(`Unknown joint "${id}" in rig "${rig.id}"`);
    const own = pose[id] ?? [0, 0];
    const parent = j.parent ? offset(j.parent) : [0, 0];
    const o: [number, number] = [own[0] + parent[0], own[1] + parent[1]];
    acc.set(id, o);
    return o;
  };
  const out: Record<string, [number, number]> = {};
  for (const j of rig.joints) {
    const r = pickRest(j.rest, view);
    const o = offset(j.id);
    out[j.id] = [r[0] + o[0], r[1] + o[1]];
  }
  return out;
}

export function clipFrames(clip: Clip, view: RigView): Pose[] {
  const f = clip.frames;
  if (isPerView(f) && isDiagonal(view) && !(view in f) && f.side) {
    // borrow the side frames, foreshortened on x (the character is turned 45 degrees)
    return f.side.map((pose) => Object.fromEntries(Object.entries(pose).map(([k, o]) => [k, [o[0] * DIAG_X, o[1]] as [number, number]])));
  }
  return pick(f, view);
}

/** Render one frame of a rig to a finished sprite. */
export function renderRigFrame(r: RigRender, dir: Dir, pose: Pose = {}): Sprite {
  const { rig, kit } = r;
  const size = r.size ?? kit.sizes.character;
  const k = size / rig.grid;
  const view = viewOf(dir);
  const flip = isMirrored(dir);
  const J = solvePose(withAttachmentJoints(rig, r.attachments), view, pose);
  const X = (x: number) => (flip ? size - x * k : x * k);
  const Y = (y: number) => y * k;
  const slots = { ...rig.slots, ...(r.slots ?? {}) };
  const mat = (p: PartDef): Material => {
    const s = p.slot ?? "skin";
    const m = (slots[s] ?? s) as Material;
    return (MATERIALS as readonly string[]).includes(m) ? m : "skin";
  };
  const legend = buildLegend(kit);

  // attachments replace parts with the same id, otherwise add to them
  const parts = new Map<string, PartDef>(rig.parts.map((p) => [p.id, p]));
  for (const a of r.attachments ?? []) for (const p of a.parts) parts.set(p.id, p);
  if (kit.detail === "rich") for (const p of richParts(rig, parts, size)) parts.set(p.id, p);
  const ordered = [...parts.values()]
    .filter((p) => visibleIn(p, view))
    .sort((a, b) => pick(a.z, view) - pick(b.z, view));

  const P = new Painter(size, size, kit);
  for (const p of ordered) {
    const opts = { tone: p.tone };
    P.setLayer(p.id, pick(p.z, view));
    const joint = (id: string) => {
      const j = J[id];
      if (!j) throw new Error(`Part "${p.id}" references unknown joint "${id}"`);
      return j;
    };
    switch (p.kind) {
      case "ellipse": {
        const [x, y] = joint(p.joint);
        P.ellipse(X(x + (p.dx ?? 0)), Y(y + (p.dy ?? 0)), p.rx * k, p.ry * k, mat(p), { ...opts, flat: p.flat });
        break;
      }
      case "box": {
        const [x, y] = joint(p.joint);
        const w = Math.max(1, Math.round(p.w * k));
        const left = flip ? size - (x + (p.dx ?? 0)) * k - w : (x + (p.dx ?? 0)) * k;
        const n = p.normal ? ([flip ? -p.normal[0] : p.normal[0], p.normal[1], p.normal[2]] as [number, number, number]) : undefined;
        P.box(Math.round(left), Math.round(Y(y + (p.dy ?? 0))), w, Math.max(1, Math.round(p.h * k)), mat(p), n, opts);
        break;
      }
      case "limb": {
        const [ax, ay] = joint(p.from), [bx, by] = joint(p.to);
        P.capsule(X(ax), Y(ay), X(bx), Y(by), Math.max(0.6, p.r * k), mat(p), opts);
        break;
      }
      case "pixels": {
        const [x, y] = joint(p.joint);
        const rows = pick(p.rows, view);
        const w = Math.max(...rows.map((s) => s.length), 0);
        // pixel details are authored at 1 px per cell and are not scaled; anchor scales with the rig
        const ox = Math.round(X(x)) - (flip ? w - 1 - p.anchor[0] : p.anchor[0]);
        const oy = Math.round(Y(y)) - p.anchor[1];
        rows.forEach((row, j) => {
          for (let i = 0; i < row.length; i++) {
            const idx = legend.byChar.get(row[flip ? row.length - 1 - i : i]);
            const d = idx ? decodeIndex(idx) : null;
            if (d) P.px(ox + i, oy + j, d.mat, d.level + (p.tone ?? 0));
          }
        });
        break;
      }
    }
  }
  if (kit.detail === "rich") richShade(P, { rig, parts, slots, J, view, flip, size });
  return finalize(P.toSprite(), kit);
}

/** Render clips x 4 (or 8) directions as animation rows named `<clip>-<dir>`. */
export function renderRig(r: RigRender, clips: Clip[], opts: RenderOptions = {}): FrameSet[] {
  const rows: FrameSet[] = [];
  const dirs = opts.directions === 8 ? DIRS8 : DIRS;
  for (const clip of clips)
    for (const dir of dirs) {
      const frames = clipFrames(clip, viewOf(dir));
      rows.push({ name: `${clip.id}-${dir}`, frames: (frames.length ? frames : [{}]).map((pose) => renderRigFrame(r, dir, pose)) });
    }
  return rows;
}

/**
 * How a rigged asset was made, stored on `Asset.source.rig` so it can be
 * re-rendered when the kit changes. Rigs, clips and attachments are referenced
 * by registry id (src/core/rigs/index.ts) or embedded as JSON (agent/user-authored).
 */
export interface RigRecipe {
  rig: string | RigDef;
  slots?: Record<string, Material>;
  attachments?: (string | Attachment)[];
  clips: (string | Clip)[];
  /** 4 (default) or 8 directions (adds the 3/4 diagonals). */
  directions?: Directions;
}

/** Structural checks so hand-written or agent-written rigs fail with a clear message. */
export function validateRig(base: RigDef, attachments: Attachment[] = []): string[] {
  const errs: string[] = [];
  const rig = withAttachmentJoints(base, attachments);
  const ids = new Set(rig.joints.map((j) => j.id));
  if (ids.size !== rig.joints.length) errs.push("duplicate joint ids");
  for (const j of rig.joints) if (j.parent && !ids.has(j.parent)) errs.push(`joint ${j.id}: unknown parent ${j.parent}`);
  // cycle check
  for (const j of rig.joints) {
    const seen = new Set<string>();
    let cur: string | null = j.id;
    while (cur) {
      if (seen.has(cur)) { errs.push(`joint ${j.id}: parent cycle`); break; }
      seen.add(cur);
      cur = rig.joints.find((x) => x.id === cur)?.parent ?? null;
    }
  }
  for (const p of [...rig.parts, ...attachments.flatMap((a) => a.parts)]) {
    const refs = p.kind === "limb" ? [p.from, p.to] : [p.joint];
    for (const r of refs) if (!ids.has(r)) errs.push(`part ${p.id}: unknown joint ${r}`);
  }
  return errs;
}

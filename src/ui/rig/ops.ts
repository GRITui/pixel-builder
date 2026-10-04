// Pure logic for the rig editor: pose edits, joint hit-testing, frame lists, history.
import { solvePose, type Clip, type Pose, type RigDef, type View } from "../../core/rig";
import { rigById, type RigFamily } from "../../core/rigs";
import { BIRD_JOINTS, HUMANOID_JOINTS, QUADRUPED_JOINTS } from "../../core/rigs/joints";

export const VIEWS: View[] = ["down", "side", "up"];
export type ViewFrames = Record<View, Pose[]>;
export type Pt = [number, number];

const snap = (n: number, step: number) => Math.round(n / step) * step;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** Expand a clip's frames (shared or per-view) into one list per view, never empty. */
export function framesPerView(clip: Clip | undefined): ViewFrames {
  const f = clip?.frames;
  const out = { down: [] as Pose[], side: [] as Pose[], up: [] as Pose[] };
  const isArr = Array.isArray(f);
  for (const v of VIEWS) {
    const list = isArr ? f : f ? (f[v] ?? f.down ?? f.side ?? f.up ?? []) : [];
    out[v] = clone(list as Pose[]);
  }
  const n = Math.max(1, ...VIEWS.map((v) => out[v].length));
  for (const v of VIEWS) while (out[v].length < n) out[v].push(clone(out[v][out[v].length - 1] ?? {}));
  return out;
}

export function frameCount(f: ViewFrames): number {
  return f.down.length;
}

/** Drop zero offsets so saved clips stay small. */
export function cleanPose(p: Pose): Pose {
  const o: Pose = {};
  for (const [k, v] of Object.entries(p)) if (v[0] !== 0 || v[1] !== 0) o[k] = [v[0], v[1]];
  return o;
}

export function toClip(id: string, fps: number, f: ViewFrames): Clip {
  return { id, fps, frames: { down: f.down.map(cleanPose), side: f.side.map(cleanPose), up: f.up.map(cleanPose) } };
}

/** Set a joint's own offset so that its world position lands on `target` (grid units, snapped). */
export function dragJoint(rig: RigDef, view: View, pose: Pose, jointId: string, target: Pt, step = 0.5): Pose {
  const base = solvePose(rig, view, { ...pose, [jointId]: [0, 0] })[jointId];
  if (!base) return pose;
  const d: Pt = [snap(target[0] - base[0], step) + 0, snap(target[1] - base[1], step) + 0];
  const next = { ...pose };
  if (d[0] === 0 && d[1] === 0) delete next[jointId];
  else next[jointId] = d;
  return next;
}

/** Joint under a point (grid units) within `radius`, nearest wins; later joints win ties. */
export function hitJoint(positions: Record<string, Pt>, p: Pt, radius: number): string | null {
  let best: string | null = null;
  let bd = radius * radius;
  for (const [id, [x, y]] of Object.entries(positions)) {
    const d = (x - p[0]) ** 2 + (y - p[1]) ** 2;
    if (d <= bd) {
      bd = d;
      best = id;
    }
  }
  return best;
}

/** Bones as [parent, child] pairs for drawing. */
export function bones(rig: RigDef): [string, string][] {
  return rig.joints.filter((j) => j.parent).map((j) => [j.parent as string, j.id]);
}

// Frame list edits apply to every view so the views stay the same length.
export function setPose(f: ViewFrames, view: View, i: number, pose: Pose): ViewFrames {
  return { ...f, [view]: f[view].map((p, k) => (k === i ? pose : p)) };
}
export function addFrame(f: ViewFrames, after: number): ViewFrames {
  const o = {} as ViewFrames;
  for (const v of VIEWS) o[v] = [...f[v].slice(0, after + 1), {}, ...f[v].slice(after + 1)];
  return o;
}
export function duplicateFrame(f: ViewFrames, i: number): ViewFrames {
  const o = {} as ViewFrames;
  for (const v of VIEWS) o[v] = [...f[v].slice(0, i + 1), clone(f[v][i]), ...f[v].slice(i + 1)];
  return o;
}
export function deleteFrame(f: ViewFrames, i: number): ViewFrames {
  if (frameCount(f) <= 1) return f;
  const o = {} as ViewFrames;
  for (const v of VIEWS) o[v] = f[v].filter((_, k) => k !== i);
  return o;
}

// ---- history (snapshots; the frame data is tiny) ----
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}
export const createHistory = <T,>(present: T): History<T> => ({ past: [], present, future: [] });
export function pushHistory<T>(h: History<T>, next: T, limit = 100): History<T> {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-limit), present: next, future: [] };
}
export const canUndo = <T,>(h: History<T>) => h.past.length > 0;
export const canRedo = <T,>(h: History<T>) => h.future.length > 0;
export function undo<T>(h: History<T>): History<T> {
  return canUndo(h) ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h;
}
export function redo<T>(h: History<T>): History<T> {
  return canRedo(h) ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h;
}

/** Rig family for the "Describe animation" box: the registry's, else the family whose joint contract the rig contains. */
export function clipFamily(rig: RigDef): RigFamily | null {
  const reg = rigById(rig.id);
  if (reg) return reg.family;
  const ids = new Set(rig.joints.map((j) => j.id));
  const contracts: [RigFamily, readonly string[]][] = [["humanoid", HUMANOID_JOINTS], ["quadruped", QUADRUPED_JOINTS], ["bird", BIRD_JOINTS], ["fish", ["body", "head", "tail", "finTop", "finL", "finR"]]];
  return contracts.find(([, js]) => js.every((j) => ids.has(j)))?.[0] ?? null;
}

// POST /api/clip: natural language -> animation Clip for a rig family. The model
// sees the family's joint contract plus a few built-in clips as few-shot examples
// and returns per-view frames (structured output). Everything it returns is
// untrusted: validated against the joint list, offset range and ground contact,
// ONE repair round with readable errors, then 422.
import { callStructured, type StructuredCall } from "./claude";
import { HttpError, cleanText, requirePrompt, type JsonSchema } from "./prompts";
import { clipFrames, type Clip, type Pose, type RigDef, type View } from "../src/core/rig";
import { BIRD_JOINTS, HUMANOID_JOINTS, QUADRUPED_JOINTS } from "../src/core/rigs/joints";
import { MONSTER_JOINTS } from "../src/core/rigs/monsters";
import { clipById, RIGS, rigById, type RigFamily } from "../src/core/rigs";

const FISH_JOINTS = ["body", "head", "tail", "finTop", "finL", "finR"] as const;
export const FAMILY_JOINTS: Record<RigFamily, readonly string[]> = {
  humanoid: HUMANOID_JOINTS, quadruped: QUADRUPED_JOINTS, bird: BIRD_JOINTS, fish: FISH_JOINTS,
  monster: MONSTER_JOINTS, beast: QUADRUPED_JOINTS, undead: HUMANOID_JOINTS,
};
const FAMILIES = Object.keys(FAMILY_JOINTS) as RigFamily[];
/** Joints that touch the ground; fish swim, so they have none. */
export const GROUND_JOINTS: Record<RigFamily, readonly string[]> = {
  humanoid: ["footL", "footR"], quadruped: ["footFL", "footFR", "footBL", "footBR"], bird: ["footL", "footR"], fish: [],
  monster: [], beast: ["footFL", "footFR", "footBL", "footBR"], undead: ["footL", "footR"],
};
const VIEWS: View[] = ["down", "side", "up"];

export const MAX_OFFSET = 6; // grid units (design grid 32); built-in clips (chop, mine, graze) reach 6
export const MAX_OFFSET_JUMP = 8;
export const MIN_FRAMES = 2;
export const MAX_FRAMES = 12;
const SINK_TOL = 0.5; // a foot may not go below its rest position (the ground)
const AIR_TOL = 2; // ...nor hover more than this above it with every foot

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** Prompts that mean leaving the ground on purpose. */
export const impliesJump = (prompt: string) => /\b(jump|jumps|jumping|leap|leaps|hop|hops|hopping|bounce|bounces|bounding|fly|flies|flying|flap|flaps|flapping|vault|pounce|rear up|rears up|spring)\b/i.test(prompt);

export interface ClipRequest {
  prompt: string;
  family: RigFamily;
  rig?: RigDef;
  fps?: number;
  frames?: number;
}

export function normalizeClipRequest(body: Record<string, unknown>): ClipRequest {
  const prompt = requirePrompt(body.prompt);
  if (typeof body.family !== "string" || !FAMILIES.includes(body.family as RigFamily)) throw new HttpError(400, `\`family\` must be one of ${FAMILIES.join(", ")}.`);
  const family = body.family as RigFamily;
  let rig: RigDef | undefined;
  if (typeof body.rig === "string") {
    rig = rigById(body.rig)?.rig;
    if (!rig) throw new HttpError(400, `Unknown rig '${cleanText(body.rig, 60)}'.`);
  } else if (isObj(body.rig)) {
    const joints = body.rig.joints;
    if (!Array.isArray(joints) || joints.length < 1 || joints.length > 64 || !joints.every((j) => isObj(j) && typeof j.id === "string" && j.id && (j.parent === null || typeof j.parent === "string")))
      throw new HttpError(400, "`rig.joints` must be a list of {id, parent}.");
    rig = {
      id: cleanText(body.rig.id, 60) || "rig", name: "rig", grid: 32, parts: [], slots: {},
      joints: joints.map((j: any) => ({ id: cleanText(j.id, 40), parent: j.parent === null ? null : cleanText(j.parent, 40), rest: [0, 0] as [number, number] })),
    };
  }
  const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : undefined);
  return { prompt, family, rig, fps: num(body.fps, 1, 30), frames: num(body.frames, MIN_FRAMES, MAX_FRAMES) };
}

/** Joint ids the clip may pose: the supplied rig's joints, else the family contract. */
export function allowedJoints(family: RigFamily, rig?: RigDef): string[] {
  return rig ? rig.joints.map((j) => j.id) : [...FAMILY_JOINTS[family]];
}

const rigOf = (family: RigFamily, rig?: RigDef): RigDef => rig ?? RIGS.find((r) => r.family === family)!.rig;

// ---------- schema ----------
export function buildClipSchema(joints: string[]): JsonSchema {
  const offset = { type: "object", properties: { dx: { type: "number" }, dy: { type: "number" } }, required: ["dx", "dy"], additionalProperties: false };
  const pose = { type: "object", properties: Object.fromEntries(joints.map((j) => [j, offset])), required: joints, additionalProperties: false };
  const list = { type: "array", items: pose, description: "One pose per frame; every view must have the same number of frames" };
  return {
    type: "object",
    properties: {
      id: { type: "string", description: "kebab-case clip id, e.g. wai-bow" },
      fps: { type: "integer" },
      frames: { type: "object", properties: { down: list, side: list, up: list }, required: ["down", "side", "up"], additionalProperties: false },
      notes: { type: "string", description: "One sentence on the motion" },
    },
    required: ["id", "fps", "frames", "notes"],
    additionalProperties: false,
  };
}

// ---------- prompt ----------
const EXAMPLE_IDS: Record<RigFamily, string[]> = {
  humanoid: ["walk", "chop", "sit"], quadruped: ["walk", "idle"], bird: ["walk", "idle"], fish: ["swim", "idle"],
  monster: ["walk", "attack"], beast: ["walk", "attack"], undead: ["walk", "hurt"],
};

function compactClip(c: Clip, joints: readonly string[]) {
  const sparse = (p: Pose) => Object.fromEntries(Object.entries(p).filter(([j]) => joints.includes(j)));
  const frames = Object.fromEntries(VIEWS.map((v) => [v, clipFrames(c, v).map(sparse)]));
  return JSON.stringify({ id: c.id, fps: c.fps, frames });
}

export function buildClipPrompt(r: ClipRequest, repair?: { previous: unknown; errors: string[] }) {
  const joints = allowedJoints(r.family, r.rig);
  const jump = impliesJump(r.prompt);
  const rig = rigOf(r.family, r.rig);
  const tree = rig.joints.filter((j) => joints.includes(j.id)).map((j) => `${j.id}${j.parent ? `<-${j.parent}` : ""}`).join(", ");
  const grounds = GROUND_JOINTS[r.family];
  const system =
    "You are a game animator authoring a short pixel-art animation clip as joint offsets. Return JSON {id, fps, frames:{down,side,up}, notes}. " +
    "A pose gives every joint an offset {dx, dy} in grid units (design grid 32); 0,0 is the rest pose. x grows to the right (in the side view the character faces right), y grows DOWN, so dy < 0 lifts a joint. " +
    "Offsets accumulate down the hierarchy: moving a parent moves all its children, so a child only needs the extra motion on top of its parent's. " +
    "Views: 'down' faces the camera, 'side' faces right (swing limbs on x), 'up' faces away; every view needs the same number of frames, and the first and last frames should loop smoothly. " +
    `Keep offsets small (|dx|,|dy| <= ${jump ? MAX_OFFSET_JUMP : MAX_OFFSET}), write only motion that reads at 32px, and use anticipation, an extreme and a settle. Use whole or half numbers.`;
  const parts = [
    `Rig family: ${r.family}. Joints (child<-parent): ${tree}.`,
    grounds.length
      ? `Ground contact: ${grounds.join(", ")} stand on the ground at rest. ${jump ? "The request implies leaving the ground, so feet may lift, but keep the lift within the offset limit." : "Do not push feet below the ground (a foot's own dy plus its parents' dy must not exceed 0), and keep at least one foot planted in every frame (lift one foot at a time)."} If the body bobs down (hip dy > 0), counter it on the feet with a negative dy.`
      : "This family has no ground contact.",
    "",
    "Examples of finished clips (sparse: omitted joints are 0,0):",
    ...EXAMPLE_IDS[r.family].flatMap((id) => {
      const c = clipById(id, r.family)?.clip;
      return c ? [compactClip(c, joints)] : [];
    }),
    "",
    `Describe: ${r.prompt}`,
    r.frames ? `Use exactly ${r.frames} frames per view.` : `Use ${MIN_FRAMES + 2}..8 frames per view.`,
    r.fps ? `Use fps ${r.fps}.` : "Pick a suitable fps (slow gestures 4-6, walks 6-8).",
    `Include all of these joints in every pose: ${joints.join(", ")}.`,
  ];
  if (repair) parts.push("", "Your previous answer was invalid:", JSON.stringify(repair.previous), "Problems:", ...repair.errors.map((e) => `- ${e}`), "Return a corrected answer.");
  return { system, user: parts.join("\n"), schema: buildClipSchema(joints) };
}

// ---------- validation ----------
const toPose = (raw: unknown): Pose | null => {
  if (!isObj(raw)) return null;
  const out: Pose = {};
  for (const [j, o] of Object.entries(raw)) {
    const dx = Array.isArray(o) ? o[0] : isObj(o) ? o.dx : undefined;
    const dy = Array.isArray(o) ? o[1] : isObj(o) ? o.dy : undefined;
    if (typeof dx !== "number" || typeof dy !== "number" || !Number.isFinite(dx) || !Number.isFinite(dy)) out[j] = [NaN, NaN];
    else if (dx !== 0 || dy !== 0) out[j] = [dx, dy];
  }
  return out;
};

export interface ClipCheck {
  clip: Clip | null;
  errors: string[];
}

/**
 * Check a clip (model output or hand-written, offsets as [dx,dy] or {dx,dy}) for a family.
 * Returns the cleaned clip (zero offsets dropped, offsets rounded to 0.5) when there are no errors.
 */
export function checkClip(raw: unknown, req: Pick<ClipRequest, "family" | "rig" | "prompt" | "frames">): ClipCheck {
  const errors: string[] = [];
  if (!isObj(raw)) return { clip: null, errors: ["answer must be a JSON object {id, fps, frames}"] };
  const joints = new Set(allowedJoints(req.family, req.rig));
  const jump = impliesJump(req.prompt);
  const lim = jump ? MAX_OFFSET_JUMP : MAX_OFFSET;
  const fps = typeof raw.fps === "number" && Number.isFinite(raw.fps) ? raw.fps : NaN;
  if (!(fps >= 1 && fps <= 30)) errors.push(`fps must be a number 1..30 (got ${String(raw.fps)})`);
  const f = raw.frames;
  const lists: Partial<Record<View, Pose[]>> = {};
  if (Array.isArray(f)) {
    const l = f.map(toPose);
    if (l.some((p) => !p)) errors.push("frames must be poses {joint:{dx,dy}}");
    else for (const v of VIEWS) lists[v] = l as Pose[];
  } else if (isObj(f)) {
    for (const v of VIEWS) {
      const l = f[v];
      if (!Array.isArray(l)) errors.push(`frames.${v} must be an array of poses`);
      else {
        const poses = l.map(toPose);
        if (poses.some((p) => !p)) errors.push(`frames.${v} must contain poses {joint:{dx,dy}}`);
        else lists[v] = poses as Pose[];
      }
    }
  } else errors.push("frames must be {down:[...], side:[...], up:[...]}");
  if (errors.length) return { clip: null, errors };

  const n = lists.down!.length;
  if (n < MIN_FRAMES || n > MAX_FRAMES) errors.push(`needs ${MIN_FRAMES}..${MAX_FRAMES} frames per view (got ${n})`);
  if (req.frames && n !== req.frames) errors.push(`needs exactly ${req.frames} frames per view (got ${n})`);
  for (const v of VIEWS) if (lists[v]!.length !== n) errors.push(`frames.${v} has ${lists[v]!.length} frames but down has ${n}; all views need the same count`);
  if (errors.length) return { clip: null, errors };

  const rig = rigOf(req.family, req.rig);
  const parent = new Map(rig.joints.map((j) => [j.id, j.parent]));
  const grounds = GROUND_JOINTS[req.family].filter((g) => joints.has(g) && parent.has(g));
  const eff = (pose: Pose, id: string) => {
    let y = 0;
    for (let c: string | null | undefined = id; c; c = parent.get(c)) y += pose[c]?.[1] ?? 0;
    return y;
  };
  const cleaned: Record<View, Pose[]> = { down: [], side: [], up: [] };
  const seen = new Set<string>();
  const add = (msg: string) => {
    if (seen.size < 12 && !seen.has(msg)) {
      seen.add(msg);
      errors.push(msg);
    }
  };
  for (const v of VIEWS)
    lists[v]!.forEach((pose, i) => {
      const out: Pose = {};
      for (const [j, o] of Object.entries(pose)) {
        if (!joints.has(j)) add(`unknown joint '${j}' (frames.${v}[${i}]); use only: ${[...joints].join(", ")}`);
        else if (!Number.isFinite(o[0]) || !Number.isFinite(o[1])) add(`${j} in frames.${v}[${i}] needs numeric dx and dy`);
        else if (Math.abs(o[0]) > lim || Math.abs(o[1]) > lim) add(`${j} offset (${o[0]}, ${o[1]}) in frames.${v}[${i}] is outside +-${lim} grid units`);
        else {
          const r: [number, number] = [Math.round(o[0] * 2) / 2 + 0, Math.round(o[1] * 2) / 2 + 0];
          if (r[0] !== 0 || r[1] !== 0) out[j] = r;
        }
      }
      cleaned[v].push(out);
      if (!grounds.length || errors.length) return;
      const ys = grounds.map((g) => eff(out, g));
      const low = Math.max(...ys);
      if (low > SINK_TOL) add(`feet sink below the ground in frames.${v}[${i}] (${grounds[ys.indexOf(low)]} ends ${low} grid units too low); add a negative dy to the foot or reduce the body drop`);
      if (!jump && low < -AIR_TOL) add(`feet float in frames.${v}[${i}] (every foot is more than ${AIR_TOL} units above the ground); keep one foot planted, or lower the body less`);
    });
  if (errors.length) return { clip: null, errors };
  const id = cleanText(raw.id, 60).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "ai-clip";
  return { clip: { id, fps: Math.round(fps), frames: cleaned }, errors: [] };
}

export type ModelCall = (c: StructuredCall) => Promise<unknown>;

export async function clipRoute(body: Record<string, unknown>, signal: AbortSignal, call: ModelCall = callStructured) {
  const req = normalizeClipRequest(body);
  let repair: { previous: unknown; errors: string[] } | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { system, user, schema } = buildClipPrompt(req, repair);
    const raw = await call({ system, user, schema, effort: "high", maxTokens: 16000, signal });
    const { clip, errors } = checkClip(raw, req);
    if (clip) {
      if (req.fps) clip.fps = req.fps;
      return { clip, notes: isObj(raw) ? cleanText(raw.notes, 300) : "" };
    }
    repair = { previous: raw, errors };
  }
  throw new HttpError(422, `The model's clip stayed invalid after a repair attempt (${repair!.errors[0]}). Try again or describe a simpler motion.`);
}

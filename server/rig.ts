// POST /api/rig: text -> a rigged character or creature. The model either
// extends a registry rig (new attachments, material slots) or authors a new rig
// against a joint contract, with its own idle/walk clips when the skeleton is
// free-form. Output is untrusted: it is converted from the wire format,
// validated (validateRig + shape checks + a test render), sent back once with
// the error list for a repair round, then rejected with 422.
import { collectImages, withReferenceRule } from "./images";
import { callStructured, type StructuredCall } from "./claude";
import { HttpError, normalizeKit, requirePrompt, LIGHT_TEXT, cleanText } from "./prompts";
import { buildLegend, legendText } from "../src/core/legend";
import { MATERIALS } from "../src/core/palette";
import type { Attachment, Clip, RigDef } from "../src/core/rig";
import { ATTACHMENTS, CLIPS, RIGS, rigById } from "../src/core/rigs";
import { EXAMPLE_RIG, IDLE, NGOB_HAT, WALK } from "../src/core/rigs/example";
import type { StyleKit } from "../src/core/types";
import { CONTRACTS, MAX_ATTACHMENTS, buildRigSchema, checkRig, fromWire, type AuthorResult } from "./rig-schema";

export type ModelCall = (c: StructuredCall) => Promise<unknown>;

export interface RigRequest {
  prompt: string;
  kit: StyleKit;
  base?: string;
}

export function normalizeRigRequest(body: Record<string, unknown>): RigRequest {
  const prompt = requirePrompt(body.prompt);
  const kit = normalizeKit(body.kit);
  let base: string | undefined;
  if (body.base !== undefined && body.base !== null && body.base !== "") {
    const id = cleanText(body.base, 80);
    if (!rigById(id)) throw new HttpError(400, `\`base\` must be a built-in rig id (e.g. ${RIGS.slice(0, 3).map((r) => r.rig.id).join(", ")}).`);
    base = id;
  }
  return { prompt, kit, base };
}

const compact = (v: unknown) => JSON.stringify(v);

const SYSTEM = [
  "You are the rig author for a pixel-art tool. You turn a description into a rigged sprite: a skeleton of joints, volumetric parts pinned to joints, material slots and animation clips. A lit renderer draws the parts, so you never choose shades: you choose shapes, joints and materials.",
  "",
  "Two modes:",
  "- mode 'extend': keep a built-in rig (`baseRig` = its id) and author only what is new: attachments (clothes, tools, props: parts pinned to the base rig's joints) and `slots` (slot -> material overrides, e.g. top -> a robe colour). Set `rig` to null. Prefer this whenever a registry rig is the right body (people, common animals, birds, fish).",
  "- mode 'new': author a whole `rig` (vehicles, monsters, crabs, robots, anything the registry lacks). Pick `family`: humanoid, quadruped, bird or fish when you use that joint contract exactly (the family's built-in clips and attachments then fit), otherwise 'custom' with your own joints, and include your own 'idle' and 'walk' clips.",
  "",
  "Format rules:",
  "- Design grid is 32 x 32 (set grid 32). Keep everything inside 1..31 so the outline fits. A standing figure is about 27 units tall; small creatures 14-20.",
  "- Joint `rest` is an absolute [x, y] on the grid (y grows downward), either one point for every view or {down, side, up} (other views null). `parent` is another joint id or null for the single root. Children inherit the parent's pose offset.",
  "- Parts: kind ellipse {joint, rx, ry, dx?, dy?}, box {joint, w, h, dx?, dy?}, limb {from, to, r} (a lit capsule between two joints), pixels {joint, anchor [x,y], rows} (legend characters, 1 px per cell, ONLY for small details like eyes or buttons). Every part has a unique `id`, a `z` (draw order; higher is in front; may be per view) and a `slot` (a slot name from the rig/slots or a material name). Unused fields are null.",
  "- Side view is a profile facing right; 'left' is mirrored automatically. Give the `up` view a different z (back faces hidden) and show face parts (eyes, mouth) only in views down/side via `views`.",
  "- Use limbs for legs, arms, tails, antennae; ellipses for torsos, heads, shells; boxes for wheels, crates, rectangular things. Aim for 8-40 parts, readable silhouette at small sizes.",
  "- Clips: `fps` plus frames, each frame is a list of {joint, dx, dy} offsets in grid units (joints omitted do not move). Use `all` for views that share frames, or down/side/up for per-view frames (legs swing on x in the side view, lift on y from the front). 'idle' is 2-4 subtle frames; 'walk' is 4 frames. Only name joints that exist.",
  "- Attachments: {id, name, parts, joints?}. A part reusing an existing part id replaces it. Extra joints (like a tool tip) get a parent and an absolute rest.",
  "- Materials (use exactly these names): " + MATERIALS.join(", ") + ".",
  "- Return: `builtinAttachments` ([] when none), `name` (short title), `notes` (one sentence on what you built), `slots` (extra slot overrides in extend mode, else repeat the rig's slots).",
].join("\n");

const famLine = () =>
  (Object.entries(CONTRACTS) as [string, readonly string[]][])
    .map(([f, js]) => {
      const rigs = RIGS.filter((r) => r.family === f).map((r) => r.rig.id);
      return `- ${f}: joints ${js.join(", ")}\n  built-in rigs: ${rigs.slice(0, 14).join(", ")}${rigs.length > 14 ? ", ..." : ""}`;
    })
    .join("\n");

const attLine = (f: string) => {
  const ids = ATTACHMENTS.filter((a) => a.family === f).map((a) => a.attachment.id);
  return `${ids.slice(0, 80).join(", ")}${ids.length > 80 ? ", ..." : ""}`;
};

export function buildRigPrompt(r: RigRequest, repair?: { previous: unknown; errors: string[] }) {
  const { kit } = r;
  const legend = buildLegend(kit);
  const base = r.base ? rigById(r.base) : undefined;
  const exampleClips: Clip[] = [WALK, IDLE];
  const parts = [
    `Request: ${r.prompt}`,
    "",
    `Style kit: "${kit.name}". Art direction: ${kit.vibe}. Light comes from ${LIGHT_TEXT[kit.lightDir]}. Character canvas ${kit.sizes.character}px; the design grid is scaled to it.`,
    "",
    "Joint contracts and built-in rigs by family:",
    famLine(),
    "",
    "Built-in humanoid attachments: list the ids you want in `builtinAttachments` instead of re-authoring them: " + attLine("humanoid"),
    "",
    "Palette legend for `pixels` rows (each material has 5 levels, 0 darkest to 4 lightest; '.' = transparent):",
    legendText(legend),
    "",
    "Example rig (a minimal humanoid), compact JSON:",
    compact(EXAMPLE_RIG),
    "Example attachment (a hat pinned to the head joint):",
    compact(NGOB_HAT),
    "Example clips (note the per-view frames; Pose = {joint: [dx, dy]} in this stored form, but you return pose lists as [{joint, dx, dy}]):",
    compact(exampleClips),
  ];
  if (base) {
    parts.push(
      "",
      `You MUST use mode 'extend' with baseRig "${base.rig.id}" (family ${base.family}). Its joints: ${base.rig.joints.map((j) => j.id).join(", ")}. Its slots: ${compact(base.rig.slots)}. Its part ids: ${base.rig.parts.map((p) => p.id).join(", ")}.`,
      `Author at most ${MAX_ATTACHMENTS} attachments for it (clothes/props that fit the request); override slot materials for colours.`,
    );
  } else {
    parts.push("", `Choose the best mode. In extend mode author at most ${MAX_ATTACHMENTS} attachments.`);
  }
  if (repair) {
    parts.push("", "Your previous answer was rejected:", compact(repair.previous), "Problems:", ...repair.errors.slice(0, 20).map((e) => `- ${e}`), "Return a corrected, complete answer.");
  }
  return { system: SYSTEM, user: parts.join("\n"), schema: buildRigSchema() };
}

export interface RigResponse {
  /** Set only for mode 'new' (and a project-ready id). */
  rig?: RigDef;
  /** Registry rig id the result extends (mode 'extend') or the family-matching base for new rigs. */
  baseRig?: string;
  family: string;
  /** Registry attachment ids to wear (the family's hats, tools, hair). */
  attachmentIds?: string[];
  attachments?: Attachment[];
  /** Clips the rig brings (own idle/walk for free-form creatures). */
  clips?: Clip[];
  slots: Record<string, string>;
  name: string;
  notes: string;
}

export async function rigRoute(body: Record<string, unknown>, signal: AbortSignal, call: ModelCall = callStructured): Promise<RigResponse> {
  const req = normalizeRigRequest(body);
  const images = await collectImages(body);
  let repair: { previous: unknown; errors: string[] } | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = buildRigPrompt(req, repair);
    const { user, schema } = p;
    const system = withReferenceRule(p.system, images);
    const raw = await call({ system, user, images, schema, effort: "high", maxTokens: 32000, stream: true, signal });
    const res = fromWire(raw);
    if (req.base) res.mode = "extend", res.baseRig = req.base;
    const base = res.mode === "extend" ? (res.baseRig ? rigById(res.baseRig) : undefined) : undefined;
    const family = res.mode === "new" ? res.family : base?.family;
    const familyClips = family && family !== "custom" ? CLIPS.filter((c) => c.family === family).map((c) => c.clip.id) : [];
    const errors = checkRig(res, base?.rig, req.kit, familyClips);
    if (!errors.length) return toResponse(res, base?.rig.id);
    repair = { previous: raw, errors };
  }
  throw new HttpError(422, `The model's rig stayed invalid after a repair attempt: ${repair!.errors.slice(0, 5).join("; ")}`);
}

function toResponse(res: AuthorResult, baseId?: string): RigResponse {
  const slots = res.mode === "new" ? { ...res.rig!.slots, ...res.slots } : { ...rigById(baseId!)!.rig.slots, ...res.slots };
  return {
    ...(res.mode === "new" ? { rig: res.rig } : {}),
    ...(baseId ? { baseRig: baseId } : {}),
    family: res.mode === "new" ? res.family : (rigFamily(baseId) ?? "custom"),
    ...(res.builtinAttachments.length ? { attachmentIds: res.builtinAttachments } : {}),
    ...(res.attachments.length ? { attachments: res.attachments } : {}),
    ...(res.clips.length ? { clips: res.clips } : {}),
    slots,
    name: cleanText(res.name, 60) || res.rig?.name || "AI rig",
    notes: cleanText(res.notes, 400),
  };
}
const rigFamily = (id?: string) => (id ? rigById(id)?.family : undefined);

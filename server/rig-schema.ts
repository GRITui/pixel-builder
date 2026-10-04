// Wire format + JSON schema for the AI rig author (POST /api/rig).
// The schema is written by hand, once, here, and mirrors RigDef / PartDef /
// Attachment / Clip in src/core/rig.ts. Structured outputs need every property
// listed in `required` and `additionalProperties: false`, so:
//  - optional fields are nullable (`opt`) and stripped by `fromWire`;
//  - tuples are plain number arrays (length is checked by `checkRig`);
//  - records with free keys (slots, poses) are arrays of {key, value} pairs.
// `toWire` is the inverse, so registry rigs can be checked against the schema
// in a test (server/rig.test.ts) and the schema cannot drift from the types.
import { MATERIALS } from "../src/core/palette";
import { buildLegend } from "../src/core/legend";
import { renderRigFrame, validateRig, type Attachment, type Clip, type Joint, type PartDef, type Pose, type RigDef, type RigView } from "../src/core/rig";
import { attachmentById } from "../src/core/rigs";
import { BIRD_JOINTS, HUMANOID_JOINTS, QUADRUPED_JOINTS } from "../src/core/rigs/joints";
import { FISH_JOINTS } from "../src/core/rigs/fish";
import { MONSTER_JOINTS } from "../src/core/rigs/monsters";
import type { StyleKit } from "../src/core/types";
import type { JsonSchema } from "./prompts";

export const FAMILIES = ["humanoid", "quadruped", "bird", "fish", "monster", "custom"] as const;
export type AuthorFamily = (typeof FAMILIES)[number];
export const CONTRACTS: Record<Exclude<AuthorFamily, "custom">, readonly string[]> = {
  humanoid: HUMANOID_JOINTS,
  quadruped: QUADRUPED_JOINTS,
  bird: BIRD_JOINTS,
  fish: FISH_JOINTS,
  monster: MONSTER_JOINTS,
};

const VIEWS: RigView[] = ["down", "down-side", "side", "up-side", "up"];
const PART_KINDS = ["ellipse", "box", "limb", "pixels"] as const;
export const MAX_JOINTS = 40;
export const MAX_PARTS = 120;
export const MAX_ATTACHMENTS = 6;
export const MAX_CLIPS = 4;
export const MAX_FRAMES = 12;

// ---------- schema ----------
const num = { type: "number" };
const str = { type: "string" };
const nul = { type: "null" };
const opt = (s: JsonSchema): JsonSchema => ({ anyOf: [s, nul] });
const arr = (items: JsonSchema, description?: string): JsonSchema => ({ type: "array", items, ...(description ? { description } : {}) });
const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
/** A value for every view, or an object keyed by view (missing views are null). */
const perView = (s: JsonSchema): JsonSchema => ({ anyOf: [s, obj(Object.fromEntries(VIEWS.map((v) => [v, opt(s)])))] });
const point = arr(num, "[x, y] on the design grid");

const jointSchema = obj({ id: str, parent: opt(str), rest: perView(point) });
const partSchema = obj({
  id: str,
  kind: { type: "string", enum: [...PART_KINDS] },
  z: perView(num),
  joint: opt(str),
  from: opt(str),
  to: opt(str),
  r: opt(num),
  rx: opt(num),
  ry: opt(num),
  w: opt(num),
  h: opt(num),
  dx: opt(num),
  dy: opt(num),
  flat: opt(num),
  normal: opt(arr(num, "[nx, ny, nz]")),
  rows: opt(perView(arr(str))),
  anchor: opt(point),
  slot: opt(str),
  tone: opt(num),
  views: opt(arr({ type: "string", enum: VIEWS })),
  noDiag: opt({ type: "boolean" }),
});
const slotsSchema = arr(obj({ slot: str, material: { type: "string", enum: [...MATERIALS] } }), "slot name -> material");
const poseSchema = arr(obj({ joint: str, dx: num, dy: num }), "joint offsets for one frame; omitted joints do not move");
const attachmentSchema = obj({ id: str, name: str, parts: arr(partSchema), joints: opt(arr(jointSchema)) });
const rigSchema = obj({ id: str, name: str, grid: num, joints: arr(jointSchema), parts: arr(partSchema), slots: slotsSchema });
const clipSchema = obj({
  id: str,
  fps: num,
  all: opt(arr(poseSchema, "frames used for every view")),
  down: opt(arr(poseSchema)),
  side: opt(arr(poseSchema)),
  up: opt(arr(poseSchema)),
});

export function buildRigSchema(): JsonSchema {
  return obj({
    mode: { type: "string", enum: ["extend", "new"] },
    family: { type: "string", enum: [...FAMILIES] },
    baseRig: opt(str),
    rig: opt(rigSchema),
    slots: slotsSchema,
    builtinAttachments: arr(str, "ids of built-in attachments to wear (hats, tools, hair...)"),
    attachments: arr(attachmentSchema),
    clips: arr(clipSchema),
    name: str,
    notes: str,
  });
}
export const partJsonSchema = partSchema;
export const rigJsonSchema = rigSchema;
export const attachmentJsonSchema = attachmentSchema;

// ---------- wire <-> core ----------
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Drop nulls (the schema's stand-in for "absent"), recursively. */
export function stripNulls<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripNulls) as T;
  if (isObj(v)) return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && x !== undefined).map(([k, x]) => [k, stripNulls(x)])) as T;
  return v;
}

/** stripNulls also drops a root joint's `parent: null`, which is meaningful: put it back. */
function fixJoints<T>(o: T): T {
  const r = o as Record<string, unknown>;
  if (!isObj(r) || !Array.isArray(r.joints)) return o;
  return { ...r, joints: r.joints.map((j) => (isObj(j) ? { ...j, parent: j.parent ?? null } : j)) } as T;
}

const recordToPairs = (r: Record<string, string>) => Object.entries(r).map(([slot, material]) => ({ slot, material }));
const pairsToRecord = (p: unknown): Record<string, string> =>
  Object.fromEntries((Array.isArray(p) ? p : []).filter((x) => isObj(x) && typeof x.slot === "string" && typeof x.material === "string").map((x: any) => [x.slot, x.material]));
const poseToWire = (p: Pose) => Object.entries(p).map(([joint, [dx, dy]]) => ({ joint, dx, dy }));
const poseFromWire = (p: unknown): Pose =>
  Object.fromEntries((Array.isArray(p) ? p : []).filter((x) => isObj(x) && typeof x.joint === "string").map((x: any) => [x.joint, [Number(x.dx) || 0, Number(x.dy) || 0]]));

export const slotsToWire = recordToPairs;
export function partToWire(p: PartDef): Record<string, unknown> { return p as unknown as Record<string, unknown>; }
export function rigToWire(r: RigDef) { return { ...r, slots: recordToPairs(r.slots) }; }
export function attachmentToWire(a: Attachment) { return a; }
export function clipToWire(c: Clip) {
  const base = { id: c.id, fps: c.fps, all: null, down: null, side: null, up: null } as Record<string, unknown>;
  if (Array.isArray(c.frames)) base.all = c.frames.map(poseToWire);
  else for (const v of ["down", "side", "up"] as const) if (c.frames[v]) base[v] = c.frames[v]!.map(poseToWire);
  return base;
}

export interface AuthorResult {
  mode: "extend" | "new";
  family: AuthorFamily;
  baseRig?: string;
  rig?: RigDef;
  slots: Record<string, string>;
  /** Registry attachment ids to wear in addition to the authored ones. */
  builtinAttachments: string[];
  attachments: Attachment[];
  clips: Clip[];
  name: string;
  notes: string;
}

export function clipFromWire(c: Record<string, unknown>): Clip {
  const id = String(c.id ?? "");
  const fps = Math.max(1, Math.min(24, Number(c.fps) || 6));
  const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, MAX_FRAMES).map(poseFromWire) : null);
  const all = list(c.all);
  if (all?.length) return { id, fps, frames: all };
  const frames: Partial<Record<"down" | "side" | "up", Pose[]>> = {};
  for (const v of ["down", "side", "up"] as const) {
    const l = list(c[v]);
    if (l?.length) frames[v] = l;
  }
  return { id, fps, frames: frames as Clip["frames"] };
}

/** Untrusted model output -> typed result (nulls stripped, pairs folded into records). Never throws. */
export function fromWire(raw: unknown): AuthorResult {
  const r = isObj(raw) ? raw : {};
  const rigRaw = isObj(r.rig) ? fixJoints(stripNulls(r.rig)) : undefined;
  const list = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, max).filter(isObj) : []);
  const family = (FAMILIES as readonly string[]).includes(r.family as string) ? (r.family as AuthorFamily) : "custom";
  return {
    mode: r.mode === "new" ? "new" : "extend",
    family,
    baseRig: typeof r.baseRig === "string" && r.baseRig ? r.baseRig : undefined,
    rig: rigRaw ? ({ ...rigRaw, slots: pairsToRecord((rigRaw as any).slots) } as unknown as RigDef) : undefined,
    slots: pairsToRecord(r.slots),
    builtinAttachments: (Array.isArray(r.builtinAttachments) ? r.builtinAttachments : []).filter((x): x is string => typeof x === "string").slice(0, 12),
    attachments: list(r.attachments, MAX_ATTACHMENTS).map((a) => fixJoints(stripNulls(a)) as unknown as Attachment),
    clips: list(r.clips, MAX_CLIPS).map(clipFromWire),
    name: typeof r.name === "string" ? r.name : "",
    notes: typeof r.notes === "string" ? r.notes : "",
  };
}

// ---------- validation of untrusted results ----------
const isPt = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number" && Number.isFinite(n));
const eachPerView = <T>(v: unknown, f: (x: T) => string | null): string[] => {
  if (v === undefined) return [];
  const keys = isObj(v) && VIEWS.some((k) => k in v) ? VIEWS.filter((k) => (v as any)[k] !== undefined).map((k) => (v as any)[k]) : [v];
  return keys.flatMap((x) => f(x as T) ?? []);
};

function partErrors(p: PartDef, where: string, legendChars: Set<string>): string[] {
  const e: string[] = [];
  const id = `${where} part ${(p as any)?.id ?? "?"}`;
  if (!isObj(p) || typeof p.id !== "string" || !p.id) return [`${where}: every part needs a string id`];
  const finite = (k: string) => typeof (p as any)[k] === "number" && Number.isFinite((p as any)[k]);
  e.push(...eachPerView<number>(p.z, (z) => (typeof z === "number" && Number.isFinite(z) ? null : `${id}: z must be a number (or per-view numbers)`)));
  if (p.z === undefined) e.push(`${id}: z is required`);
  if (p.kind === "ellipse") for (const k of ["joint", "rx", "ry"]) if (!(k === "joint" ? typeof (p as any).joint === "string" : finite(k))) e.push(`${id}: ellipse needs ${k}`);
  if (p.kind === "box") for (const k of ["joint", "w", "h"]) if (!(k === "joint" ? typeof (p as any).joint === "string" : finite(k))) e.push(`${id}: box needs ${k}`);
  if (p.kind === "limb") {
    if (typeof p.from !== "string" || typeof p.to !== "string") e.push(`${id}: limb needs from and to joints`);
    if (!finite("r")) e.push(`${id}: limb needs r (radius)`);
  }
  if (p.kind === "pixels") {
    if (typeof p.joint !== "string") e.push(`${id}: pixels needs joint`);
    if (!isPt(p.anchor)) e.push(`${id}: pixels needs anchor [x, y]`);
    e.push(...eachPerView<string[]>(p.rows, (rows) => {
      if (!Array.isArray(rows) || !rows.length || !rows.every((s) => typeof s === "string")) return `${id}: rows must be arrays of strings`;
      const bad = rows.join("").split("").find((c) => !legendChars.has(c));
      return bad ? `${id}: rows use '${bad}', which is not a palette legend char ('.' = transparent)` : null;
    }));
    if (p.rows === undefined) e.push(`${id}: pixels needs rows`);
  }
  if (!(PART_KINDS as readonly string[]).includes(p.kind)) e.push(`${id}: kind must be ellipse, box, limb or pixels`);
  return e;
}

function jointErrors(js: Joint[], where: string): string[] {
  return js.flatMap((j) => {
    if (!isObj(j) || typeof j.id !== "string") return [`${where}: every joint needs a string id`];
    const bad = eachPerView<unknown>(j.rest, (r) => (isPt(r) ? null : `${where} joint ${j.id}: rest must be [x, y] (or per-view [x, y])`));
    return j.rest === undefined ? [`${where} joint ${j.id}: rest is required`] : bad;
  });
}

/** Everything wrong with an authored result; empty means it is safe to render. Includes a test render. */
export function checkRig(res: AuthorResult, baseRig: RigDef | undefined, kit: StyleKit, clipsOfFamily: string[]): string[] {
  const errs: string[] = [];
  const legendChars = new Set(buildLegend(kit).byChar.keys());
  const rig = res.mode === "new" ? res.rig : baseRig;
  if (res.mode === "new") {
    if (!res.rig) return ["mode is 'new' but `rig` is null; provide the rig"];
    const r = res.rig;
    if (typeof r.id !== "string" || !/^[a-z0-9][a-z0-9-_]*$/i.test(r.id)) errs.push("rig.id must look like 'river-crab'");
    if (typeof r.grid !== "number" || r.grid < 8 || r.grid > 128) errs.push("rig.grid must be 8..128 (use 32)");
    if (!Array.isArray(r.joints) || !r.joints.length || r.joints.length > MAX_JOINTS) return [...errs, `rig.joints must hold 1..${MAX_JOINTS} joints`];
    if (!Array.isArray(r.parts) || !r.parts.length || r.parts.length > MAX_PARTS) return [...errs, `rig.parts must hold 1..${MAX_PARTS} parts`];
    errs.push(...jointErrors(r.joints, "rig"));
    r.parts.forEach((p) => errs.push(...partErrors(p, "rig", legendChars)));
    for (const [k, m] of Object.entries(r.slots ?? {})) if (!(MATERIALS as readonly string[]).includes(m)) errs.push(`rig.slots.${k}: '${m}' is not a material (${MATERIALS.join(", ")})`);
    if (!Object.keys(r.slots ?? {}).length) errs.push("rig.slots must name at least one slot, e.g. body -> a material");
    if (res.family !== "custom") {
      const have = new Set(r.joints.map((j) => j.id));
      const missing = CONTRACTS[res.family].filter((j) => !have.has(j));
      if (missing.length) errs.push(`family '${res.family}' needs joints ${missing.join(", ")} (see the joint contract), or use family 'custom'`);
    }
  } else if (!baseRig) errs.push("mode is 'extend' but baseRig is not a known registry rig id");
  for (const id of res.builtinAttachments) if (!attachmentById(id)) errs.push(`builtinAttachments: '${id}' is not a built-in attachment id`);
  for (const a of res.attachments) {
    if (typeof a.id !== "string" || !/^[a-z0-9][a-z0-9-_]*$/i.test(a.id)) errs.push("attachment ids must look like 'alms-bowl'");
    if (!Array.isArray(a.parts) || !a.parts.length) { errs.push(`attachment ${a.id}: needs parts`); continue; }
    errs.push(...jointErrors(a.joints ?? [], `attachment ${a.id}`));
    a.parts.forEach((p) => errs.push(...partErrors(p, `attachment ${a.id}`, legendChars)));
  }
  if (errs.length || !rig) return errs;
  errs.push(...validateRig(rig, [...res.builtinAttachments.flatMap((id) => attachmentById(id)?.attachment ?? []), ...res.attachments]));
  const allSlots = { ...rig.slots, ...res.slots };
  for (const [k, m] of Object.entries(res.slots)) if (!(MATERIALS as readonly string[]).includes(m)) errs.push(`slots.${k}: '${m}' is not a material`);
  const known = new Set([...Object.keys(allSlots), ...(MATERIALS as readonly string[])]);
  for (const p of [...rig.parts, ...res.attachments.flatMap((a) => a.parts)])
    if (p.slot && !known.has(p.slot)) errs.push(`part ${p.id}: unknown slot '${p.slot}' (use ${Object.keys(allSlots).join(", ")} or a material name)`);
  // clips: poses may only move joints that exist; a new non-family rig must bring idle + walk
  const joints = new Set([...rig.joints, ...res.attachments.flatMap((a) => a.joints ?? [])].map((j) => j.id));
  for (const c of res.clips) {
    if (!c.id || !/^[a-z0-9][a-z0-9-_]*$/i.test(c.id)) errs.push("clip ids must look like 'idle' or 'walk'");
    const poses = Array.isArray(c.frames) ? c.frames : Object.values(c.frames).flat();
    if (!poses.length) errs.push(`clip ${c.id}: has no frames`);
    for (const pose of poses) for (const j of Object.keys(pose)) if (!joints.has(j)) errs.push(`clip ${c.id}: pose moves unknown joint '${j}'`);
  }
  if (res.mode === "new") {
    const have = new Set([...res.clips.map((c) => c.id), ...clipsOfFamily]);
    for (const need of ["idle", "walk"]) if (!have.has(need)) errs.push(`new rig needs an '${need}' clip of its own (clips: [{id:'${need}', fps, all|down/side/up: [pose,...]}])`);
  }
  if (errs.length) return errs;
  // test render in every view: catches anything validateRig cannot (bad rows, NaN geometry)
  const render = { ...res, rig };
  for (const dir of ["down", "right", "up"] as const) {
    try {
      renderRigFrame({ rig, kit, slots: allSlots as any, attachments: render.attachments }, dir);
    } catch (e) {
      errs.push(`render failed in view ${dir}: ${(e as Error).message}`);
      break;
    }
  }
  return errs;
}

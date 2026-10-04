// Rig registry: everything addressable by id from generators, the UI and agent tools.
// Lanes fill their own files; this file only aggregates.
import type { Attachment, Clip, RigDef } from "../rig";
import { HUMANOID_ATTACHMENTS } from "./attachments";
import { BIRD_CLIPS, BIRD_RIGS } from "./bird";
import { HUMANOID_CLIPS } from "./clips";
import { FISH_CLIPS, FISH_RIGS } from "./fish";
import { EXAMPLE_RIG, IDLE, NGOB_HAT, WALK } from "./example";
import { AGES, FACE, femaleFace, HAIR_STYLES, hairAttachment, HUMANOID_RIGS, HUMAN_RIGS, NO_FACE } from "./humanoid";
import { WARDROBE_NEW_ATTACHMENTS } from "./wardrobe";
import { PATTERN_ATTACHMENTS, patternAttachment } from "./shapes-pattern";
import { QUADRUPED_CLIPS, QUADRUPED_RIGS } from "./quadruped";
import { TOOL_ATTACHMENTS } from "./tools";
import { HUMANOID_SIDE_RIG, SIDE_CLIPS } from "./side";
import { BEAST_CLIPS, BEAST_RIGS, MONSTER_CLIPS, MONSTER_RIGS, UNDEAD_CLIPS, UNDEAD_RIGS } from "./monsters";

/** Which clips/attachments fit which rig: rigs share a `family` via their joint contract. */
export type RigFamily = "humanoid" | "quadruped" | "bird" | "fish" | "monster" | "beast" | "undead";

export const RIGS: { rig: RigDef; family: RigFamily }[] = [
  { rig: EXAMPLE_RIG, family: "humanoid" },
  ...HUMANOID_RIGS.map((rig) => ({ rig, family: "humanoid" as const })),
  ...HUMAN_RIGS.map((rig) => ({ rig, family: "humanoid" as const })),
  ...QUADRUPED_RIGS.map((rig) => ({ rig, family: "quadruped" as const })),
  ...BIRD_RIGS.map((rig) => ({ rig, family: "bird" as const })),
  ...FISH_RIGS.map((rig) => ({ rig, family: "fish" as const })),
  { rig: HUMANOID_SIDE_RIG, family: "humanoid" as const },
  ...MONSTER_RIGS.map((rig) => ({ rig, family: "monster" as const })),
  ...BEAST_RIGS.map((rig) => ({ rig, family: "beast" as const })),
  ...UNDEAD_RIGS.map((rig) => ({ rig, family: "undead" as const })),
];

export const CLIPS: { clip: Clip; family: RigFamily }[] = [
  ...(HUMANOID_CLIPS.length ? HUMANOID_CLIPS : [WALK, IDLE]).map((clip) => ({ clip, family: "humanoid" as const })),
  ...QUADRUPED_CLIPS.map((clip) => ({ clip, family: "quadruped" as const })),
  ...BIRD_CLIPS.map((clip) => ({ clip, family: "bird" as const })),
  ...FISH_CLIPS.map((clip) => ({ clip, family: "fish" as const })),
  ...SIDE_CLIPS.map((clip) => ({ clip, family: "humanoid" as const })),
  ...MONSTER_CLIPS.map((clip) => ({ clip, family: "monster" as const })),
  ...BEAST_CLIPS.map((clip) => ({ clip, family: "beast" as const })),
  ...UNDEAD_CLIPS.map((clip) => ({ clip, family: "undead" as const })),
];

export const ATTACHMENTS: { attachment: Attachment; family: RigFamily }[] = [
  ...(HUMANOID_ATTACHMENTS.length ? HUMANOID_ATTACHMENTS : [NGOB_HAT]).map((attachment) => ({ attachment, family: "humanoid" as const })),
  ...TOOL_ATTACHMENTS.map((attachment) => ({ attachment, family: "humanoid" as const })),
  ...[...HAIR_STYLES.map((s) => hairAttachment(s)), FACE, femaleFace("young-adult"), NO_FACE, ...PATTERN_ATTACHMENTS, ...PATTERN_ATTACHMENTS.map((a) => patternAttachment(a.id.slice("pattern-".length) as "plaid", "accent"))].map((attachment) => ({ attachment, family: "humanoid" as const })),
  ...WARDROBE_NEW_ATTACHMENTS.map((attachment) => ({ attachment, family: "humanoid" as const })),
];

export const rigById = (id: string) => RIGS.find((r) => r.rig.id === id);
export const clipById = (id: string, family?: RigFamily) => CLIPS.find((c) => c.clip.id === id && (!family || c.family === family));
export const attachmentById = (id: string) => ATTACHMENTS.find((a) => a.attachment.id === id);

/**
 * Built-in humanoid rigs are bare skeletons; hair and a face come as attachments. When a recipe
 * picks neither, give it short hair and a face so rigged characters are never faceless.
 * `hair-bald` / `no-face` opt out. Rigs that draw their own hair or eyes are left alone.
 */
export function withHumanoidDefaults(rig: RigDef, attachments: Attachment[]): Attachment[] {
  if (rigById(rig.id)?.family !== "humanoid" || rig.parts.some((p) => p.slot === "hair" || /eye/i.test(p.id))) return attachments;
  const ids = attachments.map((a) => a.id);
  const hair = ids.some((id) => id.startsWith("hair-")) ? [] : [hairAttachment("short")];
  const female = /-female-|^human-female-/.test(rig.id);
  const age = AGES.find((a) => rig.id.endsWith(`-${a}`)) ?? "young-adult";
  const face = ids.includes("face") || ids.includes("face-female") || ids.includes("no-face") ? [] : [female ? femaleFace(age) : FACE];
  return [...hair, ...attachments, ...face];
}

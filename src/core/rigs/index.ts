// Rig registry: everything addressable by id from generators, the UI and agent tools.
// Lanes fill their own files; this file only aggregates.
import type { Attachment, Clip, RigDef } from "../rig";
import { HUMANOID_ATTACHMENTS } from "./attachments";
import { BIRD_CLIPS, BIRD_RIGS } from "./bird";
import { HUMANOID_CLIPS } from "./clips";
import { EXAMPLE_RIG, IDLE, NGOB_HAT, WALK } from "./example";
import { FACE, HAIR_STYLES, hairAttachment, HUMANOID_RIGS, HUMAN_RIGS, NO_FACE } from "./humanoid";
import { WARDROBE_NEW_ATTACHMENTS } from "./wardrobe";
import { QUADRUPED_CLIPS, QUADRUPED_RIGS } from "./quadruped";

/** Which clips/attachments fit which rig: rigs share a `family` via their joint contract. */
export type RigFamily = "humanoid" | "quadruped" | "bird";

export const RIGS: { rig: RigDef; family: RigFamily }[] = [
  { rig: EXAMPLE_RIG, family: "humanoid" },
  ...HUMANOID_RIGS.map((rig) => ({ rig, family: "humanoid" as const })),
  ...HUMAN_RIGS.map((rig) => ({ rig, family: "humanoid" as const })),
  ...QUADRUPED_RIGS.map((rig) => ({ rig, family: "quadruped" as const })),
  ...BIRD_RIGS.map((rig) => ({ rig, family: "bird" as const })),
];

export const CLIPS: { clip: Clip; family: RigFamily }[] = [
  ...(HUMANOID_CLIPS.length ? HUMANOID_CLIPS : [WALK, IDLE]).map((clip) => ({ clip, family: "humanoid" as const })),
  ...QUADRUPED_CLIPS.map((clip) => ({ clip, family: "quadruped" as const })),
  ...BIRD_CLIPS.map((clip) => ({ clip, family: "bird" as const })),
];

export const ATTACHMENTS: { attachment: Attachment; family: RigFamily }[] = [
  ...(HUMANOID_ATTACHMENTS.length ? HUMANOID_ATTACHMENTS : [NGOB_HAT]).map((attachment) => ({ attachment, family: "humanoid" as const })),
  ...[...HAIR_STYLES.map((s) => hairAttachment(s)), FACE, NO_FACE].map((attachment) => ({ attachment, family: "humanoid" as const })),
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
  const face = ids.includes("face") || ids.includes("no-face") ? [] : [FACE];
  return [...hair, ...attachments, ...face];
}

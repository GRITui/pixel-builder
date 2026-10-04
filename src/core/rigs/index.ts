// Rig registry: everything addressable by id from generators, the UI and agent tools.
// Lanes fill their own files; this file only aggregates.
import type { Attachment, Clip, RigDef } from "../rig";
import { HUMANOID_ATTACHMENTS } from "./attachments";
import { BIRD_CLIPS, BIRD_RIGS } from "./bird";
import { HUMANOID_CLIPS } from "./clips";
import { EXAMPLE_RIG, IDLE, NGOB_HAT, WALK } from "./example";
import { HUMANOID_RIGS } from "./humanoid";
import { QUADRUPED_CLIPS, QUADRUPED_RIGS } from "./quadruped";

/** Which clips/attachments fit which rig: rigs share a `family` via their joint contract. */
export type RigFamily = "humanoid" | "quadruped" | "bird";

export const RIGS: { rig: RigDef; family: RigFamily }[] = [
  { rig: EXAMPLE_RIG, family: "humanoid" },
  ...HUMANOID_RIGS.map((rig) => ({ rig, family: "humanoid" as const })),
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
];

export const rigById = (id: string) => RIGS.find((r) => r.rig.id === id);
export const clipById = (id: string, family?: RigFamily) => CLIPS.find((c) => c.clip.id === id && (!family || c.family === family));
export const attachmentById = (id: string) => ATTACHMENTS.find((a) => a.attachment.id === id);

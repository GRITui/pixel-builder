import { renderRig, type Attachment, type Clip, type RigDef, type RigRecipe } from "../../core/rig";
import { attachmentById, clipById, rigById, RIGS, withHumanoidDefaults } from "../../core/rigs";
import type { FrameSet, StyleKit } from "../../core/types";

export interface ResolvedRecipe {
  rig: RigDef;
  attachments: Attachment[];
  clips: Clip[];
}

/** Resolve registry ids in a recipe; throws a readable error for unknown ids. */
export function resolveRecipe(r: RigRecipe, customClips: Clip[] = []): ResolvedRecipe {
  const rig = typeof r.rig === "string" ? (rigById(r.rig)?.rig ?? RIGS[0]?.rig) : r.rig;
  if (!rig) throw new Error(`Unknown rig "${String(r.rig)}"`);
  const attachments = (r.attachments ?? []).flatMap((a) => {
    const hit = typeof a === "string" ? attachmentById(a)?.attachment : a;
    return hit ? [hit] : [];
  });
  const clips = r.clips.flatMap((c) => {
    const hit = typeof c === "string" ? (clipById(c)?.clip ?? customClips.find((x) => x.id === c)) : c;
    return hit ? [hit] : [];
  });
  return { rig, attachments: withHumanoidDefaults(rig, attachments), clips };
}

export function renderRecipe(r: RigRecipe, kit: StyleKit, customClips: Clip[] = []): { rows: FrameSet[]; fps: number } {
  const { rig, attachments, clips } = resolveRecipe(r, customClips);
  if (!clips.length) throw new Error("Rigged asset has no clips");
  return { rows: renderRig({ rig, kit, slots: r.slots, attachments }, clips), fps: clips[0].fps };
}

import { renderRig, type Directions, type Attachment, type Clip, type RigDef, type RigRecipe } from "../../core/rig";
import { fitRigToWorld } from "../../core/rigs/fit";
import { attachmentById, clipById, rigById, RIGS, withHumanoidDefaults } from "../../core/rigs";
import type { Material } from "../../core/palette";
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
    const hit = typeof c === "string" ? (clipById(c, rigById(rig.id)?.family)?.clip ?? clipById(c)?.clip ?? customClips.find((x) => x.id === c)) : c;
    return hit ? [hit] : [];
  });
  return { rig, attachments: withHumanoidDefaults(rig, attachments), clips };
}

/** Render a rig; built-in animals are fitted to world scale like the `animal` generator (issue #24). */
export function renderRigWorld(rig: RigDef, kit: StyleKit, slots: Record<string, Material> | undefined, attachments: Attachment[], clips: Clip[], directions: Directions = 4): FrameSet[] {
  const registered = rigById(rig.id)?.rig === rig;
  const fit = registered && !attachments.length ? fitRigToWorld(rig, kit, slots ?? {}, clips) : undefined;
  return fit ? renderRig({ rig: fit.rig, kit, slots, size: fit.size }, fit.clips, { directions }) : renderRig({ rig, kit, slots, attachments }, clips, { directions });
}

export function renderRecipe(r: RigRecipe, kit: StyleKit, customClips: Clip[] = []): { rows: FrameSet[]; fps: number } {
  const { rig, attachments, clips } = resolveRecipe(r, customClips);
  if (!clips.length) throw new Error("Rigged asset has no clips");
  return { rows: renderRigWorld(rig, kit, r.slots, attachments, clips, r.directions === 8 ? 8 : 4), fps: clips[0].fps };
}

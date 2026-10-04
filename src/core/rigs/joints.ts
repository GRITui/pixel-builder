/**
 * Humanoid joint-name contract (issue #3). Clips (#4), attachments (#5) and
 * tools (#8) target these names; the humanoid rig must define all of them.
 */
export const HUMANOID_JOINTS = [
  "hip", "chest", "neck", "head",
  "shoulderL", "elbowL", "handL",
  "shoulderR", "elbowR", "handR",
  "kneeL", "footL", "kneeR", "footR",
] as const;
export type HumanoidJoint = (typeof HUMANOID_JOINTS)[number];

/** Quadruped contract (#6). Front/back x left/right legs. */
export const QUADRUPED_JOINTS = [
  "body", "neck", "head", "jaw", "tail",
  "shoulderFL", "kneeFL", "footFL", "shoulderFR", "kneeFR", "footFR",
  "hipBL", "kneeBL", "footBL", "hipBR", "kneeBR", "footBR",
] as const;

/** Bird contract (#7). */
export const BIRD_JOINTS = ["body", "head", "beak", "tail", "wingL", "wingR", "legL", "footL", "legR", "footR"] as const;

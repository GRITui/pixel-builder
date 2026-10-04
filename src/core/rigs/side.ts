// Side-view (platformer) humanoid: the normal humanoid with every joint pinned to its profile
// rest pose, rendered only as `right` and `left` rows. Same HUMANOID_JOINTS, so every humanoid
// attachment (hair, face, tools, costumes) and the shared idle / walk / run clips fit it.
// The side-only clips below add what a platformer needs: jump, fall, climb, crouch.
import type { Clip, Pose, RigDef } from "../rig";
import { humanoidRig } from "./humanoid";

const base = humanoidRig("normal");

export const HUMANOID_SIDE_RIG: RigDef = {
  ...base,
  id: "humanoid-side",
  name: "Humanoid (side view)",
  joints: base.joints.map((j) => ({ ...j, rest: typeof j.rest === "object" && "side" in j.rest ? (j.rest as { side: [number, number] }).side : j.rest })),
};

const p = (o: Pose): Pose => o;

// Offsets accumulate down the hierarchy (hip > knee > foot, chest > shoulder > elbow > hand), so a
// body that drops by dy plants its feet with footL/footR = -dy.

/** Squat, push off, rise with arms up, tuck at the apex. */
const JUMP: Clip = {
  id: "jump",
  fps: 8,
  frames: {
    side: [
      p({ hip: [0, 3], chest: [1, 1], kneeL: [2, -3], kneeR: [3, -3], footL: [-2, 0], footR: [-2, 0], handL: [-2, 1], handR: [-3, 1] }),
      p({ hip: [0, -3], chest: [0, 0], footL: [-2, 3], footR: [-3, 2], handL: [2, -6], handR: [3, -5] }),
      p({ hip: [0, -4], chest: [0, 0], kneeL: [3, -1], kneeR: [4, -1], footL: [-2, -1], footR: [-3, -1], handL: [3, -5], handR: [4, -4] }),
    ],
  },
};

/** Falling: arms thrown up and out, legs dangling and flapping between two frames. */
const FALL: Clip = {
  id: "fall",
  fps: 6,
  frames: {
    side: [
      p({ hip: [0, -3], chest: [0, -1], footL: [-2, 1], footR: [2, 0], handL: [-3, -6], handR: [3, -7] }),
      p({ hip: [0, -3], chest: [0, -1], footL: [-1, 0], footR: [3, 1], handL: [-2, -5], handR: [4, -6] }),
    ],
  },
};

/** Ladder climb: hands and feet alternate rungs, hips sway up. */
const CLIMB: Clip = {
  id: "climb",
  fps: 6,
  frames: {
    side: [
      p({ hip: [1, 0], chest: [1, 0], handL: [3, -7], handR: [3, -2], kneeL: [2, -2], kneeR: [3, 0], footL: [1, -1], footR: [1, 0] }),
      p({ hip: [1, -1], chest: [1, 0], handL: [3, -5], handR: [3, -4], kneeL: [2, -1], kneeR: [3, -1], footL: [1, -1], footR: [1, -1] }),
      p({ hip: [1, 0], chest: [1, 0], handL: [3, -2], handR: [3, -7], kneeL: [3, 0], kneeR: [2, -2], footL: [1, 0], footR: [1, -1] }),
      p({ hip: [1, -1], chest: [1, 0], handL: [3, -4], handR: [3, -5], kneeL: [3, -1], kneeR: [2, -1], footL: [1, -1], footR: [1, -1] }),
    ],
  },
};

/** Deep crouch (thighs level, shins back to the planted feet) with a slow breath. */
const CROUCH: Clip = {
  id: "crouch",
  fps: 2,
  frames: {
    side: [
      p({ hip: [0, 4], chest: [1, 0], kneeL: [3, -4], kneeR: [4, -4], footL: [-3, 0], footR: [-3, 0], handL: [2, 1], handR: [2, 1] }),
      p({ hip: [0, 4], chest: [1, 1], kneeL: [3, -4], kneeR: [4, -4], footL: [-3, 0], footR: [-3, 0], handL: [2, 0], handR: [2, 0] }),
    ],
  },
};

export const SIDE_CLIPS: Clip[] = [JUMP, FALL, CLIMB, CROUCH];

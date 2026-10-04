// Side-view (platformer) humanoid: the normal humanoid with every joint pinned to its profile
// rest pose, rendered only as `right` and `left` rows. Same HUMANOID_JOINTS, so every humanoid
// attachment (hair, face, tools, costumes) and the shared idle / walk / run clips fit it.
// The side-only clips below add what a platformer needs: jump, fall, climb, crouch.
import type { Attachment, Clip, PartDef, Pose, RigDef } from "../rig";
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

// ---- snappy jump (issue #47): deep squat anticipation, stretch on take-off, tucked apex hold.
// `jump` itself is untouched; rich kits pick this up via `Clip.rich`.
const JUMP_SNAPPY: Clip = {
  id: "jump-snappy",
  fps: 10,
  frames: {
    side: [
      p({ hip: [0, 3], chest: [1, 1], kneeL: [2, -3], kneeR: [3, -3], footL: [-2, 0], footR: [-2, 0], handL: [-2, 1], handR: [-3, 1] }),
      // anticipation: the deepest squat, arms swung back
      p({ hip: [0, 4], chest: [2, 1], head: [-1, 0], kneeL: [3, -4], kneeR: [4, -4], footL: [-3, 0], footR: [-3, 0], handL: [-3, 1], handR: [-4, 1] }),
      // take-off stretch: body long and thin, arms thrown up (the smear of the launch)
      p({ hip: [0, -3], chest: [0, -1], head: [0, 1], footL: [-2, 4], footR: [-3, 3], handL: [2, -7], handR: [3, -6] }),
      p({ hip: [0, -3], chest: [0, 0], head: [0, 1], kneeL: [2, 0], kneeR: [3, 0], footL: [-2, 1], footR: [-3, 1], handL: [3, -6], handR: [4, -5] }),
      // apex tuck, held one frame
      p({ hip: [0, -4], chest: [0, 0], head: [0, 0], kneeL: [4, -2], kneeR: [5, -2], footL: [-2, -1], footR: [-3, -1], handL: [3, -4], handR: [4, -3] }),
      p({ hip: [0, -4], chest: [0, 1], head: [0, 0], kneeL: [4, -2], kneeR: [5, -2], footL: [-2, -1], footR: [-3, -1], handL: [3, -4], handR: [4, -3] }),
    ],
  },
};
JUMP.rich = JUMP_SNAPPY.frames;

export const SIDE_CLIPS: Clip[] = [JUMP, FALL, CLIMB, CROUCH, JUMP_SNAPPY];

// ---- knight trim (issue #47): the plain metal knight read as one grey blob; this adds accent cloth
// (tabard, cape) and gold trim so it has a second and third colour. Tints with the `accent` slot.
type Box = { id: string; dx: number; dy: number; w: number; h: number; slot: string; z: number; tone?: number; views: PartDef["views"] };
const trim = (b: Box): PartDef => ({ kind: "box", joint: "chest", ...b });

export const KNIGHT_TRIM: Attachment = {
  id: "knight-trim",
  name: "Knight trim (tabard, cape, gold hem)",
  parts: [
    // side: cape hangs behind the back, tabard over the front of the torso with a gold hem
    trim({ id: "kt-cape", dx: -5, dy: -1.5, w: 3, h: 11, slot: "accent", tone: -1, z: 0.5, views: ["side"] }),
    trim({ id: "kt-cape-edge", dx: -5, dy: 8.5, w: 3, h: 1, slot: "gold", z: 0.6, views: ["side"] }),
    trim({ id: "kt-tabard", dx: -1.5, dy: 0.6, w: 4.5, h: 8, slot: "accent", z: 2.7, views: ["side"] }),
    trim({ id: "kt-tabard-hem", dx: -1.5, dy: 7.6, w: 4.5, h: 1, slot: "gold", z: 2.8, views: ["side"] }),
    trim({ id: "kt-collar", dx: -2, dy: -2.6, w: 5, h: 1.2, slot: "gold", z: 2.8, views: ["side"] }),
    // front: tabard panel and collar
    trim({ id: "kt-tabard-f", dx: -2.2, dy: 0.6, w: 4.4, h: 8, slot: "accent", z: 2.7, views: ["down"] }),
    trim({ id: "kt-tabard-f-hem", dx: -2.2, dy: 7.6, w: 4.4, h: 1, slot: "gold", z: 2.8, views: ["down"] }),
    trim({ id: "kt-collar-f", dx: -3.5, dy: -2.6, w: 7, h: 1.2, slot: "gold", z: 2.8, views: ["down"] }),
    // back: the cape fills the back
    trim({ id: "kt-cape-b", dx: -4.5, dy: -1.5, w: 9, h: 11, slot: "accent", tone: -1, z: 2.7, views: ["up"] }),
    trim({ id: "kt-cape-b-edge", dx: -4.5, dy: 8.5, w: 9, h: 1, slot: "gold", z: 2.8, views: ["up"] }),
  ],
};

// Humanoid clip library (issue #4). Poses only reference HUMANOID_JOINTS, so
// every humanoid rig gets every clip. Offsets are grid units (design grid 32).
// Children inherit offsets: moving `hip` moves the legs too, so planted feet
// counter the bob with a negative dy. Side view swings on x, front/back lift on y.
import type { Clip, Pose } from "../rig";

const p = (o: Pose): Pose => o;

// ---- idle: breathing bob (chest rises, head follows) ----
const IDLE: Clip = {
  id: "idle",
  fps: 2,
  frames: [p({}), p({ chest: [0, 1], handL: [0, -1], handR: [0, -1] }), p({}), p({ chest: [0, 1], head: [0, 0] })],
};

// ---- walk: contact / pass / contact / pass, arms swing opposite legs ----
const WALK: Clip = {
  id: "walk",
  fps: 8,
  frames: {
    side: [
      p({ hip: [0, 1], footL: [3, -1], footR: [-3, -1], handL: [-2, 0], handR: [2, 0], toolTip: [-1, 0], pole: [0, 1] }),
      p({ footL: [1, -2], handL: [0, 0], handR: [0, 0] }),
      p({ hip: [0, 1], footL: [-3, -1], footR: [3, -1], handL: [2, 0], handR: [-2, 0], toolTip: [1, 0], pole: [0, 1] }),
      p({ footR: [1, -2], handL: [0, 0], handR: [0, 0] }),
    ],
    down: [
      p({ hip: [0, 1], footL: [0, -1], footR: [0, -1], handL: [0, 1], handR: [0, -1], pole: [0, 1] }),
      p({ footL: [0, -2] }),
      p({ hip: [0, 1], footL: [0, -1], footR: [0, -1], handL: [0, -1], handR: [0, 1], pole: [0, 1] }),
      p({ footR: [0, -2] }),
    ],
    up: [
      p({ hip: [0, 1], footL: [0, -1], footR: [0, -1], handL: [0, -1], handR: [0, 1], pole: [0, 1] }),
      p({ footL: [0, -2] }),
      p({ hip: [0, 1], footL: [0, -1], footR: [0, -1], handL: [0, 1], handR: [0, -1], pole: [0, 1] }),
      p({ footR: [0, -2] }),
    ],
  },
};

// ---- run: 6 frames, longer stride, forward lean, bigger bob with a flight phase ----
const RUN: Clip = {
  id: "run",
  fps: 12,
  frames: {
    side: [
      p({ hip: [0, 1], chest: [1, 0], footL: [4, -1], footR: [-3, -2], handL: [-3, 0], handR: [3, -1] }),
      p({ hip: [0, 2], chest: [1, 0], footL: [0, -2], footR: [2, -4], handL: [-1, -1], handR: [1, -1] }),
      p({ hip: [0, -1], chest: [1, 0], footL: [-3, -1], footR: [3, 0], handL: [2, -1], handR: [-2, -1] }),
      p({ hip: [0, 1], chest: [1, 0], footR: [4, -1], footL: [-3, -2], handR: [-3, 0], handL: [3, -1] }),
      p({ hip: [0, 2], chest: [1, 0], footR: [0, -2], footL: [2, -4], handR: [-1, -1], handL: [1, -1] }),
      p({ hip: [0, -1], chest: [1, 0], footR: [-3, -1], footL: [3, 0], handR: [2, -1], handL: [-2, -1] }),
    ],
    down: [
      p({ hip: [0, 1], chest: [0, 1], footL: [0, -1], footR: [0, -3], handL: [0, 2], handR: [0, -2] }),
      p({ hip: [0, 2], chest: [0, 1], footL: [0, -2], footR: [0, -3] }),
      p({ hip: [0, -1], chest: [0, 1], footL: [0, 0], footR: [0, 0], handL: [0, 0], handR: [0, 0] }),
      p({ hip: [0, 1], chest: [0, 1], footR: [0, -1], footL: [0, -3], handR: [0, 2], handL: [0, -2] }),
      p({ hip: [0, 2], chest: [0, 1], footR: [0, -2], footL: [0, -3] }),
      p({ hip: [0, -1], chest: [0, 1], footL: [0, 0], footR: [0, 0], handL: [0, 0], handR: [0, 0] }),
    ],
    up: [
      p({ hip: [0, 1], chest: [0, 1], footL: [0, -1], footR: [0, -3], handL: [0, -2], handR: [0, 2] }),
      p({ hip: [0, 2], chest: [0, 1], footL: [0, -2], footR: [0, -3] }),
      p({ hip: [0, -1], chest: [0, 1] }),
      p({ hip: [0, 1], chest: [0, 1], footR: [0, -1], footL: [0, -3], handR: [0, -2], handL: [0, 2] }),
      p({ hip: [0, 2], chest: [0, 1], footR: [0, -2], footL: [0, -3] }),
      p({ hip: [0, -1], chest: [0, 1] }),
    ],
  },
};

// ---- attack: wind-up / strike / follow-through / recover, for an item on handR ----
const ATTACK: Clip = {
  id: "attack",
  fps: 8,
  // `toolTip` swings the held item about the hand: wind-up behind/over the shoulder, strike forward-down
  frames: {
    side: [
      p({ chest: [-1, 0], elbowR: [-1, -2], handR: [-2, -3], handL: [-1, 0], toolTip: [-6, -3] }),
      p({ hip: [1, 0], footL: [-1, 0], footR: [-1, 0], chest: [2, 1], elbowR: [2, 0], handR: [3, 3], handL: [1, 0], toolTip: [9, 17] }),
      p({ hip: [1, 0], footL: [-1, 0], footR: [-1, 0], chest: [2, 1], elbowR: [2, 1], handR: [2, 2], toolTip: [8, 18] }),
      p({ chest: [0, 0], handR: [0, -1], toolTip: [1, -1] }),
    ],
    down: [
      p({ chest: [0, 0], elbowR: [1, -2], handR: [0, -3], toolTip: [2, -3] }),
      p({ hip: [0, 1], footL: [0, -1], footR: [0, -1], chest: [0, 1], elbowR: [-1, 1], handR: [-1, 3], toolTip: [-4, 12] }),
      p({ hip: [0, 1], footL: [0, -1], footR: [0, -1], chest: [0, 1], handR: [-1, 2], toolTip: [-4, 13] }),
      p({ handR: [0, -1], toolTip: [0, -1] }),
    ],
    up: [
      p({ elbowR: [1, -2], handR: [0, -3], toolTip: [2, -3] }),
      p({ hip: [0, 1], footL: [0, -1], footR: [0, -1], chest: [0, 1], elbowR: [-1, 1], handR: [-1, 2], toolTip: [-4, 12] }),
      p({ hip: [0, 1], footL: [0, -1], footR: [0, -1], chest: [0, 1], handR: [-1, 2], toolTip: [-4, 13] }),
      p({ handR: [0, -1], toolTip: [0, -1] }),
    ],
  },
};

// ---- farm: bent forward, hoe/sickle raised then swung down (Thai rice farming) ----
const FARM: Clip = {
  id: "farm",
  fps: 6,
  // hoe head: held low, lifted back over the shoulder, then driven into the ground in front
  frames: {
    side: [
      p({ hip: [-1, 1], footL: [1, -1], footR: [1, -1], chest: [2, 1], handL: [-1, -1], handR: [-1, -2], toolTip: [1, 0] }),
      p({ hip: [-1, 1], footL: [1, -1], footR: [1, -1], chest: [1, 0], elbowR: [-1, -2], handR: [-2, -3], handL: [-2, -3], toolTip: [-6, -3] }),
      p({ hip: [-1, 2], footL: [1, -2], footR: [1, -2], chest: [3, 2], elbowR: [2, 1], handR: [3, 3], handL: [3, 3], toolTip: [6, 14] }),
      p({ hip: [-1, 1], footL: [1, -1], footR: [1, -1], chest: [2, 1], handL: [1, 1], handR: [1, 1], toolTip: [3, 6] }),
    ],
    down: [
      p({ hip: [0, 1], footL: [0, -1], footR: [0, -1], chest: [0, 1], handR: [0, -1] }),
      p({ hip: [0, 1], footL: [0, -1], footR: [0, -1], chest: [0, 0], elbowR: [0, -2], handR: [0, -3], toolTip: [2, -3] }),
      p({ hip: [0, 2], footL: [0, -2], footR: [0, -2], chest: [0, 2], elbowR: [0, 1], handR: [0, 3], toolTip: [-3, 11] }),
      p({ hip: [0, 1], footL: [0, -1], footR: [0, -1], chest: [0, 1], handR: [0, 1], toolTip: [-1, 5] }),
    ],
    up: [
      p({ hip: [0, 1], footL: [0, -1], footR: [0, -1], chest: [0, 1], handR: [0, -1] }),
      p({ hip: [0, 1], footL: [0, -1], footR: [0, -1], chest: [0, 0], elbowR: [0, -2], handR: [0, -3], toolTip: [2, -3] }),
      p({ hip: [0, 2], footL: [0, -2], footR: [0, -2], chest: [0, 2], elbowR: [0, 1], handR: [0, 2], toolTip: [-3, 11] }),
      p({ hip: [0, 1], footL: [0, -1], footR: [0, -1], chest: [0, 1], handR: [0, 1], toolTip: [-1, 5] }),
    ],
  },
};

// ---- carry: walk with both hands raised in front (basket, bundle) ----
const CARRY: Clip = {
  id: "carry",
  fps: 6,
  frames: {
    side: [
      p({ hip: [0, 1], footL: [2, -1], footR: [-2, -1], handL: [2, -3], handR: [2, -3], pole: [0, 1] }),
      p({ footL: [1, -2], handL: [2, -3], handR: [2, -3] }),
      p({ hip: [0, 1], footL: [-2, -1], footR: [2, -1], handL: [2, -3], handR: [2, -3], pole: [0, 1] }),
      p({ footR: [1, -2], handL: [2, -3], handR: [2, -3] }),
    ],
    down: [
      p({ hip: [0, 1], footL: [0, -1], footR: [0, -1], elbowL: [1, -1], elbowR: [-1, -1], handL: [2, -3], handR: [-2, -3], pole: [0, 1] }),
      p({ footL: [0, -2], elbowL: [1, -1], elbowR: [-1, -1], handL: [2, -3], handR: [-2, -3] }),
      p({ hip: [0, 1], footL: [0, -1], footR: [0, -1], elbowL: [1, -1], elbowR: [-1, -1], handL: [2, -3], handR: [-2, -3], pole: [0, 1] }),
      p({ footR: [0, -2], elbowL: [1, -1], elbowR: [-1, -1], handL: [2, -3], handR: [-2, -3] }),
    ],
    up: [
      p({ hip: [0, 1], footL: [0, -1], footR: [0, -1], elbowL: [1, -1], elbowR: [-1, -1], handL: [2, -3], handR: [-2, -3], pole: [0, 1] }),
      p({ footL: [0, -2], elbowL: [1, -1], elbowR: [-1, -1], handL: [2, -3], handR: [-2, -3] }),
      p({ hip: [0, 1], footL: [0, -1], footR: [0, -1], elbowL: [1, -1], elbowR: [-1, -1], handL: [2, -3], handR: [-2, -3], pole: [0, 1] }),
      p({ footR: [0, -2], elbowL: [1, -1], elbowR: [-1, -1], handL: [2, -3], handR: [-2, -3] }),
    ],
  },
};

// ---- sit: hip drops, knees come up, feet stay on the ground; 2-frame breathing ----
// legs stay visible: side view thighs reach forward with raised knees; front view knees rise apart
const sitBase = (view: "side" | "front"): Pose =>
  view === "side"
    ? { hip: [0, 4], kneeL: [6, -4.5], kneeR: [5, -4.5], footL: [3, 0.5], footR: [3, 0.5], handL: [1, -1], handR: [1, -1] }
    : { hip: [0, 4], kneeL: [-4, -4.5], kneeR: [4, -4.5], footL: [0, 1], footR: [0, 1], handL: [0, -1], handR: [0, -1] };
const SIT: Clip = {
  id: "sit",
  fps: 1,
  frames: {
    side: [p(sitBase("side")), p({ ...sitBase("side"), chest: [0, 1] })],
    down: [p(sitBase("front")), p({ ...sitBase("front"), chest: [0, 1] })],
    up: [p(sitBase("front")), p({ ...sitBase("front"), chest: [0, 1] })],
  },
};

export const HUMANOID_CLIPS: Clip[] = [IDLE, WALK, RUN, ATTACK, FARM, CARRY, SIT];

// Minimal reference rig + clips + attachment. Contributors: copy this shape for
// new rigs (see docs/RIG.md). Real rigs live next to it (humanoid.ts, quadruped.ts...).
import type { Attachment, Clip, RigDef } from "../rig";

export const EXAMPLE_RIG: RigDef = {
  id: "example-biped",
  name: "Example biped",
  grid: 32,
  slots: { skin: "skin", hair: "hair", top: "cloth", bottom: "leather", feet: "wood" },
  joints: [
    { id: "hip", parent: null, rest: [16, 22] },
    { id: "chest", parent: "hip", rest: [16, 17] },
    { id: "head", parent: "chest", rest: { down: [16, 10], side: [17, 10], up: [16, 10] } },
    { id: "handL", parent: "chest", rest: { down: [10, 23], side: [16, 23], up: [10, 23] } },
    { id: "handR", parent: "chest", rest: { down: [22, 23], side: [16, 23], up: [22, 23] } },
    { id: "kneeL", parent: "hip", rest: { down: [13, 26], side: [15, 26], up: [13, 26] } },
    { id: "kneeR", parent: "hip", rest: { down: [19, 26], side: [17, 26], up: [19, 26] } },
    { id: "footL", parent: "kneeL", rest: { down: [13, 29], side: [15, 29], up: [13, 29] } },
    { id: "footR", parent: "kneeR", rest: { down: [19, 29], side: [17, 29], up: [19, 29] } },
  ],
  parts: [
    { id: "legL", kind: "limb", from: "hip", to: "footL", r: 1.8, slot: "bottom", z: 1 },
    { id: "legR", kind: "limb", from: "hip", to: "footR", r: 1.8, slot: "bottom", z: { down: 1, side: 0, up: 1 }, tone: 0 },
    { id: "torso", kind: "ellipse", joint: "chest", dy: 2, rx: 5, ry: 5.5, slot: "top", z: 2 },
    { id: "armL", kind: "limb", from: "chest", to: "handL", r: 1.4, slot: "top", z: { down: 3, side: 3, up: 3 } },
    { id: "armR", kind: "limb", from: "chest", to: "handR", r: 1.4, slot: "top", z: { down: 3, side: 1, up: 3 } },
    { id: "head", kind: "ellipse", joint: "head", rx: 7, ry: 6.5, slot: "skin", z: 4 },
    { id: "hair", kind: "ellipse", joint: "head", dy: -2, rx: 7.3, ry: 5, slot: "hair", z: 5, views: ["down", "side"] },
    { id: "hairBack", kind: "ellipse", joint: "head", rx: 7.3, ry: 6.7, slot: "hair", z: 5, views: ["up"] },
    { id: "face", kind: "ellipse", joint: "head", dy: 1.5, rx: 5.5, ry: 4.2, slot: "skin", z: 6, views: ["down"] },
    { id: "eyes", kind: "pixels", joint: "head", anchor: [3, -1], z: 7, rows: { down: ["a....a", "a....a"], side: ["......a", "......a"] }, views: ["down", "side"] },
  ],
};

/** 4-frame walk: legs swing on x in side view, lift on y from the front, body bobs. */
export const WALK: Clip = {
  id: "walk",
  fps: 6,
  frames: {
    down: [{}, { hip: [0, 1], footL: [0, -1], handL: [0, 1], handR: [0, -1] }, {}, { hip: [0, 1], footR: [0, -1], handL: [0, -1], handR: [0, 1] }],
    side: [{}, { hip: [0, 1], footL: [3, -1], footR: [-3, 0], handL: [-2, 0], handR: [2, 0] }, {}, { hip: [0, 1], footL: [-3, 0], footR: [3, -1], handL: [2, 0], handR: [-2, 0] }],
    up: [{}, { hip: [0, 1], footL: [0, -1] }, {}, { hip: [0, 1], footR: [0, -1] }],
  },
};

export const IDLE: Clip = { id: "idle", fps: 2, frames: [{}, { chest: [0, 1] }] };

/** A conical straw hat ("ngob") that follows the head in every frame and direction. */
export const NGOB_HAT: Attachment = {
  id: "ngob-hat",
  name: "Conical straw hat",
  parts: [
    { id: "hat-brim", kind: "ellipse", joint: "head", dy: -3, rx: 11, ry: 2.4, slot: "leather", flat: 0.5, z: 8 },
    { id: "hat-cone", kind: "ellipse", joint: "head", dy: -6, rx: 6, ry: 4, slot: "leather", z: 9 },
  ],
};

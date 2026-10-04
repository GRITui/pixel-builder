// Hand-written stand-ins for model output: 8 prompts -> valid dense clip JSON
// (every joint present as {dx,dy}, exactly the structured-output shape).
// Used by tests, the preview check and scripts/clip-author-demo.ts docs.
import type { RigFamily } from "../src/core/rigs";
import { FAMILY_JOINTS } from "./clip";

type Sparse = Record<string, [number, number]>;

/** Expand sparse poses to the dense {joint:{dx,dy}} form the schema asks for. */
export function dense(family: RigFamily, poses: Sparse[]) {
  return poses.map((p) => Object.fromEntries(FAMILY_JOINTS[family].map((j) => [j, { dx: p[j]?.[0] ?? 0, dy: p[j]?.[1] ?? 0 }])));
}
/** Front/back views swing on y only: drop x from limbs. */
const flat = (poses: Sparse[]): Sparse[] => poses.map((p) => Object.fromEntries(Object.entries(p).map(([j, [x, y]]) => [j, [/^(foot|knee)/.test(j) ? 0 : x * 0.5, y] as [number, number]])));

function make(family: RigFamily, id: string, fps: number, side: Sparse[], down: Sparse[] = flat(side), up: Sparse[] = down) {
  return { id, fps, frames: { down: dense(family, down), side: dense(family, side), up: dense(family, up) }, notes: `fixture: ${id}` };
}
const feet = (y: number, x = 0): Sparse => ({ footL: [x, y], footR: [-x, y] });

export interface Fixture {
  prompt: string;
  family: RigFamily;
  output: ReturnType<typeof make>;
}

export const FIXTURES: Fixture[] = [
  {
    prompt: "pick up a basket from the ground, then walk away with it",
    family: "humanoid",
    output: make("humanoid", "pickup-basket-walk", 6, [
      {},
      { hip: [0, 1], chest: [1, 1], handL: [1, 2], handR: [1, 2], ...feet(-1) },
      { hip: [0, 2], chest: [2, 2], handL: [2, 3], handR: [2, 3], ...feet(-2) },
      { hip: [0, 1], chest: [1, 1], handL: [2, -1], handR: [2, -1], ...feet(-1) },
      { hip: [0, 1], handL: [2, -3], handR: [2, -3], footL: [3, -1], footR: [-3, -1] },
      { handL: [2, -3], handR: [2, -3], footL: [1, -2] },
    ]),
  },
  {
    prompt: "bow politely with palms together (wai)",
    family: "humanoid",
    output: make("humanoid", "wai-bow", 4, [
      {},
      { elbowL: [1, -1], elbowR: [1, -1], handL: [2, -2], handR: [2, -2] },
      { hip: [0, 1], chest: [1, 2], head: [1, 1], elbowL: [1, -1], elbowR: [1, -1], handL: [2, -2], handR: [2, -2], ...feet(-1) },
      { hip: [0, 1], chest: [1, 2], head: [1, 1], elbowL: [1, -1], elbowR: [1, -1], handL: [2, -2], handR: [2, -2], ...feet(-1) },
      { chest: [0, 1], elbowL: [1, -1], elbowR: [1, -1], handL: [1, -2], handR: [1, -2] },
    ]),
  },
  {
    prompt: "wave hello with the right hand",
    family: "humanoid",
    output: make("humanoid", "wave", 6, [
      { elbowR: [1, -2], handR: [1, -3] },
      { elbowR: [1, -2], handR: [2, -3], head: [0, 0] },
      { elbowR: [1, -2], handR: [0, -3] },
      { elbowR: [1, -2], handR: [2, -3] },
    ]),
  },
  {
    prompt: "jump in the air with arms up and land",
    family: "humanoid",
    output: make("humanoid", "jump", 8, [
      { hip: [0, 2], chest: [0, 1], ...feet(-2), handL: [0, 1], handR: [0, 1] },
      { hip: [0, -2], handL: [0, -3], handR: [0, -3], ...feet(-1) },
      { hip: [0, -4], handL: [0, -4], handR: [0, -4], footL: [1, -1], footR: [-1, 0] },
      { hip: [0, -1], handL: [0, -2], handR: [0, -2], ...feet(0) },
      { hip: [0, 2], chest: [0, 1], ...feet(-2) },
    ]),
  },
  {
    prompt: "sit down on a stool",
    family: "humanoid",
    output: make("humanoid", "sit-down", 4, [
      {},
      { hip: [-1, 1], chest: [1, 0], ...feet(-1) },
      { hip: [-1, 2], kneeL: [2, -1], kneeR: [2, -1], footL: [0, -1], footR: [0, -1], chest: [1, 0] },
      { hip: [-1, 3], kneeL: [3, -2], kneeR: [3, -2], footL: [0, -1], footR: [0, -1], handL: [1, 1], handR: [1, 1] },
    ]),
  },
  {
    prompt: "dig the ground with a shovel",
    family: "humanoid",
    output: make("humanoid", "dig", 5, [
      { hip: [-1, 1], chest: [1, 1], handL: [0, 1], handR: [0, 1], ...feet(-1) },
      { hip: [-1, 0], chest: [0, -1], elbowR: [-1, -2], handR: [-1, -3], handL: [-1, -3], ...feet(0) },
      { hip: [-1, 2], chest: [3, 2], elbowR: [2, 1], handR: [2, 3], handL: [2, 3], ...feet(-2) },
      { hip: [-1, 2], chest: [3, 2], handR: [2, 3], handL: [2, 3], ...feet(-2) },
      { hip: [-1, 1], chest: [2, 1], handR: [1, 1], handL: [1, 1], ...feet(-1) },
    ]),
  },
  {
    prompt: "crouch down and pet an animal",
    family: "humanoid",
    output: make("humanoid", "pet-animal", 4, [
      { hip: [0, 2], chest: [2, 1], head: [1, 0], handR: [2, 2], elbowR: [1, 1], ...feet(-2) },
      { hip: [0, 2], chest: [2, 1], head: [1, 0], handR: [3, 3], elbowR: [1, 1], ...feet(-2) },
      { hip: [0, 2], chest: [2, 1], head: [1, 0], handR: [2, 2], elbowR: [1, 1], ...feet(-2) },
      { hip: [0, 2], chest: [2, 1], head: [1, 0], handR: [1, 3], elbowR: [1, 1], ...feet(-2) },
    ]),
  },
  {
    prompt: "the cow grazes, lowering its head to the grass and chewing",
    family: "quadruped",
    output: make("quadruped", "graze", 4, [
      { neck: [0, 0], head: [0, 0] },
      { neck: [1, 2], head: [1, 2], tail: [0, 1] },
      { neck: [1, 3], head: [1, 3], jaw: [0, 1] },
      { neck: [1, 3], head: [1, 3], jaw: [0, 0], tail: [0, -1] },
    ]),
  },
  {
    prompt: "the goat rears back and headbutts forward",
    family: "quadruped",
    output: make("quadruped", "headbutt", 6, [
      {},
      { body: [-1, 0], neck: [-1, -1], head: [-1, -1] },
      { body: [-1, 0], neck: [-1, -1], head: [-1, -1], footBL: [0, 0] },
      { body: [1, 0], neck: [2, 1], head: [2, 0], tail: [-1, 0] },
      { body: [1, 0], neck: [1, 0], head: [1, 0] },
    ]),
  },
];

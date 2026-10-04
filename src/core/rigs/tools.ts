// Farming tools held in the hand (Farming Kit v1, #31). Same pattern as `hoe` in attachments.ts:
// the shaft is a limb toolButt -> toolTip, so the chop/water/mine clips swing the tool by posing
// `toolTip`. Tips are absolute rests tuned on the normal build (handR x 22.5 in front/back, 16 in
// profile). In the up view the tool sits behind the body. Only one tool is held at a time, so the
// shared joint name `toolTip` is what clips target.
import type { Attachment, Joint, PartDef, View } from "../rig";
import type { Material } from "../palette";

const HELD = 4;
const HAND_X = { down: 22.5, side: 16, up: 22.5 } as const;
const HAND_Y = 24.5;
type D = [number, number];
type PV = Partial<Record<View, D>> & { down: D };
const at = (dx: PV): Joint["rest"] => {
  const out = {} as Record<View, [number, number]>;
  for (const v of ["down", "side", "up"] as View[]) {
    const d = dx[v] ?? dx.down;
    out[v] = [HAND_X[v] + d[0], HAND_Y + d[1]];
  }
  return out;
};
const TZ: PartDef["z"] = { down: HELD, side: HELD, up: 1.6 };
const TZ2: PartDef["z"] = { down: HELD + 0.1, side: HELD + 0.1, up: 1.7 };

type Box = { id: string; dx: number; dy: number; w: number; h: number; slot: Material; tone?: number };
const tipBox = (b: Box): PartDef => ({ kind: "box", joint: "toolTip", z: TZ2, ...b });
const tipEll = (id: string, dx: number, dy: number, rx: number, ry: number, slot: Material, tone?: number): PartDef => ({
  kind: "ellipse", id, joint: "toolTip", dx, dy, rx, ry, slot, tone, z: TZ2,
});
const shaft = (id: string, from: string, to: string, r: number, slot: Material, tone?: number): PartDef => ({ kind: "limb", id, from, to, r, slot, tone, z: TZ });
const joints = (tip: PV, butt: PV): Joint[] => [
  { id: "toolTip", parent: "handR", rest: at(tip) },
  { id: "toolButt", parent: "handR", rest: at(butt) },
];

export const TOOL_ATTACHMENTS: Attachment[] = [
  {
    id: "axe",
    name: "Axe",
    joints: joints({ down: [1.5, -13], side: [3, -13] }, { down: [-0.5, 3], side: [-1, 3] }),
    parts: [
      shaft("axe-handle", "toolButt", "toolTip", 0.8, "wood"),
      tipBox({ id: "axe-head", dx: -0.5, dy: -1.5, w: 5, h: 5, slot: "metal" }),
      tipBox({ id: "axe-edge", dx: 4, dy: -2.5, w: 1.5, h: 7, slot: "metal", tone: 1 }),
      tipBox({ id: "axe-eye", dx: -1.5, dy: -1, w: 1.5, h: 3, slot: "metal", tone: -1 }),
    ],
  },
  {
    id: "pickaxe",
    name: "Pickaxe",
    joints: joints({ down: [1.5, -13], side: [3, -13] }, { down: [-0.5, 3], side: [-1, 3] }),
    parts: [
      shaft("pickaxe-handle", "toolButt", "toolTip", 0.8, "wood"),
      tipBox({ id: "pickaxe-head", dx: -5, dy: -1.5, w: 10, h: 2.5, slot: "metal" }),
      tipBox({ id: "pickaxe-tipL", dx: -6.5, dy: -0.5, w: 2, h: 2.5, slot: "metal", tone: -1 }),
      tipBox({ id: "pickaxe-tipR", dx: 4.5, dy: -0.5, w: 2, h: 2.5, slot: "metal", tone: -1 }),
    ],
  },
  {
    id: "hammer",
    name: "Hammer",
    joints: joints({ down: [1.5, -12], side: [3, -12] }, { down: [-0.5, 3], side: [-1, 3] }),
    parts: [
      shaft("hammer-handle", "toolButt", "toolTip", 0.8, "wood"),
      tipBox({ id: "hammer-head", dx: -3, dy: -2.5, w: 6.5, h: 4.5, slot: "metal" }),
      tipBox({ id: "hammer-face", dx: 2.5, dy: -2.5, w: 1.5, h: 4.5, slot: "metal", tone: 1 }),
    ],
  },
  {
    id: "watering-can",
    name: "Watering can",
    // `toolButt` is the spout root on the can; `toolTip` is the rose, so `water` clips tilt it by posing the tip
    joints: joints({ down: [5.5, -5], side: [7, -5] }, { down: [2, -1], side: [3, -1] }),
    parts: [
      { kind: "ellipse", id: "can-body", joint: "handR", dx: 0, dy: -1, rx: 4, ry: 3.6, slot: "water", z: TZ },
      { kind: "box", id: "can-rim", joint: "handR", dx: -3, dy: -4, w: 6, h: 1.5, slot: "metal", z: TZ2 },
      { kind: "ellipse", id: "can-handle", joint: "handR", dx: -3.6, dy: -3, rx: 1.4, ry: 2.4, slot: "metal", tone: -1, z: { down: HELD - 0.1, side: HELD - 0.1, up: 1.5 } },
      shaft("can-spout", "toolButt", "toolTip", 0.9, "metal"),
      tipEll("can-rose", 0.5, -0.5, 1.8, 1.5, "metal", 1),
    ],
  },
];

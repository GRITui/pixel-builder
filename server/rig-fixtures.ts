// Hand-written model answers (wire format) used by tests and the demo script:
// "a river crab" (new rig) and "a monk" (extends the humanoid). They prove the
// whole path from /api/rig output to a rendered sheet without a network.
const n = null;
const part = (o: Record<string, unknown>) => ({ from: n, to: n, joint: n, r: n, rx: n, ry: n, w: n, h: n, dx: n, dy: n, flat: n, normal: n, rows: n, anchor: n, slot: n, tone: n, views: n, noDiag: n, ...o });
const J = (id: string, parent: string | null, x: number, y: number) => ({ id, parent, rest: [x, y] });

const legs = [0, 1, 2].flatMap((i) => [J(`footL${i}`, "body", 8 - i * 0.5, 22 + i * 2.2), J(`footR${i}`, "body", 24 + i * 0.5, 22 + i * 2.2)]);

export const RIVER_CRAB_WIRE = {
  mode: "new",
  family: "custom",
  baseRig: n,
  rig: {
    id: "river-crab",
    name: "River crab",
    grid: 32,
    slots: [{ slot: "shell", material: "accent" }, { slot: "claw", material: "accent" }, { slot: "eye", material: "ink" }],
    joints: [
      J("body", null, 16, 19),
      J("armL", "body", 9, 16),
      J("armR", "body", 23, 16),
      { id: "clawL", parent: "armL", rest: { down: [7, 11], side: [20, 13], up: [7, 11], "down-side": n, "up-side": n } },
      { id: "clawR", parent: "armR", rest: { down: [25, 11], side: [22, 13], up: [25, 11], "down-side": n, "up-side": n } },
      J("eyeL", "body", 13, 15),
      J("eyeR", "body", 19, 15),
      ...legs,
    ],
    parts: [
      ...[0, 1, 2].flatMap((i) => [
        part({ id: `legL${i}`, kind: "limb", from: "body", to: `footL${i}`, r: 0.9, slot: "shell", z: 1 }),
        part({ id: `legR${i}`, kind: "limb", from: "body", to: `footR${i}`, r: 0.9, slot: "shell", z: 1 }),
      ]),
      part({ id: "shell", kind: "ellipse", joint: "body", rx: 9, ry: 6, slot: "shell", z: 3 }),
      part({ id: "armL", kind: "limb", from: "body", to: "clawL", r: 1.1, slot: "claw", z: 2 }),
      part({ id: "armR", kind: "limb", from: "body", to: "clawR", r: 1.1, slot: "claw", z: 2 }),
      part({ id: "pincerL", kind: "ellipse", joint: "clawL", rx: 3, ry: 2.5, slot: "claw", z: 4 }),
      part({ id: "pincerR", kind: "ellipse", joint: "clawR", rx: 3, ry: 2.5, slot: "claw", z: 4 }),
      part({ id: "stalkL", kind: "limb", from: "body", to: "eyeL", r: 0.6, slot: "claw", z: 3.5, views: ["down", "side"] }),
      part({ id: "stalkR", kind: "limb", from: "body", to: "eyeR", r: 0.6, slot: "claw", z: 3.5, views: ["down", "side"] }),
      part({ id: "eyeBallL", kind: "ellipse", joint: "eyeL", dy: -1, rx: 1.4, ry: 1.4, slot: "eye", z: 5, views: ["down", "side"] }),
      part({ id: "eyeBallR", kind: "ellipse", joint: "eyeR", dy: -1, rx: 1.4, ry: 1.4, slot: "eye", z: 5, views: ["down", "side"] }),
    ],
  },
  slots: [],
  builtinAttachments: [],
  attachments: [],
  clips: [
    { id: "idle", fps: 3, all: [[{ joint: "clawL", dx: 0, dy: 0 }], [{ joint: "clawL", dx: 0, dy: -1 }, { joint: "clawR", dx: 0, dy: -1 }, { joint: "body", dx: 0, dy: 0.5 }]], down: n, side: n, up: n },
    {
      id: "walk",
      fps: 8,
      all: [
        [{ joint: "footL0", dx: -1, dy: -1 }, { joint: "footR1", dx: 1, dy: -1 }, { joint: "footL2", dx: -1, dy: -1 }],
        [{ joint: "body", dx: 0, dy: 0.5 }],
        [{ joint: "footR0", dx: 1, dy: -1 }, { joint: "footL1", dx: -1, dy: -1 }, { joint: "footR2", dx: 1, dy: -1 }],
        [{ joint: "body", dx: 0, dy: 0.5 }],
      ],
      down: n,
      side: n,
      up: n,
    },
  ],
  name: "River crab",
  notes: "A custom crab skeleton: shell, two pincers, eye stalks and six legs, with its own idle and walk.",
};

/** A monk: the humanoid in a saffron robe colour with an alms bowl. */
export const MONK_WIRE = {
  mode: "extend",
  family: "humanoid",
  baseRig: "humanoid-normal",
  rig: n,
  slots: [{ slot: "top", material: "gold" }],
  builtinAttachments: ["ngob-hat"],
  attachments: [{ id: "alms-bowl", name: "Alms bowl", joints: n, parts: [part({ id: "bowl", kind: "ellipse", joint: "handL", dy: 1, rx: 3, ry: 2, slot: "metal", z: 6 })] }],
  clips: [],
  name: "Monk",
  notes: "Humanoid in saffron with an alms bowl.",
};

import { describe, expect, it } from "vitest";
import { KIT_PRESETS } from "./kit";
import { PALETTE_SIZE } from "./palette";
import { renderRig, renderRigFrame, solvePose, validateRig } from "./rig";
import { EXAMPLE_RIG, IDLE, NGOB_HAT, WALK } from "./rigs/example";

describe("rig core", () => {
  it("validates the example rig and catches bad references", () => {
    expect(validateRig(EXAMPLE_RIG, [NGOB_HAT])).toEqual([]);
    const bad = { ...EXAMPLE_RIG, parts: [...EXAMPLE_RIG.parts, { id: "x", kind: "limb" as const, from: "hip", to: "tail", r: 1, z: 0 }] };
    expect(validateRig(bad)[0]).toMatch(/unknown joint tail/);
  });

  it("children inherit parent offsets", () => {
    const p = solvePose(EXAMPLE_RIG, "down", { hip: [0, 2] });
    expect(p.head[1]).toBe(10 + 2);
    expect(p.footL[1]).toBe(29 + 2);
  });

  it("renders every clip x direction at the kit size with valid indices", () => {
    for (const kit of KIT_PRESETS) {
      const rows = renderRig({ rig: EXAMPLE_RIG, kit }, [WALK, IDLE]);
      expect(rows.map((r) => r.name)).toContain("walk-left");
      expect(rows).toHaveLength(8);
      for (const f of rows.flatMap((r) => r.frames)) {
        expect([f.w, f.h]).toEqual([kit.sizes.character, kit.sizes.character]);
        expect(f.data.every((v) => v >= 0 && v < PALETTE_SIZE)).toBe(true);
        expect(f.data.some(Boolean)).toBe(true);
      }
    }
  });

  it("attachments follow the head through the walk cycle", () => {
    const kit = KIT_PRESETS[0];
    const plain = renderRigFrame({ rig: EXAMPLE_RIG, kit }, "down", WALK.frames && (WALK.frames as any).down[1]);
    const hat = renderRigFrame({ rig: EXAMPLE_RIG, kit, attachments: [NGOB_HAT] }, "down", (WALK.frames as any).down[1]);
    const top = (s: typeof plain) => Math.floor(s.data.findIndex(Boolean) / s.w);
    expect(top(hat)).toBeLessThan(top(plain));
  });

  it("attachments can bring joints that clips pose", () => {
    const kit = KIT_PRESETS[0];
    const hoe = {
      id: "t", name: "t",
      joints: [{ id: "toolTip", parent: "handR", rest: [26, 14] as [number, number] }],
      parts: [{ id: "shaft", kind: "limb" as const, from: "handR", to: "toolTip", r: 0.8, slot: "wood", z: 9 }],
    };
    expect(validateRig(EXAMPLE_RIG, [hoe])).toEqual([]);
    const a = renderRigFrame({ rig: EXAMPLE_RIG, kit, attachments: [hoe] }, "down", {});
    const b = renderRigFrame({ rig: EXAMPLE_RIG, kit, attachments: [hoe] }, "down", { toolTip: [-6, 6] });
    expect(a.data).not.toEqual(b.data);
  });

  it("left is a lit mirror of right, not a flipped copy", () => {
    const kit = KIT_PRESETS[0];
    const l = renderRigFrame({ rig: EXAMPLE_RIG, kit }, "left");
    const r = renderRigFrame({ rig: EXAMPLE_RIG, kit }, "right");
    const mirrored = r.data.map((_, i) => r.data[Math.floor(i / r.w) * r.w + (r.w - 1 - (i % r.w))]);
    expect(l.data.map(Boolean)).toEqual(mirrored.map(Boolean)); // same silhouette
    expect(l.data).not.toEqual(mirrored); // different lighting
  });
});

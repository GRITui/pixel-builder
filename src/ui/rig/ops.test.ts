import { describe, expect, it } from "vitest";
import { solvePose, type Clip, type RigDef } from "../../core/rig";
import { addFrame, bones, canRedo, canUndo, cleanPose, createHistory, deleteFrame, dragJoint, duplicateFrame, frameCount, framesPerView, hitJoint, pushHistory, redo, setPose, toClip, undo } from "./ops";

const rig: RigDef = {
  id: "t", name: "T", grid: 32, slots: {}, parts: [],
  joints: [
    { id: "root", parent: null, rest: [16, 16] },
    { id: "arm", parent: "root", rest: [20, 12] },
    { id: "hand", parent: "arm", rest: [22, 16] },
  ],
};

describe("dragJoint", () => {
  it("lands the joint on the target, accounting for parent offset", () => {
    const pose = { root: [1, 0] as [number, number] };
    const next = dragJoint(rig, "down", pose, "hand", [25, 18], 0.5);
    expect(solvePose(rig, "down", next).hand).toEqual([25, 18]);
  });
  it("removes the entry when back at rest", () => {
    const next = dragJoint(rig, "down", { hand: [2, 2] }, "hand", [22, 16]);
    expect(next.hand).toBeUndefined();
  });
  it("snaps to the step", () => {
    const next = dragJoint(rig, "down", {}, "hand", [22.3, 16.8], 0.5);
    expect(next.hand).toEqual([0.5, 1]);
  });
});

describe("hitJoint", () => {
  const pos = { a: [0, 0] as [number, number], b: [3, 0] as [number, number] };
  it("picks nearest in radius", () => expect(hitJoint(pos, [2.5, 0], 2)).toBe("b"));
  it("misses outside radius", () => expect(hitJoint(pos, [10, 10], 2)).toBeNull());
});

describe("frames", () => {
  const clip: Clip = { id: "c", fps: 6, frames: [{ arm: [1, 0] }, {}] };
  it("expands shared frames to every view", () => {
    const f = framesPerView(clip);
    expect(f.side).toHaveLength(2);
    expect(f.up[0].arm).toEqual([1, 0]);
  });
  it("pads ragged views and handles undefined", () => {
    expect(frameCount(framesPerView(undefined))).toBe(1);
    expect(frameCount(framesPerView({ id: "x", fps: 1, frames: { down: [{}, {}, {}], side: [{}] } }))).toBe(3);
  });
  it("add/duplicate/delete keep views in sync", () => {
    let f = framesPerView(clip);
    f = setPose(f, "down", 0, { arm: [2, 2] });
    f = duplicateFrame(f, 0);
    expect(frameCount(f)).toBe(3);
    expect(f.down[1]).toEqual(f.down[0]);
    expect(f.down[1]).not.toBe(f.down[0]);
    f = addFrame(f, 0);
    expect(f.down[1]).toEqual({});
    expect(f.side).toHaveLength(4);
    f = deleteFrame(f, 1);
    expect(frameCount(f)).toBe(3);
  });
  it("never deletes the last frame", () => {
    const f = framesPerView(undefined);
    expect(deleteFrame(f, 0)).toBe(f);
  });
  it("toClip drops zero offsets", () => {
    expect(cleanPose({ a: [0, 0], b: [1, 0] })).toEqual({ b: [1, 0] });
    expect(toClip("n", 8, framesPerView(clip)).fps).toBe(8);
  });
});

describe("history and bones", () => {
  it("undoes and redoes", () => {
    let h = createHistory(1);
    h = pushHistory(h, 2);
    h = pushHistory(h, 3);
    expect(h.present).toBe(3);
    h = undo(h);
    expect(h.present).toBe(2);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(3);
    expect(canUndo(createHistory(0))).toBe(false);
    h = pushHistory(undo(h), 9);
    expect(canRedo(h)).toBe(false);
  });
  it("lists bones", () => expect(bones(rig)).toEqual([["root", "arm"], ["arm", "hand"]]));
});

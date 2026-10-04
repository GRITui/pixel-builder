import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { KIT_PRESETS } from "../src/core/kit";
import { renderRig } from "../src/core/rig";
import { RIGS } from "../src/core/rigs";
import { buildClipPrompt, buildClipSchema, checkClip, clipRoute, FAMILY_JOINTS, impliesJump, normalizeClipRequest } from "./clip";
import { dense, FIXTURES } from "./clip.fixtures";
import { HttpError } from "./prompts";

const signal = new AbortController().signal;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const humanoid = FIXTURES[0];

describe("prompt and schema", () => {
  it("restricts pose keys to the family's joints, strict objects", () => {
    const s = buildClipSchema([...FAMILY_JOINTS.quadruped]) as any;
    const pose = s.properties.frames.properties.side.items;
    expect(Object.keys(pose.properties)).toEqual([...FAMILY_JOINTS.quadruped]);
    expect(pose.required).toEqual([...FAMILY_JOINTS.quadruped]);
    expect(pose.additionalProperties).toBe(false);
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(Object.keys(s.properties));
  });
  it("includes the joint contract, few-shot clips and the request", () => {
    const { user, system } = buildClipPrompt(normalizeClipRequest({ prompt: "wave", family: "humanoid", fps: 5, frames: 4 }));
    expect(user).toContain("kneeL<-hip");
    expect(user).toContain('"id":"walk"');
    expect(user).not.toContain("toolTip");
    expect(user).toContain("exactly 4 frames");
    expect(system).toContain("y grows DOWN");
  });
});

describe("normalizeClipRequest", () => {
  it("clamps and rejects", () => {
    expect(normalizeClipRequest({ prompt: "x", family: "bird", fps: 999, frames: 99 })).toMatchObject({ fps: 30, frames: 12 });
    expect(() => normalizeClipRequest({ prompt: "x", family: "dragon" })).toThrow(HttpError);
    expect(() => normalizeClipRequest({ prompt: " ", family: "bird" })).toThrow(/prompt/);
    expect(() => normalizeClipRequest({ prompt: "x", family: "bird", rig: "nope" })).toThrow(/Unknown rig/);
  });
});

describe("fixtures: 9 prompts -> valid clips that render on the family's rigs", () => {
  for (const f of FIXTURES)
    it(f.output.id, () => {
      const { clip, errors } = checkClip(f.output, { family: f.family, prompt: f.prompt });
      expect(errors).toEqual([]);
      const rigs = RIGS.filter((r) => r.family === f.family).slice(0, 3);
      for (const { rig } of rigs) {
        const rows = renderRig({ rig, kit: KIT_PRESETS[0] }, [clip!]);
        expect(rows.length).toBe(4);
        for (const r of rows) {
          expect(r.frames.length).toBe(f.output.frames.side.length);
          expect(r.frames.every((s) => s.data.some((v) => v > 0))).toBe(true);
        }
      }
    });
});

describe("checkClip validation", () => {
  const check = (mut: (o: any) => void, prompt = humanoid.prompt) => {
    const o = clone(humanoid.output);
    mut(o);
    return checkClip(o, { family: "humanoid", prompt });
  };
  it("catches unknown joints", () => {
    const r = check((o) => (o.frames.side[1].wing = { dx: 1, dy: 0 }));
    expect(r.clip).toBeNull();
    expect(r.errors[0]).toMatch(/unknown joint 'wing'/);
  });
  it("catches out-of-range offsets (jump allows a little more)", () => {
    expect(check((o) => (o.frames.side[1].handR = { dx: 0, dy: -5 })).errors[0]).toMatch(/outside \+-4/);
    const jump = FIXTURES[3];
    const o = clone(jump.output);
    o.frames.side[2].handR = { dx: 0, dy: -6 };
    expect(checkClip(o, { family: "humanoid", prompt: jump.prompt }).errors).toEqual([]);
    o.frames.side[2].handR = { dx: 0, dy: -9 };
    expect(checkClip(o, { family: "humanoid", prompt: jump.prompt }).errors[0]).toMatch(/outside \+-8/);
  });
  it("catches feet sinking and floating, unless a jump is implied", () => {
    expect(check((o) => (o.frames.side[1].hip.dy = 3)).errors.join()).toMatch(/sink below the ground/);
    const float = (o: any) => {
      o.frames.side[1].footL = { dx: 0, dy: -4 };
      o.frames.side[1].footR = { dx: 0, dy: -4 };
      o.frames.side[1].hip = { dx: 0, dy: 0 };
    };
    expect(check(float).errors.join()).toMatch(/feet float/);
    expect(check(float, "jump up").errors).toEqual([]);
  });
  it("checks frame counts, fps and shape", () => {
    expect(check((o) => o.frames.up.pop()).errors.join()).toMatch(/same count/);
    expect(check((o) => (o.fps = 0)).errors.join()).toMatch(/fps/);
    expect(check((o) => (o.frames = "x")).errors.join()).toMatch(/frames must be/);
    expect(checkClip(humanoid.output, { family: "humanoid", prompt: "x", frames: 3 }).errors[0]).toMatch(/exactly 3/);
    expect(checkClip(null, { family: "humanoid", prompt: "x" }).errors.length).toBe(1);
  });
  it("drops zero offsets and normalises the id", () => {
    const { clip } = check((o) => (o.id = "My Clip!"));
    expect(clip!.id).toBe("my-clip");
    expect(JSON.stringify(clip)).not.toContain("[0,0]");
  });
  it("accepts a quadruped rig's own joint list and rejects humanoid joints there", () => {
    const bad = { id: "x", fps: 4, frames: [{ handL: [0, 1] }, {}] };
    expect(checkClip(bad, { family: "quadruped", prompt: "x" }).errors[0]).toMatch(/unknown joint 'handL'/);
    expect(checkClip({ ...bad, frames: [{ head: [0, 1] }, {}] }, { family: "quadruped", prompt: "x" }).errors).toEqual([]);
  });
  it("detects jump intent", () => {
    expect(impliesJump("jump over a log")).toBe(true);
    expect(impliesJump("sit down")).toBe(false);
  });
});

describe("agent docs", () => {
  const skill = readFileSync("skills/pixel-builder/SKILL.md", "utf8");
  it("keeps both skill copies identical", () => {
    expect(readFileSync(".claude/skills/pixel-builder/SKILL.md", "utf8")).toBe(skill);
  });
  it("the worked create_clip example is valid on the humanoid family and renders", () => {
    const json = /```json\n(\{"id":"wai-bow"[\s\S]*?)\n```/.exec(skill)![1];
    const { clip, errors } = checkClip(JSON.parse(json), { family: "humanoid", prompt: "bow politely (wai)" });
    expect(errors).toEqual([]);
    const rig = RIGS.find((r) => r.family === "humanoid")!.rig;
    expect(renderRig({ rig, kit: KIT_PRESETS[0] }, [clip!]).length).toBe(4);
  });
});

describe("clipRoute", () => {
  const body = { prompt: humanoid.prompt, family: "humanoid" };
  it("returns a valid clip from one call", async () => {
    const call = vi.fn().mockResolvedValue(humanoid.output);
    const r = await clipRoute({ ...body, fps: 9 }, signal, call);
    expect(call).toHaveBeenCalledOnce();
    expect(call.mock.calls[0][0]).toMatchObject({ effort: "high" });
    expect(r.clip.fps).toBe(9);
    expect(r.clip.id).toBe("pickup-basket-walk");
  });
  it("repairs once with readable errors", async () => {
    const bad = clone(humanoid.output) as any;
    bad.frames.side[1].wing = { dx: 1, dy: 0 };
    const call = vi.fn().mockResolvedValueOnce(bad).mockResolvedValueOnce(humanoid.output);
    const r = await clipRoute(body, signal, call);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[1][0].user).toMatch(/unknown joint 'wing'/);
    expect(r.clip.id).toBe("pickup-basket-walk");
  });
  it("422 when the repair is still invalid", async () => {
    const bad = { id: "x", fps: 4, frames: { down: dense("humanoid", [{ hip: [0, 3] }, {}]), side: dense("humanoid", [{ hip: [0, 3] }, {}]), up: dense("humanoid", [{}, {}]) } };
    const call = vi.fn().mockResolvedValue(bad);
    await expect(clipRoute(body, signal, call)).rejects.toMatchObject({ status: 422 });
    expect(call).toHaveBeenCalledTimes(2);
  });
});

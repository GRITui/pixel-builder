import { describe, expect, it } from "vitest";
import { DEFAULT_KIT } from "../src/core/kit";
import { ATTACHMENTS, RIGS } from "../src/core/rigs";
import { HttpError } from "./prompts";
import { buildRigPrompt, normalizeRigRequest, rigRoute } from "./rig";
import { MONK_WIRE, RIVER_CRAB_WIRE } from "./rig-fixtures";
import { attachmentJsonSchema, buildRigSchema, fromWire, rigJsonSchema, rigToWire, stripNulls } from "./rig-schema";

type S = Record<string, any>;

/** Minimal validator for the schema subset we emit (type, enum, anyOf, items, properties/required/additionalProperties). */
function validate(v: unknown, s: S, path = "$"): string[] {
  if (s.anyOf) {
    const tries = s.anyOf.map((x: S) => validate(v, x, path));
    return tries.some((t: string[]) => !t.length) ? [] : [`${path}: matches none of anyOf (${tries.map((t: string[]) => t[0]).join(" | ")})`];
  }
  if (s.enum) return s.enum.includes(v) ? [] : [`${path}: ${JSON.stringify(v)} not in enum`];
  switch (s.type) {
    case "null": return v === null ? [] : [`${path}: not null`];
    case "number": return typeof v === "number" ? [] : [`${path}: not a number`];
    case "string": return typeof v === "string" ? [] : [`${path}: not a string`];
    case "boolean": return typeof v === "boolean" ? [] : [`${path}: not a boolean`];
    case "array": return Array.isArray(v) ? v.flatMap((x, i) => validate(x, s.items, `${path}[${i}]`)) : [`${path}: not an array`];
    case "object": {
      if (typeof v !== "object" || v === null || Array.isArray(v)) return [`${path}: not an object`];
      const o = v as S, errs: string[] = [];
      for (const k of Object.keys(o)) if (!(k in s.properties)) errs.push(`${path}.${k}: extra property`);
      for (const k of s.required) {
        // an absent optional field is the same as null (the model sends null; registry data omits it)
        const sub = s.properties[k];
        if (o[k] === undefined) { if (!sub.anyOf?.some((x: S) => x.type === "null")) errs.push(`${path}.${k}: missing`); continue; }
        errs.push(...validate(o[k], sub, `${path}.${k}`));
      }
      return errs;
    }
  }
  return [`${path}: unsupported schema`];
}

/** Every object in the schema is closed and lists all its properties as required (structured-output rules). */
function strict(s: S, path = "$"): string[] {
  const errs: string[] = [];
  if (s.type === "object") {
    if (s.additionalProperties !== false) errs.push(`${path}: additionalProperties must be false`);
    const keys = Object.keys(s.properties);
    if (keys.length !== s.required.length || !keys.every((k) => s.required.includes(k))) errs.push(`${path}: required must list all properties`);
    for (const [k, v] of Object.entries<S>(s.properties)) errs.push(...strict(v, `${path}.${k}`));
  }
  if (s.items) errs.push(...strict(s.items, `${path}[]`));
  for (const a of s.anyOf ?? []) errs.push(...strict(a, `${path}|`));
  return errs;
}

describe("rig schema", () => {
  it("follows the structured-output rules", () => {
    expect(strict(buildRigSchema())).toEqual([]);
  });

  it("accepts every registry rig and attachment (schema stays in sync with the types)", () => {
    for (const { rig } of RIGS) expect(validate(rigToWire(rig), rigJsonSchema), rig.id).toEqual([]);
    for (const { attachment } of ATTACHMENTS) expect(validate(attachment, attachmentJsonSchema), attachment.id).toEqual([]);
  });

  it("accepts the hand-written answers", () => {
    expect(validate(RIVER_CRAB_WIRE, buildRigSchema())).toEqual([]);
    expect(validate(MONK_WIRE, buildRigSchema())).toEqual([]);
  });

  it("rejects malformed data", () => {
    const bad = { ...RIVER_CRAB_WIRE, mode: "other" };
    expect(validate(bad, buildRigSchema()).length).toBeGreaterThan(0);
  });

  it("fromWire folds slots/poses and strips nulls", () => {
    const r = fromWire(RIVER_CRAB_WIRE);
    expect(r.rig!.slots).toEqual({ shell: "accent", claw: "accent", eye: "ink" });
    expect(r.clips.find((c) => c.id === "idle")!.frames).toHaveLength(2);
    expect(JSON.stringify(r.rig).match(/null/g)).toHaveLength(1); // only the root joint parent
    expect(stripNulls({ a: null, b: [1, { c: null }] })).toEqual({ b: [1, {}] });
    expect(fromWire("garbage").mode).toBe("extend");
  });
});

describe("rig prompt", () => {
  it("names the kit materials, contracts and the base rig", () => {
    const p = buildRigPrompt({ prompt: "a monk", kit: DEFAULT_KIT, base: "humanoid-normal" });
    for (const m of ["foliage", "accent", "shoulderFL", "finTop", "humanoid-normal"]) expect(p.system + p.user).toContain(m);
    expect(p.user).toContain("MUST use mode 'extend'");
    expect(buildRigPrompt({ prompt: "x", kit: DEFAULT_KIT }, { previous: {}, errors: ["boom"] }).user).toContain("- boom");
  });
  it("validates the request", () => {
    expect(() => normalizeRigRequest({ prompt: "" })).toThrow(HttpError);
    expect(() => normalizeRigRequest({ prompt: "x", base: "nope" })).toThrow(/built-in rig id/);
    expect(normalizeRigRequest({ prompt: "x", base: "humanoid-normal" }).base).toBe("humanoid-normal");
  });
});

describe("POST /api/rig (mocked model)", () => {
  const sig = new AbortController().signal;
  const body = { prompt: "a river crab", kit: DEFAULT_KIT };

  it("returns a valid new rig with its own clips", async () => {
    const r = await rigRoute(body, sig, async () => RIVER_CRAB_WIRE);
    expect(r.rig?.id).toBe("river-crab");
    expect(r.clips?.map((c) => c.id)).toEqual(["idle", "walk"]);
    expect(r.family).toBe("custom");
  });

  it("returns an extension of a registry rig", async () => {
    const r = await rigRoute({ ...body, base: "humanoid-normal" }, sig, async () => MONK_WIRE);
    expect(r.rig).toBeUndefined();
    expect(r.baseRig).toBe("humanoid-normal");
    expect(r.attachments?.[0].id).toBe("alms-bowl");
    expect(r.slots.top).toBe("gold");
  });

  it("repairs once: invalid -> errors sent back -> valid", async () => {
    const broken = { ...RIVER_CRAB_WIRE, rig: { ...RIVER_CRAB_WIRE.rig, joints: RIVER_CRAB_WIRE.rig.joints.filter((j) => j.id !== "eyeL") } };
    const prompts: string[] = [];
    let n = 0;
    const r = await rigRoute(body, sig, async (c) => {
      prompts.push(c.user);
      return n++ === 0 ? broken : RIVER_CRAB_WIRE;
    });
    expect(n).toBe(2);
    expect(prompts[1]).toContain("unknown joint eyeL");
    expect(r.rig?.id).toBe("river-crab");
  });

  it("422 when still invalid after the repair round", async () => {
    let n = 0;
    const err = await rigRoute(body, sig, async () => (n++, { ...RIVER_CRAB_WIRE, clips: [] })).catch((e) => e);
    expect(n).toBe(2);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(422);
    expect((err as HttpError).message).toMatch(/idle/);
  });

  it("keeps the root joint's parent null and rejects unknown built-in attachment ids", async () => {
    const r = await rigRoute(body, sig, async () => RIVER_CRAB_WIRE);
    expect(r.rig!.joints[0].parent).toBeNull();
    await expect(rigRoute(body, sig, async () => ({ ...RIVER_CRAB_WIRE, builtinAttachments: ["nope"] }))).rejects.toMatchObject({ status: 422 });
  });

  it("rejects pixel rows with non-legend characters", async () => {
    const bad = JSON.parse(JSON.stringify(MONK_WIRE));
    bad.attachments[0].parts[0] = { ...bad.attachments[0].parts[0], kind: "pixels", rows: ["a a"], anchor: [0, 0] };
    await expect(rigRoute(body, sig, async () => bad)).rejects.toMatchObject({ status: 422 });
  });
});

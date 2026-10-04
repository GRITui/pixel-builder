import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_KIT } from "../src/core/kit";
import { MATERIALS, PALETTES } from "../src/core/palette";
import type { Generator } from "../src/core/generators/types";
import { GENERATORS } from "../src/core/generators";
import { buildLegend, encodeSprite } from "../src/core/legend";
import { mapError } from "./claude";
import {
  HttpError, clampDim, buildKitPrompt, buildKitSchema, buildPixelsPrompt, buildPixelsSchema, buildVibePrompt, buildVibeSchema,
  normalizeCategory, normalizeGenerator, normalizeKit, normalizeReferences, parseKit, parseVibe, requirePrompt,
} from "./prompts";

/** Every object schema must be strict: additionalProperties:false and all properties required. */
function assertStrict(schema: unknown, path = "$") {
  if (!schema || typeof schema !== "object") return;
  const s = schema as Record<string, unknown>;
  if (s.type === "object") {
    expect(s.additionalProperties, `${path} additionalProperties`).toBe(false);
    const props = Object.keys((s.properties as object) ?? {});
    expect([...(s.required as string[])].sort(), `${path} required`).toEqual([...props].sort());
  }
  for (const [k, v] of Object.entries(s)) {
    if (Array.isArray(v)) v.forEach((x, i) => assertStrict(x, `${path}.${k}[${i}]`));
    else if (v && typeof v === "object") {
      if (k === "properties") for (const [pk, pv] of Object.entries(v)) assertStrict(pv, `${path}.${pk}`);
      else assertStrict(v, `${path}.${k}`);
    }
  }
}

const gen: Generator = {
  id: "t", category: "character", label: "Test", description: "A test generator", generate: () => { throw new Error("x"); },
  params: [
    { key: "pose", label: "Pose", type: "select", options: ["idle", "walk"], default: "idle" },
    { key: "shirt", label: "Shirt", type: "material", default: "cloth" },
    { key: "tunic", label: "Tunic", type: "material", options: ["cloth", "cloth2"], default: "cloth" },
    { key: "height", label: "Height", type: "number", min: 1, max: 5, step: 1, default: 3 },
    { key: "cape", label: "Cape", type: "bool", default: false },
  ],
};

describe("vibe schema", () => {
  it("maps ParamSpecs to strict JSON schema", () => {
    const schema = buildVibeSchema(gen) as any;
    assertStrict(schema);
    const p = schema.properties.params;
    expect(p.required).toEqual(["pose", "shirt", "tunic", "height", "cape"]);
    expect(p.properties.pose.enum).toEqual(["idle", "walk"]);
    expect(p.properties.shirt.enum).toContain("cloth");
    expect(p.properties.shirt.enum).not.toContain("ink");
    expect(p.properties.tunic.enum).toEqual(["cloth", "cloth2"]);
    expect(p.properties.height.type).toBe("number");
    expect(p.properties.cape.type).toBe("boolean");
    expect(schema.required).toEqual(["name", "params", "notes"]);
  });

  it("is strict for every real generator", () => {
    for (const g of GENERATORS) assertStrict(buildVibeSchema(g), g.id);
  });

  it("builds a prompt mentioning the generator, kit and request", () => {
    const { user, system } = buildVibePrompt({ prompt: "a red knight", generator: gen, kit: DEFAULT_KIT, current: { pose: "walk" } });
    expect(user).toContain("a red knight");
    expect(user).toContain("pose");
    expect(user).toContain(DEFAULT_KIT.vibe);
    expect(user).toContain('"pose":"walk"');
    expect(system.length).toBeGreaterThan(50);
  });

  it("coerces model params and fills defaults", () => {
    const r = parseVibe({ name: "  Ember  ", params: { pose: "fly", shirt: "gold", height: 99, cape: "yes", extra: 1 }, notes: "ok" }, gen);
    expect(r.name).toBe("Ember");
    expect(r.params).toEqual({ pose: "idle", shirt: "gold", tunic: "cloth", height: 5, cape: false });
    expect(parseVibe(null, gen).name).toBe("Test");
  });
});

describe("clampDim", () => {
  it("clamps to 8..64 and falls back for non-numbers", () => {
    expect(clampDim(2, 16)).toBe(8);
    expect(clampDim(500, 16)).toBe(64);
    expect(clampDim(20.4, 16)).toBe(20);
    expect(clampDim("x", 16)).toBe(16);
    expect(clampDim(NaN, 99)).toBe(64);
  });
});

describe("request normalisation", () => {
  it("rebuilds a safe generator from untrusted JSON", () => {
    const g = normalizeGenerator({
      id: "x", label: "L", description: "d",
      params: [
        { key: "a", type: "select", options: ["1", "2", 3], default: "nope" },
        { key: "b", type: "material", options: ["cloth", "bogus"], default: "bogus" },
        { key: "c", type: "number", min: 0, max: 10, default: 99 },
        { key: "d", type: "weird" },
        "junk",
        { type: "bool" },
      ],
    });
    expect(g.params.map((p) => p.key)).toEqual(["a", "b", "c"]);
    expect((g.params[0] as any).options).toEqual(["1", "2"]);
    expect(g.params[0].default).toBe("1");
    expect((g.params[1] as any).options).toEqual(["cloth"]);
    expect(g.params[1].default).toBe("cloth");
    expect(g.params[2].default).toBe(10);
    expect(() => normalizeGenerator(null)).toThrow(HttpError);
  });

  it("normalises kits and falls back to defaults", () => {
    const k = normalizeKit({
      name: "K", paletteId: "nope", outline: "x", lightDir: "top", shadeSteps: 99, ambient: -3, vibe: "",
      rampOverrides: { skin: ["#aabbcc", "bad", 5], notAMaterial: ["#000000"] }, sizes: { character: 1000 },
    });
    expect(k.paletteId).toBe(DEFAULT_KIT.paletteId);
    expect(k.outline).toBe(DEFAULT_KIT.outline);
    expect(k.lightDir).toBe("top");
    expect(k.shadeSteps).toBe(5);
    expect(k.ambient).toBe(0);
    expect(k.vibe).toBe(DEFAULT_KIT.vibe);
    expect(k.rampOverrides).toEqual({ skin: ["#aabbcc"] });
    expect(k.sizes.character).toBe(64);
    expect(normalizeKit(undefined).paletteId).toBe(DEFAULT_KIT.paletteId);
  });

  it("validates prompt and category, drops bad references", () => {
    expect(() => requirePrompt("   ")).toThrow(HttpError);
    expect(requirePrompt("x".repeat(5000))).toHaveLength(1000);
    expect(() => normalizeCategory("nope")).toThrow(HttpError);
    expect(normalizeCategory("ui")).toBe("ui");
    const good = { w: 8, h: 8, data: new Array(64).fill(1) };
    const refs = normalizeReferences([good, { w: 8, h: 8, data: [1] }, { w: 999, h: 1, data: [] }, good, good]);
    expect(refs).toHaveLength(1); // bad ones dropped, max 2 considered
    expect(normalizeReferences("x")).toEqual([]);
  });
});

describe("pixels prompt", () => {
  const ref = { w: 8, h: 8, data: Array.from({ length: 64 }, (_, i) => (i % 3 ? 2 : 0)) };
  it("schema is strict", () => assertStrict(buildPixelsSchema()));
  it("explains canvas, light, outline, vibe, legend and references", () => {
    const { user } = buildPixelsPrompt({ prompt: "a wizard", category: "character", w: 16, h: 24, kit: { ...DEFAULT_KIT, outline: "black", lightDir: "top-right" }, references: [ref] });
    expect(user).toContain("16 columns x 24 rows");
    expect(user).toContain("top-right");
    expect(user).toMatch(/outline/i);
    expect(user).toContain(DEFAULT_KIT.vibe);
    for (const m of MATERIALS) expect(user).toContain(m);
    expect(user).toContain("Style reference 1");
    for (const row of encodeSprite(ref, buildLegend(DEFAULT_KIT))) expect(user).toContain(row);
    expect(user).toContain("Paint: a wizard");
  });
});

describe("kit schema / parsing", () => {
  it("schema is strict and lists real palettes", () => {
    const s = buildKitSchema() as any;
    assertStrict(s);
    expect(s.properties.paletteId.enum).toEqual(PALETTES.map((p) => p.id));
    expect(buildKitPrompt({ prompt: "gloomy", kit: DEFAULT_KIT }).user).toContain("gloomy");
  });

  it("validates model output", () => {
    const { kit, notes } = parseKit({
      paletteId: "ashen", outline: "colored", lightDir: "nope", shadeSteps: 9, dither: true, ambient: 4, vibe: "Moody.",
      rampOverrides: [
        { material: "skin", colors: ["#f6d7b0", "#b86f50", "#4a2a24", "#e4a672", "#7a4535"] },
        { material: "skin", colors: ["#000000", "#111111", "#222222", "#333333", "#444444"] },
        { material: "bogus", colors: ["#000000", "#111111", "#222222", "#333333", "#444444"] },
        { material: "hair", colors: ["#000000"] },
        { material: "cloth", colors: ["#000", "#111111", "#222222", "#333333", "#444444"] },
      ],
      notes: "n",
    });
    expect(kit.paletteId).toBe("ashen");
    expect(kit.outline).toBe("colored");
    expect(kit.lightDir).toBeUndefined();
    expect(kit.shadeSteps).toBe(5);
    expect(kit.ambient).toBe(1);
    expect(Object.keys(kit.rampOverrides!)).toEqual(["skin"]);
    expect(kit.rampOverrides!.skin).toEqual(["#4a2a24", "#7a4535", "#b86f50", "#e4a672", "#f6d7b0"]); // sorted dark -> light
    expect(notes).toBe("n");
    expect(parseKit(undefined)).toEqual({ kit: {}, notes: "" });
  });

  it("caps ramp overrides at 6 materials", () => {
    const ramp = ["#000000", "#111111", "#222222", "#333333", "#444444"];
    const { kit } = parseKit({ rampOverrides: MATERIALS.map((material) => ({ material, colors: ramp })) });
    expect(Object.keys(kit.rampOverrides!)).toHaveLength(6);
  });
});

describe("error mapping", () => {
  const h = new Headers();
  it("maps typed SDK errors by class", () => {
    expect(mapError(new Anthropic.AuthenticationError(401, { type: "error" }, "bad key", h)).status).toBe(502);
    expect(mapError(new Anthropic.RateLimitError(429, { type: "error" }, "slow down", h)).status).toBe(429);
    expect(mapError(new Anthropic.InternalServerError(529, { type: "error" }, "overloaded", h)).status).toBe(503);
    expect(mapError(new Anthropic.BadRequestError(400, { type: "error" }, "nope", h)).status).toBe(502);
    expect(mapError(new Anthropic.APIConnectionError({ message: "down" })).status).toBe(502);
    expect(mapError(new Anthropic.APIConnectionTimeoutError()).status).toBe(504);
    expect(mapError(new HttpError(422, "x")).status).toBe(422);
    expect(mapError(new Error("boom")).status).toBe(500);
  });
});

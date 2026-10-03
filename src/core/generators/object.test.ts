import { describe, expect, it } from "vitest";
import { KIT_PRESETS } from "../kit";
import { decodeIndex, PALETTE_SIZE } from "../palette";
import { rng } from "../rng";
import type { Sprite, StyleKit } from "../types";
import { OBJECT_KINDS, objectGenerator } from "./object";
import { coerceParams, defaults, randomParams } from "./types";

const ANIMATED = ["coin", "torch", "gem"];
const gen = (kind: string, kit: StyleKit = KIT_PRESETS[0], seed = 1, extra: Record<string, unknown> = {}) =>
  objectGenerator.generate({ ...defaults(objectGenerator), kind, ...extra } as never, kit, seed);
const filled = (s: Sprite) => s.data.filter(Boolean).length;
const validIndices = (s: Sprite) => s.data.every((v) => Number.isInteger(v) && v >= 0 && v < PALETTE_SIZE);

describe("object generator", () => {
  it("exposes the planned kinds", () => {
    const spec = objectGenerator.params.find((p) => p.key === "kind");
    expect(spec && spec.type === "select" && spec.options).toEqual([...OBJECT_KINDS]);
    for (const k of ["chest", "chest-open", "barrel", "crate", "potion", "sword", "axe", "shield", "bow", "coin", "key", "torch", "sign", "pot", "gem", "scroll", "heart", "bomb", "book", "mushroom-item", "apple"])
      expect(OBJECT_KINDS).toContain(k);
  });

  it("draws every kind at the kit object size with valid, non-trivial pixels", () => {
    for (const kit of KIT_PRESETS)
      for (const kind of OBJECT_KINDS) {
        const r = gen(kind, kit);
        expect(r.rows.length).toBeGreaterThan(0);
        for (const f of r.rows.flatMap((x) => x.frames)) {
          expect([f.w, f.h]).toEqual([kit.sizes.object, kit.sizes.object]);
          expect(validIndices(f)).toBe(true);
          expect(filled(f)).toBeGreaterThan(40);
        }
      }
  });

  it("is deterministic per seed", () => {
    for (const kind of OBJECT_KINDS) {
      const a = gen(kind, KIT_PRESETS[2], 7, { variant: 3 });
      expect(gen(kind, KIT_PRESETS[2], 7, { variant: 3 })).toEqual(a);
    }
  });

  it("animates coin, torch and gem with 3-4 frames; everything else is a single frame", () => {
    for (const kind of OBJECT_KINDS) {
      const frames = gen(kind).rows[0].frames;
      if (ANIMATED.includes(kind)) {
        expect(frames.length).toBeGreaterThanOrEqual(3);
        expect(frames.length).toBeLessThanOrEqual(4);
        expect(new Set(frames.map((f) => f.data.join())).size).toBeGreaterThan(1);
      } else expect(frames).toHaveLength(1);
    }
  });

  it("keeps a 1px transparent margin around the art (before outlining)", () => {
    const kit = { ...KIT_PRESETS[0], outline: "none" as const };
    for (const kind of OBJECT_KINDS)
      for (const variant of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        for (const f of gen(kind, kit, 1, { variant }).rows.flatMap((x) => x.frames)) {
          const S = f.w;
          for (let i = 0; i < S; i++)
            for (const [x, y] of [[i, 0], [i, S - 1], [0, i], [S - 1, i]]) expect(f.data[y * S + x], `${kind} v${variant} edge (${x},${y})`).toBe(0);
        }
      }
  });

  it("outlines props with the kit's outline mode", () => {
    const f = gen("crate").rows[0].frames[0];
    const none = gen("crate", { ...KIT_PRESETS[0], outline: "none" }).rows[0].frames[0];
    expect(filled(f)).toBeGreaterThan(filled(none));
  });

  it("main and accent materials re-skin the item", () => {
    const mats = (s: Sprite) => new Set(s.data.map((v) => decodeIndex(v)?.mat).filter(Boolean));
    const stone = mats(gen("chest", KIT_PRESETS[0], 1, { main: "stone" }).rows[0].frames[0]);
    const wood = mats(gen("chest").rows[0].frames[0]);
    expect(stone.has("stone")).toBe(true);
    expect(wood.has("wood")).toBe(true);
    expect(wood.has("stone")).toBe(false);
    const accent = mats(gen("sword", KIT_PRESETS[0], 1, { accent: "cloth2" }).rows[0].frames[0]);
    expect(accent.has("cloth2")).toBe(true);
  });

  it("variant changes the drawing", () => {
    const a = gen("potion", KIT_PRESETS[0], 1, { variant: 0 }).rows[0].frames[0];
    const b = gen("potion", KIT_PRESETS[0], 1, { variant: 1 }).rows[0].frames[0];
    expect(a).not.toEqual(b);
  });

  it("scales with a larger kit object size", () => {
    const kit = { ...KIT_PRESETS[0], sizes: { ...KIT_PRESETS[0].sizes, object: 32 } };
    for (const kind of OBJECT_KINDS) for (const f of gen(kind, kit).rows.flatMap((x) => x.frames)) expect([f.w, f.h]).toEqual([32, 32]);
  });

  it("survives random and coerced params", () => {
    const r = rng(11);
    for (let i = 0; i < 60; i++) {
      const p = randomParams(objectGenerator, r);
      expect(() => objectGenerator.generate(p, KIT_PRESETS[i % KIT_PRESETS.length], i)).not.toThrow();
    }
    const p = coerceParams(objectGenerator, { kind: "bogus", variant: 99, main: "nope" });
    expect(p.kind).toBe("chest");
    expect(p.variant).toBe(9);
    expect(() => objectGenerator.generate(p, KIT_PRESETS[0], 1)).not.toThrow();
  });
});

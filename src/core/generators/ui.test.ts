import { describe, expect, it } from "vitest";
import { KIT_PRESETS } from "../kit";
import { decodeIndex, PALETTE_SIZE } from "../palette";
import { rng } from "../rng";
import type { Sprite, StyleKit } from "../types";
import { coerceParams, defaults, randomParams, type Params } from "./types";
import { UI_KINDS, UI_STYLES, uiGenerator } from "./ui";

const gen = (kind: string, extra: Params = {}, kit: StyleKit = KIT_PRESETS[0], seed = 1) =>
  uiGenerator.generate({ ...defaults(uiGenerator), kind, ...extra } as never, kit, seed);
const first = (r: ReturnType<typeof gen>) => r.rows[0].frames[0];
const level = (s: Sprite, x: number, y: number) => decodeIndex(s.data[y * s.w + x])?.level ?? -1;
const valid = (s: Sprite) => s.data.every((v) => Number.isInteger(v) && v >= 0 && v < PALETTE_SIZE);

describe("ui generator", () => {
  it("renders every kind x style x kit with valid pixels", () => {
    for (const kit of KIT_PRESETS)
      for (const kind of UI_KINDS)
        for (const style of UI_STYLES) {
          const r = gen(kind, { style }, kit);
          expect(r.rows.length).toBeGreaterThan(0);
          for (const f of r.rows.flatMap((x) => x.frames)) {
            expect(valid(f)).toBe(true);
            expect(f.data.some(Boolean)).toBe(true);
          }
        }
  });

  it("is deterministic per seed", () => {
    for (const kind of UI_KINDS) expect(gen(kind, { style: "ornate" }, KIT_PRESETS[1], 4)).toEqual(gen(kind, { style: "ornate" }, KIT_PRESETS[1], 4));
  });

  it("button has normal/hover/pressed rows of the requested size", () => {
    const r = gen("button", { width: 40, height: 14 });
    expect(r.rows.map((x) => x.name)).toEqual(["normal", "hover", "pressed"]);
    for (const row of r.rows) {
      expect(row.frames).toHaveLength(1);
      expect([row.frames[0].w, row.frames[0].h]).toEqual([40, 14]);
    }
    const [n, h, p] = r.rows.map((x) => x.frames[0]);
    expect(n).not.toEqual(h);
    expect(n).not.toEqual(p);
  });

  it("clamps width and height", () => {
    expect([first(gen("button", { width: 3, height: 1 })).w, first(gen("button", { width: 3, height: 1 })).h]).toEqual([16, 10]);
    const big = first(gen("panel", { width: 9999, height: 9999 }));
    expect(big.w).toBeLessThanOrEqual(192);
    expect(big.h).toBeLessThanOrEqual(192);
    const bar = first(gen("bar", { width: 64, height: 400 }));
    expect([bar.w, bar.h]).toEqual([64, 24]);
  });

  it("panel, slot and icon-frame return nineSlice insets that fit the sprite", () => {
    for (const kind of ["panel", "slot", "icon-frame"])
      for (const style of UI_STYLES) {
        const r = gen(kind, { style });
        const f = first(r);
        const ns = (r.meta as { nineSlice: Record<string, number> }).nineSlice;
        expect(ns).toBeTruthy();
        for (const k of ["left", "top", "right", "bottom"]) expect(Number.isInteger(ns[k]) && ns[k] > 0).toBe(true);
        expect(ns.left + ns.right).toBeLessThan(f.w);
        expect(ns.top + ns.bottom).toBeLessThan(f.h);
      }
    expect(gen("button").meta).toBeUndefined();
  });

  it("bar has frame and fill rows of equal size, fill inside the frame's channel", () => {
    const r = gen("bar", { width: 40, height: 8 });
    expect(r.rows.map((x) => x.name)).toEqual(["frame", "fill"]);
    const [frame, fill] = r.rows.map((x) => x.frames[0]);
    expect([fill.w, fill.h]).toEqual([frame.w, frame.h]);
    const rect = (r.meta as { fillRect: { x: number; y: number; w: number; h: number } }).fillRect;
    for (let y = 0; y < fill.h; y++)
      for (let x = 0; x < fill.w; x++) {
        const inside = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
        expect(Boolean(fill.data[y * fill.w + x])).toBe(inside);
      }
  });

  it("checkbox has off/on rows and the checkmark adds pixels", () => {
    const r = gen("checkbox");
    expect(r.rows.map((x) => x.name)).toEqual(["off", "on"]);
    const [off, on] = r.rows.map((x) => x.frames[0]);
    expect(off.w).toBe(on.w);
    expect(off).not.toEqual(on);
  });

  it("tab has inactive/active rows, cursor and dialog-arrow exist", () => {
    expect(gen("tab").rows.map((x) => x.name)).toEqual(["inactive", "active"]);
    expect(first(gen("cursor")).data.some(Boolean)).toBe(true);
    expect(gen("dialog-arrow").rows[0].frames).toHaveLength(2);
  });

  it("bevel light edge follows the kit light direction and inverts when pressed", () => {
    const left = { ...KIT_PRESETS[0], lightDir: "top-left" as const };
    const right = { ...KIT_PRESETS[0], lightDir: "top-right" as const };
    const p = { width: 24, height: 24, style: "bevel" };
    const a = first(gen("panel", p, left));
    const b = first(gen("panel", p, right));
    // top-left light: left/top edges are lighter than right/bottom
    expect(level(a, 1, 12)).toBeGreaterThan(level(a, 22, 12));
    expect(level(a, 12, 1)).toBeGreaterThan(level(a, 12, 22));
    // top-right light: right edge lighter than left
    expect(level(b, 22, 12)).toBeGreaterThan(level(b, 1, 12));
    expect(level(b, 12, 1)).toBeGreaterThan(level(b, 12, 22));
    // pressed button: bevel inverted
    const [n, , pr] = gen("button", { width: 32, height: 16 }, left).rows.map((x) => x.frames[0]);
    expect(level(n, 12, 1)).toBeGreaterThan(level(n, 12, 14));
    expect(level(pr, 12, 1)).toBeLessThan(level(pr, 12, 14));
  });

  it("pressed button shifts its content down by one pixel", () => {
    const [n, , p] = gen("button", { width: 48, height: 16, style: "flat" }).rows.map((x) => x.frames[0]);
    const lit = (s: Sprite) => {
      const ys: number[] = [];
      for (let y = 3; y < s.h - 3; y++) for (let x = 4; x < s.w - 4; x++) if (level(s, x, y) === 4) ys.push(y);
      return Math.min(...ys);
    };
    expect(lit(p) - lit(n)).toBe(1);
  });

  it("survives random and coerced params", () => {
    const r = rng(5);
    for (let i = 0; i < 80; i++) expect(() => uiGenerator.generate(randomParams(uiGenerator, r), KIT_PRESETS[i % 3], i)).not.toThrow();
    const p = coerceParams(uiGenerator, { kind: "nope", style: "ornate", width: -4 });
    expect(p.kind).toBe("button");
    expect(p.style).toBe("ornate");
    expect(() => uiGenerator.generate(p, KIT_PRESETS[0], 1)).not.toThrow();
  });
});

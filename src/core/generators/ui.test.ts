import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { glyph } from "../font";
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

describe("weather icons keep falling pieces apart from the cloud", () => {
  it.each(["rain", "snow"])("%s has an empty row between cloud and pieces in every kit and frame", (weather) => {
    for (const kit of KIT_PRESETS)
      for (const fr of gen("weather-icon", { weather }, kit).rows[0].frames) {
        const rows = Array.from({ length: fr.h }, (_, y) => fr.data.slice(y * fr.w, (y + 1) * fr.w).some(Boolean));
        const top = rows.indexOf(true), bottom = rows.lastIndexOf(true);
        expect(rows.slice(top, bottom + 1).includes(false)).toBe(true);
      }
  });
});

describe("MMO UI skins", () => {
  const OLD_KINDS = ["button", "panel", "slot", "bar", "icon-frame", "cursor", "tab", "checkbox", "dialog-arrow", "clock", "time-panel", "weather-icon", "season-icon", "date-panel"];
  const NEW_KINDS = ["unit-frame", "minimap-frame", "skill-bar", "chat-panel", "quest-tracker", "tooltip", "nameplate", "damage-numbers"];
  const SKINS = ["mmo-gold", "mmo-stone", "mmo-dark"];
  const frames = (r: ReturnType<typeof gen>) => r.rows.flatMap((x) => x.frames);
  type FR = { x: number; y: number; w: number; h: number };

  it("default (wood) output of every existing kind is byte-identical to before skins existed", () => {
    const h = createHash("sha1");
    for (const k of OLD_KINDS)
      for (const style of ["bevel", "ornate"])
        for (const kit of KIT_PRESETS.slice(0, 2))
          for (const row of gen(k, { style }, kit, 3).rows) for (const f of row.frames) h.update(Buffer.from(f.data)).update(`${f.w}x${f.h}`);
    expect(h.digest("hex")).toBe("28682c6cd01f652041984fe4ae8d1ed2983dd580");
  });

  it("new kinds are registered and every kind x skin x kit renders valid, deterministic sprites", () => {
    for (const k of NEW_KINDS) expect(UI_KINDS).toContain(k);
    for (const kit of KIT_PRESETS)
      for (const kind of NEW_KINDS)
        for (const skin of SKINS) {
          const a = gen(kind, { skin }, kit, 5), b = gen(kind, { skin }, kit, 5);
          expect(a).toEqual(b);
          for (const f of frames(a)) {
            expect(f.w).toBeGreaterThan(4);
            expect(f.data).toHaveLength(f.w * f.h);
            expect(valid(f)).toBe(true);
            expect(f.data.some(Boolean)).toBe(true);
          }
        }
  });

  it("expected sizes and rows", () => {
    expect([first(gen("unit-frame")).w, first(gen("unit-frame")).h]).toEqual([80, 30]);
    expect(first(gen("unit-frame", { width: 100 })).w).toBe(100);
    expect([first(gen("minimap-frame")).w, first(gen("minimap-frame")).h]).toEqual([44, 44]);
    expect(first(gen("minimap-frame", { shape: "square", width: 60 })).w).toBe(60);
    const sb = gen("skill-bar", { slots: 5 });
    expect(sb.rows.map((r) => r.name)).toEqual(["bar", "sweep"]);
    expect(first(sb).w).toBe(6 + 5 * 20 + 4 * 2);
    expect(sb.rows[1].frames).toHaveLength(9);
    const chat = first(gen("chat-panel", { width: 120, height: 64 }));
    expect([chat.w, chat.h]).toEqual([120, 64]);
    expect(gen("damage-numbers").rows[0].frames).toHaveLength(4);
    expect(first(gen("damage-numbers", { crit: true })).h).toBeGreaterThan(first(gen("damage-numbers")).h);
  });

  it("cooldown sweeps grow monotonically; params change the picture", () => {
    const sweep = gen("skill-bar").rows[1].frames;
    const changed = (s: Sprite) => s.data.reduce((a, v, i) => a + (v !== sweep[0].data[i] ? 1 : 0), 0);
    const counts = sweep.map(changed);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    expect(counts[8]).toBeGreaterThan(counts[1]);
    expect(first(gen("skill-bar", { cooldown: 5 }))).not.toEqual(first(gen("skill-bar", { cooldown: 0 })));
    expect(first(gen("unit-frame", { hp: 20 }))).not.toEqual(first(gen("unit-frame", { hp: 90 })));
    expect(first(gen("unit-frame", { portrait: "hero" }))).not.toEqual(first(gen("unit-frame", { portrait: "none" })));
    expect(first(gen("damage-numbers", { tone: "red" }))).not.toEqual(first(gen("damage-numbers", { tone: "yellow" })));
  });

  it("skins re-skin the existing bar/panel/button/slot kinds", () => {
    for (const kind of ["bar", "panel", "button", "slot", "icon-frame"]) {
      const wood = first(gen(kind));
      for (const skin of SKINS) {
        const s = first(gen(kind, { skin }));
        expect(valid(s)).toBe(true);
        expect(s).not.toEqual(wood);
      }
    }
    const bar = gen("bar", { skin: "mmo-gold", width: 48, height: 8 });
    expect(bar.rows.map((r) => r.name)).toEqual(["frame", "fill"]);
    const rect = (bar.meta as { fillRect: FR }).fillRect;
    expect(bar.rows[1].frames[0].data.filter(Boolean)).toHaveLength(rect.w * rect.h);
  });

  it("glossy fill is brighter on the shine row than on the belly", () => {
    const r = gen("bar", { skin: "mmo-gold", width: 48, height: 10, accent: "cloth2" });
    const rect = (r.meta as { fillRect: FR }).fillRect;
    const mid = rect.x + (rect.w >> 1);
    expect(level(r.rows[1].frames[0], mid, rect.y + 1)).toBeGreaterThan(level(r.rows[1].frames[0], mid, rect.y + rect.h - 1));
  });

  it("font additions leave existing glyphs unchanged", () => {
    const h = createHash("sha1").update(JSON.stringify([..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ:/-. "].map((c) => glyph(c)))).digest("hex");
    expect(h).toBe("c3c5fc370bf6ee9ac3bcb7c9b17831ff7cc08030");
    for (const ch of "+=>%!,()?") expect(glyph(ch).flat().some(Boolean)).toBe(true);
  });
});

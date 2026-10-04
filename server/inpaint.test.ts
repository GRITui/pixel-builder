import { describe, expect, it, vi } from "vitest";
import { DEFAULT_KIT } from "../src/core/kit";
import { buildLegend } from "../src/core/legend";
import { buildInpaintPrompt, inpaint, normalizeInpaint } from "./inpaint";
import { HttpError } from "./prompts";

const rows = new Array(8).fill("........");
const body = { rows, mask: { rect: { x: 2, y: 1, w: 3, h: 2 } }, prompt: "a red scarf", kit: DEFAULT_KIT };
const signal = new AbortController().signal;
const good = { rows: ["aaa", "bbb"] };

describe("normalizeInpaint", () => {
  it("accepts rect and cell masks and finds the bbox", () => {
    expect(normalizeInpaint(body).bbox).toEqual({ x: 2, y: 1, w: 3, h: 2 });
    expect(normalizeInpaint({ ...body, mask: { cells: [[1, 1], [3, 4]] } }).bbox).toEqual({ x: 1, y: 1, w: 3, h: 4 });
  });
  it("rejects bad input", () => {
    expect(() => normalizeInpaint({ ...body, mask: { rect: { x: 50, y: 50, w: 2, h: 2 } } })).toThrow(HttpError);
    expect(() => normalizeInpaint({ ...body, mask: {} })).toThrow(/mask/);
    expect(() => normalizeInpaint({ ...body, prompt: " " })).toThrow(/prompt/);
    expect(() => normalizeInpaint({ ...body, rows: [] })).toThrow(/rows/);
  });
  it("builds a prompt with the sprite, mask and a strict schema", () => {
    const r = normalizeInpaint(body);
    const p = buildInpaintPrompt(r, buildLegend(r.kit));
    expect(p.user).toContain("Mask");
    expect(p.user).toContain("a red scarf");
    expect(JSON.stringify(p.schema)).toContain("{3}");
  });
});

describe("inpaint", () => {
  it("returns valid rows from the model", async () => {
    const call = vi.fn().mockResolvedValue(good);
    expect(await inpaint(body, signal, call)).toEqual({ rect: { x: 2, y: 1, w: 3, h: 2 }, rows: good.rows });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it("repairs once after invalid chars or sizes", async () => {
    const call = vi.fn().mockResolvedValueOnce({ rows: ["aaa", "b b"] }).mockResolvedValueOnce(good);
    expect((await inpaint(body, signal, call)).rows).toEqual(good.rows);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[1][0].user).toMatch(/previous answer was invalid[\s\S]*not a legend char/);
    const call2 = vi.fn().mockResolvedValueOnce({ rows: ["aaa"] }).mockResolvedValueOnce(good);
    await inpaint(body, signal, call2);
    expect(call2.mock.calls[1][0].user).toMatch(/expected 2 rows/);
  });
  it("errors when still invalid after the repair", async () => {
    const call = vi.fn().mockResolvedValue({ rows: ["aaaa", "bbb"] });
    await expect(inpaint(body, signal, call)).rejects.toThrow(/stayed invalid/);
    expect(call).toHaveBeenCalledTimes(2);
  });
});

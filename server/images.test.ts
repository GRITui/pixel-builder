import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_KIT } from "../src/core/kit";
import { encodePng } from "../src/node/png";
import { buildUserContent } from "./claude";
import { MAX_IMAGES, collectImages, normalizeImage, setReferenceResolver, withReferenceRule } from "./images";
import { inpaint } from "./inpaint";
import { HttpError, withAnalysis } from "./prompts";
import { rigRoute } from "./rig";
import { RIVER_CRAB_WIRE } from "./rig-fixtures";

const png = (w: number, h: number) => encodePng({ width: w, height: h, rgba: new Uint8Array(w * h * 4).fill(200) });
const b64 = (w = 8, h = 8) => png(w, h).toString("base64");
const sig = new AbortController().signal;
afterEach(() => setReferenceResolver(null));

describe("normalizeImage", () => {
  it("accepts base64, data URLs and {data}", () => {
    expect(normalizeImage(b64()).media_type).toBe("image/png");
    expect(normalizeImage(`data:image/png;base64,${b64()}`).media_type).toBe("image/png");
    expect(normalizeImage({ media_type: "image/jpeg", data: b64() }).media_type).toBe("image/png"); // type comes from the bytes
  });
  it("downscales big PNGs to 1024px", () => {
    const out = normalizeImage(b64(2000, 40));
    expect(Buffer.from(out.data, "base64").readUInt32BE(16)).toBe(1024); // IHDR width
  });
  it("rejects invalid images with 400", () => {
    for (const bad of ["", "not base64!!", Buffer.from("hello world, not an image").toString("base64"), 42, null, {}]) {
      expect(() => normalizeImage(bad)).toThrow(HttpError);
    }
    try {
      normalizeImage("###");
    } catch (e) {
      expect((e as HttpError).status).toBe(400);
    }
  });
  it("rejects oversized non-PNG images with 413", () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3.5 * 1024 * 1024)]).toString("base64");
    expect(() => normalizeImage(jpeg)).toThrow(/too large/);
  });
});

describe("collectImages", () => {
  it("enforces the image count cap", async () => {
    const images = Array.from({ length: MAX_IMAGES + 1 }, () => b64());
    await expect(collectImages({ images })).rejects.toMatchObject({ status: 400 });
    expect(await collectImages({ images: images.slice(0, MAX_IMAGES) })).toHaveLength(MAX_IMAGES);
  });
  it("returns [] without images and rejects a non-array", async () => {
    expect(await collectImages({})).toEqual([]);
    await expect(collectImages({ images: "x" })).rejects.toMatchObject({ status: 400 });
  });
  it("resolves reference_ids through the injected resolver", async () => {
    await expect(collectImages({ reference_ids: ["r1"] })).rejects.toMatchObject({ status: 400 });
    const r = vi.fn().mockResolvedValue([{ media_type: "image/png", data: b64() }]);
    setReferenceResolver(r);
    expect(await collectImages({ reference_ids: ["r1", 5], project: "p" })).toHaveLength(1);
    expect(r).toHaveBeenCalledWith(["r1"], "p");
  });
});

describe("buildUserContent", () => {
  it("is the plain string without images", () => expect(buildUserContent("hi")).toBe("hi"));
  it("puts base64 image blocks before the text", () => {
    const c = buildUserContent("describe", [normalizeImage(b64())]);
    expect(c).toEqual([{ type: "image", source: { type: "base64", media_type: "image/png", data: expect.any(String) } }, { type: "text", text: "describe" }]);
  });
  it("rechecks the caps", () => {
    const one = normalizeImage(b64());
    expect(() => buildUserContent("x", Array(MAX_IMAGES + 1).fill(one))).toThrow(HttpError);
  });
});

describe("prompts", () => {
  it("adds the reference rule only with images", () => {
    expect(withReferenceRule("sys", [])).toBe("sys");
    expect(withReferenceRule("sys", [1])).toMatch(/ONLY as a reference[\s\S]*colours must come from the style kit/);
  });
  it("appends a kit analysis as data", () => {
    expect(withAnalysis("u", undefined)).toBe("u");
    expect(withAnalysis("u", { dominant: ["#aabbcc"] })).toContain("#aabbcc");
  });
});

describe("endpoints forward images", () => {
  it("rig: images + rule in every call, including the repair round", async () => {
    const broken = { ...RIVER_CRAB_WIRE, rig: { ...RIVER_CRAB_WIRE.rig, joints: RIVER_CRAB_WIRE.rig.joints.filter((j) => j.id !== "eyeL") } };
    const calls: { images?: unknown[]; system: string }[] = [];
    await rigRoute({ prompt: "a river crab", kit: DEFAULT_KIT, images: [b64()] }, sig, async (c) => {
      calls.push(c);
      return calls.length === 1 ? broken : RIVER_CRAB_WIRE;
    });
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.images).toHaveLength(1);
      expect(c.system).toContain("reference images");
    }
  });
  it("inpaint: images forwarded, repair round still works", async () => {
    const body = { rows: new Array(8).fill("........"), mask: { rect: { x: 2, y: 1, w: 3, h: 2 } }, prompt: "red scarf", kit: DEFAULT_KIT, images: [b64()] };
    const call = vi.fn().mockResolvedValueOnce({ rows: ["aaa"] }).mockResolvedValueOnce({ rows: ["aaa", "bbb"] });
    expect((await inpaint(body, sig, call)).rows).toEqual(["aaa", "bbb"]);
    expect(call.mock.calls.every((c) => c[0].images.length === 1)).toBe(true);
  });
  it("invalid images are a 400 before any model call", async () => {
    const call = vi.fn();
    await expect(inpaint({ rows: ["...."], mask: { rect: { x: 0, y: 0, w: 2, h: 1 } }, prompt: "x", kit: DEFAULT_KIT, images: ["zzz!"] }, sig, call)).rejects.toMatchObject({ status: 400 });
    expect(call).not.toHaveBeenCalled();
  });
});

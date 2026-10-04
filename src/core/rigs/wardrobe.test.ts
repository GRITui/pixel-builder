import { describe, expect, it } from "vitest";
import { KIT_PRESETS } from "../kit";
import { DIRS, renderRig, renderRigFrame, validateRig, type Attachment } from "../rig";
import type { Sprite } from "../types";
import { HUMANOID_CLIPS } from "./clips";
import { FACE, HUMANOID_RIGS, hairAttachment } from "./humanoid";
import { attachmentById } from "./index";
import { WARDROBE } from "./wardrobe";

const kit = KIT_PRESETS[0];
const normal = HUMANOID_RIGS[1];
const same = (a: Sprite, b: Sprite) => a.data.length === b.data.length && a.data.every((v, i) => v === b.data[i]);
const render = (atts: Attachment[], dir: (typeof DIRS)[number] = "down", r = normal) =>
  renderRigFrame({ rig: r, kit, attachments: atts }, dir, {});
const BASE = [hairAttachment("short"), FACE];

describe("wardrobe", () => {
  it("has the contract ids, unique, all registered", () => {
    const ids = WARDROBE.map((w) => w.attachment.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["face", "face-beard", "face-mustache", "face-glasses", "face-freckles", "face-wrinkles", "hair-bun", "hair-braids", "hair-pigtails", "hair-bob",
      "costume-overalls", "costume-dress", "costume-apron", "costume-sarong", "costume-smock", "costume-sweater",
      "straw-hat", "ngob-hat", "hat-cap", "hat-bonnet", "hat-bandana", "hat-beanie", "basket", "bag-backpack", "bag-satchel", "bag-tote"]) {
      expect(ids, id).toContain(id);
      expect(attachmentById(id), id).toBeTruthy();
    }
    expect(WARDROBE.filter((w) => w.layer === "hair").every((w) => w.attachment.id.startsWith("hair-"))).toBe(true);
  });

  it("validates on every humanoid rig", () => {
    for (const r of HUMANOID_RIGS) for (const w of WARDROBE) expect(validateRig(r, [w.attachment]), `${r.id} ${w.attachment.id}`).toEqual([]);
  });

  it("renders in every clip and direction on slim and stocky", () => {
    for (const r of [HUMANOID_RIGS[0], HUMANOID_RIGS[2]])
      for (const w of WARDROBE) {
        const clips = HUMANOID_CLIPS.slice(0, 2);
        const rows = renderRig({ rig: r, kit, attachments: [w.attachment] }, clips);
        expect(rows.length).toBe(clips.length * 4);
        for (const row of rows) for (const f of row.frames) expect(f.w).toBe(kit.sizes.character);
      }
  });

  it("each layer changes the pixels in some view versus bare", () => {
    for (const w of WARDROBE) {
      if (w.attachment.id === "face" || w.attachment.id === "hair-short" || !w.attachment.parts.length) continue;
      const changed = DIRS.some((d) => !same(render([...BASE, w.attachment], d), render(BASE, d)));
      expect(changed, w.attachment.id).toBe(true);
    }
  });

  it("is deterministic", () => {
    for (const w of WARDROBE) expect(same(render([w.attachment]), render([w.attachment]))).toBe(true);
  });

  it("hats keep the eyes visible in the down view", () => {
    const ref = render(BASE);
    const k = kit.sizes.character / normal.grid;
    const eyes = [[13, 8], [13, 9], [18, 8], [18, 9]].map(([x, y]) => [Math.round(x * k), Math.round(y * k)]);
    for (const id of ["straw-hat", "ngob-hat", "hat-cap", "hat-bonnet", "hat-bandana", "hat-beanie"]) {
      const s = render([...BASE, attachmentById(id)!.attachment]);
      for (const [x, y] of eyes) expect(s.data[y * s.w + x], `${id} ${x},${y}`).toBe(ref.data[y * ref.w + x]);
    }
  });
});

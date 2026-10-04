import { describe, expect, it } from "vitest";
import { characterGenerator } from "../generators/character";
import { defaults } from "../generators/types";
import { KIT_PRESETS } from "../kit";
import { renderRig } from "../rig";
import { AGES } from "./humanoid";
import { clipById, rigById, withHumanoidDefaults } from "./index";

const gen = (p: object, kit = KIT_PRESETS[0]) => characterGenerator.generate({ ...defaults(characterGenerator), ...p }, kit, 1);
const flat = (g: ReturnType<typeof gen>) => JSON.stringify(g.rows.map((r) => r.frames.map((f) => Array.from(f.data))));

describe("male/female cues", () => {
  for (const kit of KIT_PRESETS)
    for (const age of AGES)
      it(`generator differs by sex: ${age} / ${kit.id}`, () => {
        expect(flat(gen({ sex: "male", age }, kit))).not.toBe(flat(gen({ sex: "female", age }, kit)));
      });

  it("rig cores differ by sex and female gets face-female by default", () => {
    for (const age of AGES) {
      const render = (sex: string) => {
        const rig = rigById(`human-${sex}-${age}`)!.rig;
        const atts = withHumanoidDefaults(rig, []);
        expect(atts.some((a) => a.id === (sex === "female" ? "face-female" : "face"))).toBe(true);
        const slots = { skin: "skin", hair: "hair", top: "cloth", bottom: "leather", boots: "wood", accent: "cloth2", helm: "metal" } as const;
        const clip = clipById("idle", "humanoid")!.clip;
        return JSON.stringify(renderRig({ rig, kit: KIT_PRESETS[2], slots, attachments: atts }, [clip]).map((r) => r.frames.map((f) => Array.from(f.data))));
      };
      expect(render("male")).not.toBe(render("female"));
    }
  });
});

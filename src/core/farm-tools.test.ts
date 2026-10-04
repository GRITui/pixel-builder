import { describe, expect, it } from "vitest";
import { KIT_PRESETS } from "./kit";
import { clipFrames, renderRig, validateRig } from "./rig";
import { objectGenerator, TOOL_KINDS } from "./generators/object";
import { uiGenerator, WEATHERS, SEASONS, WEEKDAYS } from "./generators/ui";
import { defaults } from "./generators/types";
import { attachmentById, clipById, rigById } from "./rigs";
import { HUMANOID_RIGS } from "./rigs/humanoid";
import { TOOL_ATTACHMENTS } from "./rigs/tools";

const obj = (kind: string, kit = KIT_PRESETS[0], seed = 1) => objectGenerator.generate({ ...defaults(objectGenerator), kind } as never, kit, seed);
const ui = (p: object, kit = KIT_PRESETS[0], seed = 1) => uiGenerator.generate({ ...defaults(uiGenerator), ...p } as never, kit, seed);

describe("tool icons", () => {
  for (const kit of KIT_PRESETS)
    for (const kind of TOOL_KINDS)
      it(`${kind} has icon + use rows in ${kit.id}`, () => {
        const r = obj(kind, kit);
        expect(r.rows.map((x) => x.name)).toEqual(["icon", "use"]);
        expect(r.rows[0].frames).toHaveLength(1);
        expect(r.rows[1].frames.length).toBeGreaterThanOrEqual(3);
        expect(r.rows[1].frames.length).toBeLessThanOrEqual(5);
        for (const f of r.rows.flatMap((x) => x.frames)) {
          expect(f.w).toBe(kit.sizes.object);
          expect(f.data.some(Boolean)).toBe(true);
        }
        expect(obj(kind, kit, 3)).toEqual(obj(kind, kit, 3));
      });
  it("existing axe stays a single idle row", () => {
    expect(obj("axe").rows.map((x) => x.name)).toEqual(["idle"]);
  });
});

describe("held tools and clips", () => {
  for (const a of TOOL_ATTACHMENTS)
    it(`${a.id} validates on every humanoid rig and has a tool tip`, () => {
      expect(attachmentById(a.id)).toBeTruthy();
      expect(a.joints?.some((j) => j.id === "toolTip")).toBe(true);
      for (const rig of HUMANOID_RIGS) expect(validateRig(rig, [a])).toEqual([]);
    });
  const pairs: [string, string][] = [["axe", "chop"], ["watering-can", "water"], ["pickaxe", "mine"], ["hammer", "mine"], ["fishing-rod", "fish"]];
  for (const [tool, clip] of pairs)
    it(`${clip} renders on humanoid-normal with ${tool}`, () => {
      const rig = rigById("humanoid-normal")!.rig;
      const kit = KIT_PRESETS[0];
      const c = clipById(clip, "humanoid")!.clip;
      const a = attachmentById(tool)!.attachment;
      const withTool = renderRig({ rig, kit, attachments: [a] }, [c]);
      const bare = renderRig({ rig, kit }, [c]);
      expect(withTool).toHaveLength(4);
      expect(JSON.stringify(withTool)).not.toBe(JSON.stringify(bare));
      expect(withTool.find((r) => r.name.endsWith("down"))!.frames.length).toBe(clipFrames(c, "down").length);
    });
});

describe("farm HUD", () => {
  it("renders every widget in every kit", () => {
    for (const kit of KIT_PRESETS) {
      expect(ui({ kind: "clock", hour: 6 }, kit).rows[0].frames[0].w).toBe(16);
      expect(ui({ kind: "time-panel", hour: 7, minute: 5 }, kit).rows[0].frames.length).toBe(2);
      for (const weather of WEATHERS) expect(ui({ kind: "weather-icon", weather }, kit).rows[0].frames).toHaveLength(2);
      for (const season of SEASONS) expect(ui({ kind: "season-icon", season }, kit).rows[0].frames[0].w).toBe(16);
      for (const weekday of WEEKDAYS) expect(ui({ kind: "date-panel", weekday, day: 31, season: "fall" }, kit).rows[0].frames[0].data.some(Boolean)).toBe(true);
    }
  });
  it("params change the output deterministically", () => {
    expect(ui({ kind: "clock", hour: 3 })).not.toEqual(ui({ kind: "clock", hour: 9 }));
    expect(ui({ kind: "time-panel", hour: 1, minute: 2 })).not.toEqual(ui({ kind: "time-panel", hour: 1, minute: 3 }));
    expect(ui({ kind: "weather-icon", weather: "rain" })).not.toEqual(ui({ kind: "weather-icon", weather: "snow" }));
    expect(ui({ kind: "date-panel", day: 5 })).not.toEqual(ui({ kind: "date-panel", day: 6 }));
    expect(ui({ kind: "date-panel", day: 5 })).toEqual(ui({ kind: "date-panel", day: 5 }));
  });
});

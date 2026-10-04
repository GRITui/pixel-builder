import { describe, expect, it } from "vitest";
import { KIT_PRESETS } from "../kit";
import { decodeIndex } from "../palette";
import { clipFrames, renderRig } from "../rig";
import { GENERATORS } from "../generators";
import { defaults } from "../generators/types";
import { HUMANOID_CLIPS, HUMANOID_SNAPPY_CLIPS } from "./clips";
import { HUMANOID_RIGS } from "./humanoid";
import { attachmentById, clipById, rigById } from "./index";
import { HUMANOID_SIDE_RIG } from "./side";

const normal = HUMANOID_RIGS[1];
const byId = (id: string) => HUMANOID_CLIPS.find((c) => c.id === id)!;
const kitDefault = KIT_PRESETS.find((k) => k.id === "kit-default")!;
const kitRich = KIT_PRESETS.find((k) => k.id === "kit-hd-rich")!;

describe("snappy clips (#47)", () => {
  it("are selectable by id and have more frames than the base clip", () => {
    for (const id of ["attack", "chop", "mine"]) {
      const snappy = clipById(`${id}-snappy`, "humanoid")!.clip;
      for (const v of ["side", "down", "up"] as const) expect(clipFrames(snappy, v).length).toBeGreaterThan(clipFrames(byId(id), v).length);
    }
    expect(HUMANOID_SNAPPY_CLIPS.map((c) => c.id)).toEqual(["attack-snappy", "chop-snappy", "mine-snappy"]);
    expect(clipById("jump-snappy")).toBeTruthy();
  });

  it("leave standard kits byte-identical and switch rich kits to the snappy frames", () => {
    for (const id of ["attack", "chop", "mine"]) {
      const base = renderRig({ rig: normal, kit: kitDefault }, [byId(id)]);
      const snappy = renderRig({ rig: normal, kit: kitDefault }, [{ ...byId(id), rich: undefined }]);
      expect(base).toEqual(snappy);
      const rich = renderRig({ rig: normal, kit: kitRich }, [byId(id)]);
      const named = renderRig({ rig: normal, kit: kitRich }, [clipById(`${id}-snappy`)!.clip]);
      expect(rich.map((r) => r.frames.length)).toEqual(named.map((r) => r.frames.length));
      expect(rich[0].frames.length).toBeGreaterThan(base[0].frames.length);
    }
  });

  it("are deterministic and keep the canvas size", () => {
    const clips = HUMANOID_SNAPPY_CLIPS;
    const a = renderRig({ rig: normal, kit: kitDefault }, clips);
    expect(a).toEqual(renderRig({ rig: normal, kit: kitDefault }, clips));
    for (const row of a) for (const f of row.frames) expect(f.w).toBe(kitDefault.sizes.character);
  });

  it("jump-snappy renders on the side rig", () => {
    const kit = KIT_PRESETS.find((k) => k.id === "kit-side")!;
    const rows = renderRig({ rig: HUMANOID_SIDE_RIG, kit }, [clipById("jump-snappy")!.clip]);
    expect(rows.map((r) => r.frames.length)).toEqual([6, 6]);
  });
});

describe("knight trim", () => {
  it("adds accent colours to the plain metal knight", () => {
    const kit = KIT_PRESETS.find((k) => k.id === "kit-side")!;
    const distinct = (extra: string[]) => {
      const atts = ["helmet", "sword", ...extra].map((id) => attachmentById(id)!.attachment);
      const rows = renderRig({ rig: rigById("humanoid-side")!.rig, kit, slots: { top: "metal", bottom: "metal" }, attachments: atts }, [clipById("idle")!.clip]);
      // pixels that are neither metal, skin, hair nor outline
      return rows[0].frames[0].data.filter((v) => v && !["metal", "skin", "hair", "ink"].includes(decodeIndex(v)?.mat ?? "ink")).length;
    };
    expect(distinct(["knight-trim"])).toBeGreaterThan(distinct([]) + 20);
  });
});

describe("tool icons", () => {
  it("outline their use frames too", () => {
    const g = GENERATORS.find((x) => x.id === "object")!;
    for (const kind of ["hoe", "watering-can", "pickaxe", "tool-axe", "sickle", "hammer", "fishing-rod", "seed-bag"]) {
      const r = g.generate({ ...defaults(g), kind } as never, kitDefault, 1);
      for (const row of r.rows)
        for (const s of row.frames) {
          // every silhouette-edge pixel is outline-dark (effects included)
          const at = (x: number, y: number) => (x < 0 || y < 0 || x >= s.w || y >= s.h ? 0 : s.data[y * s.w + x]);
          for (let y = 0; y < s.h; y++)
            for (let x = 0; x < s.w; x++) {
              const v = at(x, y);
              if (!v || (at(x - 1, y) && at(x + 1, y) && at(x, y - 1) && at(x, y + 1))) continue;
              const d = decodeIndex(v);
              expect(!d || d.mat === "ink" || d.level <= 1, `${kind}/${row.name} ${x},${y}`).toBe(true);
            }
        }
    }
  });
});

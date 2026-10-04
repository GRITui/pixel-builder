import { describe, expect, it } from "vitest";
import { packById } from "../../node/packs";
import { KIT_PRESETS } from "../kit";
import { PALETTE_SIZE } from "../palette";
import { DIRS8, renderRig, validateRig } from "../rig";
import { CLIPS, rigById } from "./index";
import { BEAST_CLIPS, BEAST_RIGS, MONSTER_CLIPS, MONSTER_IDS, MONSTER_JOINTS, MONSTER_RIGS, UNDEAD_CLIPS, UNDEAD_RIGS } from "./monsters";

const CLIP_IDS = ["idle", "walk", "attack", "hurt", "die"];
const FAMILIES = [
  { rigs: MONSTER_RIGS, clips: MONSTER_CLIPS },
  { rigs: BEAST_RIGS, clips: BEAST_CLIPS },
  { rigs: UNDEAD_RIGS, clips: UNDEAD_CLIPS },
];
const opaque = (f: { data: ArrayLike<number> }) => Array.from(f.data).filter((i) => i > 0).length;

describe("monster rigs", () => {
  it("registers every variant with the five clips", () => {
    expect(MONSTER_IDS).toEqual([
      "monster-mushroom-red", "monster-mushroom-brown", "monster-mushroom-poison", "monster-mushroom-king",
      "monster-slime-green", "monster-slime-blue", "monster-slime-fire", "monster-slime-metal",
      "monster-plant", "monster-bat", "monster-wolf", "monster-skeleton",
    ]);
    for (const id of MONSTER_IDS) expect(rigById(id), id).toBeDefined();
    for (const f of FAMILIES) expect(f.clips.map((c) => c.id)).toEqual(CLIP_IDS);
  });
  for (const f of FAMILIES)
    for (const rig of f.rigs) {
      it(`${rig.id} validates and its clips only move its joints`, () => {
        expect(validateRig(rig)).toEqual([]);
        const ids = new Set(rig.joints.map((j) => j.id));
        if (f.rigs === MONSTER_RIGS) for (const j of MONSTER_JOINTS) expect(ids.has(j)).toBe(true);
        for (const c of f.clips)
          for (const frames of Array.isArray(c.frames) ? [c.frames] : Object.values(c.frames))
            for (const pose of frames) for (const j of Object.keys(pose)) expect(ids.has(j) || ["toolTip", "pole", "rodLine"].includes(j), `${c.id}:${j}`).toBe(true);
      });
    }
  it("renders every clip in 8 directions, in range and deterministic; hurt flashes, die ends empty", () => {
    for (const kit of KIT_PRESETS)
      for (const id of MONSTER_IDS) {
        const dirs = kit.id === "kit-default" ? 8 : 4;
        const r = rigById(id)!;
        const clips = CLIPS.filter((c) => c.family === r.family).map((c) => c.clip);
        const rows = renderRig({ rig: r.rig, kit }, clips, { directions: dirs });
        expect(rows).toHaveLength(clips.length * (dirs === 8 ? DIRS8.length : 4));
        for (const row of rows) {
          expect(row.frames.length).toBeGreaterThan(0);
          for (const f of row.frames) expect(f.data.every((i) => i >= 0 && i < PALETTE_SIZE)).toBe(true);
        }
        expect(renderRig({ rig: r.rig, kit }, clips, { directions: dirs })).toEqual(rows);
        const die = rows.find((x) => x.name === "die-down")!;
        expect(opaque(die.frames[die.frames.length - 1])).toBe(0);
        expect(opaque(die.frames[2])).toBeGreaterThan(0);
        const idle = rows.find((x) => x.name === "idle-down")!.frames[0];
        const hurt = rows.find((x) => x.name === "hurt-down")!.frames[0];
        expect(Array.from(hurt.data)).not.toEqual(Array.from(idle.data));
      }
  }, 120_000);
  it("pack monsters-v1 resolves", () => {
    const pack = packById("monsters-v1")!;
    expect(pack.entries).toHaveLength(12);
    for (const e of pack.entries) {
      expect("rig" in e && rigById(e.rig)).toBeTruthy();
      expect((e as { clips: string[] }).clips).toEqual(CLIP_IDS);
    }
  });
});

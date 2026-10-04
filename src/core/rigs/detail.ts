// Rich-mode micro-detail for humanoids (kit.detail === "rich"). The rig renderer calls
// `richParts` before painting (extra declarative parts: eye catchlights, nose, boot soles) and
// `richShade` after (shade passes on pixels that are already painted: contact shadows, cloth folds,
// hair clumps and specular band, rim light, wardrobe extras). Shading existing pixels instead of
// painting new colours keeps every detail correct under any costume, hat or material choice.
//
// Detail is authored on the 32 design grid and only runs from 24px up: at 16px (kit-gameboy) there is
// no room for 1px features, so rich degrades to sel-out + anti-aliasing there.
import type { Painter } from "../painter";
import type { Material } from "../palette";
import type { PartDef, RigDef, View } from "../rig";

export const RICH_MIN_SIZE = 24;

export function isHumanoidRig(rig: RigDef): boolean {
  const ids = new Set(rig.joints.map((j) => j.id));
  return ["hip", "chest", "neck", "head", "elbowL", "kneeL", "footL"].every((j) => ids.has(j));
}

const ageOf = (rig: RigDef) => /(baby|kid|young-adult|senior|elder)$/.exec(rig.id)?.[1] ?? "young-adult";

type BoxPart = Extract<PartDef, { kind: "box" }>;
const box = (id: string, o: Omit<BoxPart, "id" | "kind" | "joint"> & { joint?: string }): PartDef => ({ id, kind: "box", joint: "head", ...o }) as PartDef;

const zOf = (p: PartDef | undefined, view: View, fallback: number): number => {
  if (!p) return fallback;
  const z = p.z as number | Partial<Record<View, number>>;
  return typeof z === "number" ? z : (z[view] ?? z.down ?? fallback);
};

/** Extra parts for rich humanoids. `parts` is the merged rig + attachment part map. */
export function richParts(rig: RigDef, parts: Map<string, PartDef>, size: number): PartDef[] {
  if (size < RICH_MIN_SIZE || !isHumanoidRig(rig)) return [];
  const out: PartDef[] = [];
  const view = (id: string): View => (id.toLowerCase().endsWith("side") ? "side" : "down");

  // Eyes: dark iris + a pale catchlight/sclera pixel on the inner side, replacing the plain 1x2 ink eye.
  for (const id of ["eyeL", "eyeR", "eyeSide", "face-eyeL", "face-eyeR", "face-eyeSide"]) {
    const e = parts.get(id) as BoxPart | undefined;
    if (!e || e.kind !== "box") continue;
    const v = view(id);
    const left = id.endsWith("L"), side = v === "side";
    const z = zOf(e, v, 7);
    const inner = side ? 1 : left ? 1 : -1;
    const dx = e.dx ?? 0, dy = e.dy ?? 0;
    out.push(
      box(id, { dx, dy: dy + 0.4, w: 1, h: 1.6, slot: "ink", tone: -2, z, views: e.views }),
      box(`${id}-lid`, { dx, dy, w: 1, h: 1, slot: "leather", tone: -1, z: z + 0.01, views: e.views }),
      box(`${id}-white`, { dx: dx + inner, dy: dy + 1, w: 1, h: 1, slot: "ui", tone: 0, z, views: e.views }),
    );
    // the white sits beside the iris at the same height as the lower pixel
    void left;
  }

  // Nose: one shade pixel between the eyes and mouth (front), a protruding bridge in profile.
  const eyeZ = zOf(parts.get("eyeL") ?? parts.get("face-eyeL"), "down", 7);
  if (parts.has("eyeL") || parts.has("face-eyeL")) {
    out.push(
      box("rich-nose", { dx: -0.5, dy: 1, w: 1, h: 1, slot: "skin", tone: -1, z: eyeZ - 0.2, views: ["down"] }),
      box("rich-nose-side", { dx: 6, dy: 1, w: 1, h: 1, slot: "skin", tone: -1, z: eyeZ - 0.2, views: ["side"] }),
    );
  }

  // Boot soles: a darker bottom row on every boot (also in the far leg's boot).
  for (const id of ["bootL", "bootR", "bootRfar"]) {
    const b = parts.get(id) as BoxPart | undefined;
    if (!b || b.kind !== "box") continue;
    out.push(box(`${id}-sole`, { joint: b.joint, dx: b.dx ?? 0, dy: (b.dy ?? 0) + b.h - 1, w: b.w, h: 1, slot: b.slot, tone: (b.tone ?? 0) - 2, z: zOf(b, "down", 1.5) + 0.05, views: b.views }));
  }
  return out;
}

export interface ShadeCtx {
  rig: RigDef;
  parts: Map<string, PartDef>;
  slots: Record<string, Material>;
  J: Record<string, [number, number]>;
  view: View;
  flip: boolean;
  size: number;
}

const BODY = /^(torso|hips|upperArm|foreArm|hand|leg|boot|arm|head)/;

/** Which part pairs get a 1px darker seam where the nearer one overlaps the farther. */
export const seamAllowed = (behind: string, front: string): boolean => {
  if (!BODY.test(behind) && behind !== "torsoSide" && behind !== "hipsSide") return false;
  if (/^(eye|face|fem-|rich-|beard|mustache|glasses|wrinkle)/.test(front)) return false;
  if (/^hand/.test(behind)) return false;
  // limbs of the same chain (sleeve over sleeve) are one form
  if (/^(upperArm|foreArm|hand)/.test(behind) && /^(upperArm|foreArm|hand)/.test(front)) return false;
  return true;
};

/** Post-paint shading passes. Order matters: seams first, rim light last. */
export function richShade(P: Painter, c: ShadeCtx): void {
  if (c.size < RICH_MIN_SIZE || !isHumanoidRig(c.rig)) return;
  const k = c.size / c.rig.grid;
  const age = ageOf(c.rig);
  const rect = (joint: string, dx: number, dy: number, w: number, h: number) => {
    const [x, y] = c.J[joint];
    const wp = Math.max(1, Math.round(w * k));
    const left = c.flip ? c.size - (x + dx) * k - wp : (x + dx) * k;
    return [Math.round(left), Math.round((y + dy) * k), wp, Math.max(1, Math.round(h * k))] as const;
  };
  const shade = (r: readonly [number, number, number, number], d: number, only?: Material) => P.shade(r[0], r[1], r[2], r[3], d, only);
  const has = (id: string) => c.parts.has(id);
  const side = c.view === "side";
  const sgn = P.lightSide === 0 ? -1 : P.lightSide; // x side the light comes from (+1 right)
  const lightDx = (w: number) => (sgn < 0 ? -w : 0); // helper: start of a band on the lit side

  // 1. seams where limbs overlap the torso, the head overlaps the shoulders, a brim overlaps the brow
  P.separate(seamAllowed);

  // 2. cloth folds: a short crease across each elbow and knee
  const elbows = side ? ["elbowL"] : ["elbowL", "elbowR"];
  for (const j of elbows) shade(rect(j, -1.2, 0.2, 2.4, 1), -1);
  if (age !== "baby") for (const j of side ? ["kneeL"] : ["kneeL", "kneeR"]) shade(rect(j, -1.4, 0.2, 2.8, 1), -1);

  // 3. hair: specular band on the lit side of the crown, a few clump lines below it
  const hair = c.slots.hair ?? "hair";
  if (c.view === "down") {
    shade(rect("head", lightDx(4) + (sgn < 0 ? -0.5 : 0.5), -6.4, 4, 1), 2, hair);
    shade(rect("head", sgn < 0 ? -5 : 3, -5.4, 2, 1), 1, hair);
    shade(rect("head", -1.5, -5.4, 1, 2), -1, hair);
    shade(rect("head", 2.5, -5.4, 1, 2), -1, hair);
  } else if (side) {
    shade(rect("head", -3.5, -6, 4, 1), 2, hair);
    shade(rect("head", -6, -4.4, 2, 1), 1, hair);
    shade(rect("head", -4.5, -3, 1, 4), -1, hair);
    shade(rect("head", -2, -4, 1, 3), -1, hair);
  } else {
    shade(rect("head", lightDx(4) + (sgn < 0 ? -0.5 : 0.5), -5.4, 4, 1), 2, hair);
    shade(rect("head", -4, -3.4, 1, 4), -1, hair);
    shade(rect("head", 3, -3.4, 1, 4), -1, hair);
  }

  // 3b. skin: forehead catchlight on the lit side, a lit cheek, shaded jaw under the hair line
  const skin = c.slots.skin ?? "skin";
  if (c.view === "down") {
    shade(rect("head", sgn < 0 ? -4.5 : 2.5, -2.6, 2, 1), 1, skin);
    shade(rect("head", sgn < 0 ? -5 : 4, 2, 1, 2), 1, skin);
    shade(rect("head", -4, 4, 8, 1), -1, skin);
  } else if (side) shade(rect("head", 4, -2.6, 2, 1), 1, skin);

  // 3c. torso drape: two soft crease lines on the garment, and a darker underside on the sleeves
  const top = c.slots.top ?? "cloth";
  if (c.view === "down" || c.view === "up") {
    shade(rect("chest", -2.6, 2.4, 1, 3), -1, top);
    shade(rect("chest", 1.8, 3, 1, 3), -1, top);
  } else shade(rect("chest", -0.5, 2.4, 1, 3), -1, top);
  for (const j of elbows) shade(rect(j, -0.5, -1.4, 1, 1.4), 1, top);

  // 4. wardrobe extras (only where the costume part exists)
  if (c.view === "down") {
    if (has("ov-pocket")) shade(rect("chest", -2, 2.4, 4, 1), 1);
    if (has("ov-bib")) {
      shade(rect("chest", -3.5, 0.2, 1, 6), -1);
      shade(rect("chest", 2.5, 0.2, 1, 6), -1);
    }
    if (has("dr-hem")) {
      shade(rect("hip", -2.6, 0.8, 1, 3), -1);
      shade(rect("hip", 2.4, 0.8, 1, 3), -1);
      shade(rect("hip", -0.5, 1.6, 1, 2), 1);
    }
    if (has("ap-tie")) {
      shade(rect("chest", 3.6, 3.4, 1, 2), -1);
      shade(rect("chest", -4.8, 3.4, 1, 2), -1);
    }
    if (has("sm-body")) shade(rect("chest", -3.4, 5, 1, 4), -1);
  }

  // 5. rim light on the shadow-side edge
  P.rim();
}

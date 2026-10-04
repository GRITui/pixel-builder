// Fish rigs (Farming Kit, issue #28): a pond/farm fish seen from above. The
// three views are the same fish heading down / right / up the screen ("left"
// mirrors "right"), so a swim clip is one tail sweep expressed per view.
// Geometry is authored in local (u along the body, v across it) and mapped to
// each view, so the views always agree. Joint names are the contract in joints.ts.
import type { Clip, PartDef, RigDef, View } from "../rig";
import type { Material } from "../palette";

type V2 = [number, number];

/** Fish joint contract (kept here; joints.ts is shared). */
export const FISH_JOINTS = ["body", "head", "tail", "finTop", "finL", "finR"] as const;

interface Spec {
  id: string; name: string;
  body: Material; fin: Material; spot?: Material;
  /** Body, head and tail-fin half sizes along (u) and across (v) the body. */
  bru: number; brv: number; hru: number; hrv: number; tru: number; trv: number;
  /** Pectoral fin reach across the body. */
  fin_v: number;
  whiskers?: boolean;
  /** Baby (fry): stubbier, head and eyes large for the body. */
  baby?: boolean;
}

const C = 16;
const toView = (view: View, u: number, v: number): V2 => (view === "side" ? [C + u, C + v] : view === "down" ? [C + v, C + u] : [C + v, C - u]);
/** A local (du, dv) offset as the joint offset [dx, dy] for a view. */
const off = (view: View, du: number, dv: number): V2 => (view === "side" ? [du, dv] : view === "down" ? [dv, du] : [dv, -du]);

/** Spot layouts per variant: [u, v, ru, rv] on the body (fractions of the body radii). */
const SPOTS: Record<number, [number, number, number, number][]> = {
  0: [[-0.25, -0.1, 0.38, 0.45], [0.45, 0.2, 0.25, 0.4]],
  1: [[0.05, 0.05, 0.5, 0.5]],
  2: [[-0.5, -0.25, 0.28, 0.4], [0.25, 0.25, 0.3, 0.4], [-0.1, 0.5, 0.15, 0.2]],
  3: [[0.15, -0.15, 0.55, 0.3], [-0.55, 0.3, 0.2, 0.3]],
};

function build(s: Spec, variant = 0): RigDef {
  const bodyU = 1, headU = bodyU + s.bru * 0.72, tailU = bodyU - s.bru * 0.85;
  const front = headU - 0.5 + s.hru, back = tailU - 1.2 - 2 * s.tru - 1.2;
  const uc = (front + back) / 2; // centre the fish on the canvas along its heading in every view
  const U = (u: number) => u - uc;

  const jd = (id: string, parent: string | null, u: number, v: number) => ({
    id, parent, rest: { down: toView("down", U(u), v), side: toView("side", U(u), v), up: toView("up", U(u), v) },
  });
  const joints = [
    jd("body", null, bodyU, 0),
    jd("head", "body", headU, 0),
    jd("tail", "body", tailU, 0),
    jd("finTop", "body", bodyU - 0.5, 0),
    jd("finL", "body", bodyU + 1.2, -s.fin_v),
    jd("finR", "body", bodyU + 1.2, s.fin_v),
  ];

  const parts: PartDef[] = [];
  const VIEWS: View[] = ["down", "side", "up"];
  /** An ellipse given in local axes, emitted once per view. */
  const E = (id: string, joint: string, du: number, dv: number, ru: number, rv: number, slot: string, tone: number, z: number) => {
    for (const view of VIEWS) {
      const [dx, dy] = off(view, du, dv);
      const side = view === "side";
      parts.push({ id: `${id}_${view}`, kind: "ellipse", joint, dx, dy, rx: side ? ru : rv, ry: side ? rv : ru, slot, tone, z, views: [view] });
    }
  };
  /** A 1px detail (eye), local offset per view. */
  const dot = (id: string, joint: string, du: number, dv: number, z: number) => {
    for (const view of VIEWS) {
      const [dx, dy] = off(view, du, dv);
      parts.push({ id: `${id}_${view}`, kind: "box", joint, dx, dy, w: 1, h: 1, slot: "ink", tone: -4, z, views: [view] });
    }
  };

  // pectoral fins: small swept-back leaves tucked against the flank, under the body
  for (const [id, sgn] of [["finL", -1], ["finR", 1]] as const) {
    E(`${id}Tip`, id, -0.9, sgn * 0.6, s.baby ? 1.6 : 2.3, s.baby ? 0.8 : 1.1, "fin", -1, 1.1);
  }
  // tail: a slim stalk (bends with the joint) ending in a forked fan, two lobes with a notch between
  const lu = -(s.tru + 1.2), lv = s.trv * 0.45;
  E("peduncle", "tail", -1.2, 0, s.baby ? 2.4 : 3, s.baby ? 1 : 1.3, "body", 0, 1.5);
  E("tailBase", "tail", lu + s.tru * 0.5, 0, s.tru * 0.5, lv * 0.7, "fin", -1, 1);
  for (const sgn of [-1, 1]) E(`tailLobe${sgn}`, "tail", lu, sgn * lv, s.tru, s.trv * 0.3 + 0.4, "fin", -1, 1);
  E("body", "body", 0, 0, s.bru, s.brv, "body", 0, 2);
  if (s.spot) {
    for (const [u, v, ru, rv] of SPOTS[variant] ?? []) E(`spot${parts.length}`, "body", u * s.bru, v * s.brv, ru * s.bru, rv * s.brv, "spot", 0, 2.5);
    if (variant === 0 || variant === 2) E("capSpot", "head", -0.4, 0, s.hru * 0.55, s.hrv * 0.75, "spot", 0, 2.6);
  }
  E("head", "head", -0.5, 0, s.hru, s.hrv, "body", 0, 2.2);
  // dorsal ridge seen from above: a darker stripe along the spine
  E("finTopStripe", "finTop", -0.5, 0, s.bru * 0.6, 0.6, "fin", -1, 2.4);
  if (s.whiskers) for (const sgn of [-1, 1]) {
    E(`whiskerA${sgn}`, "head", s.hru * 0.5 + 1.4, sgn * (s.hrv * 0.6 + 1), 2.2, 0.45, "ink", 1, 2.1);
    E(`whiskerB${sgn}`, "head", s.hru * 0.1, sgn * (s.hrv + 1), 1.4, 0.45, "ink", 1, 2.1);
  }
  for (const sgn of [-1, 1]) dot(`eye${sgn}`, "head", s.hru * 0.4, sgn * s.hrv * 0.6, 9);

  return {
    id: s.id, name: s.name, grid: 32, joints, parts,
    slots: { body: s.body, fin: s.fin, spot: s.spot ?? s.body, ink: "ink" },
  };
}

const ADULT: Omit<Spec, "id" | "name" | "body" | "fin"> = { bru: 6.8, brv: 3.8, hru: 3.4, hrv: 2.8, tru: 3, trv: 5.4, fin_v: 4.6 };
const BABY: Omit<Spec, "id" | "name" | "body" | "fin"> = { bru: 4.6, brv: 2.6, hru: 2.6, hrv: 2.2, tru: 2, trv: 3.8, fin_v: 3.2, baby: true };

const SPECIES: Spec[] = [
  { id: "fish-carp", name: "Carp", body: "gold", fin: "gold", spot: "cloth2", ...ADULT },
  { id: "fish-catfish", name: "Catfish", body: "stone", fin: "stone", whiskers: true, ...ADULT, hru: 3.4, hrv: 3.5, brv: 3.2, tru: 2.4, trv: 4.4 },
  { id: "fish-carp-baby", name: "Carp fry", body: "gold", fin: "gold", spot: "cloth2", ...BABY },
  { id: "fish-catfish-baby", name: "Catfish fry", body: "stone", fin: "stone", whiskers: true, ...BABY },
];

export const FISH_RIGS: RigDef[] = SPECIES.map((s) => build(s));

/** One kind by short name ("carp", "catfish") with a variant 0..3 (spot layout); `baby` gives the fry. */
export function fishRig(kind: string, variant = 0, baby = false): RigDef {
  const id = `fish-${kind}${baby ? "-baby" : ""}`;
  const spec = SPECIES.find((s) => s.id === id) ?? SPECIES[0];
  return build(spec, Math.max(0, Math.min(3, Math.round(variant))));
}

/** A pose per view from local (du along, dv across) offsets. */
const pose = (spec: Record<string, V2>): Clip["frames"] => ({
  side: [Object.fromEntries(Object.entries(spec).map(([j, [du, dv]]) => [j, off("side", du, dv)]))],
  down: [Object.fromEntries(Object.entries(spec).map(([j, [du, dv]]) => [j, off("down", du, dv)]))],
  up: [Object.fromEntries(Object.entries(spec).map(([j, [du, dv]]) => [j, off("up", du, dv)]))],
});
/** Join single-frame per-view poses into a per-view clip. */
const clipOf = (id: string, fps: number, frames: Record<string, V2>[]): Clip => {
  const per = frames.map((f) => pose(f) as Record<View, Record<string, V2>[]>);
  return { id, fps, frames: { side: per.map((p) => p.side[0]), down: per.map((p) => p.down[0]), up: per.map((p) => p.up[0]) } };
};

export const FISH_CLIPS: Clip[] = [
  clipOf("idle", 2, [
    { tail: [0, -0.7], finL: [-0.4, 0.3], finR: [-0.4, -0.3] },
    { tail: [0, 0.7], finL: [0.3, -0.2], finR: [0.3, 0.2] },
  ]),
  clipOf("swim", 8, [
    { tail: [0, 2], head: [0, -0.5], finL: [-0.8, 0.6], finR: [-0.8, -0.6] },
    { tail: [0, 0], finL: [0, 0], finR: [0, 0] },
    { tail: [0, -2], head: [0, 0.5], finL: [-0.8, 0.6], finR: [-0.8, -0.6] },
    { tail: [0, 0], finL: [0, 0], finR: [0, 0] },
  ]),
];

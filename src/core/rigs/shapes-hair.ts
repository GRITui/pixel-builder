// Shaped hair for rich / 48px characters (issue #38): see shapes.ts for the gate.
import type { Attachment, PartDef } from "../rig";

type HView = NonNullable<PartDef["views"]>;
const hE = (id: string, dx: number, dy: number, rx: number, ry: number, views: HView, o: { z?: number; tone?: number; slot?: string; flat?: number } = {}): PartDef =>
  ({ id, kind: "ellipse", joint: "head", dx, dy, rx, ry, slot: o.slot ?? "hair", z: o.z ?? 5, tone: o.tone, flat: o.flat, views }) as PartDef;
const hB = (id: string, dx: number, dy: number, w: number, h: number, views: HView, o: { z?: number; tone?: number; slot?: string } = {}): PartDef =>
  ({ id, kind: "box", joint: "head", dx, dy, w, h, slot: o.slot ?? "hair", z: o.z ?? 5, tone: o.tone, views }) as PartDef;

/**
 * Shaped hair: the plain ellipse crown gets a cowlick, a ragged fringe, tapered side locks and
 * clump strokes; each style swaps its rectangular tails for tapered strands. Added after the
 * base hair attachment so same-id parts replace it and the face window stays untouched.
 */
export function shapedHair(style: string, fringe: -1 | 0 | 1 = 0): Attachment {
  if (style === "bald") return { id: "hair-shaped-bald", name: "Hair shapes (bald)", parts: [] };
  const f = fringe * 0.6;
  const P: PartDef[] = [];
  if (style !== "spiky") {
    P.push(
      // tapered side locks instead of straight blocks
      hE("hair-tuftL", -6.5, 1.4, 1.5, 3.5, ["down"]),
      hE("hair-tuftR", 6.5, 1.4, 1.5, 3.5, ["down"]),
      // ragged fringe: four locks of different length along the hairline
      hE("hair-lock0", -4.7 + f, -3.8, 1.9, 1.4, ["down"], { z: 6.2 }),
      hE("hair-lock1", -1.7 + f, -3.5, 1.5, 1.9, ["down"], { z: 6.2 }),
      hE("hair-lock2", 1.2 + f, -3.9, 1.7, 1.3, ["down"], { z: 6.2 }),
      hE("hair-lock3", 4.0 + f, -3.4, 1.9, 1.7, ["down"], { z: 6.2 }),
      // cowlick tufts break the dome
      hE("hair-tuft-a", -2.8 + f, -5.5, 2.3, 1.2, ["down"], { z: 5.1 }),
      hE("hair-tuft-b", 2.4 + f, -5.7, 1.9, 1.1, ["down"], { z: 5.1 }),
      // clump strokes on the crown
      hB("hair-clump-a", -3.6, -5.6, 0.7, 3, ["down"], { z: 5.3, tone: -1 }),
      hB("hair-clump-b", 0.6 + f, -6.0, 0.7, 3.4, ["down"], { z: 5.3, tone: -1 }),
      hB("hair-clump-c", 4.2, -5.2, 0.7, 2.6, ["down"], { z: 5.3, tone: -1 }),
      // profile
      hE("hair-back", -5.6, 0.8, 2.8, 4.6, ["side"]),
      hE("hair-lock-s", 4.6, -3.7, 2.4, 1.5, ["side"], { z: 6.2 }),
      hE("hair-tuft-s", -2.6, -5.4, 2.2, 1.2, ["side"], { z: 5.1 }),
      hB("hair-clump-s", -2.6, -5.0, 0.7, 3.4, ["side"], { z: 5.3, tone: -1 }),
      hB("hair-clump-s2", 0.4, -5.4, 0.7, 2.8, ["side"], { z: 5.3, tone: -1 }),
      // 3/4 front
      hE("hair-lock-d0", -3.0 + f, -3.8, 1.9, 1.4, ["down-side"], { z: 6.2 }),
      hE("hair-lock-d1", 0.2 + f, -3.6, 1.6, 1.9, ["down-side"], { z: 6.2 }),
      hE("hair-lock-d2", 3.4 + f, -3.9, 1.8, 1.4, ["down-side"], { z: 6.2 }),
      hE("hair-lock-d3", 6.0, -3, 1.4, 1.8, ["down-side"], { z: 6.2 }),
      hE("hair-tuft-d", -1.6 + f, -5.6, 2.2, 1.2, ["down-side"], { z: 5.1 }),
      hB("hair-clump-d", -2.8, -5.4, 0.7, 3.2, ["down-side"], { z: 5.3, tone: -1 }),
      // back: whorl strokes and a ragged nape
      hB("hair-clump-u1", -2.4, -5.6, 0.7, 3.4, ["up", "up-side"], { z: 5.25, tone: -1 }),
      hB("hair-clump-u2", 1.8, -5.6, 0.7, 3, ["up", "up-side"], { z: 5.25, tone: -1 }),
      hB("hair-clump-u3", 4.6, -3.4, 0.7, 3, ["up", "up-side"], { z: 5.25, tone: -1 }),
      hE("hair-nape-a", -3.2, 6.4, 2.4, 1.3, ["up"], { z: 5.05 }),
      hE("hair-nape-b", 0.6, 6.6, 2.2, 1.5, ["up"], { z: 5.05 }),
      hE("hair-nape-c", 4.0, 6.1, 2, 1.2, ["up"], { z: 5.05 }),
    );
  }
  if (style === "long") {
    P.push(
      hE("hair-long-L", -6.9, 4.6, 1.9, 4.2, ["down"], { z: 6 }),
      hE("hair-long-R", 6.9, 4.6, 1.9, 4.2, ["down"], { z: 6 }),
      hE("hair-longtip-L", -7.0, 8.6, 1.3, 1.7, ["down"], { z: 6 }),
      hE("hair-longtip-R", 7.0, 8.6, 1.3, 1.7, ["down"], { z: 6 }),
      hE("hair-long-side", -5.2, 3.8, 2.9, 5.8, ["side"]),
      hE("hair-longtip-s", -5.6, 9, 1.8, 1.8, ["side"]),
      hB("hair-strand-s", -5, 3.4, 0.7, 5, ["side"], { z: 5.4, tone: -1 }),
      hE("hair-longtip-ua", -4.6, 10.2, 2, 1.6, ["up", "up-side"], { z: 5 }),
      hE("hair-longtip-ub", 0, 10.6, 2.2, 1.8, ["up", "up-side"], { z: 5 }),
      hE("hair-longtip-uc", 4.6, 10.2, 2, 1.6, ["up", "up-side"], { z: 5 }),
      hB("hair-strand-u1", -3.2, 4, 0.7, 5.6, ["up", "up-side"], { z: 5.25, tone: -1 }),
      hB("hair-strand-u2", 1.4, 4.6, 0.7, 5.2, ["up", "up-side"], { z: 5.25, tone: -1 }),
    );
  } else if (style === "ponytail") {
    P.push(
      hE("hair-tail-side", -9.4, 0.4, 1.9, 2.5, ["side"], { z: 5 }),
      hE("hair-tail-s2", -10.2, 3.4, 1.6, 2.4, ["side"], { z: 5 }),
      hE("hair-tail-s3", -9.6, 6.0, 1.1, 1.8, ["side"], { z: 5 }),
      hB("hair-tail-tie", -8.2, -1, 1.2, 2.2, ["side"], { z: 5.5, slot: "accent" }),
      hE("hair-tail-up", 0, 5.4, 2, 2.6, ["up", "up-side"], { z: 6 }),
      hE("hair-tail-up2", 0.2, 8.2, 1.6, 2.2, ["up", "up-side"], { z: 6 }),
      hE("hair-tail-up3", 0, 10.4, 1, 1.5, ["up", "up-side"], { z: 6 }),
      hB("hair-tail-uptie", -1.4, 2.6, 2.8, 1, ["up", "up-side"], { z: 6.1, slot: "accent" }),
    );
  } else if (style === "spiky") {
    // each spike is a stack of shrinking ellipses so it reads as a point, leaning outward
    const spikes: [number, number, number][] = [[-6, -2.6, -0.5], [-3.4, -3.4, -0.3], [0, -3.8, 0], [3.2, -3.5, 0.3], [5.8, -2.8, 0.5]];
    const views: HView[] = [["down"], ["side"], ["up"]];
    spikes.forEach(([dx, dy, lean], i) =>
      views.forEach((v) => {
        const sx = v[0] === "side" ? dx - 1.5 : dx;
        [0, 1, 2].forEach((t) => P.push(hE(`hair-spike${i}-${v[0]}${t}`, sx + lean * t * 1.6, dy - t * 0.8, 2.1 - t * 0.7, 1.9 - t * 0.35, v, { z: 5 + t * 0.01 })));
      }));
    // the base spikes reach too high for a 48px canvas: keep them as low stubs under ours
    [-5.6, -1.9, 1.9, 5.6].forEach((dx, i) => P.push(hE(`hair-spike${i}`, dx, -3, 1.6, 1.5, ["down", "side", "up"])));
    P.push(
      hE("hair-lock0", -4.2, -3.9, 1.9, 1.4, ["down"], { z: 6.2 }),
      hE("hair-lock1", 0.2, -3.6, 1.7, 1.7, ["down"], { z: 6.2 }),
      hE("hair-lock2", 4.2, -3.9, 1.9, 1.4, ["down"], { z: 6.2 }),
      hE("hair-tuftL", -6.5, 1.4, 1.5, 3.2, ["down"]),
      hE("hair-tuftR", 6.5, 1.4, 1.5, 3.2, ["down"]),
      hE("hair-back", -5.6, 0.8, 2.8, 4.6, ["side"]),
    );
  } else if (style === "bun") {
    P.push(
      // a bigger, rounder bun that clears the crown
      hE("hair-bun-top", 0, -4.6, 3.4, 2.4, ["down"], { z: 5.2 }),
      hE("hair-bun-side", -3.6, -4.4, 3.2, 2.4, ["side"], { z: 5.2 }),
      hE("hair-bun-up", 0, -4.4, 3.4, 2.3, ["up", "up-side"], { z: 5.3 }),
      hB("hair-bun-tie", -3, -3.4, 6, 1, ["down"], { z: 5.3, slot: "accent" }),
      hB("hair-bun-ring", -2.2, -6, 0.7, 1.6, ["down"], { z: 5.4, tone: -1 }),
    );
    P.push(hB("hair-bun-strand", -1.6, -6.2, 0.7, 1.8, ["down"], { z: 5.4, tone: -1 }), hB("hair-bun-strand2", 1.2, -6, 0.7, 1.6, ["down"], { z: 5.4, tone: -1 }));
  } else if (style === "pigtails") {
    P.push(
      hE("hair-pigL-tip", -8.4, 7, 1.2, 1.5, ["down"], { z: 6.2 }),
      hE("hair-pigR-tip", 8.4, 7, 1.2, 1.5, ["down"], { z: 6.2 }),
      hB("hair-pigL-strand", -8.4, 2, 0.7, 4, ["down"], { z: 6.3, tone: -1 }),
      hB("hair-pigR-strand", 7.8, 2, 0.7, 4, ["down"], { z: 6.3, tone: -1 }),
    );
  } else if (style === "bob") {
    P.push(
      hE("hair-bob-L", -7, 2.6, 2.1, 3.7, ["down"], { z: 6 }),
      hE("hair-bob-R", 7, 2.6, 2.1, 3.7, ["down"], { z: 6 }),
      hE("hair-bobcurl-L", -5.9, 5.6, 1.7, 1.2, ["down"], { z: 6 }),
      hE("hair-bobcurl-R", 5.9, 5.6, 1.7, 1.2, ["down"], { z: 6 }),
      hE("hair-bob-side", -5.2, 2.2, 2.9, 4.4, ["side"]),
    );
  }
  if (style === "bun") return { id: "hair-shaped-bun", name: "Hair shapes (bun)", parts: P.filter((q) => !/^hair-(tuft-|clump-b)/.test(q.id)) };
  return { id: `hair-shaped-${style}`, name: `Hair shapes (${style})`, parts: P };
}

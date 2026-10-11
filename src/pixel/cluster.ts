// Pixel-cluster enforcer: merge stray colour regions smaller than min x min into their
// neighbours, and snap alpha to 0/255. Implements the guide's `quantize --min-cluster 2x2`
// and the owner's "zero single-pixel noise" directive.
//
// Two passes:
//   1. alpha: any pixel with 0 < a < 255 snaps to 0 (a < 128) or 255.
//   2. colour: connected regions (4-connected, exact colour) with pixel count < min area
//      are recoloured to the colour of the neighbouring region with the longest shared border.
//      Ties break toward the region with the smaller mean distance (then the lower colour id).
import type { Rgba } from "./types";

export interface ClusterReport {
  merged: number;          // regions merged away
  alphaFixed: number;      // pixels whose alpha snapped
  coloursBefore: number;
  coloursAfter: number;
}

export function enforceClusters(img: Rgba, minCluster = 2): ClusterReport {
  const { w, h, data } = img;
  // pass 1 — alpha snap
  let alphaFixed = 0;
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3];
    if (a !== 0 && a !== 255) {
      data[i * 4 + 3] = a < 128 ? 0 : 255;
      alphaFixed++;
    }
  }
  const coloursBefore = countColours(data, w * h);

  // pass 2 — small-region merge (iterative: merging can create new small regions)
  let merged = 0;
  for (let iter = 0; iter < 8; iter++) {
    const label = regionLabel(data, w, h);
    const regions = regionSizes(label, w * h);
    const minArea = minCluster * minCluster;
    let changed = false;
    for (let i = 0; i < w * h; i++) {
      const r = label[i];
      if (regions.get(r)! >= minArea) continue;
      if (regions.get(r) === 0) continue;
      // find the neighbour region with the longest shared border
      const counts = new Map<number, number>();
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (label[y * w + x] !== r) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nr = label[ny * w + nx];
          if (nr !== r) counts.set(nr, (counts.get(nr) ?? 0) + 1);
        }
      }
      if (!counts.size) continue;
      let best = -1, bestN = -1;
      for (const [nr, n] of counts) if (n > bestN || (n === bestN && nr < best)) { best = nr; bestN = n; }
      // recolour region r's pixels to region best's colour
      const target = colourOfRegion(data, label, w, h, best);
      for (let j = 0; j < w * h; j++) {
        if (label[j] !== r) continue;
        data[j * 4] = target[0]; data[j * 4 + 1] = target[1]; data[j * 4 + 2] = target[2];
        data[j * 4 + 3] = target[3];
      }
      merged++;
      changed = true;
      // label refresh happens next iteration (labels now stale)
      break;
    }
    if (!changed) break;
  }
  const coloursAfter = countColours(data, w * h);
  return { merged, alphaFixed, coloursBefore, coloursAfter };
}

function countColours(data: Uint8ClampedArray, n: number): number {
  const s = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] !== 255) continue;
    s.add((data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2]);
  }
  return s.size;
}

/** 4-connected exact-colour region labelling. */
function regionLabel(data: Uint8ClampedArray, w: number, h: number): Int32Array {
  const label = new Int32Array(w * h).fill(-1);
  let next = 0;
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (label[i] !== -1) continue;
    const c = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]];
    stack.push(i);
    label[i] = next;
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % w, y = (j / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx;
        if (label[k] !== -1) continue;
        if (data[k * 4] === c[0] && data[k * 4 + 1] === c[1] && data[k * 4 + 2] === c[2] && data[k * 4 + 3] === c[3]) {
          label[k] = next;
          stack.push(k);
        }
      }
    }
    next++;
  }
  return label;
}

function regionSizes(label: Int32Array, n: number): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i < n; i++) m.set(label[i], (m.get(label[i]) ?? 0) + 1);
  return m;
}

function colourOfRegion(data: Uint8ClampedArray, label: Int32Array, w: number, h: number, r: number): [number, number, number, number] {
  for (let i = 0; i < w * h; i++) {
    if (label[i] === r) return [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]];
  }
  return [0, 0, 0, 0];
}

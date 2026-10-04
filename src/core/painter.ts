import { colorIndex, type Material } from "./palette";
import { lightVector } from "./kit";
import { createSprite } from "./sprite";
import type { Sprite, StyleKit } from "./types";

type Vec3 = [number, number, number];

export interface ShapeOpts {
  /** Shift the computed shade by whole ramp levels (+ lighter, - darker). */
  tone?: number;
  /** 0 = fully rounded, 1 = flat facing the viewer. */
  flat?: number;
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

export const DITHER_MIN_SIZE = 24;

/** Ramp levels used for each shade-step setting, darkest first. */
const LEVELS: Record<number, number[]> = {
  2: [1, 3],
  3: [1, 2, 3],
  4: [1, 2, 3, 4],
  5: [0, 1, 2, 3, 4],
};

/**
 * A tiny "material + normal" rasteriser. Generators describe shapes (spheres,
 * boxes, cylinders, polygons) and the painter lights them all with the kit's
 * single light direction and quantises to the kit's shade steps. Because every
 * asset goes through the same lighting model, a tree, a chest and a hero all
 * read as belonging to the same world.
 */
export class Painter {
  readonly w: number;
  readonly h: number;
  private mat: Int16Array;
  private light: Float32Array;
  private fixed: Int8Array;
  private tone: Int8Array;
  // Layer stamps (which part drew a pixel, at what z) feed the rich-detail passes; unused otherwise.
  private part: Int16Array;
  private partZ: Float32Array;
  private partIds: string[] = [];
  private curPart = -1;
  private curZ = 0;
  private L: Vec3;
  private materials: Material[] = [];

  constructor(w: number, h: number, private kit: StyleKit) {
    this.w = w;
    this.h = h;
    this.mat = new Int16Array(w * h).fill(-1);
    this.light = new Float32Array(w * h);
    this.fixed = new Int8Array(w * h).fill(-1);
    this.tone = new Int8Array(w * h);
    this.part = new Int16Array(w * h).fill(-1);
    this.partZ = new Float32Array(w * h);
    this.L = lightVector(kit.lightDir);
  }

  /** +1 when light comes from the right, -1 from the left, 0 from above. */
  get lightSide(): number {
    return Math.sign(Math.round(this.L[0] * 10));
  }

  private matId(m: Material): number {
    let i = this.materials.indexOf(m);
    if (i < 0) {
      this.materials.push(m);
      i = this.materials.length - 1;
    }
    return i;
  }

  private intensity(n: Vec3): number {
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    const d = (n[0] * this.L[0] + n[1] * this.L[1] + n[2] * this.L[2]) / len;
    const hl = Math.pow(d * 0.5 + 0.5, 1.5);
    const amb = this.kit.ambient * 0.4;
    return amb + (1 - amb) * hl;
  }

  private put(x: number, y: number, m: Material, n: Vec3 | null, level: number, opts?: ShapeOpts) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    this.mat[i] = this.matId(m);
    this.tone[i] = opts?.tone ?? 0;
    this.part[i] = this.curPart;
    this.partZ[i] = this.curZ;
    if (n) {
      this.light[i] = this.intensity(n);
      this.fixed[i] = -1;
    } else {
      this.fixed[i] = level;
    }
  }

  /** Stamp following draws with a part id and z (rig renderer; enables `separate`). */
  setLayer(id: string, z: number): this {
    let i = this.partIds.indexOf(id);
    if (i < 0) i = this.partIds.push(id) - 1;
    this.curPart = i;
    this.curZ = z;
    return this;
  }

  /** Shift the shade of already-painted lit pixels in a rect (contact shadows, folds, highlights). */
  shade(x: number, y: number, w: number, h: number, delta: number, only?: Material): this {
    const mi = only ? this.materials.indexOf(only) : -2;
    if (only && mi < 0) return this;
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const xx = Math.floor(x + i), yy = Math.floor(y + j);
        if (xx < 0 || yy < 0 || xx >= this.w || yy >= this.h) continue;
        const k = yy * this.w + xx;
        if (this.mat[k] < 0 || this.fixed[k] >= 0 || (only && this.mat[k] !== mi)) continue;
        this.tone[k] += delta;
      }
    return this;
  }

  /**
   * 1px darker separation where a part sits behind a nearer one (limb over torso, head over
   * shoulders, brim over brow). `allow(behind, front)` picks which part pairs get a seam.
   */
  separate(allow: (behind: string, front: string) => boolean): this {
    const hits: number[] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        if (this.mat[i] < 0 || this.fixed[i] >= 0 || this.part[i] < 0) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
          const j = ny * this.w + nx;
          if (this.mat[j] < 0 || this.fixed[j] >= 0 || this.part[j] < 0 || this.part[j] === this.part[i]) continue;
          if (this.partZ[j] > this.partZ[i] + 0.05 && allow(this.partIds[this.part[i]], this.partIds[this.part[j]])) { hits.push(i); break; }
        }
      }
    for (const i of hits) this.tone[i] -= 1;
    return this;
  }

  /** Rim light: lit pixels on the silhouette edge away from the light get one shade lighter. */
  rim(): this {
    const side = this.lightSide === 0 ? 1 : -this.lightSide; // light from the left -> rim on the right edge
    const hits: number[] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        if (this.mat[i] < 0 || this.fixed[i] >= 0 || this.light[i] > 0.5) continue;
        const nx = x + side;
        if (nx < 0 || nx >= this.w || this.mat[y * this.w + nx] < 0) hits.push(i);
      }
    for (const i of hits) this.tone[i] += 1;
    return this;
  }

  /** Explicit pixel with a fixed ramp level (eyes, details, sparkles). */
  px(x: number, y: number, m: Material, level: number): this {
    this.put(x, y, m, null, level);
    return this;
  }

  rect(x: number, y: number, w: number, h: number, m: Material, level: number): this {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.put(x + i, y + j, m, null, level);
    return this;
  }

  line(x0: number, y0: number, x1: number, y1: number, m: Material, level: number): this {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.put(x0, y0, m, null, level);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return this;
  }

  erase(x: number, y: number, w = 1, h = 1): this {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const xx = Math.floor(x + i), yy = Math.floor(y + j);
        if (xx >= 0 && yy >= 0 && xx < this.w && yy < this.h) this.mat[yy * this.w + xx] = -1;
      }
    return this;
  }

  /** Lit ellipsoid (heads, bushes, rocks, potions, tree crowns). */
  ellipse(cx: number, cy: number, rx: number, ry: number, m: Material, opts: ShapeOpts = {}): this {
    const flat = opts.flat ?? 0;
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++)
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        const d2 = dx * dx + dy * dy;
        if (d2 > 1) continue;
        const nz = Math.sqrt(1 - d2);
        this.put(x, y, m, [dx * (1 - flat), dy * (1 - flat), nz + flat], 0, opts);
      }
    return this;
  }

  /** Axis-aligned block with an explicit face normal (default: facing viewer). */
  box(x: number, y: number, w: number, h: number, m: Material, normal: Vec3 = [0, 0, 1], opts: ShapeOpts = {}): this {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.put(x + i, y + j, m, normal, 0, opts);
    return this;
  }

  /** Vertical cylinder (trunks, barrels, limbs, towers): rounded left-to-right. */
  cylinder(x: number, y: number, w: number, h: number, m: Material, opts: ShapeOpts = {}): this {
    const flat = opts.flat ?? 0;
    for (let i = 0; i < w; i++) {
      const u = w <= 1 ? 0 : ((i + 0.5) / w) * 2 - 1;
      const n: Vec3 = [u * (1 - flat), -0.15, Math.sqrt(Math.max(0, 1 - u * u)) + flat];
      for (let j = 0; j < h; j++) this.put(x + i, y + j, m, n, 0, opts);
    }
    return this;
  }

  /**
   * Capsule between two points (rigged limbs, tails, horns): a cylinder of
   * radius r along any direction, lit across its width like `cylinder`.
   */
  capsule(ax: number, ay: number, bx: number, by: number, r: number, m: Material, opts: ShapeOpts = {}): this {
    const flat = opts.flat ?? 0;
    const vx = bx - ax, vy = by - ay;
    const len2 = vx * vx + vy * vy || 1e-6;
    const len = Math.sqrt(len2);
    const px = -vy / len, py = vx / len; // unit perpendicular
    for (let y = Math.floor(Math.min(ay, by) - r - 1); y <= Math.ceil(Math.max(ay, by) + r + 1); y++)
      for (let x = Math.floor(Math.min(ax, bx) - r - 1); x <= Math.ceil(Math.max(ax, bx) + r + 1); x++) {
        const cx = x + 0.5 - ax, cy = y + 0.5 - ay;
        const t = Math.max(0, Math.min(1, (cx * vx + cy * vy) / len2));
        const dx = cx - t * vx, dy = cy - t * vy;
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        const u = (dx * px + dy * py) / r; // -1..1 across the limb
        this.put(x, y, m, [px * u * (1 - flat), py * u * (1 - flat) - 0.15, Math.sqrt(Math.max(0, 1 - u * u)) + flat], 0, opts);
      }
    return this;
  }

  /** Filled polygon with a single face normal (roofs, pine layers, blades). */
  poly(points: [number, number][], m: Material, normal: Vec3 = [0, 0, 1], opts: ShapeOpts = {}): this {
    const ys = points.map((p) => p[1]);
    const minY = Math.floor(Math.min(...ys)), maxY = Math.ceil(Math.max(...ys));
    for (let y = minY; y <= maxY; y++) {
      const sy = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const [ax, ay] = points[i], [bx, by] = points[(i + 1) % points.length];
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let x = Math.ceil(xs[k] - 0.5); x <= Math.floor(xs[k + 1] - 0.5); x++) this.put(x, y, m, normal, 0, opts);
    }
    return this;
  }

  /** Mirror the left half onto the right (symmetrical front views). */
  mirrorX(): this {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < Math.floor(this.w / 2); x++) {
        const a = y * this.w + x, b = y * this.w + (this.w - 1 - x);
        this.mat[b] = this.mat[a];
        this.fixed[b] = this.fixed[a];
        this.tone[b] = this.tone[a];
        this.light[b] = this.light[a];
      }
    return this;
  }

  isFilled(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return false;
    return this.mat[y * this.w + x] >= 0;
  }

  /**
   * Dither is for blending a changing light value, not for flat faces: a wall
   * whose constant light sits near a shade boundary would otherwise turn into
   * a full checkerboard. A pixel counts as on a gradient when a lit neighbour
   * of the same material falls in a different shade band.
   */
  private onGradient(x: number, y: number, S: number): boolean {
    const i = y * this.w + x;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) continue;
      const j = ny * this.w + nx;
      if (this.mat[j] === this.mat[i] && this.fixed[j] < 0 && Math.floor(this.light[j] * S) !== Math.floor(this.light[i] * S)) return true;
    }
    return false;
  }

  /** Quantise lighting into palette indices using the kit's shade steps and dithering. */
  toSprite(): Sprite {
    const s = createSprite(this.w, this.h);
    const levels = LEVELS[Math.max(2, Math.min(5, Math.round(this.kit.shadeSteps)))];
    const S = levels.length;
    // Ordered dither only reads as a gradient on larger surfaces; on small sprites it is just noise.
    const dither = this.kit.dither && Math.min(this.w, this.h) >= DITHER_MIN_SIZE;
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        const i = y * this.w + x;
        const mi = this.mat[i];
        if (mi < 0) continue;
        const m = this.materials[mi];
        let level: number;
        if (this.fixed[i] >= 0) {
          level = this.fixed[i];
        } else {
          let q = this.light[i] * S;
          if (dither && this.onGradient(x, y, S)) q += (BAYER4[(y & 3) * 4 + (x & 3)] - 0.5) * 0.6;
          level = levels[Math.max(0, Math.min(S - 1, Math.floor(q)))];
        }
        s.data[i] = colorIndex(m, Math.max(0, Math.min(4, level + this.tone[i])));
      }
    return s;
  }
}

// Pure Snake rules: no DOM, no timers. The page drives step() on a clock.
export type Dir = "R" | "D" | "L" | "U";
export interface Pt { x: number; y: number }
export interface Gold extends Pt { ttl: number }
export type Rng = () => number;

export const COLS = 20;
export const ROWS = 15;
export const GOLD_TTL = 40; // steps the gold apple stays
export const GOLD_BLINK = 12; // blinks while ttl <= this
export const GOLD_CHANCE = 0.25;
export const MAX_QUEUE = 3;

export interface State {
  snake: Pt[]; // head first
  dir: Dir;
  queue: Dir[];
  apple: Pt;
  gold: Gold | null;
  score: number;
  grow: number; // pending segments to add
  alive: boolean;
}
export type StepEvent = "apple" | "gold" | "goldGone" | "goldSpawn" | "dead";

export const DELTA: Record<Dir, Pt> = { R: { x: 1, y: 0 }, D: { x: 0, y: 1 }, L: { x: -1, y: 0 }, U: { x: 0, y: -1 } };
export const DIRS: Dir[] = ["R", "D", "L", "U"]; // clockwise order
export const opposite = (d: Dir): Dir => DIRS[(DIRS.indexOf(d) + 2) % 4];

export const isWall = (p: Pt) => p.x <= 0 || p.y <= 0 || p.x >= COLS - 1 || p.y >= ROWS - 1;
const same = (a: Pt, b: Pt) => a.x === b.x && a.y === b.y;

export function freeCell(s: Pick<State, "snake" | "apple" | "gold">, rng: Rng): Pt | null {
  const free: Pt[] = [];
  for (let y = 1; y < ROWS - 1; y++)
    for (let x = 1; x < COLS - 1; x++) {
      const p = { x, y };
      if (s.snake.some((q) => same(p, q))) continue;
      if (s.apple && same(p, s.apple)) continue;
      if (s.gold && same(p, s.gold)) continue;
      free.push(p);
    }
  return free.length ? free[Math.floor(rng() * free.length) % free.length] : null;
}

export function createState(rng: Rng): State {
  const cy = Math.floor(ROWS / 2);
  const snake = [{ x: 6, y: cy }, { x: 5, y: cy }, { x: 4, y: cy }];
  const s: State = { snake, dir: "R", queue: [], apple: { x: 0, y: 0 }, gold: null, score: 0, grow: 0, alive: true };
  s.apple = freeCell(s, rng) ?? { x: 10, y: cy };
  return s;
}

/** Queue a turn. Compared against the last queued direction, so 180 degree reversals are impossible. */
export function queueDir(s: State, d: Dir): boolean {
  if (!s.alive || s.queue.length >= MAX_QUEUE) return false;
  const last = s.queue.length ? s.queue[s.queue.length - 1] : s.dir;
  if (d === last || d === opposite(last)) return false;
  s.queue.push(d);
  return true;
}

/** Milliseconds per step; speeds up with length. */
export const tickMs = (length: number) => Math.max(65, 150 - (length - 3) * 3);

export function step(s: State, rng: Rng): StepEvent[] {
  const ev: StepEvent[] = [];
  if (!s.alive) return ev;
  const q = s.queue.shift();
  if (q) s.dir = q;
  const d = DELTA[s.dir];
  const head = { x: s.snake[0].x + d.x, y: s.snake[0].y + d.y };
  const growing = s.grow > 0 || same(head, s.apple) || (s.gold !== null && same(head, s.gold));
  // the tail cell is vacated this step unless we are growing
  const body = growing ? s.snake : s.snake.slice(0, -1);
  if (isWall(head) || body.some((p) => same(p, head))) {
    s.alive = false;
    ev.push("dead");
    return ev;
  }
  s.snake.unshift(head);
  if (s.grow > 0) s.grow--;
  else if (!growing) s.snake.pop();
  if (same(head, s.apple)) {
    s.score += 1;
    ev.push("apple");
    s.apple = freeCell(s, rng) ?? s.apple;
    if (!s.gold && rng() < GOLD_CHANCE) {
      const c = freeCell(s, rng);
      if (c) { s.gold = { ...c, ttl: GOLD_TTL }; ev.push("goldSpawn"); }
    }
  } else if (s.gold && same(head, s.gold)) {
    s.score += 5;
    s.grow += 3; // +1 already applied by not popping
    s.gold = null;
    ev.push("gold");
  }
  if (s.gold && --s.gold.ttl <= 0) { s.gold = null; ev.push("goldGone"); }
  if (s.snake.length >= (COLS - 2) * (ROWS - 2)) { s.alive = false; ev.push("dead"); }
  return ev;
}

/** Quarter turns clockwise so a sprite drawn facing RIGHT points along d. */
export const rotFor = (d: Dir) => DIRS.indexOf(d);

export interface Seg { kind: "head" | "body" | "corner" | "tail"; rot: number }
const dirTo = (a: Pt, b: Pt): Dir => DIRS.find((k) => DELTA[k].x === b.x - a.x && DELTA[k].y === b.y - a.y) ?? "R";

/** Which sprite + rotation for snake segment i. Corner base art connects LEFT and BOTTOM. */
export function segment(snake: Pt[], i: number): Seg {
  if (i === 0) return { kind: "head", rot: snake.length > 1 ? rotFor(dirTo(snake[1], snake[0])) : 0 };
  const toPrev = dirTo(snake[i], snake[i - 1]);
  if (i === snake.length - 1) return { kind: "tail", rot: rotFor(toPrev) };
  const toNext = dirTo(snake[i], snake[i + 1]);
  if (toPrev === opposite(toNext)) return { kind: "body", rot: toPrev === "R" || toPrev === "L" ? 0 : 1 };
  for (let k = 0; k < 4; k++) {
    const a = DIRS[(DIRS.indexOf("L") + k) % 4];
    const b = DIRS[(DIRS.indexOf("D") + k) % 4];
    if ((a === toPrev && b === toNext) || (a === toNext && b === toPrev)) return { kind: "corner", rot: k };
  }
  return { kind: "body", rot: 0 };
}

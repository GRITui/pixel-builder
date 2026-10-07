import { describe, expect, it } from "vitest";
import { COLS, GOLD_TTL, createState, queueDir, segment, step, tickMs, type State } from "./logic";

const rng = () => 0.5;
const fresh = (): State => createState(rng);

describe("snake logic", () => {
  it("moves one cell per step", () => {
    const s = fresh();
    const h = s.snake[0];
    step(s, rng);
    expect(s.snake[0]).toEqual({ x: h.x + 1, y: h.y });
    expect(s.snake).toHaveLength(3);
  });
  it("rejects reversal and duplicates, allows queued turns", () => {
    const s = fresh();
    expect(queueDir(s, "L")).toBe(false);
    expect(queueDir(s, "R")).toBe(false);
    expect(queueDir(s, "U")).toBe(true);
    expect(queueDir(s, "L")).toBe(true); // legal relative to queued U
    expect(queueDir(s, "D")).toBe(true);
    expect(queueDir(s, "L")).toBe(false); // queue full
    step(s, rng);
    expect(s.dir).toBe("U");
    step(s, rng);
    expect(s.dir).toBe("L");
  });
  it("up then down quickly is not a self-reversal", () => {
    const s = fresh();
    queueDir(s, "U");
    expect(queueDir(s, "D")).toBe(false);
  });
  it("eats apple, scores and grows", () => {
    const s = fresh();
    s.apple = { x: s.snake[0].x + 1, y: s.snake[0].y };
    const ev = step(s, rng);
    expect(ev).toContain("apple");
    expect(s.score).toBe(1);
    expect(s.snake).toHaveLength(4);
    expect(s.apple).not.toEqual(s.snake[0]);
  });
  it("dies on walls", () => {
    const s = fresh();
    let ev: string[] = [];
    for (let i = 0; i < COLS && s.alive; i++) ev = step(s, rng);
    expect(s.alive).toBe(false);
    expect(ev).toContain("dead");
    expect(step(s, rng)).toEqual([]);
  });
  it("dies on self collision but may chase its own tail", () => {
    const ring = () => [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 5 }];
    const s = fresh();
    s.snake = ring();
    s.dir = "L"; s.apple = { x: 15, y: 10 };
    queueDir(s, "D"); // into (5,6): body
    step(s, rng);
    expect(s.alive).toBe(false);
    const t = fresh();
    t.snake = ring();
    t.dir = "U"; t.apple = { x: 15, y: 10 };
    queueDir(t, "R"); // into (6,5): the tail, which vacates
    step(t, rng);
    expect(t.alive).toBe(true);
  });
  it("gold gives +5, grows, and expires", () => {
    const s = fresh();
    const h = s.snake[0];
    s.gold = { x: h.x + 1, y: h.y, ttl: GOLD_TTL };
    expect(step(s, rng)).toContain("gold");
    expect(s.score).toBe(5);
    for (let i = 0; i < 3; i++) step(s, rng);
    expect(s.snake).toHaveLength(7);
    const g = fresh();
    g.gold = { x: 1, y: 1, ttl: 2 };
    expect(step(g, rng)).not.toContain("goldGone");
    expect(step(g, rng)).toContain("goldGone");
    expect(g.gold).toBeNull();
  });
  it("speeds up with length, floored", () => {
    expect(tickMs(10)).toBeLessThan(tickMs(3));
    expect(tickMs(500)).toBe(65);
  });
  it("picks sprite rotations", () => {
    const s = [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }];
    expect(segment(s, 0)).toEqual({ kind: "head", rot: 0 });
    expect(segment(s, 1)).toEqual({ kind: "body", rot: 0 });
    expect(segment(s, 2)).toEqual({ kind: "tail", rot: 0 });
    expect(segment([{ x: 5, y: 4 }, { x: 5, y: 5 }, { x: 4, y: 5 }], 0).rot).toBe(3); // heading up
    // corner art joins LEFT and BOTTOM: neighbours at left and below -> rot 0
    expect(segment([{ x: 3, y: 5 }, { x: 4, y: 5 }, { x: 4, y: 6 }], 1)).toEqual({ kind: "corner", rot: 0 });
    // LEFT + UP is one quarter turn clockwise from base: L->U, D->L
    expect(segment([{ x: 3, y: 5 }, { x: 4, y: 5 }, { x: 4, y: 4 }], 1)).toEqual({ kind: "corner", rot: 1 });
    // tail below its predecessor connects UP -> rot 3
    expect(segment([{ x: 5, y: 4 }, { x: 5, y: 5 }, { x: 5, y: 6 }], 2).rot).toBe(3);
  });
});

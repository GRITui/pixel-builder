// Browser entry: canvas rendering, input, loop. Rules live in logic.ts.
import {
  COLS, GOLD_BLINK, ROWS, createState, queueDir, segment, step, tickMs,
  type Dir, type State,
} from "./logic";
import { drawText, textWidth } from "./font";

const W = COLS * 16;
const H = ROWS * 16;
const NAMES = ["head", "body", "corner", "tail", "apple", "gold", "grass-a", "grass-b", "wall", "title"] as const;
type Name = (typeof NAMES)[number];

interface Assets { img: Record<Name, HTMLImageElement>; palette: string[] }
declare global { interface Window { __SNAKE_ASSETS__?: Record<string, string> } }

const BEST_KEY = "pixel-builder:snake:best";
const loadBest = () => { try { return Math.max(0, parseInt(localStorage.getItem(BEST_KEY) ?? "0", 10) || 0); } catch { return 0; } };
const saveBest = (n: number) => { try { localStorage.setItem(BEST_KEY, String(n)); } catch { /* storage unavailable */ } };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("failed " + src)); i.src = src; });
}

async function loadAssets(): Promise<Assets> {
  const inl = window.__SNAKE_ASSETS__;
  const url = (n: string) => inl?.[n] ?? `assets/${n}`;
  const imgs = await Promise.all(NAMES.map((n) => loadImage(url(n + ".png"))));
  const img = Object.fromEntries(NAMES.map((n, i) => [n, imgs[i]])) as Record<Name, HTMLImageElement>;
  let palette: string[] = [];
  try {
    const raw = inl?.["palette.json"];
    const j = raw ? JSON.parse(raw) : await (await fetch("assets/palette.json")).json();
    if (Array.isArray(j.palette)) palette = j.palette.filter((c: unknown) => typeof c === "string");
  } catch { /* fall back to white/black */ }
  return { img, palette };
}

const lum = (h: string) => { const n = parseInt(h.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255); };
function colors(palette: string[]) {
  const ok = palette.filter((c) => /^#[0-9a-f]{6}$/i.test(c)).sort((a, b) => lum(a) - lum(b));
  if (ok.length < 2) return { light: "#ffffff", dark: "#000000", accent: "#f2c230" };
  const light = ok[ok.length - 1], dark = ok[0];
  // accent: the most saturated mid-bright palette entry, for the prompts
  const sat = (h: string) => { const n = parseInt(h.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255; return Math.max(r, g, b) - Math.min(r, g, b); };
  const accent = [...ok].filter((c) => lum(c) > 90).sort((a, b) => sat(b) - sat(a))[0] ?? light;
  return { light, dark, accent };
}

type Mode = "title" | "play" | "pause" | "over";
interface Spark { x: number; y: number; t: number }

async function main() {
  const canvas = document.getElementById("c") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  const { img, palette } = await loadAssets();
  const col = colors(palette);
  const rng = Math.random;

  let mode: Mode = "title";
  let s: State = createState(rng);
  let best = loadBest();
  let acc = 0, last = performance.now(), overAt = 0;
  let sparks: Spark[] = [];

  // dither overlays are built once, as native-resolution pixel patterns
  const mkPattern = (color: string) => {
    const p = document.createElement("canvas"); p.width = p.height = 2;
    const g = p.getContext("2d")!; g.fillStyle = color; g.fillRect(0, 0, 1, 1); g.fillRect(1, 1, 1, 1);
    return ctx.createPattern(p, "repeat")!;
  };
  const dimPat = mkPattern(col.dark), flashPat = mkPattern(col.light);

  const start = () => { s = createState(rng); sparks = []; acc = 0; last = performance.now(); mode = "play"; };
  const pause = () => { if (mode === "play") mode = "pause"; else if (mode === "pause") { mode = "play"; last = performance.now(); } };
  const anyAction = () => {
    if (mode === "title") start();
    else if (mode === "over" && performance.now() - overAt > 500) start();
    else if (mode === "pause") pause();
  };
  const turn = (d: Dir) => { if (mode === "play") queueDir(s, d); else anyAction(); };

  // ---------- input ----------
  const KEYS: Record<string, Dir> = {
    ArrowRight: "R", ArrowLeft: "L", ArrowUp: "U", ArrowDown: "D", d: "R", a: "L", w: "U", s: "D", D: "R", A: "L", W: "U", S: "D",
  };
  addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "p" || e.key === "P" || e.key === "Escape") { if (mode === "play" || mode === "pause") pause(); else anyAction(); e.preventDefault(); return; }
    const d = KEYS[e.key];
    if (d) { e.preventDefault(); turn(d); return; }
    if (e.key.length === 1 || e.key === "Enter" || e.key === "Space") { if (mode !== "play") { e.preventDefault(); anyAction(); } }
  });
  let sx = 0, sy = 0, swiping = false, moved = false;
  addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("#pad")) return;
    sx = e.clientX; sy = e.clientY; swiping = true; moved = false;
  });
  addEventListener("pointermove", (e) => {
    if (!swiping || mode !== "play") return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    moved = true;
    queueDir(s, Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "R" : "L") : (dy > 0 ? "D" : "U"));
    sx = e.clientX; sy = e.clientY;
  });
  const endSwipe = () => { if (swiping && !moved) anyAction(); swiping = false; };
  addEventListener("pointerup", endSwipe);
  addEventListener("pointercancel", () => { swiping = false; });
  document.querySelectorAll<HTMLButtonElement>("#pad [data-dir]").forEach((b) => {
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); turn(b.dataset.dir as Dir); });
  });
  document.getElementById("pausebtn")!.addEventListener("pointerdown", (e) => { e.preventDefault(); if (mode === "play" || mode === "pause") pause(); else anyAction(); });
  addEventListener("blur", () => { if (mode === "play") pause(); });

  // ---------- layout: largest integer scale that fits ----------
  const fit = () => {
    const touch = document.body.classList.contains("touch");
    const land = innerWidth > innerHeight;
    document.body.classList.toggle("land", land);
    const padW = touch && land ? 200 : 0, padH = touch && !land ? 210 : 0;
    const scale = Math.max(1, Math.floor(Math.min((innerWidth - padW - 16) / W, (innerHeight - padH - 16) / H)));
    canvas.style.width = W * scale + "px";
    canvas.style.height = H * scale + "px";
  };
  const coarse = matchMedia("(pointer: coarse)");
  const setTouch = () => { document.body.classList.toggle("touch", coarse.matches || "ontouchstart" in window); fit(); };
  coarse.addEventListener?.("change", setTouch);
  addEventListener("pointerdown", (e) => { if (e.pointerType === "touch" && !document.body.classList.contains("touch")) setTouch(); });
  addEventListener("resize", fit);
  addEventListener("orientationchange", fit);
  setTouch();

  // ---------- drawing ----------
  const spr = (n: Name, cx: number, cy: number, rot = 0) => {
    ctx.save();
    ctx.translate(cx * 16 + 8, cy * 16 + 8);
    ctx.rotate((rot * Math.PI) / 2);
    ctx.drawImage(img[n], -8, -8);
    ctx.restore();
  };
  const text = (t: string, x: number, y: number, scale: number, color: string, shadow = col.dark) => {
    drawText(ctx, t, x + scale, y + scale, scale, shadow);
    drawText(ctx, t, x, y, scale, color);
  };
  const center = (t: string, y: number, scale: number, color: string) => text(t, Math.round((W - textWidth(t, scale)) / 2), y, scale, color);

  function drawField(now: number) {
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const wall = x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1;
      ctx.drawImage(img[wall ? "wall" : (x + y) & 1 ? "grass-b" : "grass-a"], x * 16, y * 16);
    }
    if (mode === "title") return;
    spr("apple", s.apple.x, s.apple.y);
    if (s.gold && (s.gold.ttl > GOLD_BLINK || Math.floor(now / 110) % 2 === 0)) spr("gold", s.gold.x, s.gold.y);
    for (let i = s.snake.length - 1; i >= 0; i--) {
      const seg = segment(s.snake, i);
      spr(seg.kind, s.snake[i].x, s.snake[i].y, seg.rot);
    }
    for (const p of sparks) {
      const f = Math.floor(p.t / 70); // 3 frames
      const px = p.x * 16 + 8, py = p.y * 16 + 8, r = 3 + f * 3;
      ctx.fillStyle = f === 2 ? col.accent : col.light;
      for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
        const k = f === 0 ? r * 0.6 : r;
        ctx.fillRect(Math.round(px + dx * k) - 1, Math.round(py + dy * k) - 1, f === 2 ? 1 : 2, f === 2 ? 1 : 2);
      }
    }
    // HUD in the top wall row, on a plate
    ctx.fillStyle = col.dark; ctx.fillRect(0, 0, W, 16);
    text("SCORE " + s.score, 8, 5, 1, col.light);
    const b = "BEST " + Math.max(best, s.score);
    text(b, W - 8 - textWidth(b, 1), 5, 1, col.accent);
  }

  function frame(now: number) {
    const dt = Math.min(100, now - last);
    last = now;
    if (mode === "play") {
      acc += dt;
      while (acc >= tickMs(s.snake.length) && mode === "play") {
        acc -= tickMs(s.snake.length);
        const ev = step(s, rng);
        if (ev.includes("apple") || ev.includes("gold")) sparks.push({ x: s.snake[0].x, y: s.snake[0].y, t: 0 });
        if (ev.includes("dead")) {
          mode = "over"; overAt = now;
          if (s.score > best) { best = s.score; saveBest(best); }
        }
      }
    }
    sparks = sparks.filter((p) => (p.t += dt) < 210);

    ctx.imageSmoothingEnabled = false;
    if (mode === "title") {
      ctx.drawImage(img.title, 0, 0);
      center("SNAKE", 56, 6, col.accent);
      if (Math.floor(now / 500) % 2 === 0) center("PRESS ANY KEY / TAP", 184, 1, col.light);
      if (best > 0) center("BEST " + best, 200, 1, col.accent);
    } else {
      drawField(now);
      if (mode === "pause") {
        ctx.fillStyle = dimPat; ctx.fillRect(0, 16, W, H - 32);
        center("PAUSED", 96, 4, col.light);
        center("P / TAP TO RESUME", 132, 1, col.accent);
      }
      if (mode === "over") {
        const since = now - overAt;
        if (since < 160) { ctx.fillStyle = since < 80 ? flashPat : dimPat; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
        else {
          ctx.fillStyle = dimPat; ctx.fillRect(0, 16, W, H - 32);
          ctx.fillStyle = col.dark; ctx.fillRect(60, 64, W - 120, 104);
          ctx.fillStyle = col.light; ctx.fillRect(60, 64, W - 120, 1); ctx.fillRect(60, 167, W - 120, 1);
          center("GAME OVER", 76, 3, col.accent);
          center("SCORE " + s.score, 112, 2, col.light);
          center(s.score >= best && s.score > 0 ? "NEW BEST!" : "BEST " + best, 134, 1, col.accent);
          if (since > 500 && Math.floor(now / 500) % 2 === 0) center("PRESS ANY KEY / TAP", 150, 1, col.light);
        }
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  (window as unknown as { __snake: unknown }).__snake = { get state() { return s; }, get mode() { return mode; } };
}

main().catch((e) => { document.body.textContent = "Failed to load: " + e.message; });

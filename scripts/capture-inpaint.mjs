// Headless capture of the AI region-edit (inpaint) editor flow (issue #18).
// Drives the built web app over CDP:
//   1. open a generated asset in the pixel editor
//   2. pick the Inpaint tool and drag a rectangle region  -> "before"
//   3. stage an inpaint result (mocked fetch, no API key needed) -> "after"
//   4. Apply, so the committed frame is captured too
// Usage: node scripts/capture-inpaint.mjs [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2] ?? "/tmp/pb-inpaint-shots";
const APP = "http://127.0.0.1:4319/";
const CDP = "http://127.0.0.1:9333";
mkdirSync(OUT, { recursive: true });

const targets = await (await fetch(`${CDP}/json/list`)).json();
const page = targets.find((t) => t.type === "page");
if (!page) throw new Error("no page target");

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const msg = { id: ++id, method, params };
    pending.set(msg.id, { resolve, reject });
    ws.send(JSON.stringify(msg));
  });

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1560, height: 1040, deviceScaleFactor: 2, mobile: false });

const evaluate = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval failed");
  return r.result.value;
};
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  const p = join(OUT, name);
  writeFileSync(p, Buffer.from(r.data, "base64"));
  console.log("wrote", p);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clickText = (text, tag = "button") =>
  evaluate(`(() => {
    const el = [...document.querySelectorAll('${tag}')].find(b => b.textContent.trim() === ${JSON.stringify(text)});
    if (!el) return 'NOT FOUND: ${text}';
    el.click();
    return 'clicked ${text}';
  })()`);

// Stub the API BEFORE the app boots, so the editor renders its AI-on state and
// Generate is enabled. /api/health reports a key; /api/inpaint returns a frame
// that differs from the input ONLY inside the mask (as the real server does).
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
    window.__pbInpaintCalls = 0;
    const realFetch = window.fetch;
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.includes('/api/health'))
        return new Response(JSON.stringify({ enabled: true, model: 'mocked' }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.includes('/api/inpaint')) {
        window.__pbInpaintCalls++;
        const body = JSON.parse(init.body);
        const out = [];
        for (const sprite of body.frames) {
          const w = sprite.w, h = sprite.h, data = sprite.data.slice();
          let region = body.mask;
          if (Array.isArray(region)) {
            // lasso grid: repaint every set cell
            for (let y = 0; y < h; y++)
              for (let x = 0; x < w; x++) if (region[y] && region[y][x]) data[y * w + x] = 16 + ((x + y) % 5);
          } else {
            region = { x: region.x, y: region.y, w: region.w, h: region.h };
            for (let y = region.y; y < region.y + region.h; y++)
              for (let x = region.x; x < region.x + region.w; x++)
                if (x >= 0 && y >= 0 && x < w && y < h) data[y * w + x] = 16 + ((x + y) % 5);
          }
          out.push({ w, h, data });
        }
        return new Response(JSON.stringify({ frames: out }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return realFetch(input, init);
    };
  `,
});
await send("Page.navigate", { url: APP });
await sleep(2500);

// The API server is not running, so /api/health fails and the editor shows its
// documented AI-off state; region selection must still work.
console.log("open editor:", await clickText("Open in editor"));
await sleep(1200);
await shot("01-editor-opened.png");

// Pick the Inpaint tool (key A, or the rail button).
console.log("inpaint tool:", await clickText("InpaintA", "button"));
await sleep(400);

const box = await evaluate(`(() => {
  const c = document.querySelector('.pe-canvas');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height });
})()`);
console.log("canvas:", box);
if (!box) throw new Error("pixel editor canvas not found (is the asset a sprite?)");
const b = JSON.parse(box);

// Drag a rectangle region across the middle of the sprite (pointer events, so
// this exercises the real selection path).
await evaluate(`(() => {
  const c = document.querySelector('.pe-canvas');
  const r = c.getBoundingClientRect();
  const log = (window.__pbDragDiag = { rect: { x: r.x, y: r.y, w: r.width, h: r.height }, points: [] });
  const opts = (x, y) => ({ bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: x, clientY: y });
  const x0 = r.x + r.width * 0.34, y0 = r.y + r.height * 0.30;
  const x1 = r.x + r.width * 0.66, y1 = r.y + r.height * 0.62;
  const ev = (type, x, y) => {
    const e = new PointerEvent(type, opts(x, y));
    c.dispatchEvent(e);
    log.points.push({ type, x: Math.round(x), y: Math.round(y), handled: e.defaultPrevented });
    return e;
  };
  ev('pointerdown', x0, y0);
  for (let i = 1; i <= 6; i++) ev('pointermove', x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6);
  ev('pointerup', x1, y1);
  return 'dragged';
})()`);
await sleep(600);
const regionInfo = await evaluate(`(() => {
  const el = document.querySelector('.pe-region');
  const ta = document.querySelector('.pe-ip textarea');
  return JSON.stringify({
    overlay: !!el,
    overlayStyle: el ? el.getAttribute('style') : null,
    promptPlaceholder: ta ? ta.getAttribute('placeholder') : null,
    hints: [...document.querySelectorAll('.pe-ip p')].map(p => p.textContent.trim()),
  });
})()`);
console.log("region:", regionInfo);
await shot("02-region-selected-before.png");

if (!/width: (\d+)px/.test(regionInfo) || Number(RegExp.$1) < 32) {
  // Report what the canvas actually saw, so a drag that collapses to 1x1 is
  // visible rather than silently wrong.
  const diag = await evaluate(`JSON.stringify(window.__pbDragDiag ?? 'no diag')`);
  throw new Error(`region selection collapsed to a 1x1 cell: ${regionInfo}\\n${diag}`);
}

// Stage a result: the prompt is typed into the AI edit panel.
console.log(
  "mock inpaint:",
  await evaluate(`(() => {
    const el = document.querySelector('.pe-ip textarea');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(el, 'add a red scarf');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return el.value;
  })()`),
);
await sleep(300);

console.log("generate:", await clickText("Generate"));
await sleep(1500);
const busyOrErr = await evaluate(`(() => {
  return JSON.stringify({
    buttons: [...document.querySelectorAll('.pe-ip button')].map(b => b.textContent.trim()),
    status: [...document.querySelectorAll('.pe-ip p')].map(p => p.textContent.trim()),
    compare: !!document.querySelector('.pe-compare'),
    captions: [...document.querySelectorAll('.pe-compare figcaption')].map(f => f.textContent),
    apiCalls: window.__pbInpaintCalls,
  });
})()`);
console.log("after generate:", busyOrErr);
await shot("03-after-generated.png");

// Apply, so the committed frame is captured as well.
console.log("apply:", await clickText("Apply"));
await sleep(900);
await shot("04-after-applied.png");

console.log("DONE ->", OUT);
ws.close();
process.exit(0);
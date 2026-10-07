// Bundles game.ts + logic.ts and inlines every asset as a data: URI into dist/snake.html.
// Run: npm run snake:build
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const NAMES = ["head", "body", "corner", "tail", "apple", "gold", "grass-a", "grass-b", "wall", "title"];

const out = await build({ entryPoints: [join(root, "game.ts")], bundle: true, format: "iife", minify: true, target: "es2020", write: false });
const js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");

const assets: Record<string, string> = {};
for (const n of NAMES) assets[n + ".png"] = "data:image/png;base64," + readFileSync(join(root, "assets", n + ".png")).toString("base64");
assets["palette.json"] = readFileSync(join(root, "assets", "palette.json"), "utf8");
// the 8-bit set rides along under an "8bit/" prefix (the game's G key / button switches)
for (const n of NAMES) assets["8bit/" + n + ".png"] = "data:image/png;base64," + readFileSync(join(root, "assets-8bit", n + ".png")).toString("base64");
assets["8bit/palette.json"] = readFileSync(join(root, "assets-8bit", "palette.json"), "utf8");

let html = readFileSync(join(root, "index.html"), "utf8");
html = html.replace("<!--ASSETS-->", () => `<script>window.__SNAKE_ASSETS__=${JSON.stringify(assets).replace(/</g, "\\u003c")};</script>`);
html = html.replace('<script src="game.js"></script><!--SCRIPT-->', () => `<script>${js}</script>`);

mkdirSync(join(root, "dist"), { recursive: true });
const file = join(root, "dist", "snake.html");
writeFileSync(file, html);
console.log(`wrote ${file} (${(html.length / 1024).toFixed(0)} KB)`);

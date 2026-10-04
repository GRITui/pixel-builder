// Tiny 3x5 pixel font for HUD text. Glyphs are drawn with an explicit palette level of a chosen
// material, so text follows the kit palette like every other detail pixel.
import { colorIndex, type Material } from "./palette";
import { setPx } from "./sprite";
import type { Sprite } from "./types";

export const GLYPH_W = 3;
export const GLYPH_H = 5;

/** Five rows of three columns; `#` is ink. */
const G: Record<string, string> = {
  "0": "### #.# #.# #.# ###",
  "1": ".#. ##. .#. .#. ###",
  "2": "### ..# ### #.. ###",
  "3": "### ..# ### ..# ###",
  "4": "#.# #.# ### ..# ..#",
  "5": "### #.. ### ..# ###",
  "6": "### #.. ### #.# ###",
  "7": "### ..# ..# .#. .#.",
  "8": "### #.# ### #.# ###",
  "9": "### #.# ### ..# ###",
  A: ".#. #.# ### #.# #.#",
  B: "##. #.# ##. #.# ##.",
  C: ".## #.. #.. #.. .##",
  D: "##. #.# #.# #.# ##.",
  E: "### #.. ##. #.. ###",
  F: "### #.. ##. #.. #..",
  G: ".## #.. #.# #.# .##",
  H: "#.# #.# ### #.# #.#",
  I: "### .#. .#. .#. ###",
  J: "..# ..# ..# #.# .#.",
  K: "#.# #.# ##. #.# #.#",
  L: "#.. #.. #.. #.. ###",
  M: "#.# ### ### #.# #.#",
  N: "##. #.# #.# #.# #.#",
  O: ".#. #.# #.# #.# .#.",
  P: "##. #.# ##. #.. #..",
  Q: ".#. #.# #.# ##. .##",
  R: "##. #.# ##. #.# #.#",
  S: ".## #.. .#. ..# ##.",
  T: "### .#. .#. .#. .#.",
  U: "#.# #.# #.# #.# ###",
  V: "#.# #.# #.# #.# .#.",
  W: "#.# #.# ### ### #.#",
  X: "#.# #.# .#. #.# #.#",
  Y: "#.# #.# .#. .#. .#.",
  Z: "### ..# .#. #.. ###",
  ":": "... .#. ... .#. ...",
  "/": "..# ..# .#. #.. #..",
  "-": "... ... ### ... ...",
  ".": "... ... ... ... .#.",
  " ": "... ... ... ... ...",
};

export const FONT_CHARS = Object.keys(G).join("");

/** Rows of 0/1 for a character (upper-cased; unknown characters render as a space). */
export function glyph(ch: string): number[][] {
  const g = G[ch.toUpperCase()] ?? G[" "];
  return g.split(" ").map((row) => [...row].map((c) => (c === "#" ? 1 : 0)));
}

/** Pixel width of `text`: 3px per glyph plus 1px between glyphs (no trailing gap). */
export function textWidth(text: string): number {
  return text.length === 0 ? 0 : text.length * (GLYPH_W + 1) - 1;
}

type Target = { px(x: number, y: number, m: Material, level: number): unknown } | Sprite;

/** Draw `text` with its top-left at (x, y); returns the drawn width. */
export function drawText(target: Target, x: number, y: number, text: string, material: Material, level: number): number {
  const put = "data" in target
    ? (px: number, py: number) => setPx(target, px, py, colorIndex(material, level))
    : (px: number, py: number) => target.px(px, py, material, level);
  let cx = x;
  for (const ch of text) {
    glyph(ch).forEach((row, j) => row.forEach((on, i) => on && put(cx + i, y + j)));
    cx += GLYPH_W + 1;
  }
  return textWidth(text);
}

// STUB — owned by Lane B. Replace the implementation; keep the exported name.
import { Painter } from "../painter";
import type { Generator } from "./types";

export const uiGenerator: Generator = {
  id: "ui",
  category: "ui",
  label: "UI element",
  description: "Game UI: buttons (normal/hover/pressed), 9-slice panels, inventory slots, progress bars, icon frames, cursors, icons.",
  params: [{ key: "kind", label: "Kind", type: "select", options: ["button"], default: "button" }],
  generate(_p, kit) {
    const P = new Painter(48, 16, kit);
    P.box(0, 0, 48, 16, "ui");
    return { rows: [{ name: "normal", frames: [P.toSprite()] }], fps: 1 };
  },
};

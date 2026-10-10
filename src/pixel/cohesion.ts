// Palette cohesion: how well one result's palette sits inside its project's palette.
// A pixelize call runs its own k-means pass, so two images in the same era can share almost
// nothing (measured: 1 of 48 colours on gradients). Assets that don't share a palette don't
// read as one game. This computes the signal so the caller can warn and point at `looks`.
import { ERAS, type Era } from "./types";

/** Cohesion bands. Share of THIS image's colours that already exist in the project palette. */
export type Cohesion = "tight" | "partial" | "drifting" | "solo";

export interface PaletteBudget {
  /** Distinct colours in this result. */
  colours: number;
  /** The era's ceiling (ERAS[era].colours). */
  limit: number;
  /** Distinct colours across every other result recorded for this project. */
  project_colours: number;
  /** How many of this image's colours already appear in the project palette. */
  shared: number;
  /** shared / colours, 0-1. 1 when the image is entirely inside the project palette. */
  overlap: number;
  cohesion: Cohesion;
  /** True when the era limit alone is not the binding constraint (it usually isn't). */
  within_limit: boolean;
  /** Actionable next step, or "" when nothing needs saying. */
  hint: string;
}

const LOOK_HINT =
  "This palette is mostly new to the project. Save the strongest result with `looks action=save name=<project> from=<file>.json`, then pass `look=<project>` to every later pixelize so one game reads as one.";

/** Union of every other result's palette for the project. Empty = this is the first asset. */
export function projectPalette(others: string[][]): Set<string> {
  return new Set(others.flat().map((h) => h.toLowerCase()));
}

export function paletteBudget(own: string[], era: Era, others: string[][]): PaletteBudget {
  const mine = own.map((h) => h.toLowerCase());
  const distinct = new Set(mine);
  const proj = projectPalette(others);
  const shared = [...distinct].filter((h) => proj.has(h)).length;
  const overlap = distinct.size ? shared / distinct.size : 0;
  const limit = ERAS[era].colours;
  const within_limit = distinct.size <= limit;
  // No other asset yet: there is nothing to drift from, so don't cry cohesion.
  const cohesion: Cohesion = !proj.size ? "solo" : overlap >= 0.7 ? "tight" : overlap >= 0.3 ? "partial" : "drifting";
  let hint = "";
  if (!within_limit) hint = `${distinct.size} colours exceeds the ${era}-bit limit of ${limit}; lower the era or the size.`;
  else if (cohesion === "drifting") hint = LOOK_HINT;
  else if (cohesion === "partial") hint = `Only ${Math.round(overlap * 100)}% of these colours exist elsewhere in the project. ${LOOK_HINT}`;
  return { colours: distinct.size, limit, project_colours: proj.size, shared, overlap, cohesion, within_limit: within_limit, hint };
}
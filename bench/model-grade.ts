// Optional model-graded pass for the benchmark. Stub: no network, returns null.
// See bench/RUBRIC.md ("Optional model-graded pass") for what to implement.
export interface Grade {
  readability: number;
  consistency: number;
  animation: number | null;
  directions: number;
  time: number;
  editability: number;
  cost: number;
}

/** Return seven 1-5 scores for a contact sheet, or null when no grader is configured (the default). */
export async function gradeSheet(_pngPath: string, _prompt: string): Promise<Grade | null> {
  return null;
}

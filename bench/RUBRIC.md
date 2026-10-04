# Benchmark rubric

Seven criteria, each scored 1-5 per brief, once for pixel-builder and once for PixelLab.
Score what you see in `bench/out/report.html`, at 1x first (squint, then zoom). Record scores in
`bench/ratings.csv` (one row per brief x tool x rater). Half points are not allowed; pick the lower.

| Criterion | 1 | 3 | 5 |
|---|---|---|---|
| **Readability at 1x** (can you tell what it is at native size?) | Blob; you need the prompt to know what it is | Recognisable, but details or silhouette are muddy | Instantly clear, clean silhouette, nothing wasted |
| **Set consistency** (do the pieces of the brief look like one game? palette, light, outline, scale) | Pieces look like different artists | Same palette but light, outline or scale drift | Indistinguishable from one artist's set; scale and light agree |
| **Animation quality** (n/a = leave blank when the brief has no animation) | Frames jitter, limbs pop, no weight | Cycle reads, but stiff or with stray pixels | Smooth, weighted, loops cleanly, pixels stay stable between frames |
| **Direction coverage** (what the brief asked for vs what exists) | One view only, or most requested views missing | All requested views, but some are mirrored copies or inconsistent | All requested views, each correct, same design in every direction |
| **Time to result** (wall clock from prompt to usable asset, including retries) | Over 30 min of attempts | 1-5 min | Under 10 s, first try |
| **Editability** (can a person or agent change one thing without redoing the rest?) | Pixels only; change = regenerate | Can repaint, or edit parts with effort | Parameters, layers and rigs: swap a hat, recolour, re-light, rerender the set |
| **Cost** (money + human time per usable asset) | Several credits or paid minutes per asset, many retries | A few credits, or a cheap model call, per asset | Free and deterministic (or marginal cost near zero) |

## Notes for raters

- Rate the best output each tool gives for the brief, not the average. For ours that is the recipe in `briefs.json`.
- Time and cost for pixel-builder are measured (see `bench/RESULTS.md`); only score them once the same measure is available for PixelLab. Our recipes are hand-authored, so add the human/agent time to write the recipe when you score "time to result".
- Direction coverage is partly automatic (`results.json` -> `metrics.directions` vs `expectedDirections`). Still check by eye that the diagonals are real 3/4 views.
- Rate at least two raters per brief and average; disagreement over 2 points deserves a discussion.

## Optional model-graded pass

`bench/model-grade.ts` is a documented stub: `gradeSheet(pngPath, brief)` returns `null` until someone wires it
to a model. It is deliberately offline here (no network in CI and no API key in this repo's bench). To use it,
implement the function with your preferred vision-capable model, ask for the seven scores above as JSON
(`{"readability":1-5,...}`), and write the results to `bench/ratings.csv` with `rater=model:<id>`.
Treat model scores as a tie-breaker for large sweeps, never as the headline number: models flatter smooth, high-resolution art.

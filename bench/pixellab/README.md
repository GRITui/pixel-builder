# PixelLab reference outputs

Collected by hand, never in CI, and never committed unless PixelLab's terms allow it
(check the plan you are on: generated images are usually usable, but redistribution of
the *tool's outputs inside this repo* is your call). If in doubt, keep the PNGs local:
`bench/pixellab/*.png` is only read by `scripts/bench.ts` when present.

## How

1. Open `bench/briefs.json`; for each brief, paste its `prompt` into PixelLab (use the matching tool: character
   with animation / skeleton, map or tileset tool, object, etc.). Use the closest size to ours
   (32px characters, 16px items, 16px tiles; 48px for the HD kit brief).
2. Take the best of at most 3 attempts. Note the attempts and the wall-clock time and credits spent in
   `bench/ratings.csv` (`notes` column) so time and cost are scored on real numbers.
3. Export one PNG per brief: a contact sheet of the result (all directions and animation frames you got,
   one row per direction or clip) on any background. Save as `bench/pixellab/<brief-id>.png`,
   e.g. `bench/pixellab/char-thai-farmer-8dir.png`. Keep the id exactly as in `briefs.json`.
4. Run `npm run bench`; `bench/out/report.html` now shows PixelLab next to ours for every brief that has a file.
5. Score both sides with `bench/RUBRIC.md` and fill `bench/ratings.csv`.

Where PixelLab cannot do a brief (for example side-view autotile atlases), leave the file out; the report
shows "not collected", and say so in the notes column.

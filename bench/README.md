# bench

`npx tsx bench/run.ts` (add `--quick` for the reduced matrix) runs the pixelizer on 8 synthetic images (`samples.ts`, no stock photos) across modes/eras/presets, checks `validate` + era colour limit, look-lock palette identity and an effect loop, and writes `RESULTS.md`. `bench.test.ts` runs a reduced version under vitest.

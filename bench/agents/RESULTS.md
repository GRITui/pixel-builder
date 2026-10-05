# Agent eval results

Does a given model drive pixel-builder well? `bench/agents/run.ts` gives it 7 briefs (see `tasks.json`), runs a tool-calling loop over the in-process tools in a fresh workspace per brief, and scores what is left in the workspace.

## Method

Per task, 0-100: **60%** machine checks passed (right assets, categories, counts, sizes, map, reference used, kit changed...), **10%** tool reliability (1 - (failed tool calls + turns where the tool call was written as text) / attempts), **30%** consistency: 0.4 x every sprite's palette indices valid for its kit, 0.3 x non-tile sprites have an outline ring (approximate: edge pixels darker than the interior), 0.3 x mean pairwise style agreement of the set (`styleDistance` components palette/shades/outline/light, 0-100). The overall score is the mean over the tasks run. Turns and tokens are reported, not scored. Runs are not deterministic; compare models on the same day with the same `--tools` and `--max-turns`.

Columns: `style` = mean pairwise style score over all tasks. `errs` = tool error rate. Per-task scores in brief order: forest-pack, farm-npcs, ui-kit, village-map, match-reference, paint-sign, retheme-kit. Full transcripts: `bench/agents/runs/` (git-ignored). Recorded hand-written transcripts for offline testing live in `bench/agents/replays/` (`--replay`).

| Date | Model | Tools | Overall | Per task | Turns | Tokens | errs | style |
|---|---|---|---:|---|---:|---:|---:|---:|

# Benchmark results: baseline

- Date: 2026-10-04
- Commit: `24759ba` (integration head before the benchmark lane)
- Command: `npm run bench` (offline, no AI, 34 briefs, 119 runs: 28 briefs x 4 kits, 1 brief x 2 kits, 5 side-view briefs on `kit-side`). 0 failures.
- Machine: sandbox container, single process. Numbers are wall clock including workspace load/save and PNG export.
- PixelLab columns: **not collected yet** (see `bench/pixellab/README.md`). Nothing below compares against PixelLab.

## Timing

Seconds per brief (all assets of the recipe, saved and exported). Full table is in `bench/out/results.json` after a run.

| Kit | Runs | Total | Slowest brief |
|---|---:|---:|---|
| kit-default | 29 | 3.3 s | animal-farm-set 0.46 s (6 animated animals, 256 frames) |
| kit-gameboy | 28 | 2.2 s | map-farm 0.26 s |
| kit-neon | 28 | 3.0 s | animal-farm-set 0.42 s |
| kit-hd-rich | 29 | 7.1 s | animal-farm-set 1.15 s |
| kit-side | 5 | 0.4 s | side-parallax-level 0.14 s |

Typical single results (kit-default): a rigged 8-direction walk+idle character 0.11 s, a building 0.04 s, a 47-tile autotile 0.09 s, a 24x16 map 0.18-0.25 s. The HD rich kit is about 2.5x slower but still under 1.2 s for anything. "Time to result" for our side is therefore dominated by writing the recipe (an agent turn or a few clicks), not rendering.

## Automated metrics (kit-default)

Palette idx = distinct palette entries used across the brief's sprites (the kit has 90). Outline = share of silhouette-edge pixels that are outline-dark (ink or level <= 1). Margin = share of props that keep a 1px transparent border inside the canvas. n/a = tile, map or UI sprite, where outlines and margins do not apply.

| Brief | Assets | Frames | Clips | Directions (expected) | Palette idx | Outline | Margin |
|---|---:|---:|---:|---|---:|---:|---:|
| char-thai-farmer-8dir | 1 | 64 | 2 | 8 (8) | 38 | 100% | 100% |
| char-rice-farmer-woman | 1 | 48 | 3 | 4 (4) | 33 | 99% | 0% |
| char-knight-topdown | 1 | 48 | 3 | 4 (4) | 34 | 99% | 0% |
| char-wizard | 1 | 32 | 2 | 4 (4) | 25 | 100% | 100% |
| char-villager-crowd | 6 | 96 | 1 | 4 | 45 | 98% | 50% |
| char-slime-monsters | 4 | 64 | 1 | 4 | 21 | 100% | 100% |
| char-hero-rich | 1 | 32 | 2 | 4 (4) | 37 | 92% | 0% |
| animal-water-buffalo-8dir | 1 | 48 | 2 | 8 (8) | 18 | 100% | 0% |
| animal-farm-set | 6 | 256 | 5 | 4 | 40 | 100% | 100% |
| animal-horse | 1 | 48 | 2 | 8 (8) | 15 | 100% | 100% |
| animal-pond-fish | 3 | 72 | 2 | 4 | 20 | 100% | 100% |
| animal-birds | 4 | 144 | 4 | 4 | 31 | 100% | 100% |
| building-cottage | 2 | 2 | 0 | - | 16 | 100% | 0% |
| building-stilt-house | 2 | 2 | 0 | - | 16 | 100% | 0% |
| building-village-set | 6 | 6 | 0 | - | 24 | 100% | 0% |
| env-trees | 5 | 65 | 5 | - | 11 | 98% | 0% |
| env-props | 9 | 41 | 5 | - | 37 | 93% | 0% |
| tiles-ground-set | 7 | 13 | 1 | - | 18 | n/a | n/a |
| autotile-grass-water | 1 | 1 | 0 | - | 8 | n/a | n/a |
| autotile-grass-dirt-blob | 1 | 1 | 0 | - | 7 | n/a | n/a |
| autotile-sand-water | 2 | 2 | 0 | - | 15 | n/a | n/a |
| items-potion-set | 6 | 6 | 0 | - | 35 | 100% | 0% |
| items-tools | 8 | 40 | 2 | - | 43 | 100% (was 42%) | 0% |
| items-loot | 10 | 16 | 1 | - | 35 | 100% | 60% |
| ui-kit-basic | 6 | 10 | 7 | - | 14 | n/a | n/a |
| ui-hud-weather | 5 | 7 | 1 | - | 28 | n/a | n/a |
| map-meadow | 1 | 1 | 0 | - | 44 | n/a | n/a |
| map-rice-village | 1 | 1 | 0 | - | 49 | n/a | n/a |
| map-farm | 2 | 2 | 0 | - | 77 | n/a | n/a |
| side-knight-attack (kit-side) | 1 | 34 | 3 | 2 (2) | 34 (was 31) | 98% | 0% |
| side-hero-moves (kit-side) | 1 | 38 | 6 | 2 (2) | 36 | 96% | 100% |
| side-enemies (kit-side) | 2 | 28 | 2 | 2 (2) | 19 | 100% | 0% |

Reading the numbers honestly:

- **Direction coverage is 100%** where asked: every 8-direction brief has all 8 rows per clip (3/4 diagonals are real views, not mirrors, at least by the generator's design); side-view gives left and right.
- **Outline compliance is high** (>= 92%) wherever the finishing pass runs. `items-tools` at 42% is a real finding: the tool icons and their use-sprites do not get a dark outer edge like other props. Either that is intended for thin handles or it is a consistency gap; it needs a look from the object-generator owner.
- **Margin is a weak metric.** Buildings, large trees and many animals deliberately fill the canvas to the baseline, so "0%" mostly flags that the 1px margin rule is not applied to ground-anchored sprites. Treat it as informational.
- **Palette use is modest**: 7-18 indices for tiles and trees, 25-45 for characters, up to 77 for a whole map. Single sprites sit well under 16 colours (ramps of 4-5 shades per material), which is the consistency model working, but it is also the ceiling on tonal depth.

## Self-ratings (our side only, honest, 1-5)

Rated by the benchmark author after viewing contact sheets of 15+ representative sheets (characters, trees, props, buildings, autotile, potions, UI, farm map, side-view knight, side level, gameboy and neon variants). Without a PixelLab comparison these are absolute, against what a good indie pixel artist would deliver. The "time" and "cost" rows are the easy wins for this tool.

| Criterion | Score | Justification |
|---|---:|---|
| Readability at 1x | 4 | Props, items, buildings, slimes and maps read instantly; the 16px Game Boy characters and the beret-like side-view helmet are muddy. |
| Set consistency | 5 | One palette, light and outline across every brief and every kit; this is the core design, and the village, loot and tile sets look like one game. |
| Animation quality | 4 (was 3) | Sprint 5 (#47): `attack-snappy`, `chop-snappy`, `mine-snappy`, `jump-snappy` add anticipation (coil / lean back), a smear frame on the fast swing, an impact hold, follow-through and a settle, with a larger swing arc (blade tip travels about 20 grid units vs 18) and the head lagging the torso by a frame. Rich kits use them automatically, standard kits stay unchanged. Still no true squash-and-stretch, cloth/hair physics or impact effects, so not a 5. |
| Direction coverage | 4 | Real 4 and 8 direction rows for humanoids and quadrupeds, left/right for side-view; but no isometric, 8 directions only benchmarked for humanoid and quadruped rigs (not birds, fish), and diagonals are hard to verify at 1x. |
| Time to result | 5 | 0.03-1.2 s render, deterministic, no queue; recipe-writing time is the only human cost. |
| Editability | 5 | Rigs, attachments, params, kits, `rerender_assets`, layered SVG and Aseprite export: any element can be changed and the set re-rendered. |
| Cost | 5 | Free, offline, no credits; AI is only needed for optional Describe/inpaint features. |

Overall: strong on consistency, speed, editability and cost; moderate on art depth and animation. Expect PixelLab to score higher on readability and visual richness for organic subjects, lower on consistency, editability and (probably) cost once credits are counted.

## Known gaps

Candid list of where the output is weak, from looking at the sheets:

1. **Foliage is flat and cartoon-ish.** Trees have 2-3 blobby leaf clumps and few shades (11 palette indices for a five-tree set); no painterly leaf clusters, no light-through-leaves, no seasonal variants beyond tiles.
2. **Palette depth.** 4-5 shades per material and one hue shift in rich mode limits tonal range; skin, metal and cloth lack highlights/accents. Skin and armour in particular look chalky (the side-view knight is almost monochrome grey; fixed for the knight in #47 with the `knight-trim` attachment: accent tabard, cape and gold hem).
3. **Water depth.** Water tiles and autotile edges are a two-tone blue with a light shore line; no depth gradient, foam or reflections. The shore transition looks like a "drawn border" rather than a bank.
4. **Monster variety.** The generator makes exactly two monsters: a slime (recolourable) and a side-view slime/beetle. No skeletons, bats, goblins, bosses, or flying/aquatic enemies; four recoloured slimes read as one monster.
5. **UI polish.** Panels, buttons and slots are correct but plain; there is no ornate frame variety, icons-in-slots and no text/number font integration in the sheets.
6. **Side-view weaknesses.** One body type; the attack clip has little arc; the helmet and hair read oddly in profile; parallax hills are flat grey/green shapes; levels are flat runs of ground with a few steps and floating platforms, no caves, water, or props; no side-view building variety, no animal or NPC rigs.
7. **Character variety is parametric.** Clothing and hair come from a fixed list; a "Thai farmer with ngob hat" works because we authored that hat, and arbitrary requests (kimono, armour sets, a robot) are not possible without writing a rig or attachment.
8. **Animation range.** Only humanoid, quadruped, bird, fish families; no flying, climbing animals, or multi-part monsters; no squash-and-stretch or effects (impact, dust, slashes).
9. **Item outlines.** Fixed in #47: `items-tools` outline compliance 42% -> 100%. Root cause: the 32 `use` effect frames (chips, drops, sparks) were finalized with `outline: false`, so only the 8 icon frames had an outline. Effects are now outlined like every other sprite.
10. **Isometric and top-down 3/4 buildings in multiple facings** are not produced; buildings are front-facing only.
11. **Small-kit legibility.** At 16px (`kit-gameboy`) humanoids lose face and hands; 8-direction diagonals are unreadable there.
12. **The benchmark itself.** Recipes are hand-authored by us (an agent turn each), so "time to result" understates real prompt-to-asset time; PixelLab columns are empty until collected; self-ratings are one rater's view.

## How to reproduce

```bash
npm run bench                         # everything; then open bench/out/report.html
npm run bench -- --brief map- --kit kit-default
```

## Update: polish from the bench (#47)

Before/after sheet: `docs/img/polish-before-after.png` (rows: attack, attack-snappy, side knight before, side knight with trim and snappy attack, tool use frames without and with outline). Reproduce with `npx tsx scripts/polish-sheet.ts <out.png>`.

| Item | Before | After |
|---|---|---|
| `items-tools` outline compliance (kit-default) | 42% | 100% |
| `items-tools` palette indices | 37 | 43 |
| `side-knight-attack` palette indices | 31 | 34 (red accent cloth + gold) |
| Animation self-rating | 3 | 4 |
| Humanoid attack frames (side) | 4 | 7 snappy (opt-in; 4 on standard kits) |

Notes: the `side-knight-attack` recipe now uses `knight-trim` and `attack-snappy` (the side kit is not a rich kit, so the variant is selected by id). Standard output is byte-identical for every clip (the topdown snapshot test is unchanged); only tool-effect (`use`) frames changed because they now carry an outline. The 4 rich-kit runs use the snappy frames for `attack`/`chop`/`mine`/`jump` automatically.

## Sprint 5: MMO-quality environment (#40-#47)

- Date: 2026-10-04
- Commit: Sprint 5 wave 3 (lane B, #45) on top of waves 1-2 (`5a88c8e`)
- Command: `npm run bench` (offline): 43 briefs, 156 runs (the 34 baseline briefs plus `ui-mmo-hud`, `monsters-set`, `trees-hd`, `trees-hd-seasons`, `water-river-map`, `water-pond-map`, `water-props`, `water-depth-autotile` and the new `map-forest-mmo`, which also runs on `kit-hd-deep`). 0 failures.
- Exit image: `docs/img/mmo-scene.png` (kit-hd-rich) and `docs/img/mmo-scene-deep.png` (kit-hd-deep), made by `npx tsx scripts/mmo-scene.ts`: a `forest-mmo` map, the hero, three monsters (red mushroom, green slime, snapping plant), nameplates, damage numbers and the MMO HUD, y-sorted. 1008 x 672 px each.

### Timing

| Kit | Runs | Total | Slowest brief |
|---|---:|---:|---|
| kit-default | 38 | 5.5 s | animal-farm-set 0.56 s |
| kit-gameboy | 37 | 4.3 s | map-forest-mmo 0.74 s |
| kit-neon | 37 | 5.2 s | map-forest-mmo 0.54 s |
| kit-hd-rich | 38 | 11.8 s | map-forest-mmo 1.40 s |
| kit-hd-deep | 1 | 1.3 s | map-forest-mmo 1.34 s |
| kit-side | 5 | 0.5 s | side-parallax-level 0.17 s |

`map-forest-mmo` (24x16, detail high) costs 0.5 s in the 16px kits and about 1.4 s in the HD kits (every tree is a real foliage render; the sprites are cached per kit, so a second map in the same kit is about 2x faster). A 36x24 map with detail high is 1.5 s cold in kit-hd-rich.

### Metrics and "nothing down"

Every baseline brief produced the same numbers as in the baseline table above (assets, frames, clips, directions, palette indices, outline compliance, margin), so nothing regressed. Palette indices for the new briefs on kit-default: `map-forest-mmo` 55 (a whole map, vs 44 for `map-meadow`), `monsters-set` 55 (98% outline), `ui-mmo-hud` 53, `trees-hd` 32 (vs 11 for the five classic trees; outline compliance 79% because the canopy edge is deliberately ragged and the ground shadow is soft), `water-river-map` 45.

### Self-ratings, re-scored (our side, 1-5, same rubric, looking at `docs/img/mmo-scene*.png` and the new bench sheets)

| Criterion | Baseline | Sprint 5 | Why |
|---|---:|---:|---|
| Readability at 1x | 4 | 5 (HD kits); 16px kits still 3-4 | The HD scene reads instantly: trees, bridge, river bands, monsters and HUD all have clean silhouettes and the layers (ground, props, trees, characters, HUD) separate. The monsters are the cutest sprites we make. In `kit-gameboy` the dense forest is a mush of two greens and the path barely separates from the grass, so the score is for the best output, not the 16px one. |
| Set consistency | 5 | 5 | Same palette, light and outline across map, trees, monsters and HUD, including in `kit-hd-deep`. |
| Animation quality | 4 | 4 (monsters 5) | Monsters have idle, walk, attack with anticipation, a white hit flash and a dissolving death, with real squash and stretch on slimes; tree sway and 4-frame water exist too. The score stays 4 because humanoids still have no impact effects or cloth/hair motion, and the composite scene is a still (the map render bakes frame 0 of water and trees). |
| Direction coverage | 4 | 4 | Unchanged: monsters get 4 (or 8) directions, the new biome is a map. |
| Time to result | 5 | 5 | 0.5-1.4 s for a whole scene map. |
| Editability | 5 | 5 | The scene is `biome`, `detail`, `season`, `density`, a seed and a kit; re-skin by kit. Spawn points, y-sorted objects and the Tiled object layer are in the metadata. |
| Cost | 5 | 5 | Free and offline. |

Honest reading: readability is the only score that moves, and only for the HD kits. The rest was already at the top of the rubric or is limited by things this sprint did not touch. Animation did not go up: the rubric's 5 needs humanoid effects and a moving scene, which we do not have.

### Known gaps, revisited

Baseline gaps 1 (foliage), 2 (palette depth), 3 (water depth), 4 (monster variety) and 5 (UI polish) are largely closed for the HD kits (HD trees with 3 sizes and 7 species, 9-shade deep ramps, depth-banded water with foam and banks, six monster families with five clips each, a glossy HUD). Gaps 6-8 and 10-12 are unchanged. Still missing against a polished 2D MMO, from looking at the scene:

1. **No light or atmosphere.** No dappled light through canopies, no tree shadows cast on the path, no ambient occlusion where trunks meet the ground, no time-of-day tint, fog, god rays, bloom or water reflections. The scene is evenly lit, which is why it reads "clean" more than "lush".
2. **Terrain is flat.** One height level: no cliffs, ledges, stairs, waterfalls, tributaries, lakes or beaches. The river always runs top to bottom, the path is a constant 2-wide ribbon, and there is exactly one bridge.
3. **Variety repeats.** Seven species x three sizes x three variants: neighbouring trees of one grove look related, trunks are alike and the crowns are blobby compared with hand-painted trees. Props are one per cell (no multi-cell logs, ruins, signposts, fences, stalls or buildings in this biome), and decals sit on a tile grid.
4. **Static scene.** The composite and the map preview bake frame 0. Water, foam, tree sway, reeds and monsters animate individually, but nothing combines them into one animated map render, and the hero in the scene is a single standing frame.
5. **Characters are small against the trees and have one look.** The hero comes from the character generator (no walk cycle in the composite); only 3 of the 12 monster variants appear; there are no NPCs, mounts, pets, buff auras or hit effects.
6. **HUD is a mock.** The glossy frames are good, but the skill slots hold plain gems (no icons), text uses one small font, the minimap is a coarse tile colour map (no fog of war or markers), and nothing is interactive or animated except the cooldown sweep.
7. **16px kits.** `kit-gameboy` has too few tones for a dense forest (the detail pass skips colour patches there on purpose); the map is legible but not pretty.
8. **Water is dark.** The depth ramp goes from bright sand to navy; a polished MMO river is usually a lighter teal with brighter highlights. Fixing it means retuning the shared water depth ramp (`water.ts`), which this lane did not touch.
9. **Existing test blind spot.** `map.test.ts` "never places deco on water" compares tile names to exactly `water`, so it does not see the depth-band water tiles (`water-d1`, `water-s3-4`); `forest-mmo` has its own checks in `map-forest.test.ts`.

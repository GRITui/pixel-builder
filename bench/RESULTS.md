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

## Sprint 6: light, life and height (#54-#59)

- Command: `npm run bench` (offline): 44 briefs, 161 runs, 0 failures. New brief `map-forest-mmo-hills` (forest-mmo, 24x16, `terrain: hills`, `lighting: on`) on all five kits: palette indices 55 (default, neon, same as the flat forest), 53 (gameboy); 0.5-0.8 s in the 16px kits, 1.2-1.5 s in the HD kits (same cost as the flat forest-mmo; the terrain pass adds well under 0.1 s).
- Exit images: `docs/img/mmo-scene.png` (kit-hd-rich, day), `mmo-scene-deep.png` (kit-hd-deep), `mmo-scene-dusk.png` and `mmo-scene.gif` (16 frames, 1.2 MB: water, waterfall and trees move, the hero walks), from `npx tsx scripts/mmo-scene.ts [--gif]` (`TIME=dusk` for another hour). The map is `forest-mmo` with `terrain: hills` and lighting on: a plateau along the north with a dirt cliff, wooden stairs and a waterfall, a monster standing on top.
- A fix found by the run: `monsters-set` failed on every kit at the Sprint 6 wave-1 head (shared monster clips pose joints a given monster rig does not have, which `renderRecipe` treated as an error). Built-in monster rigs now ignore the extra keys; the brief renders again (palette 56, outline 98%).

### Nothing down

Every baseline brief reproduces its Sprint 5 numbers (assets, frames, clips, outline, margin); the only palette-index changes are `monsters-set` 55 to 56 and `trees-hd` 32 to 33 (more colours from the wave-1 creatures and blossom work), none lower.

### Self-ratings, re-scored

| Criterion | Baseline | Sprint 5 | Sprint 6 | Why |
|---|---:|---:|---:|---|
| Readability at 1x | 4 | 5 (HD) | 5 (HD) | Plateau, cliff, stairs and waterfall read at 1x in the HD kits. In `kit-neon` the plateau is hard to see (a thin lip and a low-contrast olive cliff on green) and in `kit-gameboy` the cliff is only a dark band, so those two stay at 3-4. |
| Set consistency | 5 | 5 | 5 | Cliffs, stairs and the waterfall come from the same Painter light and palette ramps; lighting only re-picks palette indices. |
| Animation quality | 4 | 4 | 4 | The map now moves (water, waterfall, tree sway, a walking hero in the GIF), but the hero is the only animated character in the scene, there are still no humanoid impact effects, and the waterfall is a simple 4-frame streak scroll. Not a 5. |
| Direction coverage | 4 | 4 | 4 | Unchanged. |
| Time to result | 5 | 5 | 5 | Terrain adds under 0.1 s. |
| Editability | 5 | 5 | 5 | `terrain`, `ramp`, `cliff` are params; metadata and Tiled carry heights, ramps and waterfalls. |
| Cost | 5 | 5 | 5 | Free, offline. |

Honest reading: no score moves up this sprint on the rubric as written; the gaps the Sprint 5 notes named (no light, flat terrain, static scene) are closed for the HD kits, which the rubric's criteria do not measure directly.

### Known gaps, revisited

Closed: Sprint 5 gap 1 (light and atmosphere: shadows, dapple, reflections, dusk/night grade), 2 (terrain is flat: cliffs, stairs, waterfall, two levels) and 4 (static scene: living map and GIF).

Remaining:

1. **Terrain is simple.** One band plateau on `forest-mmo` (full width, north edge), rectangular plateaus elsewhere; cliffs are one tile high and only the south edge shows a face (west, east and north edges are a rim). No diagonal slopes, no multi-tile cliffs, no caves, no lakes at height, no cliff-hugging paths. A level-2 summit exists only on maps of about 900 cells or more (not on `forest-mmo`).
2. **Neon and Game Boy legibility.** The cliff has low contrast against grass in `kit-neon`; in `kit-gameboy` it is a dark band. Needs per-kit contrast tuning (a darker cliff ramp or a stronger rim).
3. **Plateau is crowded and partly under the HUD** in the exit scene: the trees on top hide most of the plateau and the HUD covers its corners. The generator does not yet leave a clearing on the plateau.
4. **Shadows do not follow height.** Cast shadows treat the cliff face like flat ground (a tree shadow lands on the face as on grass); only the cliff's own foot shadow and rim are height-aware.
5. **Y-sorting is by base line only.** Objects carry `level` for engines, but a character on lower ground north of a plateau is not occluded by the plateau top.
6. **Waterfall.** Water above the cliff does not curve into the fall and there is no mist or splash animation beyond a static foam row.
7. **Carried over:** HUD slots without icons, monsters limited to a few poses in the scene, one hero look, humanoids have no impact effects, a dark water ramp, and the 16px kits stay a mush in dense forest.
8. **The bench** is still self-rated by one rater and has no PixelLab columns.

## Reference match (#67)

`compare_to_reference` scores an asset against a reference image (style distance 0..100: palette, shades, outline, light, detail, silhouette). Three `reference` briefs record the score per kit (`npm run bench -- --brief ref-`, offline, `match` in the console and in `bench/out/report.html`):

| Brief (reference) | kit-default | kit-gameboy | kit-neon | kit-hd-rich | kit-hd-deep |
|---|---:|---:|---:|---:|---:|
| `ref-mmo-forest-map` (crop of `docs/img/mmo-scene.png`) | 69.9 | 62.6 | 65.1 | 78.6 | 67.9 |
| `ref-gameboy-tree` (`test/fixtures/refs/gameboy-4tone.png`) | 44.7 | 69.7 | 43.5 | - | - |
| `ref-pixel-sprite` (`bench/refs/hero-sprite.png`, made with kit-default) | 100 | 62.9 | 70.9 | 86.4 | - |

Reading: the scores order the kits the way the eye does (the HD scene reference is closest to `kit-hd-rich`; the 4-tone handheld reference to `kit-gameboy`; the sprite made in `kit-default` matches itself at 100). Limits: the score is a heuristic over colours, outline mode, light direction, edge density and silhouette, not a perceptual model; it does not see composition, and the light-direction estimate is noisy on busy scenes.

## Sprint 7: farm-mmo (#71)

New brief `map-farm-mmo` (42x26, detail medium, lighting on; all five kits). The `farm` brief is unchanged (the old biome is byte-identical); no existing number moves. `farm-mmo` is planned, not scattered: yard with well, mailbox, garden bed, flower beds and hay; fields in rows of mixed growth stages with an irrigation channel; a fenced pen; pond; orchard; a stream under a bridge; HD woodland around the border. Look at `docs/img/farm-scene.png`: the gap the user named ("farm detail is not as rich as the MMORPG scene") is mostly closed in the HD kits.

Honest gaps: crops do not sway under `animate` (only the scene script animates them; `mapanim` knows props and trees by name); no literal `small-bridge` (the road crosses the stream on the big bridge); the 16px kits read as a dense mush in the woodland ring; villagers are scene-script actors, not map objects (the map only provides `meta.spawns` work spots); the farmer works from the gate lane, not inside the crop rows.

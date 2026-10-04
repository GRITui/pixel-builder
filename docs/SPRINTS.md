# Sprint plan

Every open issue is scheduled into a sprint. Each sprint runs as parallel lanes with
disjoint file ownership, like the rig and Farming Kit rounds:
1. Plan and contracts on the issues.
2. One builder lane per issue.
3. The integrator merges each lane, art-checks it in all 3 kits, and runs the full suite.
4. The PR goes green.

Rules (from `AGENTS.md`):
- Existing default output stays byte-identical unless the issue says otherwise.
- Look at every new asset in kit-default, kit-gameboy and kit-neon.
- Tool changes update `tools.ts`, `SKILL.md` (and its copy), `docs/integrations.md` and `llms.txt` together.

## Sprint 0: land what's built (in progress)
| Issue | Work |
|---|---|
| PR #12 | Rig method and Farming Kit v1. Merging closes #3–#11 and #26–#32. |
| #33 | Farming Kit polish, 5 lanes running: fish, tree fall, male/female cues, barn roof and weather icons, SVG tooling |

**Exit:** #12 merged and #33 closed. This also closes epic #2.

## Sprint 1: farm-ready maps
Use the kit end to end: tiles that auto-tile in engines, consistent animal scale, and farm maps.

| Lane | Issue | Owns | Notes |
|---|---|---|---|
| T | #19 Autotile tileset generator (Wang 16, blob 47) with Tiled, Godot and Unity exports | new `generators/tileset.ts`, new `node/engine-export.ts` | Reuse `edgeShape`/`blendTile` from `map.ts`; it needs exporting, and the integrator does that edit. |
| S | #24 Animal world-scale fitting shared by all render paths | `rigs/fit.ts` (new), `generators/animal.ts`, `ui/rig/recipe.ts`, `RiggedWorkspace.tsx`, the `renderRecipe` part of `node/tools.ts` | Starts after polish P1 merges (shares `animal.ts`). |
| M | #34 Farm map biome (normal and SEA sets) | `generators/map.ts` | Uses #19 tiles if they're ready, otherwise `paintGround`. |

**Exit:** a farm map that exports to Tiled with tiles that auto-tile in Godot, plus a regenerated `farming-v1`. This closes epic #25.

## Sprint 2: artist workflow
Fit into how artists already work: Aseprite, selection edits, 8 directions, and richer character pixels.

| Lane | Issue | Owns | Notes |
|---|---|---|---|
| A | #21 Aseprite export and extension | new `node/aseprite.ts`, `integrations/aseprite/` | Layers come from the SVG layer split (`core/svg.ts` `rigSvgInfo`). |
| I | #18 AI region edit (inpaint) in the editor and the `edit_region` tool | `server/`, `ui/PixelEditor.tsx`, the `edit_region` part of `node/tools.ts` | With no API key, MCP agents supply the replacement rows themselves. |
| D | #17 8 directions and isometric for rigs | `core/rig.ts`, `rigs/*` rest poses, the `directions` param in `character.ts` and `animal.ts` | Largest lane; isometric maps can slip to Sprint 4. |
| R | #36 Rich character pixels at the same resolution (hue-shifted ramps, sel-out, micro-detail, AA) | `kit.ts` `detail`, `palette.ts`, `enforce.ts`, new `rigs/detail.ts`, a small hook in `character.ts` | Opt-in `detail: "rich"`, so standard output stays byte-identical. |

**Exit:** a farmer animated in 8 directions, an `.aseprite` file that opens with the right palette and tags, and a scarf added to a sprite by prompt.

## Sprint 3: AI authoring
Our answer to PixelLab's text-to-character: Claude writes rigs and clips, so results stay animatable and on-kit.

| Lane | Issue | Owns | Notes |
|---|---|---|---|
| R | #15 AI rig author: text to a rig plus attachments | `server/` `/api/rig`, MCP prompt `design_creature`, the "Describe" box in the Rigged mode | Validate and run one repair round with `validateRig`. |
| C | #16 Text to animation clip | `server/` `/api/clip`, the rig editor's "Describe animation" box | Uses the `rigs/joints.ts` contract and `clips.ts` few-shot examples. |

**Needs:** `ANTHROPIC_API_KEY` for the live contact sheets. Tests run on a mocked model.
**Exit:** 10 creature prompts and 8 clip prompts produce valid, animated rigs in 3 kits.

## Sprint 4: team platform and proof
Make it an internal tool the whole team shares, add side-view, and measure against PixelLab.

| Lane | Issue | Owns | Notes |
|---|---|---|---|
| P | #22 Internal deployment and shared team library | `server/` store and auth, Docker, `docs/deploy.md`, web storage switch | Decision needed: auth method (OIDC via proxy, or a shared token) and the store (filesystem, S3 or Postgres). |
| V | #20 Side-view (platformer) camera | `kit.ts` camera field, the side humanoid and its clips, side-view tiles, buildings and parallax backgrounds, the level generator | Adds `camera` to the kit; top-down outputs must stay unchanged. |
| B | #23 Quality benchmark against PixelLab | `bench/`, `scripts/bench.ts` | Runs last so it measures everything above. PixelLab outputs are made by hand, if the licence allows. |

**Exit:** two browsers and one Claude Code session share one library, a side-view starter pack exists, and `bench/RESULTS.md` has a baseline. This closes epic #14.

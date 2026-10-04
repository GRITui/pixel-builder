---
name: pixel-builder
description: Make consistent pixel art for a game (characters, buildings, trees/tiles/environment, props/items, UI, tile maps) with the pixel-builder MCP server or CLI. Use when the user wants sprites, tilesets, icons, a UI kit or a starter asset pack that all share one palette, light and outline style, or wants existing pixel assets recoloured or exported into a game.
---

# pixel-builder: consistent pixel art

pixel-builder generates pixel art from one **Style Kit** (palette ramps, light
direction, outline mode, shade steps, sprite sizes, vibe). Everything you make
with it matches because it all goes through that kit. Use the tools below; do not
hand-write PNGs or invent colours.

## Mental model (this is what makes the output consistent)

1. **Palette ramps, not colours.** 18 materials (`skin`, `wood`, `water`, ...)
   x 5 shades (level 0 = darkest, 4 = lightest). A pixel is a palette index.
   Change the kit and every asset recolours together.
2. **Generators light things for you.** Procedural generators shade volumes
   with the kit's single light direction. Prefer them over painting pixels.
3. **One finishing pass.** Sprites get the kit's outline mode automatically
   (`paint_asset` does it when `outline` is true). Ground tiles are not outlined
   (they must tile seamlessly).
4. **You never bypass the kit.** When you paint, you use only legend characters
   (each = one kit palette entry).

## Tools (MCP tool names = CLI commands in kebab-case)

| Tool | Use it to |
|---|---|
| `get_style_guide` | read the kit (vibe, light, outline, sizes), the **legend** and painting rules. Call first. |
| `list_kits` / `create_kit` / `update_kit` / `set_active_kit` | pick or shape the kit to the game's vibe |
| `list_generators` | see generators and their params (authoritative list) |
| `generate_asset` | procedural asset; saves + exports PNG by default |
| `generate_variations` | contact sheet of 1-12 seeds or param sets (not saved) |
| `paint_asset` | new asset from legend rows (what generators can't do) |
| `edit_asset` | fix pixels or replace a frame of an existing asset |
| `list_assets` / `get_asset` / `delete_asset` | manage the library |
| `export_asset` | `png`, `spritesheet`, `tiled` (maps), `svg` (layered, see below) or `aseprite` (see below) |
| `import_image` | quantise an existing PNG to the kit palette |
| `import_svg` | read a layered SVG back (new asset, or `replace_id` to retexture an existing one): edit by layer, keep `data-material`/`data-level` or use kit colours, the `guides` layer is ignored |
| `rerender_assets` | regenerate procedural and rigged assets after a kit change |
| `list_rigs` / `list_clips` / `list_attachments` | rigs, animation clips and accessories (with family); ids for `generate_rigged` |
| `generate_rigged` | animated character: rig + `slots` + `attachments` + `clips` -> walk/idle rows in 4 directions, exported as a spritesheet |
| `attach` | add/remove attachments (hat, tool) on a saved rigged asset; re-renders every frame |
| `create_rig` / `create_clip` / `create_attachment` | author your own rig/clip/attachment as JSON (see `docs/RIG.md`); validated and stored in the project |
| `generate_pack` | build a whole starter set in one call: built-in `farming-v1` (104 assets) or your own `manifest` of generate_asset/generate_rigged inputs; `only` filters by tag (`sea`, `normal`, `building`, `tool`...), re-running replaces in place, writes `.svg` too |

**Aseprite.** `export_asset format=aseprite` writes `<slug>.aseprite`: INDEXED colour mode with the kit palette as the file palette (index 0 transparent, sprite indices map 1:1, so the palette is locked to the kit), one layer per rig part (rigged assets) or per material, all animation rows laid out as consecutive frames with one tag per row (`walk-down`...), frame duration from fps. Re-exporting the PNG (`rerender_assets`, `attach`...) refreshes an existing `.aseprite` too. Artists can also use the Aseprite extension in `integrations/aseprite/`.

**SVG round trip.** `export_asset format=svg` (and `generate_pack`, by default) writes `<slug>.svg`: one layer per material (per part for rigged assets: core, hair, hat...), frames as a grid, and a locked `guides` layer (pixel/tile grid, ground line, frame labels, joints). Pixels are rectangle `<path>`s (one per colour per frame; `fill`/`data-material`/`data-level` sit on the layer and colour groups, repeated map tiles are `<symbol>`/`<use>`), and plain `<rect>`s are read too. Any tool that re-exports an asset's PNG (`rerender_assets`, `attach`, `edit_asset`, ...) also rewrites its `.svg` if one exists, so it never goes stale. Open it in Inkscape/Figma or edit the XML, then `import_svg`.

Every call that makes or changes an asset returns a **preview image**. Always
look at it before moving on.

## What the generators can make (highlights)

- `character`: rigged humanoids built from a core + layers: `sex` (male/female), `age` (baby, kid, young-adult, senior, elder), `hair_style`, `facial` (beard, mustache, glasses, freckles, wrinkles), `costume` (overalls, dress, apron, sarong, smock, sweater), `headwear` (straw-hat, ngob-hat, cap, bonnet, bandana, beanie...), `bag` (backpack, satchel, tote, basket); 4-direction walk.
- `animal`: rigged cow, sheep, water buffalo, dog, cat, horse, pig, chicken, rooster, duck, fish, catfish; `age` adult or baby; idle/walk/graze (or peck/flap, or swim).
- `building`: cottage, shop, tower, keep, barn, `stilt-house` (raised Southeast-Asian house; `access` stairs/ladder) and `half-brick` (two-storey Thai house: masonry ground floor, wooden upper floor, balcony gable; 1.5x building width); `farmhouse` and `coop` with `size` small/medium/large (barn has a large gambrel version; red barn = `wall: "cloth2", trim: "sand"`); roofs gable, hip, flat, dome, spire, `corrugated` (use `roof: "metal"` for zinc).
- `environment`: props with animation rows (trees: sway/chop/fall/stump when `cuttable`; `old-oak` landmark; bush/weed cut; rock break), `fence` (`piece`: h, v, post, corners, T, cross, gates), seamless tiles incl. animated `water-tile`, `paddy-tile` and soil `tilled-soil-tile`, `watered-soil-tile`, `dried-soil-tile`, `snowed-soil-tile`.
- `object`: items plus farm tools `hoe`, `watering-can`, `tool-axe`, `pickaxe`, `sickle`, `hammer`, `fishing-rod`, `seed-bag` (rows `icon` + `use` effect sprite).
- `ui`: buttons, panels, slots, bars, plus HUD `clock` (`hour`), `time-panel`, `date-panel` (`day`, `weekday`, `season`), `weather-icon` (sunny, cloudy, rain, storm, snow, windy), `season-icon`.
- `map`: biomes meadow, forest, island, desert, winter, `rice-village`, `farm` (farmstead, fenced fields with gates, pen with animals, pond; `set` normal or `sea`).
- Rigged assets (`generate_rigged`): any rig (incl. `human-<male|female>-<baby|kid|young-adult|senior|elder>`) + clips (idle, walk, run, attack, farm, carry, sit, chop, water, mine, fish) + attachments (layers `face-*`, `hair-*`, `costume-*`, `hat-*`, `bag-*`, tools `hoe`, `axe`, `watering-can`, `pickaxe`, `hammer`, `fishing-rod`...); add/remove accessories later with `attach`. Built-in humanoid rigs get short hair and a face by default; pick another `hair-short|long|spiky|ponytail|bald` attachment, or `no-face` to opt out.

## Workflow

1. **Style first.** `get_style_guide`. If the game has no kit yet (or the active
   one doesn't fit), `create_kit` (name, optional `base_kit_id`, `changes` such as
   `paletteId`, `outline`, `lightDir`, `shadeSteps`, `dither`, `sizes`, `vibe`),
   then `set_active_kit`. Do this before generating anything. Changing the kit
   later means `rerender_assets`.
2. **Pick a generator.** `list_generators` (optionally with `category`). Read the
   param specs; use real option values, materials come from the 18 names.
3. **Generate.** `generate_asset` with `generator`, `params`, `seed`, `name`.
   Look at the preview. If it's close, change one or two params and regenerate.
4. **Explore cheaply.** `generate_variations` (`count` 6; `vary: "seed"` for
   shape variety with your params pinned, `"params"` to randomise what you didn't
   pin). The sheet is numbered left-to-right, top-to-bottom; the result lists each
   number's `{seed, params}`. Pick the best and call `generate_asset` with exactly
   those.
5. **Hand-paint only the gaps.** Logos, signs with text, a one-off emblem, a
   special frame. Use `paint_asset` (new) or `edit_asset` (fix). Rules below.
6. **Check as a set.** `list_assets` / `get_asset`; assets of the same category
   should read as one family. Fix outliers (change materials or regenerate).
7. **Ship.** `generate_asset` and `paint_asset` already export to
   `<workspace>/<category folder>/<slug>.png` (animated assets export as a
   spritesheet plus `<slug>.json` meta; maps also get `<slug>.tiled.json`). Use `export_asset` for another scale or format.
   Report the file paths to the user.

## Painting with the legend

`get_style_guide` returns the legend: `<char> = <material> level <0-4> (<hex>)`,
and `.` = transparent. The character for a material/level never changes between
kits, so rows written for one kit decode in any other. Only the hex differs.
The static table is in [reference.md](reference.md).

`paint_asset` input:

```json
{
  "name": "heart-icon", "category": "object", "width": 10, "height": 10,
  "frames": [[
    "..........",
    "..]]..]]..",
    ".]^^]]]]].",
    ".]^]]]]][.",
    ".]]]]]]][.",
    "..]]]]]][.",
    "...]]]][..",
    "....][[...",
    ".....[....",
    ".........."
  ]],
  "outline": true
}
```

(Illustrative: `[ ] ^` are the `accent` ramp at levels 1-3, with light from the
top-left; the outline is added for you. Always take chars from `get_style_guide`.)

Rules:

- `frames` is `string[][]`: one inner array per frame, each inner array has
  exactly `height` strings of exactly `width` characters.
- Use only legend characters. Dark -> light by level: shadow side (away from the
  kit's `lightDir`) uses low levels, lit side high levels. 3-4 levels per
  material is enough; do not use all 5 everywhere.
- Leave a 1px transparent margin so the outline fits. Keep silhouettes simple
  and readable at 1x.
- Animated assets: pass several frames and `fps`. With `row_names` (e.g.
  `["walk-down","walk-up"]`) the frames are split evenly across the rows in
  order, so give a multiple of the row count. Maps can't be painted.
- Match the sizes in the style guide (`sizes.character`, `.object`, ...); don't
  invent new sprite sizes for a category.
- Keep `outline: true` and `cleanup: true` unless you are touching up a sprite
  that already went through them.
- `edit_asset`: `pixels: [{x, y, char}]` for touch-ups, `rows` to replace a
  frame (`row` + `frame` select it). Re-look at the preview after every edit.

## Consistency rules (read before generating)

- Stay in the kit palette. Never ask for or paint arbitrary hex colours; to get a
  different colour, choose a different material or edit the kit.
- Let generators do lighting. Do not shade volumes by hand; hand-painting is for
  details (eyes, sparkles, seams, text).
- Same game = same kit. Don't mix kits for assets that appear together.
- Use the same material for the same thing everywhere (all wooden things
  `wood`, all water `water`, ...), and the same `variant` families per set.
- Tiles must be seamless and un-outlined; generate them with the environment
  generator's `*-tile` kinds, don't paint them.
- Look at every preview. If it doesn't read at 1x, regenerate; don't ship hoping.
- Name assets in a predictable scheme (`tree-oak`, `npc-blacksmith`,
  `ui-button`), and pass `name` explicitly.

## Workspace and files

Assets live in a workspace directory (`--workspace <dir>`, else env
`PIXEL_BUILDER_WORKSPACE`, else `./pixel-assets`). The project is
`<workspace>/pixel-builder.json`; exports are in `<workspace>/<category folder>/`
(`characters/`, `buildings/`, `environments/`, `objects/`, `ui/`, `maps/`).
Copy or point the game at those files. MCP also exposes the resources
`pixel-builder://project` and `pixel-builder://style-guide`, and a prompt
`asset_pack` (`game`, `count`) that walks through a starter pack.

## No MCP? Use the CLI

Same commands, kebab-case, flags = input names in kebab-case. From the
pixel-builder repo: `npx tsx src/node/cli.ts <command> --json` (or
`pixel-builder <command>` after `npm link`). `--json` prints
`{"ok": true, ...result, "previews": [paths]}` (errors: `{"ok": false, "error"}`).
Preview images are saved to `<workspace>/.previews/`; open those PNGs with your
image-reading tool to look at them. The first positional argument is the main
input (`generator`, `id`, `name`, `kit_id` or `path`); arrays/objects take JSON,
`@file.json`, or `k=v,k=v`. `pixel-builder <command> --help` lists every option.

```bash
pixel-builder get-style-guide
pixel-builder list-generators --category object
pixel-builder generate-variations environment --params kind=oak --count 6
pixel-builder generate-asset environment --params kind=oak --seed 42 --name "oak tree"
pixel-builder paint-asset --name gem --category object --width 8 --height 8 --frames @gem.json
pixel-builder export-asset "oak tree" --format spritesheet --scale 4 --out-dir ./game/art
```

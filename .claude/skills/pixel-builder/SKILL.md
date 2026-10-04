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
| `list_kits` / `create_kit` / `update_kit` / `set_active_kit` | pick or shape the kit to the game's vibe. Kits can be `locked` (house style): `update_kit` refuses them, so fork with `create_kit base_kit_id=<locked>` and edit the copy. Kits carry a `version` (bumped by `update_kit`); assets record `kitVersion`, and `list_assets` flags `stale` ones. Presets: `kit-default`, `kit-gameboy`, `kit-neon`, and the HD trio `kit-hd` / `kit-hd-rich` / `kit-hd-deep` (every size 1.5x: 48px characters, 24px tiles; `kit-hd-deep` adds 9-shade ramps (`rampDepth` 7 or 9) for smoother volumes, and its legend gains extra non-ASCII chars for the in-between shades; keep one kit per game). `kit-side` is the platformer camera: generators `sideview` (ground tiles, slopes, platform, ladder, front-on house, tiling sky/hills/trees layers), `sideenemy`, `sidelevel` (Tiled-exportable level), rig `humanoid-side` with clips jump/fall/climb/crouch (plus `jump-snappy`; attachment `knight-trim` adds a tabard, cape and gold hem). Humanoid clips `attack-snappy`, `chop-snappy`, `mine-snappy` add anticipation, smear and follow-through, and `detail: "rich"` kits use them automatically for `attack`/`chop`/`mine`/`jump`; pack `side-view-starter`. `kit-iso` is the isometric (2:1 dimetric) camera: a 32x16 diamond tile, light from the top-left (left wall lit, right wall shaded). Generators `iso-tile` (grass/dirt/sand/water/stone diamonds that tile seamlessly, `height` 1-2 raises them into lit blocks), `iso-prop` (tree, pine, rock, bush, fence-se / fence-sw along the two iso axes, post), `iso-building` (gable house on an n x n footprint showing two walls) and `isomap` (path, ponds, hills, props, a fenced house; Tiled export with `orientation: isometric`, a ground tile layer and a y-sorted `props` object layer). Rigged characters and the `character` generator draw the four iso diagonals as rows `<clip>-se|sw|ne|nw` (`directions: 8` adds `s|e|n|w`); pack `iso-starter`. Monsters: rigs `monster-mushroom-{red,brown,poison,king}`, `monster-slime-{green,blue,fire,metal}`, `monster-plant`, `monster-bat`, `monster-wolf`, `monster-skeleton` (families monster/beast/undead) with clips idle, walk, attack, hurt (hit flash), die (puff); pack `monsters-v1`. |
| `list_generators` | see generators and their params (authoritative list) |
| `generate_asset` | procedural asset; saves + exports PNG by default |
| `generate_variations` | contact sheet of 1-12 seeds or param sets (not saved) |
| `paint_asset` | new asset from legend rows (what generators can't do) |
| `edit_asset` | fix pixels or replace a frame of an existing asset |
| `edit_region` | change only a rect or cell region (add a scarf, recolour a hat): your own `rows`, or `prompt` with an API key |
| `list_assets` / `get_asset` / `delete_asset` | manage the library |
| `export_asset` | `png`, `spritesheet`, `tiled` (maps), `svg` (layered, see below), `aseprite` (see below) or, for `tileset` assets, `tiled-tileset` / `godot` / `unity` / `atlas` (engine autotile files, see reference) |
| `import_image` | quantise an existing PNG to the kit palette |
| `import_svg` | read a layered SVG back (new asset, or `replace_id` to retexture an existing one): edit by layer, keep `data-material`/`data-level` or use kit colours, the `guides` layer is ignored |
| `rerender_assets` | regenerate procedural and rigged assets after a kit change (`stale_only` = only assets made with an older kit version) |
| `list_rigs` / `list_clips` / `list_attachments` | rigs, animation clips and accessories (with family); ids for `generate_rigged` |
| `generate_rigged` | animated character: rig + `slots` + `attachments` + `clips` -> walk/idle rows in 4 directions (`directions: 8` adds the 3/4 diagonals down-right, up-right, up-left, down-left), exported as a spritesheet |
| `attach` | add/remove attachments (hat, tool) on a saved rigged asset; re-renders every frame |
| `create_rig` / `create_clip` / `create_attachment` | author your own rig/clip/attachment as JSON (see `docs/RIG.md`); validated and stored in the project |
| `generate_pack` | build a whole starter set in one call: built-in `farming-v1` (104 assets), `iso-starter` (kit-iso hero, tiles, props, house, map) or `monsters-v1` (12 monsters x idle/walk/attack/hurt/die) or your own `manifest` of generate_asset/generate_rigged inputs; `only` filters by tag (`sea`, `normal`, `building`, `tool`...), re-running replaces in place, writes `.svg` too |

**Aseprite.** `export_asset format=aseprite` writes `<slug>.aseprite`: INDEXED colour mode with the kit palette as the file palette (index 0 transparent, sprite indices map 1:1, so the palette is locked to the kit), one layer per rig part (rigged assets) or per material, all animation rows laid out as consecutive frames with one tag per row (`walk-down`...), frame duration from fps. Re-exporting the PNG (`rerender_assets`, `attach`...) refreshes an existing `.aseprite` too. Artists can also use the Aseprite extension in `integrations/aseprite/`.

**SVG round trip.** `export_asset format=svg` (and `generate_pack`, by default) writes `<slug>.svg`: one layer per material (per part for rigged assets: core, hair, hat...), frames as a grid, and a locked `guides` layer (pixel/tile grid, ground line, frame labels, joints). Pixels are rectangle `<path>`s (one per colour per frame; `fill`/`data-material`/`data-level` sit on the layer and colour groups, repeated map tiles are `<symbol>`/`<use>`), and plain `<rect>`s are read too. Any tool that re-exports an asset's PNG (`rerender_assets`, `attach`, `edit_asset`, ...) also rewrites its `.svg` if one exists, so it never goes stale. Open it in Inkscape/Figma or edit the XML, then `import_svg`.

Every call that makes or changes an asset returns a **preview image**. Always
look at it before moving on.

## What the generators can make (highlights)

- `character`: rigged humanoids built from a core + layers: `sex` (male/female), `age` (baby, kid, young-adult, senior, elder), `hair_style`, `facial` (beard, mustache, glasses, freckles, wrinkles), `costume` (overalls, dress, apron, sarong, smock, sweater), `headwear` (straw-hat, ngob-hat, cap, bonnet, bandana, beanie...), `bag` (backpack, satchel, tote, basket); 4-direction walk. New: `pattern` (none, plaid, stripes, polka, gingham; patterns the shirt/dress, or the apron/sarong cloth, along its own ramp) and `expression` (neutral, happy, surprised, tired). Rich kits and 48px canvases also get shaped hands, hair clumps, collars, cuffs, pockets and 2x3 eyes automatically; 32px standard output is unchanged.
- `animal`: rigged cow, sheep, water buffalo, dog, cat, horse, pig, chicken, rooster, duck, fish, catfish; `age` adult or baby; idle/walk/graze (or peck/flap, or swim).
- `building`: cottage, shop, tower, keep, barn, `stilt-house` (raised Southeast-Asian house; `access` stairs/ladder) and `half-brick` (two-storey Thai house: masonry ground floor, wooden upper floor, balcony gable; 1.5x building width); `farmhouse` and `coop` with `size` small/medium/large (barn has a large gambrel version; red barn = `wall: "cloth2", trim: "sand"`); roofs gable, hip, flat, dome, spire, `corrugated` (use `roof: "metal"` for zinc).
- `environment`: props with animation rows (trees: sway/chop/fall/stump when `cuttable`; `old-oak` landmark; bush/weed cut; rock break), `fence` (`piece`: h, v, post, corners, T, cross, gates), seamless tiles incl. animated `water-tile`, `paddy-tile` and soil `tilled-soil-tile`, `watered-soil-tile`, `dried-soil-tile`, `snowed-soil-tile`.
- `foliage`: lush HD trees from lit leaf clusters (flared barked trunk, limbs, ragged crown, ground shadow); `species` oak, willow, maple-autumn, birch, fruit-tree, pine-hd, sakura; `size` small/medium/large (48/64/96 px square); `season` spring/summer/fall/winter (recolour, snow in winter); `leaf`, `accent` (fruit/blossom) materials, `variant` 0-9; rows idle + sway. Uses the extra shades on deep kits (see `docs/img/foliage.png`). The `environment` trees are unchanged.
- `object`: items plus farm tools `hoe`, `watering-can`, `tool-axe`, `pickaxe`, `sickle`, `hammer`, `fishing-rod`, `seed-bag` (rows `icon` + `use` effect sprite).
- `ui`: buttons, panels, slots, bars, plus HUD `clock` (`hour`), `time-panel`, `date-panel` (`day`, `weekday`, `season`), `weather-icon` (sunny, cloudy, rain, storm, snow, windy), `season-icon`. MMO HUD: set `skin` to `mmo-gold`, `mmo-stone` or `mmo-dark` (default `wood` is unchanged) to get glossy `bar`/`panel`/`button`/`slot`, and the kinds `unit-frame` (`name`, `level`, `hp`, `mp`, `xp`, `portrait` none|silhouette|hero), `minimap-frame` (`shape` round|square; `meta.mapRect`), `skill-bar` (`slots`, `cooldown` 0-8; a `sweep` row has all 9 steps), `chat-panel`, `quest-tracker`, `tooltip` (`rarity`), `nameplate` (`name`, `level`, `hp`, `tone`) and `damage-numbers` (`amount`, `tone` white|yellow|red|green, `crit`; 4 rise frames). Compose them over a map with `scripts/mmo-hud.ts` (see `docs/img/mmo-hud.png`).
- `map`: biomes meadow, forest, island, desert, winter, `rice-village`, `farm` (farmstead, fenced fields with gates, pen with animals, pond; `set` normal or `sea`).
- Water depth (`environment` + `map` + `tileset`): `water-tile` takes `depth` 0 shallow (sandy bottom) .. 3 abyss (absent/-1 = classic), `shore` (letters of `nesw` = land sides: animated foam line + wet sand bank) and `shore_rocks`; props `lily-pad` (`flower`), `reeds`, `cattail`, `river-rock`, `driftwood` (animated) and `small-bridge` (`span` 1-3, `trunk` wood | stone). `map` `water_depth: true` shades water by distance to shore (smooth gradient, foam, wet banks, lily pads, reeds); `river: true` carves a river across meadow/forest/winter. `tileset` `lower_depth` / `upper_depth` make water depth-band autotiles (water over water). Defaults are unchanged. Deep kits use the finer ramp shades for the gradient.
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
- `edit_region`: to add or change one part (scarf, hat colour) without touching
  the rest, select `rect: {x,y,w,h}` (or `cells`) and give `rows` for that
  selection's bounding box (read pixels with `get_asset include_pixels`; an
  invalid answer lists the box's current rows). Only the selected cells change
  and the outline is redone around them only. `prompt` instead of `rows` asks
  the server model and needs `ANTHROPIC_API_KEY`. `all_frames` repeats it on
  every frame of the row. For rigged assets prefer an attachment.

## Authoring an animation clip (text to motion, you write the JSON)

When no built-in clip does what the user asks ("bow politely (wai)", "pick up the basket then walk",
"the goat headbutts"), write the clip yourself and call `create_clip` with `rig` set, so it is
validated and previewed on that rig. No API key is needed (the web app's "Describe animation" box and
`POST /api/clip` do the same with the server model).

1. `list_rigs` for the rig and its family, `list_clips family=...` to read a similar clip.
2. A clip is `{id, fps, frames}`. A pose is `{joint: [dx, dy]}` in grid units (design grid 32), `[0,0]`
   is the rest pose (omit rested joints). **x grows right, y grows DOWN** (`dy < 0` lifts). Children
   inherit their parent's offset: `hip` moves both legs, so a bob down needs a negative `dy` on the feet.
3. Give per-view frames `{down, side, up}` with the **same number of frames** in each (side faces right;
   swing limbs on x in `side`, lift on y in `down`/`up`). Use 4-8 frames, `fps` 4-8 for gestures. Make
   frame 0 the rest pose and the last frame return towards it so it loops.
4. Joints per family (see `joints.ts`): humanoid `hip chest neck head shoulderL/R elbowL/R handL/R kneeL/R footL/R`;
   quadruped `body neck head jaw tail shoulderFL/FR kneeFL/FR footFL/FR hipBL/BR kneeBL/BR footBL/BR`;
   bird `body head beak tail wingL wingR legL footL legR footR`; fish `body head tail finTop finL finR`.

Worked example, "bow politely (wai)" on `human-male-young-adult` (hands rise to the chest, the torso
folds forward with the head, a short hold, then up; feet planted):

```json
{"id":"wai-bow","fps":4,"frames":{
 "side":[{},
  {"elbowL":[1,-1],"elbowR":[1,-1],"handL":[2,-2],"handR":[2,-2]},
  {"hip":[0,1],"chest":[1,2],"head":[1,1],"elbowL":[1,-1],"elbowR":[1,-1],"handL":[2,-2],"handR":[2,-2],"footL":[0,-1],"footR":[0,-1]},
  {"hip":[0,1],"chest":[1,2],"head":[1,1],"elbowL":[1,-1],"elbowR":[1,-1],"handL":[2,-2],"handR":[2,-2],"footL":[0,-1],"footR":[0,-1]},
  {"chest":[0,1],"elbowL":[1,-1],"elbowR":[1,-1],"handL":[1,-2],"handR":[1,-2]}],
 "down":[{},
  {"elbowL":[0.5,-1],"elbowR":[0.5,-1],"handL":[1,-2],"handR":[1,-2]},
  {"hip":[0,1],"chest":[0.5,2],"head":[0.5,1],"elbowL":[0.5,-1],"elbowR":[0.5,-1],"handL":[1,-2],"handR":[1,-2],"footL":[0,-1],"footR":[0,-1]},
  {"hip":[0,1],"chest":[0.5,2],"head":[0.5,1],"elbowL":[0.5,-1],"elbowR":[0.5,-1],"handL":[1,-2],"handR":[1,-2],"footL":[0,-1],"footR":[0,-1]},
  {"chest":[0,1],"elbowL":[0.5,-1],"elbowR":[0.5,-1],"handL":[0.5,-2],"handR":[0.5,-2]}],
 "up":[{},{"elbowL":[0.5,-1],"elbowR":[0.5,-1]},{"hip":[0,1],"chest":[0.5,2],"head":[0.5,1],"footL":[0,-1],"footR":[0,-1]},{"hip":[0,1],"chest":[0.5,2],"head":[0.5,1],"footL":[0,-1],"footR":[0,-1]},{"chest":[0,1]}]}}
```

Then `generate_rigged` with `clips: ["wai-bow", "idle"]`, look at the sheet, adjust, call `create_clip`
again with the same id (it replaces). Rules (the server enforces the same ones for `/api/clip`):

- Only joints of the rig's family; an unknown joint is an error.
- Offsets within +-6 grid units (+-8 when the motion is a jump, hop, leap or flap).
- Planted feet stay on the ground: a foot's own `dy` plus its parents' `dy` must not be > 0 (no sinking), and
  at least one foot stays within 2 units of the ground in every frame, unless the motion leaves the ground on purpose.
- 2-12 frames per view, the same count in every view, `fps` 1-30.
- Check at 1x: if the motion does not read, exaggerate the key pose, not the offsets of every joint.

## Authoring a creature yourself (no API key)

The web app's "Describe" box (`POST /api/rig`) needs a server key; you do not.
You can write the same JSON. The MCP prompt `design_creature`
(`description`, `family?`) walks through it:

1. `list_rigs`: if a built-in rig fits the body (people, common animals, birds,
   fish) keep it and author only attachments plus `slots`. Otherwise write a rig.
2. Rig JSON: `{id, name, grid: 32, joints:[{id, parent, rest}], parts:[...], slots:{slot: material}}`.
   One root joint, absolute `rest: [x, y]` on the 32 grid (y down; or per view
   `{down, side, up}`), 1px margin, side view faces right. Parts: `ellipse
   {joint, rx, ry, dx?, dy?}`, `box {joint, w, h}`, `limb {from, to, r}`; each
   with a unique `id`, `z` (higher = in front, may be per view) and a `slot`
   (or a material name). Use `views: ["down","side"]` for eyes and faces. Reuse
   a family's joint names (humanoid, quadruped, bird, fish: see `list_rigs`) to
   inherit its clips and attachments; a free-form skeleton needs its own clips.
3. `create_rig {rig}` (validated, test-rendered in 3 views), `create_clip`
   for `idle` and `walk`, `create_attachment {rig, attachment}` for props.
4. `generate_rigged {rig, clips: ["idle","walk"]}`, look at the sheet, fix, repeat.

Worked example, a river crab (one root, two claws, legs):

```json
create_rig { "rig": {
  "id": "river-crab", "name": "River crab", "grid": 32,
  "slots": { "shell": "accent", "eye": "ink" },
  "joints": [
    { "id": "body", "parent": null, "rest": [16, 19] },
    { "id": "clawL", "parent": "body", "rest": { "down": [7, 11], "side": [20, 13], "up": [7, 11] } },
    { "id": "clawR", "parent": "body", "rest": { "down": [25, 11], "side": [22, 13], "up": [25, 11] } },
    { "id": "footL0", "parent": "body", "rest": [8, 22] },
    { "id": "footR0", "parent": "body", "rest": [24, 22] }
  ],
  "parts": [
    { "id": "legL0", "kind": "limb", "from": "body", "to": "footL0", "r": 0.9, "slot": "shell", "z": 1 },
    { "id": "legR0", "kind": "limb", "from": "body", "to": "footR0", "r": 0.9, "slot": "shell", "z": 1 },
    { "id": "shell", "kind": "ellipse", "joint": "body", "rx": 9, "ry": 6, "slot": "shell", "z": 3 },
    { "id": "pincerL", "kind": "ellipse", "joint": "clawL", "rx": 3, "ry": 2.5, "slot": "shell", "z": 4 },
    { "id": "pincerR", "kind": "ellipse", "joint": "clawR", "rx": 3, "ry": 2.5, "slot": "shell", "z": 4 }
  ] } }
create_clip { "rig": "river-crab", "clip": { "id": "crab-idle", "fps": 3, "frames": [{}, { "clawL": [0, -1], "clawR": [0, -1], "body": [0, 0.5] }] } }
create_clip { "rig": "river-crab", "clip": { "id": "crab-walk", "fps": 8, "frames": [{ "footL0": [-1, -1] }, { "body": [0, 0.5] }, { "footR0": [1, -1] }, { "body": [0, 0.5] }] } }
generate_rigged { "rig": "river-crab", "clips": ["crab-idle", "crab-walk"] }
```

Extending instead ("a monk in saffron robes carrying an alms bowl"):
`create_attachment {rig: "humanoid-normal", attachment: {id: "alms-bowl", name: "Alms bowl", parts: [{id: "bowl", kind: "ellipse", joint: "handL", dy: 1, rx: 3, ry: 2, slot: "metal", z: 6}]}}`
then `generate_rigged {rig: "humanoid-normal", slots: {top: "gold"}, attachments: ["alms-bowl"], clips: ["idle","walk"]}`.
Name your own clips with a prefix (`crab-idle`): a built-in clip with the same id wins.

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
Team setups: `--workspace` / `PIXEL_BUILDER_WORKSPACE` may also be a URL
`http(s)://host/api/projects/<id>` of a shared pixel-builder server; the project is then
loaded and saved through its API (token in env `PIXEL_BUILDER_TOKEN`) while exports still
go to a local folder (`--out-dir <dir>` or env `PIXEL_BUILDER_OUT_DIR`, default `./pixel-assets`).
See `docs/deploy.md`.
Copy or point the game at those files. MCP also exposes the resources
`pixel-builder://project` and `pixel-builder://style-guide`, and a prompt
`asset_pack` (`game`, `count`) that walks through a starter pack, and `design_creature` (`description`, `family?`) for authoring a rigged creature.

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

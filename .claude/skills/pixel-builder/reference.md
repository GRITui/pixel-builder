# pixel-builder reference

Supporting detail for [SKILL.md](SKILL.md). The live source of truth is always
the server: `get_style_guide` (legend, kit) and `list_generators` (params).

## Legend (fixed for every kit)

`.` = transparent. Each material has 5 consecutive characters, **level 0
(darkest) to level 4 (lightest)**. The characters never change between kits;
only the hex colours do.

| Material | Chars (L0..L4) | Typical use |
|---|---|---|
| ink | `abcde` | outlines, darkest details |
| skin | `fghij` | skin |
| hair | `klmno` | hair |
| cloth | `pqrst` | clothing, banners |
| cloth2 | `uvwxy` | second clothing colour |
| leather | `zABCD` | belts, boots, bags |
| metal | `EFGHI` | steel, armour, tools |
| gold | `JKLMN` | gold, brass, coins |
| wood | `OPQRS` | wood, furniture |
| stone | `TUVWX` | stone, rock |
| roof | `YZ012` | roof tiles |
| foliage | `34567` | leaves, bushes |
| grass | `89!#$` | grass ground |
| dirt | `%&()*` | dirt, paths |
| sand | `+,-/:` | sand, skin tone alt |
| water | `;<=>?` | water, ice |
| accent | `@[]^_` | magic, gems, highlights |
| ui | `` `{\|}~ `` | UI chrome |

(Characters verified against `src/core/legend.ts`. In the `ui` row the five
chars are backtick, `{`, `|`, `}`, `~`.)

## Kits

Style Kit fields (`create_kit` / `update_kit` `changes`):

| Field | Values |
|---|---|
| `paletteId` | `hearthwood` (default), `neon-dusk`, `ashen`, `gameboy` |
| `rampOverrides` | per-material 5 hex colours dark -> light, e.g. `{"water": ["#10243f", ...]}` |
| `outline` | `none`, `black`, `colored`, `selective` |
| `lightDir` | `top-left`, `top`, `top-right` |
| `shadeSteps` | 2-5 (fewer = flatter, chunkier) |
| `dither` | true / false |
| `ambient` | 0-1 (raises the darkest shade on shadow sides) |
| `sizes` | `character`, `building`, `environment`, `object`, `ui`, `tile` in px |
| `vibe` | free text art direction |

Built-in kits: `kit-default` (Cozy RPG), `kit-gameboy` (Handheld Classic),
`kit-neon` (Neon Dusk). Matching the kit to the game's mood first is the single
biggest consistency win: pick palette + outline + light, then size the sprites.

## Generators (snapshot; call `list_generators` for the exact current specs)

| id | category | What it makes | Key params |
|---|---|---|---|
| `character` | character | top-down RPG humanoid or slime, 4-direction x 4-frame walk | `archetype`, `build`, `skin`, `hair`, `hair_style`, `top`, `bottom`, `boots`, `headwear`, `weapon`, `accent_mat`, `cape` |
| `building` | building | 3/4 view cottage / shop / tower / keep / barn | `style`, `wall`, `roof`, `roof_style`, `floors` 1-3, `width`, `lit_windows`, `chimney`, `trim` |
| `environment` | environment | trees, bushes, rocks, flowers, crystals, and seamless ground tiles (`water-tile` animates) | `kind`, `foliage`, `trunk`, `stone`, `accent`, `variant` 0-9 |
| `object` | object | 16px items and props (chest, barrel, potion, sword, coin, torch, gem, ...) | `kind`, `main`, `accent` (`natural` = the item's own colours, or any material to re-skin), `variant` |
| `ui` | ui | button (normal/hover/pressed), panel (9-slice), slot, bar (frame/fill), icon-frame, cursor, tab, checkbox, dialog-arrow | `kind`, `material`, `accent`, `width`, `height`, `style` |
| `map` | map | procedural tile map from the kit's tiles and props | `biome` (meadow/forest/island/desert/winter), `cols`, `rows`, `density`, `path` |

Material params take one of the 18 material names (each param lists its own
allowed subset; objects also accept `natural`). `seed` changes shapes within a
generator; characters are fully parametric (seed has no effect). `ui` `width` /
`height` of 0 mean the generator's default size for that `kind`.

Choosing a generator: can a generator express it? Use it (consistent lighting
for free). Only if it can't (a specific logo, an unusual creature, a custom
icon) use `paint_asset`, and keep it in the same sizes and materials.

## Assets, outputs, formats

- Asset = one or more animation rows of frames + `fps`. Static assets have one
  row, one frame. `category` is one of `character`, `building`, `environment`,
  `object`, `ui`, `map`.
- Exports go to `<workspace>/<folder>/<slug>.png`, folder = `characters`,
  `buildings`, `environments`, `objects`, `ui` or `maps`. Animated assets export
  as a spritesheet PNG plus `<slug>.json` (image, frame size, columns/rows, fps,
  animations by row, nineSlice meta); maps also get `<slug>.tiled.json` (a
  Tiled-compatible map) with `<slug>.tileset.png` / `<slug>.deco.png`.
- `export_asset` `format`: `png` (static image, or spritesheet if animated),
  `spritesheet` (always PNG + JSON), `tiled` (maps only). `scale` is an integer
  upscale (1-16, nearest-neighbour); for engines, prefer 1x and scale in the
  engine. `out_dir` overrides the folder.
- Tools that take an asset `id` also accept its exact name if unambiguous.
- UI panels carry `meta.nineSlice {left, top, right, bottom}`: use it for
  9-slice scaling instead of stretching.

## Starter pack recipe (what the `asset_pack` prompt does)

1. `get_style_guide`; set or create the kit from the game's vibe.
2. Hero + 1-2 NPCs: `character` with different `top`/`hair`/`headwear`.
3. 2-3 buildings: `building` styles with the same `roof` family.
4. Ground tiles: `grass-tile`, `dirt-tile`, `water-tile`, a path tile; trees,
   bushes, rocks: `environment`.
5. 6-10 items: `object` (chest, potion, key, coin, sword, heart).
6. UI: `button`, `panel`, `slot`, `bar`, `cursor` at the kit's `sizes.ui`.
7. Optional: a `map` that uses them; export everything; list the paths.

## Troubleshooting

Tool errors come back as readable messages (MCP `isError`, CLI `{"ok": false}` and
exit code 1; usage errors exit 2). Common causes:

- Painting: every row must be exactly `width` chars and each frame exactly
  `height` rows; use only legend characters (`.` = transparent; quotes,
  backslash and space are never legend chars); a frame with no painted pixels is
  rejected. `paint_asset` / `edit_asset` can't make or change maps.
- After `update_kit`: palette/ramp changes recolour existing assets by
  themselves (they store palette indices); outline, light, shade steps, dither,
  ambient or size changes need `rerender_assets`, which regenerates procedural
  assets only. Hand-painted and imported assets are skipped: re-paint them with
  `paint_asset` / `edit_asset`.
- Output looks flat or noisy: adjust `shadeSteps` / `dither` / `ambient` in the
  kit rather than editing assets one by one.
- Unknown asset: ids and exact names both work; `list_assets` shows them.

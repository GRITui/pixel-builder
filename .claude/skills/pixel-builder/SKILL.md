---
name: pixel-builder
description: Turn a realistic image (file or URL) into true pixel art at 8/16/32/64-bit era limits and validate it. Use for game art, sprites, tiles, retro-styled scenes.
---

# pixel-builder

Output is TRUE pixel art: one solid colour per pixel, alpha 0/255, palette within the era limit.

## Tools (MCP tools = CLI commands `npx tsx src/agent/cli.ts <tool> --json`)

- `pixelize` `image` (path or http(s) URL) or `prompt` (text; needs `IMAGE_API_KEY`, optional `IMAGE_BASE_URL`, `IMAGE_MODEL`, `IMAGE_API_STYLE=chat`) `[mode: scene|sprite|tile] [era: 8|16|32|64] [preset: vivid|neon|pastel|warm|cool|sepia|neutral] [bloom: off|low|med|high] [dither: off|low|med] [outline] [size] [look] [seed] [out_dir] [effects: rain,snow,shimmer,flicker,bloom_pulse] [frames: 2-64] [fps]`. With effects it also writes a looping `-fx.gif`, `-fx-sheet.png` and `-fx-frames.json`.
  Writes `<name>.png` (native size, use this in games), `<name>@Nx.png` (integer-upscaled preview) and `<name>.json` (meta + palette + `palette_budget`). Look at the returned preview.
- `looks` `action: save|list|delete` `[name] [from]` - save the era, palette and settings of a good result (`from` = its `.json`) as a named look; later `pixelize ... look=<name>` forces that exact palette and settings so a whole project matches.
- `presets` (no input) - lists eras, presets (with descriptions), bloom/dither levels, modes and effects with example calls. Call it when unsure what values are valid.
- `validate` `path` `[max_colours] [scale]` - run it on the native PNG (and on the preview with `scale`). Fix and re-run until `ok` is true.

## Workflow

0. `presets` if unsure of valid values.
1. `pixelize` with an era; look at the preview.
2. Change one thing at a time (era, preset, size, seed) and compare.
3. Check `palette_budget.cohesion`. Every call quantises independently, so a second image can
   share almost no colours with the first (measured: 1 of 48). `solo` on the first asset is
   fine; `drifting` means save the strongest result as a look and pass `look=<name>` to the
   rest, or the game will not read as one.
4. `validate` the native PNG, then use it. Upscale only by integers with nearest-neighbour.


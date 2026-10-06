---
name: pixel-builder
description: Turn a realistic image (file or URL) into true pixel art at 8/16/32/64-bit era limits and validate it. Use for game art, sprites, tiles, retro-styled scenes.
---

# pixel-builder

Output is TRUE pixel art: one solid colour per pixel, alpha 0/255, palette within the era limit.

## Tools (MCP tools = CLI commands `npx tsx src/agent/cli.ts <tool> --json`)

- `pixelize` `image` (path or http(s) URL) or `prompt` (text; needs `IMAGE_API_KEY`, optional `IMAGE_BASE_URL`, `IMAGE_MODEL`, `IMAGE_API_STYLE=chat`) `[mode: scene|sprite|tile] [era: 8|16|32|64] [preset: vivid|neon|pastel|warm|cool|sepia|neutral] [bloom: off|low|med|high] [dither: off|low|med] [outline] [size] [seed] [out_dir] [effects: rain,snow,shimmer,flicker,bloom_pulse] [frames: 2-64] [fps]`. With effects it also writes a looping `-fx.gif`, `-fx-sheet.png` and `-fx-frames.json`.
  Writes `<name>.png` (native size, use this in games), `<name>@Nx.png` (integer-upscaled preview) and `<name>.json` (meta + palette). Look at the returned preview.
- `validate` `path` `[max_colours] [scale]` - run it on the native PNG (and on the preview with `scale`). Fix and re-run until `ok` is true.

## Workflow

1. `pixelize` with an era; look at the preview.
2. Change one thing at a time (era, preset, size, seed) and compare.
3. `validate` the native PNG, then use it. Upscale only by integers with nearest-neighbour.

Note: the pipeline is currently a placeholder (presets/bloom/dither/outline are accepted but not applied yet).

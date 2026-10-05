# Pixel Builder — build plan

A PixelLab-style tool for **vibe-coding pixel art that stays consistent**:
characters, buildings, maps, environment, objects and UI all generated from one
**Style Kit**.

## The consistency model (read this first)

1. **Palette ramps, not colours.** `src/core/palette.ts` defines 18 material
   ramps (`skin`, `wood`, `water`, `ui`, ...) of 5 shades each (dark -> light).
   A sprite pixel is an *index* into that table (`colorIndex(mat, level)`), 0 =
   transparent. Change the kit's palette and every asset re-colours together.
2. **One light, one shader.** Generators never pick shades by hand for volumes.
   They describe shapes on a `Painter` (`ellipse`, `box`, `cylinder`, `poly`
   with a surface normal); the painter lights everything with the kit's light
   direction, quantises to the kit's `shadeSteps`, and optionally dithers.
   `px`/`rect`/`line` with an explicit level are for details only (eyes,
   sparkles, seams). `{ tone: ±n }` darkens/lightens a shape by n levels.
3. **One finishing pass.** Every non-tile sprite goes through
   `finalize(sprite, kit)` (`src/core/enforce.ts`) which applies the kit's
   outline mode. Ground tiles are NOT outlined (they must tile seamlessly).
   Leave a 1px transparent margin around props so the outline fits.
4. **AI never bypasses the kit.** "Vibe" mode asks Claude for *generator
   parameters* (so output is procedurally on-style). "Freeform" mode lets Claude
   paint pixels, but only with kit palette indices, then runs `finalize`.
   Imported images are downscaled + quantised to the kit palette.

## Shared code (integrator-owned — import it, don't edit it)

| File | What |
|---|---|
| `src/core/palette.ts` | ramps, `colorIndex`, `decodeIndex`, `flattenRamps`, quantizer |
| `src/core/types.ts` | `Sprite`, `Asset`, `FrameSet`, `StyleKit`, `TileMap`, `Category` |
| `src/core/kit.ts` | `DEFAULT_KIT`, `KIT_PRESETS`, `resolveRamps`, `lightVector`, `newId` |
| `src/core/painter.ts` | lit shape rasteriser |
| `src/core/enforce.ts` | `finalize`, `applyOutline`, `quantizeRGBA`, `downscaleRGBA`, `removeOrphans` |
| `src/core/sprite.ts` | `createSprite`, `blit`, `flipX`, `getPx`/`setPx`, `bounds` ... |
| `src/core/rng.ts` | seeded `rng(seed)`, tileable `valueNoise(seed, period)`, `hashString` |
| `src/core/asset.ts` | `createAsset(...)` |
| `src/core/tilemap.ts` | `renderTileMap`, `emptyTileMap`, `ensureTile` |
| `src/core/generators/types.ts` | `Generator`, `ParamSpec`, `defaults`, `randomParams`, `coerceParams` |
| `src/core/generators/index.ts` | `GENERATORS`, `generatorFor(category)`, `generatorById` |
| `src/core/generators/character.ts`, `building.ts` | reference generators — copy their style |
| `src/ui/render.ts` | `paletteFor`, `drawSprite`, `spriteToCanvas`, `buildSpritesheet`, `downloadBlob`, `fileToRGBA` |
| `scripts/preview.ts` | render a generator to PNG: `npx tsx scripts/preview.ts <id> out.png '[{..params..}]' [kitId]` |

If you need a change in a shared file, **don't edit it** — describe the change
in your final report and work around it locally.

## Team

Planning, contracts and integration: the lead session (Opus 5.5). Builders and
reviewers are custom agents in `.claude/agents/` (Sonnet 5.5, low effort):

| Agent | Role | Lanes / phase |
|---|---|---|
| `generator-artist` | procedural pixel-art generators, visual iteration | A (environment + map), B (objects + UI) |
| `ai-engineer` | Claude API server, prompts, schemas, browser client | C |
| `frontend-engineer` | React app shell, kit editor, library, export | D |
| `editor-engineer` | pixel editor, map editor, image import | E |
| `integrations-engineer` | headless workspace, MCP server, CLI | F |
| `devrel-writer` | AGENTS.md, SKILL.md, per-tool setup docs/configs | G |
| `art-director` | read-only visual + consistency critique | after A/B |
| `qa-verifier` | read-only end-to-end verification | after integration |

Flow: build lanes A-G in parallel -> integrate -> `art-director` + `qa-verifier`
review -> fix round -> ship.

## Lanes

Each lane owns only the files listed. Stubs already exist for every owned file
with the exact exported names/props other lanes rely on — keep those.

### Lane A — Environment + Map generators
Owns: `src/core/generators/environment.ts`, `src/core/generators/map.ts`,
`src/core/generators/environment.test.ts`, `src/core/generators/map.test.ts`.

- `environmentGenerator`: `kind` select (keep the exported `TILE_KINDS` and
  `PROP_KINDS` strings — `map.ts` and the UI rely on them) plus material
  overrides (e.g. `foliage`, `trunk`, `ground`) and a `variant` number (0-9) that
  feeds the seed for variety.
  - Props at `kit.sizes.environment` (trees may use 2x height if it looks better —
    keep width = `kit.sizes.environment`), outlined via `finalize`.
  - Tiles exactly `kit.sizes.tile` square, **seamless** (use `valueNoise` with a
    period that divides the tile so it wraps), no outline. `water-tile` is
    animated (3-4 frames, `fps` ~4); others single frame.
- `mapGenerator`: params `biome` (meadow, forest, island, desert, winter),
  `cols`/`rows` (12-48), `density` (0-1 props), `path` (bool: a dirt/stone path
  winding across). Build tiles by calling `environmentGenerator.generate` for
  each needed kind, assemble a `TileMap` with `ensureTile`, place props on the
  `deco` layer (never on water), and return
  `{ rows: [{ name: "map", frames: [renderTileMap(tm)] }], fps: 1, tilemap: tm }`.
  Mark trees/rocks/water `solid: true`.
- Tests: tiles wrap (left column vs right column neighbours look continuous —
  at minimum: correct size, no transparent pixels, deterministic per seed); map
  is deterministic per seed and has no deco on water.

### Lane B — Object + UI generators
Owns: `src/core/generators/object.ts`, `src/core/generators/ui.ts`,
`src/core/generators/object.test.ts`, `src/core/generators/ui.test.ts`.

- `objectGenerator` at `kit.sizes.object` (16 by default; keep it readable at
  16): `kind` select: chest, chest-open, barrel, crate, potion, sword, axe,
  shield, bow, coin, key, torch, sign, pot, gem, scroll, heart, bomb, book,
  mushroom-item, apple. Params: `main` material, `accent` material, `variant`.
  `coin` (spin) and `torch` (flame flicker) and `gem` (sparkle) are animated
  (3-4 frames). Outlined via `finalize`.
- `uiGenerator`: `kind`: button, panel, slot, bar, icon-frame, cursor, tab,
  checkbox, dialog-arrow. Params: `material` (default `ui`), `accent`, `width`,
  `height` (px, sensible clamps), `style` (bevel, flat, inset, ornate).
  Buttons return rows `normal`, `hover`, `pressed` (pressed shifts content
  1px and inverts bevel). Panels/slots/frames return
  `meta: { nineSlice: { left, top, right, bottom } }`. Bars return rows
  `frame` and `fill`. Bevels must respect the kit light direction (light edge
  on the lit side — use `Painter.lightSide` or normals). Checkbox rows:
  `off`, `on`.
- Tests: sizes correct, deterministic, button has 3 rows, panel meta present.

### Lane C — AI server + client
Owns: `server/**`, `src/ai/**`, `src/ai/*.test.ts`.

- `server/index.ts`: plain `node:http` server (no new deps) on `PORT` (8787).
  Load `.env` if present (`process.loadEnvFile` in try/catch). Routes:
  - `GET /api/health` -> `{ enabled, model, reason? }` (enabled iff `ANTHROPIC_API_KEY`).
  - `POST /api/vibe` `{ prompt, generator: {id, label, description, params}, kit, current? }`
    -> `{ name, params, notes }`. Build a JSON schema from the generator's
    `ParamSpec`s (select/material -> enum, number -> number, bool -> boolean,
    all required, `additionalProperties: false`) plus `name`, `notes`.
  - `POST /api/inpaint` `{ rows: string[] (sprite legend rows), mask: {rect:{x,y,w,h}} | {cells:[[x,y]]}, prompt, kit }` -> `{ rect, rows }` (legend rows for the mask bbox, one repair round)
  - `POST /api/pixels` `{ prompt, category, w, h, kit, references?: Sprite[] }`
    -> `{ name, sprite }`. Encode the kit palette as a legend of single chars
    (`.` = transparent), ask for `rows: string[]` of exactly `h` strings of
    `w` chars, decode server-side to palette indices, pad/crop to size.
    `references` (library sprites) are sent in the same encoding as style
    examples. Explain the lighting direction, outline mode and vibe in the
    prompt. The client runs `finalize` (cleanup + outline) on the result.
  - `POST /api/kit` `{ prompt, kit }` -> `{ kit: Partial<StyleKit>, notes }`:
    pick `paletteId`, `outline`, `lightDir`, `shadeSteps`, `dither`,
    `ambient`, `vibe`, and optional hue-tweaked `rampOverrides` for up to 6
    materials (5 hex colours each, dark->light).
  - In production (`NODE_ENV=production`) also serve `dist/` statically with SPA fallback.
- Claude usage (Anthropic TS SDK, already installed): model
  `process.env.PIXEL_MODEL ?? "claude-opus-5-5"`; use
  `client.beta.messages.create` with `betas: ["server-side-fallback-2026-07-01"]`,
  `fallbacks: "default"`, structured output via
  `output_config: { format: { type: "json_schema", schema }, effort }`
  (`effort: "low"` for vibe/kit, `"high"` for pixels); do NOT send `thinking`,
  `temperature` or `budget_tokens`. Check `stop_reason === "refusal"` and
  `"max_tokens"` before parsing; return 4xx/5xx JSON `{ error }` with a useful
  message. Use typed SDK errors (`Anthropic.APIError` etc.), not string matching.
- `src/ai/client.ts`: implement the stubbed functions (`aiStatus`,
  `vibeParams`, `aiPixels`, plus add `vibeKit({ prompt, kit })`). `vibeParams`
  must run results through `coerceParams`. `aiPixels` accepts optional
  `references?: Sprite[]` and runs `finalize(sprite, kit, { cleanup: true })`.
- Put prompt/schema building and the char legend in `server/prompts.ts` /
  `server/legend.ts` and unit-test them (schema shape, legend round-trip
  encode/decode, row padding/cropping) — no network in tests.

### Lane D — App shell
Owns: `src/main.tsx`, `src/App.tsx`, `src/styles.css`, `src/ui/store.ts`,
`src/ui/components/**` (create it), `src/ui/exportAsset.ts`.

- Layout: top bar (app name, Style Kit picker + "Edit kit", AI status pill),
  left nav of categories (Characters, Buildings, Environment, Objects, UI, Map,
  Library), main workspace, right "Library" strip filtered to the category.
  Dark, pixel-friendly theme; `image-rendering: pixelated` everywhere.
- **Generate workspace** (per category): prompt box with two AI buttons —
  "Vibe" (`vibeParams`, then generate procedurally) and "Freeform pixels"
  (`aiPixels`, optional "style references" = up to 2 selected library assets);
  both disabled with a tooltip when `aiStatus().enabled` is false. Below:
  auto-built param form from `ParamSpec` (material params show a swatch of
  the ramp), seed field + dice, "Randomize", live preview (all rows, animated
  at `fps`, zoom control, checkerboard bg), **Variations** grid (6 seeds /
  random params — click to adopt), buttons: Save to library, Open in editor,
  Export. Regenerate live on every param change (it's fast).
- **Kit editor** (modal): name, palette preset, per-material ramp colour
  editing (5 colour inputs per ramp, reset), outline mode, light direction,
  shade steps, dither, ambient, sizes, vibe text, "Describe a style" ->
  `vibeKit`. Show a live sample sheet (a character, a tree tile, a chest, a
  button) rendered with the edited kit. Multiple kits; duplicate/delete.
- **Library**: grid of thumbnails (animated on hover), rename, delete,
  duplicate, tags, filter by category/search, "Re-render with current kit"
  for procedural assets (re-run generator with stored params+seed).
- **Export** (`exportAsset.ts`): PNG (1x/2x/4x/8x), spritesheet PNG + JSON
  (frame size, rows, fps, nineSlice meta), map -> PNG + Tiled-compatible JSON
  (one tileset image + layers), "Export all as JSON" / "Import JSON" for the
  whole library + kits.
- `store.ts`: React hooks for kits + library persisted to `localStorage`
  (`pixel-builder:v1:*`), wrapped in try/catch.
- Wire the Lane E components (`PixelEditor`, `MapEditor`, `ImportDialog`) via
  their existing props: "Open in editor" -> `PixelEditor` (or `MapEditor` for
  maps); an "Import image" button -> `ImportDialog`.

### Lane E — Editors
Owns: `src/ui/PixelEditor.tsx`, `src/ui/MapEditor.tsx`,
`src/ui/ImportDialog.tsx`, `src/ui/editor/**` (create it), and
`src/ui/editor/*.test.ts`.

- `PixelEditor` (full-screen modal): canvas with zoom + grid, tools pencil,
  eraser, fill (4-way), line, rect, eyedropper, mirror-X toggle, "shade"
  tool (click lightens / shift-click darkens along the pixel's ramp — the
  consistency-friendly brush). Palette panel shows the kit ramps only (no
  free colour picker). Frames strip per row: add/duplicate/delete/reorder
  frames, onion skin, play preview. Undo/redo (Ctrl+Z / Ctrl+Shift+Z),
  keyboard shortcuts (B, E, G, L, R, I, M). "Re-outline" button
  (`stripOutline` + `applyOutline`). Canvas resize. Save -> `onSave`.
  Keep pure logic (flood fill, line, history, shade) in
  `src/ui/editor/ops.ts` with unit tests.
- `MapEditor`: tile palette (the map's `tilemap.tiles` + "add from library"
  for environment/object/building assets), layers ground/deco, paint/erase/
  fill, show solid overlay toggle, resize map, zoom. Save re-renders
  `rows[0].frames[0]` with `renderTileMap`.
- `ImportDialog`: pick/drag an image, choose target size (presets from the
  kit + custom), crop-to-content toggle, preview original vs result, options
  "remove background" (treat the corner colour as transparent), "outline"
  (finalize), then `onImport(createAsset({... source: { kind: "import" } }))`.

### Lane F — Headless + MCP server + CLI (agent interop)
Owns: `src/node/**` (create it: `png.ts`, `workspace.ts`, `tools.ts`,
`mcp.ts`, `cli.ts`, `*.test.ts`), `bin/**`, and only the `bin`, `scripts`
(add `cli`, `mcp`, `build:node`) and `files` fields of `package.json`.

- Implements the **Agent tool contract** below once in `tools.ts`; `mcp.ts`
  (MCP SDK `McpServer.registerTool`, stdio by default, `--http [--port 8788]`
  for Streamable HTTP on 127.0.0.1) and `cli.ts` (`pixel-builder <command>
  --flag value ... [--json]`, `pixel-builder mcp [--http]`) are adapters.
- Workspace: `--workspace <dir>` > `PIXEL_BUILDER_WORKSPACE` > `./pixel-assets`.
  `<ws>/pixel-builder.json` is a `ProjectFile` (`src/core/project.ts`).
  Exports go to `<ws>/<category>s/<slug>.png` (+ `<slug>.json` sheet meta for
  animated assets, `<slug>.tiled.json` for maps). `generate_asset` and
  `paint_asset` auto-export.
- `png.ts`: encode sprite(s) -> PNG (scale, spritesheet) and decode PNG
  (8-bit, colour types 0/2/3/4/6, non-interlaced; clear error otherwise).
- Build: `build:node` bundles `src/node/cli.ts` to `dist-node/cli.mjs` with
  esbuild (already present via vite), packages external, shebang;
  `bin/pixel-builder.mjs` runs it. `npm run mcp` = stdio server via tsx.

### Lane G — Agent docs, skills and tool configs
Owns: `AGENTS.md`, `llms.txt`, `docs/integrations.md`,
`skills/pixel-builder/**` (portable skill: `SKILL.md` + optional
`reference.md`), `.claude/skills/pixel-builder/**` (same skill for Claude
Code in this repo), `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`,
`.gemini/settings.json`, and any other per-tool project config you verify.

- `docs/integrations.md`: setup for **Claude Code** (`claude mcp add` +
  `.mcp.json` + skill install), **Hermes Agent** (`~/.hermes/config.yaml`
  `mcp_servers` + skill install), **Claude Desktop**, **Cursor**, **Codex
  CLI**, **Gemini CLI**, **VS Code / GitHub Copilot**, **Windsurf**, **Cline**,
  **Zed**, **OpenAI Agents SDK**, remote clients (ChatGPT developer mode etc.)
  via the HTTP transport, and "any agent with a shell" via the CLI. Each with
  a verified snippet + source URL + a check step.
- `SKILL.md`: when to use; the vibe-code workflow (kit from the game's vibe
  -> generate with generators -> look at previews -> variations -> hand-paint
  only what generators can't, with the legend -> export into the game);
  consistency rules; tool/command cheat-sheet.
- `AGENTS.md`: for agents *working on this repo* (build/test commands,
  architecture, ownership, consistency rules) + pointer to the skill for
  agents *using* the tool.

### Agent tool contract (Lanes F and G)
Same names in MCP (tool names) and CLI (kebab-case commands). All inputs are
optional unless marked *; `kit_id` defaults to the active kit.

| Tool | Input | Output |
|---|---|---|
| `get_style_guide` | kit_id, materials[] | kit summary (vibe, light, outline, shade steps, sizes), palette legend text, painting rules |
| `list_generators` | category | generators with param specs |
| `generate_asset` | generator*, params, seed, kit_id, name, save (true), reference_id, match (style\|subject\|both, default both) | asset summary, exported file paths, preview image |
| `generate_variations` | generator*, count (1-12), params, vary ("seed" \| "params"), kit_id, reference_id, match | contact-sheet image + [{seed, params}] (not saved) |
| `paint_asset` | name*, category*, width*, height*, frames* (string[][] of legend rows; one inner array per frame), row_names, fps, outline (true), cleanup (true), kit_id | asset summary, files, preview |
| `edit_asset` | id*, row, frame, pixels [{x,y,char}], rows (replace frame), name, tags | asset summary, preview |
| `edit_region` | id*, row, frame, rect {x,y,w,h} \| cells [[x,y]], rows (legend rows for the selection bbox) \| prompt (needs ANTHROPIC_API_KEY), all_frames (false), outline (true) | asset summary, changed_pixels, preview. Only masked cells change; cleanup + outline are re-applied around them only. Async tool (`callToolAsync`) |
| `list_assets` | category, query | summaries |
| `get_asset` | id*, include_pixels (false) | summary, preview, legend rows if asked |
| `delete_asset` | id* | ok |
| `export_asset` | id*, row (gif), format (png \| spritesheet \| tiled \| svg \| aseprite \| gif \| tiled-tileset \| godot \| unity \| atlas), scale (1), out_dir | file paths (svg: layered, guides layer; aseprite: indexed, kit palette, layers, tags) |
| `import_image` | path* (PNG) or reference_id, width*, height* (optional in pixel-art mode), category*, name, mode (resample/pixel-art/auto), palette_mapping (nearest/ramps), split, remove_background, crop, outline | asset summary, grid {scale, offset, confidence}, preview |
| `import_svg` | path*, name, category, replace_id, kit_id | asset summary, preview (layered SVG back into the kit) |
| `add_reference` | path \| url \| base64 (exactly one), name, tags | reference summary, preview. PNG/JPEG, ≤10 MB, ≤4096px; full PNG in `references/<id>.png`, ≤512px preview inline in the project |
| `list_references` | tag | references (id, name, tags, size, source) |
| `get_reference` | id* | metadata, preview image |
| `delete_reference` | id* | ok |
| `list_kits` | — | kits (id, name, active) |
| `create_kit` | name*, base_kit_id, changes (partial StyleKit) | kit |
| `kit_from_reference` | path* (PNG) or reference_id*, name, base_kit_id, apply (`palette` \| `all`, default all), strength (0..1, 1), palette_size (8..32, 16) | new kit (not activated), preview sheet (character, tree, house, grass tile) + reference/palette strip, analysis (palette, matched materials, outline, light, shade steps, dither, pixel scale, suggested detail/rampDepth). Offline: ramps for materials the reference shows, others keep the base palette |
| `update_kit` | kit_id*, changes* | kit (refused when the kit is `locked`; version bumped) |
| `set_active_kit` | kit_id* | kit |
| `rerender_assets` | ids, kit_id, stale_only | re-generated procedural and rigged assets (consistency after a kit change) |
| `list_rigs` / `list_clips` / `list_attachments` | family | rigs / clips / attachments (registry first, then project-defined), with family |
| `generate_rigged` | rig*, slots, attachments[], clips[] (default walk, idle), directions (4 or 8, default 4), name, kit_id, save (true), reference_id, match | character asset (rows `<clip>-<dir>`; 8 adds down-right, up-right, up-left, down-left), spritesheet files, preview |
| `attach` | id*, add[], remove[] | re-rendered rigged asset, files, preview |
| `create_rig` | rig* (RigDef JSON), kit_id | validated + stored in the project, 3-view preview |
| `create_clip` | clip* (Clip JSON), rig, kit_id | validated + stored; preview on `rig` if given |
| `create_attachment` | attachment* (Attachment JSON), rig, kit_id | validated + stored; preview worn on `rig` if given |
| `generate_pack` | pack (e.g. `farming-v1`) or manifest {entries}, only[], kit_id, replace (true), svg (true), dry_run | generated assets + files, failures, contact sheet |

MCP also exposes resources `pixel-builder://project` (the project JSON) and
`pixel-builder://style-guide`, and a prompt `asset_pack` (args: `game`,
`count`) that walks an agent through building a consistent starter pack.

## Rules for every lane

- Only touch the files you own. Don't add npm dependencies. Don't commit or
  push — the integrator does that.
- Keep `npx tsc` passing for **your** files; `npm test` for your tests.
- Generator lanes: look at your output (`scripts/preview.ts` -> Read the PNG)
  and iterate until it reads well at 1x. Match `character.ts`/`building.ts`.
- Code style: TypeScript strict, small pure functions, comments only where
  they explain *why*.
- Finish with a short report: what you built, anything unfinished, and any
  change you need in a shared file.

### Reference-guided generation (#66)

`src/node/refgen.ts` (pure; shared with the web app). `reference_id` on `generate_asset`, `generate_variations` and
`generate_rigged` maps the reference onto params/slots offline (OKLab nearest ramp per body/roof band; shape picks the
building style). Explicit params win; `meta.referenceId` is saved. With `reference_id`, `generate_variations` renders a
pool, ranks it through a `Scorer` (default `localScorer`: palette chamfer + band profile + aspect) and returns the top
`count` best-first with `score` 0-100. Integrator hook: pass `{ distance: styleDistance-based }` as `scorer` in
`referenceCandidates` (and swap `localScorer` in `refgen.ts`) once `styleDistance` exists in `core/refstyle.ts`.
Web: References panel "Generate" opens `ReferenceGenerate` (6 ranked candidates; "Ask Claude" runs `refineWithAi`:
propose, score, ONE refinement round if the score is below 70, keep the better).

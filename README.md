# Pixel Builder

Vibe-code pixel art that **stays consistent**. Characters, buildings,
environment, objects, UI and tile maps all come from one **Style Kit**, so
everything you make looks like it belongs to the same game. Use it from the
web app, or let an AI agent (Claude Code, Hermes Agent, Cursor, Codex, Gemini
CLI…) drive it through MCP or the CLI.

## Why it stays consistent

| Rule | How |
|---|---|
| One palette | 18 material ramps (`skin`, `wood`, `water`, …) × 5 shades. Sprites store ramp *indices*, never colours, so editing the kit re-colours every asset together. |
| One light | Volumes are drawn as lit shapes (spheres, boxes, cylinders, polygons); a single renderer shades them all from the kit's light direction and shade-step count. |
| One scale | `proportions(kit)` derives door, storey, window and tree heights from the character size, so a door is a little taller than a person and a tree about twice as tall. |
| One finish | Every sprite goes through the same outline pass (none / black / coloured / selective). Ground tiles stay seamless and un-outlined. |
| AI stays on-kit | "Vibe" turns a prompt into *generator parameters*; "Freeform" paints with kit palette indices only; imports are quantised to the palette. |

## What it makes

- **Characters**: top-down RPG humanoids and slimes, 4 directions × 4-frame walk cycles, headwear, held items, capes, seeded variety.
- **Buildings**: cottage, shop, tower, keep, barn; gable / hip / flat / dome / spire roofs; 1–3 floors.
- **Environment**: trees, bushes, rocks, flowers, crystals…, plus seamless grass / dirt / sand / stone-path / snow tiles and animated water.
- **Objects**: 21 props and items (chests, barrels, potions, weapons, keys, gems…), with animated coin, torch and gem.
- **UI**: buttons (normal / hover / pressed), 9-slice panels, slots, bars, tabs, checkboxes, cursor, dialog arrow.
- **Maps**: procedural tile maps in five biomes with shores, paths and props, editable in the map editor and exportable to Tiled.

Plus a palette-locked **pixel editor** (shade brush walks a pixel along its
ramp, frames, onion skin), **image import** (downscale + quantise to the kit),
a **library** with "re-render with current kit", and export to PNG,
spritesheet + JSON, Tiled maps, or a whole-project `pixel-builder.json`.

## Quick start

```bash
npm install
cp .env.example .env        # optional: add ANTHROPIC_API_KEY for the AI features
npm run dev                 # web app on http://localhost:5173, API on :8787
```

Everything except the AI buttons works without a key. Production:
`npm run build && npm start` serves the built app and API from one Node process.

### AI features (optional)

With `ANTHROPIC_API_KEY` set on the server:

- **Vibe**: "a grumpy dwarf blacksmith" → generator parameters → rendered procedurally in your kit.
- **Freeform pixels**: Claude paints a sprite using only kit palette indices, optionally imitating up to two library assets as style references.
- **Describe a style**: build a style kit (palette, light, outline, shading) from a sentence.

Model defaults to `claude-opus-5-5` (override with `PIXEL_MODEL`). The key never reaches the browser.

## Use with AI agents

An MCP server (stdio or Streamable HTTP) and a CLI expose the same 33 tools
(`get_style_guide`, `generate_asset`, `generate_variations`, `paint_asset`,
`export_asset`, …). No API key is needed: the calling agent can be the artist,
painting with the kit's palette legend, and every result goes through the same
consistency pass. Assets are written to a workspace (`--workspace <dir>` or
`PIXEL_BUILDER_WORKSPACE`, default `./pixel-assets`) as game-ready PNG,
spritesheet and Tiled files. The web app imports and exports the same
`pixel-builder.json` project file.

- **Claude Code, Cursor, VS Code / Copilot, Gemini CLI:** open this repo; the committed `.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json` and `.gemini/settings.json` register the server (`npx tsx src/node/cli.ts mcp`).
- **Hermes Agent, Claude Desktop, Codex CLI, Windsurf, Cline, Zed, OpenAI Agents SDK:** copy-paste snippets in [docs/integrations.md](docs/integrations.md).
- **Remote / hosted clients:** `npx tsx src/node/cli.ts mcp --http --port 8788` serves `http://127.0.0.1:8788/mcp`.
- **Any agent with a shell:** `npx tsx src/node/cli.ts <command> --json` (or `npm run build:node`, then `node dist-node/cli.mjs …`).
- **Teach the agent the workflow:** install the skill in [skills/pixel-builder/](skills/pixel-builder/SKILL.md) (Claude Code: `.claude/skills/`; Hermes: `~/.hermes/skills/`), or paste its `SKILL.md` into your agent's rules.
- **Agents working on this repo:** see [AGENTS.md](AGENTS.md). Machine-readable summary: [llms.txt](llms.txt).

## Project layout

```
src/core/        pure TypeScript engine: palette ramps, kit, lit Painter, outline/quantise,
                 generators/, legend, tilemap, project format (runs in browser and Node)
src/ui/          React app shell, pixel/map editors, import dialog, export
src/ai/          browser client for the AI endpoints
src/node/        headless workspace, PNG I/O, tool layer, MCP server, CLI
server/          Node API that calls Claude (vibe / pixels / kit)
skills/          portable agent skill (SKILL.md)
scripts/         preview renderers used in development and CI
```

## Development

```bash
npx tsc                       # typecheck
npm test                      # vitest
npx tsx scripts/preview.ts building out.png '[{"style":"tower"}]' kit-neon
npx tsx scripts/previews.ts previews   # every generator × every kit
```

CI (GitHub Actions) runs the typecheck, tests, web and CLI builds on every
pull request and uploads the generator contact sheets as an artifact.
[docs/BUILD_PLAN.md](docs/BUILD_PLAN.md) describes the architecture, the
consistency model and how the work was split across the agent team in
[.claude/agents/](.claude/agents/).

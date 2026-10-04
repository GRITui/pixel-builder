# AGENTS.md

Instructions for AI agents. Two audiences:

- **Using pixel-builder to make pixel art** (for a game, in any project): read
  [`skills/pixel-builder/SKILL.md`](skills/pixel-builder/SKILL.md). It has the
  workflow, the consistency rules and the tool cheat-sheet. Setup for your tool
  is in [`docs/integrations.md`](docs/integrations.md).
- **Working on this repository**: the rest of this file.

## What this is

pixel-builder is a tool for vibe-coding pixel art that stays consistent:
characters, buildings, maps, environment, objects and UI generated from one
**Style Kit**. It is a Vite + React + TypeScript app (`src/`), a small Node API
for Claude (`server/`), and a headless layer for agents (`src/node/`: workspace,
MCP server, CLI). Full architecture and file ownership: [`docs/BUILD_PLAN.md`](docs/BUILD_PLAN.md).

## Commands

```bash
npm install
npm run dev          # web (5173) + API (8787)
npm test             # vitest run (all tests, no network)
npx tsc              # typecheck (strict)
npx tsx scripts/preview.ts <generator-id> out.png '[{"kind":"chest"}]' [kitId]   # render a generator to PNG, then look at it

# agent interface (see docs/integrations.md)
npx tsx src/node/cli.ts mcp                       # MCP server over stdio
npx tsx src/node/cli.ts mcp --http --port 8788    # Streamable HTTP, http://127.0.0.1:8788/mcp
npx tsx src/node/cli.ts <command> --json          # any tool as a CLI command
npm run build:node                                # bundle to dist-node/cli.mjs
```

`ANTHROPIC_API_KEY` is only needed for the web app's AI buttons ("Vibe",
"Freeform pixels"). Generators, the CLI and the MCP server work without it.

## Layout

| Path | What |
|---|---|
| `src/core/` | pure, UI-free core: `palette`, `kit`, `painter`, `enforce`, `sprite`, `tilemap`, `legend`, `project`, `generators/` |
| `src/core/generators/` | one generator per category (`character`, `building`, `environment`, `object`, `ui`, `map`) |
| `src/ui/`, `src/App.tsx` | React app, editors (pixel, map, import), export |
| `src/ai/`, `server/` | Claude client and API (`/api/vibe`, `/api/pixels`, `/api/kit`) |
| `src/node/` | headless workspace, PNG codec, tool implementations, MCP + CLI adapters |
| `skills/pixel-builder/` | portable agent skill (`SKILL.md`, `reference.md`); copy in `.claude/skills/pixel-builder/` |
| `docs/` | build plan, integrations guide |

## Consistency model (do not break it)

1. **Palette ramps, not colours.** 18 materials x 5 shades in `src/core/palette.ts`.
   Sprites store palette indices (`colorIndex(material, level)`), never colours.
2. **One light, one shader.** Describe volumes on the lit `Painter` (`ellipse`,
   `box`, `cylinder`, `poly`); don't pick shades by hand. `px`/`rect`/`line` with
   an explicit level are for details only.
3. **One finishing pass.** Every non-tile sprite goes through `finalize`
   (`src/core/enforce.ts`). Ground tiles are not outlined and must tile
   seamlessly. Leave a 1px transparent margin around props.
4. **AI never bypasses the kit.** Vibe mode returns generator parameters;
   freeform mode paints only legend characters, then runs `finalize`; imports
   are quantised to the kit palette.

## Working rules

- Keep `npx tsc` and `npm test` green. Small pure functions; comments only for *why*.
- Don't add npm dependencies without need. Shared files in `src/core/` have
  owners (see `docs/BUILD_PLAN.md`); describe needed changes rather than editing
  files you don't own.
- When changing a generator, **look at the output**: render it with
  `scripts/preview.ts`, open the PNG, iterate until it reads at 1x.
- Agent tool names and inputs (MCP tools = CLI commands) are a contract
  (`docs/BUILD_PLAN.md`, "Agent tool contract"). If you change one, update
  `src/node/tools.ts`, `skills/pixel-builder/SKILL.md` (+ the copy in
  `.claude/skills/`), `docs/integrations.md` and `llms.txt` together.
- Don't commit or push unless asked. Don't commit `.env` or `pixel-assets/`.

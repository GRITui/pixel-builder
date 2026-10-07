# AGENTS.md

pixel-builder is a pixelizer for AI agents (MCP + CLI): realistic image -> TRUE pixel art.
Skill for agents *using* it: `skills/pixel-builder/SKILL.md`. The rest of this file is for working on the repo.

## The rule

Output is true pixel art: one solid colour per pixel, alpha only 0 or 255, colour count within the era limit,
and any upscale is integer nearest-neighbour. `validate` (`src/pixel/validate.ts`) enforces this; never ship a path that blurs.

## Layout

| Path | What |
|---|---|
| `src/color/` | OKLab/OKLCH, fixed palettes (NES, Game Boy, CGA, PICO-8), RGB555 |
| `src/io/` | PNG codec, GIF encoder, decode (PNG own; JPEG/WebP/GIF via sharp), resize/upscale |
| `src/pixel/` | types (`Rgba`, `Era`, `Look`, `PixelResult`), `validate`, `pixelize` pipeline |
| `src/ai/` | OpenAI-compatible provider plumbing (image adapter builds on it) |
| `src/net/` | SSRF-safe URL fetch |
| `src/agent/` | tool registry (`registry.ts`), tools (`tools.ts`), MCP server (`mcp.ts`), CLI (`cli.ts`), input coercion |
| `bench/` | eval harness (stub) |

## Commands

`npm test` (vitest), `npx tsc`, `npx tsx src/agent/cli.ts <tool> --json`, `npm run mcp`, `npm run build:node`.

## Working rules

- Keep `npx tsc` and `npm test` green. Small pure functions; comments only for why. Minimal dependencies.
- Tool names and inputs are a contract: MCP tools = CLI commands. Changing one means updating `src/agent/tools.ts`,
  `skills/pixel-builder/SKILL.md` (+ `.claude/skills/` copy), `llms.txt` and README together.
- Adding a tool is one `registerTool({...})` in `src/agent/tools.ts`.
- Look at outputs: open the preview PNG before claiming a pipeline change works.
- Don't commit `.env` or `pixel-out/`. The v1 generator app is archived on branch `archive/v1-generators`.
- Work on `main` directly (the owner's choice). Before every push run the CI checks locally:
  `npm run check` (tsc, vitest, build:node; stops at the first failure). Push only when it exits 0 - never pipe
  it through grep/tail, which hides the exit code. Never push a red tree,
  never force-push. Parallel agent lanes still use their own worktrees and are merged into `main` the same way.

# Pixel Builder

Pixelizer for AI agents: realistic image -> true pixel art (8/16/32/64-bit). MCP + CLI only. See `AGENTS.md`.

- `npm test` (vitest), `npx tsc`, `npx tsx src/agent/cli.ts pixelize <img> --era 16 --json`.
- True-pixel-art rule: one solid colour per pixel, alpha 0/255, colours within era limit, integer nearest upscale only. Check with `validate`.
- Layout: `src/color`, `src/io`, `src/pixel`, `src/ai`, `src/net`, `src/agent`, `bench`.
- Tool changes (names/inputs) update `src/agent/tools.ts`, the skill (+ `.claude/skills` copy), `llms.txt` and README together.

@AGENTS.md

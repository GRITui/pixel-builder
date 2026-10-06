# pixel-builder

A **pixelizer for AI agents**: realistic image (a file, a URL, or later one generated from a prompt) in,
**true pixel art** out - every pixel one solid colour, era-limited palette (8/16/32/64-bit), no blur,
no sub-pixel anti-aliasing. Driven only through MCP and a CLI.

```bash
npm install
npx tsx src/agent/cli.ts pixelize photo.jpg --era 16 --json   # native PNG + upscaled preview + meta JSON
npx tsx src/agent/cli.ts validate pixel-out/photo-scene-16bit.png
npx tsx src/agent/cli.ts mcp                                   # MCP over stdio
npx tsx src/agent/cli.ts mcp --http --port 8788                # Streamable HTTP on 127.0.0.1
```

Tools (MCP tools = CLI commands): `pixelize`, `validate`, `looks` (save/list/delete a locked palette+settings; pass `look` to `pixelize`). More arrive per `docs/` issues (look presets,
sprite/tile modes, effect GIFs, prompt-to-image). Setup snippets for hosts: `llms.txt`, `skills/pixel-builder/SKILL.md`.

Pipeline: lanczos 2x, Kuwahara flatten, box to native, preset grade in OKLCH, bloom (linear light), era palette (NES greedy / RGB555 / free k-means, or a locked look), calm-area Bayer dither, OKLab nearest, orphan cleanup, optional outline.

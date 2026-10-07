# Integrations

pixel-builder runs as an MCP server (stdio or Streamable HTTP) and a CLI. `<ABS>` is the absolute path of this checkout; `<GAME>` is the game project that should receive assets.

Launch commands: `npx tsx <ABS>/src/agent/cli.ts mcp` (stdio), `node <ABS>/dist-node/cli.mjs mcp` (after `npm run build:node`), `pixel-builder mcp` (after `npm link`), `... mcp --http --port 8788` -> `http://127.0.0.1:8788/mcp`.
Output folder: `--out-dir` on the command, env `PIXEL_BUILDER_OUT`, default `./pixel-out`. Looks: `<out>/looks` or `PIXEL_LOOKS_DIR`. Prompt path env: `IMAGE_API_KEY`, `IMAGE_BASE_URL`, `IMAGE_MODEL`, `IMAGE_API_STYLE`.

Do not use plain `npm run mcp` for stdio (banner on stdout breaks the protocol); use `npx tsx` or `npm run -s mcp`. GUI apps may lack your shell `PATH`: use absolute binary paths.

Verification status: formats were carried over from the earlier guide (commit b01d8d5). **verified** = read from the client's official docs source; **excerpt-verified** = confirmed via excerpts only. The server itself (stdio and HTTP) is tested here with the MCP SDK client.

## Claude Code (verified)

Docs: <https://code.claude.com/docs/en/mcp>. This repo ships `.mcp.json`; elsewhere:

```bash
claude mcp add --transport stdio --scope user pixel-builder -- node <ABS>/dist-node/cli.mjs mcp
claude mcp add --transport http pixel-builder http://127.0.0.1:8788/mcp
```

Skill: `cp -r <ABS>/skills/pixel-builder ~/.claude/skills/`. Check: `claude mcp list`.

## Qwen Code (verified)

Docs: <https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/mcp.md>. `~/.qwen/settings.json` or project `.qwen/settings.json` (HTTP uses `httpUrl`):

```json
{ "mcpServers": { "pixel-builder": { "command": "node", "args": ["<ABS>/dist-node/cli.mjs", "mcp"], "env": { "PIXEL_BUILDER_OUT": "<GAME>/pixel-out" } } } }
```

## Cline (excerpt-verified)

Docs: <https://docs.cline.bot/mcp/configuring-mcp-servers>. Cline panel -> MCP Servers -> Configure MCP Servers opens `cline_mcp_settings.json`:

```json
{ "mcpServers": { "pixel-builder": { "command": "node", "args": ["<ABS>/dist-node/cli.mjs", "mcp"], "env": { "PIXEL_BUILDER_OUT": "<GAME>/pixel-out" }, "disabled": false, "autoApprove": [] } } }
```

## Hermes Agent (verified)

Docs: <https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp>. `~/.hermes/config.yaml`. Hermes does not forward your shell environment to stdio servers, so set env explicitly:

```yaml
mcp_servers:
  pixel_builder:
    command: "node"
    args: ["<ABS>/dist-node/cli.mjs", "mcp"]
    env:
      PIXEL_BUILDER_OUT: "<GAME>/pixel-out"
```

HTTP: `url: "http://127.0.0.1:8788/mcp"`. Skill: `cp -r <ABS>/skills/pixel-builder ~/.hermes/skills/`.

## Any agent with a shell

`npx tsx <ABS>/src/agent/cli.ts presets --json`, then `pixelize <img> ... --json`, then `validate <png> --json`.

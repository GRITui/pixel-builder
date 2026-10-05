# Use pixel-builder with AI agents

pixel-builder exposes the same 16 tools two ways, so any agent can drive it:

- **MCP server** (stdio, or Streamable HTTP): for Claude Code, Hermes Agent,
  Claude Desktop, Cursor, Codex CLI, Gemini CLI, VS Code / GitHub Copilot,
  Windsurf, Cline, Zed, the OpenAI Agents SDK and remote MCP clients.
- **CLI**: for any agent that can run shell commands. Same tools as
  kebab-case commands (`generate_asset` -> `generate-asset`) with `--json`.

Pair either with the **skill** ([`skills/pixel-builder/SKILL.md`](../skills/pixel-builder/SKILL.md)),
which teaches the agent the consistent-pixel-art workflow. Agents *working on
this repo* read [`AGENTS.md`](../AGENTS.md).

> Verification status: every snippet below cites the doc it came from. Where I
> could read the official page it says **verified**; where the official page was
> not reachable and the format was confirmed only through search-result excerpts
> of it (or third-party guides) it says **excerpt-verified** or **reported**.
> Re-check those against the linked page if something doesn't load.

## 0. Launch commands

All placeholders: `<ABS>` = absolute path of this repo checkout,
`<GAME>` = absolute path of the game project that should receive the assets.

| Mode | Command | Use when |
|---|---|---|
| Dev stdio (inside this repo) | `npx tsx src/node/cli.ts mcp` | project configs in this repo |
| Built stdio | `node <ABS>/dist-node/cli.mjs mcp` (after `npm run build:node`) | global / other projects |
| Linked bin | `pixel-builder mcp` (after `npm link` in this repo; uses `dist-node/cli.mjs` if built, else falls back to tsx) | you want a short command on `PATH` |
| Streamable HTTP | `npx tsx src/node/cli.ts mcp --http --port 8788` -> `http://127.0.0.1:8788/mcp` | clients that connect to a URL |
| CLI | `npx tsx src/node/cli.ts <command> --json` | agents with a shell |

**Workspace** (where the project file and exports live), highest priority first:
`--workspace <dir>`, env `PIXEL_BUILDER_WORKSPACE`, default `./pixel-assets`.
The project is `<ws>/pixel-builder.json`; exports go to `<ws>/<folder>/`
(`characters/`, `buildings/`, `environments/`, `objects/`, `ui/`, `maps/`).
Relative workspace paths resolve against the server's working directory, which
GUI apps do not control, so in global configs use an absolute `<GAME>/pixel-assets`.

**Shared team library.** The workspace may instead be a URL,
`--workspace https://pixel.internal/api/projects/team` (or `PIXEL_BUILDER_WORKSPACE`). The project is then
read and written through the server API with ETag/If-Match (a concurrent change makes the tool fail with
a 409 message and overwrites nothing). Set `PIXEL_BUILDER_TOKEN` when the server runs `AUTH=token`.
Exports still land in a local folder: `--out-dir <dir>` or env `PIXEL_BUILDER_OUT_DIR` (default `./pixel-assets`).
Deployment and setup: [`deploy.md`](deploy.md).

**Notes**

- Don't launch the stdio server with plain `npm run mcp`: npm prints a banner
  (`> pixel-builder@0.1.0 mcp`) to stdout, which corrupts the stdio protocol
  (I confirmed this). Use `npx tsx ...` as above, or `npm run -s mcp`.
- GUI apps (Claude Desktop, Windsurf, Cursor from the dock) often don't inherit
  your shell `PATH`. If `npx`/`node` isn't found, put the absolute path of the
  binary (`which node`) in `command`.
- Check the server works before wiring a client:
  `npx tsx src/node/cli.ts get-style-guide --json` should print the kit and legend.
  I ran the stdio server (dev and built), the HTTP server and the CLI examples in
  this guide against the current code: all 16 tools list over both transports.

## 1. Claude Code

Docs: <https://code.claude.com/docs/en/mcp>, <https://code.claude.com/docs/en/skills> (**verified**)

In this repo it works out of the box: the committed [`.mcp.json`](../.mcp.json)
registers the server (Claude Code asks you to approve project servers on first
use) and [`.claude/skills/pixel-builder/`](../.claude/skills/pixel-builder/) is
the skill. Start Claude Code from the repo root.

```json
{
  "mcpServers": {
    "pixel-builder": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "src/node/cli.ts", "mcp"],
      "env": { "PIXEL_BUILDER_WORKSPACE": "./pixel-assets" }
    }
  }
}
```

Use it from another project (built version, user scope = every project; the
workspace is `./pixel-assets` of whatever directory you start Claude in):

```bash
claude mcp add --transport stdio --scope user pixel-builder \
  --env PIXEL_BUILDER_WORKSPACE=./pixel-assets \
  -- node <ABS>/dist-node/cli.mjs mcp
```

HTTP instead: `claude mcp add --transport http pixel-builder http://127.0.0.1:8788/mcp`

Install the skill globally: `cp -r <ABS>/skills/pixel-builder ~/.claude/skills/`
(project-only: copy into `<GAME>/.claude/skills/`).

Note: if a repo has a `CLAUDE.md`, Claude Code reads it *instead of* `AGENTS.md`
unless `CLAUDE.md` imports it (`@AGENTS.md`),
see <https://code.claude.com/docs/en/memory#agents-md>.

**Check:** `claude mcp list` shows `pixel-builder` as connected; in a session
`/mcp` lists its tools. Ask "get the pixel-builder style guide".

## 2. Hermes Agent (Nous Research)

Docs: <https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp>,
<https://hermes-agent.nousresearch.com/docs/user-guide/features/skills>,
<https://hermes-agent.nousresearch.com/docs/user-guide/features/context-files>
(**verified** via the docs' source in the NousResearch/hermes-agent repo on GitHub;
the docs site itself was not reachable from my environment)

`~/.hermes/config.yaml`, top-level key `mcp_servers` (YAML, snake_case names):

```yaml
mcp_servers:
  pixel_builder:
    command: "node"
    args: ["<ABS>/dist-node/cli.mjs", "mcp"]
    env:
      PIXEL_BUILDER_WORKSPACE: "<GAME>/pixel-assets"
```

Dev checkout instead of a build (`cwd` is a documented stdio field):

```yaml
mcp_servers:
  pixel_builder:
    command: "npx"
    args: ["tsx", "src/node/cli.ts", "mcp"]
    cwd: "<ABS>"
    env:
      PIXEL_BUILDER_WORKSPACE: "<GAME>/pixel-assets"
```

Hermes does **not** forward your whole shell environment to stdio servers, so
always set `PIXEL_BUILDER_WORKSPACE` under `env`. HTTP variant:
`url: "http://127.0.0.1:8788/mcp"` (fields `url`, `headers`). Optional controls:
`enabled`, `timeout`, `connect_timeout`, `lazy`.

Skill (skills live in `~/.hermes/skills/`; each is a folder with `SKILL.md`):

```bash
mkdir -p ~/.hermes/skills && cp -r <ABS>/skills/pixel-builder ~/.hermes/skills/
```

or point Hermes at the repo's skills folder in `config.yaml` (no copy):

```yaml
skills:
  external_dirs:
    - <ABS>/skills
```

`hermes skills install https://<host>/path/SKILL.md` also works for a URL
(documented, untested here; it fetches only `SKILL.md`, not `reference.md`).
Hermes also loads `AGENTS.md` as project context (priority: `.hermes.md` >
`AGENTS.override.md` > `AGENTS.md` > `CLAUDE.md` > `.cursorrules`).

**Check:** `hermes mcp test pixel_builder` and `hermes mcp list`; in a session run
`/reload-mcp` after editing the config, `hermes skills list`, then `/pixel-builder`.

## 3. Claude Desktop

Docs: <https://modelcontextprotocol.io/quickstart/user> (**excerpt-verified**:
the page was not reachable; path and JSON confirmed via search excerpts)

Open the config file (the app's Settings -> Developer -> Edit Config button opens it; menu names not verified, or edit the file directly):
macOS `~/Library/Application Support/Claude/claude_desktop_config.json`,
Windows `%APPDATA%\Claude\claude_desktop_config.json`. Use absolute paths; the
app starts servers with its own working directory.

```json
{
  "mcpServers": {
    "pixel-builder": {
      "command": "node",
      "args": ["<ABS>/dist-node/cli.mjs", "mcp"],
      "env": { "PIXEL_BUILDER_WORKSPACE": "<GAME>/pixel-assets" }
    }
  }
}
```

Fully quit and restart Claude Desktop. For the skill, upload
`skills/pixel-builder/` as a skill in Claude's settings, or paste `SKILL.md`
into a project's instructions (skill upload UI not verified here).

**Check:** after restart the tools/connector indicator in the chat box lists
`pixel-builder`; ask "list the pixel-builder generators".

## 4. Cursor

Docs: <https://cursor.com/docs/mcp> (**excerpt-verified**; page not reachable)

Project: [`.cursor/mcp.json`](../.cursor/mcp.json) (committed); global:
`~/.cursor/mcp.json`. Top-level key `mcpServers`. Cursor interpolates
`${workspaceFolder}`, `${env:NAME}`, `${userHome}` in `command`, `args`, `env`,
`url`, `headers`.

```json
{
  "mcpServers": {
    "pixel-builder": {
      "command": "npx",
      "args": ["tsx", "${workspaceFolder}/src/node/cli.ts", "mcp"],
      "env": { "PIXEL_BUILDER_WORKSPACE": "${workspaceFolder}/pixel-assets" }
    }
  }
}
```

For a different project use the built version
(`"command": "node", "args": ["<ABS>/dist-node/cli.mjs", "mcp"]`, workspace
`${workspaceFolder}/pixel-assets`). HTTP: `{"url": "http://127.0.0.1:8788/mcp"}`.
Skill (reported by third-party guides, not confirmed on Cursor's docs): Cursor
reads `SKILL.md` folders from `.cursor/skills/` and `.agents/skills/` (and, for
compatibility, `.claude/skills/`). Cursor also reads `AGENTS.md` in the project root.

**Check:** Cursor Settings -> MCP (Tools & MCP) shows `pixel-builder` with a
green status and its tools; in Agent chat ask it to list generators.

## 5. Codex CLI

Docs: <https://developers.openai.com/codex/mcp> (**excerpt-verified**; page not reachable)

```bash
codex mcp add pixel-builder \
  --env PIXEL_BUILDER_WORKSPACE=<GAME>/pixel-assets \
  -- node <ABS>/dist-node/cli.mjs mcp
```

which writes to `~/.codex/config.toml` (trusted projects may also use a
project-scoped `.codex/config.toml`):

```toml
[mcp_servers.pixel-builder]
command = "node"
args = ["<ABS>/dist-node/cli.mjs", "mcp"]

[mcp_servers.pixel-builder.env]
PIXEL_BUILDER_WORKSPACE = "<GAME>/pixel-assets"
```

Dev checkout: `command = "npx"`, `args = ["tsx", "<ABS>/src/node/cli.ts", "mcp"]`.
Streamable HTTP: `url = "http://127.0.0.1:8788/mcp"` (optional `bearer_token_env_var`,
`http_headers`). Codex reads `AGENTS.md` natively. Skills (reported, not confirmed
on OpenAI's page): `.agents/skills/<name>/SKILL.md` in the repo or
`~/.agents/skills/`, invoked as `$pixel-builder`.

**Check:** `codex mcp list` shows the server; in the TUI `/mcp` lists its tools.

## 6. Gemini CLI

Docs: <https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md>
and <https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md> (**verified**)

Project [`.gemini/settings.json`](../.gemini/settings.json) (committed) or user
`~/.gemini/settings.json`. Key `mcpServers`; `env` supports `$VAR` / `${VAR}`.

```json
{
  "mcpServers": {
    "pixel-builder": {
      "command": "npx",
      "args": ["tsx", "src/node/cli.ts", "mcp"],
      "env": { "PIXEL_BUILDER_WORKSPACE": "./pixel-assets" }
    }
  },
  "context": { "fileName": ["AGENTS.md", "GEMINI.md"] }
}
```

`context.fileName` makes Gemini load `AGENTS.md` (its default is only
`GEMINI.md`). Run `gemini` from the repo root so the relative paths resolve.
Built version: `"command": "node", "args": ["<ABS>/dist-node/cli.mjs", "mcp"]`
with an absolute workspace. HTTP: use **`httpUrl`**, not `url` (`url` is the SSE
endpoint): `"httpUrl": "http://127.0.0.1:8788/mcp"`. CLI alternative:
`gemini mcp add --transport http pixel-builder http://127.0.0.1:8788/mcp`.
Skills: Gemini CLI uses the universal `.agents/skills/` layout (reported by
third-party guides; not confirmed on Google's docs).

**Check:** `gemini mcp list`, or `/mcp` inside the CLI (shows connection status and tools).

## 7. VS Code / GitHub Copilot

Docs: <https://code.visualstudio.com/docs/agents/reference/mcp-configuration>
and <https://code.visualstudio.com/docs/agent-customization/mcp-servers>
(**verified** via the docs' source in microsoft/vscode-docs)

Workspace [`.vscode/mcp.json`](../.vscode/mcp.json) (committed). Note the top-level
key is **`servers`**, not `mcpServers`. Variables like `${workspaceFolder}` work in
the config; `cwd` and `envFile` are optional fields.

```json
{
  "servers": {
    "pixel-builder": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "${workspaceFolder}/src/node/cli.ts", "mcp"],
      "cwd": "${workspaceFolder}",
      "env": { "PIXEL_BUILDER_WORKSPACE": "${workspaceFolder}/pixel-assets" }
    }
  }
}
```

HTTP: `{"type": "http", "url": "http://127.0.0.1:8788/mcp"}`. User-wide: run
**MCP: Open User Configuration**. VS Code can also read a portable root
`.mcp.json` (which this repo has for Claude Code); if you see the server listed
twice, disable one. VS Code asks you to trust a server the first time it starts.
Optional: `chat.useAgentsMdFile` (experimental, per the VS Code docs/community
reports) makes Copilot load `AGENTS.md`; Copilot skills are reported to live in
`.github/skills/`.

**Check:** Command Palette -> **MCP: List Servers** shows `pixel-builder` running;
in Chat (Agent mode) **Configure Tools** lists its tools.

## 8. Windsurf

Docs: <https://docs.windsurf.com/windsurf/cascade/mcp> (**excerpt-verified**; page not
reachable). The product and docs are being rebranded (search excerpts show
`~/.config/devin/mcp_config.json` on macOS/Linux and `%APPDATA%\devin\mcp_config.json`
on Windows; older versions used `~/.codeium/windsurf/mcp_config.json`), so open the
file from the app rather than guessing: Cascade panel -> `...` (Actions) -> **Open MCP
config file**. Key `mcpServers`; remote servers use `serverUrl` or `url`. I found
no documented project-level file, so no config is committed. Use absolute paths.

```json
{
  "mcpServers": {
    "pixel-builder": {
      "command": "node",
      "args": ["<ABS>/dist-node/cli.mjs", "mcp"],
      "env": { "PIXEL_BUILDER_WORKSPACE": "<GAME>/pixel-assets" }
    }
  }
}
```

HTTP: `"serverUrl": "http://127.0.0.1:8788/mcp"`. Windsurf treats a root `AGENTS.md`
as an always-on rule (search excerpt).

**Check:** after saving, refresh the MCP list in the Cascade panel; `pixel-builder` and its tools should appear (exact UI wording not verified).

## 9. Cline

Docs: <https://docs.cline.bot/mcp/configuring-mcp-servers> (**excerpt-verified**;
page not reachable; excerpts from Cline-related guides)

Cline panel -> menu (top right) -> **MCP Servers** -> **Configure MCP Servers**
opens `cline_mcp_settings.json` (VS Code on macOS:
`~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/`;
Linux `~/.config/Code/...`; Windows `%APPDATA%/Code/...`; Cline CLI
`~/.cline/data/settings/`). Use absolute paths.

```json
{
  "mcpServers": {
    "pixel-builder": {
      "command": "node",
      "args": ["<ABS>/dist-node/cli.mjs", "mcp"],
      "env": { "PIXEL_BUILDER_WORKSPACE": "<GAME>/pixel-assets" },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

HTTP: `{"url": "http://127.0.0.1:8788/mcp", "type": "streamableHttp", "disabled": false}`.
Cline also reads a root `AGENTS.md` (reported).

**Check:** the server shows a green dot in the MCP Servers panel and lists its tools.

## 10. Zed

Docs: <https://github.com/zed-industries/zed/blob/main/docs/src/ai/mcp.md> (**verified**)

Zed uses `context_servers` in settings (`~/.config/zed/settings.json`, or
`.zed/settings.json` per project; open with the `zed::OpenSettingsFile` action).
Use absolute paths. No project file is committed because Zed has no documented
workspace-folder variable.

```json
{
  "context_servers": {
    "pixel-builder": {
      "command": "node",
      "args": ["<ABS>/dist-node/cli.mjs", "mcp"],
      "env": { "PIXEL_BUILDER_WORKSPACE": "<GAME>/pixel-assets" }
    }
  }
}
```

Remote: `{"url": "http://127.0.0.1:8788/mcp"}` (optional `headers`). Zed reads a
root `AGENTS.md` among its project rules files
(<https://zed.dev/docs/ai/instructions>, search excerpt).

**Check:** Settings -> AI -> MCP Servers: a green dot with "Server is active".

## 11. OpenAI Agents SDK (Python)

Docs: <https://github.com/openai/openai-agents-python/blob/main/docs/mcp.md> (**verified**)

```python
import asyncio
from agents import Agent, Runner
from agents.mcp import MCPServerStdio

SKILL = open("<ABS>/skills/pixel-builder/SKILL.md").read()

async def main() -> None:
    async with MCPServerStdio(
        name="pixel-builder",
        params={
            "command": "node",
            "args": ["<ABS>/dist-node/cli.mjs", "mcp"],
            "env": {"PIXEL_BUILDER_WORKSPACE": "<GAME>/pixel-assets"},
        },
        cache_tools_list=True,
    ) as server:
        agent = Agent(name="Pixel artist", instructions=SKILL, mcp_servers=[server])
        result = await Runner.run(agent, "Make a cozy RPG hero and a wooden chest.")
        print(result.final_output)

asyncio.run(main())
```

Streamable HTTP (start `mcp --http` first): replace the server with
`MCPServerStreamableHttp(name="pixel-builder", params={"url": "http://127.0.0.1:8788/mcp"})`
from `agents.mcp`. Passing `SKILL.md` as `instructions` is how this SDK takes a
skill. (`env` and `cwd` are optional stdio params per the SDK reference
excerpt.) The JavaScript/TypeScript Agents SDK was not checked.

**Check:** `await server.list_tools()` inside the `async with` returns the 16 tools.

## 12. Remote MCP clients (HTTP transport)

Start the server: `npx tsx src/node/cli.ts mcp --http --port 8788`. It prints
`MCP server (Streamable HTTP) at http://127.0.0.1:8788/mcp` on stderr. Endpoint
`http://127.0.0.1:8788/mcp`, Streamable HTTP, **stateless** (each request is
independent; only `POST` is accepted, a `GET` returns 405). Any MCP client that
takes a URL can use it directly (see the HTTP variants above). Flags:
`--port <n>`, `--host <addr>` (default `127.0.0.1`), `--workspace <dir>`.

Hosted clients such as ChatGPT developer mode need a public HTTPS URL. Docs:
<https://developers.openai.com/api/docs/guides/developer-mode> (**excerpt-verified**).
In ChatGPT, enable Developer mode (see the doc for the current menu path), add a
connector, and enter the MCP URL **including the `/mcp` path**; supported
transports are Streamable HTTP and SSE.

To reach the local server from the internet you need a tunnel (for example
`cloudflared` or ngrok). Two gotchas I confirmed in the code:

- On loopback binds the server only accepts `Host` / `Origin` headers that are
  `localhost`, `127.0.0.1` or `::1` (DNS-rebinding guard), so a tunnel that
  forwards the public hostname gets **403**. Configure the tunnel to rewrite the
  Host header to `localhost` (cloudflared `--http-host-header`, ngrok
  `--host-header`; those flags are from memory, check your tunnel's docs).
- There is **no authentication**. Anyone who can reach the URL can read and
  write your workspace. Only expose it behind tunnel-level access control, and
  stop it when done. Binding to another interface with `--host` turns the guard
  off, so don't do that on an untrusted network.

Claude Desktop's remote connectors and Claude.ai also need a public HTTPS URL
(not verified here).

**Check:** this lists the 16 tools (a plain `GET` in a browser gives 405, which
also proves it is up):

```bash
curl -s -X POST http://127.0.0.1:8788/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## 13. Any agent with a shell (CLI)

No MCP needed. From this repo `npx tsx src/node/cli.ts <command> --json`; after
`npm run build:node` use `node <ABS>/dist-node/cli.mjs <command> --json`; after
`npm link`, `pixel-builder <command> --json`. Give the agent
[`SKILL.md`](../skills/pixel-builder/SKILL.md) (paste it, or `@`-reference it) so
it knows the workflow. The first positional argument is each command's main input
(`generator`, `id` or exact name, `name`, `kit_id`, `path`); arrays and objects
take JSON, `@file.json` or `k=v,k=v`; `pixel-builder <command> --help` lists every
option. Exit codes: 0 ok, 1 tool error, 2 usage error. `--json` prints
`{"ok": true, ...result, "previews": [...]}` or `{"ok": false, "error": "..."}`.

```bash
pixel-builder get-style-guide --json
pixel-builder list-generators --category object --json
pixel-builder generate-asset object --params kind=chest --seed 3 --name chest --json
pixel-builder generate-variations environment --params kind=oak --count 6 --json
pixel-builder paint-asset --name gem --category object --width 8 --height 8 --frames @gem.json
pixel-builder export-asset chest --format spritesheet --scale 4 --out-dir ./game/art
pixel-builder --workspace <GAME>/pixel-assets list-assets --json
```

Preview images (including the contact sheet from `generate-variations`) are
saved to `<workspace>/.previews/`; have the agent open them with its
image-reading tool, since looking at the output is part of the workflow.
**Check:** `pixel-builder list-kits --json` lists the built-in kits.

## Tool reference (same names in MCP and CLI)

MMO HUD: `generate_asset` with `generator: "ui"` and `skin: "mmo-gold" | "mmo-stone" | "mmo-dark"` renders glossy bars and frames; kinds `unit-frame`, `minimap-frame`, `skill-bar`, `chat-panel`, `quest-tracker`, `tooltip`, `nameplate` and `damage-numbers` are new (see `docs/img/mmo-hud.png`). `skin` defaults to `wood`, which is unchanged.

`get_style_guide`, `list_generators`, `generate_asset`, `generate_variations`,
`paint_asset`, `edit_asset`, `edit_region` (change only a rect/cells region: your own legend `rows`, or a `prompt` for the server model when `ANTHROPIC_API_KEY` is set), `list_assets`, `get_asset`, `delete_asset`,
`export_asset` (png, spritesheet, tiled, svg, aseprite, gif, tiled-tileset, godot, unity, atlas), `import_image` (`mode: pixel-art|auto` detects the pixel grid of upscaled pixel art and recovers the true size, `palette_mapping: ramps` keeps shading, `split` cuts a sheet into frames, `reference_id` imports a stored reference; `auto` is recommended for unknown sources, default is `resample`), `import_svg`, `add_reference` (path | url | base64, PNG/JPEG, 10 MB, 4096px; full PNG in `references/<id>.png`, preview in the project), `list_references`, `get_reference` (returns the preview image), `delete_reference`, `reference_id` + `match` on `generate_asset` / `generate_variations` / `generate_rigged` (offline colour-to-material/slot mapping and shape-to-style guess; variations come back ranked with a 0-100 match score; explicit params win; `meta.referenceId` saved), `kit_from_reference` (offline: derive a kit from a PNG or `reference_id`, palette ramps + outline/light/shade/dither guesses + preview sheet), `compare_to_reference` (`asset_id`, `reference_id`, optional `row`/`frame`: style-distance score 0..100, per-component scores for palette, shades, outline, light, detail and silhouette, tips such as "try kit-hd-deep", and a side-by-side preview with the reference on the left; stores `referenceId` + `matchScore` in the asset meta), `list_kits`, `create_kit`, `update_kit` (refuses `locked` kits; fork with `create_kit`),
`set_active_kit`, `rerender_assets` (`stale_only`), `list_rigs`, `list_clips`, `list_attachments`,
`generate_rigged` (`directions: 4|8`; 8 adds 3/4 diagonal rows), `attach`, `create_rig`, `create_clip`, `create_attachment`, `generate_pack` (whole starter set in one call, e.g. `farming-v1`, `monsters-v1` (mushroom/slime/plant/bat/wolf/skeleton rigs `monster-*` with idle, walk, attack, hurt, die) `side-view-starter` for the `kit-side` platformer camera or `iso-starter` for the `kit-iso` isometric camera). `kit-iso` is the isometric camera (2:1 dimetric, 32x16 diamond tiles): generators `iso-tile`, `iso-prop`, `iso-building`, `isomap` (Tiled export `orientation: isometric` with a ground tile layer and a y-sorted `props` object layer), and rigged characters get rows `<clip>-se|sw|ne|nw` (`directions: 8` adds `s|e|n|w`); pack `iso-starter`. Under `kit-iso` the ordinary generators go isometric too: `building` (every style cottage/shop/tower/keep/barn/farmhouse/coop/stilt-house/half-brick and every `roof_style` gable/hip/flat/dome/spire/corrugated as an iso box on a 1x1..3x3 footprint chosen by `size`; meta `footprint`), `environment` (trees, palm, dead-tree, bushes, rocks, flowers, mushroom, tall-grass, crystal, stump, fences/gates and the ground/soil tiles as diamonds) and `object` (world props chest, chest-open, barrel, crate, torch = lamp post, sign, pot; inventory icons and tools stay flat). `iso-prop` also has well, haystack, gate-closed/open, crop (variant 0-3 = growth), lamp-post and tree-hd (a `foliage` species, `species`/`size` params, re-anchored on its trunk); `iso-tile` has kind `soil`. All iso sprites are bottom-centred so the footprint sits on the grid. `isomap` has a `village` param (extra cottages/barn/shop, well, crop field, haystack). The `iso-starter` pack includes them (docs/img/iso-village.png). `export_asset format=svg` writes a layered SVG (layer per material, per part for rigged assets, locked `guides` layer);
`export_asset format=gif` writes `<slug>.gif` (or `<slug>.<row>.gif` per animation row; `row` picks one; `scale` upscales). Maps: generate with `animate: true` (+ `frames`, default 8) to store living frames. Demo: `npx tsx scripts/mmo-scene.ts --gif`. `export_asset format=aseprite` writes `<slug>.aseprite` (see section 14). `import_svg` reads it back: edit by layer, keep `data-material` attrs or use kit colours, the guides layer is ignored. MCP also exposes the resources
`pixel-builder://project`, `pixel-builder://style-guide` and the prompt
`asset_pack` (`game`, `count`) `match_reference` (`reference`, `subject?`: `get_reference`, `kit_from_reference`, generators, compare; no API key needed) and `design_creature` (`description`, `family?`: pick a family or write a new rig, `create_rig` / `create_attachment` / `create_clip`, `generate_rigged` with idle + walk, look, fix; no API key needed). The web app's rigged-mode "Describe" box does the same with a server key via `POST /api/rig` (`{prompt, kit, base?}`). Inputs and outputs: see
[`BUILD_PLAN.md`](BUILD_PLAN.md) ("Agent tool contract") and the skill's cheat-sheet.

**Text to animation clip.** Agents write the clip JSON themselves and call `create_clip` with `rig`
(worked example "bow politely (wai)" and the validation rules in the skill's "Authoring an animation clip").
No key needed. The web app's rig editor has a "Describe animation" box backed by
`POST /api/clip` (`{prompt, family, rig?, fps?, frames?}` -> `{clip, notes}`; needs `ANTHROPIC_API_KEY`;
joints limited to the family, offsets within +-6 grid units (+-8 for jumps), planted feet on the ground,
one repair round, then 422). The result is loaded into the timeline for hand-tuning, never auto-saved.
`npx tsx scripts/clip-author-demo.ts out.png` runs 9 prompts against a running server and writes a
contact sheet (`--fixtures` renders the offline fixtures instead).

### Water depth

Water depth (`environment` + `map` + `tileset`): `water-tile` takes `depth` 0 shallow (sandy bottom) .. 3 abyss (absent/-1 = classic), `shore` (letters of `nesw` = land sides: animated foam line + wet sand bank) and `shore_rocks`; props `lily-pad` (`flower`), `reeds`, `cattail`, `river-rock`, `driftwood` (animated) and `small-bridge` (`span` 1-3, `trunk` wood | stone). `map` `water_depth: true` shades water by distance to shore (smooth gradient, foam, wet banks, lily pads, reeds); `river: true` carves a river across meadow/forest/winter. `tileset` `lower_depth` / `upper_depth` make water depth-band autotiles (water over water). Defaults are unchanged. Deep kits use the finer ramp shades for the gradient.

Example: `generate_asset generator=map params={"biome":"meadow","river":true,"water_depth":true}`. Preview: `docs/img/water-depth.png`.

MMO forest (`map` biome `forest-mmo`, `detail`, `season`): a wide river with smooth depth bands, a dirt path over a wooden bridge, clearings, dense mixed HD tree groves (willow near water, oak, birch, maple-autumn, fruit tree), grouped props and monster spawn points. `detail: low | medium | high` works on every biome (default `off` = unchanged output): colour patches in neighbouring ramp shades plus tufts, petals, pebbles, cracks and leaf litter. `lighting: off | on` with `time: day | dawn | dusk | night` (default `off`, output unchanged) adds cast shadows away from the kit light, dappled light under canopies, water reflections and a time-of-day grade, all palette-locked (`docs/img/lighting.png`; `TIME=night npx tsx scripts/mmo-scene.ts`). The result's `meta` carries `objects` (trees and props sorted by base line `y`, so a game can draw characters in the same list and walk behind trunks), `spawns` (`{x,y,monster}` on walkable cells), `playerStart` and `bridge`. `export_asset format=tiled` writes the `ground` and `deco` tile layers plus a y-sorted `objects` object layer (tile objects, `ysort` property; `deco` is then hidden) and a `spawns` point layer. Example: `generate_asset generator=map params={"biome":"forest-mmo","cols":24,"rows":16,"detail":"high"} seed=7`. Full scene with hero, monsters and HUD: `npx tsx scripts/mmo-scene.ts` -> `docs/img/mmo-scene.png` (kit-hd-rich) and `docs/img/mmo-scene-deep.png` (kit-hd-deep).

`map` biome `farm-mmo` (the farm scene, sibling of `forest-mmo`; the plain `farm` biome is unchanged): a planned, filled farmstead. Farmhouse, barn and coop in a row with a yard in the gaps (well, mailbox, sign, garden bed with vegetables, blossom flower beds, hay bales, hens, dog and cat), a 2-wide dirt road below them that crosses a stream (smooth depth bands, lily pads, reeds) on a wooden bridge, fenced crop fields in rows of mixed growth stages (`crop` generator tiles, only on tilled soil, scarecrow, irrigation channel down the west edge; `set: sea` gives rice paddies), a fenced pen with livestock, trough and hay, a pond, an orchard (fruit-tree and sakura) and a woodland edge of HD `foliage` trees all round (palms in the `sea` set). Works with `detail` (open profile, dirt kept calm), `lighting`/`time`, `animate`, `terrain: hills` on maps 30+ rows tall (plateau behind the farm, ramp and cliff). Use cols 36-42, rows 24-26 for the full layout (smaller maps drop lots). `meta`: `spawns` `{x,y,role}` reachable work spots (farmer, weeder, herder, gardener, fisher, walker), `playerStart`, `bridge`, `lots` (fields / pen / orchard / pond boxes with gate column `gx`), `buildings`, `irrigation`, `blocked` (cells nobody can enter), y-sorted `objects`. `npx tsx scripts/farm-scene.ts` renders `docs/img/farm-scene.png` / `farm-scene-dusk.png` (farmer hoeing with the `farm` clip, wife watering with the `water` clip, kid carrying, farm HUD) and `--gif` the living `farm-scene.gif`. Example: `generate_asset generator=map params={"biome":"farm-mmo","cols":42,"rows":26,"detail":"medium"} seed=1`.

Multi-height terrain (`map` param `terrain: hills`, default `flat` = unchanged output; `ramp` wood|stone, `cliff` dirt|stone): raised plateaus (level 1, and a level-2 summit on big maps) with a grass-lipped cliff face lit by the kit light, rock rim and cast shadow, stairs/ramps joining the levels, and on `forest-mmo` a plateau along the north edge with an animated waterfall where the river drops off it (`animate: true` makes it flow). Cliff faces and plateau rims are `solid`, ramps (`ramp-*` tiles) are not; a game changes level only across a ramp. `tm.heights` / `meta.terrain` = levels, ramps, waterfalls, cliff cells; `meta.objects[].level`; Tiled export adds a hidden `height` tile layer (values are levels, not gids) and a `level` property on y-sorted objects. Props and monsters stay off cliff faces and ramps.

### Autotile tilesets (`tileset` generator)

`generate_asset generator=tileset params={lower,upper,layout}` makes one atlas PNG of transition
tiles between two terrains (`layout` `wang16` = 2-corner Wang, index = NE*1 + SE*2 + SW*4 + NW*8,
bit set = corner is `upper`; `blob47` = 47-tile blob, mask bits N=1 NE=2 E=4 SE=8 S=16 SW=32 W=64
NW=128, tiles are the valid masks ascending, slot 47 is a plain `lower` tile). `export_asset`
then writes engine files next to `<slug>.png`: `tiled-tileset` (`.tsj`, corner/mixed wangset,
colour 1 = lower, 2 = upper), `godot` (`.tres` TileSet, terrain 0 = lower, 1 = upper, peering bits;
copy the PNG to `res://`), `unity` (`.rules.json`: slice `sprites` with top-left `rect` and
bottom-left `unityRect`, per-tile `ruleNeighbors` in the order NW N NE W E SW S SE with 0 DontCare,
1 This, 2 NotThis; "This" = upper) and `atlas` (`.atlas.json` index).

## Reference images in the AI endpoints

With `ANTHROPIC_API_KEY` set, `POST /api/vibe`, `/api/kit`, `/api/rig`, `/api/pixels` and `/api/inpaint`
accept optional reference inputs:

- `images`: up to 4 base64 strings or `data:image/...;base64,` URLs (PNG, JPEG, WebP, GIF; the type is sniffed from the bytes). PNGs over 1024px on the long side are downscaled on the server; other formats must be at most 3 MB each (6 MB total), so downscale JPEGs client-side (the web app does: 1024px, JPEG). Invalid images return 400, oversized 413. Request bodies may be up to 10 MB.
- `reference_ids` (+ optional `project`): resolved by a server-side `ReferenceResolver` (`server/images.ts`, `setReferenceResolver`) once the reference library is wired; without a resolver they return 400.
- `/api/kit` also takes an optional `analysis` object (offline `analyzeReference` output) that seeds the palette/ramp choice.

The prompts say the image is a reference for subject and style only; colours must come from the kit,
and outputs are still schema-validated (one repair round) and run through the kit (`finalize`, `coerceParams`).
The web app shows an "Attach reference" button next to each AI action.

Manual live smoke test (needs a key; the unit tests are mocked): start `npx tsx server/index.ts`, then
send a half-brick house photo (any JPEG under 3 MB) to the building generator:

```bash
IMG=$(base64 -w0 house.jpg)
curl -s localhost:8787/api/vibe -H 'content-type: application/json' -d "$(jq -n --arg i "$IMG" \
  '{prompt:"match the reference",images:[$i],generator:{id:"building",label:"Building",description:"houses",params:[{key:"style",label:"Style",type:"select",options:["cottage","half-brick","tower"],default:"cottage"}]},kit:{}}')"
```

Expect `params.style` near `half-brick`, with roof/material params chosen from the kit.

## Where the skill goes (summary)

| Tool | Skill location | Notes |
|---|---|---|
| Claude Code | `.claude/skills/pixel-builder/` (project) or `~/.claude/skills/` | verified |
| Hermes Agent | `~/.hermes/skills/pixel-builder/` or `skills.external_dirs` | verified |
| Codex CLI, Cursor, Gemini CLI, Copilot | `.agents/skills/pixel-builder/` (Copilot also `.github/skills/`; Cursor `.cursor/skills/`) | reported by third-party guides; unverified |
| Anything else | paste `SKILL.md` into the system prompt / rules / `AGENTS.md` | always works |

## 14. Aseprite (export + extension)

**Export.** `pixel-builder export-asset <id> --format aseprite` (MCP: `export_asset` with
`format: "aseprite"`; web app: Export > "Aseprite (.aseprite)") writes `<slug>.aseprite` into the
category folder. The file is INDEXED colour mode and its palette is the kit palette
(entry 0 transparent, entries 1..90 = material x level; blossom levels sit at 163..167, see below, the same indices sprites store), so
paint with the palette and the art stays on-kit. Layers: one per rig part for rigged assets
(`core`, then attachments, same pixel ownership as the SVG export), one per material for
everything else; the web app always uses per-material layers. Animation rows are laid out as
consecutive frames, one tag per row (`walk-down`, `idle-left`...), frame duration `1000 / fps` ms.
Cels are tight-cropped per layer and zlib-compressed. An existing `.aseprite` is refreshed
whenever the asset is re-exported (`rerender_assets`, `attach`, ...).

**Extension** (`integrations/aseprite/`, Aseprite 1.2.10+). Install: zip the folder contents
(`package.json` + `pixel-builder.lua` at the zip root), rename to `pixel-builder.aseprite-extension`
and double-click it, or copy the two files into Aseprite's `extensions/pixel-builder/` folder
(Edit > Preferences > Extensions > "Open Extensions Folder"). Commands appear under File > Scripts:

| Command | Does |
|---|---|
| Pixel Builder: Generate... | generator + params JSON (+ name, seed) -> `generate-asset`, then `export-asset --format aseprite`, then opens the file |
| Pixel Builder: Re-render with current kit | `rerender-assets --ids <asset>` and reload the open file (asset = file name or id; asks) |
| Pixel Builder: Pull kit palette | `get-style-guide` -> sets the sprite palette (entry 0 transparent, then the kit palette colours) |
| Pixel Builder: Send selection to edit_region | stub: reports the selection bounds; wired up when the `edit_region` tool (#18) is merged |

**Transport.** Aseprite's Lua has no HTTP client (only WebSocket), so the extension shells out to
the CLI with `io.popen` (`<cli> --workspace <dir> --json <command> --input @tmpfile`), not to
`pixel-builder mcp --http`. Set "CLI command" in the dialog to whatever runs the CLI: `pixel-builder`
(after `npm link`), or `node /abs/path/dist-node/cli.mjs`, or `npx tsx /abs/path/src/node/cli.ts`.
Aseprite may not inherit your shell `PATH`; use absolute paths if it cannot find `node`. Both the
extension and an MCP agent can use the same workspace folder. The first run may ask Aseprite for
permission to run scripts / access the file system. The Lua was not run inside Aseprite in CI;
if a command fails the dialog shows the CLI's error text.

## Deep palette ramps

`kit-hd-deep` (HD sizes, rich detail, `rampDepth` 9) shades volumes with 9 shades per material. `get_style_guide` then lists extra legend chars (non-ASCII, `level 0.5` ...) for the in-between shades; the 90 classic chars are unchanged. Aseprite export carries the full 172-entry palette (<= 256): indices 1..90 classic, 91..162 deep shades, 163..167 blossom levels, 168..171 blossom deep shades. The `blossom` material (pink; foliage sakura, flowers `accent: "blossom"`, `create_kit` `rampOverrides.blossom`) was appended after the original 18 so no existing index or legend char moved.

## Crops

`crop` makes top-down farm crops with growth stages (species wheat, corn, carrot, cabbage, tomato, pumpkin, strawberry, rice, sunflower; stage seed, sprout, growing, ready, withered; rows idle + sway). One-tile footprint; corn, sunflower and ripe wheat are taller and bottom-anchored. The `farming-v1` pack includes every species and stage (`crop-<species>-<stage>`). See `docs/img/crops.png`.

```bash
pixel-builder generate-asset crop --params species=pumpkin,stage=ready --seed 1 --name "pumpkin"
```

## HD trees

`foliage` makes lush leaf-cluster trees (species oak, willow, maple-autumn, birch, fruit-tree, pine-hd, sakura; size small/medium/large; season spring..winter; rows idle + sway):

```bash
pixel-builder generate-asset foliage --params species=willow,size=large --seed 3 --name "willow"
```
